/**
 * Route tests for group bans (stack1400 ruling #11, Y4 OD2) —
 * routes/community.ts.
 *
 * THE CONVICTIONS PINNED HERE:
 *  B1 — A ban is a durable group_bans row, separate from membership:
 *    removal deletes the membership row, and the ban SURVIVES that
 *    deletion — a banned user refused at the direct-join door even
 *    though they hold no membership row anymore. (Before this ruling,
 *    removal alone meant instant rejoin.)
 *  B2 — Ban/unban sit at the ladder's banMember/unbanMember rungs
 *    (admin+; peace law: punishment only on an owner/admin's
 *    command). Members, moderators and outsiders cannot ban, unban,
 *    or even read the banned list. A member target must sit strictly
 *    below the actor — no banning the owner, no peer-admin bans, no
 *    self-ban.
 *  B3 — Banning a member removes them in the same breath (membership
 *    and ban never coexist) and the member count follows. The
 *    standalone ban door also covers a non-member.
 *  B4 — Remove-and-ban (DELETE members/:userId?ban=1) writes the ban;
 *    a PLAIN removal writes none — the removed person can rejoin.
 *  B5 — Unban deletes the ban row and joining is restored.
 *  B6 — The detail DTO's per-member can_ban + viewer can_ban mirror
 *    the routes exactly, so the client renders only honourable
 *    controls.
 *
 * Harness mirrors community-groups-ladder.test.ts: the REAL router +
 * REAL table objects, a fake db that renders drizzle conditions with
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
  "member-token": MEMBER,
  "member2-token": MEMBER2,
  "outsider-token": OUTSIDER,
};

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  state: {
    groups: [] as Row[],
    members: [] as Row[],
    bans: [] as Row[],
    profiles: [] as Row[],
    posts: [] as Row[],
    questions: [] as Row[],
    notifications: [] as Row[],
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const token = String(req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
    const userId = (globalThis as any).__banTokenUsers?.[token];
    if (!userId) { res.status(401).json({ error: "Sign in required." }); return; }
    req.userId = userId;
    next();
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const userId = (globalThis as any).__banTokenUsers?.[token];
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

vi.mock("../../lib/push-events", () => ({
  notifyUserEvent: async () => ({}),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    groupsTable, groupMembersTable, groupBansTable, creatorProfilesTable, notificationsTable,
    groupPostsTable, groupJoinQuestionsTable,
  } = actual;

  const dialect = new PgDialect();

  function tableRows(table: unknown): Row[] {
    if (table === groupsTable) return state.groups;
    if (table === groupMembersTable) return state.members;
    if (table === groupBansTable) return state.bans;
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
    } else if (table === groupBansTable) {
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
    if (table === groupBansTable) { row.reason ??= null; }
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

function seed() {
  const s = h.state;
  s.groups = [
    { id: PUBLIC_GROUP, slug: "wave-makers", name: "Wave Makers", description: "Public crew.", coverUrl: null, ownerProfileId: OWNER_PROFILE, memberCount: 6, isPublic: true, createdAt: T0 },
  ];
  s.profiles = [
    { id: OWNER_PROFILE, userId: OWNER, slug: "crew-owner", displayName: "Crew Owner", avatarUrl: null },
    { id: "33333333-3333-4333-8333-333333333333", userId: MEMBER, slug: "wave-member", displayName: "Wave Member", avatarUrl: null },
    { id: "44444444-4444-4444-8444-444444444444", userId: OUTSIDER, slug: "wave-outsider", displayName: "Wave Outsider", avatarUrl: null },
  ];
  s.members = [
    { groupId: PUBLIC_GROUP, userId: OWNER, role: "owner", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: ADMIN, role: "admin", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: ADMIN2, role: "admin", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: MOD, role: "moderator", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: MEMBER, role: "member", joinedAt: T0 },
    { groupId: PUBLIC_GROUP, userId: MEMBER2, role: "member", joinedAt: T0 },
  ];
  s.bans = [];
  s.posts = [];
  s.questions = [];
  s.notifications = [];
}

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  (globalThis as any).__banTokenUsers = TOKEN_USERS;
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
function banRow(userId: string) {
  return h.state.bans.find((b) => b.userId === userId);
}
function seedBan(userId: string, bannedBy: string = ADMIN, reason: string | null = "Seeded ban.") {
  h.state.bans.push({ groupId: PUBLIC_GROUP, userId, bannedByUserId: bannedBy, reason, createdAt: T0 });
}

describe("B1 — a banned user is refused at the direct-join door", () => {
  it("a seeded ban refuses the join, admits nobody, and names the ban", async () => {
    seedBan(OUTSIDER);
    const r = await call("POST", "/groups/wave-makers/join", "outsider-token");
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/banned/i);
    expect(memberRow(OUTSIDER)).toBeUndefined();
    expect(h.state.groups[0].memberCount).toBe(6);
  });

  it("the ban is checked before the join-questions gate (no detour through a request)", async () => {
    seedBan(OUTSIDER);
    h.state.questions = [
      { id: "99999999-9999-4999-8999-999999999999", group_id: PUBLIC_GROUP, question: "Why do you want in?", position: 0 },
    ];
    const r = await call("POST", "/groups/wave-makers/join", "outsider-token");
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/banned/i);
  });

  it("an unbanned outsider still joins the question-free group (control)", async () => {
    const r = await call("POST", "/groups/wave-makers/join", "outsider-token");
    expect(r.status).toBe(201);
    expect(memberRow(OUTSIDER)?.role).toBe("member");
  });
});

describe("B3/B1 — the standalone ban door: banning a member removes them, and the ban survives", () => {
  it("an admin bans a member: membership gone, count follows, ban row records who and why", async () => {
    const r = await call("POST", "/groups/wave-makers/bans", "admin-token", { userId: MEMBER, reason: "Kept spamming the feed." });
    expect(r.status).toBe(201);
    expect(memberRow(MEMBER)).toBeUndefined();
    expect(h.state.groups[0].memberCount).toBe(5);
    const ban = banRow(MEMBER);
    expect(ban).toBeDefined();
    expect(ban.bannedByUserId).toBe(ADMIN);
    expect(ban.reason).toBe("Kept spamming the feed.");
  });

  it("after the ban, the (deleted) member still cannot rejoin — the ban outlives the membership row", async () => {
    await call("POST", "/groups/wave-makers/bans", "admin-token", { userId: MEMBER });
    expect(memberRow(MEMBER)).toBeUndefined();
    const r = await call("POST", "/groups/wave-makers/join", "member-token");
    expect(r.status).toBe(403);
    expect(r.json.error).toMatch(/banned/i);
    expect(memberRow(MEMBER)).toBeUndefined();
  });

  it("the standalone door also bans a non-member, and the door stays closed to them", async () => {
    const r = await call("POST", "/groups/wave-makers/bans", "owner-token", { userId: OUTSIDER });
    expect(r.status).toBe(201);
    expect(banRow(OUTSIDER)).toBeDefined();
    const join = await call("POST", "/groups/wave-makers/join", "outsider-token");
    expect(join.status).toBe(403);
  });

  it("banning an already-banned user is idempotent — one row, no error", async () => {
    await call("POST", "/groups/wave-makers/bans", "admin-token", { userId: OUTSIDER });
    const again = await call("POST", "/groups/wave-makers/bans", "admin-token", { userId: OUTSIDER });
    expect(again.status).toBe(200);
    expect(again.json.already_banned).toBe(true);
    expect(h.state.bans.filter((b) => b.userId === OUTSIDER)).toHaveLength(1);
  });
});

describe("B4 — remove-and-ban vs plain removal", () => {
  it("DELETE members/:userId?ban=1 removes AND bans; rejoin is refused", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${MEMBER}?ban=1`, "admin-token");
    expect(r.status).toBe(200);
    expect(r.json.banned).toBe(true);
    expect(memberRow(MEMBER)).toBeUndefined();
    expect(banRow(MEMBER)).toBeDefined();
    const join = await call("POST", "/groups/wave-makers/join", "member-token");
    expect(join.status).toBe(403);
  });

  it("a plain removal (no ?ban=1) writes no ban — the removed member can rejoin at once", async () => {
    const r = await call("DELETE", `/groups/wave-makers/members/${MEMBER}`, "admin-token");
    expect(r.status).toBe(200);
    expect(r.json.banned).toBe(false);
    expect(banRow(MEMBER)).toBeUndefined();
    const join = await call("POST", "/groups/wave-makers/join", "member-token");
    expect(join.status).toBe(201);
    expect(memberRow(MEMBER)?.role).toBe("member");
  });
});

describe("B2 — the ladder guards every ban door (peace law: owner/admin command only)", () => {
  it("a plain member cannot ban anyone", async () => {
    const r = await call("POST", "/groups/wave-makers/bans", "member-token", { userId: MEMBER2 });
    expect(r.status).toBe(403);
    expect(banRow(MEMBER2)).toBeUndefined();
    expect(memberRow(MEMBER2)).toBeDefined();
  });

  it("a moderator cannot ban — the rung is admin+, not the moderation rung", async () => {
    const r = await call("POST", "/groups/wave-makers/bans", "mod-token", { userId: MEMBER });
    expect(r.status).toBe(403);
    expect(banRow(MEMBER)).toBeUndefined();
  });

  it("a non-member cannot ban", async () => {
    const r = await call("POST", "/groups/wave-makers/bans", "outsider-token", { userId: MEMBER });
    expect(r.status).toBe(403);
    expect(banRow(MEMBER)).toBeUndefined();
  });

  it("an admin cannot ban a peer admin or the owner; the owner can ban an admin", async () => {
    expect((await call("POST", "/groups/wave-makers/bans", "admin-token", { userId: ADMIN2 })).status).toBe(403);
    expect((await call("POST", "/groups/wave-makers/bans", "admin-token", { userId: OWNER })).status).toBe(403);
    expect(banRow(ADMIN2)).toBeUndefined();
    expect(banRow(OWNER)).toBeUndefined();
    const byOwner = await call("POST", "/groups/wave-makers/bans", "owner-token", { userId: ADMIN });
    expect(byOwner.status).toBe(201);
    expect(banRow(ADMIN)).toBeDefined();
    expect(memberRow(ADMIN)).toBeUndefined();
  });

  it("nobody bans themself", async () => {
    const r = await call("POST", "/groups/wave-makers/bans", "owner-token", { userId: OWNER });
    expect(r.status).toBe(400);
    expect(banRow(OWNER)).toBeUndefined();
  });

  it("the banned list is admin+ only — members and moderators can't read it", async () => {
    seedBan(MEMBER, ADMIN, "Spam.");
    expect((await call("GET", "/groups/wave-makers/bans", "member2-token")).status).toBe(403);
    expect((await call("GET", "/groups/wave-makers/bans", "mod-token")).status).toBe(403);
    const asAdmin = await call("GET", "/groups/wave-makers/bans", "admin-token");
    expect(asAdmin.status).toBe(200);
    expect(asAdmin.json.bans).toHaveLength(1);
    expect(asAdmin.json.bans[0].user_id).toBe(MEMBER);
    expect(asAdmin.json.bans[0].banned_by_user_id).toBe(ADMIN);
    expect(asAdmin.json.bans[0].reason).toBe("Spam.");
    expect(asAdmin.json.bans[0].profile?.displayName).toBe("Wave Member");
  });

  it("a member cannot unban; a moderator cannot remove-and-ban (the ban half needs the rung)", async () => {
    seedBan(MEMBER);
    expect((await call("DELETE", `/groups/wave-makers/bans/${MEMBER}`, "member2-token")).status).toBe(403);
    expect(banRow(MEMBER)).toBeDefined();
    // A moderator holds neither removal nor ban power; the remove-and-
    // ban door refuses them at the removal rung and bans nobody.
    expect((await call("DELETE", `/groups/wave-makers/members/${MEMBER}?ban=1`, "mod-token")).status).toBe(403);
    expect(memberRow(MEMBER)).toBeDefined();
  });
});

describe("B5 — unban restores joining", () => {
  it("unban deletes the row; the formerly banned user joins again", async () => {
    seedBan(OUTSIDER);
    expect((await call("POST", "/groups/wave-makers/join", "outsider-token")).status).toBe(403);
    const un = await call("DELETE", `/groups/wave-makers/bans/${OUTSIDER}`, "admin-token");
    expect(un.status).toBe(200);
    expect(banRow(OUTSIDER)).toBeUndefined();
    const join = await call("POST", "/groups/wave-makers/join", "outsider-token");
    expect(join.status).toBe(201);
    expect(memberRow(OUTSIDER)?.role).toBe("member");
  });

  it("unbanning someone who isn't banned is a 404, not a silent ok", async () => {
    const r = await call("DELETE", `/groups/wave-makers/bans/${OUTSIDER}`, "admin-token");
    expect(r.status).toBe(404);
  });

  it("a banned member who is unbanned can be re-admitted through a fresh ban-free cycle", async () => {
    await call("POST", "/groups/wave-makers/bans", "admin-token", { userId: MEMBER });
    await call("DELETE", `/groups/wave-makers/bans/${MEMBER}`, "owner-token");
    const join = await call("POST", "/groups/wave-makers/join", "member-token");
    expect(join.status).toBe(201);
  });
});

describe("B6 — the detail DTO's ban caps mirror the routes", () => {
  it("as admin: can_ban true only for targets strictly below; viewer can_ban true", async () => {
    const asAdmin = await call("GET", "/groups/wave-makers", "admin-token");
    const byId = new Map(asAdmin.json.members.map((m: any) => [m.user_id, m]));
    expect(byId.get(MEMBER).can_ban).toBe(true);
    expect(byId.get(MOD).can_ban).toBe(true);
    expect(byId.get(ADMIN2).can_ban).toBe(false);
    expect(byId.get(OWNER).can_ban).toBe(false);
    expect(byId.get(ADMIN).can_ban).toBe(false); // self row
    expect(asAdmin.json.can_ban).toBe(true);
  });

  it("as member or moderator: no can_ban anywhere; viewer can_ban false", async () => {
    const asMember = await call("GET", "/groups/wave-makers", "member-token");
    expect(asMember.json.can_ban).toBe(false);
    for (const m of asMember.json.members) expect(m.can_ban).toBe(false);
    const asMod = await call("GET", "/groups/wave-makers", "mod-token");
    expect(asMod.json.can_ban).toBe(false);
    const asOwner = await call("GET", "/groups/wave-makers", "owner-token");
    expect(asOwner.json.can_ban).toBe(true);
  });
});
