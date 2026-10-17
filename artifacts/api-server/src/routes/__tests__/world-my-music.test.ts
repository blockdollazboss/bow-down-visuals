/**
 * Route tests for GET /api/world/my-music (Ring 2, item 2.14).
 *
 * The endpoint is the palace's one owned-but-unpublished playback
 * read: the signed-in member's own profile tracks — drafts included —
 * with streamable URLs. The public media detail 404s unpublished
 * tracks, so ownership here IS the security boundary, and these
 * tests drive the REAL mounted handler (routes/world) against a fake
 * db to pin it:
 *  - no session → 401 (the real requireAuth contract, mocked at the
 *    same seam the house's route suites use);
 *  - the caller gets their own tracks, unpublished included, in the
 *    camelCase world DTO shape (never the snake_case media DTO);
 *  - another member's tracks are NEVER in the response — the query
 *    is keyed by the caller's own profile, there is no id parameter;
 *  - a member with no creator profile gets an honest empty list.
 *
 * Fake-db style mirrors playlists-mine.test.ts: real table objects
 * via importOriginal, WHERE params read back through PgDialect, the
 * condition column discriminated from the rendered SQL.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    tracksByProfileId: new Map<string, Array<Record<string, unknown>>>(),
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

const USER_A = "00000000-0000-4000-8000-0000000000a1";
const USER_B = "00000000-0000-4000-8000-0000000000b2";
const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";
const TRACK_DRAFT = "33333333-3333-4333-8333-333333333333";
const TRACK_LIVE = "44444444-4444-4444-8444-444444444444";
const TRACK_FOREIGN = "55555555-5555-4555-8555-555555555555";

/* requireAuth stand-in with the real contract's shape: a request
   with no session identity is a 401; the test's x-test-user header
   plays the session's role (the production middleware verifies the
   Supabase token and sets req.userId exactly the same way). */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const userId = req.headers["x-test-user"];
    if (typeof userId !== "string" || !userId) {
      res.status(401).json({ error: "Sign in first." });
      return;
    }
    req.userId = userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, profileTracksTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === creatorProfilesTable) {
      if (!sql.includes('"user_id"')) return [];
      const row = state.profilesByUserId.get(key);
      return row ? [row] : [];
    }
    if (table === profileTracksTable) {
      if (!sql.includes('"profile_id"')) return [];
      return state.tracksByProfileId.get(key) ?? [];
    }
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => rowsFor(table, cond);
          const chain: any = {
            limit: async (n: number) => rows().slice(0, n),
            orderBy: (..._args: unknown[]) => ({
              limit: async (n: number) => rows().slice(0, n),
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
          return chain;
        },
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../world";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

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

function profileRow(id: string, userId: string, displayName: string): Record<string, unknown> {
  return { id, userId, slug: `slug-${id.slice(0, 4)}`, displayName, isPublic: true };
}

function trackRow(id: string, profileId: string, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id,
    profileId,
    title: `Song ${id.slice(0, 4)}`,
    audioUrl: `https://cdn.example.com/${id}.mp3`,
    artworkUrl: null,
    genre: "Royal",
    tags: [],
    durationSec: 187,
    downloadPriceCents: 0,
    playCount: 3,
    likeCount: 2,
    repostCount: 0,
    commentCount: 1,
    isPublished: false,
    createdAt: new Date("2026-10-02T12:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  h.state.profilesByUserId = new Map();
  h.state.tracksByProfileId = new Map();
  h.state.profilesByUserId.set(USER_A, profileRow(PROFILE_A, USER_A, "Artist A"));
  h.state.profilesByUserId.set(USER_B, profileRow(PROFILE_B, USER_B, "Artist B"));
  h.state.tracksByProfileId.set(PROFILE_A, [
    trackRow(TRACK_DRAFT, PROFILE_A, { title: "Unreleased Draft", isPublished: false }),
    trackRow(TRACK_LIVE, PROFILE_A, { title: "Already Out", isPublished: true }),
  ]);
  h.state.tracksByProfileId.set(PROFILE_B, [
    trackRow(TRACK_FOREIGN, PROFILE_B, { title: "Not Yours", isPublished: false }),
  ]);
});

async function get(path: string, userId?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    headers: userId ? { "x-test-user": userId } : {},
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/world/my-music — owned playback, published or not", () => {
  it("refuses the signed-out (401, no tracks leak)", async () => {
    const { status, json } = await get("/world/my-music");
    expect(status).toBe(401);
    expect(JSON.stringify(json)).not.toContain(TRACK_DRAFT);
  });

  it("returns the caller's own tracks — the unpublished draft included — as camelCase world DTOs", async () => {
    const { status, json } = await get("/world/my-music", USER_A);
    expect(status).toBe(200);
    expect(Array.isArray(json.tracks)).toBe(true);
    expect(json.tracks).toHaveLength(2);
    const draft = json.tracks.find((t: any) => t.id === TRACK_DRAFT);
    expect(draft).toMatchObject({
      title: "Unreleased Draft",
      isPublished: false,
      audioUrl: `https://cdn.example.com/${TRACK_DRAFT}.mp3`,
      artistName: "Artist A",
      durationSec: 187,
      likeCount: 2,
      commentCount: 1,
    });
    expect(draft.createdAt).toBe("2026-10-02T12:00:00.000Z");
    /* The DTO disease guard: no snake_case keys on the wire. */
    expect(draft.audio_url).toBeUndefined();
    expect(draft.is_published).toBeUndefined();
    const live = json.tracks.find((t: any) => t.id === TRACK_LIVE);
    expect(live.isPublished).toBe(true);
  });

  it("can never touch another member's music — B's draft is absent from A's answer, and B gets only B's", async () => {
    const a = await get("/world/my-music", USER_A);
    expect(a.json.tracks.map((t: any) => t.id)).not.toContain(TRACK_FOREIGN);
    const b = await get("/world/my-music", USER_B);
    expect(b.status).toBe(200);
    expect(b.json.tracks.map((t: any) => t.id)).toEqual([TRACK_FOREIGN]);
    expect(b.json.tracks[0].artistName).toBe("Artist B");
  });

  it("a member with no creator profile gets an honest empty list, not an error", async () => {
    const { status, json } = await get("/world/my-music", "00000000-0000-4000-8000-0000000000c3");
    expect(status).toBe(200);
    expect(json.tracks).toEqual([]);
  });

  it("tracks with no audio file are dropped — a row that cannot play is never served as playable", async () => {
    h.state.tracksByProfileId.set(PROFILE_A, [
      trackRow(TRACK_DRAFT, PROFILE_A, { audioUrl: "" }),
      trackRow(TRACK_LIVE, PROFILE_A, { isPublished: true }),
    ]);
    const { status, json } = await get("/world/my-music", USER_A);
    expect(status).toBe(200);
    expect(json.tracks.map((t: any) => t.id)).toEqual([TRACK_LIVE]);
  });
});
