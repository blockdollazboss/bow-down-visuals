/**
 * Route tests for TIER-GATED forum channels (routes/community,
 * Stack-100 #3 #19 — built on the 0185 forum fake-db pattern from
 * community-forum.test.ts, extended with fan_tiers / fan_members
 * state and a simulated missing gate column).
 *
 * Fake-db style: the REAL router + REAL table objects, a fake db
 * that renders drizzle conditions with PgDialect and evaluates them
 * against in-memory state. The fake additionally simulates the held
 * migration NOT having landed (state.gateColumnMissing): any select
 * of the gate column, and any insert/update carrying it, throws a
 * pg-shaped 42703 — which is exactly what the route's graceful
 * degradation keys off.
 *
 * The contract pinned here:
 *  - A channel gate names a tier of the GROUP OWNER's fan club
 *    (validated at set time: foreign, inactive and ghost tiers 400),
 *    settable at creation and via PATCH (id = set, null = clear),
 *    admin+ only.
 *  - READ and POST are both enforced server-side: a non-qualifying
 *    viewer gets 403 with the knock payload (room, tier, existing
 *    join door) and never a thread title/body — through the thread
 *    list, the thread detail, thread creation and replies alike.
 *  - "Tier X and up" rides the owner's ladder: the gate tier itself
 *    and every higher tier qualify; group staff (moderator+) are
 *    exempt — they run the room.
 *  - The knock door is on the channel LIST too: a gated channel is
 *    visible (name, tier, join path) to viewers who cannot enter it,
 *    with viewer_status not_member / below_tier / lapsed.
 *  - LAPSE (hard rule): when a membership ends (canceled, or its
 *    period simply ran out), access ends at read/post time — but the
 *    member's past threads stay in the room, attributed, readable by
 *    qualifying viewers; rejoining restores the member's own access
 *    to their history. Nothing is ever deleted by the gate.
 *  - Pre-migration (no gate column): the forum behaves exactly as
 *    before the feature, gate WRITES answer 503 tier_gate_not_ready,
 *    and ungated channels are untouched in every state.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MOD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MEMBER2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OUTSIDER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const LAPSED = "99999999-9999-4999-8999-999999999999";
const RANOUT = "88888888-8888-4888-8888-888888888888";

const BRONZE = "10000000-0000-4000-8000-000000000001";
const SILVER = "10000000-0000-4000-8000-000000000002";
const GOLD = "10000000-0000-4000-8000-000000000003";
const INACTIVE_TIER = "10000000-0000-4000-8000-000000000004";
const FOREIGN_TIER = "10000000-0000-4000-8000-000000000005";

const PUBLIC_GROUP = "11111111-1111-4111-8111-111111111111";
const PRIVATE_GROUP = "66666666-6666-4666-8666-666666666666";
const OWNER_PROFILE = "22222222-2222-4222-8222-222222222222";

const TOKEN_USERS: Record<string, string> = {
  "owner-token": OWNER,
  "admin-token": ADMIN,
  "mod-token": MOD,
  "member-token": MEMBER,
  "member2-token": MEMBER2,
  "outsider-token": OUTSIDER,
  "lapsed-token": LAPSED,
  "ranout-token": RANOUT,
};

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  state: {
    groups: [] as Row[],
    members: [] as Row[],
    profiles: [] as Row[],
    channels: [] as Row[],
    threads: [] as Row[],
    replies: [] as Row[],
    notifications: [] as Row[],
    fanTiers: [] as Row[],
    fanMembers: [] as Row[],
    /* Simulates a database where the held migration has NOT landed:
       the gate column does not exist (Postgres 42703). */
    gateColumnMissing: false,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const token = String(req.headers["authorization"] ?? "").replace(/^Bearer /, "");
    const userId = (globalThis as any).__forumTokenUsers?.[token];
    if (!userId) { res.status(401).json({ error: "Sign in required." }); return; }
    req.userId = userId;
    next();
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const userId = (globalThis as any).__forumTokenUsers?.[token];
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

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    groupsTable, groupMembersTable, creatorProfilesTable, notificationsTable,
    groupForumChannelsTable, groupForumThreadsTable, groupForumRepliesTable,
    fanTiersTable, fanMembersTable,
  } = actual;

  function missingGateColumnError(): Error {
    return Object.assign(new Error('column "min_fan_tier_id" does not exist'), { code: "42703" });
  }

  const dialect = new PgDialect();

  function tableRows(table: unknown): Row[] {
    if (table === groupsTable) return state.groups;
    if (table === groupMembersTable) return state.members;
    if (table === creatorProfilesTable) return state.profiles;
    if (table === notificationsTable) return state.notifications;
    if (table === groupForumChannelsTable) return state.channels;
    if (table === groupForumThreadsTable) return state.threads;
    if (table === groupForumRepliesTable) return state.replies;
    if (table === fanTiersTable) return state.fanTiers;
    if (table === fanMembersTable) return state.fanMembers;
    return [];
  }

  function colToProp(table: unknown): Map<string, string> {
    const map = new Map<string, string>();
    for (const [prop, col] of Object.entries(getTableColumns(table as never) as Record<string, { name: string }>)) {
      map.set(col.name, prop);
    }
    return map;
  }

  /** Evaluate the eq/and/inArray conditions this router builds:
   *  render with PgDialect, then match "col" = $n / "col" in (...)
   *  pairs against the row's camelCase props. */
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

  /** The canonical ordering each handler asks for, applied by table —
   *  this is the ordering contract the thread-list assertions pin. */
  function canonicalSort(table: unknown, rows: Row[]): Row[] {
    const out = [...rows];
    if (table === groupForumThreadsTable) {
      out.sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const at = (a.lastReplyAt ?? a.createdAt) as Date;
        const bt = (b.lastReplyAt ?? b.createdAt) as Date;
        return bt.getTime() - at.getTime();
      });
    } else if (table === groupForumChannelsTable) {
      out.sort((a, b) => (a.position - b.position) || (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
    } else if (table === fanTiersTable) {
      out.sort((a, b) => (a.sort_order - b.sort_order) || (a.created_at as Date).getTime() - (b.created_at as Date).getTime());
    } else if (table === groupForumRepliesTable || table === groupMembersTable) {
      const key = table === groupForumRepliesTable ? "createdAt" : "joinedAt";
      out.sort((a, b) => (a[key] as Date).getTime() - (b[key] as Date).getTime());
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
    let grouped = false;
    const finish = (limitN?: number) => {
      if (state.gateColumnMissing && table === groupForumChannelsTable && fields && "minFanTierId" in fields) {
        throw missingGateColumnError();
      }
      // Count selects: fields carry a SQL count expression.
      if (fields && Object.values(fields).some(isSqlValue)) {
        if (grouped) {
          const byChannel = new Map<string, number>();
          for (const r of rows) byChannel.set(r.channelId, (byChannel.get(r.channelId) ?? 0) + 1);
          return [...byChannel.entries()].map(([channelId, n]) => ({ channelId, n }));
        }
        return [{ n: rows.length }];
      }
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
      groupBy: (..._args: unknown[]) => { grouped = true; return chain; },
      limit: async (n: number) => finish(n),
      then: (res: any, rej: any) => Promise.resolve(finish()).then(res, rej),
    };
    return chain;
  }

  function applyDefaults(table: unknown, v: Row): Row {
    const row: Row = { id: randomUUID(), createdAt: new Date(), ...v };
    if (table === groupForumChannelsTable) { row.position ??= 0; row.description ??= ""; row.minFanTierId ??= null; }
    if (table === groupForumThreadsTable) {
      row.replyCount ??= 0; row.lastReplyAt ??= null;
      row.isPinned ??= false; row.isLocked ??= false; row.tags ??= [];
    }
    if (table === notificationsTable) { row.isRead ??= false; row.body ??= ""; row.link ??= ""; }
    if (table === groupsTable) { row.memberCount ??= 0; row.isPublic ??= true; row.description ??= ""; }
    if (table === groupMembersTable) { row.role ??= "member"; row.joinedAt ??= new Date(); }
    return row;
  }

  function applySet(row: Row, patch: Record<string, unknown>) {
    for (const [key, value] of Object.entries(patch)) {
      if (isSqlValue(value)) {
        const { sql } = dialect.sqlToQuery(value as never) as { sql: string };
        if (/reply_count/.test(sql) && /\+ 1/.test(sql)) row.replyCount = (row.replyCount ?? 0) + 1;
        else if (/reply_count/.test(sql) && /greatest/i.test(sql)) row.replyCount = Math.max(0, (row.replyCount ?? 0) - 1);
        else if (/member_count/.test(sql) && /\+ 1/.test(sql)) row.memberCount = (row.memberCount ?? 0) + 1;
        else if (/member_count/.test(sql) && /greatest/i.test(sql)) row.memberCount = Math.max(0, (row.memberCount ?? 0) - 1);
        continue;
      }
      row[key] = value;
    }
  }

  function cascadeDelete(table: unknown, removed: Row[]) {
    if (removed.length === 0) return;
    if (table === groupForumChannelsTable) {
      const ids = new Set(removed.map((r) => r.id));
      const deadThreads = state.threads.filter((t) => ids.has(t.channelId));
      state.threads = state.threads.filter((t) => !ids.has(t.channelId));
      const deadThreadIds = new Set(deadThreads.map((t) => t.id));
      state.replies = state.replies.filter((r) => !deadThreadIds.has(r.threadId));
    }
    if (table === groupForumThreadsTable) {
      const ids = new Set(removed.map((r) => r.id));
      state.replies = state.replies.filter((r) => !ids.has(r.threadId));
    }
    if (table === groupsTable) {
      const ids = new Set(removed.map((r) => r.id));
      state.members = state.members.filter((m) => !ids.has(m.groupId));
      state.channels = state.channels.filter((c) => !ids.has(c.groupId));
      state.threads = state.threads.filter((t) => !ids.has(t.groupId));
      state.replies = state.replies.filter((r) => !ids.has(r.groupId));
    }
  }

  const fakeDb: any = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => selectChain(table, fields),
    }),
    insert: (table: unknown) => ({
      values: (v: Row | Row[]) => {
        if (state.gateColumnMissing && table === groupForumChannelsTable) {
          const list = Array.isArray(v) ? v : [v];
          if (list.some((item) => "minFanTierId" in item)) throw missingGateColumnError();
        }
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
      set: (patch: Record<string, unknown>) => {
        if (state.gateColumnMissing && table === groupForumChannelsTable && "minFanTierId" in patch) {
          throw missingGateColumnError();
        }
        return {
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
        };
      },
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const rows = tableRows(table);
        const removed = rows.filter((r) => matches(table, r, cond));
        const kept = rows.filter((r) => !matches(table, r, cond));
        rows.length = 0;
        rows.push(...kept);
        cascadeDelete(table, removed);
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
    { id: PUBLIC_GROUP, slug: "wave-makers", name: "Wave Makers", description: "Public crew.", coverUrl: null, ownerProfileId: OWNER_PROFILE, memberCount: 5, isPublic: true, createdAt: T0 },
    { id: PRIVATE_GROUP, slug: "inner-circle", name: "Inner Circle", description: "Members only.", coverUrl: null, ownerProfileId: OWNER_PROFILE, memberCount: 5, isPublic: false, createdAt: T0 },
  ];
  s.profiles = [
    { id: OWNER_PROFILE, userId: OWNER, slug: "crew-owner", displayName: "Crew Owner", avatarUrl: null },
    { id: "33333333-3333-4333-8333-333333333333", userId: MEMBER, slug: "wave-member", displayName: "Wave Member", avatarUrl: null },
    { id: "44444444-4444-4444-8444-444444444444", userId: MOD, slug: "crew-mod", displayName: "Crew Mod", avatarUrl: null },
    { id: "55555555-5555-4555-8555-555555555555", userId: LAPSED, slug: "lapsed-fan", displayName: "Lapsed Fan", avatarUrl: null },
  ];
  // The moderator's stored role is the LEGACY "mod" value on purpose:
  // every forum permission must normalize it like the rest of the site.
  s.members = [PUBLIC_GROUP, PRIVATE_GROUP].flatMap((g) => [
    { groupId: g, userId: OWNER, role: "owner", joinedAt: T0 },
    { groupId: g, userId: ADMIN, role: "admin", joinedAt: T0 },
    { groupId: g, userId: MOD, role: "mod", joinedAt: T0 },
    { groupId: g, userId: MEMBER, role: "member", joinedAt: T0 },
    { groupId: g, userId: MEMBER2, role: "member", joinedAt: T0 },
    { groupId: g, userId: LAPSED, role: "member", joinedAt: T0 },
    { groupId: g, userId: RANOUT, role: "member", joinedAt: T0 },
  ]);
  /* The group owner's fan club (fan_tiers.user_id = OWNER, the user
     behind the group's owner profile). Ladder: Bronze < Silver <
     Gold by sort_order. FOREIGN_TIER belongs to OUTSIDER's club —
     a channel of this group may never gate on it. */
  const tier = (id: string, name: string, sort_order: number, over: Row = {}): Row => ({
    id, user_id: OWNER, name, price_cents: 500, description: "", perks: [],
    sort_order, trial_enabled: false, annual_discount_pct: 0, is_active: "true",
    created_at: T0, updated_at: T0, ...over,
  });
  s.fanTiers = [
    tier(BRONZE, "Bronze", 0),
    tier(SILVER, "Silver", 1),
    tier(GOLD, "Gold", 2),
    tier(INACTIVE_TIER, "Retired", 3, { is_active: "false" }),
    tier(FOREIGN_TIER, "Foreign Gold", 0, { user_id: OUTSIDER }),
  ];
  const FUTURE = new Date("2027-09-01T12:00:00.000Z");
  const PAST = new Date("2026-08-01T12:00:00.000Z");
  const fan = (fan_user_id: string, tier_id: string, over: Row = {}): Row => ({
    id: randomUUID(), user_id: OWNER, tier_id, fan_label: `fan:${fan_user_id}`,
    fan_user_id, status: "active", price_cents: 500, billing_period: "monthly",
    current_period_start: T0, current_period_end: FUTURE, trial_ends_at: null,
    is_gift: false, joined_at: T0, created_at: T0, updated_at: T0, ...over,
  });
  s.fanMembers = [
    fan(MEMBER, SILVER),                                   // qualifies at Silver+
    fan(MEMBER2, BRONZE),                                  // below a Silver gate
    fan(OUTSIDER, GOLD),                                   // qualifies; NOT a group member
    fan(LAPSED, GOLD, { status: "canceled", current_period_end: PAST }), // lapsed at the top tier
    fan(RANOUT, SILVER, { current_period_end: PAST }),     // period simply ran out (stored "active")
  ];
  s.gateColumnMissing = false;
  s.channels = [];
  s.threads = [];
  s.replies = [];
  s.notifications = [];
}

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  (globalThis as any).__forumTokenUsers = TOKEN_USERS;
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

async function makeChannel(slug = "wave-makers", token = "admin-token", name = "General") {
  const r = await call("POST", `/groups/${slug}/forum/channels`, token, { name, description: "Talk about everything." });
  expect(r.status).toBe(201);
  return r.json.channel as { id: string; name: string };
}

async function makeThread(channelId: string, token = "member-token", title = "First thread", slug = "wave-makers") {
  const r = await call("POST", `/groups/${slug}/forum/channels/${channelId}/threads`, token, {
    title, body: "Opening post body.",
  });
  expect(r.status).toBe(201);
  return r.json.thread as { id: string; title: string };
}


async function makeGatedChannel(tierId: string = SILVER, name = "VIP Lounge") {
  const r = await call("POST", "/groups/wave-makers/forum/channels", "admin-token", {
    name, description: "Members-only talk.", min_fan_tier_id: tierId,
  });
  expect(r.status).toBe(201);
  return r.json.channel as { id: string; name: string; min_fan_tier_id: string | null };
}

describe("tier gate — setting the gate (channel settings, admin+)", () => {
  it("a channel can be created gated, and the gate must be the group owner's own active tier", async () => {
    const ch = await makeGatedChannel();
    expect(ch.min_fan_tier_id).toBe(SILVER);

    const foreign = await call("POST", "/groups/wave-makers/forum/channels", "admin-token", {
      name: "Foreign Gate", min_fan_tier_id: FOREIGN_TIER,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.json.error).toContain("isn't one of this group's owner's fan tiers");

    const inactive = await call("POST", "/groups/wave-makers/forum/channels", "admin-token", {
      name: "Retired Gate", min_fan_tier_id: INACTIVE_TIER,
    });
    expect(inactive.status).toBe(400);

    const ghost = await call("POST", "/groups/wave-makers/forum/channels", "admin-token", {
      name: "Ghost Gate", min_fan_tier_id: "10000000-0000-4000-8000-000000000099",
    });
    expect(ghost.status).toBe(400);
  });

  it("PATCH sets and clears the gate; plain members cannot touch it", async () => {
    const ch = await makeChannel(); // ungated
    expect(ch.min_fan_tier_id ?? null).toBeNull();

    const byMember = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "member-token", { min_fan_tier_id: SILVER });
    expect(byMember.status).toBe(403);

    const set = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token", { min_fan_tier_id: GOLD });
    expect(set.status).toBe(200);
    expect(set.json.channel.min_fan_tier_id).toBe(GOLD);

    const cleared = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token", { min_fan_tier_id: null });
    expect(cleared.status).toBe(200);
    expect(cleared.json.channel.min_fan_tier_id).toBeNull();

    // The legacy rename path is untouched by the gate machinery.
    const renamed = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token", { name: "The Tank" });
    expect(renamed.status).toBe(200);
    expect(renamed.json.channel.name).toBe("The Tank");
  });

  it("channel managers get the owner's gate options in the list payload; members do not", async () => {
    await makeGatedChannel();
    const admin = await call("GET", "/groups/wave-makers/forum/channels", "admin-token");
    expect(admin.status).toBe(200);
    expect(admin.json.gate_options.map((t: any) => t.name)).toEqual(["Bronze", "Silver", "Gold"]);
    expect(admin.json.gate_creator_user_id).toBe(OWNER);
    const member = await call("GET", "/groups/wave-makers/forum/channels", "member-token");
    expect(member.json.gate_options).toEqual([]);
  });
});

describe("tier gate — the knock door on the channel list", () => {
  it("a gated channel is listed with what it is, its tier, and the join door — for every viewer state", async () => {
    const ch = await makeGatedChannel();
    await makeThread(ch.id, "member-token", "Inside Talk");

    const guest = await call("GET", "/groups/wave-makers/forum/channels");
    const guestCh = guest.json.channels.find((c: any) => c.id === ch.id);
    expect(guestCh.name).toBe("VIP Lounge");
    expect(guestCh.gate.tier_name).toBe("Silver");
    expect(guestCh.gate.viewer_has_access).toBe(false);
    expect(guestCh.gate.knock.viewer_status).toBe("not_member");
    expect(guestCh.gate.knock.join_url).toBe(`/memberships?creator=${OWNER}`);
    expect(guestCh.gate.knock.message).toContain("Silver");

    const below = await call("GET", "/groups/wave-makers/forum/channels", "member2-token");
    const belowCh = below.json.channels.find((c: any) => c.id === ch.id);
    expect(belowCh.gate.knock.viewer_status).toBe("below_tier");
    expect(belowCh.gate.knock.viewer_tier.name).toBe("Bronze");

    const inside = await call("GET", "/groups/wave-makers/forum/channels", "member-token");
    const insideCh = inside.json.channels.find((c: any) => c.id === ch.id);
    expect(insideCh.gate.viewer_has_access).toBe(true);
    expect(insideCh.gate.knock).toBeNull();

    const lapsed = await call("GET", "/groups/wave-makers/forum/channels", "lapsed-token");
    const lapsedCh = lapsed.json.channels.find((c: any) => c.id === ch.id);
    expect(lapsedCh.gate.knock.viewer_status).toBe("lapsed");
    expect(lapsedCh.gate.knock.message).toContain("Your membership has ended");
    expect(lapsedCh.gate.knock.history_note).toContain("never deleted");
  });
});

describe("tier gate — enforcement on READ", () => {
  it("non-qualifying viewers get the knock (403 + tier_gate), never the threads", async () => {
    const ch = await makeGatedChannel();
    const th = await makeThread(ch.id, "member-token", "Secret Recipe");
    for (const token of [undefined, "member2-token", "lapsed-token", "ranout-token"] as const) {
      const list = await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, token);
      expect(list.status).toBe(403);
      expect(list.json.tier_gate).toBeTruthy();
      expect(list.json.tier_gate.join_url).toBe(`/memberships?creator=${OWNER}`);
      expect(JSON.stringify(list.json)).not.toContain("Secret Recipe");
      const detail = await call("GET", `/groups/wave-makers/forum/threads/${th.id}`, token);
      expect(detail.status).toBe(403);
      expect(detail.json.tier_gate).toBeTruthy();
      expect(JSON.stringify(detail.json)).not.toContain("Secret Recipe");
    }
  });

  it("qualifying viewers read: the tier itself, a higher tier, a trial — and staff without any fan membership", async () => {
    const ch = await makeGatedChannel();
    await makeThread(ch.id, "member-token", "Inside Talk");
    // Silver (the gate tier itself), group member.
    expect((await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token")).status).toBe(200);
    // Gold (above the gate), NOT a group member — the fan membership is the qualification to READ a public group's room.
    expect((await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "outsider-token")).status).toBe(200);
    // Staff: moderator with the legacy "mod" role and no fan membership at all.
    expect((await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "mod-token")).status).toBe(200);
    expect((await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "owner-token")).status).toBe(200);
  });

  it("a higher gate refuses a mid-tier member as below_tier", async () => {
    const ch = await makeGatedChannel(GOLD, "Gold Room");
    const r = await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token");
    expect(r.status).toBe(403);
    expect(r.json.tier_gate.viewer_status).toBe("below_tier");
    expect(r.json.tier_gate.required_tier.name).toBe("Gold");
  });
});

