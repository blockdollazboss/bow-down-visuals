/**
 * Route tests for the discovery payload contracts (routes/discovery).
 *
 * THREE REGRESSIONS, one strain — raw-SQL rows shipped without a DTO
 * discipline, so Postgres/pg mechanics silently rewrote the payload:
 *
 * A) DUPLICATE `id` COLUMN. PROFILE_COLS carried a bare `p.id` spliced
 *    AFTER the media select (t.id / v.id / pl.id). node-postgres keys
 *    rows by column name, last occurrence wins — every track/video/
 *    playlist row's `id` was the CREATOR PROFILE's id, so clicks on
 *    Charts/Search/Vertical/DropsWire navigated to
 *    /track/<creator-profile-id>. Search playlists also collided on
 *    follower_count (the creator's count rendered as the playlist's).
 *    Fix: PROFILE_COLS emits `p.id AS profile_id`; creator-primary
 *    queries select p.id explicitly so creators keep `id`; the search
 *    playlist query emits pl.follower_count last so it wins its key.
 *
 * B) UNWRAPPED QUERYRESULTS. /rising, /rising-earners, /brands,
 *    /genre/:genre and /related/creators/:slug shipped the raw
 *    db.execute() QueryResult object ({ rows, fields, … }) instead of
 *    .rows — the client's array maps crashed on tab switch / render.
 *
 * C) PLAYS ALIAS MISMATCH. /feed named the count `plays`, but the
 *    client (cards.tsx TrackRow via DropsWire) reads
 *    window_plays ?? play_count — "0 plays" on every feed item. The
 *    vertical fresh-drops union selected no count at all. Fix: the
 *    server emits the names the client reads (window_plays on /feed,
 *    play_count on fresh drops).
 *
 * Fake-db style mirrors discovery-notifications-dto.test.ts, with one
 * twist: db.execute FLATTENS the real drizzle SQL (PgDialect) and
 * builds its fixture row by parsing the outermost select list and
 * applying node-postgres' last-duplicate-wins keying to sentinel
 * values — so the row the handler ships is the row Postgres would
 * have produced from the SQL the handler actually emitted. If the
 * collision (or a wrong alias) ever comes back, these tests fail on
 * the shipped payload, not on a hand-built expectation.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const VIEWER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const PLAYLIST_ID = "44444444-4444-4444-8444-444444444444";
const TRACK_PLAYS = 4242;
const VIDEO_PLAYS = 777;
const PLAYLIST_FOLLOWERS = 111;
const CREATOR_FOLLOWERS = 999;

const dialect = new PgDialect();

/* ─── SQL select-list simulation ─────────────────────────────────────────
   Parse the outermost SELECT list out of the flattened SQL and build
   the row node-postgres would return: one key per output column name,
   later duplicates overwriting earlier ones. Values are sentinels
   keyed by the source expression, so a collision is observable (the
   profile id sentinel ≠ the track id sentinel, the creator's
   follower_count 999 ≠ the playlist's 111). */

const VALUE_BY_EXPR: Record<string, unknown> = {
  "t.id": TRACK_ID,
  "v.id": VIDEO_ID,
  "pl.id": PLAYLIST_ID,
  "p.id": PROFILE_ID,
  "t.profile_id": PROFILE_ID,
  "v.profile_id": PROFILE_ID,
  "t.play_count": TRACK_PLAYS,
  "v.view_count": VIDEO_PLAYS,
  "t.like_count": 55,
  "v.like_count": 66,
  "pl.follower_count": PLAYLIST_FOLLOWERS,
  "p.follower_count": CREATOR_FOLLOWERS,
  "p.total_plays": 31337,
  "p.slug": "sentinel-creator",
  "p.display_name": "Sentinel Creator",
  "p.avatar_url": null,
  "p.vertical": "music",
  "p.bio": "Sentinel bio",
  "t.title": "Sentinel Track",
  "v.title": "Sentinel Video",
  "pl.title": "Sentinel Playlist",
  "pl.description": "Sentinel playlist description",
  "pl.cover_url": "playlist.png",
  "t.genre": "rock",
  "v.genre": "rock",
  "t.artwork_url": "track.png",
  "v.thumbnail_url": "video.png",
  "t.audio_url": "track.mp3",
  "v.video_url": "video.mp4",
  "t.duration_sec": 200,
  "v.duration_sec": 300,
  "t.created_at": "2026-10-14T00:00:00.000Z",
  "v.created_at": "2026-10-14T00:00:00.000Z",
  "'track'": "track",
  "'video'": "video",
};

