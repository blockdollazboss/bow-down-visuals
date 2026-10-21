/**
 * Move Home concierge (0193) — HTTP over pg-mem, the
 * catalog-export-builder pattern. Pins the discipline the feature
 * lives by:
 *   - drafting creates NOTHING on any public rail (all drafts inert),
 *   - a step goes live ONLY through its own explicit approve call,
 *   - approvals never double-apply,
 *   - unconnected platforms are never claimed (no launch drafts,
 *     no social links, honest blockedReason),
 *   - the flow charges nothing — this test DB has no credits table
 *     at all, so any charge attempt would fail the request loudly.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u); next();
  },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../lib/ai-clients", () => ({
  /* No AI in tests: the polish rail throws, assembled drafts must stand. */
  getOpenAI: () => { throw new Error("no ai in tests"); },
  getTextModel: () => "test-model",
  getPlainTranscribeModel: () => "test-model",
}));

import moveHomeRouter from "../move-home";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/* createTestDb's shim strips drizzle's `types` config but not
   `rowMode: 'array'` (query-builder selects request array rows;
   pg-mem can't produce them). Same construction, one step further:
   strip rowMode too and rebuild array rows from the result's field
   order, which is what drizzle's mapResultRow consumes. */
function createMoveHomeTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const shim = {
    query: async (config: unknown, values?: unknown[]) => {
      let cfg: unknown = config;
      let wantArray = false;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        const { types: _strippedTypes, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const result = (await (pool as unknown as {
        query: (c: unknown, v?: unknown[]) => Promise<any>;
      }).query(cfg, values)) as any;
      if (wantArray && Array.isArray(result?.rows) && result.rows.length > 0) {
        /* pg-mem returns rows as objects (keys in select order) and an
           empty `fields` array — rebuild the array rows drizzle maps
           from the row's own key order. Single-table selects only in
           this suite, so column names are unique. */
        const names = Object.keys(result.rows[0]);
        return { ...result, rows: result.rows.map((row: any) => names.map((n) => row[n])) };
      }
      return result;
    },
  };
  return { mem, db: drizzle(shim as never) };
}

