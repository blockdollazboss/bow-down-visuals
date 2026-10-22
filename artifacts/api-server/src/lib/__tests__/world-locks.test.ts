/**
 * The World's locks (Lane F, migration 0179) — the rails, tested
 * against the REAL WorldPalace + WorldLockStore on the shared fake
 * db, driven the way routes/world.ts drives them: fake sockets,
 * enterHall at the door, room.enter frames through the palace.
 *
 * The pins (owner rulings, Oct 20 2026 — "lock" = BOTH kinds):
 *  - a PERSON lock binds the account at that room's door: refused
 *    at first entry AND at the doorway, a rejoin cannot shed it,
 *    a restart (a fresh store hydrated from the tables) cannot
 *    shed it; expiry frees the door and an early unlock frees it.
 *  - a DOOR lock keeps everyone inside, refuses everyone new —
 *    except an admin account, who always walks in (standing law).
 *  - the directory tells the truth about a locked door.
 *
 * Open World Phase 1 moved the front door: first entry now lands
 * on the King's Plaza, so the first-entry pins bind the PLAZA's
 * door — and the hall's own locks now bind at the hall's doorway,
 * like every other room's ("binds only the room it names").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace, WORLD_PLAZA_ROOM_ID } from "../world-palace";
import { WorldLockStore } from "../world-locks";
import {
  WORLD_DOOR_LOCKED_CLOSE_CODE,
  WORLD_LOCKED_OUT_CLOSE_CODE,
  WORLD_ROOM_ID,
  type WorldIdentity,
} from "../world-room";

const MARCUS = "11111111-1111-4111-8111-111111111111";
const LENA = "22222222-2222-4222-8222-222222222222";
const KING = "33333333-3333-4333-8333-333333333333";
const MUSIC = "world:music-hall";
/** The front door since Open World Phase 1. */
const PLAZA = WORLD_PLAZA_ROOM_ID;

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../routes/__tests__/_reach-fake-db");
  const fake = createFakeDb({
    worldPersonLocks: actual.worldPersonLocksTable,
    worldDoorLocks: actual.worldDoorLocksTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

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

let store: WorldLockStore;
let palace: WorldPalace;

beforeEach(async () => {
  h.fake.clear();
  store = new WorldLockStore();
  await store.load();
  palace = new WorldPalace(new RoomHub(), {}, { lockStore: store });
});

function enterHall(socket: FakeSocket, identity: WorldIdentity): boolean {
  return palace.enterHall(socket, identity);
}

function transfer(socket: FakeSocket, roomId: string): void {
  palace.handleFrame(socket, JSON.stringify({ type: "room.enter", roomId }));
}

describe("person lock — the door binds the account", () => {
  it("refuses a locked member at first entry, with the lock's own frame + close code", async () => {
    await store.lockPerson({
      roomId: PLAZA, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 60,
    });
    const s = fakeSocket();
    expect(enterHall(s, member(MARCUS, "Marcus"))).toBe(false);
    const locked = s.sent.find((m) => m.type === "room.locked");
    expect(locked).toMatchObject({ kind: "person", roomId: PLAZA });
    expect(typeof locked.until).toBe("string");
    expect(s.closedWith?.code).toBe(WORLD_LOCKED_OUT_CLOSE_CODE);
    expect(palace.totalPopulation()).toBe(0);
  });

  it("lets everyone else in, and binds only the room it names", async () => {
    await store.lockPerson({
      roomId: MUSIC, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 60,
    });
    const marcus = fakeSocket();
    const lena = fakeSocket();
    expect(enterHall(marcus, member(MARCUS, "Marcus"))).toBe(true);
    expect(enterHall(lena, member(LENA, "Lena"))).toBe(true);
    /* The doorway refuses him too — and he keeps his place: a
     * refused transfer never costs a walker the palace. */
    transfer(marcus, MUSIC);
    expect(marcus.sent.some((m) => m.type === "room.locked" && m.kind === "person")).toBe(true);
    expect(marcus.closedWith).toBeNull();
    expect(palace.roomOf(marcus)?.roomId).toBe(PLAZA);
    transfer(lena, MUSIC);
    expect(palace.roomOf(lena)?.roomId).toBe(MUSIC);
  });

  it("a hall lock no longer bars the palace — it binds at the hall's own door", async () => {
    /* The hall was the front door when the lock law was written;
     * since Phase 1 the plaza is, so a hall person-lock admits
     * the member to the grounds and refuses them at the hall
     * doorway — the same per-room law, at the room it names. */
    await store.lockPerson({
      roomId: WORLD_ROOM_ID, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 60,
    });
    const marcus = fakeSocket();
    expect(enterHall(marcus, member(MARCUS, "Marcus"))).toBe(true);
    expect(palace.roomOf(marcus)?.roomId).toBe(PLAZA);
    transfer(marcus, WORLD_ROOM_ID);
    expect(marcus.sent.some((m) => m.type === "room.locked" && m.kind === "person")).toBe(true);
    expect(marcus.closedWith).toBeNull();
    expect(palace.roomOf(marcus)?.roomId).toBe(PLAZA);
  });

  it("a rejoin cannot shed it, and a restart cannot shed it", async () => {
    await store.lockPerson({
      roomId: PLAZA, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 60,
    });
    const first = fakeSocket();
    expect(enterHall(first, member(MARCUS, "Marcus"))).toBe(false);
    const second = fakeSocket();
    expect(enterHall(second, member(MARCUS, "Marcus"))).toBe(false);
    /* Restart: a brand-new store + palace over the same tables. */
    const store2 = new WorldLockStore();
    await store2.load();
    const palace2 = new WorldPalace(new RoomHub(), {}, { lockStore: store2 });
    const third = fakeSocket();
    expect(palace2.enterHall(third, member(MARCUS, "Marcus"))).toBe(false);
    expect(store2.personLock(PLAZA, MARCUS)).not.toBeNull();
  });

  it("expiry frees the door, and an early unlock frees it now", async () => {
    /* A lock whose time has already run out is not mirrored at
     * load — the door is simply open. */
    const past = fakeSocket();
    await store.lockPerson({
      roomId: PLAZA, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 0.001, now: Date.now() - 60_000,
    });
    const reloaded = new WorldLockStore();
    await reloaded.load();
    const palace2 = new WorldPalace(new RoomHub(), {}, { lockStore: reloaded });
    expect(palace2.enterHall(past, member(MARCUS, "Marcus"))).toBe(true);

    /* A standing lock, lifted early by an admin. */
    await store.lockPerson({
      roomId: PLAZA, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 60,
    });
    const refused = fakeSocket();
    expect(enterHall(refused, member(MARCUS, "Marcus"))).toBe(false);
    expect(await store.unlockPerson(PLAZA, MARCUS)).toBe(true);
    const freed = fakeSocket();
    expect(enterHall(freed, member(MARCUS, "Marcus"))).toBe(true);
    /* Lifting twice is honest about there being nothing to lift. */
    expect(await store.unlockPerson(PLAZA, MARCUS)).toBe(false);
  });

  it("re-locking replaces the standing lock — the newest command is the truth", async () => {
    const first = await store.lockPerson({
      roomId: WORLD_ROOM_ID, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 30,
    });
    const second = await store.lockPerson({
      roomId: WORLD_ROOM_ID, userId: MARCUS, displayName: "Marcus",
      lockedByUserId: KING, minutes: 120,
    });
    expect(second.expiresAt).toBeGreaterThan(first.expiresAt);
    expect(h.fake.store("worldPersonLocks").rows).toHaveLength(1);
    expect(store.personLock(WORLD_ROOM_ID, MARCUS)?.expiresAt).toBe(second.expiresAt);
  });
});

describe("door lock — inside stays, nobody new, admins always", () => {
  it("refuses a new entry at a locked plaza door, insiders untouched", async () => {
    const lena = fakeSocket();
    expect(enterHall(lena, member(LENA, "Lena"))).toBe(true);
    await store.lockDoor({ roomId: PLAZA, lockedByUserId: KING });
    const marcus = fakeSocket();
    expect(enterHall(marcus, member(MARCUS, "Marcus"))).toBe(false);
    const locked = marcus.sent.find((m) => m.type === "room.locked");
    expect(locked).toMatchObject({ kind: "door", roomId: PLAZA });
    expect(marcus.closedWith?.code).toBe(WORLD_DOOR_LOCKED_CLOSE_CODE);
    /* Lena never moved. */
    expect(palace.roomOf(lena)?.roomId).toBe(PLAZA);
    expect(palace.totalPopulation()).toBe(1);
  });

  it("refuses a doorway transfer into a locked room; the walker keeps their place", async () => {
    const marcus = fakeSocket();
    expect(enterHall(marcus, member(MARCUS, "Marcus"))).toBe(true);
    await store.lockDoor({ roomId: MUSIC, lockedByUserId: KING });
    transfer(marcus, MUSIC);
    expect(marcus.sent.some((m) => m.type === "room.locked" && m.kind === "door")).toBe(true);
    expect(marcus.closedWith).toBeNull();
    expect(palace.roomOf(marcus)?.roomId).toBe(PLAZA);
  });

  it("an admin account walks through a locked door — entry and doorway both", async () => {
    await store.lockDoor({ roomId: PLAZA, lockedByUserId: KING });
    await store.lockDoor({ roomId: MUSIC, lockedByUserId: KING });
    const king = fakeSocket();
    expect(enterHall(king, member(KING, "King", true))).toBe(true);
    transfer(king, MUSIC);
    expect(palace.roomOf(king)?.roomId).toBe(MUSIC);
  });

  it("unlocking reopens the door, and the directory tells the truth throughout", async () => {
    const entry = () => palace.directory().find((e) => e.id === MUSIC);
    expect(entry()?.locked).toBe(false);
    await store.lockDoor({ roomId: MUSIC, lockedByUserId: KING });
    expect(entry()?.locked).toBe(true);
    expect(await store.unlockDoor(MUSIC)).toBe(true);
    expect(entry()?.locked).toBe(false);
    expect(await store.unlockDoor(MUSIC)).toBe(false);
    const marcus = fakeSocket();
    expect(enterHall(marcus, member(MARCUS, "Marcus"))).toBe(true);
    transfer(marcus, MUSIC);
    expect(palace.roomOf(marcus)?.roomId).toBe(MUSIC);
  });
});
