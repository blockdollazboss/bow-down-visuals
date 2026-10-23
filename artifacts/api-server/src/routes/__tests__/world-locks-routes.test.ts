/**
 * Route tests for the World's admin lock verbs (items 92–93):
 *   GET  /api/world/locks
 *   POST /api/world/locks/door/lock     { roomId }
 *   POST /api/world/locks/door/unlock   { roomId }
 *   POST /api/world/locks/person/lock   { roomId, peerId | targetName |
 *                                         userId (+displayName), minutes? }
 *   POST /api/world/locks/person/unlock { roomId, userId | targetName }
 *
 * Peace law pinned here: ONLY admin accounts fire these. The gate
 * is the same fail-closed ADMIN_EMAILS check the operator's
 * Tier-4 commands stand behind (isWorldAdminEmail on the verified
 * session email) behind requireAuth — a guest is 401, a signed-in
 * non-admin is 403, and an unset allowlist refuses even the admin
 * address. The verbs write the SAME WorldLockStore the join path
 * enforces, proved by walking fake sockets through the real
 * palace after each HTTP verb lands.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ADMIN = "00000000-0000-4000-8000-0000000000f4";
const MARCUS = "11111111-1111-4111-8111-111111111111";
const LENA = "22222222-2222-4222-8222-222222222222";
const ADMIN_EMAIL = "king@example.test";
const MUSIC = "world:music-hall";

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

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    worldPersonLocks: actual.worldPersonLocksTable,
    worldDoorLocks: actual.worldDoorLocksTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import router, { registerWorldWs, parseWorldLockMinutes, WORLD_LOCK_MAX_MINUTES } from "../world";
import { WORLD_PLAZA_ROOM_ID, type WorldPalace } from "../../lib/world-palace";
import type { WorldIdentity } from "../../lib/world-room";
import type { WsClientSocket } from "../../lib/live-ws";

const PLAZA = WORLD_PLAZA_ROOM_ID;

let base = "";
let server: ReturnType<express.Express["listen"]>;
let palace: WorldPalace;

const gatewayStub: any = { register: () => undefined };

async function freshPalace(): Promise<void> {
  h.fake.clear();
  palace = registerWorldWs(gatewayStub);
  await palace.lockStore!.load();
}

beforeAll(async () => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  palace?.dispose();
  await new Promise((r) => server.close(r));
});

beforeEach(async () => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  await freshPalace();
});

async function call(
  method: string,
  path: string,
  opts: { user?: string; email?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
      ...(opts.email ? { "x-test-email": opts.email } : {}),
    },
    body: opts.body === undefined || method === "GET" ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const asAdmin = { user: ADMIN, email: ADMIN_EMAIL };
const asMarcus = { user: MARCUS, email: "marcus@example.test" };

/* ── Fake palace walkers (the world-locks.test harness shape) ── */

interface FakeSocket extends WsClientSocket {
  sent: any[];
  closedWith: { code?: number; reason?: string } | null;
}

function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    readyState: 1,
    sent: [],
    closedWith: null,
    send(data: string) {
      s.sent.push(JSON.parse(data));
    },
    close(code?: number, reason?: string) {
      s.closedWith = { code, reason };
      s.readyState = 3;
    },
    terminate() {
      s.readyState = 3;
    },
    ping() {},
    on() {
      return s;
    },
  };
  return s;
}

const member = (userId: string, name: string, admin = false): WorldIdentity => ({
  userId,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
  ...(admin ? { admin: true } : {}),
});

function walkIn(socket: FakeSocket, identity: WorldIdentity): boolean {
  return palace.enterPalace(socket, identity);
}

function transfer(socket: FakeSocket, roomId: string): void {
  palace.handleFrame(socket, JSON.stringify({ type: "room.enter", roomId }));
}

function peerIdOf(roomId: string, userId: string): string {
  const found = palace.room(roomId)!.presentMembers().find((m) => m.userId === userId);
  expect(found, `expected ${userId} present in ${roomId}`).toBeTruthy();
  return found!.peerId;
}