const DDL = `
CREATE TABLE move_home_progress (
  user_id uuid PRIMARY KEY,
  answers jsonb NOT NULL DEFAULT '{}',
  drafts jsonb NOT NULL DEFAULT '{}',
  steps jsonb NOT NULL DEFAULT '{}',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  avatar_url text, banner_url text,
  theme_id text NOT NULL DEFAULT 'gold-lux',
  vertical text NOT NULL DEFAULT 'music',
  stream_schedule jsonb NOT NULL DEFAULT '[]',
  media_kit jsonb,
  theme_config jsonb NOT NULL DEFAULT '{}',
  sections jsonb NOT NULL DEFAULT '[]',
  layout_blocks jsonb NOT NULL DEFAULT '[]',
  pinned_kind text, pinned_item_id uuid,
  collection_visibility text NOT NULL DEFAULT 'public',
  featured_media jsonb,
  merch_items jsonb NOT NULL DEFAULT '[]',
  events jsonb NOT NULL DEFAULT '[]',
  series jsonb NOT NULL DEFAULT '[]',
  social_posts jsonb NOT NULL DEFAULT '[]',
  social_links jsonb NOT NULL DEFAULT '{}',
  top_creators jsonb NOT NULL DEFAULT '[]',
  tip_jar_enabled boolean NOT NULL DEFAULT true,
  ai_design jsonb,
  is_public boolean NOT NULL DEFAULT true,
  is_verified boolean NOT NULL DEFAULT false,
  is_official boolean NOT NULL DEFAULT false,
  follower_count integer NOT NULL DEFAULT 0,
  total_plays integer NOT NULL DEFAULT 0,
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean NOT NULL DEFAULT false,
  stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE follows (
  follower_user_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, profile_id)
);
CREATE TABLE social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL DEFAULT 'instagram',
  ig_user_id text, provider_user_id text, username text,
  page_id text, page_name text,
  access_token_encrypted text, refresh_token_encrypted text,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  title text NOT NULL, audio_url text NOT NULL, artwork_url text,
  genre text, tags text[] NOT NULL DEFAULT '{}', isrc text,
  duration_sec integer NOT NULL DEFAULT 0,
  download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false,
  pwyw_min_cents integer NOT NULL DEFAULT 0,
  play_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  title text NOT NULL, video_url text NOT NULL, thumbnail_url text,
  description text NOT NULL DEFAULT '', genre text, tags text[] NOT NULL DEFAULT '{}',
  duration_sec integer NOT NULL DEFAULT 0,
  season integer, episode integer, sound_track_id uuid,
  download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false,
  pwyw_min_cents integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false,
  is_short boolean NOT NULL DEFAULT false,
  duet_with uuid, stitch_with uuid,
  sound_id text, sound_title text, sound_url text,
  sound_use_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE press_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, handle text NOT NULL UNIQUE, artist_name text NOT NULL,
  tagline text, bio text, genre text, location text,
  booking_email text, website text,
  instagram_url text, tiktok_url text, youtube_url text, spotify_url text,
  achievements jsonb NOT NULL DEFAULT '[]',
  press_quotes jsonb NOT NULL DEFAULT '[]',
  photo_urls jsonb NOT NULL DEFAULT '[]',
  top_tracks jsonb NOT NULL DEFAULT '[]',
  press_releases jsonb NOT NULL DEFAULT '[]',
  layout jsonb, artist_vault_id uuid,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL UNIQUE,
  description text, welcome_subject text, welcome_body text,
  welcome2_subject text, welcome2_body text,
  welcome3_subject text, welcome3_body text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL, compare_at_cents integer,
  inventory integer NOT NULL DEFAULT -1,
  media_urls jsonb NOT NULL DEFAULT '[]',
  service_details jsonb, event_id uuid,
  related_links jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, status text NOT NULL DEFAULT 'draft',
  media_url text NOT NULL, media_type text NOT NULL DEFAULT 'video',
  caption text NOT NULL DEFAULT '', hashtags text NOT NULL DEFAULT '',
  platforms jsonb NOT NULL DEFAULT '[]', account_ids jsonb NOT NULL DEFAULT '{}',
  scheduled_at timestamptz, posted_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, last_error text,
  credits_charged integer NOT NULL DEFAULT 0,
  credits_refunded boolean NOT NULL DEFAULT false,
  release_id uuid, ai_best_time jsonb, results jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

let server: any; let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {}, warn: () => {} }; next(); });
  app.use("/api", moveHomeRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => {
  const { db } = createMoveHomeTestDb();
  testState.db = db;
});

async function call(user: string | null, method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = r.status === 204 ? null : await r.json().catch(() => null);
  return { status: r.status, json };
}

const get = (u: string) => call(u, "GET", "/api/move-home");
const answers = (u: string, body: unknown) => call(u, "PUT", "/api/move-home/answers", body);
const draft = (u: string) => call(u, "POST", "/api/move-home/draft");
const approve = (u: string, step: string) => call(u, "POST", `/api/move-home/steps/${step}/approve`);
const skip = (u: string, step: string) => call(u, "POST", `/api/move-home/steps/${step}/skip`);
const reopen = (u: string, step: string) => call(u, "POST", `/api/move-home/steps/${step}/reopen`);
const patchDraft = (u: string, step: string, body: unknown) => call(u, "PATCH", `/api/move-home/drafts/${step}`, body);

async function count(table: string): Promise<number> {
  const r = await testState.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`));
  return (r.rows[0] as any).n as number;
}

async function rows(table: string): Promise<any[]> {
  const r = await testState.db.execute(sql.raw(`SELECT * FROM ${table}`));
  return r.rows as any[];
}

const ANSWERS = {
  displayName: "Nova Reign",
  vertical: "music",
  genre: "soul trap",
  bioSeed: "I make soul trap for late-night drivers.",
  handle: "nova-reign",
  location: "Atlanta",
};

