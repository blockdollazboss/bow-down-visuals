/**
 * Search truth for GET /api/discovery/search (Stack1100 lane Y5).
 *
 * THE DISEASE: the endpoint matched the whole typed string as one
 * ILIKE '%king shark%' against each field, so a multi-word query
 * could only match a field containing the exact phrase in the exact
 * order — the same whole-string disease N5 cured in the page indexes.
 * Videos were also blind to their own genre (tracks searched title +
 * genre; videos title only) and playlists to their description.
 *
 * THE FIX (lib/search-match): token-AND — every meaningful word must
 * appear in SOME field, accent-folded — with the browse visibility
 * rule kept in the WHERE (public profiles, published media, public
 * playlists). This suite pins the emitted SQL shape via a fake
 * db.execute that flattens the real drizzle SQL (PgDialect) and
 * records text + params: token params ANDed, never one phrase param,
 * visibility predicates present, genre/description fields searched.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; params: unknown[] }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "00000000-0000-4000-8000-000000000099";
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
  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => {
        const c: any = {
          where: (_cond: unknown) => c,
          orderBy: (..._args: unknown[]) => c,
          limit: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
        void table;
        return c;
      },
    }),
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      h.calls.push({ text, params: params as unknown[] });
      return { rows: [], rowCount: 0, command: "SELECT", fields: [], oid: 0 };
    },
  };
  return { ...actual, db: fakeDb };
});

import router from "../discovery";

let base = "";
let server: ReturnType<typeof express.application.listen>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.calls.length = 0;
});

async function search(qs: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/search?${qs}`);
  return { status: res.status, body: await res.json() };
}

function callFor(fragment: RegExp): { text: string; params: unknown[] } {
  const call = h.calls.find((c) => fragment.test(c.text));
  expect(call, `expected a query matching ${fragment}`).toBeDefined();
  return call!;
}

describe("GET /search — token-AND matching", () => {
  it("splits a multi-word query into ANDed token patterns, never one phrase", async () => {
    const { status, body } = await search("q=king%20shark&type=all");
    expect(status).toBe(200);
    expect(body.q).toBe("king shark");
    expect(h.calls.length).toBe(4); // creators, tracks, videos, playlists
    for (const call of h.calls) {
      expect(call.text).toContain("translate(lower(");
      expect(call.text).toContain(" AND ");
      expect(call.params).toContain("%king%");
      expect(call.params).toContain("%shark%");
      expect(call.params).not.toContain("%king shark%");
    }
  });

  it("folds accents in the query before patterning", async () => {
    await search("q=beyonc%C3%A9&type=creator");
    const call = callFor(/from\s+creator_profiles/i);
    expect(call.params).toContain("%beyonce%");
    expect(call.params).not.toContain("%beyoncé%");
  });

  it("a typed % can never widen the match", async () => {
    await search("q=100%25&type=creator");
    const call = callFor(/from\s+creator_profiles/i);
    for (const p of call.params) {
      expect(String(p)).not.toContain("%%");
    }
    expect(call.params).toContain("%100%");
  });
});

describe("GET /search — field coverage", () => {
  it("videos search genre like tracks do (parity), playlists search description", async () => {
    await search("q=rock&type=all");
    const videos = callFor(/from\s+profile_videos/i);
    expect(videos.text).toMatch(/translate\(lower\(v\.genre\),/);
    const tracks = callFor(/from\s+profile_tracks/i);
    expect(tracks.text).toMatch(/translate\(lower\(t\.genre\),/);
    const playlists = callFor(/from\s+playlists/i);
    expect(playlists.text).toMatch(/translate\(lower\(pl\.description\),/);
  });
});

describe("GET /search — visibility stays in the WHERE (leak probes)", () => {
  it("every type query carries its browse-visibility predicates", async () => {
    await search("q=king&type=all");
    expect(callFor(/from\s+creator_profiles/i).text).toContain("is_public");
    const tracks = callFor(/from\s+profile_tracks/i);
    expect(tracks.text).toContain("is_published");
    expect(tracks.text).toContain("is_public");
    const videos = callFor(/from\s+profile_videos/i);
    expect(videos.text).toContain("is_published");
    expect(videos.text).toContain("is_public");
    const playlists = callFor(/from\s+playlists/i);
    expect(playlists.text).toContain("pl.is_public");
    expect(playlists.text).toContain("p.is_public");
  });
});

describe("GET /search — honest empty shapes", () => {
  it("a missing q answers the empty payload and runs no query", async () => {
    const { status, body } = await search("type=all");
    expect(status).toBe(200);
    expect(body).toEqual({ q: "", creators: [], tracks: [], videos: [], playlists: [] });
    expect(h.calls.length).toBe(0);
  });

  it("a type filter runs only that type's query", async () => {
    const { body } = await search("q=king&type=track");
    expect(h.calls.length).toBe(1);
    expect(body.tracks).toEqual([]);
    expect(body.creators).toBeUndefined();
  });
});
