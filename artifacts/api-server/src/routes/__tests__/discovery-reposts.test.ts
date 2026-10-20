/**
 * Route tests for GET /api/discovery/reposts (routes/discovery) — the
 * batched repost-state read, twin of GET /likes.
 *
 * WHY IT EXISTS: per-row Repost buttons (the in-world Charts board's
 * track rows — Ring 2 item 2.15's tail — and the website's chart
 * rows) ride the track repost rail for toggling
 * (POST/DELETE /api/tracks/:id/repost|unrepost), but nothing read the
 * walker's EXISTING reposts back — every row opened assuming
 * unreposted. Re-reposting an already-reposted track re-fires the
 * POST, whose counter bump does not know the repost row already
 * existed (the insert is ON CONFLICT DO NOTHING; the bump is not),
 * so the displayed count drifts from the real number of reposts.
 * The fix is this read: rows seed their state from the server's
 * answer, exactly like /likes seeds the board's hearts.
 *
 * These tests mount the REAL discovery router over a fake db whose
 * execute() simulates the one query the handler emits: it renders
 * the drizzle SQL (PgDialect), reads the bound viewer param and the
 * inline ARRAY of track ids back out of the SQL, and answers with
 * the fixture repost rows Postgres would match — so a handler that
 * forgets the viewer filter, admits a video id, or drops an asked
 * id fails here on the shipped payload.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const TRACK_REPOSTED = "22222222-2222-4222-8222-222222222222";
const TRACK_NOT_REPOSTED = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "44444444-4444-4444-8444-444444444444";

/* The viewer's repost rows — plus one row belonging to someone else,
   which must never leak into the viewer's answer. */
const REPOST_ROWS = [
  { userId: VIEWER_ID, trackId: TRACK_REPOSTED },
  { userId: OTHER_USER_ID, trackId: TRACK_NOT_REPOSTED },
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
      if (!/from\s+reposts/i.test(text)) return { rows: [], rowCount: 0, command: "SELECT", fields: [], oid: 0 };
      /* The handler binds the viewer as the first param and inlines
         the track ids as an ARRAY[...] literal (the /likes
         pattern) — simulate Postgres against both. */
      const viewer = params[0];
      const arrayMatch = text.match(/ARRAY\[([^\]]*)\]/i);
      const wantedIds = new Set((arrayMatch?.[1].match(/[0-9a-f-]{36}/gi) ?? []).map((s) => s.toLowerCase()));
      const rows = REPOST_ROWS
        .filter((r) => r.userId === viewer && wantedIds.has(r.trackId.toLowerCase()))
        .map((r) => ({ tid: r.trackId }));
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

describe("GET /reposts — the walker's reposts, read back from the server", () => {
  it("answers every asked entry from the viewer's own rows only", async () => {
    const { status, json } = await get(
      `/reposts?ids=${encodeURIComponent(`track:${TRACK_REPOSTED},track:${TRACK_NOT_REPOSTED}`)}`,
    );
    expect(status).toBe(200);
    expect(json).toEqual({
      [`track:${TRACK_REPOSTED}`]: true,
      /* Reposted by ANOTHER user — the viewer's answer stays false. */
      [`track:${TRACK_NOT_REPOSTED}`]: false,
    });
  });

  it("reposts are tracks-only — a video entry is dropped, never answered", async () => {
    const { status, json } = await get(
      `/reposts?ids=${encodeURIComponent(`video:${VIDEO_ID},track:${TRACK_REPOSTED}`)}`,
    );
    expect(status).toBe(200);
    expect(json).toEqual({ [`track:${TRACK_REPOSTED}`]: true });
  });

  it("no ids — an empty map, not an error", async () => {
    const { status, json } = await get("/reposts");
    expect(status).toBe(200);
    expect(json).toEqual({});
    const empty = await get("/reposts?ids=");
    expect(empty.json).toEqual({});
  });

  it("malformed entries are dropped, never guessed at; valid ones still answer", async () => {
    const { status, json } = await get(
      `/reposts?ids=${encodeURIComponent(`album:${TRACK_REPOSTED},track:not-a-uuid,track:,${TRACK_REPOSTED},track:${TRACK_REPOSTED}`)}`,
    );
    expect(status).toBe(200);
    expect(json).toEqual({ [`track:${TRACK_REPOSTED}`]: true });
  });

  it("duplicate entries collapse to one key", async () => {
    const { json } = await get(
      `/reposts?ids=${encodeURIComponent(`track:${TRACK_REPOSTED},track:${TRACK_REPOSTED}`)}`,
    );
    expect(Object.keys(json)).toEqual([`track:${TRACK_REPOSTED}`]);
  });
});