describe("move home — auth + resumable state", () => {
  it("unauthenticated is a 401", async () => {
    expect((await call(null, "GET", "/api/move-home")).status).toBe(401);
  });

  it("first read lazily creates the checklist; answers round-trip across reads (resume)", async () => {
    const u = randomUUID();
    const first = await get(u);
    expect(first.status).toBe(200);
    expect(first.json.moveHome.steps.map((s: any) => s.status)).toEqual([
      "pending", "pending", "pending", "pending", "pending",
    ]);
    expect(first.json.moveHome.completedAt).toBeNull();

    expect((await answers(u, ANSWERS)).status).toBe(200);
    const second = await get(u);
    expect(second.json.moveHome.answers.displayName).toBe("Nova Reign");
    expect(second.json.moveHome.answers.handle).toBe("nova-reign");
    expect(await count("move_home_progress")).toBe(1);
  });

  it("bad answers are a 400 (unknown vertical, unknown field)", async () => {
    const u = randomUUID();
    expect((await answers(u, { vertical: "astronaut" })).status).toBe(400);
    expect((await answers(u, { shoeSize: 9 })).status).toBe(400);
  });
});

describe("move home — drafts are inert; approval is the only door", () => {
  it("draft pass publishes nothing and charges nothing", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    const r = await draft(u);
    expect(r.status).toBe(200);
    const steps = Object.fromEntries(r.json.moveHome.steps.map((s: any) => [s.key, s]));
    expect(steps.profile.status).toBe("drafted");
    expect(steps.launch_posts.blockedReason).toBe("no_connected_accounts");
    /* AI rail is off in tests — assembled copy must stand, honestly labeled */
    expect(r.json.moveHome.drafts.copySource).toBe("assembled");
    /* The starter product is a suggestion, not a price ruling */
    expect(r.json.moveHome.drafts.store.products[0].suggestedPrice).toBe(true);
    /* NOTHING landed on any rail */
    expect(await count("creator_profiles")).toBe(0);
    expect(await count("store_products")).toBe(0);
    expect(await count("press_kits")).toBe(0);
    expect(await count("email_lists")).toBe(0);
    expect(await count("scheduled_posts")).toBe(0);
  });

  it("approve before drafting is a 409 NOT_DRAFTED", async () => {
    const u = randomUUID();
    const r = await approve(u, "profile");
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("NOT_DRAFTED");
  });

  it("store approval before a profile exists is a 409 NEEDS_PROFILE", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    await draft(u);
    const r = await approve(u, "store");
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("NEEDS_PROFILE");
    expect(await count("store_products")).toBe(0);
  });

  it("full walk: each approval applies exactly its own rail, exactly once", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    await draft(u);

    const p = await approve(u, "profile");
    expect(p.status).toBe(200);
    const profiles = await rows("creator_profiles");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].slug).toBe("nova-reign");
    expect(profiles[0].is_public).toBe(true);
    expect(profiles[0].bio).toBe("I make soul trap for late-night drivers.");
    const profileStep = p.json.moveHome.steps.find((s: any) => s.key === "profile");
    expect(profileStep.status).toBe("approved");
    expect(profileStep.appliedRef).toBe(profiles[0].id);

    /* Re-approve: no double-apply */
    await approve(u, "profile");
    expect(await count("creator_profiles")).toBe(1);

    const s = await approve(u, "store");
    expect(s.status).toBe(200);
    const products = await rows("store_products");
    expect(products).toHaveLength(1);
    expect(products[0].is_active).toBe(true);
    expect(products[0].price_cents).toBe(500);

    const k = await approve(u, "press_kit");
    expect(k.status).toBe(200);
    const kits = await rows("press_kits");
    expect(kits).toHaveLength(1);
    expect(kits[0].is_public).toBe(true);
    expect(kits[0].handle).toBe("nova-reign");

    const e = await approve(u, "email_list");
    expect(e.status).toBe(200);
    const lists = await rows("email_lists");
    expect(lists).toHaveLength(1);
    expect(lists[0].welcome_subject).toContain("Nova Reign");

    /* Launch has no connected accounts — approve refuses honestly */
    const l = await approve(u, "launch_posts");
    expect(l.status).toBe(409);
    expect(l.json.code).toBe("NO_CONNECTED_ACCOUNTS");
    expect(await count("scheduled_posts")).toBe(0);

    /* Skipping the blocked step completes the checklist */
    const done = await skip(u, "launch_posts");
    expect(done.json.moveHome.completedAt).not.toBeNull();
  });

  it("approved steps are sealed against draft edits", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    await draft(u);
    await approve(u, "profile");
    const r = await patchDraft(u, "profile", { bio: "too late" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("STEP_SEALED");
  });

  it("draft edits land: an edited store price is the price that goes live", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    await draft(u);
    const before = (await get(u)).json.moveHome.drafts.store.products[0];
    const edited = await patchDraft(u, "store", {
      products: [{ ...before, priceCents: 900, title: "Nova — Supporter Pack" }],
    });
    expect(edited.status).toBe(200);
    await approve(u, "profile");
    await approve(u, "store");
    const products = await rows("store_products");
    expect(products[0].price_cents).toBe(900);
    expect(products[0].title).toBe("Nova — Supporter Pack");
  });

  it("skip + reopen round-trips and un-completes the checklist", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    await draft(u);
    for (const step of ["profile", "store", "press_kit", "email_list"]) await approve(u, step);
    const skipped = await skip(u, "launch_posts");
    expect(skipped.json.moveHome.completedAt).not.toBeNull();
    const reopened = await reopen(u, "launch_posts");
    const step = reopened.json.moveHome.steps.find((s: any) => s.key === "launch_posts");
    expect(step.status).toBe("drafted");
    expect(reopened.json.moveHome.completedAt).toBeNull();
  });
});

