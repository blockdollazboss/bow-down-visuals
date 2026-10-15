/**
 * Route tests for GET /api/playlists/mine (routes/creator-platform).
 *
 * THE REGRESSION: the route was registered AFTER GET /api/playlists/:id,
 * so Express matched "mine" as a playlist id. Against real Postgres the
 * uuid cast on "mine" throws → 500 (in this fake db the lookup simply
 * finds no row → 404); either way the client's authedJson (lib/streaming.ts
 * fetchMyPlaylists) gets a non-OK response, returns null, and AddToPlaylist
 * permanently shows its placeholder. These tests drive the endpoint the
 * way the client does and pin the :id route still working after the
 * reorder.
 *
 * Fake-db style mirrors creator-profile-public.test.ts: real table
 * objects via importOriginal, WHERE params read back through PgDialect,
 * condition column discriminated from the rendered SQL.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    profilesByUserId: new Map<string, Record<string, unknown>>(),
    profilesById: new Map<string, Record<string, unknown>>(),
    playlistsByOwner: new Map<string, Array<Record<string, unknown>>>(),
    playlistsById: new Map<string, Record<string, unknown>>(),
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

const AUTH_USER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PLAYLIST_ID = "22222222-2222-4222-8222-222222222222";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = AUTH_USER_ID;
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
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, playlistsTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    const key = String(params[0] ?? "");
    if (table === creatorProfilesTable) {
      if (sql.includes('"user_id"')) {
        const row = state.profilesByUserId.get(key);
        return row ? [row] : [];
      }
      const row = state.profilesById.get(key);
      return row ? [row] : [];
    }
    if (table === playlistsTable) {
      if (sql.includes('"owner_profile_id"')) {
        return state.playlistsByOwner.get(key) ?? [];
      }
      const row = state.playlistsById.get(key);
      return row ? [row] : [];
    }
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const chain: any = {
            limit: async (_n: number) => rowsFor(table, cond),
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => rowsFor(table, cond),
              then: (res: any, rej: any) =>
                Promise.resolve(rowsFor(table, cond)).then(res, rej),
            }),
            then: (res: any, rej: any) =>
              Promise.resolve(rowsFor(table, cond)).then(res, rej),
          };
          return chain;
        },
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";

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

function profileRow(): Record<string, unknown> {
  return {
    id: PROFILE_ID,
    userId: AUTH_USER_ID,
    slug: "my-corner",
    displayName: "My Corner",
    isPublic: true,
  };
}

function playlistRow(): Record<string, unknown> {
  return {
    id: PLAYLIST_ID,
    ownerProfileId: PROFILE_ID,
    title: "Late Night Mix",
    description: "",
    coverUrl: null,
    isPublic: true,
    kind: "playlist",
    items: [],
    followerCount: 3,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  h.state.profilesByUserId = new Map();
  h.state.profilesById = new Map();
  h.state.playlistsByOwner = new Map();
  h.state.playlistsById = new Map();
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/playlists/mine — AddToPlaylist's data source", () => {
  it("returns the caller's playlists in the { playlists } shape the client unwraps", async () => {
    h.state.profilesByUserId.set(AUTH_USER_ID, profileRow());
    h.state.playlistsByOwner.set(PROFILE_ID, [playlistRow()]);

    const { status, json } = await get("/playlists/mine");

    expect(status).toBe(200);
    expect(Array.isArray(json.playlists)).toBe(true);
    expect(json.playlists).toHaveLength(1);
    expect(json.playlists[0].id).toBe(PLAYLIST_ID);
    expect(json.playlists[0].title).toBe("Late Night Mix");
    expect(json.playlists[0].owner_profile_slug).toBe("my-corner");
  });

  it("returns an empty list (not an error) when the caller has no profile yet", async () => {
    const { status, json } = await get("/playlists/mine");

    expect(status).toBe(200);
    expect(json.playlists).toEqual([]);
  });

  it("keeps GET /api/playlists/:id working for a real public playlist after the reorder", async () => {
    h.state.profilesById.set(PROFILE_ID, profileRow());
    h.state.playlistsById.set(PLAYLIST_ID, playlistRow());

    const { status, json } = await get(`/playlists/${PLAYLIST_ID}`);

    expect(status).toBe(200);
    expect(json.playlist.id).toBe(PLAYLIST_ID);
    expect(json.playlist.title).toBe("Late Night Mix");
    expect(json.owner.slug).toBe("my-corner");
  });
});
