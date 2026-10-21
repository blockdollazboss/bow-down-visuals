/**
 * Route tests for The Front Row in routes/royal-court:
 *   GET /api/creator-profiles/:slug/court            public, rank-ordered
 *   GET /api/creator-profiles/me/court               owner view (auth)
 *   PUT /api/creator-profiles/me/court               replace-all save (auth)
 *   GET /api/creator-profiles/me/court-candidates    picker source (auth)
 *
 * Contract pinned here:
 * - DTOs are explicit camelCase (position/profileId/slug/displayName/
 *   avatarUrl/profileUrl/isPublic) — never raw snake_case rows.
 * - Rank order = stored position order; a crowned member who went
 *   private is filtered from the PUBLIC court (honest gap, no re-rank)
 *   but still visible to the owner with isPublic:false.
 * - A member row whose profile vanished never breaks the read.
 * - Save validates: max 8, no duplicates, no self-crowning, members
 *   must be real creator profiles; the owner is resolved from the
 *   session only — one creator's save never touches another's Court.
 * - /me/court must win over /:slug/court ("me" is not a slug).
 *
 * Fake db mirrors creator-follow-unfollow.test.ts: real table objects
 * via importOriginal, WHERE params read back through PgDialect.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "00000000-0000-4000-8000-0000000000bb";
const NO_PROFILE_USER = "00000000-0000-4000-8000-0000000000cc";

const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE = "22222222-2222-4222-8222-222222222222";
const M1 = "33333333-3333-4333-8333-333333333333";
const M2 = "44444444-4444-4444-8444-444444444444";
const M3 = "55555555-5555-4555-8555-555555555555";
const PRIVATE_MEMBER = "66666666-6666-4666-8666-666666666666";
const GHOST_MEMBER = "77777777-7777-4777-8777-777777777777"; // court row exists, profile row does not
const EXTRA_IDS = Array.from({ length: 9 }, (_, i) =>
  `88888888-8888-4888-8888-88888888888${i}`,
);

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    courtByOwner: new Map<string, Array<Record<string, unknown>>>(),
    follows: new Set<string>(),
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, followsTable, royalCourtTable } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes("ilike")) {
        const needle = String(params[0] ?? "").replace(/%/g, "").toLowerCase();
        return [...state.profilesById.values()].filter(
          (p) =>
            String(p["displayName"]).toLowerCase().includes(needle) ||
            String(p["slug"]).toLowerCase().includes(needle),
        );
      }
      if (sql.includes('"slug"')) {
        const row = [...state.profilesById.values()].find(
          (p) => String(p["slug"]) === String(params[0] ?? ""),
        );
        return row ? [row] : [];
      }
      if (sql.includes('"user_id"')) {
        const row = [...state.profilesById.values()].find(
          (p) => String(p["userId"]) === String(params[0] ?? ""),
        );
        return row ? [row] : [];
      }
      if (sql.includes(" in (")) {
        return params
          .map((id) => state.profilesById.get(String(id)))
          .filter(Boolean);
      }
      if (sql.includes('"id"')) {
        const row = state.profilesById.get(String(params[0] ?? ""));
        return row ? [row] : [];
      }
      return [];
    }
    if (table === royalCourtTable) {
      const rows = state.courtByOwner.get(String(params[0] ?? "")) ?? [];
      return [...rows].sort(
        (a, b) => Number(a["position"]) - Number(b["position"]),
      );
    }
    if (table === followsTable) {
      const userId = String(params[0] ?? "");
      return [...state.follows]
        .filter((k) => k.startsWith(`${userId}:`))
        .map((k) => ({ profileId: k.split(":")[1] }));
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
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = Array.isArray(v) ? v : [v];
        if (table === royalCourtTable) {
          for (const row of rows) {
            const owner = String(row["ownerProfileId"]);
            const list = state.courtByOwner.get(owner) ?? [];
            list.push({ id: `court-${list.length + 1}`, createdAt: new Date(), ...row });
            state.courtByOwner.set(owner, list);
          }
        }
        return thenable({ returning: async () => rows });
      },
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        if (table === royalCourtTable) {
          const owner = String(render(cond).params[0] ?? "");
          state.courtByOwner.set(owner, []);
        }
        return thenable({ returning: async () => [] });
      },
    }),
    update: (_table: unknown) => ({
      set: (_patch: unknown) => ({ where: (_cond: unknown) => thenable() }),
    }),
    execute: async () => [],
  };

  return { ...actual, db: fakeDb };
});

import router from "../royal-court";

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

function profileRow(id: string, userId: string, slug: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    userId,
    slug,
    displayName: name,
    avatarUrl: `https://img.example/${slug}.png`,
    isPublic: true,
    followerCount: 10,
    ...extra,
  };
}

beforeEach(() => {
  const s = h.state;
  s.profilesById = new Map();
  s.courtByOwner = new Map();
  s.follows = new Set();

  s.profilesById.set(OWNER_PROFILE, profileRow(OWNER_PROFILE, OWNER_USER, "court-owner", "Court Owner"));
  s.profilesById.set(OTHER_PROFILE, profileRow(OTHER_PROFILE, OTHER_USER, "other-creator", "Other Creator"));
  s.profilesById.set(M1, profileRow(M1, "u-m1", "member-one", "Member One", { followerCount: 50 }));
  s.profilesById.set(M2, profileRow(M2, "u-m2", "member-two", "Member Two", { followerCount: 30 }));
  s.profilesById.set(M3, profileRow(M3, "u-m3", "member-three", "Member Three", { followerCount: 20 }));
  s.profilesById.set(PRIVATE_MEMBER, profileRow(PRIVATE_MEMBER, "u-priv", "gone-private", "Gone Private", { isPublic: false }));
  EXTRA_IDS.forEach((id, i) =>
    s.profilesById.set(id, profileRow(id, `u-x${i}`, `extra-${i}`, `Extra ${i}`)),
  );
  // GHOST_MEMBER intentionally has NO profile row (deleted-profile residue).

  s.courtByOwner.set(OWNER_PROFILE, [
    { id: "c1", ownerProfileId: OWNER_PROFILE, memberProfileId: M1, position: 1, createdAt: new Date() },
    { id: "c2", ownerProfileId: OWNER_PROFILE, memberProfileId: PRIVATE_MEMBER, position: 2, createdAt: new Date() },
    { id: "c3", ownerProfileId: OWNER_PROFILE, memberProfileId: M2, position: 3, createdAt: new Date() },
    { id: "c4", ownerProfileId: OWNER_PROFILE, memberProfileId: GHOST_MEMBER, position: 4, createdAt: new Date() },
  ]);

  s.follows.add(`${OWNER_USER}:${M1}`);
  s.follows.add(`${OWNER_USER}:${M3}`);
});

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/creator-profiles/:slug/court (public)", () => {
  it("returns the Court rank-ordered with explicit camelCase DTOs", async () => {
    const { status, json } = await call("GET", "/creator-profiles/court-owner/court");
    expect(status).toBe(200);
    // Private member (pos 2) and ghost member (pos 4) are filtered at read.
    expect(json.court.map((m: any) => m.profileId)).toEqual([M1, M2]);
    const first = json.court[0];
    expect(first).toEqual({
      position: 1,
      profileId: M1,
      slug: "member-one",
      displayName: "Member One",
      avatarUrl: "https://img.example/member-one.png",
      profileUrl: "/artist/member-one",
      isPublic: true,
    });
    // Stored rank survives filtering — no silent re-rank (M2 stays #3).
    expect(json.court[1].position).toBe(3);
    expect(json.maxMembers).toBe(8);
  });

  it("404s an unknown slug and a private owner's slug alike", async () => {
    expect((await call("GET", "/creator-profiles/nope/court")).status).toBe(404);
    h.state.profilesById.set(
      "99999999-9999-4999-8999-999999999999",
      profileRow("99999999-9999-4999-8999-999999999999", "u-hidden", "hidden-owner", "Hidden", { isPublic: false }),
    );
    expect((await call("GET", "/creator-profiles/hidden-owner/court")).status).toBe(404);
  });
});

describe("GET /api/creator-profiles/me/court (owner)", () => {
  it("requires auth", async () => {
    expect((await call("GET", "/creator-profiles/me/court")).status).toBe(401);
  });

  it("owner sees every seat — private member included and flagged", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/court", { user: OWNER_USER });
    expect(status).toBe(200);
    expect(json.court.map((m: any) => m.profileId)).toEqual([M1, PRIVATE_MEMBER, M2]);
    expect(json.court[1].isPublic).toBe(false);
    expect(json.court[1].position).toBe(2);
  });

  it("404s when the caller has no creator profile", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/court", { user: NO_PROFILE_USER });
    expect(status).toBe(404);
    expect(json.error).toBe("NO_PROFILE");
  });
});

describe("PUT /api/creator-profiles/me/court (save)", () => {
  it("requires auth and an existing profile", async () => {
    expect((await call("PUT", "/creator-profiles/me/court", { body: { memberProfileIds: [] } })).status).toBe(401);
    const { status } = await call("PUT", "/creator-profiles/me/court", { user: NO_PROFILE_USER, body: { memberProfileIds: [] } });
    expect(status).toBe(404);
  });

  it("saves in the given order as positions 1..n and confirms what saved", async () => {
    const { status, json } = await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: [M3, M1] },
    });
    expect(status).toBe(200);
    expect(json.saved).toBe(true);
    expect(json.court.map((m: any) => [m.position, m.profileId])).toEqual([
      [1, M3],
      [2, M1],
    ]);
    // And the public read now serves the new Court.
    const pub = await call("GET", "/creator-profiles/court-owner/court");
    expect(pub.json.court.map((m: any) => m.profileId)).toEqual([M3, M1]);
  });

  it("an empty Court is a valid save (clears all seats)", async () => {
    const { status, json } = await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: [] },
    });
    expect(status).toBe(200);
    expect(json.court).toEqual([]);
  });

  it("rejects a 9th seat — the Front Row holds at most 8", async () => {
    const { status, json } = await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: EXTRA_IDS },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("COURT_FULL");
    expect(json.message).toContain("The Front Row holds at most 8");
    expect(json.message).not.toContain("Royal Court");
  });

  it("rejects duplicates, self-crowning, unknown and malformed members", async () => {
    const dup = await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: [M1, M1] },
    });
    expect(dup.status).toBe(400);
    expect(dup.json.error).toBe("DUPLICATE_MEMBER");

    const self = await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: [OWNER_PROFILE] },
    });
    expect(self.status).toBe(400);
    expect(self.json.error).toBe("SELF_CROWN");

    const ghost = await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: [GHOST_MEMBER] },
    });
    expect(ghost.status).toBe(400);
    expect(ghost.json.error).toBe("MEMBER_NOT_FOUND");

    const bad = await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: ["not-a-uuid"] },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("INVALID_MEMBER");
  });

  it("one creator's save never touches another creator's Court", async () => {
    h.state.courtByOwner.set(OTHER_PROFILE, [
      { id: "o1", ownerProfileId: OTHER_PROFILE, memberProfileId: M1, position: 1, createdAt: new Date() },
    ]);
    await call("PUT", "/creator-profiles/me/court", {
      user: OWNER_USER,
      body: { memberProfileIds: [M2] },
    });
    const other = await call("GET", "/creator-profiles/me/court", { user: OTHER_USER });
    expect(other.json.court.map((m: any) => m.profileId)).toEqual([M1]);
  });
});

describe("GET /api/creator-profiles/me/court-candidates (picker)", () => {
  it("without a query, returns the creators the caller follows — never themselves", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/court-candidates", { user: OWNER_USER });
    expect(status).toBe(200);
    const ids = json.candidates.map((c: any) => c.profileId);
    expect(ids).toEqual([M1, M3]); // followerCount order: 50 before 20
    expect(json.candidates[0]).toMatchObject({
      slug: "member-one",
      displayName: "Member One",
      profileUrl: "/artist/member-one",
      isFollowing: true,
    });
    expect(ids).not.toContain(OWNER_PROFILE);
  });

  it("with a query, searches public creators and flags who is followed", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/court-candidates?q=member", { user: OWNER_USER });
    expect(status).toBe(200);
    const ids = json.candidates.map((c: any) => c.profileId);
    expect(ids).toContain(M1);
    expect(ids).toContain(M2);
    expect(ids).toContain(M3);
    const m2 = json.candidates.find((c: any) => c.profileId === M2);
    expect(m2.isFollowing).toBe(false);
    // Private profiles never surface in search.
    expect(ids).not.toContain(PRIVATE_MEMBER);
  });

  it("requires auth", async () => {
    expect((await call("GET", "/creator-profiles/me/court-candidates")).status).toBe(401);
  });
});