interface SqlToken {
  word: string;
  depth: number;
  end: number;
}

/** Positions of SELECT / FROM keywords with their paren depth. */
function keywordPositions(text: string): SqlToken[] {
  const out: SqlToken[] = [];
  let depth = 0;
  let i = 0;
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  while (i < text.length) {
    const c = text[i]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (isWord(c)) {
      let j = i;
      while (j < text.length && isWord(text[j]!)) j++;
      const w = text.slice(i, j).toUpperCase();
      if (w === "SELECT" || w === "FROM") out.push({ word: w, depth, end: j });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

/** Split a select list on commas at the given paren depth only. */
function splitTopLevel(list: string, baseDepth: number): string[] {
  const items: string[] = [];
  let depth = baseDepth;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i]!;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === baseDepth) {
      items.push(list.slice(start, i));
      start = i + 1;
    }
  }
  items.push(list.slice(start));
  return items.map((x) => x.trim()).filter(Boolean);
}

function simulateRow(sqlText: string): Record<string, unknown> {
  const text = sqlText.replace(/\s+/g, " ");
  const tokens = keywordPositions(text);
  const selects = tokens.filter((t) => t.word === "SELECT");
  // Prefer the last depth-0 SELECT (the main query behind any CTEs);
  // UNION branches are parenthesized, so fall back to the first SELECT
  // (Postgres names UNION output columns from the first branch).
  const depth0 = selects.filter((t) => t.depth === 0);
  let sel = depth0.length ? depth0[depth0.length - 1]! : selects[0]!;
  let from = tokens.find((t) => t.word === "FROM" && t.depth === sel.depth && t.end > sel.end);
  let list = text.slice(sel.end, from ? textIndexOfKeyword(text, from) : undefined).trim();
  /* Wrapped-union form (GET /feed since For-You v1): the outer
     SELECT is `*` over a subquery. Postgres names the union's
     output from its first branch, so descend one level and
     simulate that branch's select list instead. */
  if (list === "*") {
    const inner = selects.find((t) => t.depth === sel.depth + 1);
    if (inner) {
      sel = inner;
      from = tokens.find((t) => t.word === "FROM" && t.depth === sel.depth && t.end > sel.end);
      list = text.slice(sel.end, from ? textIndexOfKeyword(text, from) : undefined).trim();
    }
  }
  if (/^DISTINCT\b/i.test(list)) list = list.replace(/^DISTINCT\b/i, "").trim();
  // The list slice ends where FROM begins; find that offset precisely.
  const row: Record<string, unknown> = {};
  for (const item of splitTopLevel(list, sel.depth)) {
    const flat = item.trim();
    const asMatch = /^(.*?)\sAS\s([A-Za-z_][A-Za-z0-9_]*)$/i.exec(flat);
    let expr = flat;
    let name: string;
    if (asMatch) {
      expr = asMatch[1]!.trim();
      name = asMatch[2]!;
    } else if (/^[A-Za-z_][\w]*\.[A-Za-z_][\w]*$/.test(flat)) {
      name = flat.split(".")[1]!;
    } else if (/^[A-Za-z_][\w]*$/.test(flat)) {
      name = flat;
    } else {
      name = flat; // expressions (EXISTS, COUNT…) keep a unique non-colliding key
    }
    const key = expr.toLowerCase();
    row[name] = key in VALUE_BY_EXPR ? VALUE_BY_EXPR[key] : expr;
  }
  return row;
}

