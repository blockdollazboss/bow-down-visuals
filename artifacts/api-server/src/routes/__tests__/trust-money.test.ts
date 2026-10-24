/**
 * Stack 10 raw-SQL surfaces against pg-mem (createTestDb), the pattern
 * earnings.test.ts uses: #3 catalog manifest completeness on a fixture
 * account (via the exported builder — the job row shell is covered in
 * trust.test.ts) and #5 annual statements over HTTP (those handlers
 * are execute-only), including the error-vs-fake-zero discipline.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
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

import trustRouter, { buildCatalogManifest } from "../trust";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL, amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), affiliate_code text, bump_for_product_id uuid);
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, tier_id uuid, fan_label text, status text NOT NULL DEFAULT 'active', billing_period text NOT NULL DEFAULT 'monthly', price_cents integer NOT NULL DEFAULT 0, is_gift boolean NOT NULL DEFAULT false, joined_at timestamptz NOT NULL DEFAULT now(), current_period_end timestamptz, stripe_session_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE fan_tiers (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
CREATE TABLE follows (follower_user_id uuid NOT NULL, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE hub_projects (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, type text NOT NULL DEFAULT 'song', concept text NOT NULL DEFAULT '', template_key text, attribution boolean NOT NULL DEFAULT true, artist_vault_id uuid, assets jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE project_drafts (id uuid PRIMARY KEY, user_id uuid NOT NULL, workflow_type text NOT NULL, title text, draft_data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sponsor_payouts (id uuid PRIMARY KEY, creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'released', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE royalty_entries (id uuid PRIMARY KEY, user_id uuid NOT NULL, song_title text NOT NULL, platform text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, gross_amount numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE songs (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, audio_url text NOT NULL, source text NOT NULL DEFAULT 'upload', duration_sec text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE generated_clips (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text, video_url text, thumbnail_url text, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE distribution_releases (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, artist_name text NOT NULL, status text NOT NULL DEFAULT 'draft', audio_url text, artwork_url text, platforms jsonb, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE store_products (id uuid PRIMARY KEY, profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL, price_cents integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, media_urls jsonb, affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer, media_alt_texts jsonb NOT NULL DEFAULT '[]', gift_card_denominations_cents jsonb, bump_product_id uuid, bump_percent_off integer NOT NULL DEFAULT 0);
CREATE TABLE email_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL);
CREATE TABLE email_subscribers (id uuid PRIMARY KEY, list_id uuid NOT NULL, email text NOT NULL, name text, source text NOT NULL DEFAULT 'landing', unsubscribed_at timestamptz, subscribed_at timestamptz NOT NULL DEFAULT now());
`;

const OWNER = randomUUID(), STRANGER = randomUUID(), PROFILE = randomUUID();
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(trustRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(DDL);
  testState.db = db; testState.userId = OWNER;
});

describe("#3 catalog manifest completeness (fixture account)", () => {
  it("carries every section with the fixture rows; audience excludes unsubscribed; other creators never leak in", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url) VALUES (${randomUUID()}, ${OWNER}, 'Song A', 'https://files.example/a.wav')`);
    await db.execute(sql`INSERT INTO generated_clips (id, user_id, title, video_url) VALUES (${randomUUID()}, ${OWNER}, 'Clip A', 'https://files.example/a.mp4')`);
    await db.execute(sql`INSERT INTO distribution_releases (id, user_id, title, artist_name, status) VALUES (${randomUUID()}, ${OWNER}, 'Rel A', 'Me', 'draft')`);
    await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents) VALUES (${randomUUID()}, ${PROFILE}, 'digital', 'Pack A', 1900)`);
    const list = randomUUID();
    await db.execute(sql`INSERT INTO email_lists (id, user_id, name, handle) VALUES (${list}, ${OWNER}, 'Fans', 'fans-a')`);
    await db.execute(sql`INSERT INTO email_subscribers (id, list_id, email) VALUES (${randomUUID()}, ${list}, 'fan@example.com')`);
    await db.execute(sql`INSERT INTO email_subscribers (id, list_id, email, unsubscribed_at) VALUES (${randomUUID()}, ${list}, 'gone@example.com', now())`);
    await db.execute(sql`INSERT INTO songs (id, user_id, title, audio_url) VALUES (${randomUUID()}, ${STRANGER}, 'Not Mine', 'https://files.example/x.wav')`);
    /* Wave-3 #14 sections: projects + drafts, followers, fan-club members. */
    await db.execute(sql`INSERT INTO hub_projects (id, user_id, name, type, assets) VALUES (${randomUUID()}, ${OWNER}, 'Project A', 'song', '[{"kind":"audio","url":"https://files.example/p.wav"}]'::jsonb)`);
    await db.execute(sql`INSERT INTO hub_projects (id, user_id, name) VALUES (${randomUUID()}, ${STRANGER}, 'Not My Project')`);
    await db.execute(sql`INSERT INTO project_drafts (id, user_id, workflow_type, title, draft_data) VALUES (${randomUUID()}, ${OWNER}, 'song', 'Draft A', '{"bpm":90}'::jsonb)`);
    const tier = randomUUID();
    await db.execute(sql`INSERT INTO fan_tiers (id, user_id, name) VALUES (${tier}, ${OWNER}, 'Front Row')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, tier_id, fan_label, status, price_cents) VALUES (${randomUUID()}, ${OWNER}, ${tier}, 'member@example.com', 'active', 1500)`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, tier_id, fan_label, status, stripe_session_id) VALUES (${randomUUID()}, ${STRANGER}, ${tier}, 'stranger@example.com', 'active', 'cs_stranger')`);
    const FAN = randomUUID(), FAN_PROFILE = randomUUID(), STRANGER_PROFILE = randomUUID();
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${FAN_PROFILE}, ${FAN}, 'fanpage', 'Fan Page')`);
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${STRANGER_PROFILE}, ${STRANGER}, 'them', 'Them')`);
    await db.execute(sql`INSERT INTO follows (follower_user_id, profile_id) VALUES (${FAN}, ${PROFILE})`);
    await db.execute(sql`INSERT INTO follows (follower_user_id, profile_id) VALUES (${FAN}, ${STRANGER_PROFILE})`);

    const m: any = await buildCatalogManifest(OWNER);
    expect(m.format).toBe("manifest+links");
    expect(m.partial).toBe(false);
    expect(m.songs.count).toBe(1); expect(m.songs.items[0].title).toBe("Song A"); expect(m.songs.items[0].fileUrl).toContain("a.wav");
    expect(m.videos.count).toBe(1);
    expect(m.releases.count).toBe(1);
    expect(m.storeProducts.count).toBe(1);
    expect(m.audience.count).toBe(1); expect(m.audience.items[0].email).toBe("fan@example.com");
    expect(m.projects.count).toBe(1); expect(m.projects.items[0].name).toBe("Project A");
    expect(m.projects.items[0].assetCount).toBe(1); expect(m.projects.items[0].assets[0].url).toContain("p.wav");
    expect(m.projects.truncated).toBe(false);
    expect(m.projectDrafts.count).toBe(1); expect(m.projectDrafts.items[0].workflowType).toBe("song");
    expect(m.followers.count).toBe(1); expect(m.followers.items[0]).toMatchObject({ name: "Fan Page", slug: "fanpage" });
    expect(Object.keys(m.followers.items[0]).sort()).toEqual(["followedAt", "name", "slug"]);
    expect(m.members.count).toBe(1); expect(m.members.items[0].fanLabel).toBe("member@example.com");
    expect(m.members.items[0].tierName).toBe("Front Row"); expect(m.members.items[0].status).toBe("active");
    expect(Object.keys(m.members.items[0]).sort()).toEqual(["billingPeriod", "currentPeriodEnd", "fanLabel", "isGift", "joinedAt", "priceCents", "status", "tierName"]);
    /* Nothing of anyone else's rides — and no account ids or payment
       references of anybody's ride either. */
    const whole = JSON.stringify(m);
    expect(whole).not.toContain("Not My Project");
    expect(whole).not.toContain("stranger@example.com");
    expect(whole).not.toContain("cs_stranger");
    expect(whole).not.toContain(FAN);
    expect(whole).not.toContain(STRANGER);
  });

  it("a missing source table reads status error + partial — never a fake empty section presented as complete", async () => {
    const { db, mem } = createTestDb();
    mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
    mem.public.none(DDL.replace(/CREATE TABLE songs[^;]+;/, ""));
    testState.db = db;
    const m: any = await buildCatalogManifest(OWNER);
    expect(m.songs.status).toBe("error");
    expect(m.songs.count).toBeNull();
    expect(m.partial).toBe(true);
    expect(m.videos.status).toBe("ok");
  });
});

describe("#5 earnings statements", () => {
  it("sums only recorded rows for the year, royalties converted from dollars, other years excluded; PDF renders", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 5000, 'completed', '2026-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 9999, 'completed', '2025-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, stripe_session_id, created_at) VALUES (${randomUUID()}, ${OWNER}, 1500, 'cs_1', '2026-05-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO royalty_entries (id, user_id, song_title, platform, period_start, period_end, gross_amount) VALUES (${randomUUID()}, ${OWNER}, 'S', 'manual', '2026-01-01', '2026-01-31', 12.34)`);

    const r = await realFetch(`${baseUrl}/earnings/statements/2026`);
    const json: any = await r.json();
    expect(json.statement.sources.storeSales.totalCents).toBe(5000);
    expect(json.statement.sources.memberships.totalCents).toBe(1500);
    expect(json.statement.sources.royalties.totalCents).toBe(1234);
    expect(json.statement.totalCents).toBe(7734);
    expect(json.statement.documentKind).toBe("statement_of_platform_recorded_earnings");
    expect(json.statement.disclaimer).toMatch(/not a filed tax form/);

    const pdf = await realFetch(`${baseUrl}/earnings/statements/2026/pdf`);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    expect((await pdf.text()).startsWith("%PDF")).toBe(true);
  });

  it("a year with no records reads honest zeros, not an error", async () => {
    const r = await realFetch(`${baseUrl}/earnings/statements/2024`);
    const json: any = await r.json();
    expect(json.statement.totalCents).toBe(0);
    expect(json.statement.partial).toBe(false);
  });

  it("the in-page JSON and the PDF are the SAME statement — every line and the total match, from the one builder", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 5000, 'completed', '2026-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type, amount_cents, platform_fee_cents, created_at) VALUES (${randomUUID()}, ${OWNER}, 'sale', 2000, 100, '2026-04-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, stripe_session_id, created_at) VALUES (${randomUUID()}, ${OWNER}, 1500, 'cs_1', '2026-05-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO sponsor_payouts (id, creator_user_id, net_cents, status, created_at) VALUES (${randomUUID()}, ${OWNER}, 4000, 'released', '2026-06-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO royalty_entries (id, user_id, song_title, platform, period_start, period_end, gross_amount) VALUES (${randomUUID()}, ${OWNER}, 'S', 'manual', '2026-01-01', '2026-01-31', 12.34)`);

    const json: any = await (await realFetch(`${baseUrl}/earnings/statements/2026`)).json();
    const pdfRes = await realFetch(`${baseUrl}/earnings/statements/2026/pdf`);
    expect(pdfRes.headers.get("content-disposition")).toContain('filename="earnings-statement-2026.pdf"');
    /* The PDF's content streams are uncompressed text ops, so the
       exact strings the PDF prints are readable here. Format them
       FROM the JSON's numbers (the PDF route's own money format)
       and require every one inside the PDF bytes — the in-page
       viewer's data and the PDF's data are one builder's object. */
    const pdfText = await pdfRes.text();
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const lines: Array<[string, string]> = [
      ["Store sales", "storeSales"],
      ["Shop sales", "shopSales"],
      ["Memberships", "memberships"],
      ["Brand deals", "brandDeals"],
      ["Royalties", "royalties"],
    ];
    for (const [label, key] of lines) {
      const s = json.statement.sources[key];
      expect(s.status).toBe("ok");
      expect(pdfText).toContain(label);
      expect(pdfText).toContain(`${money(s.totalCents)}  (${s.count} records)`.replace(/[()]/g, (m) => `\\${m}`));
    }
    expect(json.statement.totalCents).toBe(5000 + 1900 + 1500 + 4000 + 1234);
    expect(pdfText).toContain(money(json.statement.totalCents));
  });

  it("rejects out-of-range and non-integer years on BOTH the JSON and PDF routes", async () => {
    for (const bad of ["2019", "2101", "abcd", "2026.5"]) {
      expect((await realFetch(`${baseUrl}/earnings/statements/${bad}`)).status).toBe(400);
      expect((await realFetch(`${baseUrl}/earnings/statements/${bad}/pdf`)).status).toBe(400);
    }
  });

  it("owner-scoping: another creator's recorded rows never enter your statement — each side sees only its own", async () => {
    const db = testState.db;
    const STRANGER_PROFILE = randomUUID();
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${STRANGER_PROFILE}, ${STRANGER}, 'them')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 5000, 'completed', '2026-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${STRANGER_PROFILE}, 7777, 'completed', '2026-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type, amount_cents, platform_fee_cents, created_at) VALUES (${randomUUID()}, ${STRANGER}, 'sale', 2000, 100, '2026-04-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, stripe_session_id, created_at) VALUES (${randomUUID()}, ${STRANGER}, 3333, 'cs_9', '2026-05-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO sponsor_payouts (id, creator_user_id, net_cents, status, created_at) VALUES (${randomUUID()}, ${STRANGER}, 4444, 'released', '2026-06-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO royalty_entries (id, user_id, song_title, platform, period_start, period_end, gross_amount) VALUES (${randomUUID()}, ${STRANGER}, 'S', 'manual', '2026-01-01', '2026-01-31', 9.99)`);

    const mine: any = await (await realFetch(`${baseUrl}/earnings/statements/2026`)).json();
    expect(mine.statement.sources.storeSales.totalCents).toBe(5000);
    expect(mine.statement.sources.shopSales.totalCents).toBe(0);
    expect(mine.statement.sources.memberships.totalCents).toBe(0);
    expect(mine.statement.sources.brandDeals.totalCents).toBe(0);
    expect(mine.statement.sources.royalties.totalCents).toBe(0);
    expect(mine.statement.totalCents).toBe(5000);

    testState.userId = STRANGER;
    const theirs: any = await (await realFetch(`${baseUrl}/earnings/statements/2026`)).json();
    expect(theirs.statement.sources.storeSales.totalCents).toBe(7777);
    expect(theirs.statement.sources.shopSales.totalCents).toBe(1900);
    expect(theirs.statement.sources.memberships.totalCents).toBe(3333);
    expect(theirs.statement.sources.brandDeals.totalCents).toBe(4444);
    expect(theirs.statement.sources.royalties.totalCents).toBe(999);
    expect(theirs.statement.totalCents).toBe(7777 + 1900 + 3333 + 4444 + 999);
  });
});
