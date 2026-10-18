/**
 * Route tests for Office Hours bookings (UPGRADE-PROGRAM 3.7,
 * stack-20 #17) on the palace calendar (routes/world-events):
 *
 *   POST   /api/world/events   kind "office_hours"
 *   GET    /api/world/events   the public slate (incl. ?roomId=)
 *   DELETE /api/world/events/:id  cancel
 *
 * Contract pinned here:
 * - office hours anchor to the host's OWN creator room: roomId must
 *   be "creator:<the caller's own slug>", read off their creator
 *   profile server-side. Another creator's room is NOT_YOUR_ROOM;
 *   no profile is NO_CREATOR_ROOM; a private profile's room isn't
 *   open (ROOM_NOT_OPEN). A palace room id is UNKNOWN_ROOM for this
 *   kind — and a creator room is UNKNOWN_ROOM for the palace kinds.
 * - guests never book (401 from the auth rail).
 * - the shared calendar rules hold: window lengths, the past-start
 *   refusal, and one-room-one-event overlap (SLOT_TAKEN), with
 *   back-to-back sessions allowed.
 * - the payload is the agenda line only: trimmed, capped at 140,
 *   unknown keys dropped.
 * - cancel is the host's (or the house's); strangers are refused.
 *
 * Fake db mirrors world-events.test.ts: real table objects via
 * importOriginal, rows in the shared _reach-fake-db store.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const HOST = "00000000-0000-4000-8000-0000000000a1"; // Ada — public profile, slug "ada"
const OTHER = "00000000-0000-4000-8000-0000000000a2"; // Bo — public profile, slug "bo"
const PRIVATE = "00000000-0000-4000-8000-0000000000a3"; // Cy — profile exists but private
const NOPROF = "00000000-0000-4000-8000-0000000000a4"; // member, no creator profile
const HOST_PROFILE = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE = "22222222-2222-4222-8222-222222222222";
const PRIVATE_PROFILE = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
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

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }) }),
  addCreditsAtomic: async () => undefined,
  addCreditsToProfile: async () => ({ oldCredits: 0 }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    worldEvents: actual.worldEventsTable,
    creatorProfiles: actual.creatorProfilesTable,
    royalCourt: actual.royalCourtTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import worldEventsRouter from "../world-events";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  process.env["ADMIN_EMAILS"] = "king@example.test";
  const app = express();
  app.use(express.json());
  app.use("/api", worldEventsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

function seedProfiles() {
  h.fake.seed("creatorProfiles", [
    { id: HOST_PROFILE, userId: HOST, slug: "ada", displayName: "Ada", isOfficial: false, isPublic: true },
    { id: OTHER_PROFILE, userId: OTHER, slug: "bo", displayName: "Bo", isOfficial: false, isPublic: true },
    { id: PRIVATE_PROFILE, userId: PRIVATE, slug: "cy", displayName: "Cy", isOfficial: false, isPublic: false },
  ]);
}

beforeEach(() => {
  h.fake.clear();
  seedProfiles();
});

const HOUR = 3600_000;
function windowIn(hoursFromNow: number, lengthHours = 1) {
  const start = Date.now() + hoursFromNow * HOUR;
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + lengthHours * HOUR).toISOString(),
  };
}

async function req(method: string, path: string, opts: { user?: string; email?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
      ...(opts.email ? { "x-test-email": opts.email } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const post = (path: string, body: unknown, user?: string) => req("POST", path, { body, user });
const get = (path: string, user?: string) => req("GET", path, { user });
const del = (path: string, user?: string) => req("DELETE", path, { user });

const officeHours = (over: Record<string, unknown> = {}) => ({
  kind: "office_hours",
  roomId: "creator:ada",
  title: "Office hours — ask me anything",
  ...windowIn(2),
  payload: { note: "Mixing questions welcome" },
  ...over,
});

describe("POST /api/world/events — office hours", () => {
  it("books the host's own room: 201, the DTO carries the sanitized booking", async () => {
    const res = await post("/api/world/events", officeHours({ payload: { note: "  Mixing questions welcome  ", junk: "drop me" } }), HOST);
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      kind: "office_hours",
      roomId: "creator:ada",
      hostUserId: HOST,
      hostName: "Ada",
      title: "Office hours — ask me anything",
      status: "scheduled",
      payload: { note: "Mixing questions welcome" },
    });
  });

  it("caps the agenda line at 140 characters and allows no note at all", async () => {
    const long = await post("/api/world/events", officeHours({ payload: { note: "x".repeat(200) } }), HOST);
    expect(long.status).toBe(201);
    expect(long.body.event.payload.note).toHaveLength(140);
    const bare = await post(
      "/api/world/events",
      officeHours({ ...windowIn(5), payload: {} }),
      HOST,
    );
    expect(bare.status).toBe(201);
    expect(bare.body.event.payload).toEqual({});
  });

  it("refuses a guest outright — booking is an authed rail", async () => {
    const res = await post("/api/world/events", officeHours());
    expect(res.status).toBe(401);
  });

  it("refuses another creator's room — you hold hours in your own room", async () => {
    const res = await post("/api/world/events", officeHours(), OTHER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("NOT_YOUR_ROOM");
  });

  it("refuses a member with no creator profile — there is no room to hold hours in", async () => {
    const res = await post("/api/world/events", officeHours(), NOPROF);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("NO_CREATOR_ROOM");
  });

  it("refuses a private profile — its room isn't open, so it can't hold hours", async () => {
    const res = await post("/api/world/events", officeHours({ roomId: "creator:cy" }), PRIVATE);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ROOM_NOT_OPEN");
  });

  it("refuses a palace room for this kind, and a creator room for the palace kinds", async () => {
    const palaceRoom = await post("/api/world/events", officeHours({ roomId: "world:music-hall" }), HOST);
    expect(palaceRoom.status).toBe(400);
    expect(palaceRoom.body.error).toBe("UNKNOWN_ROOM");

    const garbage = await post("/api/world/events", officeHours({ roomId: "ada-room" }), HOST);
    expect(garbage.status).toBe(400);
    expect(garbage.body.error).toBe("UNKNOWN_ROOM");

    const party = await post(
      "/api/world/events",
      {
        kind: "listening_party",
        roomId: "creator:ada",
        title: "Party in a creator room",
        ...windowIn(3),
        payload: { trackIds: ["track:55555555-5555-4555-8555-555555555555"] },
      },
      HOST,
    );
    expect(party.status).toBe(400);
    expect(party.body.error).toBe("UNKNOWN_ROOM");
  });

  it("holds the shared calendar rules: window lengths, past starts, one session at a time", async () => {
    const tooShort = await post(
      "/api/world/events",
      officeHours({
        startsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
        endsAt: new Date(Date.now() + 2 * HOUR + 2 * 60_000).toISOString(),
      }),
      HOST,
    );
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error).toBe("INVALID_WINDOW");

    const past = await post("/api/world/events", officeHours({ ...windowIn(-2) }), HOST);
    expect(past.status).toBe(400);
    expect(past.body.error).toBe("INVALID_WINDOW");

    const first = await post("/api/world/events", officeHours(), HOST);
    expect(first.status).toBe(201);
    const overlapping = await post("/api/world/events", officeHours({ ...windowIn(2.5) }), HOST);
    expect(overlapping.status).toBe(409);
    expect(overlapping.body.error).toBe("SLOT_TAKEN");
    /* Back-to-back is a new hour, not an overlap. */
    const backToBack = await post("/api/world/events", officeHours({ ...windowIn(3) }), HOST);
    expect(backToBack.status).toBe(201);
  });

  it("another host's session in THEIR room never conflicts with yours", async () => {
    const mine = await post("/api/world/events", officeHours(), HOST);
    expect(mine.status).toBe(201);
    const theirs = await post("/api/world/events", officeHours({ roomId: "creator:bo" }), OTHER);
    expect(theirs.status).toBe(201);
  });
});