/** Character offset where a token's keyword starts (end minus length). */
function textIndexOfKeyword(_text: string, tok: SqlToken): number {
  return tok.end - tok.word.length;
}

/* ─── Mocks ──────────────────────────────────────────────────────────── */

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
  const { followsTable, creatorProfilesTable } = actual;

  function rowsFor(table: unknown): unknown[] {
    if (table === followsTable) return [{ profileId: PROFILE_ID }];
    if (table === creatorProfilesTable) return [{ id: PROFILE_ID, vertical: "music" }];
    return [];
  }

  function chain(table: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => chain(table),
    }),
    execute: async (q: unknown) => {
      const { sql: text } = dialect.sqlToQuery(q as never);
      /* For-You v1 (Wave 3 #19) added three auxiliary reads to the
         /feed handler. This fixture world has no preference row
         (→ default ON) and a viewer with zero recorded engagement
         (→ cold start), so /feed falls through to the legacy wire
         whose row the simulator below builds as before. */
      if (/from\s+feed_preferences/i.test(text)) {
        return { rows: [], rowCount: 0, command: "SELECT", fields: [], oid: 0 };
      }
      if (
        /* The /feed handler's follows read specifically — /rising's
           CTE also reads follows and must NOT be caught by this. */
        /select\s+profile_id\s+from\s+follows\s+where\s+follower_user_id/i.test(text)
      ) {
        return { rows: [{ profile_id: PROFILE_ID }], rowCount: 1, command: "SELECT", fields: [], oid: 0 };
      }
      if (
        /* The affinity signal reads, matched by their exact select
           lists so charts aggregations over play_events (a different
           shape entirely) still reach the simulator. */
        /select\s+kind,\s+target_id\s+from\s+likes\b/i.test(text) ||
        /select\s+kind,\s+target_id\s+from\s+saves\b/i.test(text) ||
        /select\s+target_kind\s+as\s+kind,\s+target_id\s+from\s+reactions\b/i.test(text) ||
        /select\s+kind,\s+media_id\s+as\s+target_id\s+from\s+play_events\b/i.test(text) ||
        /select\s+'track'\s+as\s+kind,\s+track_id\s+as\s+target_id\s+from\s+reposts\b/i.test(text)
      ) {
        return { rows: [], rowCount: 0, command: "SELECT", fields: [], oid: 0 };
      }
      const row = simulateRow(text);
      // A pg QueryResult: rows + the bookkeeping fields the buggy
      // handlers used to ship verbatim.
      return { rows: [row], rowCount: 1, command: "SELECT", fields: [], oid: 0 };
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

beforeEach(() => {});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

/* ─── Defect A — duplicate `id` column ───────────────────────────────── */

describe("Defect A — media rows keep their own id, profile id rides as profile_id", () => {
  it("GET /charts/tracks?window=all — track id is the TRACK's, not the creator's", async () => {
    const { status, json } = await get("/charts/tracks?window=all");
    expect(status).toBe(200);
    expect(Array.isArray(json.tracks)).toBe(true);
    const t = json.tracks[0];
    // The regression pin: id used to be the creator profile's id.
    expect(t.id).toBe(TRACK_ID);
    expect(t.profile_id).toBe(PROFILE_ID);
    expect(t.slug).toBe("sentinel-creator");
    expect(t.play_count).toBe(TRACK_PLAYS);
  });

  it("GET /search?type=track — same contract on search rows", async () => {
    const { status, json } = await get("/search?q=sentinel&type=track");
    expect(status).toBe(200);
    const t = json.tracks[0];
    expect(t.id).toBe(TRACK_ID);
    expect(t.profile_id).toBe(PROFILE_ID);
  });

  it("GET /search?type=playlist — playlist id survives AND follower_count is the PLAYLIST's own", async () => {
    const { status, json } = await get("/search?q=sentinel&type=playlist");
    expect(status).toBe(200);
    const pl = json.playlists[0];
    expect(pl.id).toBe(PLAYLIST_ID);
    // Used to render the creator's 999 as the playlist's follower count.
    expect(pl.follower_count).toBe(PLAYLIST_FOLLOWERS);
    expect(pl.profile_id).toBe(PROFILE_ID);
    expect(pl.slug).toBe("sentinel-creator");
  });

  it("GET /charts/creators?window=all — creator rows keep `id` (FollowButton contract)", async () => {
    const { status, json } = await get("/charts/creators?window=all");
    expect(status).toBe(200);
    const c = json.creators[0];
    expect(c.id).toBe(PROFILE_ID);
    expect(c.profile_id).toBe(PROFILE_ID);
    expect(c.follower_count).toBe(CREATOR_FOLLOWERS);
  });
});

/* ─── Defect B — unwrapped QueryResult objects ───────────────────────── */

describe("Defect B — list endpoints ship row ARRAYS, not QueryResult objects", () => {
  it("GET /genre/:genre — tracks, videos and creators are all arrays (genre page maps them)", async () => {
    const { status, json } = await get("/genre/rock");
    expect(status).toBe(200);
    // Used to be { rows, fields, … } objects — genre.tsx crashed on .map.
    expect(Array.isArray(json.tracks)).toBe(true);
    expect(Array.isArray(json.videos)).toBe(true);
    expect(Array.isArray(json.creators)).toBe(true);
    expect(json.tracks[0].id).toBe(TRACK_ID);
    expect(json.videos[0].id).toBe(VIDEO_ID);
    expect(json.creators[0].id).toBe(PROFILE_ID);
  });

  it("GET /rising — the Charts Breaking tab gets an array", async () => {
    const { status, json } = await get("/rising");
    expect(status).toBe(200);
    expect(Array.isArray(json.rising)).toBe(true);
    expect(json.rising[0].id).toBe(PROFILE_ID);
  });

  it("GET /rising-earners — the Charts Earners tab gets an array", async () => {
    const { status, json } = await get("/rising-earners");
    expect(status).toBe(200);
    expect(Array.isArray(json.earners)).toBe(true);
    expect(json.earners[0].id).toBe(PROFILE_ID);
  });

  it("GET /brands — the Charts Brands tab gets an array", async () => {
    const { status, json } = await get("/brands");
    expect(status).toBe(200);
    expect(Array.isArray(json.creators)).toBe(true);
    expect(json.creators[0].id).toBe(PROFILE_ID);
  });

  it("GET /related/creators/:slug — the latent sibling ships an array too", async () => {
    const { status, json } = await get("/related/creators/sentinel-creator");
    expect(status).toBe(200);
    expect(Array.isArray(json.related)).toBe(true);
    expect(json.related[0].id).toBe(PROFILE_ID);
  });
});

/* ─── Defect C — plays alias mismatch ────────────────────────────────── */

describe("Defect C — play counts ship under the names the client reads", () => {
  it("GET /feed — items carry window_plays with the real count (DropsWire/TrackRow contract)", async () => {
    const { status, json } = await get("/feed");
    expect(status).toBe(200);
    expect(Array.isArray(json.items)).toBe(true);
    const item = json.items[0];
    expect(item.kind).toBe("track");
    expect(item.id).toBe(TRACK_ID);
    // Used to arrive as `plays`, which nothing reads — "0 plays" everywhere.
    expect(item.window_plays).toBe(TRACK_PLAYS);
    expect(item).not.toHaveProperty("plays");
  });

  it("GET /vertical/:vertical — fresh drops carry play_count (they selected no count at all)", async () => {
    const { status, json } = await get("/vertical/music");
    expect(status).toBe(200);
    expect(Array.isArray(json.new_this_week)).toBe(true);
    const item = json.new_this_week[0];
    expect(item.kind).toBe("track");
    expect(item.id).toBe(TRACK_ID);
    expect(item.play_count).toBe(TRACK_PLAYS);
  });
});
