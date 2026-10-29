/**
 * Route tests for Creator Room invites (stack900 Lane B4):
 *   POST /api/world/creator-rooms/:slug/invites   host invites a member
 *   GET  /api/world/room-invites/mine             my standing invites
 *   GET  /api/world/room-invites/candidates       the picker's members
 *   POST /api/world/room-invites/:id/accept       record the yes
 *   POST /api/world/room-invites/:id/decline      record the no (silent)
 *
 * The rules pinned here, against the REAL mounted handler with a
 * fake db:
 *  - only the room's host invites, and a room that is missing OR
 *    not the caller's is one closed 404 (the dressing rule);
 *  - the pick names a member by user id: self-invites and
 *    non-members refuse in plain words, and no row is written;
 *  - a duplicate pending invite refuses with NO second row and NO
 *    second bell — including the raced create, where the standing
 *    read lies stale and the table's one-pending index throws:
 *    the route reads it as the same refusal, bell still unfired;
 *  - an accepted member can't be re-invited; a declined member
 *    can (a fresh row — history is never rewritten);
 *  - accept answers only for the invitee, flips only a pending
 *    row, and tells the host exactly once (a replayed accept is a
 *    409 with the bell count unmoved); decline never tells anyone.
 *
 * The announcements ride the one event door (notifyUserEvent)
 * under the social category — proven at the composition level at
 * the bottom: the bell always lands, the ping obeys the member's
 * social preference (default OFF).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const USER_HOST = "00000000-0000-4000-8000-0000000000a1";
const USER_MEMBER = "00000000-0000-4000-8000-0000000000b2";
const USER_MEMBER2 = "00000000-0000-4000-8000-0000000000c3";
const USER_PRIVATE = "00000000-0000-4000-8000-0000000000d4";
const USER_STRANGER = "00000000-0000-4000-8000-0000000000e5";
const PROFILE_HOST = "11111111-1111-4111-8111-111111111111";
const PROFILE_MEMBER = "22222222-2222-4222-8222-222222222222";
const PROFILE_MEMBER2 = "33333333-3333-4333-8333-333333333333";
const PROFILE_PRIVATE = "44444444-4444-4444-8444-444444444444";
const INVITE_1 = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    invites: [] as Array<Record<string, unknown>>,
    /** When true, the standing-invite read returns nothing even
     *  though a pending row exists — the raced create, where the
     *  table's one-pending index is the only honest witness. */
    staleStandingRead: false,
    inviteSeq: 0,
  },
}));

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

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, worldRoomInvitesTable } = actual;

  function profileRows(cond: unknown): Array<Record<string, unknown>> {
    const { sql, params } = render(cond);
    if (sql.includes('"slug"') && sql.includes(" in ")) {
      const slugs = params.map(String);
      return state.profiles.filter((p) => slugs.includes(String(p["slug"])));
    }
    if (sql.includes('"is_public"') && sql.includes("<>")) {
      /* The candidates read: public, not the caller, optional
       * name/slug needle (the ilike params ride last, %-wrapped). */
      const caller = String(params[1] ?? "");
      const needles = params
        .slice(2)
        .map((p) => String(p).replace(/%/g, "").toLowerCase())
        .filter(Boolean);
      return state.profiles
        .filter((p) => p["isPublic"] === true && p["userId"] !== caller)
        .filter(
          (p) =>
            needles.length === 0 ||
            needles.some(
              (n) =>
                String(p["displayName"]).toLowerCase().includes(n) ||
                String(p["slug"]).toLowerCase().includes(n),
            ),
        )
        .sort((a, b) => Number(b["followerCount"] ?? 0) - Number(a["followerCount"] ?? 0));
    }
    if (sql.includes('"slug"')) {
      const slug = String(params[0] ?? "");
      return state.profiles.filter((p) => p["slug"] === slug);
    }
    if (sql.includes('"user_id"')) {
      const userId = String(params[0] ?? "");
      return state.profiles.filter((p) => p["userId"] === userId);
    }
    return [];
  }

  function inviteRows(cond: unknown): Array<Record<string, unknown>> {
    const { sql, params } = render(cond);
    if (sql.includes('"room_id"')) {
      if (state.staleStandingRead) return [];
      const roomId = String(params[0] ?? "");
      const invitee = String(params[1] ?? "");
      const statuses = params.slice(2).map(String);
      return state.invites.filter(
        (r) =>
          r["roomId"] === roomId &&
          r["inviteeUserId"] === invitee &&
          statuses.includes(String(r["status"])),
      );
    }
    if (sql.includes('"invitee_user_id"')) {
      const invitee = String(params[0] ?? "");
      const statuses = params.slice(1).map(String);
      return state.invites
        .filter((r) => r["inviteeUserId"] === invitee && statuses.includes(String(r["status"])))
        .sort((a, b) => String(b["createdAt"]).localeCompare(String(a["createdAt"])));
    }
    if (sql.includes('"id"')) {
      const id = String(params[0] ?? "");
      return state.invites.filter((r) => r["id"] === id);
    }
    return [];
  }

  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    if (table === creatorProfilesTable) return profileRows(cond);
    if (table === worldRoomInvitesTable) return inviteRows(cond);
    return [];
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => rowsFor(table, cond);
          const chain: any = {
            limit: async (n: number) => rows().slice(0, n),
            orderBy: (..._args: unknown[]) => ({
              limit: async (n: number) => rows().slice(0, n),
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
          return chain;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (table !== worldRoomInvitesTable) return [];
          const dupe = state.invites.some(
            (r) =>
              r["roomId"] === v["roomId"] &&
              r["inviteeUserId"] === v["inviteeUserId"] &&
              r["status"] === "pending",
          );
          if (dupe) {
            const err: any = new Error("duplicate key value violates unique constraint");
            err.code = "23505";
            throw err;
          }
          state.inviteSeq += 1;
          const row = {
            id: `99999999-9999-4999-8999-${String(state.inviteSeq).padStart(12, "0")}`,
            respondedAt: null,
            createdAt: new Date(),
            ...v,
          };
          state.invites.push(row);
          return [row];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (s: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            if (table !== worldRoomInvitesTable) return [];
            const { params } = render(cond);
            const id = String(params[0] ?? "");
            const row = state.invites.find((r) => r["id"] === id && r["status"] === "pending");
            if (!row) return [];
            Object.assign(row, s);
            return [row];
          },
        }),
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import router from "../world";
import {
  __setRoomInviteEventNotifier,
  buildRoomInviteAcceptedEvent,
  buildRoomInviteEvent,
  notifyRoomInviteCreated,
} from "../../lib/world-room-invites";
import {
  notifyUserEvent,
  PUSH_CATEGORY_DEFAULTS,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
} from "../../lib/push-events";

let server: any;
let baseUrl: string;
const bells: UserEventInput[] = [];

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

afterEach(() => {
  __setRoomInviteEventNotifier(null);
});

function profileRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: PROFILE_HOST,
    userId: USER_HOST,
    slug: "nova-reyes",
    displayName: "Nova Reyes",
    bio: "",
    avatarUrl: "https://cdn.example.com/nova.png",
    bannerUrl: null,
    themeId: "gold-lux",
    themeConfig: {},
    pinnedKind: null,
    pinnedItemId: null,
    isPublic: true,
    followerCount: 42,
    ...over,
  };
}

