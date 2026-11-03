/**
 * Route tests for the group role ladder's truth (routes/community) —
 * stack1100 groups/forum truth lane.
 *
 * THE CONVICTIONS PINNED HERE:
 *  F1 — Feed moderation checked the raw stored role against the
 *    legacy "mod" string only, so a moderator stored under the
 *    canonical "moderator" value (the only value the role PATCH can
 *    write) and every admin were REFUSED the deletePost power the
 *    ladder grants them — in the feed DTO's can_delete and in the
 *    DELETE route alike. Both now ride canGroupAction(role,
 *    "deletePost"), which normalizes legacy "mod" too.
 *  F2 — POST /groups/:slug/join inserted membership unconditionally,
 *    walking straight around a group's join questions — the approval
 *    gate the onboarding panel promises ("the admins read your
 *    answers when they decide"). A group with questions now answers
 *    direct joins 409; membership lands only through an approved
 *    join request. Question-free groups keep direct joins.
 *  F3 — Member removal was owner-only in the route while the ladder
 *    (group-roles.ts) and the my-role caps advertise removeMember at
 *    admin+. The route now enforces the ladder, with the target
 *    strictly below the actor's rung (the canAssignRole rule): no
 *    removing the owner, no admin removing a peer admin. The detail
 *    DTO carries per-member can_remove / assignable_roles computed
 *    from the same rules so clients render only honourable controls.
 *  F5 — The owner-leave refusal pointed at a handoff flow that did
 *    not exist ("hand off ownership first"); stack1100 made the copy
 *    admit that, and stack1400 ruling #10 built the transfer door, so
 *    the copy now points at the real handoff.
 *
 * Harness mirrors community-forum.test.ts: the REAL router + REAL
 * table objects, a fake db that renders drizzle conditions with
 * PgDialect and evaluates them against in-memory state.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN2 = "12121212-1212-4212-8212-121212121212";
const MOD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LEGACY_MOD = "34343434-3434-4434-8434-343434343434";
const MEMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MEMBER2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTSIDER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const PUBLIC_GROUP = "11111111-1111-4111-8111-111111111111";
const OWNER_PROFILE = "22222222-2222-4222-8222-222222222222";

const TOKEN_USERS: Record<string, string> = {
  "owner-token": OWNER,
  "admin-token": ADMIN,
  "admin2-token": ADMIN2,
  "mod-token": MOD,
  "legacy-mod-token": LEGACY_MOD,
  "member-token": MEMBER,
  "member2-token": MEMBER2,
  "outsider-token": OUTSIDER,
};

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  state: {
    groups: [] as Row[],
    members: [] as Row[],
    profiles: [] as Row[],
    posts: [] as Row[],
    questions: [] as Row[],
    notifications: [] as Row[],
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const token = String(req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
    const userId = (globalThis as any).__ladderTokenUsers?.[token];
    if (!userId) { res.status(401).json({ error: "Sign in required." }); return; }
    req.userId = userId;
    next();
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const userId = (globalThis as any).__ladderTokenUsers?.[token];
        return { data: { user: userId ? { id: userId } : null } };
      },
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

/* The group-join notification rides the push door — out of scope here. */
vi.mock("../../lib/push-events", () => ({
  notifyUserEvent: async () => ({}),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    groupsTable, groupMembersTable, creatorProfilesTable, notificationsTable,
    groupPostsTable, groupJoinQuestionsTable,
  } = actual;

  const dialect = new PgDialect();

  function tableRows(table: unknown): Row[] {
    if (table === groupsTable) return state.groups;
    if (table === groupMembersTable) return state.members;
    if (table === creatorProfilesTable) return state.profiles;
    if (table === notificationsTable) return state.notifications;
    if (table === groupPostsTable) return state.posts;
    if (table === groupJoinQuestionsTable) return state.questions;
    return [];
  }

  function colToProp(table: unknown): Map<string, string> {
    const map = new Map<string, string>();
    for (const [prop, col] of Object.entries(getTableColumns(table as never) as Record<string, { name: string }>)) {
      map.set(col.name, prop);
    }
    return map;
  }

  function matches(table: unknown, row: Row, cond: unknown): boolean {
    if (cond === undefined || cond === null) return true;
    const { sql, params } = dialect.sqlToQuery(cond as never) as { sql: string; params: unknown[] };
    const cols = colToProp(table);
    const inRe = /"([a-z_]+)"\s+in\s+\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    while ((m = inRe.exec(sql)) !== null) {
      const prop = cols.get(m[1]);
      const idxs = [...m[2].matchAll(/\$(\d+)/g)].map((x) => Number(x[1]) - 1);
      if (!prop || !idxs.some((i) => row[prop] === params[i])) return false;
    }
    const eqRe = /"([a-z_]+)"\s*=\s*\$(\d+)/g;
    while ((m = eqRe.exec(sql)) !== null) {
      const prop = cols.get(m[1]);
      if (!prop || row[prop] !== params[Number(m[2]) - 1]) return false;
    }
    return true;
  }

  function canonicalSort(table: unknown, rows: Row[]): Row[] {
    const out = [...rows];
    if (table === groupMembersTable) {
      out.sort((a, b) => (a.joinedAt as Date).getTime() - (b.joinedAt as Date).getTime());
    } else if (table === groupPostsTable) {
      out.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
    } else if (table === groupsTable) {
      out.sort((a, b) => b.memberCount - a.memberCount);
    }
    return out;
  }

  function isSqlValue(v: unknown): boolean {
    return typeof v === "object" && v !== null && "queryChunks" in (v as Record<string, unknown>);
  }

  function selectChain(table: unknown, fields?: Record<string, unknown>): any {
    let rows = [...tableRows(table)];
    const finish = (limitN?: number) => {
      let out = canonicalSort(table, rows);
      if (fields && Object.keys(fields).length > 0) {
        const keys = Object.keys(fields);
        out = out.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));
      }
      return limitN !== undefined ? out.slice(0, limitN) : out;
    };
    const chain: any = {
      where: (cond: unknown) => { rows = rows.filter((r) => matches(table, r, cond)); return chain; },
      orderBy: (..._args: unknown[]) => chain,
      groupBy: (..._args: unknown[]) => chain,
      limit: async (n: number) => finish(n),
      then: (res: any, rej: any) => Promise.resolve(finish()).then(res, rej),
    };
    return chain;
  }

  function applyDefaults(table: unknown, v: Row): Row {
    const row: Row = { id: randomUUID(), createdAt: new Date(), ...v };
    if (table === notificationsTable) { row.isRead ??= false; row.body ??= ""; row.link ??= ""; }
    if (table === groupsTable) { row.memberCount ??= 0; row.isPublic ??= true; row.description ??= ""; }
    if (table === groupMembersTable) { row.role ??= "member"; row.joinedAt ??= new Date(); }
    if (table === groupPostsTable) { row.likeCount ??= 0; }
    return row;
  }

  function applySet(row: Row, patch: Record<string, unknown>) {
    for (const [key, value] of Object.entries(patch)) {
      if (isSqlValue(value)) {
        const { sql } = dialect.sqlToQuery(value as never) as { sql: string };
        if (/member_count/.test(sql) && /\+ 1/.test(sql)) row.memberCount = (row.memberCount ?? 0) + 1;
        else if (/member_count/.test(sql) && /greatest/i.test(sql)) row.memberCount = Math.max(0, (row.memberCount ?? 0) - 1);
        continue;
      }
      row[key] = value;
    }
  }

  const fakeDb: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => selectChain(table, fields),
    }),
    insert: (table: unknown) => ({
      values: (v: Row | Row[]) => {
        let applied: Row[] | null = null;
        const apply = () => {
          if (applied) return applied;
          const list = (Array.isArray(v) ? v : [v]).map((item) => applyDefaults(table, { ...item }));
          tableRows(table).push(...list);
          applied = list;
          return list;
        };
        const chain: any = {
          returning: async () => apply().map((r) => ({ ...r })),
          then: (res: any, rej: any) => { apply(); return Promise.resolve([]).then(res, rej); },
        };
        return chain;
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const apply = () => {
            const hit = tableRows(table).filter((r) => matches(table, r, cond));
            for (const row of hit) applySet(row, patch);
            return hit;
          };
          const chain: any = {
            returning: async () => apply().map((r) => ({ ...r })),
            then: (res: any, rej: any) => { apply(); return Promise.resolve([]).then(res, rej); },
          };
          return chain;
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const rows = tableRows(table);
        const kept = rows.filter((r) => !matches(table, r, cond));
        rows.length = 0;
        rows.push(...kept);
      },
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../community";

const T0 = new Date("2026-09-01T12:00:00.000Z");
const POST_ID = "55555555-5555-4555-8555-555555555555";
const POST2_ID = "56565656-5656-4656-8656-565656565656";

function seed() {
  const s = h.state;
  s.groups = [
    { id: PUBLIC_GROUP, slug: "wave-makers", name: "Wave Makers", description: "Public crew.", coverUrl: null, ownerProfileId: OWNER_PROFILE, memberCount: 7, isPublic: true, createdAt: T0 },
  ];
  s.profiles = [
    { id: OWNER_PROFILE, userId: OWNER, slug: "crew-owner", displayName: "Crew Owner", avatarUrl: null },
    { id: "33333333-3333-4333-8333-333333333333", userId: MEMBER, slug: "wave-member", displayName: "Wave Member", avatarUrl: null },
  ];
  // The moderator's stored role is the CANONICAL "moderator" value —
  // the only value the role PATCH endpoint can write today. LEGACY_MOD
  // carries the pre-ladder "mod" value older rows may still hold.
  s.members = [
    { groupId: PUBLIC_GROUP, userId: OWNER, role: "owner", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: ADMIN, role: "admin", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: ADMIN2, role: "admin", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: MOD, role: "moderator", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: LEGACY_MOD, role: "mod", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: MEMBER, role: "member", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: MEMBER2, role: "member", joinedAt: T0 },
  ];
  s.posts = [
    { id: POST_ID, groupId: PUBLIC_GROUP, authorUserId: MEMBER, body: "Member's post.", likeCount: 0, createdAt: T0 },
    { id: POST2_ID, groupId: PUBLIC_GROUP, authorUserId: MEMBER2, body: "Second member's post.", likeCount: 0, createdAt: T0 },
  ];
  s.questions = [];
  s.notifications = [];
}

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  (globalThis as any).__ladderTokenUsers = TOKEN_USERS;
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

beforeEach(() => { seed(); });

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function memberRow(userId: string) {
  return h.state.members.find((m) => m.userId === userId);
}

describe("F1 — feed moderation rides the ladder, not the legacy string", () => {
  it("the feed DTO grants can_delete to a canonical moderator and an admin", async () => {
    const asMod = await call("GET", "/groups/wave-makers/feed", "mod-token");
    expect(asMod.status).toBe(200);
    expect(asMod.json.posts.find((p: any) => p.id === POST_ID).can_delete).toBe(true);
    const asAdmin = await call("GET", "/groups/wave-makers/feed", "admin-token");
    expect(asAdmin.json.posts.find((p: any) => p.id === POST_ID).can_delete).toBe(true);
    const asMember = await call("GET", "/groups/wave-makers/feed", "member2-token");
    expect(asMember.json.posts.find((p: any) => p.id === POST_ID).can_delete).toBe(false);
  });

  it("a canonical moderator can delete another member's feed post", async () => {
    const r = await call("DELETE", `/groups/wave-makers/posts/${POST_ID}`, "mod-token");
    expect(r.status).toBe(200);
    expect(h.state.posts.some((p) => p.id === POST_ID)).toBe(false);
  });

  it("an admin can delete another member's feed post", async () => {
    const r = await call("DELETE", `/groups/wave-makers/posts/${POST_ID}`, "admin-token");
    expect(r.status).toBe(200);
    expect(h.state.posts.some((p) => p.id === POST_ID)).toBe(false);
  });

  it("a legacy 'mod' row keeps its moderation power", async () => {
    const r = await call("DELETE", `/groups/wave-makers/posts/${POST_ID}`, "legacy-mod-token");
    expect(r.status).toBe(200);
  });

  it("a plain member still cannot delete someone else's post — but the author can", async () => {
    const refused = await call("DELETE", `/groups/wave-makers/posts/${POST_ID}`, "member2-token");
    expect(refused.status).toBe(403);
    const own = await call("DELETE", `/groups/wave-makers/posts/${POST_ID}`, "member-token");
    expect(own.status).toBe(200);
  });

  it("a non-member cannot delete a feed post", async () => {
    const r = await call("DELETE", `/groups/wave-makers/posts/${POST_ID}`, "outsider-token");
    expect(r.status).toBe(403);
  });
});

describe("F3 — member removal rides the ladder, targets strictly below", () => {
  it("an admin can remove a member, and the count follows", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${MEMBER}`, "admin-token");
    expect(r.status).toBe(200);
    expect(memberRow(MEMBER)).toBeUndefined();
    expect(h.state.groups[0].memberCount).toBe(6);
  });

  it("an admin can remove a moderator (below their rung)", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${MOD}`, "admin-token");
    expect(r.status).toBe(200);
    expect(memberRow(MOD)).toBeUndefined();
  });

  it("an admin cannot remove a peer admin", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${ADMIN2}`, "admin-token");
    expect(r.status).toBe(403);
    expect(memberRow(ADMIN2)).toBeDefined();
  });

  it("an admin cannot remove the owner", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${OWNER}`, "admin-token");
    expect(r.status).toBe(403);
    expect(memberRow(OWNER)).toBeDefined();
  });

  it("a moderator cannot remove anyone (the rung is admin+)", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${MEMBER}`, "mod-token");
    expect(r.status).toBe(403);
    expect(memberRow(MEMBER)).toBeDefined();
  });

  it("the owner can remove an admin", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${ADMIN}`, "owner-token");
    expect(r.status).toBe(200);
    expect(memberRow(ADMIN)).toBeUndefined();
  });

  it("nobody removes themself through this door", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${OWNER}`, "owner-token");
    expect(r.status).toBe(400);
  });

  it("the detail DTO's per-member caps mirror the route exactly", async () => {
    const asAdmin = await call("GET", "/groups/wave-makers", "admin-token");
    const byId = new Map(asAdmin.json.members.map((m: any) => [m.user_id, m]));
    expect(byId.get(MEMBER).can_remove).toBe(true);
    expect(byId.get(MOD).can_remove).toBe(true);
    expect(byId.get(ADMIN2).can_remove).toBe(false);
    expect(byId.get(OWNER).can_remove).toBe(false);
    expect(byId.get(ADMIN).can_remove).toBe(false); // self row

    const asMod = await call("GET", "/groups/wave-makers", "mod-token");
    for (const m of asMod.json.members) expect(m.can_remove).toBe(false);

    const asOwner = await call("GET", "/groups/wave-makers", "owner-token");
    const ownerView = new Map(asOwner.json.members.map((m: any) => [m.user_id, m]));
    expect(ownerView.get(ADMIN).can_remove).toBe(true);
    expect(ownerView.get(OWNER).can_remove).toBe(false);
  });

  it("assignable_roles mirrors canAssignRole per member", async () => {
    const asOwner = await call("GET", "/groups/wave-makers", "owner-token");
    const ownerView = new Map(asOwner.json.members.map((m: any) => [m.user_id, m]));
    expect(ownerView.get(MEMBER).assignable_roles).toEqual(["admin", "moderator", "member"]);
    expect(ownerView.get(OWNER).assignable_roles).toEqual([]);

    const asAdmin = await call("GET", "/groups/wave-makers", "admin-token");
    const adminView = new Map(asAdmin.json.members.map((m: any) => [m.user_id, m]));
    expect(adminView.get(MEMBER).assignable_roles).toEqual(["moderator", "member"]);
    expect(adminView.get(ADMIN2).assignable_roles).toEqual([]);
    expect(adminView.get(OWNER).assignable_roles).toEqual([]);

    const asMod = await call("GET", "/groups/wave-makers", "mod-token");
    for (const m of asMod.json.members) expect(m.assignable_roles).toEqual([]);
  });
});

describe("F2 — direct join honours the join-questions gate", () => {
  it("a group with join questions refuses a direct join and admits nobody", async () => {
    h.state.questions = [
      { id: "99999999-9999-4999-8999-999999999999", group_id: PUBLIC_GROUP, question: "Why do you want in?", position: 0 },
    ];
    const r = await call("POST", "/groups/wave-makers/join", "outsider-token");
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/join request/i);
    expect(memberRow(OUTSIDER)).toBeUndefined();
    expect(h.state.groups[0].memberCount).toBe(7);
  });

  it("a question-free group still takes a direct join", async () => {
    const r = await call("POST", "/groups/wave-makers/join", "outsider-token");
    expect(r.status).toBe(201);
    expect(memberRow(OUTSIDER)?.role).toBe("member");
    expect(h.state.groups[0].memberCount).toBe(8);
  });

  it("an existing member re-joining is still a 409, questions or not", async () => {
    const r = await call("POST", "/groups/wave-makers/join", "member-token");
    expect(r.status).toBe(409);
  });
});

describe("F5 — the owner-leave refusal names the handoff that now exists", () => {
  /* Stack1400 ruling #10 supersedes the stack1100 copy: the transfer
     door (POST /groups/:slug/transfer) is real now, so the refusal
     points AT it instead of admitting it doesn't exist. The full
     transfer behaviour is pinned in
     community-groups-transfer-settings.test.ts. */
  it("owner leave is refused with copy that points at the transfer door", async () => {
    const r = await call("POST", "/groups/wave-makers/leave", "owner-token");
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/transfer ownership/i);
    expect(r.json.error).not.toMatch(/can't be handed off yet/i);
    expect(memberRow(OWNER)).toBeDefined();
  });
});
