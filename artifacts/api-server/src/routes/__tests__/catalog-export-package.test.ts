/**
 * Full-catalog package (wave-3 #14) — the manifest's honesty mechanics
 * over pg-mem, the trust-money.test.ts pattern: the pure cap function,
 * a section that hits its cap SAYS so instead of dropping the tail, a
 * missing source table reads error + partial for the NEW sections too,
 * and the audience joins stay honest when the other side has no public
 * profile / no tier row (nulls, never invented values). Section
 * completeness + privacy key sets are pinned in trust-money.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any, userId: "" }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = testState.userId; next(); },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

import { buildCatalogManifest, capManifestItems, MANIFEST_CATALOG_CAP, MANIFEST_AUDIENCE_CAP } from "../trust";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL, amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), affiliate_code text, bump_for_product_id uuid);
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, audio_url text NOT NULL, source text NOT NULL DEFAULT 'upload', duration_sec text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE generated_clips (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text, video_url text, thumbnail_url text, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE distribution_releases (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, artist_name text NOT NULL, status text NOT NULL DEFAULT 'draft', audio_url text, artwork_url text, platforms jsonb, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE store_products (id uuid PRIMARY KEY, profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL, price_cents integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, media_urls jsonb, affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer, media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb, bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0);
CREATE TABLE email_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL);
CREATE TABLE email_subscribers (id uuid PRIMARY KEY, list_id uuid NOT NULL, email text NOT NULL, name text, source text NOT NULL DEFAULT 'landing', unsubscribed_at timestamptz, subscribed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, tier_id uuid, fan_label text, status text NOT NULL DEFAULT 'active', billing_period text NOT NULL DEFAULT 'monthly', price_cents integer NOT NULL DEFAULT 0, is_gift boolean NOT NULL DEFAULT false, joined_at timestamptz NOT NULL DEFAULT now(), current_period_end timestamptz, stripe_session_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE fan_tiers (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_projects (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, type text NOT NULL DEFAULT 'song', concept text NOT NULL DEFAULT '', template_key text, attribution boolean NOT NULL DEFAULT true, artist_vault_id uuid, assets jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE project_drafts (id uuid PRIMARY KEY, user_id uuid NOT NULL, workflow_type text NOT NULL, title text, draft_data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE catalog_export_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, status text NOT NULL DEFAULT 'running', progress integer NOT NULL DEFAULT 0, manifest jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sponsor_payouts (id uuid PRIMARY KEY, creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'released', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE royalty_entries (id uuid PRIMARY KEY, user_id uuid NOT NULL, song_title text NOT NULL, platform text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, gross_amount numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
`;

const OWNER = randomUUID(), PROFILE = randomUUID();

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(DDL);
  testState.db = db; testState.userId = OWNER;
});

describe("capManifestItems", () => {
  it("under and at the cap: everything rides, truncated false", () => {
    expect(capManifestItems([1, 2], 3)).toEqual({ items: [1, 2], truncated: false });
    expect(capManifestItems([1, 2, 3], 3)).toEqual({ items: [1, 2, 3], truncated: false });
  });

  it("over the cap: keeps the first `cap` entries (the queries order newest first) and says so", () => {
    const out = capManifestItems([1, 2, 3, 4, 5], 3);
    expect(out.items).toEqual([1, 2, 3]);
    expect(out.truncated).toBe(true);
  });

  it("the caps are the documented sizes", () => {
    expect(MANIFEST_CATALOG_CAP).toBe(2000);
    expect(MANIFEST_AUDIENCE_CAP).toBe(10000);
  });
});

describe("package honesty", () => {
  /* Seeding cap+5 = 2,005 rows through pg-mem is slow (its parser, not
     the query — production Postgres takes the LIMIT query trivially),
     so this one test carries an explicit timeout. */
  it("a section over its cap reports truncated with the cap as its count — the tail is never silently dropped", async () => {
    const db = testState.db;
    const total = MANIFEST_CATALOG_CAP + 5;
    const vals = Array.from({ length: total }, () => sql`(${randomUUID()}, ${OWNER}, 'Bulk Song', 'https://files.example/b.wav')`);
    await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url) VALUES ${sql.join(vals, sql`, `)}`);
    const m: any = await buildCatalogManifest(OWNER);
    expect(m.songs.status).toBe("ok");
    expect(m.songs.truncated).toBe(true);
    expect(m.songs.count).toBe(MANIFEST_CATALOG_CAP);
    expect(m.songs.items).toHaveLength(MANIFEST_CATALOG_CAP);
    expect(m.videos.truncated).toBe(false);
  }, 120_000);

  it("a missing NEW source table reads error + partial; the rest of the package still builds", async () => {
    const { db, mem } = createTestDb();
    mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
    mem.public.none(DDL.replace(/CREATE TABLE follows[^;]+;/, ""));
    testState.db = db;
    const m: any = await buildCatalogManifest(OWNER);
    expect(m.followers.status).toBe("error");
    expect(m.followers.count).toBeNull();
    expect(m.partial).toBe(true);
    expect(m.projects.status).toBe("ok");
    expect(m.members.status).toBe("ok");
  });

  it("audience joins stay honest: a follower with no public profile and a member with no tier row read as nulls, never invented values", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE}, ${OWNER}, 'me', 'Me')`);
    const GHOST = randomUUID();
    await db.execute(sql`INSERT INTO follows (follower_user_id, profile_id) VALUES (${GHOST}, ${PROFILE})`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, tier_id, fan_label, status) VALUES (${randomUUID()}, ${OWNER}, ${randomUUID()}, 'label-only@example.com', 'active')`);
    const m: any = await buildCatalogManifest(OWNER);
    expect(m.followers.count).toBe(1);
    expect(m.followers.items[0].name).toBeNull();
    expect(m.followers.items[0].slug).toBeNull();
    expect(m.followers.items[0].followedAt).not.toBeNull();
    expect(m.members.count).toBe(1);
    expect(m.members.items[0].tierName).toBeNull();
    expect(m.members.items[0].fanLabel).toBe("label-only@example.com");
    expect(JSON.stringify(m)).not.toContain(GHOST);
  });

  /* The POST job shell itself (insert → build → store) is covered in
     trust.test.ts — pg-mem cannot run that route's Drizzle .returning()
     insert ("pg rowMode" harness limit), so the package shape is pinned
     here through the builder the route calls. */
  it("the built package carries all nine sections with honest defaults on an empty catalog", async () => {
    const m: any = await buildCatalogManifest(OWNER);
    for (const key of ["songs", "videos", "releases", "projects", "projectDrafts", "storeProducts", "audience", "followers", "members"]) {
      expect(m[key], key).toBeDefined();
      expect(m[key].status).toBe("ok");
      expect(m[key].count).toBe(0);
      expect(m[key].truncated).toBe(false);
    }
    expect(m.partial).toBe(false);
    expect(m.includes.join(" ")).toContain("projects");
    expect(m.formatNote).toContain("media files themselves do not ride the package");
  });
});