function inviteRow(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: INVITE_1,
    roomId: "creator:nova-reyes",
    roomSlug: "nova-reyes",
    inviterUserId: USER_HOST,
    inviteeUserId: USER_MEMBER,
    status: "pending",
    createdAt: new Date("2026-10-29T12:00:00.000Z"),
    respondedAt: null,
    ...over,
  };
}

async function call(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

beforeEach(() => {
  bells.length = 0;
  __setRoomInviteEventNotifier(async (input) => {
    bells.push(input);
  });
  h.state.staleStandingRead = false;
  h.state.inviteSeq = 0;
  h.state.profiles = [
    profileRow(),
    profileRow({
      id: PROFILE_MEMBER,
      userId: USER_MEMBER,
      slug: "kai-beats",
      displayName: "Kai Beats",
      avatarUrl: null,
      followerCount: 7,
    }),
    profileRow({
      id: PROFILE_MEMBER2,
      userId: USER_MEMBER2,
      slug: "quiet-corner",
      displayName: "Quiet Corner",
      avatarUrl: null,
      followerCount: 3,
    }),
    profileRow({
      id: PROFILE_PRIVATE,
      userId: USER_PRIVATE,
      slug: "hidden-one",
      displayName: "Hidden One",
      avatarUrl: null,
      isPublic: false,
      followerCount: 1,
    }),
  ];
  h.state.invites = [];
});

/* ── Create ──────────────────────────────────────────────────────── */

describe("POST /world/creator-rooms/:slug/invites", () => {
  it("the host invites a member: 201, a pending row, and exactly one social bell naming host and room", async () => {
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    expect(res.status).toBe(201);
    expect(res.json.invite).toMatchObject({
      slug: "nova-reyes",
      roomName: "Nova Reyes's Room",
      hostName: "Nova Reyes",
      status: "pending",
    });
    expect(h.state.invites).toHaveLength(1);
    expect(h.state.invites[0]).toMatchObject({
      roomId: "creator:nova-reyes",
      inviterUserId: USER_HOST,
      inviteeUserId: USER_MEMBER,
      status: "pending",
    });
    expect(bells).toEqual([
      {
        userId: USER_MEMBER,
        category: "social",
        kind: "room_invite",
        title: "🦈 Nova Reyes invited you to Nova Reyes's Room",
        body: "The invite waits in the Creator Rooms — accept it and the room is yours to walk into.",
        link: "/world",
      },
    ]);
  });

  it("a non-host gets the one closed 404 — no row, no bell", async () => {
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_MEMBER,
      body: { inviteeUserId: USER_MEMBER2 },
    });
    expect(res.status).toBe(404);
    expect(h.state.invites).toHaveLength(0);
    expect(bells).toHaveLength(0);
  });

  it("an unknown slug is the same closed 404", async () => {
    const res = await call("POST", "/world/creator-rooms/no-such-room/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    expect(res.status).toBe(404);
    expect(h.state.invites).toHaveLength(0);
    expect(bells).toHaveLength(0);
  });

  it("inviting yourself refuses in plain words — no row, no bell", async () => {
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_HOST },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain("That's you");
    expect(h.state.invites).toHaveLength(0);
    expect(bells).toHaveLength(0);
  });

  it("inviting a non-member refuses plainly — no row, no bell", async () => {
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_STRANGER },
    });
    expect(res.status).toBe(404);
    expect(res.json.error).toContain("isn't a member");
    expect(h.state.invites).toHaveLength(0);
    expect(bells).toHaveLength(0);
  });

  it("a blank pick refuses plainly", async () => {
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: {},
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain("Pick a person");
    expect(h.state.invites).toHaveLength(0);
  });

  it("a duplicate pending invite refuses with NO second row and NO second bell", async () => {
    await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toContain("already out");
    expect(h.state.invites).toHaveLength(1);
    expect(bells).toHaveLength(1);
  });

  it("the raced create (stale read, index throws) reads as the same refusal — bell still fired once, from the first create only", async () => {
    await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    h.state.staleStandingRead = true;
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toContain("already out");
    expect(h.state.invites).toHaveLength(1);
    expect(bells).toHaveLength(1);
  });

  it("an already-accepted member can't be re-invited", async () => {
    h.state.invites = [inviteRow({ status: "accepted", respondedAt: new Date() })];
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toContain("already in your room");
    expect(h.state.invites).toHaveLength(1);
    expect(bells).toHaveLength(0);
  });

  it("a declined member can be invited again — a fresh row, the old answer untouched", async () => {
    h.state.invites = [inviteRow({ status: "declined", respondedAt: new Date() })];
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_MEMBER },
    });
    expect(res.status).toBe(201);
    expect(h.state.invites).toHaveLength(2);
    expect(h.state.invites[0]!["status"]).toBe("declined");
    expect(h.state.invites[1]!["status"]).toBe("pending");
    expect(bells).toHaveLength(1);
  });

  it("a member whose profile is private can still be invited (membership, not visibility, is the rule)", async () => {
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      user: USER_HOST,
      body: { inviteeUserId: USER_PRIVATE },
    });
    expect(res.status).toBe(201);
    expect(bells).toHaveLength(1);
    expect(bells[0]!.userId).toBe(USER_PRIVATE);
  });

  it("no session, no invite: 401", async () => {
    const res = await call("POST", "/world/creator-rooms/nova-reyes/invites", {
      body: { inviteeUserId: USER_MEMBER },
    });
    expect(res.status).toBe(401);
    expect(h.state.invites).toHaveLength(0);
  });
});

