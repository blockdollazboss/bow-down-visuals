/**
 * Route tests for playlist Follow / Unfollow in routes/creator-platform:
 *   POST   /api/playlists/:id/follow
 *   DELETE /api/playlists/:id/unfollow
 *
 * THE DEFECT (stack1000 Lane M3, flagged as L4 residual R4):
 * the pair kept NO record of who follows a playlist. Follow ran a bare
 * `follower_count = follower_count + 1` on EVERY POST — a double-tap or
 * a client retry inflated the count — and unfollow decremented on every
 * DELETE, including from someone who never followed (stealing a count
 * that was never theirs). No bell could fire truthfully either: with no
 * landed transition, there is no moment to announce.
 *
 * THE FIX these tests pin: a playlist_follows row (migration 0303,
 * mirroring the profile `follows` table) is the follow itself. The
 * counter and the owner's social bell move only when a row lands
 * (insert) or leaves (delete); replays are exact no-ops.
 *
 * The fake db below models BOTH the old raw-SQL counter writes (via
 * db.execute) and the new row-gated writes, so the replay / theft
 * tests FAIL against the pre-fix handlers and pass after.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const AUTH_USER = "00000000-0000-4000-8000-000000000099";
const OWNER_USER = "22222222-2222-4222-8222-222222222222";
const OWNER_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const FOLLOWER_PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const PLAYLIST_ID = "55555555-5555-4555-8555-555555555555";
const PRIVATE_PLAYLIST_ID = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  state: {
    playlistsById: new Map<string, Record<string, any>>(),
    profilesById: new Map<string, Record<string, any>>(),
    playlistFollows: new Set<string>(),
    /** Every counter move actually applied to the stored row, in order. */
    counterMoves: [] as number[],
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

function followKey(userId: unknown, playlistId: unknown): string {
  return `${String(userId)}:${String(playlistId)}`;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? AUTH_USER;
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
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { playlistsTable, playlistFollowsTable, creatorProfilesTable } = actual;

  function applyCounterMove(playlistId: string, delta: number) {
    const row = state.playlistsById.get(playlistId);
    if (!row) return;
    row["followerCount"] = Math.max((row["followerCount"] as number) + delta, 0);
    state.counterMoves.push(delta);
  }

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { params } = render(cond);
    if (table === playlistsTable) {
      const row = state.playlistsById.get(String(params[0] ?? ""));
      return row ? [row] : [];
    }
    if (table === creatorProfilesTable) {
      const row =
        state.profilesById.get(String(params[0] ?? "")) ??
        [...state.profilesById.values()].find(
          (p) => String(p["userId"]) === String(params[0] ?? ""),
        );
      return row ? [row] : [];
    }
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      offset: (_n: number) => self,
      orderBy: (..._args: unknown[]) => self,
      then: (res: any, rej: any) =>
        Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }

  function thenable(extra: Record<string, unknown> = {}): any {
    return {
      ...extra,
      then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
    };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        let landedRows: Array<Record<string, unknown>> = [{ ...v }];
        if (table === playlistFollowsTable) {
          const key = followKey(v["userId"], v["playlistId"]);
          if (state.playlistFollows.has(key)) landedRows = [];
          else state.playlistFollows.add(key);
        }
        const conflictResult: any = {
          returning: async () => landedRows,
          then: (res: any, rej: any) => Promise.resolve(landedRows).then(res, rej),
        };
        return thenable({
          onConflictDoNothing: (_cfg: unknown) => conflictResult,
          returning: async () => landedRows,
        });
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (table === playlistsTable && patch && "followerCount" in patch) {
            const text = render(patch["followerCount"]).sql;
            const { params } = render(cond);
            if (text.includes("+ 1")) applyCounterMove(String(params[0]), 1);
            else if (text.includes("- 1")) applyCounterMove(String(params[0]), -1);
          }
          return thenable();
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => ({
        returning: async (_fields?: unknown) => {
          if (table === playlistFollowsTable) {
            const params = render(cond).params;
            const key = followKey(params[0], params[1]);
            if (state.playlistFollows.has(key)) {
              state.playlistFollows.delete(key);
              return [{ playlistId: params[1] }];
            }
          }
          return [];
        },
      }),
    }),
    execute: async (q: unknown) => {
      // The PRE-FIX handlers moved the counter with raw SQL through
      // db.execute. Model those writes faithfully so the truth tests
      // bite on the old code: +1 always lands; -1 lands floored at 0.
      try {
        const { sql: text, params } = render(q);
        const playlistId = String(params[params.length - 1] ?? "");
        if (text.includes("follower_count = follower_count + 1")) {
          applyCounterMove(playlistId, 1);
        } else if (text.includes("follower_count - 1")) {
          applyCounterMove(playlistId, -1);
        }
      } catch {
        /* non-counter execute — nothing to model */
      }
      return [];
    },
  };

  return { ...actual, db: fakeDb };
});