describe("the admin gate — peace law, fail-closed", () => {
  it("a guest (no session) is rejected 401 on every verb and the list", async () => {
    for (const [method, path] of [
      ["GET", "/api/world/locks"],
      ["POST", "/api/world/locks/door/lock"],
      ["POST", "/api/world/locks/door/unlock"],
      ["POST", "/api/world/locks/person/lock"],
      ["POST", "/api/world/locks/person/unlock"],
    ] as const) {
      const r = await call(method, path, { body: { roomId: MUSIC, userId: MARCUS } });
      expect(r.status, `${method} ${path}`).toBe(401);
    }
    expect(h.fake.store("worldDoorLocks").rows).toHaveLength(0);
    expect(h.fake.store("worldPersonLocks").rows).toHaveLength(0);
  });

  it("a signed-in non-admin is rejected 403 ADMIN_REQUIRED and nothing is written", async () => {
    const door = await call("POST", "/api/world/locks/door/lock", { ...asMarcus, body: { roomId: MUSIC } });
    expect(door.status).toBe(403);
    expect(door.body.code).toBe("ADMIN_REQUIRED");
    const person = await call("POST", "/api/world/locks/person/lock", {
      ...asMarcus,
      body: { roomId: MUSIC, userId: LENA, displayName: "Lena" },
    });
    expect(person.status).toBe(403);
    const list = await call("GET", "/api/world/locks", asMarcus);
    expect(list.status).toBe(403);
    expect(h.fake.store("worldDoorLocks").rows).toHaveLength(0);
    expect(h.fake.store("worldPersonLocks").rows).toHaveLength(0);
    expect(palace.lockStore!.isDoorLocked(MUSIC)).toBe(false);
  });

  it("an unset ADMIN_EMAILS allowlist refuses even the admin address", async () => {
    delete process.env["ADMIN_EMAILS"];
    const r = await call("POST", "/api/world/locks/door/lock", { ...asAdmin, body: { roomId: MUSIC } });
    expect(r.status).toBe(403);
    expect(palace.lockStore!.isDoorLocked(MUSIC)).toBe(false);
  });
});

describe("door verbs", () => {
  it("admin locks a door: the directory pill lands and new joins are denied; unlock reopens", async () => {
    const lena = fakeSocket();
    expect(walkIn(lena, member(LENA, "Lena"))).toBe(true);
    transfer(lena, MUSIC);
    expect(palace.roomOf(lena)?.roomId).toBe(MUSIC);

    const locked = await call("POST", "/api/world/locks/door/lock", { ...asAdmin, body: { roomId: MUSIC } });
    expect(locked.status).toBe(200);
    expect(locked.body.door).toMatchObject({ roomId: MUSIC, locked: true });
    expect(locked.body.rooms.find((r: any) => r.id === MUSIC)?.locked).toBe(true);

    const dir = await call("GET", "/api/world/directory");
    expect(dir.body.rooms.find((r: any) => r.id === MUSIC)?.locked).toBe(true);

    /* Lena, already inside, is untouched; Marcus, new, is refused
     * at the doorway and keeps his place on the plaza. */
    expect(palace.roomOf(lena)?.roomId).toBe(MUSIC);
    const marcus = fakeSocket();
    expect(walkIn(marcus, member(MARCUS, "Marcus"))).toBe(true);
    transfer(marcus, MUSIC);
    expect(marcus.sent.some((m) => m.type === "room.locked" && m.kind === "door")).toBe(true);
    expect(palace.roomOf(marcus)?.roomId).toBe(PLAZA);

    /* An admin account still walks in — standing World law. */
    const king = fakeSocket();
    expect(walkIn(king, member(ADMIN, "King", true))).toBe(true);
    transfer(king, MUSIC);
    expect(palace.roomOf(king)?.roomId).toBe(MUSIC);

    const unlocked = await call("POST", "/api/world/locks/door/unlock", { ...asAdmin, body: { roomId: MUSIC } });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.door).toMatchObject({ roomId: MUSIC, locked: false });
    transfer(marcus, MUSIC);
    expect(palace.roomOf(marcus)?.roomId).toBe(MUSIC);
  });

  it("relocking a locked door is a 409 and unlocking an open door a 404; unknown rooms 404", async () => {
    expect((await call("POST", "/api/world/locks/door/unlock", { ...asAdmin, body: { roomId: MUSIC } })).status).toBe(404);
    expect((await call("POST", "/api/world/locks/door/lock", { ...asAdmin, body: { roomId: MUSIC } })).status).toBe(200);
    const again = await call("POST", "/api/world/locks/door/lock", { ...asAdmin, body: { roomId: MUSIC } });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_LOCKED");
    expect((await call("POST", "/api/world/locks/door/lock", { ...asAdmin, body: { roomId: "world:nope" } })).status).toBe(404);
    expect((await call("POST", "/api/world/locks/door/lock", { ...asAdmin, body: {} })).status).toBe(404);
  });
});

