/**
 * Route tests for the palace calendar (routes/world-events):
 *   POST   /api/world/events        book a slot
 *   GET    /api/world/events        public slate
 *   GET    /api/world/events/mine   own bookings
 *   DELETE /api/world/events/:id    cancel (host or admin)
 *
 * Contract pinned here (the booking rules are the owner's approved
 * defaults, enforced server-side):
 * - stage_show books the Throne Hall ONLY by a Front Row member —
 *   standing is server truth: a seat in the KING'S royal_court (the
 *   official profile's court), never a claim — or by an admin
 *   (ADMIN_EMAILS). Everyone else is refused FRONT_ROW_REQUIRED.
 * - listening_party books the Music Hall; any member may hold one.
 *   The wrong room for a kind is ROOM_MISMATCH; an unknown room is
 *   UNKNOWN_ROOM.
 * - drop spectacles are admin-only (ADMIN_REQUIRED).
 * - one room, one event at a time: overlapping windows conflict
 *   (SLOT_TAKEN); back-to-back slots do not.
 * - payloads are validated per kind; windows have min/max lengths.
 * - the public slate is live + upcoming only, soonest first;
 *   cancel is host-or-admin and refuses strangers and repeats.
 *
 * Fake db mirrors arcade.test.ts: real table objects via
 * importOriginal, rows in the shared _reach-fake-db store.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const FRONT = "00000000-0000-4000-8000-0000000000f1"; // Front Row member
const PLAIN = "00000000-0000-4000-8000-0000000000f2"; // member, no seat
const NOPROF = "00000000-0000-4000-8000-0000000000f3"; // member, no profile
const ADMIN = "00000000-0000-4000-8000-0000000000f4"; // admin by email
const KING_PROFILE = "11111111-1111-4111-8111-111111111111";
const FRONT_PROFILE = "22222222-2222-4222-8222-222222222222";
const PLAIN_PROFILE = "33333333-3333-4333-8333-333333333333";
const VIDEO_ID = "video:44444444-4444-4444-8444-444444444444";
const TRACK_ID = "track:55555555-5555-4555-8555-555555555555";

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

function seedPalace() {
  h.fake.seed("creatorProfiles", [
    { id: KING_PROFILE, userId: "00000000-0000-4000-8000-000000000099", slug: "thy-cheat-code", displayName: "Thy Cheat Code", isOfficial: true, isPublic: true },
    { id: FRONT_PROFILE, userId: FRONT, slug: "front", displayName: "Front Row Fran", isOfficial: false, isPublic: true },
    { id: PLAIN_PROFILE, userId: PLAIN, slug: "plain", displayName: "Plain Pat", isOfficial: false, isPublic: true },
  ]);
  h.fake.seed("royalCourt", [
    { id: "court-1", ownerProfileId: KING_PROFILE, memberProfileId: FRONT_PROFILE, position: 1 },
    // Plain Pat crowns Fran in PAT'S OWN court — that confers nothing.
    { id: "court-2", ownerProfileId: PLAIN_PROFILE, memberProfileId: FRONT_PROFILE, position: 1 },
  ]);
}

beforeEach(() => {
  h.fake.clear();
  seedPalace();
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
const post = (path: string, body: unknown, user?: string, email?: string) =>
  req("POST", path, { body, user, email });

const stageShow = (over: Record<string, unknown> = {}) => ({
  kind: "stage_show",
  roomId: "world:kings-hall",
  title: "Big Night",
  ...windowIn(2),
  payload: { contentRef: VIDEO_ID },
  ...over,
});
const party = (over: Record<string, unknown> = {}) => ({
  kind: "listening_party",
  roomId: "world:music-hall",
  title: "Album Night",
  ...windowIn(2),
  payload: { trackIds: [TRACK_ID] },
  ...over,
});
const drop = (over: Record<string, unknown> = {}) => ({
  kind: "drop",
  roomId: "world:courtyard",
  title: "Courtyard Drop",
  ...windowIn(2),
  payload: { amountVb: 200, claimCap: 3 },
  ...over,
});

describe("booking rules", () => {
  it("a Front Row member books the Throne Hall stage", async () => {
    const r = await post("/api/world/events", stageShow(), FRONT);
    expect(r.status).toBe(201);
    expect(r.body.event).toMatchObject({ kind: "stage_show", status: "scheduled", hostName: "Front Row Fran" });
  });

  it("a plain member is refused the stage — FRONT_ROW_REQUIRED (their own court confers nothing)", async () => {
    const r = await post("/api/world/events", stageShow(), PLAIN);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("FRONT_ROW_REQUIRED");
  });

  it("a member with no creator profile has no Front Row standing", async () => {
    const r = await post("/api/world/events", stageShow(), NOPROF);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("FRONT_ROW_REQUIRED");
  });

  it("an admin (ADMIN_EMAILS) books the stage without a seat", async () => {
    const r = await post("/api/world/events", stageShow(), ADMIN, "king@example.test");
    expect(r.status).toBe(201);
  });

  it("a stage show in any other room is ROOM_MISMATCH, even for the Front Row", async () => {
    const r = await post("/api/world/events", stageShow({ roomId: "world:music-hall" }), FRONT);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("ROOM_MISMATCH");
  });

  it("any member books a Music Hall listening party; the hall refuses one", async () => {
    const ok = await post("/api/world/events", party(), PLAIN);
    expect(ok.status).toBe(201);
    expect(ok.body.event.payload.trackIds).toEqual([TRACK_ID]);
    const wrong = await post("/api/world/events", party({ roomId: "world:kings-hall", ...windowIn(5) }), PLAIN);
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toBe("ROOM_MISMATCH");
  });

  it("drop spectacles are admin-only", async () => {
    const denied = await post("/api/world/events", drop(), FRONT);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("ADMIN_REQUIRED");
    const ok = await post("/api/world/events", drop(), ADMIN, "king@example.test");
    expect(ok.status).toBe(201);
    expect(ok.body.event.payload).toEqual({ amountVb: 200, claimCap: 3 });
  });

  it("unknown rooms and guests are refused before rules", async () => {
    const r = await post("/api/world/events", party({ roomId: "world:dungeon" }), PLAIN);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("UNKNOWN_ROOM");
    const anon = await post("/api/world/events", party());
    expect(anon.status).toBe(401);
  });

  it("payloads and windows are validated per kind", async () => {
    const badRef = await post("/api/world/events", stageShow({ payload: { contentRef: "https://evil.test/x.mp4" } }), FRONT);
    expect(badRef.status).toBe(400);
    expect(badRef.body.error).toBe("INVALID_PAYLOAD");
    const live = await post("/api/world/events", stageShow({ payload: { contentRef: "live" }, ...windowIn(6) }), FRONT);
    expect(live.status).toBe(201);
    const badDrop = await post("/api/world/events", drop({ payload: { amountVb: 5000, claimCap: 3 } }), ADMIN, "king@example.test");
    expect(badDrop.status).toBe(400);
    expect(badDrop.body.error).toBe("INVALID_PAYLOAD");
    const past = await post("/api/world/events", party({ startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString() }), PLAIN);
    expect(past.status).toBe(400);
    expect(past.body.error).toBe("INVALID_WINDOW");
    const tiny = await post("/api/world/events", party({ startsAt: new Date(Date.now() + HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR + 60_000).toISOString() }), PLAIN);
    expect(tiny.status).toBe(400);
    expect(tiny.body.error).toBe("INVALID_WINDOW");
  });
});

describe("slot conflicts", () => {
  it("an overlapping booking in the same room conflicts; back-to-back and other rooms do not", async () => {
    const first = await post("/api/world/events", party(windowIn(2, 2)), PLAIN);
    expect(first.status).toBe(201);
    const overlap = await post("/api/world/events", party(windowIn(3, 1)), FRONT);
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toBe("SLOT_TAKEN");
    expect(overlap.body.conflictId).toBe(first.body.event.id);
    const backToBack = await post("/api/world/events", party(windowIn(4, 1)), FRONT);
    expect(backToBack.status).toBe(201);
    const otherRoom = await post("/api/world/events", drop(windowIn(3, 1)), ADMIN, "king@example.test");
    expect(otherRoom.status).toBe(201);
  });

  it("a cancelled slot frees the room", async () => {
    const first = await post("/api/world/events", party(windowIn(2, 2)), PLAIN);
    const id = first.body.event.id;
    const cancel = await req("DELETE", `/api/world/events/${id}`, { user: PLAIN });
    expect(cancel.status).toBe(200);
    const rebook = await post("/api/world/events", party(windowIn(3, 1)), FRONT);
    expect(rebook.status).toBe(201);
  });
});

describe("the slate, mine, and cancel", () => {
  it("the public slate is live + upcoming only, soonest first, with host names", async () => {
    await post("/api/world/events", party({ title: "Later Party", ...windowIn(6) }), PLAIN);
    await post("/api/world/events", stageShow({ title: "Sooner Show", ...windowIn(3) }), FRONT);
    const gone = await post("/api/world/events", drop({ title: "Gone Drop", ...windowIn(4) }), ADMIN, "king@example.test");
    await req("DELETE", `/api/world/events/${gone.body.event.id}`, { user: ADMIN, email: "king@example.test" });

    const slate = await req("GET", "/api/world/events");
    expect(slate.status).toBe(200);
    expect(slate.body.events.map((e: any) => e.title)).toEqual(["Sooner Show", "Later Party"]);
    expect(slate.body.events[0].hostName).toBe("Front Row Fran");

    const musicOnly = await req("GET", "/api/world/events?roomId=world:music-hall");
    expect(musicOnly.body.events.map((e: any) => e.title)).toEqual(["Later Party"]);
    const badRoom = await req("GET", "/api/world/events?roomId=world:dungeon");
    expect(badRoom.status).toBe(400);
  });

  it("mine lists only the caller's bookings", async () => {
    await post("/api/world/events", party(), PLAIN);
    await post("/api/world/events", stageShow(), FRONT);
    const mine = await req("GET", "/api/world/events/mine", { user: PLAIN });
    expect(mine.body.events).toHaveLength(1);
    expect(mine.body.events[0].kind).toBe("listening_party");
    const anon = await req("GET", "/api/world/events/mine");
    expect(anon.status).toBe(401);
  });

  it("cancel is host-or-admin: strangers refused, repeats refused, admin allowed", async () => {
    const made = await post("/api/world/events", party(), PLAIN);
    const id = made.body.event.id;
    const stranger = await req("DELETE", `/api/world/events/${id}`, { user: FRONT });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe("NOT_YOURS");
    const byAdmin = await req("DELETE", `/api/world/events/${id}`, { user: ADMIN, email: "king@example.test" });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.event.status).toBe("cancelled");
    const again = await req("DELETE", `/api/world/events/${id}`, { user: PLAIN });
    expect(again.status).toBe(409);
    const missing = await req("DELETE", "/api/world/events/99999999-9999-4999-8999-999999999999", { user: PLAIN });
    expect(missing.status).toBe(404);
  });
});