import router, * as creatorPlatform from "../creator-platform";

const setPlaylistNotifier = (creatorPlatform as any)
  .__setPlaylistFollowEventNotifier as
  | ((fn: ((input: any) => Promise<unknown>) | null) => void)
  | undefined;
const buildPlaylistFollowEvent = (creatorPlatform as any)
  .buildPlaylistFollowEvent as ((opts: any) => any) | undefined;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const s = h.state;
  s.playlistsById = new Map();
  s.profilesById = new Map();
  s.playlistFollows = new Set();
  s.counterMoves = [];

  s.profilesById.set(OWNER_PROFILE_ID, {
    id: OWNER_PROFILE_ID,
    userId: OWNER_USER,
    slug: "wall-owner",
    displayName: "Wall Owner",
    isPublic: true,
    followerCount: 7,
  });
  s.profilesById.set(FOLLOWER_PROFILE_ID, {
    id: FOLLOWER_PROFILE_ID,
    userId: AUTH_USER,
    slug: "the-follower",
    displayName: "Faithful Follower",
    isPublic: true,
    followerCount: 3,
  });
  s.playlistsById.set(PLAYLIST_ID, {
    id: PLAYLIST_ID,
    ownerProfileId: OWNER_PROFILE_ID,
    title: "Midnight Mix",
    description: "",
    coverUrl: null,
    isPublic: true,
    kind: "playlist",
    priceCents: null,
    previewItem: null,
    items: [],
    followerCount: 5,
    createdAt: new Date(),
  });
  s.playlistsById.set(PRIVATE_PLAYLIST_ID, {
    id: PRIVATE_PLAYLIST_ID,
    ownerProfileId: OWNER_PROFILE_ID,
    title: "Secret Stash",
    description: "",
    coverUrl: null,
    isPublic: false,
    kind: "playlist",
    priceCents: null,
    previewItem: null,
    items: [],
    followerCount: 2,
    createdAt: new Date(),
  });
});

async function post(path: string, user?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: user ? { "x-test-user": user } : {},
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function del(path: string, user?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "DELETE",
    headers: user ? { "x-test-user": user } : {},
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /api/playlists/:id/follow — counter truth", () => {
  it("a landed follow records the row, moves the counter once, and reports the fresh count", async () => {
    const { status, json } = await post(`/playlists/${PLAYLIST_ID}/follow`);

    expect(status).toBe(200);
    expect(json.following).toBe(true);
    expect(json.follower_count).toBe(6);
    expect(h.state.playlistFollows.has(followKey(AUTH_USER, PLAYLIST_ID))).toBe(true);
    expect(h.state.counterMoves).toEqual([1]);
  });

  it("a REPLAYED follow POST is an exact no-op: no second row effect, no second count, same answer", async () => {
    const first = await post(`/playlists/${PLAYLIST_ID}/follow`);
    expect(first.json.follower_count).toBe(6);

    const replay = await post(`/playlists/${PLAYLIST_ID}/follow`);
    expect(replay.status).toBe(200);
    expect(replay.json.following).toBe(true);
    expect(replay.json.follower_count).toBe(6);
    expect(h.state.counterMoves).toEqual([1]);
    expect(h.state.playlistsById.get(PLAYLIST_ID)!["followerCount"]).toBe(6);
  });

  it("404s a private playlist, same as a missing one, and records nothing", async () => {
    const { status } = await post(`/playlists/${PRIVATE_PLAYLIST_ID}/follow`);
    expect(status).toBe(404);
    expect(h.state.playlistFollows.size).toBe(0);
    expect(h.state.counterMoves).toEqual([]);
  });
});