describe("move home — connected accounts only, never an import", () => {
  it("launch drafts exist only for connected accounts; scheduler drafts land free and unposted", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    await draft(u);
    await approve(u, "profile");
    const [profile] = await rows("creator_profiles");
    /* The creator's own existing video becomes the launch media */
    await testState.db.execute(sql`
      INSERT INTO profile_videos (profile_id, title, video_url, is_published)
      VALUES (${profile.id}, 'Intro', 'https://files.example/intro.mp4', true)`);
    const accountId = randomUUID();
    await testState.db.execute(sql`
      INSERT INTO social_accounts (id, user_id, platform, username)
      VALUES (${accountId}, ${u}, 'instagram', 'novareign')`);

    const r = await draft(u);
    const launch = r.json.moveHome.drafts.launch_posts;
    expect(launch.posts).toHaveLength(1);
    expect(launch.posts[0].platform).toBe("instagram");
    expect(launch.posts[0].accountId).toBe(accountId);
    expect(launch.posts[0].mediaUrl).toBe("https://files.example/intro.mp4");
    /* TikTok was never connected — no draft, no claimed link */
    const profileDraft = r.json.moveHome.drafts.profile;
    expect(profileDraft.socialLinks.instagram).toBe("https://instagram.com/novareign");
    expect(profileDraft.socialLinks.tiktok).toBeUndefined();

    const a = await approve(u, "launch_posts");
    expect(a.status).toBe(200);
    const posts = await rows("scheduled_posts");
    expect(posts).toHaveLength(1);
    expect(posts[0].status).toBe("draft");
    expect(posts[0].credits_charged).toBe(0);
    expect(posts[0].platforms).toEqual(["instagram"]);
    expect(posts[0].posted_at).toBeNull();
  });

  it("an account disconnected after drafting applies nothing for it", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    const accountId = randomUUID();
    await testState.db.execute(sql`
      INSERT INTO social_accounts (id, user_id, platform, username)
      VALUES (${accountId}, ${u}, 'instagram', 'novareign')`);
    /* Draft media: none exists yet — give the draft media by hand, as
       the creator would from their uploads */
    await draft(u);
    const launchDraft = (await get(u)).json.moveHome.drafts.launch_posts;
    launchDraft.posts[0].mediaUrl = "https://files.example/launch.mp4";
    launchDraft.posts[0].mediaType = "video";
    await patchDraft(u, "launch_posts", { posts: launchDraft.posts });
    /* Disconnect before approving */
    await testState.db.execute(sql`DELETE FROM social_accounts WHERE id = ${accountId}`);
    const r = await approve(u, "launch_posts");
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("NO_CONNECTED_ACCOUNTS");
    expect(await count("scheduled_posts")).toBe(0);
  });
});