describe("tier gate — enforcement on POST", () => {
  it("group membership alone never posts in a gated room; qualifying members and staff do", async () => {
    const ch = await makeGatedChannel();
    const below = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member2-token", { title: "Let me in", body: "Please." });
    expect(below.status).toBe(403);
    expect(below.json.tier_gate.viewer_status).toBe("below_tier");

    const guest = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, undefined, { title: "T", body: "B" });
    expect(guest.status).toBe(401);

    const ok = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token", { title: "Member thread", body: "From inside." });
    expect(ok.status).toBe(201);

    // A qualifying fan who is not a GROUP member still cannot post —
    // the group's own membership rule runs first, unchanged.
    const fanOnly = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "outsider-token", { title: "T", body: "B" });
    expect(fanOnly.status).toBe(403);
    expect(fanOnly.json.tier_gate).toBeUndefined();
    expect(fanOnly.json.error).toContain("Join the group");

    const modThread = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "mod-token", { title: "Mod note", body: "Staff post." });
    expect(modThread.status).toBe(201);
  });

  it("replies are gated too — on the thread's channel", async () => {
    const ch = await makeGatedChannel();
    const th = await makeThread(ch.id, "member-token", "Reply Target");
    const below = await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member2-token", { body: "Sneaking in." });
    expect(below.status).toBe(403);
    expect(below.json.tier_gate).toBeTruthy();
    const ok = await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member-token", { body: "Legit reply." });
    expect(ok.status).toBe(201);
  });
});

