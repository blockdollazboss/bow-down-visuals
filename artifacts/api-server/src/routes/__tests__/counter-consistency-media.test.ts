/**
 * Counter consistency, round 2 (stack1100 lane X5) — the media play
 * door and the unfollow response in routes/creator-platform.ts,
 * over pg-mem.
 *
 * TWO DEFECTS:
 *  1. POST /media/:kind/:id/play counted plays on UNPUBLISHED media
 *     (counter + play_events row + the profile's total_plays), while
 *     the discovery /play door refused to count unpublished media at
 *     all — the same play landed or not depending on the door. The
 *     owner's own preview of an unpublished upload is not an audience
 *     play. Now this door answers with the standing count and moves
 *     nothing.
 *  2. DELETE /profiles/:slug/follow computed its RESPONSE count by
 *     decrementing unconditionally — a replayed unfollow (or one from
 *     someone who never followed) reported a follower who was never
 *     there vanishing. The stored count correctly rode the landed
 *     delete; now the response does too.
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

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const TARGET_USER = "00000000-0000-4000-8000-0000000000c1";
const FOLLOWER = "00000000-0000-4000-8000-0000000000d1";
const STRANGER = "00000000-0000-4000-8000-0000000000e1";
const TARGET = "11111111-1111-4111-8111-1111111111c1";
const TRACK_PUB = "22222222-2222-4222-8222-2222222222a1";
const TRACK_UNPUB = "22222222-2222-4222-8222-2222222222a2";
const TRACK_GONE = "22222222-2222-4222-8222-2222222222a9";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));
vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));
vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));
vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));
vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => {},
  addCreditsAtomic: async () => ({ oldCredits: 0, newCredits: 0, created: false }),
  deductCreditsAtomic: async () => ({ ok: true }),
}));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: (u: any) => u,
  refreshSupabaseStorageUrlsDeep: (v: any) => v,
  isStorageRef: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { createTestDb } from "../../lib/__tests__/test-db";
import { DataType } from "pg-mem";
import { randomUUID } from "node:crypto";
import creatorPlatformRouter from "../creator-platform";

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
CREATE TABLE follows (
  follower_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, profile_id));
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, audio_url text NOT NULL,
  artwork_url text, genre text, tags text[], isrc text,
  duration_sec integer NOT NULL DEFAULT 0, download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  play_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL, video_url text NOT NULL,
  thumbnail_url text, thumbnail_alt_text text, description text NOT NULL DEFAULT '',
  genre text, tags text[], duration_sec integer NOT NULL DEFAULT 0,
  season integer, episode integer, sound_track_id uuid,
  download_price_cents integer NOT NULL DEFAULT 0,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  repost_count integer NOT NULL DEFAULT 0, comment_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT false, is_short boolean NOT NULL DEFAULT false,
  duet_with uuid, stitch_with uuid, duets_enabled boolean NOT NULL DEFAULT true,
  king_featured_at timestamptz, sound_id text, sound_title text, sound_url text,
  sound_use_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE play_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, media_id uuid NOT NULL,
  user_id uuid, source text, played_at timestamptz NOT NULL DEFAULT now());
`;

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api/creator-platform", creatorPlatformRouter);
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
  // pg-mem ships almost no native functions; play_events.id defaults
  // to gen_random_uuid() in the real schema.
  h.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  h.mem.public.none(DDL);
  h.mem.public.none(`
    INSERT INTO creator_profiles (id, user_id, slug, display_name, follower_count, total_plays)
    VALUES ('${TARGET}', '${TARGET_USER}', 'target', 'Target', 3, 10);
    INSERT INTO follows (follower_user_id, profile_id) VALUES ('${FOLLOWER}', '${TARGET}');
    INSERT INTO profile_tracks (id, profile_id, title, audio_url, play_count, is_published) VALUES
      ('${TRACK_PUB}', '${TARGET}', 'Live One', 'https://x/a.mp3', 5, true),
      ('${TRACK_UNPUB}', '${TARGET}', 'Draft One', 'https://x/b.mp3', 2, false);
  `);
});

async function call(method: string, path: string, user?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("POST /media/:kind/:id/play — unpublished plays never count (stack1100 X5)", () => {
  it("an unpublished track play answers with the standing count and records nothing", async () => {
    const res = await call("POST", `/creator-platform/media/track/${TRACK_UNPUB}/play`, OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, plays: 2 });
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(0);
    expect(q(`SELECT play_count FROM profile_tracks WHERE id = '${TRACK_UNPUB}';`)[0].play_count).toBe(2);
    expect(q(`SELECT total_plays FROM creator_profiles WHERE id = '${TARGET}';`)[0].total_plays).toBe(10);
  });

  it("a published track play still lands all three records together", async () => {
    // JOIN COMPOSITION (stack1100 join, X5 x X3): this case originally
    // played as the OWNER. X3 convicted the self-play on this door —
    // the owner playing their own upload never counts (the self-follow
    // rule's play twin) — so the landing this case pins (row + counter
    // + total moving together on a published play) is exercised as a
    // follower instead; the assertions are unchanged.
    const res = await call("POST", `/creator-platform/media/track/${TRACK_PUB}/play`, FOLLOWER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, plays: 6 });
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(1);
    expect(q(`SELECT play_count FROM profile_tracks WHERE id = '${TRACK_PUB}';`)[0].play_count).toBe(6);
    expect(q(`SELECT total_plays FROM creator_profiles WHERE id = '${TARGET}';`)[0].total_plays).toBe(11);
  });

  it("a missing track still 404s and records nothing", async () => {
    const res = await call("POST", `/creator-platform/media/track/${TRACK_GONE}/play`, OWNER);
    expect(res.status).toBe(404);
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(0);
  });
});

describe("DELETE /creator-profiles/:id/unfollow — the response count rides the landed delete (stack1100 X5)", () => {
  it("a stranger's unfollow reports the standing count and changes nothing", async () => {
    const res = await call("DELETE", `/creator-platform/creator-profiles/${TARGET}/unfollow`, STRANGER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ followed: false, follower_count: 3 });
    expect(q(`SELECT follower_count FROM creator_profiles WHERE id = '${TARGET}';`)[0].follower_count).toBe(3);
    expect(q(`SELECT * FROM follows;`)).toHaveLength(1);
  });

  it("a real unfollow moves both counts once — and a replay moves neither", async () => {
    const first = await call("DELETE", `/creator-platform/creator-profiles/${TARGET}/unfollow`, FOLLOWER);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ followed: false, follower_count: 2 });
    expect(q(`SELECT follower_count FROM creator_profiles WHERE id = '${TARGET}';`)[0].follower_count).toBe(2);
    expect(q(`SELECT * FROM follows;`)).toHaveLength(0);

    const replay = await call("DELETE", `/creator-platform/creator-profiles/${TARGET}/unfollow`, FOLLOWER);
    expect(replay.status).toBe(200);
    // The pre-fix response decremented again here (2 in the store, 1 on screen).
    expect(replay.body).toMatchObject({ followed: false, follower_count: 2 });
    expect(q(`SELECT follower_count FROM creator_profiles WHERE id = '${TARGET}';`)[0].follower_count).toBe(2);
  });
});
