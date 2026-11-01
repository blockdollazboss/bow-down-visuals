/**
 * Counter consistency, round 2 (stack1100 lane X5) — POST /play in
 * routes/discovery.ts (the door its own header calls the canonical
 * play logger), over pg-mem.
 *
 * TWO DEFECTS:
 *  1. The play_events row landed UNCONDITIONALLY — events piled up
 *     for media that doesn't exist and for unpublished uploads whose
 *     counters (correctly) never moved, so the event stream and the
 *     counts disagreed by construction. The media play door 404s the
 *     same request. Now the media is resolved first: a play that
 *     can't count doesn't land; one that lands moves the event row,
 *     the media counter, and the profile total together.
 *  2. The minting bound was 120 counted plays per minute per IP with
 *     no per-media key — 120× the house standard the sibling door
 *     states (1 per IP per media per 60s) — and plays feed the
 *     charts. The limiter now keys per (IP, kind, media) at the
 *     house bound; a radio sequence is unaffected since each next
 *     track is a new key.
 *
 * JOIN COMPOSITION (stack1100 join, X5 x X3): on the joined tree the
 * per-media bound is enforced by the shared claim in lib/play-counting
 * (X3) rather than by this door's middleware, and refused plays answer
 * 200 with counted:false instead of 404/429. Every conviction above is
 * preserved — nothing lands that can't count, and what lands moves
 * together; the three expectations that named the old status codes
 * carry their own composition notes inline.
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

const PROFILE = "11111111-1111-4111-8111-1111111111a1";
// JOIN COMPOSITION (stack1100 join, X5 x X3): the composed handler
// reads creator_profiles.user_id for X3's self-play check, so this
// fixture carries the column and an owner id (this suite plays
// anonymously, so no play here is a self-play).
const PROFILE_OWNER = "99999999-9999-4999-8999-9999999999a9";
const TRACK_A = "22222222-2222-4222-8222-2222222222b1";
const TRACK_B = "22222222-2222-4222-8222-2222222222b2";
const TRACK_C = "22222222-2222-4222-8222-2222222222b5";
const TRACK_D = "22222222-2222-4222-8222-2222222222b6";
const TRACK_UNPUB = "22222222-2222-4222-8222-2222222222b3";
const VIDEO_A = "22222222-2222-4222-8222-2222222222b4";
const GONE = "22222222-2222-4222-8222-2222222222b9";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  feedLimiter: (_req: any, _res: any, next: any) => next(),
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
import discoveryRouter from "../discovery";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid, total_plays integer NOT NULL DEFAULT 0);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL,
  play_count integer NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT false);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL,
  view_count integer NOT NULL DEFAULT 0, is_published boolean NOT NULL DEFAULT false);
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
  app.use("/api/discovery", discoveryRouter);
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
  h.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  h.mem.public.none(DDL);
  h.mem.public.none(`
    INSERT INTO creator_profiles (id, user_id, total_plays) VALUES ('${PROFILE}', '${PROFILE_OWNER}', 0);
    INSERT INTO profile_tracks (id, profile_id, is_published) VALUES
      ('${TRACK_A}', '${PROFILE}', true),
      ('${TRACK_B}', '${PROFILE}', true),
      ('${TRACK_C}', '${PROFILE}', true),
      ('${TRACK_D}', '${PROFILE}', true),
      ('${TRACK_UNPUB}', '${PROFILE}', false);
    INSERT INTO profile_videos (id, profile_id, is_published) VALUES ('${VIDEO_A}', '${PROFILE}', true);
  `);
});

async function play(kind: string, mediaId: string) {
  const res = await fetch(`${base}/discovery/play`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, mediaId }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe("POST /discovery/play — row and counters move together, at the house bound (stack1100 X5)", () => {
  it("a published track play lands the event, the count, and the total at once", async () => {
    const res = await play("track", TRACK_A);
    expect(res.status).toBe(200);
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(1);
    expect(q(`SELECT play_count FROM profile_tracks WHERE id = '${TRACK_A}';`)[0].play_count).toBe(1);
    expect(q(`SELECT total_plays FROM creator_profiles WHERE id = '${PROFILE}';`)[0].total_plays).toBe(1);
  });

  it("a replay inside the window is refused and mints nothing more", async () => {
    // Own media id: the limiter store is process-level (as in
    // production), so each test plays its own track.
    // JOIN COMPOSITION (stack1100 join, X5 x X3): this lane originally
    // enforced the bound in the rate-limit middleware, so the replay
    // died as a 429. The joined tree enforces the same bound through
    // the shared claim (lib/play-counting) in the handler — X3's
    // contract — so the replay answers 200 with counted:false and, as
    // this lane convicted, mints nothing more (rows asserted below).
    expect((await play("track", TRACK_B)).status).toBe(200);
    const replay = await play("track", TRACK_B);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ ok: true, counted: false });
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(1);
    expect(q(`SELECT play_count FROM profile_tracks WHERE id = '${TRACK_B}';`)[0].play_count).toBe(1);
  });

  it("the next track in a sequence still counts (the bound is per media, not per listener)", async () => {
    expect((await play("track", TRACK_C)).status).toBe(200);
    expect((await play("track", TRACK_D)).status).toBe(200);
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(2);
    expect(q(`SELECT total_plays FROM creator_profiles WHERE id = '${PROFILE}';`)[0].total_plays).toBe(2);
  });

  it("an unpublished track play is refused and leaves no event row behind", async () => {
    // JOIN COMPOSITION (stack1100 join, X5 x X3): this lane answered
    // 404 here; the joined tree answers 200 with counted:false (X3's
    // contract — the play itself always plays, the count is what is
    // refused). The conviction stands untouched: no event row, no
    // counter movement, asserted below.
    const res = await play("track", TRACK_UNPUB);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, counted: false });
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(0);
    expect(q(`SELECT play_count FROM profile_tracks WHERE id = '${TRACK_UNPUB}';`)[0].play_count).toBe(0);
    expect(q(`SELECT total_plays FROM creator_profiles WHERE id = '${PROFILE}';`)[0].total_plays).toBe(0);
  });

  it("a play for media that doesn't exist is refused and leaves no event row behind", async () => {
    // JOIN COMPOSITION (stack1100 join, X5 x X3): same adjudication
    // as the unpublished case above — 200 with counted:false on the
    // joined tree; the no-row conviction below is unchanged. (The
    // media door in creator-platform still 404s missing media; that
    // door's contract was never in dispute.)
    const res = await play("track", GONE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, counted: false });
    expect(q(`SELECT * FROM play_events;`)).toHaveLength(0);
  });

  it("a published video play moves view_count and the total together", async () => {
    const res = await play("video", VIDEO_A);
    expect(res.status).toBe(200);
    expect(q(`SELECT * FROM play_events WHERE kind = 'video';`)).toHaveLength(1);
    expect(q(`SELECT view_count FROM profile_videos WHERE id = '${VIDEO_A}';`)[0].view_count).toBe(1);
    expect(q(`SELECT total_plays FROM creator_profiles WHERE id = '${PROFILE}';`)[0].total_plays).toBe(1);
  });
});
