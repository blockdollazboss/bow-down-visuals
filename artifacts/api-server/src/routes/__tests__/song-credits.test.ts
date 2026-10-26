/**
 * Song credits that travel with the song (Stack-200 N1) — routes.
 *
 * Pins:
 *  - ONE canonical read serves two surfaces identically: the library
 *    song (GET /song-credits/song/:id) and its release
 *    (GET /song-credits/release/:id) — the release shows the SAME
 *    writers/entries inherited from the song, plus its own master
 *    splits and frozen co-release shares merged per person;
 *  - the canonical write delegates writer shares to the EXISTING
 *    publishing registry through validateWriterSplits: a 90% sum is a
 *    400 split_sum and writes NOTHING; a valid save lands in
 *    publishing_split_writers (no second splits store);
 *  - ownership: writing credits for someone else's song is a 404;
 *  - every save appends an audit revision (history is owner-only);
 *  - a legacy song with no records and no owner profile renders an
 *    honest empty credits list — no invented names;
 *  - pre-migration honesty: writes answer 503 song_credits_not_ready,
 *    reads still serve the splits rails that DO exist.
 *
 * Harness: the real router over an ephemeral server against pg-mem,
 * house style of publishing-splits.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  withCreditTables: true,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = 1000;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

import router from "../song-credits";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const WORLD_DDL = `
CREATE TABLE songs (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, parent_song_id uuid
);
CREATE TABLE distribution_releases (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL, artist_name text, song_id uuid
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text
);
CREATE TABLE publishing_split_registrations (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'release', song_id uuid NOT NULL,
  song_title text NOT NULL DEFAULT '', has_dispute boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE publishing_split_writers (
  id uuid PRIMARY KEY, registration_id uuid NOT NULL, writer_name text NOT NULL,
  writer_user_id uuid, writer_profile_id uuid, share_pct numeric(5,2) NOT NULL,
  confirmation_status text NOT NULL DEFAULT 'pending', dispute_note text,
  confirmed_at timestamptz, disputed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE distribution_royalty_splits (
  id uuid PRIMARY KEY, release_id uuid NOT NULL, user_id uuid,
  payee_name text NOT NULL, role text, share_pct numeric(5,2) NOT NULL,
  superseded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE co_releases (
  id uuid PRIMARY KEY, item_kind text NOT NULL, item_id uuid NOT NULL,
  published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE co_release_sides (
  id uuid PRIMARY KEY, co_release_id uuid NOT NULL,
  profile_id uuid NOT NULL, user_id uuid NOT NULL,
  share_pct numeric(5,2) NOT NULL, agreed_share_pct numeric(5,2)
);`;

const CREDITS_DDL = `
CREATE TABLE song_credit_entries (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'song', song_id uuid NOT NULL,
  role text NOT NULL, display_name text NOT NULL,
  credit_user_id uuid, credit_profile_id uuid, detail text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE song_credit_revisions (
  id uuid PRIMARY KEY, owner_user_id uuid NOT NULL,
  song_kind text NOT NULL DEFAULT 'song', song_id uuid NOT NULL,
  version integer NOT NULL, snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);`;

const OWNER = randomUUID();
const CO = randomUUID();
const NO_PROFILE_USER = randomUUID();
const OWNER_PROFILE = randomUUID();
const CO_PROFILE = randomUUID();

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let songId: string;
let releaseId: string;
let legacySongId: string;
let foreignSongId: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function seedWorld(withCredits: boolean) {
  const { db, mem } = createTestDb();
  mem.public.none(WORLD_DDL);
  if (withCredits) mem.public.none(CREDITS_DDL);
  testState.db = db;
  testState.userId = OWNER;
  songId = randomUUID();
  releaseId = randomUUID();
  legacySongId = randomUUID();
  foreignSongId = randomUUID();
  await db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES
      (${OWNER_PROFILE}, ${OWNER}, 'thy-cheat-code', 'Thy Cheat Code'),
      (${CO_PROFILE}, ${CO}, 'co-writer', 'Co Writer')
  `);
  await db.execute(sql`
    INSERT INTO songs (id, user_id, title) VALUES
      (${songId}, ${OWNER}, 'Midnight Tide'),
      (${legacySongId}, ${NO_PROFILE_USER}, 'Old Upload'),
      (${foreignSongId}, ${CO}, 'Not Yours')
  `);
  await db.execute(sql`
    INSERT INTO distribution_releases (id, user_id, title, artist_name, song_id) VALUES
      (${releaseId}, ${OWNER}, 'Midnight Tide', 'Thy Cheat Code', ${songId})
  `);
  /* Current master split at 70% + a superseded 50% version that must
     never surface as a credit. */
  await db.execute(sql`
    INSERT INTO distribution_royalty_splits (id, release_id, payee_name, share_pct) VALUES
      (${randomUUID()}, ${releaseId}, 'Thy Cheat Code', 70),
      (${randomUUID()}, ${releaseId}, 'Thy Cheat Code', 50)
  `);
  await db.execute(sql`
    UPDATE distribution_royalty_splits SET superseded_at = now() WHERE share_pct = 50
  `);
  /* A published co-release on the release: agreed shares frozen 50/50. */
  const coReleaseId = randomUUID();
  await db.execute(sql`
    INSERT INTO co_releases (id, item_kind, item_id, published_at) VALUES
      (${coReleaseId}, 'release', ${releaseId}, now())
  `);
  await db.execute(sql`
    INSERT INTO co_release_sides (id, co_release_id, profile_id, user_id, share_pct, agreed_share_pct) VALUES
      (${randomUUID()}, ${coReleaseId}, ${OWNER_PROFILE}, ${OWNER}, 50, 50),
      (${randomUUID()}, ${coReleaseId}, ${CO_PROFILE}, ${CO}, 50, 50)
  `);
}

