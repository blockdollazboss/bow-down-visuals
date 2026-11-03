/**
 * Route tests for group ownership transfer + group settings editing
 * (routes/community) — stack1400 ruling #10 (Y4 OD1).
 *
 * THE RULING: (a) ownership transfer is owner-only; the target must be
 * a current member; the two member rows swap rungs (the target takes
 * "owner", the outgoing owner steps into the rung the target vacated)
 * and groups.ownerProfileId moves to the target's creator profile.
 * (b) Group settings (name / description / cover / isPublic) are
 * editable by owner/admin on the ladder's editSettings rung, validated
 * like group creation. Group deletion stays admin-assisted — no
 * self-serve delete door exists and none is pinned here.
 *
 * CONSEQUENCES PINNED: the old owner — now a plain member — can leave
 * after a transfer (the leave route's owner refusal names the transfer
 * as the way out, replacing the stack1100 "can't be handed off yet"
 * copy); the new owner inherits the same leave refusal.
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
const MOD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEMBER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OUTSIDER = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_PROFILE = "22222222-2222-4222-8222-222222222222";
const MEMBER_PROFILE = "33333333-3333-4333-8333-333333333333";
const ADMIN_PROFILE = "44444444-4444-4444-8444-444444444444";

const TOKEN_USERS: Record<string, string> = {
  "owner-token": OWNER,
  "admin-token": ADMIN,
  "mod-token": MOD,
  "member-token": MEMBER,
  "outsider-token": OUTSIDER,
};

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  state: {
    groups: [] as Row[],
    members: [] as Row[],
    profiles: [] as Row[],
    notifications: [] as Row[],
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const token = String(req.headers["authorization"] ?? "").replace(/^Bearer\s+/i, "");
    const userId = (globalThis as any).__transferTokenUsers?.[token];
    if (!userId) { res.status(401).json({ error: "Sign in required." }); return; }
    req.userId = userId;
    next();
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (token: string) => {
        const userId = (globalThis as any).__transferTokenUsers?.[token];
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
  } = actual;

  const dialect = new PgDialect();

  function tableRows(table: unknown): Row[] {
    if (table === groupsTable) return state.groups;
    if (table === groupMembersTable) return state.members;
    if (table === creatorProfilesTable) return state.profiles;
    if (table === notificationsTable) return state.notifications;
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

  function selectChain(table: unknown, fields?: Record<string, unknown>): any {
    let rows = [...tableRows(table)];
    const finish = (limitN?: number) => {
      let out = [...rows];
      if (table === groupMembersTable) {
        out.sort((a, b) => (a.joinedAt as Date).getTime() - (b.joinedAt as Date).getTime());
      }
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

  function isSqlValue(v: unknown): boolean {
    return typeof v === "object" && v !== null && "queryChunks" in (v as Record<string, unknown>);
  }

  function applyDefaults(table: unknown, v: Row): Row {
    const row: Row = { id: randomUUID(), createdAt: new Date(), ...v };
    if (table === notificationsTable) { row.isRead ??= false; row.body ??= ""; row.link ??= ""; }
    if (table === groupsTable) { row.memberCount ??= 0; row.isPublic ??= true; row.description ??= ""; }
    if (table === groupMembersTable) { row.role ??= "member"; row.joinedAt ??= new Date(); }
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
    { id: GROUP_ID, slug: "wave-makers", name: "Wave Makers", description: "Public crew.", coverUrl: null, ownerProfileId: OWNER_PROFILE, memberCount: 4, isPublic: true, createdAt: T0 },
  ];
  s.profiles = [
    { id: OWNER_PROFILE, userId: OWNER, slug: "crew-owner", displayName: "Crew Owner", avatarUrl: null },
    { id: ADMIN_PROFILE, userId: ADMIN, slug: "wave-admin", displayName: "Wave Admin", avatarUrl: null },
    { id: MEMBER_PROFILE, userId: MEMBER, slug: "wave-member", displayName: "Wave Member", avatarUrl: null },
  ];
  s.members = [
    { groupId: GROUP_ID, userId: OWNER, role: "owner", joinedAt: T0 },
    { groupId: GROUP_ID, userId: ADMIN, role: "admin", joinedAt: T0 },
    { groupId: GROUP_ID, userId: MOD, role: "moderator", joinedAt: T0 },
    { groupId: GROUP_ID, userId: MEMBER, role: "member", joinedAt: T0 },
  ];
  s.notifications = [];
}

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  (globalThis as any).__transferTokenUsers = TOKEN_USERS;
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

describe("POST /groups/:slug/transfer — ownership handoff", () => {
  it("happy path: a member becomes owner, the old owner steps into the vacated member rung, ownerProfileId moves", async () => {
    const r = await call("POST", "/groups/wave-makers/transfer", "owner-token", { user_id: MEMBER });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(memberRow(MEMBER)?.role).toBe("owner");
    expect(memberRow(OWNER)?.role).toBe("member");
    expect(h.state.groups[0].ownerProfileId).toBe(MEMBER_PROFILE);
    expect(r.json.group.owner_profile_id).toBe(MEMBER_PROFILE);
    // Member count is untouched — nobody joined or left.
    expect(h.state.groups[0].memberCount).toBe(4);
    // The new owner hears about it on the bell.
    const note = h.state.notifications.find((n) => n.userId === MEMBER);
    expect(note?.kind).toBe("group_ownership");
    expect(note?.link).toBe("/groups/wave-makers");
  });

  it("the swap is a true rung trade: handing to an admin leaves the old owner as admin", async () => {
    const r = await call("POST", "/groups/wave-makers/transfer", "owner-token", { user_id: ADMIN });
    expect(r.status).toBe(200);
    expect(memberRow(ADMIN)?.role).toBe("owner");
    expect(memberRow(OWNER)?.role).toBe("admin");
    expect(h.state.groups[0].ownerProfileId).toBe(ADMIN_PROFILE);
  });

  it("a non-owner is refused — admin, moderator, member and outsider alike — and nothing moves", async () => {
    for (const token of ["admin-token", "mod-token", "member-token", "outsider-token"]) {
      const r = await call("POST", "/groups/wave-makers/transfer", token, { user_id: MEMBER });
      expect(r.status).toBe(403);
    }
    expect(memberRow(OWNER)?.role).toBe("owner");
    expect(memberRow(MEMBER)?.role).toBe("member");
    expect(h.state.groups[0].ownerProfileId).toBe(OWNER_PROFILE);
  });

  it("a non-member target is refused and nothing moves", async () => {
    const r = await call("POST", "/groups/wave-makers/transfer", "owner-token", { user_id: OUTSIDER });
    expect(r.status).toBe(404);
    expect(r.json.error).toMatch(/current member/i);
    expect(memberRow(OWNER)?.role).toBe("owner");
    expect(memberRow(OUTSIDER)).toBeUndefined();
    expect(h.state.groups[0].ownerProfileId).toBe(OWNER_PROFILE);
  });

  it("the owner cannot transfer to themself", async () => {
    const r = await call("POST", "/groups/wave-makers/transfer", "owner-token", { user_id: OWNER });
    expect(r.status).toBe(400);
    expect(memberRow(OWNER)?.role).toBe("owner");
  });

  it("a malformed target id is a 400, not a crash", async () => {
    const r = await call("POST", "/groups/wave-makers/transfer", "owner-token", { user_id: "not-a-uuid" });
    expect(r.status).toBe(400);
  });

  it("an unknown group is a 404", async () => {
    const r = await call("POST", "/groups/no-such-crew/transfer", "owner-token", { user_id: MEMBER });
    expect(r.status).toBe(404);
  });

  it("the old owner can leave after the transfer — and the new owner now carries the owner refusal", async () => {
    const t = await call("POST", "/groups/wave-makers/transfer", "owner-token", { user_id: MEMBER });
    expect(t.status).toBe(200);

    const newOwnerLeave = await call("POST", "/groups/wave-makers/leave", "member-token");
    expect(newOwnerLeave.status).toBe(400);
    expect(memberRow(MEMBER)).toBeDefined();

    const oldOwnerLeave = await call("POST", "/groups/wave-makers/leave", "owner-token");
    expect(oldOwnerLeave.status).toBe(200);
    expect(memberRow(OWNER)).toBeUndefined();
    expect(h.state.groups[0].memberCount).toBe(3);
  });

  it("before any transfer, the owner-leave refusal points at the transfer door", async () => {
    const r = await call("POST", "/groups/wave-makers/leave", "owner-token");
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/transfer ownership/i);
    expect(r.json.error).not.toMatch(/can't be handed off yet/i);
    expect(memberRow(OWNER)).toBeDefined();
  });
});

describe("PATCH /groups/:slug — group settings editing", () => {
  it("the owner edits name, description and visibility in one save", async () => {
    const r = await call("PATCH", "/groups/wave-makers", "owner-token", {
      name: "Wave Makers Deluxe",
      description: "A tighter crew.",
      is_public: false,
    });
    expect(r.status).toBe(200);
    expect(r.json.group.name).toBe("Wave Makers Deluxe");
    expect(r.json.group.description).toBe("A tighter crew.");
    expect(r.json.group.is_public).toBe(false);
    // The DTO stays snake_case end to end.
    expect(r.json.group).not.toHaveProperty("isPublic");
    expect(h.state.groups[0].name).toBe("Wave Makers Deluxe");
    expect(h.state.groups[0].isPublic).toBe(false);
  });

  it("an admin can edit settings too", async () => {
    const r = await call("PATCH", "/groups/wave-makers", "admin-token", { name: "Admin's Rename" });
    expect(r.status).toBe(200);
    expect(h.state.groups[0].name).toBe("Admin's Rename");
    // Untouched fields stay untouched.
    expect(h.state.groups[0].description).toBe("Public crew.");
    expect(h.state.groups[0].isPublic).toBe(true);
  });

  it("a plain member, a moderator and an outsider are all refused, and nothing changes", async () => {
    for (const token of ["member-token", "mod-token", "outsider-token"]) {
      const r = await call("PATCH", "/groups/wave-makers", token, { name: "Hijacked" });
      expect(r.status).toBe(403);
    }
    expect(h.state.groups[0].name).toBe("Wave Makers");
  });

  it("the cover can be set and then cleared with an explicit null", async () => {
    const set = await call("PATCH", "/groups/wave-makers", "owner-token", { cover_url: "https://cdn.example.com/new-cover.jpg" });
    expect(set.status).toBe(200);
    expect(h.state.groups[0].coverUrl).toBe("https://cdn.example.com/new-cover.jpg");
    expect(set.json.group.cover_url).toBe("https://cdn.example.com/new-cover.jpg");

    const cleared = await call("PATCH", "/groups/wave-makers", "owner-token", { cover_url: null });
    expect(cleared.status).toBe(200);
    expect(h.state.groups[0].coverUrl).toBeNull();
    expect(cleared.json.group.cover_url).toBeNull();
  });

  it("validation matches creation: empty name, bad cover URL and an empty patch are all 400s", async () => {
    const emptyName = await call("PATCH", "/groups/wave-makers", "owner-token", { name: "   " });
    expect(emptyName.status).toBe(400);
    const badCover = await call("PATCH", "/groups/wave-makers", "owner-token", { cover_url: "not-a-url" });
    expect(badCover.status).toBe(400);
    const empty = await call("PATCH", "/groups/wave-makers", "owner-token", {});
    expect(empty.status).toBe(400);
    expect(empty.json.error).toMatch(/nothing to change/i);
    expect(h.state.groups[0].name).toBe("Wave Makers");
  });

  it("an unknown group is a 404", async () => {
    const r = await call("PATCH", "/groups/no-such-crew", "owner-token", { name: "Nope" });
    expect(r.status).toBe(404);
  });
});
