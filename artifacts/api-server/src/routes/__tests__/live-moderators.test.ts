/**
 * Moderator tests (routes/live-moderators + live-chat permissions):
 * appointment by profile slug, removal, my-role, and the extended
 * moderation rules — a mod can delete/mute chatters in the channel's
 * streams, but never touches the owner or another mod; only the
 * owner appoints/removes.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const MOD = "00000000-0000-4000-8000-0000000000bb";
const MOD2 = "00000000-0000-4000-8000-0000000000dd";
const FAN = "00000000-0000-4000-8000-0000000000cc";
const STREAM = "22222222-2222-4222-8222-222222222222";
const PROFILE = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
  messages: [] as Array<Record<string, unknown>>,
  mutes: [] as Array<Record<string, unknown>>,
  mods: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
  seq: 0,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}
interface Cond {
  eq: Array<[string, unknown]>;
  gt: Array<[string, unknown]>;
  isNull: string[];
  in: Array<[string, unknown[]]>;
}
function parseCond(cond: unknown): Cond {
  const { sql, params } = render(cond);
  const out: Cond = { eq: [], gt: [], isNull: [], in: [] };
  for (const m of sql.matchAll(/"(\w+)" = \$(\d+)/g)) out.eq.push([m[1], params[Number(m[2]) - 1]]);
  for (const m of sql.matchAll(/"(\w+)" > \$(\d+)/g)) out.gt.push([m[1], params[Number(m[2]) - 1]]);
  for (const m of sql.matchAll(/"(\w+)" is null/g)) out.isNull.push(m[1]);
  for (const m of sql.matchAll(/"(\w+)" in \(([^)]+)\)/g)) {
    const idxs = m[2].split(",").map((s) => Number(s.trim().replace("$", "")) - 1);
    out.in.push([m[1], idxs.map((i) => params[i])]);
  }
  return out;
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function rowVal(row: Record<string, unknown>, col: string): unknown {
  return row[col] ?? row[camel(col)];
}
function rowMatches(row: Record<string, unknown>, cond: Cond): boolean {
  for (const [col, val] of cond.eq) if (String(rowVal(row, col) ?? "") !== String(val ?? "")) return false;
  for (const [col, vals] of cond.in) if (!vals.some((v) => String(v) === String(rowVal(row, col) ?? ""))) return false;
  for (const [col, val] of cond.gt) {
    if (!(new Date(String(rowVal(row, col))).getTime() > new Date(String(val)).getTime())) return false;
  }
  for (const col of cond.isNull) if (rowVal(row, col) !== null && rowVal(row, col) !== undefined) return false;
  return true;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h;
  const T = actual;
  const tableOf = (t: unknown) =>
    t === T.liveStreamsTable
      ? "streams"
      : t === T.liveChatMessagesTable
        ? "messages"
        : t === T.liveChatMutesTable
          ? "mutes"
          : t === T.liveChannelModeratorsTable
            ? "mods"
            : t === T.creatorProfilesTable
              ? "profiles"
              : t === T.liveStreamTipsTable
                ? "tips"
                : "?";
  const allRows = (kind: string): Array<Record<string, unknown>> =>
    kind === "streams"
      ? [...state.streams.values()]
      : kind === "messages"
        ? state.messages
        : kind === "mutes"
          ? state.mutes
          : kind === "mods"
            ? state.mods
            : kind === "profiles"
              ? state.profiles
              : [];

  function selectChain(table: unknown, fields?: Record<string, { name: string }>): any {
    const kind = tableOf(table);
    let cond: Cond = { eq: [], gt: [], isNull: [], in: [] };
    let limitN: number | null = null;
    const run = () => {
      let rows = allRows(kind).filter((r) => rowMatches(r, cond));
      if (limitN !== null) rows = rows.slice(0, limitN);
      if (fields) {
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [key, col] of Object.entries(fields)) out[key] = rowVal(r, col.name) ?? null;
          return out;
        });
      }
      return rows.map((r) => ({ ...r }));
    };
    const self: any = {
      from: (_t: unknown) => self,
      where: (c: unknown) => {
        cond = parseCond(c);
        return self;
      },
      orderBy: () => self,
      limit: (n: number) => {
        limitN = n;
        return self;
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      catch: (rej: any) => Promise.resolve(run()).catch(rej),
    };
    return self;
  }

  const db = {
    select: (fields?: Record<string, { name: string }>) => ({
      from: (table: unknown) => selectChain(table, fields).from(table),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const kind = tableOf(table);
        const row: Record<string, unknown> = { ...values, created_at: new Date() };
        let conflictFn: (() => Promise<unknown[]>) | null = null;
        const self: any = {
          onConflictDoNothing: () => {
            conflictFn = async () => {
              if (kind === "mods") {
                const dupe = state.mods.some(
                  (m) => m.profile_id === values.profile_id && m.moderator_user_id === values.moderator_user_id,
                );
                if (!dupe) state.mods.push(row);
              }
              return [];
            };
            return self;
          },
          returning: async () => {
            if (kind === "messages") {
              row.id = `44444444-4444-4444-8444-${String(++state.seq).padStart(12, "0")}`;
              row.deleted_at = null;
              state.messages.push(row);
            }
            return [{ ...row }];
          },
          then: (res: any, rej: any) => (conflictFn ? conflictFn().then(res, rej) : Promise.resolve([]).then(res, rej)),
        };
        if (kind === "mutes") state.mutes.push(row);
        return self;
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const parsed = parseCond(cond);
          const kind = tableOf(table);
          for (const row of allRows(kind)) if (rowMatches(row, parsed)) Object.assign(row, patch);
          const self: any = {
            returning: async () => [],
            then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
          };
          return self;
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const parsed = parseCond(cond);
        const kind = tableOf(table);
        if (kind === "mods") state.mods = state.mods.filter((r) => !rowMatches(r, parsed));
        if (kind === "mutes") state.mutes = state.mutes.filter((r) => !rowMatches(r, parsed));
        const self: any = {
          returning: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
        return self;
      },
    }),
  };
  return { ...actual, db };
});

import moderatorsRouter from "../live-moderators";
import chatRouter, { __resetChatRateLimit } from "../live-chat";

let server: Server;
let base = "";

async function req(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.user ? { "x-test-user": opts.user } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", moderatorsRouter);
  app.use("/api", chatRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.streams.clear();
  h.messages = [];
  h.mutes = [];
  h.mods = [];
  h.seq = 0;
  h.profiles = [
    { id: PROFILE, userId: OWNER, slug: "king", displayName: "King Live", avatarUrl: null },
    { id: "22222222-2222-4222-8222-222222222221", userId: MOD, slug: "mod-one", displayName: "Mod One", avatarUrl: null },
    { id: "22222222-2222-4222-8222-222222222223", userId: MOD2, slug: "mod-two", displayName: "Mod Two", avatarUrl: null },
    { id: "22222222-2222-4222-8222-222222222222", userId: FAN, slug: "fan-one", displayName: "Fan One", avatarUrl: null },
  ];
  h.streams.set(STREAM, {
    id: STREAM,
    user_id: OWNER,
    profile_id: PROFILE,
    title: "Friday Night Live",
    status: "live",
    provider: "own-server",
    started_at: new Date(),
    ended_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  __resetChatRateLimit();
});

async function appointMod() {
  const res = await req("POST", "/api/live/moderators", { user: OWNER, body: { profileSlug: "mod-one" } });
  expect(res.status).toBe(201);
  return res;
}

describe("appointments", () => {
  it("the owner appoints by profile slug; the mod appears in the list and my-role", async () => {
    const { json } = await appointMod();
    expect(json.moderators).toHaveLength(1);
    expect(json.moderators[0]).toMatchObject({ userId: MOD, displayName: "Mod One", slug: "mod-one" });
    const role = await req("GET", `/api/live/${STREAM}/chat/my-role`, { user: MOD });
    expect(role.json).toMatchObject({ role: "moderator", ownerId: OWNER });
    expect(role.json.moderatorIds).toEqual([MOD]);
    const ownerRole = await req("GET", `/api/live/${STREAM}/chat/my-role`, { user: OWNER });
    expect(ownerRole.json.role).toBe("owner");
    const fanRole = await req("GET", `/api/live/${STREAM}/chat/my-role`, { user: FAN });
    expect(fanRole.json.role).toBe("viewer");
  });

  it("appointing twice doesn't duplicate; unknown slugs and self-appointment fail honestly", async () => {
    await appointMod();
    const again = await req("POST", "/api/live/moderators", { user: OWNER, body: { profileSlug: "@mod-one" } });
    expect(again.json.moderators).toHaveLength(1);
    expect((await req("POST", "/api/live/moderators", { user: OWNER, body: { profileSlug: "nobody" } })).status).toBe(404);
    expect((await req("POST", "/api/live/moderators", { user: OWNER, body: { profileSlug: "king" } })).status).toBe(400);
  });

  it("only the owner appoints: a moderator appointing someone lands on their own (empty) channel or fails — never the owner's", async () => {
    await appointMod();
    // MOD has their own profile, so this appoints to MOD's channel, not OWNER's.
    const byMod = await req("POST", "/api/live/moderators", { user: MOD, body: { profileSlug: "fan-one" } });
    expect(byMod.status).toBe(201);
    const ownerList = await req("GET", "/api/live/moderators", { user: OWNER });
    expect(ownerList.json.moderators.map((m: any) => m.userId)).toEqual([MOD]);
  });

  it("removal takes the powers away", async () => {
    await appointMod();
    const removed = await req("DELETE", `/api/live/moderators/${MOD}`, { user: OWNER });
    expect(removed.json.moderators).toHaveLength(0);
    const role = await req("GET", `/api/live/${STREAM}/chat/my-role`, { user: MOD });
    expect(role.json.role).toBe("viewer");
  });

  it("the chat page carries moderatorIds for badges", async () => {
    await appointMod();
    const { json } = await req("GET", `/api/live/${STREAM}/chat`);
    expect(json.moderatorIds).toEqual([MOD]);
  });
});

describe("moderator powers in chat", () => {
  beforeEach(async () => {
    await appointMod();
    await req("POST", "/api/live/moderators", { user: OWNER, body: { profileSlug: "mod-two" } });
  });

  it("a mod can delete a chatter's message and mute a chatter", async () => {
    const post = await req("POST", `/api/live/${STREAM}/chat`, { user: FAN, body: { body: "rowdy" } });
    expect(post.status).toBe(201);
    const del = await req("DELETE", `/api/live/${STREAM}/chat/${post.json.message.id}`, { user: MOD });
    expect(del.status).toBe(200);
    const mute = await req("POST", `/api/live/${STREAM}/chat/mute`, { user: MOD, body: { userId: FAN } });
    expect(mute.status).toBe(200);
    const blocked = await req("POST", `/api/live/${STREAM}/chat`, { user: FAN, body: { body: "hello?" } });
    expect(blocked.status).toBe(403);
  });

  it("a mod cannot delete the owner's message, mute the owner, or mute another mod", async () => {
    const ownerPost = await req("POST", `/api/live/${STREAM}/chat`, { user: OWNER, body: { body: "host speaks" } });
    const del = await req("DELETE", `/api/live/${STREAM}/chat/${ownerPost.json.message.id}`, { user: MOD });
    expect(del.status).toBe(403);
    const muteOwner = await req("POST", `/api/live/${STREAM}/chat/mute`, { user: MOD, body: { userId: OWNER } });
    expect(muteOwner.status).toBe(400);
    const muteMod = await req("POST", `/api/live/${STREAM}/chat/mute`, { user: MOD, body: { userId: MOD2 } });
    expect(muteMod.status).toBe(403);
    // …but the owner can mute a mod.
    const ownerMutesMod = await req("POST", `/api/live/${STREAM}/chat/mute`, { user: OWNER, body: { userId: MOD2 } });
    expect(ownerMutesMod.status).toBe(200);
  });

  it("a plain viewer still can't moderate", async () => {
    const mute = await req("POST", `/api/live/${STREAM}/chat/mute`, { user: FAN, body: { userId: MOD } });
    expect(mute.status).toBe(403);
  });
});