beforeEach(async () => {
  await seedWorld(testState.withCreditTables);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function as(userId: string, method: string, path: string, body?: unknown) {
  testState.userId = userId;
  return req(method, path, body);
}

const SAVE_BODY = () => ({
  writers: [
    { name: "Thy Cheat Code", profile_id: OWNER_PROFILE, share_pct: 60 },
    { name: "Co Writer", profile_id: CO_PROFILE, share_pct: 40 },
  ],
  entries: [
    { role: "producer", name: "Co Writer", profile_id: CO_PROFILE },
    { role: "sample", name: "Sample", detail: "Blue Tide — The Harbour Band" },
  ],
});

describe("PUT /song-credits — canonical write through the existing rails", () => {
  it("saves writers into the publishing registry (validated) and entries onto the song, versioned", async () => {
    const { status, json } = await as(OWNER, "PUT", `/song-credits/song/${songId}`, SAVE_BODY());
    expect(status).toBe(200);
    expect(json.version).toBe(1);
    /* Writers live in the EXISTING registry — no second splits store. */
    const writers = await testState.db.execute(sql`SELECT writer_name, share_pct FROM publishing_split_writers`);
    expect(writers.rows).toHaveLength(2);
    const credits = json.credits.credits as any[];
    const co = credits.find((c: any) => c.name === "Co Writer");
    expect(co.roles).toContain("writer");
    expect(co.roles).toContain("producer");
    expect(co.profile_path).toBe("/artist/co-writer");
    expect(co.shares).toContainEqual({ source: "publishing", pct: 40 });
    const sample = credits.find((c: any) => c.roles.includes("sample"));
    expect(sample.detail).toBe("Blue Tide — The Harbour Band");
  });

  it("refuses a writer split that doesn't sum to 100 and writes nothing", async () => {
    const body = SAVE_BODY();
    body.writers[1]!.share_pct = 30;
    const { status, json } = await as(OWNER, "PUT", `/song-credits/song/${songId}`, body);
    expect(status).toBe(400);
    expect(json.error).toBe("split_sum");
    expect(json.message).toContain("90.00%");
    const writers = await testState.db.execute(sql`SELECT id FROM publishing_split_writers`);
    expect(writers.rows).toHaveLength(0);
    const entries = await testState.db.execute(sql`SELECT id FROM song_credit_entries`);
    expect(entries.rows).toHaveLength(0);
  });

  it("refuses a sample with no declared source, and credits on someone else's song (404)", async () => {
    const bad = await as(OWNER, "PUT", `/song-credits/song/${songId}`, {
      entries: [{ role: "sample", name: "Sample" }],
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("sample_detail");
    const foreign = await as(OWNER, "PUT", `/song-credits/song/${foreignSongId}`, SAVE_BODY());
    expect(foreign.status).toBe(404);
  });

  it("appends an audit revision per save; history is the owner's only", async () => {
    await as(OWNER, "PUT", `/song-credits/song/${songId}`, SAVE_BODY());
    const second = await as(OWNER, "PUT", `/song-credits/song/${songId}`, {
      entries: [{ role: "engineer", name: "Co Writer", profile_id: CO_PROFILE }],
    });
    expect(second.json.version).toBe(2);
    const history = await as(OWNER, "GET", `/song-credits/song/${songId}/history`);
    expect(history.status).toBe(200);
    expect(history.json.revisions.map((r: any) => r.version)).toEqual([2, 1]);
    const stranger = await as(CO, "GET", `/song-credits/song/${songId}/history`);
    expect(stranger.status).toBe(404);
  });
});

describe("GET /song-credits — the same credits on every surface", () => {
  it("the release surface inherits the song's credits and merges its own master + co-release shares", async () => {
    await as(OWNER, "PUT", `/song-credits/song/${songId}`, SAVE_BODY());
    const { status, json } = await req("GET", `/song-credits/release/${releaseId}`);
    expect(status).toBe(200);
    const credits = json.credits.credits as any[];
    const owner = credits.find((c: any) => c.name === "Thy Cheat Code");
    /* Writer share travelled from the song; master share is the
       release's own CURRENT version (70, never the superseded 50);
       co-release share is the frozen agreed 50. Per-rail, unblended. */
    /* The owner is credited directly on the release (artist/master/
       co-release), so the person is not labelled inherited — but their
       songwriter share travelled up from the song and merged in. */
    expect(owner.inherited).toBe(false);
    expect(owner.shares).toContainEqual({ source: "publishing", pct: 60 });
    const sample = credits.find((c: any) => c.roles.includes("sample"));
    expect(sample.inherited).toBe(true);
    expect(owner.shares).toContainEqual({ source: "master", pct: 70 });
    expect(owner.shares).not.toContainEqual({ source: "master", pct: 50 });
    expect(owner.shares).toContainEqual({ source: "co_release", pct: 50, frozen: true });
    const co = credits.find((c: any) => c.name === "Co Writer");
    expect(co.roles).toContain("producer");
    expect(co.shares).toContainEqual({ source: "co_release", pct: 50, frozen: true });
    expect(json.credits.writer_splits_valid).toBe(true);
    expect(json.sheet_text).toContain("60.00% publishing");
    /* No account ids on the public surface. */
    expect(JSON.stringify(json)).not.toContain(OWNER);
    expect(JSON.stringify(json)).not.toContain(CO);
  });

  it("a legacy song with no records renders honestly empty", async () => {
    const { status, json } = await req("GET", `/song-credits/song/${legacySongId}`);
    expect(status).toBe(200);
    expect(json.credits.has_credits).toBe(false);
    expect(json.credits.credits).toEqual([]);
    expect(json.credits.empty_message).toBe("No credits recorded yet.");
    expect(json.credits.writer_splits_valid).toBeNull();
  });

  it("an unknown song is a 404, never an invented credits list", async () => {
    const { status } = await req("GET", `/song-credits/song/${randomUUID()}`);
    expect(status).toBe(404);
  });
});

describe("pre-migration honesty", () => {
  it("writes answer 503 and reads still serve the rails that exist", async () => {
    testState.withCreditTables = false;
    await seedWorld(false);
    /* Writers registered directly on the existing registry rail. */
    const regId = randomUUID();
    await testState.db.execute(sql`
      INSERT INTO publishing_split_registrations (id, owner_user_id, song_kind, song_id, song_title)
      VALUES (${regId}, ${OWNER}, 'song', ${songId}, 'Midnight Tide')
    `);
    await testState.db.execute(sql`
      INSERT INTO publishing_split_writers (id, registration_id, writer_name, writer_user_id, writer_profile_id, share_pct, confirmation_status)
      VALUES (${randomUUID()}, ${regId}, 'Thy Cheat Code', ${OWNER}, ${OWNER_PROFILE}, 100, 'confirmed')
    `);
    const put = await as(OWNER, "PUT", `/song-credits/song/${songId}`, SAVE_BODY());
    expect(put.status).toBe(503);
    expect(put.json.error).toBe("song_credits_not_ready");
    const get = await req("GET", `/song-credits/song/${songId}`);
    expect(get.status).toBe(200);
    const owner = (get.json.credits.credits as any[]).find((c: any) => c.name === "Thy Cheat Code");
    expect(owner.shares).toContainEqual({ source: "publishing", pct: 100 });
    testState.withCreditTables = true;
  });
});