describe("person verbs", () => {
  it("admin locks a standing member out by peerId: evicted now, denied at the door until unlocked", async () => {
    const marcus = fakeSocket();
    expect(walkIn(marcus, member(MARCUS, "Marcus"))).toBe(true);
    transfer(marcus, MUSIC);
    expect(palace.roomOf(marcus)?.roomId).toBe(MUSIC);
    const peerId = peerIdOf(MUSIC, MARCUS);

    const locked = await call("POST", "/api/world/locks/person/lock", {
      ...asAdmin,
      body: { roomId: MUSIC, peerId, minutes: 120 },
    });
    expect(locked.status).toBe(200);
    expect(locked.body.evicted).toBe(true);
    expect(locked.body.person).toMatchObject({ roomId: MUSIC, userId: MARCUS, displayName: "Marcus" });
    const spanMs = Date.parse(locked.body.person.expiresAt) - Date.parse(locked.body.person.createdAt);
    expect(spanMs).toBe(120 * 60_000);
    expect(palace.roomOf(marcus)).toBeNull();

    /* Rejoining the palace works; the locked room's door refuses. */
    const back = fakeSocket();
    expect(walkIn(back, member(MARCUS, "Marcus"))).toBe(true);
    transfer(back, MUSIC);
    expect(back.sent.some((m) => m.type === "room.locked" && m.kind === "person")).toBe(true);
    expect(palace.roomOf(back)?.roomId).toBe(PLAZA);

    const unlocked = await call("POST", "/api/world/locks/person/unlock", {
      ...asAdmin,
      body: { roomId: MUSIC, userId: MARCUS },
    });
    expect(unlocked.status).toBe(200);
    transfer(back, MUSIC);
    expect(palace.roomOf(back)?.roomId).toBe(MUSIC);

    /* Lifting a lock that isn't standing is an honest 404. */
    const again = await call("POST", "/api/world/locks/person/unlock", {
      ...asAdmin,
      body: { roomId: MUSIC, userId: MARCUS },
    });
    expect(again.status).toBe(404);
  });

  it("locks by targetName in the room, and by userId + displayName for a member not standing there", async () => {
    const lena = fakeSocket();
    expect(walkIn(lena, member(LENA, "Lena"))).toBe(true);
    const byName = await call("POST", "/api/world/locks/person/lock", {
      ...asAdmin,
      body: { roomId: PLAZA, targetName: "lena" },
    });
    expect(byName.status).toBe(200);
    expect(byName.body.person.userId).toBe(LENA);
    expect(palace.lockStore!.personLock(PLAZA, LENA)).not.toBeNull();
    const lifted = await call("POST", "/api/world/locks/person/unlock", {
      ...asAdmin,
      body: { roomId: PLAZA, targetName: "Lena" },
    });
    expect(lifted.status).toBe(200);
    expect(palace.lockStore!.personLock(PLAZA, LENA)).toBeNull();

    /* Marcus is nowhere in the palace: an account lock still lands. */
    const absent = await call("POST", "/api/world/locks/person/lock", {
      ...asAdmin,
      body: { roomId: MUSIC, userId: MARCUS, displayName: "Marcus" },
    });
    expect(absent.status).toBe(200);
    expect(absent.body.evicted).toBe(false);
    const marcus = fakeSocket();
    expect(walkIn(marcus, member(MARCUS, "Marcus"))).toBe(true);
    transfer(marcus, MUSIC);
    expect(palace.roomOf(marcus)?.roomId).toBe(PLAZA);
  });

  it("refuses a guest target, a self-lock, and a nameless target", async () => {
    const guest = fakeSocket();
    expect(walkIn(guest, { userId: null, displayName: "Guest", avatarUrl: null, profileSlug: null })).toBe(true);
    const guestPeer = palace.room(PLAZA)!.presentMembers().find((m) => m.userId === null);
    expect(guestPeer).toBeTruthy();
    const guestLock = await call("POST", "/api/world/locks/person/lock", {
      ...asAdmin,
      body: { roomId: PLAZA, peerId: guestPeer!.peerId },
    });
    expect(guestLock.status).toBe(400);
    expect(guestLock.body.code).toBe("TARGET_IS_GUEST");

    const self = await call("POST", "/api/world/locks/person/lock", {
      ...asAdmin,
      body: { roomId: MUSIC, userId: ADMIN, displayName: "King" },
    });
    expect(self.status).toBe(400);
    expect(self.body.code).toBe("TARGET_IS_SELF");

    const nobody = await call("POST", "/api/world/locks/person/lock", { ...asAdmin, body: { roomId: MUSIC } });
    expect(nobody.status).toBe(400);
    expect(nobody.body.code).toBe("TARGET_REQUIRED");
    expect(h.fake.store("worldPersonLocks").rows).toHaveLength(0);
  });

  it("the admin list carries the standing locks; durations clamp to a week, defaulting to an hour", async () => {
    await call("POST", "/api/world/locks/door/lock", { ...asAdmin, body: { roomId: MUSIC } });
    const long = await call("POST", "/api/world/locks/person/lock", {
      ...asAdmin,
      body: { roomId: MUSIC, userId: MARCUS, displayName: "Marcus", minutes: 999_999 },
    });
    expect(long.status).toBe(200);
    expect(Date.parse(long.body.person.expiresAt) - Date.parse(long.body.person.createdAt)).toBe(
      WORLD_LOCK_MAX_MINUTES * 60_000,
    );
    const list = await call("GET", "/api/world/locks", asAdmin);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.doors.map((d: any) => d.roomId)).toEqual([MUSIC]);
    expect(list.body.persons).toHaveLength(1);
    expect(list.body.persons[0]).toMatchObject({ roomId: MUSIC, userId: MARCUS, displayName: "Marcus" });

    expect(parseWorldLockMinutes(undefined)).toBe(60);
    expect(parseWorldLockMinutes("120")).toBe(60);
    expect(parseWorldLockMinutes(45.6)).toBe(46);
    expect(parseWorldLockMinutes(0)).toBe(60);
  });
});