/* ── Mine ────────────────────────────────────────────────────────── */

describe("GET /world/room-invites/mine", () => {
  it("lists my pending and accepted with host facts — declined and other people's stay out", async () => {
    h.state.invites = [
      inviteRow(),
      inviteRow({
        id: "66666666-6666-4666-8666-666666666666",
        roomId: "creator:quiet-corner",
        roomSlug: "quiet-corner",
        inviterUserId: USER_MEMBER2,
        status: "accepted",
        respondedAt: new Date(),
      }),
      inviteRow({
        id: "77777777-7777-4777-8777-777777777777",
        status: "declined",
        respondedAt: new Date(),
      }),
      inviteRow({ id: "88888888-8888-4888-8888-888888888888", inviteeUserId: USER_MEMBER2 }),
    ];
    const res = await call("GET", "/world/room-invites/mine", { user: USER_MEMBER });
    expect(res.status).toBe(200);
    expect(res.json.pending).toHaveLength(1);
    expect(res.json.pending[0]).toMatchObject({
      id: INVITE_1,
      slug: "nova-reyes",
      roomName: "Nova Reyes's Room",
      hostName: "Nova Reyes",
      hostAvatarUrl: "https://cdn.example.com/nova.png",
      status: "pending",
    });
    expect(res.json.accepted).toHaveLength(1);
    expect(res.json.accepted[0]).toMatchObject({
      slug: "quiet-corner",
      roomName: "Quiet Corner's Room",
      hostName: "Quiet Corner",
      status: "accepted",
    });
  });
});

