/**
 * Route tests for group forum channels / threads / replies
 * (routes/community, migration 0185, Wave 3 #13).
 *
 * Fake-db style (mirrors drafts.test.ts): the REAL router + REAL table
 * objects, a fake db that renders drizzle conditions with PgDialect
 * and evaluates them against in-memory state. (pg-mem can't serve
 * this router: the query builder emits rowMode, which the pg-mem
 * adapter rejects.) The fake implements exactly the chains these
 * handlers use — select (full, fielded, and the count forms), insert
 * with returning, update with returning plus the two counter SQL
 * shapes the reply routes use, delete with the schema's cascades —
 * and applies each table's canonical ordering in orderBy, which is
 * what the sorting assertions pin. Auth resolves from bearer tokens
 * through both the requireAuth mock and the Supabase client mock
 * that optionalAuth rides.
 *
 * The contract pinned here:
 *  - A private group's forum leaks NOTHING to non-members — not the
 *    channel names (list), not thread titles/bodies (detail), through
 *    any path; its own members read and write normally.
 *  - Channel and thread ids are resolved scoped to the group in the
 *    URL: an id from another group 404s even for a member of both.
 *  - Guests read a public group's forum and can never write (401);
 *    signed-in non-members can read a public forum but posting is
 *    members-only (403) — the group's own posting rule.
 *  - Channel management follows the ladder: admin+ (a plain member
 *    and a moderator both 403). Pin/lock and foreign-content removal
 *    are moderator+ — including a moderator stored under the LEGACY
 *    "mod" role value — or the content's own author.
 *  - A locked thread refuses member replies but stays open to
 *    moderators (the moderation rail).
 *  - Tags are normalized server-side; reply counts track replies
 *    landing and being removed; deleting a channel cascades.
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
  } = actual;

  const dialect = new PgDialect();

  function tableRows(table: unknown): Row[] {
    if (table === groupsTable) return state.groups;
    if (table === groupMembersTable) return state.members;
    if (table === creatorProfilesTable) return state.profiles;
    if (table === notificationsTable) return state.notifications;
    if (table === groupForumChannelsTable) return state.channels;
    if (table === groupForumThreadsTable) return state.threads;
    if (table === groupForumRepliesTable) return state.replies;
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
    if (table === groupForumChannelsTable) { row.position ??= 0; row.description ??= ""; }
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
  ];
  // The moderator's stored role is the LEGACY "mod" value on purpose:
  // every forum permission must normalize it like the rest of the site.
  s.members = [PUBLIC_GROUP, PRIVATE_GROUP].flatMap((g) => [
    { groupId: g, userId: OWNER, role: "owner", joinedAt: T0 },
    { groupId: g, userId: ADMIN, role: "admin", joinedAt: T0 },
    { groupId: g, userId: MOD, role: "mod", joinedAt: T0 },
    { groupId: g, userId: MEMBER, role: "member", joinedAt: T0 },
    { groupId: g, userId: MEMBER2, role: "member", joinedAt: T0 },
  ]);
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

describe("forum channels — reads and visibility", () => {
  it("a group with no channels answers an honest empty list", async () => {
    const { status, json } = await call("GET", "/groups/wave-makers/forum/channels");
    expect(status).toBe(200);
    expect(json.channels).toEqual([]);
    expect(json.can_post).toBe(false);
  });

  it("a guest reads a public group's channels with live thread counts", async () => {
    const ch = await makeChannel();
    await makeThread(ch.id);
    const { status, json } = await call("GET", "/groups/wave-makers/forum/channels");
    expect(status).toBe(200);
    expect(json.channels).toHaveLength(1);
    expect(json.channels[0].name).toBe("General");
    expect(json.channels[0].thread_count).toBe(1);
  });

  it("a private group's channel list 403s guests and non-members without leaking names", async () => {
    await makeChannel("inner-circle", "admin-token", "Secret Board");
    for (const token of [undefined, "outsider-token"] as const) {
      const { status, json } = await call("GET", "/groups/inner-circle/forum/channels", token);
      expect(status).toBe(403);
      expect(JSON.stringify(json)).not.toContain("Secret Board");
    }
    const member = await call("GET", "/groups/inner-circle/forum/channels", "member-token");
    expect(member.status).toBe(200);
    expect(member.json.channels[0].name).toBe("Secret Board");
  });

  it("a private group's thread detail 403s non-members without leaking the thread", async () => {
    const ch = await makeChannel("inner-circle", "admin-token", "Secret Board");
    const th = await makeThread(ch.id, "member-token", "Secret Plans", "inner-circle");
    for (const token of [undefined, "outsider-token"] as const) {
      const { status, json } = await call("GET", `/groups/inner-circle/forum/threads/${th.id}`, token);
      expect(status).toBe(403);
      expect(JSON.stringify(json)).not.toContain("Secret Plans");
    }
  });

  it("channel and thread ids are scoped to the group in the URL — cross-group ids 404", async () => {
    const pubCh = await makeChannel("wave-makers", "admin-token", "Public Board");
    const privCh = await makeChannel("inner-circle", "admin-token", "Secret Board");
    const privThread = await makeThread(privCh.id, "member-token", "Secret Plans", "inner-circle");
    // The caller is a member of BOTH groups, so visibility is not the
    // gate here — only scoping can (and must) refuse these.
    const a = await call("GET", `/groups/wave-makers/forum/channels/${privCh.id}/threads`, "member-token");
    expect(a.status).toBe(404);
    const b = await call("GET", `/groups/wave-makers/forum/threads/${privThread.id}`, "member-token");
    expect(b.status).toBe(404);
    const c = await call("GET", `/groups/inner-circle/forum/channels/${pubCh.id}/threads`, "member-token");
    expect(c.status).toBe(404);
  });
});

describe("forum channels — management follows the ladder (admin+)", () => {
  it("members and moderators cannot create channels; admins and owners can", async () => {
    expect((await call("POST", "/groups/wave-makers/forum/channels", "member-token", { name: "Nope" })).status).toBe(403);
    expect((await call("POST", "/groups/wave-makers/forum/channels", "mod-token", { name: "Nope" })).status).toBe(403);
    expect((await call("POST", "/groups/wave-makers/forum/channels", "outsider-token", { name: "Nope" })).status).toBe(403);
    expect((await call("POST", "/groups/wave-makers/forum/channels", undefined, { name: "Nope" })).status).toBe(401);
    expect((await call("POST", "/groups/wave-makers/forum/channels", "admin-token", { name: "Announcements" })).status).toBe(201);
    expect((await call("POST", "/groups/wave-makers/forum/channels", "owner-token", { name: "Lounge" })).status).toBe(201);
  });

  it("rename is admin-only and an empty patch is a 400", async () => {
    const ch = await makeChannel();
    const byMember = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "member-token", { name: "Hijack" });
    expect(byMember.status).toBe(403);
    const empty = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token", {});
    expect(empty.status).toBe(400);
    const ok = await call("PATCH", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token", { name: "The Tank", position: 2 });
    expect(ok.status).toBe(200);
    expect(ok.json.channel.name).toBe("The Tank");
    expect(ok.json.channel.position).toBe(2);
  });

  it("deleting a channel cascades its threads and replies", async () => {
    const ch = await makeChannel();
    const th = await makeThread(ch.id);
    await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member2-token", { body: "A reply." });
    const del = await call("DELETE", `/groups/wave-makers/forum/channels/${ch.id}`, "admin-token");
    expect(del.status).toBe(200);
    expect((await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token")).status).toBe(404);
    expect((await call("GET", `/groups/wave-makers/forum/threads/${th.id}`, "member-token")).status).toBe(404);
  });
});

describe("forum threads — posting rules and tags", () => {
  it("guests cannot post (401) and signed-in non-members cannot post (403)", async () => {
    const ch = await makeChannel();
    expect((await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, undefined, { title: "T", body: "B" })).status).toBe(401);
    expect((await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "outsider-token", { title: "T", body: "B" })).status).toBe(403);
  });

  it("tags are normalized server-side and junk tags are refused, never dropped silently", async () => {
    const ch = await makeChannel();
    const ok = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token", {
      title: "Release talk", body: "Body.", tags: [" Release ", "#New-Music", "release"],
    });
    expect(ok.status).toBe(201);
    expect(ok.json.thread.tags).toEqual(["release", "new-music"]);
    const bad = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token", {
      title: "Bad tags", body: "Body.", tags: ["look at me!!"],
    });
    expect(bad.status).toBe(400);
    const many = await call("POST", `/groups/wave-makers/forum/channels/${ch.id}/threads`, "member-token", {
      title: "Too many", body: "Body.", tags: ["a", "b", "c", "d", "e", "f"],
    });
    expect(many.status).toBe(400);
  });

  it("threads sort pinned first, then by latest activity", async () => {
    const ch = await makeChannel();
    const a = await makeThread(ch.id, "member-token", "Thread A");
    const b = await makeThread(ch.id, "member2-token", "Thread B");
    let list = (await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`)).json.threads;
    expect(list.map((t: any) => t.title)).toEqual(["Thread B", "Thread A"]);
    // A reply bumps Thread A above Thread B.
    await call("POST", `/groups/wave-makers/forum/threads/${a.id}/replies`, "member2-token", { body: "Bump." });
    list = (await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`)).json.threads;
    expect(list.map((t: any) => t.title)).toEqual(["Thread A", "Thread B"]);
    // A pin beats activity.
    await call("PATCH", `/groups/wave-makers/forum/threads/${b.id}`, "mod-token", { is_pinned: true });
    list = (await call("GET", `/groups/wave-makers/forum/channels/${ch.id}/threads`)).json.threads;
    expect(list.map((t: any) => t.title)).toEqual(["Thread B", "Thread A"]);
    expect(list[0].is_pinned).toBe(true);
  });
});

describe("forum replies — counts, locks, moderation", () => {
  it("replies land in order, bump the count, and notify the thread author (never yourself)", async () => {
    const ch = await makeChannel();
    const th = await makeThread(ch.id, "member-token", "Counted");
    const self = await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member-token", { body: "My own note." });
    expect(self.status).toBe(201);
    const other = await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member2-token", { body: "Someone else." });
    expect(other.status).toBe(201);
    const detail = await call("GET", `/groups/wave-makers/forum/threads/${th.id}`, "member-token");
    expect(detail.json.thread.reply_count).toBe(2);
    expect(detail.json.thread.last_reply_at).not.toBeNull();
    expect(detail.json.replies.map((r: any) => r.body)).toEqual(["My own note.", "Someone else."]);
    const notes = h.state.notifications.filter((n) => n.kind === "forum_reply");
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(MEMBER);
  });

  it("a locked thread refuses member replies but moderators can still post", async () => {
    const ch = await makeChannel();
    const th = await makeThread(ch.id, "member-token", "Lockable");
    const lock = await call("PATCH", `/groups/wave-makers/forum/threads/${th.id}`, "mod-token", { is_locked: true });
    expect(lock.status).toBe(200);
    expect(lock.json.thread.is_locked).toBe(true);
    expect((await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member2-token", { body: "Let me in." })).status).toBe(403);
    expect((await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "mod-token", { body: "Mod note." })).status).toBe(201);
  });

  it("pin/lock is moderator+ — a plain member 403s", async () => {
    const ch = await makeChannel();
    const th = await makeThread(ch.id);
    expect((await call("PATCH", `/groups/wave-makers/forum/threads/${th.id}`, "member2-token", { is_pinned: true })).status).toBe(403);
    expect((await call("PATCH", `/groups/wave-makers/forum/threads/${th.id}`, "member-token", { is_pinned: true })).status).toBe(403);
  });

  it("reply removal: author or moderator only, and the count follows", async () => {
    const ch = await makeChannel();
    const th = await makeThread(ch.id, "member-token", "Moderated");
    const r1 = (await call("POST", `/groups/wave-makers/forum/threads/${th.id}/replies`, "member2-token", { body: "First." })).json.reply;
    const stranger = await call("DELETE", `/groups/wave-makers/forum/threads/${th.id}/replies/${r1.id}`, "member-token");
    // member-token authored the THREAD, not this reply — removal is
    // the reply author's or a moderator's, nobody else's.
    expect(stranger.status).toBe(403);
    const byMod = await call("DELETE", `/groups/wave-makers/forum/threads/${th.id}/replies/${r1.id}`, "mod-token");
    expect(byMod.status).toBe(200);
    const detail = await call("GET", `/groups/wave-makers/forum/threads/${th.id}`, "member-token");
    expect(detail.json.thread.reply_count).toBe(0);
    expect(detail.json.replies).toEqual([]);
  });

  it("thread removal: author or moderator only", async () => {
    const ch = await makeChannel();
    const th = await makeThread(ch.id, "member-token", "Owned");
    expect((await call("DELETE", `/groups/wave-makers/forum/threads/${th.id}`, "member2-token")).status).toBe(403);
    expect((await call("DELETE", `/groups/wave-makers/forum/threads/${th.id}`, "mod-token")).status).toBe(200);
    const th2 = await makeThread(ch.id, "member2-token", "Mine to remove");
    expect((await call("DELETE", `/groups/wave-makers/forum/threads/${th2.id}`, "member2-token")).status).toBe(200);
  });
});