describe("the slate + cancel — office hours on the calendar", () => {
  it("the session reads on the public slate, the room's slate, and the host's mine", async () => {
    const booked = await post("/api/world/events", officeHours(), HOST);
    expect(booked.status).toBe(201);

    const slate = await get("/api/world/events");
    expect(slate.status).toBe(200);
    expect(slate.body.events.map((e: any) => e.id)).toContain(booked.body.event.id);

    const roomSlate = await get(`/api/world/events?roomId=${encodeURIComponent("creator:ada")}`);
    expect(roomSlate.status).toBe(200);
    expect(roomSlate.body.events).toHaveLength(1);
    expect(roomSlate.body.events[0]).toMatchObject({ kind: "office_hours", hostName: "Ada" });

    const otherRoom = await get(`/api/world/events?roomId=${encodeURIComponent("creator:bo")}`);
    expect(otherRoom.status).toBe(200);
    expect(otherRoom.body.events).toHaveLength(0);

    const unknownRoom = await get("/api/world/events?roomId=nowhere");
    expect(unknownRoom.status).toBe(400);
    expect(unknownRoom.body.error).toBe("UNKNOWN_ROOM");

    const mine = await get("/api/world/events/mine", HOST);
    expect(mine.body.events.map((e: any) => e.id)).toContain(booked.body.event.id);
  });

  it("the host cancels; a stranger cannot; a repeat cancel is refused", async () => {
    const booked = await post("/api/world/events", officeHours(), HOST);
    const id = booked.body.event.id as string;

    const stranger = await del(`/api/world/events/${id}`, OTHER);
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe("NOT_YOURS");

    const cancelled = await del(`/api/world/events/${id}`, HOST);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.event.status).toBe("cancelled");

    const slate = await get("/api/world/events");
    expect(slate.body.events.map((e: any) => e.id)).not.toContain(id);

    const again = await del(`/api/world/events/${id}`, HOST);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("ALREADY_OVER");
  });
});