describe("DELETE /api/playlists/:id/unfollow — counter truth", () => {
  it("an unfollow from someone who NEVER followed cannot steal a count", async () => {
    const { status, json } = await del(`/playlists/${PLAYLIST_ID}/unfollow`);

    expect(status).toBe(200);
    expect(json.following).toBe(false);
    expect(json.follower_count).toBe(5);
    expect(h.state.counterMoves).toEqual([]);
    expect(h.state.playlistsById.get(PLAYLIST_ID)!["followerCount"]).toBe(5);
  });

  it("follow → unfollow → replayed unfollow: the counter moves exactly twice and settles at the start", async () => {
    await post(`/playlists/${PLAYLIST_ID}/follow`);
    const un = await del(`/playlists/${PLAYLIST_ID}/unfollow`);
    expect(un.json.follower_count).toBe(5);
    expect(h.state.playlistFollows.has(followKey(AUTH_USER, PLAYLIST_ID))).toBe(false);

    const replay = await del(`/playlists/${PLAYLIST_ID}/unfollow`);
    expect(replay.status).toBe(200);
    expect(replay.json.follower_count).toBe(5);
    expect(h.state.counterMoves).toEqual([1, -1]);
  });
});

describe("playlist follow bell — the follow family pattern (social channel)", () => {
  it("the owner's bell fires once for the landed follow — and not again on replay", async () => {
    expect(setPlaylistNotifier).toBeTypeOf("function");
    const seen: Array<Record<string, unknown>> = [];
    setPlaylistNotifier!(async (input: unknown) => {
      seen.push(input as Record<string, unknown>);
    });
    try {
      await post(`/playlists/${PLAYLIST_ID}/follow`);
      await post(`/playlists/${PLAYLIST_ID}/follow`);
    } finally {
      setPlaylistNotifier!(null);
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      userId: OWNER_USER,
      category: "social",
      kind: "playlist_follow",
      link: `/playlist/${PLAYLIST_ID}`,
    });
    expect(String(seen[0]!["title"])).toContain("Faithful Follower");
    expect(String(seen[0]!["body"])).toContain("Midnight Mix");
  });

  it("following your OWN playlist records the follow but never bells yourself", async () => {
    expect(setPlaylistNotifier).toBeTypeOf("function");
    const seen: Array<Record<string, unknown>> = [];
    setPlaylistNotifier!(async (input: unknown) => {
      seen.push(input as Record<string, unknown>);
    });
    try {
      const { status, json } = await post(`/playlists/${PLAYLIST_ID}/follow`, OWNER_USER);
      expect(status).toBe(200);
      expect(json.follower_count).toBe(6);
    } finally {
      setPlaylistNotifier!(null);
    }
    expect(h.state.playlistFollows.has(followKey(OWNER_USER, PLAYLIST_ID))).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("the pure builder names the follower and the playlist, on the social channel", () => {
    expect(buildPlaylistFollowEvent).toBeTypeOf("function");
    expect(
      buildPlaylistFollowEvent!({
        ownerUserId: OWNER_USER,
        followerName: "Faithful Follower",
        playlistTitle: "Midnight Mix",
        playlistId: PLAYLIST_ID,
      }),
    ).toMatchObject({
      userId: OWNER_USER,
      category: "social",
      kind: "playlist_follow",
      title: "Faithful Follower followed your playlist 🦈",
      link: `/playlist/${PLAYLIST_ID}`,
    });
  });
});