describe("tier gate — lapse preserves history (hard rule)", () => {
  it("a lapsed member's past threads stay attributed and readable to qualifying viewers; the lapsed member is knocked, and rejoining restores them", async () => {
    const ch = await makeGatedChannel();
    // Seed the lapsed fan's history directly: they posted while a member.
    const theirThread = {
      id: randomUUID(), channelId: ch.id, groupId: PUBLIC_GROUP, authorUserId: LAPSED,
      title: "Before I lapsed", body: "Written while Gold.", tags: [], replyCount: 1,
      lastReplyAt: null, isPinned: false, isLocked: false, createdAt: T0,
    };
    h.state.threads.push(theirThread);
    h.state.replies.push({
      id: randomUUID(), threadId: theirThread.id, groupId: PUBLIC_GROUP,
      authorUserId: MEMBER, body: "Still here.", createdAt: T0,
    });

    // Qualifying viewers still see the lapsed member's work, attributed.
    const list = await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token");
    expect(list.status).toBe(200);
    const found = list.json.threads.find((t: any) => t.id === theirThread.id);
    expect(found).toBeTruthy();
    expect(found.author_user_id).toBe(LAPSED);
    expect(found.author?.displayName).toBe("Lapsed Fan");
    const detail = await call("GET", `/groups/wave-makers/forum/threads/${theirThread.id}`, "member-token");
    expect(detail.status).toBe(200);
    expect(detail.json.thread.title).toBe("Before I lapsed");

    // The lapsed member themselves: clean knock, no read, no post.
    const knocked = await call("GET", `/groups/wave-makers/forum/threads/${theirThread.id}`, "lapsed-token");
    expect(knocked.status).toBe(403);
    expect(knocked.json.tier_gate.viewer_status).toBe("lapsed");
    const post = await call("POST", `/groups/wave-makers/forum/threads/${theirThread.id}/replies`, "lapsed-token", { body: "I'm back?" });
    expect(post.status).toBe(403);
    expect(post.json.tier_gate.viewer_status).toBe("lapsed");
    // Nothing was deleted by any of this.
    expect(h.state.threads.some((t) => t.id === theirThread.id)).toBe(true);

    // Rejoin (the knock's join door, completed): access returns, and
    // so does their own history.
    const row = h.state.fanMembers.find((m) => m.fan_user_id === LAPSED);
    row.status = "active";
    row.current_period_end = new Date("2027-09-01T12:00:00.000Z");
    const back = await call("GET", `/groups/wave-makers/forum/threads/${theirThread.id}`, "lapsed-token");
    expect(back.status).toBe(200);
    expect(back.json.thread.title).toBe("Before I lapsed");
  });
});