/* ── Candidates ──────────────────────────────────────────────────── */

describe("GET /world/room-invites/candidates", () => {
  it("lists public members, never the caller, never a private profile", async () => {
    const res = await call("GET", "/world/room-invites/candidates", { user: USER_HOST });
    expect(res.status).toBe(200);
    const ids = res.json.members.map((m: any) => m.userId);
    expect(ids).toEqual([USER_MEMBER, USER_MEMBER2]);
    expect(res.json.members[0]).toMatchObject({ slug: "kai-beats", displayName: "Kai Beats" });
  });

  it("the search narrows by name", async () => {
    const res = await call("GET", "/world/room-invites/candidates?q=quiet", { user: USER_HOST });
    expect(res.status).toBe(200);
    expect(res.json.members.map((m: any) => m.userId)).toEqual([USER_MEMBER2]);
  });
});

/* ── Accept / decline ────────────────────────────────────────────── */

describe("POST /world/room-invites/:id/accept", () => {
  it("the invitee accepts: row flips with a stamp, the host is told exactly once", async () => {
    h.state.invites = [inviteRow()];
    const res = await call("POST", `/world/room-invites/${INVITE_1}/accept`, { user: USER_MEMBER });
    expect(res.status).toBe(200);
    expect(res.json.invite).toMatchObject({ id: INVITE_1, status: "accepted" });
    expect(h.state.invites[0]!["status"]).toBe("accepted");
    expect(h.state.invites[0]!["respondedAt"]).toBeInstanceOf(Date);
    expect(bells).toEqual([
      {
        userId: USER_HOST,
        category: "social",
        kind: "room_invite_accepted",
        title: "🦈 Kai Beats accepted your invite to Nova Reyes's Room",
        body: "They're in — look for them in the palace.",
        link: "/world",
      },
    ]);
  });

  it("a replayed accept is a 409 and the bell count does not move", async () => {
    h.state.invites = [inviteRow()];
    await call("POST", `/world/room-invites/${INVITE_1}/accept`, { user: USER_MEMBER });
    const res = await call("POST", `/world/room-invites/${INVITE_1}/accept`, { user: USER_MEMBER });
    expect(res.status).toBe(409);
    expect(bells).toHaveLength(1);
  });

  it("somebody else's invite is a 404 — the row stays pending, no bell", async () => {
    h.state.invites = [inviteRow()];
    const res = await call("POST", `/world/room-invites/${INVITE_1}/accept`, { user: USER_HOST });
    expect(res.status).toBe(404);
    expect(h.state.invites[0]!["status"]).toBe("pending");
    expect(bells).toHaveLength(0);
  });

  it("an unknown invite is the same 404", async () => {
    const res = await call("POST", `/world/room-invites/${INVITE_1}/accept`, { user: USER_MEMBER });
    expect(res.status).toBe(404);
  });
});