describe("move home — owner scoping", () => {
  it("another member never sees, edits, or applies the caller's checklist", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await answers(a, ANSWERS);
    await draft(a);

    /* B's read is a fresh, empty checklist — none of A's data leaks. */
    const bView = await get(b);
    expect(bView.status).toBe(200);
    expect(bView.json.moveHome.answers).toEqual({});
    expect(bView.json.moveHome.drafts.profile).toBeUndefined();
    expect(bView.json.moveHome.steps.every((s: any) => s.status === "pending")).toBe(true);
    expect(bView.json.moveHome.context.hasProfile).toBe(false);

    /* B acting (draft, edit, approve) touches only B's own state. */
    await draft(b);
    const bDraft = (await get(b)).json.moveHome.drafts.profile;
    expect(bDraft.displayName).not.toBe(ANSWERS.displayName);
    expect(bDraft.slug).not.toBe(ANSWERS.handle);
    await approve(b, "profile");

    /* A is exactly where A left off: drafted, unapproved, A's words. */
    const aView = await get(a);
    expect(aView.json.moveHome.answers.displayName).toBe(ANSWERS.displayName);
    expect(aView.json.moveHome.drafts.profile.slug).toBe(ANSWERS.handle);
    expect(aView.json.moveHome.steps.find((s: any) => s.key === "profile").status).toBe("drafted");
    expect(aView.json.moveHome.context.hasProfile).toBe(false);

    /* And exactly one profile row exists — B's, keyed to B. */
    const profiles = await rows("creator_profiles");
    expect(profiles).toHaveLength(1);
    expect(profiles[0].user_id).toBe(b);
    expect(profiles[0].slug).not.toBe(ANSWERS.handle);
  });
});

describe("move home — locale path", () => {
  it("step titles render in the requested locale; no locale = English; pt-BR normalizes to pt", async () => {
    const u = randomUUID();
    const es = await call(u, "GET", "/api/move-home?locale=es");
    expect(es.status).toBe(200);
    expect(es.json.moveHome.steps.map((s: any) => s.title)).toEqual([
      "Tu perfil Grand Stage",
      "Tu tienda inicial",
      "Tu kit de prensa",
      "Tu lista de correo + bienvenida",
      "Tus publicaciones de lanzamiento",
    ]);
    const en = await get(u);
    expect(en.json.moveHome.steps[0].title).toBe("Your Grand Stage profile");
    const pt = await call(u, "GET", "/api/move-home?locale=pt-BR");
    expect(pt.json.moveHome.steps[0].title).toBe("Seu perfil Grand Stage");
    const unknown = await call(u, "GET", "/api/move-home?locale=xx");
    expect(unknown.json.moveHome.steps[0].title).toBe("Your Grand Stage profile");
  });

  it("a drafting pass composes in its locale; later reads re-render titles but never re-translate the drafts", async () => {
    const u = randomUUID();
    await answers(u, ANSWERS);
    const drafted = await call(u, "POST", "/api/move-home/draft?locale=es");
    expect(drafted.status).toBe(200);
    expect(drafted.json.moveHome.steps[0].title).toBe("Tu perfil Grand Stage");
    expect(drafted.json.moveHome.drafts.email_list.welcomeSubject).toBe(
      "Ya estás dentro: bienvenido al círculo interno de Nova Reign",
    );
    expect(drafted.json.moveHome.drafts.store.products[0].description).toContain(
      "edita esta descripción",
    );
    /* Read back in French: the chrome (step titles) renders French,
       the stored Spanish drafts stay Spanish — they are the creator's
       data now. */
    const fr = await call(u, "GET", "/api/move-home?locale=fr");
    expect(fr.json.moveHome.steps[0].title).toBe("Votre profil Grand Stage");
    expect(fr.json.moveHome.drafts.email_list.welcomeSubject).toBe(
      "Ya estás dentro: bienvenido al círculo interno de Nova Reign",
    );
  });
});
