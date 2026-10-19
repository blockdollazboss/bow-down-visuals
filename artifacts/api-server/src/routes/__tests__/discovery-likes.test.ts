/**
 * Route tests for GET /api/discovery/likes (routes/discovery) — the
 * batched like-state read, twin of GET /following.
 *
 * WHY IT EXISTS: the in-world Charts board's per-row Like buttons
 * (2.27) rode the media like rails for toggling, but nothing read the
 * walker's EXISTING hearts back — every row opened assuming unliked.
 * Re-liking an already-liked upload re-fires POST /media/:kind/:id/like,
 * whose counter bump does not know the like row already existed, so
 * the displayed count drifts from the real number of likes. The fix
 * is this read: the board seeds its hearts from the server's answer,
 * exactly like /following seeds its Follow buttons.
 *
 * These tests mount the REAL discovery router over a fake db whose
 * execute() simulates the one query the handler emits: it renders
 * the drizzle SQL (PgDialect), reads the bound viewer param and the
 * inline ARRAY of target ids back out of the SQL, and answers with
 * the fixture like rows Postgres would match — so a handler that
 * forgets the viewer filter, mixes kinds, or drops an asked id
 * fails here on the shipped payload.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const TRACK_LIKED = "22222222-2222-4222-8222-222222222222";
const TRACK_NOT_LIKED = "33333333-3333-4333-8333-333333333333";
const VIDEO_LIKED = "44444444-4444-4444-8444-444444444444";

/* The viewer's like rows — plus one row belonging to someone else,
   which must never leak into the viewer's answer. */
const LIKE_ROWS = [
  { userId: VIEWER_ID, kind: "track", targetId: TRACK_LIKED },
  { userId: VIEWER_ID, kind: "video", targetId: VIDEO_LIKED },
  { userId: OTHER_USER_ID, kind: "track", targetId: TRACK_NOT_LIKED },
];

const dialect = new PgDialect();

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = VIEWER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();

  function chain(): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async () => [],
      then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({ from: (_table: unknown) => chain() }),
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      if (!/from\s+likes/i.test(text)) return { rows: [], rowCount: 0, command: "SELECT", fields: [], oid: 0 };
      /* The handler binds the viewer as the first param and inlines
         the target ids as an ARRAY[...] literal (the /following
         pattern) — simulate Postgres against both. */
      const viewer = params[0];
      const arrayMatch = text.match(/ARRAY\[([^\]]*)\]/i);
      const wantedIds = new Set((arrayMatch?.[1].match(/[0-9a-f-]{36}/gi) ?? []).map((s) => s.toLowerCase()));
      const rows = LIKE_ROWS
        .filter((r) => r.userId === viewer && wantedIds.has(r.targetId.toLowerCase()))
        .map((r) => ({ kind: r.kind, tid: r.targetId }));
      return { rows, rowCount: rows.length, command: "SELECT", fields: [], oid: 0 };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../discovery";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/discovery", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/discovery`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /likes — the walker's hearts, read back from the server", () => {
  it("answers every asked entry, keyed per kind+id, from the viewer's own rows only", async () => {
    const { status, json } = await get(
      `/likes?ids=${encodeURIComponent(`track:${TRACK_LIKED},video:${VIDEO_LIKED},track:${TRACK_NOT_LIKED}`)}`,
    );
    expect(status).toBe(200);
    expect(json).toEqual({
      [`track:${TRACK_LIKED}`]: true,
      [`video:${VIDEO_LIKED}`]: true,
      /* Liked by ANOTHER user — the viewer's answer stays false. */
      [`track:${TRACK_NOT_LIKED}`]: false,
    });
  });

  it("kind is part of the key — a video's like never lights the same id as a track", async () => {
    const { status, json } = await get(
      `/likes?ids=${encodeURIComponent(`track:${VIDEO_LIKED},video:${VIDEO_LIKED}`)}`,
    );
    expect(status).toBe(200);
    expect(json).toEqual({ [`track:${VIDEO_LIKED}`]: false, [`video:${VIDEO_LIKED}`]: true });
  });

  it("no ids — an empty map, not an error", async () => {
    const { status, json } = await get("/likes");
    expect(status).toBe(200);
    expect(json).toEqual({});
    const empty = await get("/likes?ids=");
    expect(empty.json).toEqual({});
  });

  it("malformed entries are dropped, never guessed at; valid ones still answer", async () => {
    const { status, json } = await get(
      `/likes?ids=${encodeURIComponent(`album:${TRACK_LIKED},track:not-a-uuid,track:,${TRACK_LIKED},track:${TRACK_LIKED}`)}`,
    );
    expect(status).toBe(200);
    expect(json).toEqual({ [`track:${TRACK_LIKED}`]: true });
  });

  it("duplicate entries collapse to one key", async () => {
    const { json } = await get(
      `/likes?ids=${encodeURIComponent(`track:${TRACK_LIKED},track:${TRACK_LIKED}`)}`,
    );
    expect(Object.keys(json)).toEqual([`track:${TRACK_LIKED}`]);
  });
});