describe("POST /world/room-invites/:id/decline", () => {
  it("the invitee declines: row flips with a stamp and NOBODY is told", async () => {
    h.state.invites = [inviteRow()];
    const res = await call("POST", `/world/room-invites/${INVITE_1}/decline`, { user: USER_MEMBER });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(h.state.invites[0]!["status"]).toBe("declined");
    expect(h.state.invites[0]!["respondedAt"]).toBeInstanceOf(Date);
    expect(bells).toHaveLength(0);
  });

  it("an answer after the answer is a 409 either way", async () => {
    h.state.invites = [inviteRow()];
    await call("POST", `/world/room-invites/${INVITE_1}/decline`, { user: USER_MEMBER });
    const again = await call("POST", `/world/room-invites/${INVITE_1}/decline`, { user: USER_MEMBER });
    expect(again.status).toBe(409);
    const accept = await call("POST", `/world/room-invites/${INVITE_1}/accept`, { user: USER_MEMBER });
    expect(accept.status).toBe(409);
    expect(bells).toHaveLength(0);
  });
});

/* ── The announcement at the real door ───────────────────────────── */

describe("the invite announcement at the real event door", () => {
  const SOCIAL_ON: PushPreferenceMap = { ...PUSH_CATEGORY_DEFAULTS, social: true };
  const DEFAULTS: PushPreferenceMap = { ...PUSH_CATEGORY_DEFAULTS };

  function fakeLegs(prefs: PushPreferenceMap) {
    const landed: UserEventInput[] = [];
    const pushes: Array<{ userId: string; payload: unknown }> = [];
    const deps: NotifyDeps = {
      getPrefs: async () => prefs,
      insertBell: async (input) => {
        landed.push(input);
      },
      sendPush: async (userId, payload) => {
        pushes.push({ userId, payload });
        return { sent: 1, pruned: 0, failed: 0, skippedReason: null };
      },
    };
    return { landed, pushes, deps };
  }

  it("the event shape: social category, inviter and room named, the World as the door", () => {
    expect(
      buildRoomInviteEvent({
        inviteeUserId: USER_MEMBER,
        inviterName: "Nova Reyes",
        roomName: "Nova Reyes's Room",
      }),
    ).toEqual({
      userId: USER_MEMBER,
      category: "social",
      kind: "room_invite",
      title: "🦈 Nova Reyes invited you to Nova Reyes's Room",
      body: "The invite waits in the Creator Rooms — accept it and the room is yours to walk into.",
      link: "/world",
    });
    expect(
      buildRoomInviteAcceptedEvent({
        inviterUserId: USER_HOST,
        inviteeName: "Kai Beats",
        roomName: "Nova Reyes's Room",
      }),
    ).toMatchObject({ userId: USER_HOST, category: "social", kind: "room_invite_accepted" });
  });

  it("with social pings off (the default), the bell lands and no device is pinged", async () => {
    const legs = fakeLegs(DEFAULTS);
    __setRoomInviteEventNotifier((input) => notifyUserEvent(input, legs.deps));
    await notifyRoomInviteCreated({
      inviteeUserId: USER_MEMBER,
      inviterName: "Nova Reyes",
      roomName: "Nova Reyes's Room",
    });
    expect(legs.landed).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("with social pings on, the bell lands and the device is pinged once", async () => {
    const legs = fakeLegs(SOCIAL_ON);
    __setRoomInviteEventNotifier((input) => notifyUserEvent(input, legs.deps));
    await notifyRoomInviteCreated({
      inviteeUserId: USER_MEMBER,
      inviterName: "Nova Reyes",
      roomName: "Nova Reyes's Room",
    });
    expect(legs.landed).toHaveLength(1);
    expect(legs.pushes).toHaveLength(1);
    expect(legs.pushes[0]!.userId).toBe(USER_MEMBER);
  });
});
