/**
 * Counter consistency, round 2 (stack1100 lane X5) — challenge
 * total_views in routes/challenge-engine.ts (+ the shorts hashtag
 * hub that shapes the same DTO), over pg-mem.
 *
 * THE DEFECT: challenges.total_views is a stored column with NO
 * writer anywhere in the codebase. Every challenge read rendered it
 * as fact — the challenge page shows "{total_views} views" — and it
 * sat at 0 forever, however many views the entries had gathered.
 *
 * THE FIX: total_views is derived at read from the row truth — the
 * standing entries' own view_count summed from profile_videos
 * (totalViewsByChallenge) — on every surface that shapes it:
 * GET /challenges/trending, GET /challenges/:slug, and the hashtag
 * hub's challenge cards in shorts.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => {
  process.env["DATABASE_URL"] = "postgres://test:test@localhost:5432/test";
  process.env["SUPABASE_URL"] = "http://localhost";
  process.env["SUPABASE_ANON_KEY"] = "test-anon";
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = "test";
  return { db: null as any, mem: null as any };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
    next();
  },
}));
vi.mock("../admin", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => {},
  addCreditsAtomic: async () => ({ oldCredits: 0, newCredits: 0, created: false }),
}));
vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));
vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (u: string | null) => u ?? null,
}));
vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: (u: any) => u,
  refreshSupabaseStorageUrlsDeep: async (x: unknown) => x,
  isStorageRef: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { createTestDb } from "../../lib/__tests__/test-db";
import challengeEngineRouter, { totalViewsByChallenge } from "../challenge-engine";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, slug text, display_name text, avatar_url text);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid, title text, video_url text, thumbnail_url text,
  view_count integer NOT NULL DEFAULT 0, like_count integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE challenges (
  id uuid PRIMARY KEY, slug text NOT NULL, title text NOT NULL, description text NOT NULL DEFAULT '',
  hashtag text NOT NULL, cover_url text, creator_profile_id uuid,
  prize_text text NOT NULL DEFAULT '', entry_count integer NOT NULL DEFAULT 0,
  total_views integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'live',
  starts_at timestamptz, ends_at timestamptz, judging_ends_at timestamptz,
  prize_pool_credits integer NOT NULL DEFAULT 0,
  is_weekly boolean NOT NULL DEFAULT false, week_key text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE challenge_entries (
  challenge_id uuid NOT NULL, video_id uuid NOT NULL,
  vote_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, video_id));
CREATE TABLE challenge_votes (
  id uuid PRIMARY KEY, challenge_id uuid NOT NULL, video_id uuid NOT NULL,
  user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE challenge_prizes (
  id uuid PRIMARY KEY, challenge_id uuid NOT NULL, place integer NOT NULL,
  prize_credits integer NOT NULL, description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE challenge_winners (id uuid PRIMARY KEY, challenge_id uuid NOT NULL);
`;

const PROFILE = "11111111-1111-4111-8111-1111111111a1";
const CH1 = "33333333-3333-4333-8333-333333333301";
const CH2 = "33333333-3333-4333-8333-333333333302";
const CH3 = "33333333-3333-4333-8333-333333333303";
const V1 = "22222222-2222-4222-8222-222222222201";
const V2 = "22222222-2222-4222-8222-222222222202";
const V3 = "22222222-2222-4222-8222-222222222203";

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", challengeEngineRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  const t = createTestDb();
  h.db = t.db;
  h.mem = t.mem;
  h.mem.public.none(DDL);
  // The stored total_views column is 0 everywhere (nothing ever wrote
  // it). The row truth: CH1's entries carry 120 + 30 views; CH2's one
  // entry carries 7; CH3 has no entries.
  h.mem.public.none(`
    INSERT INTO creator_profiles (id, slug, display_name) VALUES ('${PROFILE}', 'author', 'Author');
    INSERT INTO profile_videos (id, profile_id, title, video_url, view_count) VALUES
      ('${V1}', '${PROFILE}', 'one', 'https://x/1.mp4', 120),
      ('${V2}', '${PROFILE}', 'two', 'https://x/2.mp4', 30),
      ('${V3}', '${PROFILE}', 'three', 'https://x/3.mp4', 7);
    INSERT INTO challenges (id, slug, title, hashtag, entry_count, total_views) VALUES
      ('${CH1}', 'big-one', 'Big One', 'bigone', 2, 0),
      ('${CH2}', 'small-one', 'Small One', 'smallone', 1, 0),
      ('${CH3}', 'empty-one', 'Empty One', 'emptyone', 0, 0);
    INSERT INTO challenge_entries (challenge_id, video_id) VALUES
      ('${CH1}', '${V1}'), ('${CH1}', '${V2}'), ('${CH2}', '${V3}');
  `);
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("challenge total_views — derived from the entries' rows (stack1100 X5)", () => {
  it("the helper sums standing entries' view counts, per challenge", async () => {
    const totals = await totalViewsByChallenge([CH1, CH2, CH3]);
    expect(totals.get(CH1)).toBe(150);
    expect(totals.get(CH2)).toBe(7);
    expect(totals.get(CH3) ?? 0).toBe(0);
    expect(await totalViewsByChallenge([])).toEqual(new Map());
  });

  it("GET /challenges/trending reports the derived totals, not the dead column", async () => {
    const res = await get("/challenges/trending");
    expect(res.status).toBe(200);
    const bySlug = new Map(res.body.challenges.map((c: any) => [c.slug, c]));
    expect(bySlug.get("big-one").total_views).toBe(150);
    expect(bySlug.get("small-one").total_views).toBe(7);
    expect(bySlug.get("empty-one").total_views).toBe(0);
    // entry_count rides along unchanged (its own doors keep it true).
    expect(bySlug.get("big-one").entry_count).toBe(2);
  });

  it("GET /challenges/:slug reports the derived total on the detail shape", async () => {
    const res = await get("/challenges/big-one");
    expect(res.status).toBe(200);
    expect(res.body.challenge.total_views).toBe(150);
    expect(res.body.challenge.entry_count).toBe(2);
    expect(res.body.entries).toHaveLength(2);
  });

  it("the derived total moves with the rows: a deleted entry's views leave the sum", async () => {
    h.mem.public.none(`DELETE FROM challenge_entries WHERE video_id = '${V1}';`);
    const res = await get("/challenges/big-one");
    expect(res.status).toBe(200);
    expect(res.body.challenge.total_views).toBe(30);
  });
});