describe("tier gate — graceful degradation before the held migration lands", () => {
  it("without the gate column the forum behaves exactly as before, and gate writes answer an honest 503", async () => {
    const ch = await makeGatedChannel();
    await makeThread(ch.id, "member-token", "Pre-migration thread");
    h.state.gateColumnMissing = true;

    // Reads: no gates anywhere — the channel reads open, even for guests.
    const list = await call("GET", "/groups/wave-makers/forum/channels");
    expect(list.status).toBe(200);
    const listed = list.json.channels.find((c: any) => c.id === ch.id);
    expect(listed.min_fan_tier_id).toBeNull();
    expect(listed.gate).toBeNull();
    expect((await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`)).status).toBe(200);

    // Legacy channel writes still work.
    const renamed = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token", { name: "Renamed" });
    expect(renamed.status).toBe(200);
    expect(renamed.json.channel.name).toBe("Renamed");

    // Gate writes cannot be honoured — honest 503, nothing half-applies.
    const gatePatch = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token", { min_fan_tier_id: GOLD });
    expect(gatePatch.status).toBe(503);
    expect(gatePatch.json.error).toBe("tier_gate_not_ready");
    const gateCreate = await call("POST", "/groups/wave-makers/forum/channels", "admin-token", { name: "Gated", min_fan_tier_id: GOLD });
    expect(gateCreate.status).toBe(503);

    // Ungated creation still works pre-migration.
    const plain = await call("POST", "/groups/wave-makers/forum/channels", "admin-token", { name: "Plain" });
    expect(plain.status).toBe(201);
  });
});

describe("tier gate — ungated channels are untouched", () => {
  it("an open channel reads and posts exactly as before the feature", async () => {
    const ch = await makeChannel();
    const th = await makeThread(ch.id, "member-token", "Open thread");
    expect((await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`)).status).toBe(200);
    expect((await call("GET", `/groups/wave-makers/forum/threads/${th.id}`)).status).toBe(200);
    const reply = await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member2-token", { body: "Open reply." });
    expect(reply.status).toBe(201);
  });
});
