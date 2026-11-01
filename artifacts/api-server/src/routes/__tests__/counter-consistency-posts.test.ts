/**
 * Counter consistency, round 2 (stack1100 lane X5) — post DELETE truth
 * in routes/social.ts, over pg-mem with DDL mirroring the real schema
 * (migration 0096: posts.reply_to is a plain REFERENCES — NO ACTION,
 * checked by Postgres when the deleting statement ends).
 *
 * THE DEFECTS pinned here:
 *  1. Deleting a reply never gave the count back: the parent's
 *     reply_count kept counting a reply that no longer exists.
 *  2. Deleting a repost never gave the count back: the original's
 *     repost_count kept counting a repost that no longer exists.
 *  3. A thread deeper than one level could not be deleted at all:
 *     the old handler deleted children in one statement and the post
 *     in a second, so the NO ACTION reply_to FK fired at the first
 *     statement's end whenever a reply had replies of its own (500).
 *
 * The fix: the whole reply subtree goes in ONE recursive statement
 * (the FK check passes because every referencing row is gone when it
 * runs), and the counters the deleted post moved on OTHER posts move
 * back, gated on the landed delete.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["SUPABASE_URL"] = "http://localhost";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test";
  return { db: null as any, mem: null as any };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));

vi.mock("../../lib/ai-clients", () => ({ getOpenAI: () => null, getTextModel: () => "gpt-test" }));
vi.mock("../../lib/live-ws", () => ({
  verifyAccessToken: (t: string) =>
    typeof t === "string" && t.startsWith("tok-") ? { userId: t.slice(4) } : null,
}));
vi.mock("../../lib/credits", () => ({
  chargeCredits: async () => ({ charged: 0 }),
  refundCredits: async () => {},
  OutOfCreditsError: class extends Error {},
  LedgerWriteError: class extends Error {},
}));
vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => {},
  addCreditsAtomic: async () => ({ oldCredits: 0, newCredits: 0, created: false }),
}));
vi.mock("../../lib/payment-record", () => ({ recordCreditUsageStrict: async () => {} }));
vi.mock("../../lib/social-crypto", () => ({
  encryptToken: (t: string) => t,
  decryptToken: (t: string) => t,
  isSocialTokenKeyConfigured: () => true,
}));
vi.mock("../../lib/social-meta", () => ({
  buildAuthUrl: () => "",
  buildFacebookAuthUrl: () => "",
  exchangeCodeForLongLivedToken: async () => ({}),
  exchangeFacebookCodeForLongLivedToken: async () => ({}),
  fetchInstagramProfile: async () => ({}),
  listPages: async () => [],
  publishReelToInstagram: async () => ({}),
  publishVideoToPage: async () => ({}),
  MetaApiError: class extends Error {},
}));
vi.mock("../../lib/social-idempotency", () => ({
  claimSocialAction: async () => ({ fresh: true }),
  nonceFromRequest: () => null,
  nonceMatches: () => true,
  releaseSocialAction: async () => {},
  reuseSocialResult: async () => null,
}));
vi.mock("../../lib/social-tiktok", () => ({
  buildTikTokAuthUrl: () => "",
  exchangeTikTokCode: async () => ({}),
  fetchTikTokProfile: async () => ({}),
  publishVideoToTikTok: async () => ({}),
  TikTokApiError: class extends Error {},
  isTikTokConfigured: () => false,
}));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: (u: any) => u,
  refreshSupabaseStorageUrlsDeep: (v: any) => v,
  isStorageRef: () => false,
}));
vi.mock("../../lib/mirrorMedia", () => ({ mirrorExternalMediaUrl: async (u: string) => u }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { createTestDb } from "../../lib/__tests__/test-db";

import socialRouter from "../social";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  bio text NOT NULL DEFAULT '', declared_city text, avatar_url text, banner_url text,
  theme_id text NOT NULL DEFAULT 'gold-lux', vertical text NOT NULL DEFAULT 'music',
  stream_schedule jsonb NOT NULL DEFAULT '[]', media_kit jsonb,
  theme_config jsonb NOT NULL DEFAULT '{}', sections jsonb NOT NULL DEFAULT '[]',
  layout_blocks jsonb NOT NULL DEFAULT '[]', pinned_kind text, pinned_item_id uuid,
  collection_visibility text NOT NULL DEFAULT 'public', featured_media jsonb,
  merch_items jsonb NOT NULL DEFAULT '[]', events jsonb NOT NULL DEFAULT '[]',
  series jsonb NOT NULL DEFAULT '[]', social_posts jsonb NOT NULL DEFAULT '[]',
  social_links jsonb NOT NULL DEFAULT '{}', top_creators jsonb NOT NULL DEFAULT '[]',
  tip_jar_enabled boolean NOT NULL DEFAULT true,
  meta_pixel_id text, tiktok_pixel_id text, google_tag_id text, ai_design jsonb,
  is_public boolean NOT NULL DEFAULT true, is_verified boolean NOT NULL DEFAULT false,
  is_official boolean NOT NULL DEFAULT false,
  follower_count integer NOT NULL DEFAULT 0, total_plays integer NOT NULL DEFAULT 0,
  stripe_connect_account_id text,
  stripe_connect_onboarded boolean NOT NULL DEFAULT false,
  stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
  stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE posts (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  body text NOT NULL, media_urls jsonb NOT NULL DEFAULT '[]',
  kind text NOT NULL DEFAULT 'post',
  reply_to uuid REFERENCES posts(id), quote_of uuid REFERENCES posts(id), repost_of uuid REFERENCES posts(id),
  group_id uuid, scheduled_for timestamptz, audience text NOT NULL DEFAULT 'public',
  min_tier_id uuid, content_warnings jsonb NOT NULL DEFAULT '[]',
  like_count integer NOT NULL DEFAULT 0, repost_count integer NOT NULL DEFAULT 0,
  reply_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz, removed_by_email text, removal_reason text, removal_note text);
`;

const AUTHOR = "00000000-0000-4000-8000-0000000000a1";
const AUTHOR_PROFILE = "11111111-1111-4111-8111-1111111111a1";
const OTHER = "00000000-0000-4000-8000-0000000000b1";
const OTHER_PROFILE = "11111111-1111-4111-8111-1111111111b1";

const PARENT = "22222222-2222-4222-8222-222222222201";
const REPLY = "22222222-2222-4222-8222-222222222202";
const ORIGINAL = "22222222-2222-4222-8222-222222222203";
const REPOST = "22222222-2222-4222-8222-222222222204";
const ROOT = "22222222-2222-4222-8222-222222222205";
const LEVEL1 = "22222222-2222-4222-8222-222222222206";
const LEVEL2 = "22222222-2222-4222-8222-222222222207";
const LEVEL3 = "22222222-2222-4222-8222-222222222208";

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", socialRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function q(sqlText: string): any[] {
  return h.mem.public.many(sqlText);
}

beforeEach(() => {
  const t = createTestDb();
  h.db = t.db;
  h.mem = t.mem;
  h.mem.public.none(DDL);
  h.mem.public.none(`
    INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES
      ('${AUTHOR_PROFILE}', '${AUTHOR}', 'author', 'Author'),
      ('${OTHER_PROFILE}', '${OTHER}', 'other', 'Other');
  `);
});

async function call(method: string, path: string, user?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("DELETE /posts/:id — counter give-backs (stack1100 X5)", () => {
  it("deleting a reply returns the parent's reply_count to the standing rows", async () => {
    h.mem.public.none(`
      INSERT INTO posts (id, profile_id, body, kind, reply_count) VALUES ('${PARENT}', '${AUTHOR_PROFILE}', 'parent', 'post', 1);
      INSERT INTO posts (id, profile_id, body, kind, reply_to) VALUES ('${REPLY}', '${OTHER_PROFILE}', 'a reply', 'thread_reply', '${PARENT}');
    `);
    const res = await call("DELETE", `/posts/${REPLY}`, OTHER);
    expect(res.status).toBe(200);
    expect(q(`SELECT * FROM posts WHERE id = '${REPLY}';`)).toHaveLength(0);
    const parent = q(`SELECT reply_count FROM posts WHERE id = '${PARENT}';`);
    expect(parent[0].reply_count).toBe(0);
    // Reconciliation: the count equals the reply rows that stand.
    expect(q(`SELECT * FROM posts WHERE reply_to = '${PARENT}';`)).toHaveLength(0);
  });

  it("deleting a repost returns the original's repost_count to the standing rows", async () => {
    h.mem.public.none(`
      INSERT INTO posts (id, profile_id, body, kind, repost_count) VALUES ('${ORIGINAL}', '${AUTHOR_PROFILE}', 'original', 'post', 1);
      INSERT INTO posts (id, profile_id, body, kind, repost_of) VALUES ('${REPOST}', '${OTHER_PROFILE}', '', 'repost', '${ORIGINAL}');
    `);
    const res = await call("DELETE", `/posts/${REPOST}`, OTHER);
    expect(res.status).toBe(200);
    expect(q(`SELECT * FROM posts WHERE id = '${REPOST}';`)).toHaveLength(0);
    const orig = q(`SELECT repost_count FROM posts WHERE id = '${ORIGINAL}';`);
    expect(orig[0].repost_count).toBe(0);
    expect(q(`SELECT * FROM posts WHERE repost_of = '${ORIGINAL}';`)).toHaveLength(0);
  });

  it("deleting a thread deeper than one level lands in one piece (NO ACTION reply_to FK)", async () => {
    h.mem.public.none(`
      INSERT INTO posts (id, profile_id, body, kind, reply_count) VALUES ('${ROOT}', '${AUTHOR_PROFILE}', 'root', 'post', 1);
      INSERT INTO posts (id, profile_id, body, kind, reply_to, reply_count) VALUES ('${LEVEL1}', '${OTHER_PROFILE}', 'l1', 'thread_reply', '${ROOT}', 1);
      INSERT INTO posts (id, profile_id, body, kind, reply_to, reply_count) VALUES ('${LEVEL2}', '${AUTHOR_PROFILE}', 'l2', 'thread_reply', '${LEVEL1}', 1);
      INSERT INTO posts (id, profile_id, body, kind, reply_to) VALUES ('${LEVEL3}', '${OTHER_PROFILE}', 'l3', 'thread_reply', '${LEVEL2}');
    `);
    const res = await call("DELETE", `/posts/${ROOT}`, AUTHOR);
    expect(res.status).toBe(200);
    expect(q(`SELECT * FROM posts;`)).toHaveLength(0);
  });

  it("a plain post delete moves no other post's counters; a stranger's delete moves nothing", async () => {
    h.mem.public.none(`
      INSERT INTO posts (id, profile_id, body, kind, reply_count, repost_count) VALUES ('${PARENT}', '${AUTHOR_PROFILE}', 'parent', 'post', 3, 2);
      INSERT INTO posts (id, profile_id, body, kind) VALUES ('${ORIGINAL}', '${AUTHOR_PROFILE}', 'plain', 'post');
    `);
    const denied = await call("DELETE", `/posts/${ORIGINAL}`, OTHER);
    expect(denied.status).toBe(404);
    const res = await call("DELETE", `/posts/${ORIGINAL}`, AUTHOR);
    expect(res.status).toBe(200);
    const parent = q(`SELECT reply_count, repost_count FROM posts WHERE id = '${PARENT}';`);
    expect(parent[0].reply_count).toBe(3);
    expect(parent[0].repost_count).toBe(2);
  });
});
