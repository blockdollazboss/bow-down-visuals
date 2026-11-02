/**
 * Route tests for invite-to-a-show (routes/world-show-invites,
 * stack1300 Ring 3.8):
 *   POST /api/world/events/:eventId/invites   the host invites a member
 *   GET  /api/world/show-invites/mine         my standing invites
 *   POST /api/world/show-invites/:id/accept   the yes
 *   POST /api/world/show-invites/:id/decline  the (silent) no
 *
 * Contract pinned here (the room invites' discipline, carried whole):
 * - host-only: a show missing OR not the caller's is one closed 404;
 *   an invite names a MEMBER by user id — guests neither send nor
 *   receive (every route is requireAuth);
 * - the invite carries the show's identity: the response and the
 *   stored row name the event id, title, kind, room and window, so
 *   the invitee's walk resolves to the show's room;
 * - exactly-once, twice: a duplicate create is a 409 with ONE row
 *   and ONE bell standing (a raced create dying on the one-pending
 *   index reads as the same 409 and tells nothing); a replayed
 *   accept is a 409 and the host's bell still rang exactly once;
 * - a cancelled or finished show closes its invites: the host can't
 *   send for one, and an accept against one refuses in plain words
 *   without consuming the invite — a decline is always allowed;
 * - declining is silent: no bell, ever.
 *
 * Fake db mirrors world-events.test.ts: real table objects via
 * importOriginal, rows in the shared _reach-fake-db store. The
 * fake's plain insert doesn't enforce unique sets, so the raced
 * create is simulated by patching insert to throw a 23505 once —
 * the exact error the real partial index raises.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const HOST = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "00000000-0000-4000-8000-0000000000b2";
const OTHER = "00000000-0000-4000-8000-0000000000c3";
const NOBODY = "00000000-0000-4000-8000-0000000000d4"; // a user id with no profile

const SHOW = "11111111-1111-4111-8111-111111111111";
const SHOW_LIVE = "22222222-2222-4222-8222-222222222222";
const SHOW_CANCELLED = "33333333-3333-4333-8333-333333333333";
const SHOW_DONE = "44444444-4444-4444-8444-444444444444";
const SHOW_OTHER = "55555555-5555-4555-8555-555555555555";
const MISSING = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({ fake: null as any }));

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

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("../../lib/push-events", () => ({
  notifyUserEvent: vi.fn(async () => ({})),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    worldEvents: actual.worldEventsTable,
    worldShowInvites: actual.worldShowInvitesTable,
    creatorProfiles: actual.creatorProfilesTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import worldShowInvitesRouter from "../world-show-invites";
import { worldShowInvitesTable } from "@workspace/db";
import { __setShowInviteEventNotifier } from "../../lib/world-show-invites";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", worldShowInvitesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const HOUR = 3600_000;
const bells: any[] = [];

function seedAll() {
  h.fake.seed("creatorProfiles", [
    { id: "prof-host", userId: HOST, slug: "host-harriet", displayName: "Host Harriet", avatarUrl: null, isPublic: true },
    { id: "prof-member", userId: MEMBER, slug: "member-mel", displayName: "Member Mel", avatarUrl: null, isPublic: true },
    { id: "prof-other", userId: OTHER, slug: "other-ollie", displayName: "Other Ollie", avatarUrl: null, isPublic: true },
  ]);
  const inH = (n: number) => new Date(Date.now() + n * HOUR);
  h.fake.seed("worldEvents", [
    { id: SHOW, kind: "stage_show", roomId: "world:kings-hall", hostUserId: HOST, title: "Big Night", startsAt: inH(2), endsAt: inH(3), payload: {}, status: "scheduled", createdAt: new Date() },
    { id: SHOW_LIVE, kind: "listening_party", roomId: "world:music-hall", hostUserId: HOST, title: "Live Listening", startsAt: inH(-0.5), endsAt: inH(1), payload: {}, status: "live", createdAt: new Date() },
    { id: SHOW_CANCELLED, kind: "stage_show", roomId: "world:kings-hall", hostUserId: HOST, title: "Called Off", startsAt: inH(2), endsAt: inH(3), payload: {}, status: "cancelled", createdAt: new Date() },
    { id: SHOW_DONE, kind: "stage_show", roomId: "world:kings-hall", hostUserId: HOST, title: "Last Week", startsAt: inH(-3), endsAt: inH(-2), payload: {}, status: "done", createdAt: new Date() },
    { id: SHOW_OTHER, kind: "office_hours", roomId: `creator:other-ollie`, hostUserId: OTHER, title: "Ollie's Office Hours", startsAt: inH(2), endsAt: inH(3), payload: {}, status: "scheduled", createdAt: new Date() },
  ]);
}

beforeEach(() => {
  h.fake.clear();
  seedAll();
  bells.length = 0;
  __setShowInviteEventNotifier(async (input: any) => {
    bells.push(input);
  });
});
afterAll(() => __setShowInviteEventNotifier(null));

async function req(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const post = (path: string, body: unknown, user?: string) => req("POST", path, { body, user });
const inviteRows = () => h.fake.store("worldShowInvites").rows as any[];

const sendInvite = (eventId = SHOW, invitee = MEMBER, as = HOST) =>
  post(`/api/world/events/${eventId}/invites`, { inviteeUserId: invitee }, as);

describe("POST /world/events/:eventId/invites — send", () => {
  it("the host invites a member: 201, the invite carries the show's identity, one bell", async () => {
    const r = await sendInvite();
    expect(r.status).toBe(201);
    expect(r.body.invite).toMatchObject({
      eventId: SHOW,
      eventTitle: "Big Night",
      eventKind: "stage_show",
      roomId: "world:kings-hall",
      hostName: "Host Harriet",
      status: "pending",
    });
    expect(r.body.invite.startsAt).toBeTruthy();
    expect(inviteRows()).toHaveLength(1);
    expect(inviteRows()[0]).toMatchObject({ eventId: SHOW, inviteeUserId: MEMBER, inviterUserId: HOST });
    expect(bells).toHaveLength(1);
    expect(bells[0]).toMatchObject({ userId: MEMBER, category: "social", kind: "show_invite" });
    expect(bells[0].title).toContain("Big Night");
    expect(bells[0].body).toContain("The King's Hall");
  });

  it("a live show can be invited to — it stands right now", async () => {
    const r = await sendInvite(SHOW_LIVE);
    expect(r.status).toBe(201);
    expect(r.body.invite.eventKind).toBe("listening_party");
  });

  it("a duplicate invite is a 409 — one row and one bell still stand", async () => {
    await sendInvite();
    const r = await sendInvite();
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("already out");
    expect(inviteRows()).toHaveLength(1);
    expect(bells).toHaveLength(1);
  });

  it("a raced create (the one-pending index fires) reads as the same 409 and tells nothing", async () => {
    const origInsert = h.fake.db.insert;
    h.fake.db.insert = (table: unknown) => {
      if (table === (worldShowInvitesTable as unknown)) {
        return {
          values: () => ({
            returning: async () => {
              throw Object.assign(new Error("duplicate key"), { code: "23505" });
            },
          }),
        };
      }
      return origInsert(table);
    };
    try {
      const r = await sendInvite();
      expect(r.status).toBe(409);
      expect(r.body.error).toContain("already out");
      expect(bells).toHaveLength(0);
      expect(inviteRows()).toHaveLength(0);
    } finally {
      h.fake.db.insert = origInsert;
    }
  });

  it("only the host may invite: a stranger and a missing show are the same closed 404", async () => {
    expect((await sendInvite(SHOW, MEMBER, OTHER)).status).toBe(404);
    expect((await sendInvite(MISSING, MEMBER, HOST)).status).toBe(404);
    expect(inviteRows()).toHaveLength(0);
    expect(bells).toHaveLength(0);
  });

  it("inviting yourself refuses; inviting a non-member refuses — an invite names a member", async () => {
    const self = await sendInvite(SHOW, HOST, HOST);
    expect(self.status).toBe(400);
    expect(self.body.error).toContain("your own show");
    const ghost = await sendInvite(SHOW, NOBODY, HOST);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error).toContain("isn't a member");
    expect(inviteRows()).toHaveLength(0);
  });

  it("a cancelled show and a finished show refuse in their own words", async () => {
    const cancelled = await sendInvite(SHOW_CANCELLED);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error).toContain("cancelled");
    const done = await sendInvite(SHOW_DONE);
    expect(done.status).toBe(409);
    expect(done.body.error).toContain("over");
    expect(inviteRows()).toHaveLength(0);
    expect(bells).toHaveLength(0);
  });

  it("a guest sends nothing — every route is signed-in only", async () => {
    const r = await req("POST", `/api/world/events/${SHOW}/invites`, { body: { inviteeUserId: MEMBER } });
    expect(r.status).toBe(401);
    expect(inviteRows()).toHaveLength(0);
  });

  it("a declined invite doesn't block a fresh one — the member may change their mind", async () => {
    h.fake.seed("worldShowInvites", [
      {
        id: "inv-old", eventId: SHOW, eventTitle: "Big Night", eventKind: "stage_show",
        roomId: "world:kings-hall", startsAt: new Date(), endsAt: new Date(Date.now() + HOUR),
        inviterUserId: HOST, inviteeUserId: MEMBER, status: "declined",
        createdAt: new Date(), respondedAt: new Date(),
      },
    ]);
    const r = await sendInvite();
    expect(r.status).toBe(201);
    expect(inviteRows().filter((x) => x.status === "pending")).toHaveLength(1);
    expect(bells).toHaveLength(1);
  });
});

describe("GET /world/show-invites/mine", () => {
  it("splits what's waiting from what I'm coming to, each carrying its show", async () => {
    await sendInvite();
    const accepted = await sendInvite(SHOW_OTHER, MEMBER, OTHER);
    expect(accepted.status).toBe(201);
    await post(`/api/world/show-invites/${accepted.body.invite.id}/accept`, {}, MEMBER);
    const mine = await req("GET", "/api/world/show-invites/mine", { user: MEMBER });
    expect(mine.status).toBe(200);
    expect(mine.body.pending).toHaveLength(1);
    expect(mine.body.pending[0]).toMatchObject({ eventId: SHOW, eventTitle: "Big Night", hostName: "Host Harriet" });
    expect(mine.body.accepted).toHaveLength(1);
    expect(mine.body.accepted[0]).toMatchObject({ eventId: SHOW_OTHER, eventTitle: "Ollie's Office Hours", hostName: "Other Ollie" });
  });

  it("the host's own list holds only invites addressed to them — sending isn't receiving", async () => {
    await sendInvite();
    const mine = await req("GET", "/api/world/show-invites/mine", { user: HOST });
    expect(mine.body.pending).toHaveLength(0);
    expect(mine.body.accepted).toHaveLength(0);
  });
});

describe("accept / decline", () => {
  async function pendingInvite(eventId = SHOW, invitee = MEMBER, as = HOST) {
    const r = await sendInvite(eventId, invitee, as);
    expect(r.status).toBe(201);
    bells.length = 0;
    return r.body.invite.id as string;
  }

  it("accept records the yes, carries the show back, and rings the host exactly once", async () => {
    const id = await pendingInvite();
    const r = await post(`/api/world/show-invites/${id}/accept`, {}, MEMBER);
    expect(r.status).toBe(200);
    expect(r.body.invite).toMatchObject({ status: "accepted", eventId: SHOW, roomId: "world:kings-hall" });
    expect(inviteRows()[0].status).toBe("accepted");
    expect(inviteRows()[0].respondedAt).toBeTruthy();
    expect(bells).toHaveLength(1);
    expect(bells[0]).toMatchObject({ userId: HOST, kind: "show_invite_accepted" });
    expect(bells[0].title).toContain("Member Mel");
    expect(bells[0].title).toContain("Big Night");
  });

  it("a replayed accept is a 409 — the host's bell still rang exactly once", async () => {
    const id = await pendingInvite();
    await post(`/api/world/show-invites/${id}/accept`, {}, MEMBER);
    const replay = await post(`/api/world/show-invites/${id}/accept`, {}, MEMBER);
    expect(replay.status).toBe(409);
    expect(bells.filter((b) => b.kind === "show_invite_accepted")).toHaveLength(1);
  });

  it("decline records the no — and tells nobody, ever", async () => {
    const id = await pendingInvite();
    const r = await post(`/api/world/show-invites/${id}/decline`, {}, MEMBER);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(inviteRows()[0].status).toBe("declined");
    expect(bells).toHaveLength(0);
  });

  it("somebody else's invite — or a missing one — is a closed 404", async () => {
    const id = await pendingInvite();
    expect((await post(`/api/world/show-invites/${id}/accept`, {}, OTHER)).status).toBe(404);
    expect((await post(`/api/world/show-invites/${MISSING}/accept`, {}, MEMBER)).status).toBe(404);
    expect(inviteRows()[0].status).toBe("pending");
  });

  it("accepting after the show was cancelled refuses — and the invite is NOT consumed", async () => {
    const id = await pendingInvite();
    const events = h.fake.store("worldEvents").rows as any[];
    events.find((e) => e.id === SHOW).status = "cancelled";
    const r = await post(`/api/world/show-invites/${id}/accept`, {}, MEMBER);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("cancelled");
    expect(inviteRows()[0].status).toBe("pending");
    expect(bells).toHaveLength(0);
  });

  it("accepting after the show ended refuses in plain words; declining it still works", async () => {
    const id = await pendingInvite();
    const events = h.fake.store("worldEvents").rows as any[];
    events.find((e) => e.id === SHOW).status = "done";
    const r = await post(`/api/world/show-invites/${id}/accept`, {}, MEMBER);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("over");
    const no = await post(`/api/world/show-invites/${id}/decline`, {}, MEMBER);
    expect(no.status).toBe(200);
    expect(inviteRows()[0].status).toBe("declined");
  });
});
