/**
 * Route tests for profile Follow / Unfollow in routes/creator-platform:
 *   POST   /api/creator-profiles/:id/follow
 *   DELETE /api/creator-profiles/:id/unfollow
 *
 * THE REGRESSIONS:
 * 1. Both handlers resolved :id through an id-only lookup (getProfileById),
 *    but the profile page's caller (components/artist/profile-sections.tsx
 *    via lib/artist-profiles.ts followProfile/unfollowProfile) passes the
 *    profile SLUG — so following from a profile page always 404'd. Other
 *    callers (discovery FollowButton, pages/shorts.tsx) pass real UUIDs
 *    and must keep working. The handlers must therefore resolve through
 *    getProfileBySlugOrId, exactly like the wall-comment routes (the fix
 *    precedent in this file).
 * 2. (Client side, pinned by the route shape here) there is no
 *    DELETE …/follow route at all — unfollow is DELETE …/unfollow.
 *
 * These tests mount the real router over a fake db (style mirrors
 * creator-comments-dto.test.ts: real table objects via importOriginal,
 * WHERE params read back through PgDialect rendering) whose profile
 * lookup answers id lookups ONLY by UUID and slug lookups ONLY by slug,
 * the way Postgres behaves — a slug reaching an id lookup finds nothing.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const AUTH_USER = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_OWNER = "22222222-2222-4222-8222-222222222222";
const PROFILE_SLUG = "wall-owner";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    follows: new Set<string>(),
    insertedFollows: [] as Array<Record<string, unknown>>,
    deletedFollows: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

function followKey(followerUserId: unknown, profileId: unknown): string {
  return `${String(followerUserId)}:${String(profileId)}`;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = AUTH_USER;
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
  const { creatorProfilesTable, followsTable, notificationsTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table === creatorProfilesTable) {
      const { sql, params } = render(cond);
      // Slug lookup: select() with eq(slug) — answer by slug only.
      if (sql.includes('"slug"')) {
        const row = [...state.profilesById.values()].find(
          (p) => String(p["slug"]) === String(params[0] ?? ""),
        );
        return row ? [row] : [];
      }
      // getProfileById: select() with eq(id) — a slug finds nothing here,
      // exactly as a slug can never equal a UUID primary key.
      const row = state.profilesById.get(String(params[0] ?? ""));
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
        if (table === followsTable) {
          state.insertedFollows.push(v);
          state.follows.add(followKey(v["followerUserId"], v["profileId"]));
        }
        // notify() inserts into notificationsTable and simply awaits the
        // values() result; the follows insert chains onConflictDoNothing.
        return thenable({
          onConflictDoNothing: (_cfg: unknown) => thenable(),
          returning: async () => [{ ...v }],
        });
      },
    }),
    update: (_table: unknown) => ({
      set: (_patch: unknown) => ({
        where: (_cond: unknown) => thenable(),
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => ({
        returning: async (_fields: unknown) => {
          if (table === followsTable) {
            // and(eq(followerUserId, user), eq(profileId, profile.id))
            const params = render(cond).params;
            const key = followKey(params[0], params[1]);
            if (state.follows.has(key)) {
              state.follows.delete(key);
              const row = { followerUserId: params[0], profileId: params[1] };
              state.deletedFollows.push(row);
              return [{ id: params[1] }];
            }
          }
          return [];
        },
      }),
    }),
    execute: async () => [],
  };
  void notificationsTable;

  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";

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
  s.profilesById = new Map();
  s.follows = new Set();
  s.insertedFollows = [];
  s.deletedFollows = [];

  s.profilesById.set(PROFILE_ID, {
    id: PROFILE_ID,
    userId: PROFILE_OWNER,
    slug: PROFILE_SLUG,
    displayName: "Wall Owner",
    isPublic: true,
    followerCount: 7,
  });
});

async function post(path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { method: "POST" });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function del(path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { method: "DELETE" });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /api/creator-profiles/:id/follow", () => {
  it("follows BY SLUG — the profile page caller's shape — and records the follow against the resolved UUID", async () => {
    const { status, json } = await post(`/creator-profiles/${PROFILE_SLUG}/follow`);

    expect(status).toBe(200);
    expect(json.followed).toBe(true);
    expect(json.follower_count).toBe(8);
    // The follow row targets the profile the slug resolved to, not a slug.
    expect(h.state.insertedFollows).toHaveLength(1);
    expect(h.state.insertedFollows[0]!["profileId"]).toBe(PROFILE_ID);
    expect(h.state.insertedFollows[0]!["followerUserId"]).toBe(AUTH_USER);
    expect(h.state.follows.has(followKey(AUTH_USER, PROFILE_ID))).toBe(true);
  });

  it("follows BY real UUID still succeeds (discovery FollowButton / shorts callers)", async () => {
    const { status, json } = await post(`/creator-profiles/${PROFILE_ID}/follow`);

    expect(status).toBe(200);
    expect(json.followed).toBe(true);
    expect(json.follower_count).toBe(8);
    expect(h.state.insertedFollows).toHaveLength(1);
    expect(h.state.insertedFollows[0]!["profileId"]).toBe(PROFILE_ID);
  });

  it("404s an unknown slug, same as an unknown id", async () => {
    const { status } = await post(`/creator-profiles/no-such-creator/follow`);
    expect(status).toBe(404);
    expect(h.state.insertedFollows).toHaveLength(0);
  });
});

describe("DELETE /api/creator-profiles/:id/unfollow", () => {
  it("unfollows BY SLUG successfully and removes the follow recorded against the resolved UUID", async () => {
    h.state.follows.add(followKey(AUTH_USER, PROFILE_ID));

    const { status, json } = await del(`/creator-profiles/${PROFILE_SLUG}/unfollow`);

    expect(status).toBe(200);
    expect(json.followed).toBe(false);
    expect(json.follower_count).toBe(6);
    expect(h.state.deletedFollows).toHaveLength(1);
    expect(h.state.deletedFollows[0]!["profileId"]).toBe(PROFILE_ID);
    expect(h.state.follows.has(followKey(AUTH_USER, PROFILE_ID))).toBe(false);
  });

  it("unfollows BY real UUID still succeeds", async () => {
    h.state.follows.add(followKey(AUTH_USER, PROFILE_ID));

    const { status, json } = await del(`/creator-profiles/${PROFILE_ID}/unfollow`);

    expect(status).toBe(200);
    expect(json.followed).toBe(false);
    expect(h.state.follows.has(followKey(AUTH_USER, PROFILE_ID))).toBe(false);
  });
});
