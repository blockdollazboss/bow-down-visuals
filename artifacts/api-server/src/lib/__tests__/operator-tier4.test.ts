/**
 * Cloud Operator Phase 2, Lane F — Tier 4 admin commands, tested
 * through the REAL executor + REAL registry against a REAL palace,
 * stage room, and lock store (fake db underneath, fake sockets at
 * the doors). The handlers' one fake is the mounted-palace getter
 * (routes/world), pointed at the test palace — everything the
 * commands DO is the real rail.
 *
 * The pins (design §3 + the owner's rulings, Oct 20 2026):
 *  - authority is the ADMIN_EMAILS allowlist on the SESSION: a
 *    non-admin attempt at EVERY verb refuses, is audited with its
 *    target, and moves ZERO rails; with the allowlist unset,
 *    EVERYONE refuses, the owner included.
 *  - an admin's commands ride the real rails: kick removes, mute
 *    mutes, herald speaks palace-wide, stage promote/demote move
 *    the seat, both locks land and lift — and every one is
 *    audited `done` from the rail's result.
 *  - targets are never guessed: an ambiguous name refuses, a
 *    name with nobody home refuses, the admin's own name refuses.
 *  - the kill switch stills even the King's hands, audited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace, WORLD_PLAZA_ROOM_ID } from "../world-palace";
import { WorldLockStore } from "../world-locks";
import { StageRoom, stageRooms } from "../stage-room";
import { type WorldIdentity } from "../world-room";
import { executeAction } from "../operator-executor";
import { processOperatorReply } from "../operator-chat";

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_EMAIL = "king@example.test";
const MEMBER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER_EMAIL = "member@example.test";
const MARCUS = "11111111-1111-4111-8111-111111111111";
const MARCUS2 = "12121212-1212-4121-8121-121212121212";
const LENA = "22222222-2222-4222-8222-222222222222";
const MUSIC = "world:music-hall";

const h = vi.hoisted(() => ({ fake: null as any, palace: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../routes/__tests__/_reach-fake-db");
  const fake = createFakeDb({
    operatorActions: actual.operatorActionsTable,
    operatorPendingActions: actual.operatorPendingActionsTable,
    worldPersonLocks: actual.worldPersonLocksTable,
    worldDoorLocks: actual.worldDoorLocksTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

/* The one fake: the mounted palace is the test's palace. The
 * getter is read fresh per command, exactly like production. */
vi.mock("../../routes/world", () => ({
  getActiveWorldPalace: () => h.palace,
}));

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
let hub: RoomHub;

function auditRows(): any[] {
  return h.fake.store("operatorActions").rows;
}
function lastAudit(): any {
  return auditRows()[auditRows().length - 1];
}

function asAdmin(toolId: string, args: Record<string, unknown> = {}) {
  return executeAction({
    userId: ADMIN_ID, userEmail: ADMIN_EMAIL, toolId, args, channel: "admin_command",
  });
}
function asMember(toolId: string, args: Record<string, unknown> = {}) {
  return executeAction({
    userId: MEMBER_ID, userEmail: MEMBER_EMAIL, toolId, args, channel: "chat_text",
  });
}

beforeEach(async () => {
  h.fake.clear();
  stageRooms.clear();
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  delete process.env["OPERATOR_HANDS_ENABLED"];
  store = new WorldLockStore();
  await store.load();
  hub = new RoomHub();
  palace = new WorldPalace(hub, {}, { lockStore: store });
  h.palace = palace;
});

afterEach(() => {
  delete process.env["ADMIN_EMAILS"];
  delete process.env["OPERATOR_HANDS_ENABLED"];
  stageRooms.clear();
  h.palace = null;
});

/** Marcus stands in the palace — on the King's Plaza, where
 *  admission lands since Open World Phase 1; returns his socket. */
function marcusInPalace(): FakeSocket {
  const s = fakeSocket();
  expect(palace.enterHall(s, member(MARCUS, "Marcus"))).toBe(true);
  return s;
}

describe("the gate — authority is the session, never the words", () => {
  it("a non-admin attempt at EVERY verb refuses, audits with its target, and moves zero rails", async () => {
    const marcus = marcusInPalace();
    /* A stage room with a listener, for the stage verbs. */
    const stage = new StageRoom(hub, "stage-1", ADMIN_ID);
    stageRooms.set("stage-1", stage);
    const lenaSock = fakeSocket();
    stage.attach(lenaSock, { userId: LENA, displayName: "Lena" });

    const attempts: Array<[string, Record<string, unknown>]> = [
      ["world.kick", { target: "Marcus" }],
      ["world.mute", { target: "Marcus" }],
      ["world.herald", { text: "Bow down" }],
      ["world.stage_promote", { target: "Lena" }],
      ["world.stage_demote", { target: "Lena" }],
      ["world.lock_person", { target: "Marcus", minutes: 30 }],
      ["world.unlock_person", { target: "Marcus" }],
      ["world.lock_room", { room: "Music Hall" }],
      ["world.unlock_room", { room: "Music Hall" }],
    ];
    for (const [toolId, args] of attempts) {
      const outcome = await asMember(toolId, args);
      expect(outcome.status, toolId).toBe("refused");
      expect(outcome.reason, toolId).toBe("not_admin");
      expect(outcome.replyText).toContain("King's call");
    }
    /* Every attempt is on the record, with its target named. */
    expect(auditRows()).toHaveLength(attempts.length);
    for (const row of auditRows()) {
      expect(row.result).toBe("refused");
      expect(row.resultReason).toBe("not_admin");
      expect(row.tier).toBe(4);
      expect(row.adminEmail).toBeNull();
    }
    expect(auditRows().find((r) => r.toolId === "world.kick")?.target).toBe("Marcus");
    expect(auditRows().find((r) => r.toolId === "world.lock_person")?.target).toBe("Marcus");
    /* Zero rails moved: Marcus stands, unmuted, unlocked; Lena
     * still listens; no door locked; no herald was heard. */
    expect(palace.roomOf(marcus)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
    expect(palace.plazaRoom.peerFor(marcus)?.hostMuted).toBe(false);
    expect(store.personLocksByName("Marcus")).toHaveLength(0);
    expect(store.isDoorLocked(MUSIC)).toBe(false);
    expect(stage.peersDto().find((p) => p.displayName === "Lena")?.role).toBe("listener");
    expect(marcus.sent.some((m) => m.type === "palace.announce")).toBe(false);
  });

  it("with ADMIN_EMAILS unset, everyone refuses — the owner included (fail-closed)", async () => {
    delete process.env["ADMIN_EMAILS"];
    const marcus = marcusInPalace();
    const outcome = await asAdmin("world.kick", { target: "Marcus" });
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("not_admin");
    expect(lastAudit()).toMatchObject({ result: "refused", resultReason: "not_admin", toolId: "world.kick" });
    expect(palace.roomOf(marcus)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
  });

  it("the kill switch stills even an admin's hands, audited", async () => {
    process.env["OPERATOR_HANDS_ENABLED"] = "off";
    const marcus = marcusInPalace();
    const outcome = await asAdmin("world.kick", { target: "Marcus" });
    expect(outcome.status).toBe("refused");
    expect(outcome.reason).toBe("hands_disabled");
    expect(lastAudit()).toMatchObject({ result: "refused", resultReason: "hands_disabled" });
    expect(palace.roomOf(marcus)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
  });
});

describe("an admin's commands ride the real rails", () => {
  it("kick removes the person, on the rail, audited from its result", async () => {
    const marcus = marcusInPalace();
    const outcome = await asAdmin("world.kick", { target: "Marcus" });
    expect(outcome.status).toBe("done");
    expect(marcus.sent.some((m) => m.type === "removed" && m.reason === "host")).toBe(true);
    expect(marcus.closedWith?.code).toBe(4413);
    expect(palace.roomOf(marcus)).toBeNull();
    expect(lastAudit()).toMatchObject({
      result: "done", toolId: "world.kick", tier: 4,
      adminEmail: ADMIN_EMAIL, target: "Marcus — The King's Plaza",
    });
  });

  it("mute and unmute move the peer's voice state", async () => {
    const marcus = marcusInPalace();
    const muted = await asAdmin("world.mute", { target: "Marcus" });
    expect(muted.status).toBe("done");
    expect(palace.plazaRoom.peerFor(marcus)?.hostMuted).toBe(true);
    const again = await asAdmin("world.mute", { target: "Marcus" });
    expect(again.status).toBe("failed");
    const unmuted = await asAdmin("world.mute", { target: "Marcus", muted: false });
    expect(unmuted.status).toBe("done");
    expect(palace.plazaRoom.peerFor(marcus)?.hostMuted).toBe(false);
  });

  it("herald speaks to the whole palace at once", async () => {
    const marcus = marcusInPalace();
    const outcome = await asAdmin("world.herald", { text: "The court is in session." });
    expect(outcome.status).toBe("done");
    const announce = marcus.sent.find((m) => m.type === "palace.announce");
    expect(announce?.announce).toMatchObject({ kind: "herald", text: "The court is in session." });
    expect(lastAudit()).toMatchObject({ result: "done", toolId: "world.herald", target: "The whole palace" });
  });

  it("stage promote and demote move the seat", async () => {
    const stage = new StageRoom(hub, "stage-1", ADMIN_ID);
    stageRooms.set("stage-1", stage);
    const lenaSock = fakeSocket();
    stage.attach(lenaSock, { userId: LENA, displayName: "Lena" });
    expect(stage.peersDto()[0]?.role).toBe("listener");
    const promoted = await asAdmin("world.stage_promote", { target: "Lena" });
    expect(promoted.status).toBe("done");
    expect(stage.peersDto()[0]?.role).toBe("speaker");
    const demoted = await asAdmin("world.stage_demote", { target: "Lena" });
    expect(demoted.status).toBe("done");
    expect(stage.peersDto()[0]?.role).toBe("listener");
  });

  it("lock_person removes them now, binds the door after, and unlock_person frees it", async () => {
    const marcus = marcusInPalace();
    const locked = await asAdmin("world.lock_person", { target: "Marcus", minutes: 30 });
    expect(locked.status).toBe("done");
    expect(locked.replyText).toContain("30 minutes");
    expect(locked.replyText).toContain("The King's Plaza");
    /* Out now, on the lock's own reason… */
    expect(marcus.sent.some((m) => m.type === "removed" && m.reason === "locked")).toBe(true);
    expect(palace.roomOf(marcus)).toBeNull();
    /* …and the door refuses the account however it comes back. */
    const again = fakeSocket();
    expect(palace.enterHall(again, member(MARCUS, "Marcus"))).toBe(false);
    expect(store.personLock(WORLD_PLAZA_ROOM_ID, MARCUS)).not.toBeNull();
    expect(lastAudit()).toMatchObject({
      result: "done", toolId: "world.lock_person", target: "Marcus — The King's Plaza",
    });
    /* The lift resolves by name while he's absent — and frees him. */
    const lifted = await asAdmin("world.unlock_person", { target: "Marcus" });
    expect(lifted.status).toBe("done");
    expect(store.personLock(WORLD_PLAZA_ROOM_ID, MARCUS)).toBeNull();
    const freed = fakeSocket();
    expect(palace.enterHall(freed, member(MARCUS, "Marcus"))).toBe(true);
  });

  it("lock_room locks the named room's door; unlock_room reopens it", async () => {
    const marcus = marcusInPalace();
    const locked = await asAdmin("world.lock_room", { room: "Music Hall" });
    expect(locked.status).toBe("done");
    expect(palace.directory().find((e) => e.id === MUSIC)?.locked).toBe(true);
    palace.handleFrame(marcus, JSON.stringify({ type: "room.enter", roomId: MUSIC }));
    expect(marcus.sent.some((m) => m.type === "room.locked" && m.kind === "door")).toBe(true);
    expect(palace.roomOf(marcus)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
    const unlocked = await asAdmin("world.unlock_room", { room: "Music Hall" });
    expect(unlocked.status).toBe("done");
    expect(palace.directory().find((e) => e.id === MUSIC)?.locked).toBe(false);
    palace.handleFrame(marcus, JSON.stringify({ type: "room.enter", roomId: MUSIC }));
    expect(palace.roomOf(marcus)?.roomId).toBe(MUSIC);
  });

  it("the command channel end to end: a marker with args runs the verb for an admin — and only an admin", async () => {
    const marcus = marcusInPalace();
    const memberTurn = await processOperatorReply({
      userId: MEMBER_ID, userEmail: MEMBER_EMAIL, channel: "chat_text",
      modelReply: "Right away. [[DO:world.kick {\"target\":\"Marcus\"}]]",
    });
    expect(memberTurn?.action.status).toBe("refused");
    expect(memberTurn?.replyText).toContain("King's call");
    expect(palace.roomOf(marcus)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
    const adminTurn = await processOperatorReply({
      userId: ADMIN_ID, userEmail: ADMIN_EMAIL, channel: "admin_command",
      modelReply: "Done. [[DO:world.kick {\"target\":\"Marcus\"}]]",
    });
    expect(adminTurn?.action.status).toBe("done");
    expect(palace.roomOf(marcus)).toBeNull();
  });
});

describe("targets are never guessed", () => {
  it("an ambiguous name refuses — and the room settles it", async () => {
    const marcusA = marcusInPalace();
    const marcusB = fakeSocket();
    expect(palace.enterHall(marcusB, member(MARCUS2, "Marcus"))).toBe(true);
    palace.handleFrame(marcusB, JSON.stringify({ type: "room.enter", roomId: MUSIC }));
    expect(palace.roomOf(marcusB)?.roomId).toBe(MUSIC);

    const refused = await asAdmin("world.kick", { target: "Marcus" });
    expect(refused.status).toBe("failed");
    expect(lastAudit().result).toBe("failed");
    expect(String(lastAudit().resultReason)).toContain("2 people named");
    expect(palace.roomOf(marcusA)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
    expect(palace.roomOf(marcusB)?.roomId).toBe(MUSIC);

    const settled = await asAdmin("world.kick", { target: "Marcus", room: "Music Hall" });
    expect(settled.status).toBe("done");
    expect(palace.roomOf(marcusB)).toBeNull();
    expect(palace.roomOf(marcusA)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
  });

  it("a name with nobody home refuses honestly", async () => {
    marcusInPalace();
    const outcome = await asAdmin("world.kick", { target: "Nobody" });
    expect(outcome.status).toBe("failed");
    expect(String(lastAudit().resultReason)).toContain("can't find anyone named");
  });

  it("the admin's own name refuses — he is not kicked on his own word", async () => {
    const king = fakeSocket();
    expect(palace.enterHall(king, member(ADMIN_ID, "King", true))).toBe(true);
    const outcome = await asAdmin("world.kick", { target: "King" });
    expect(outcome.status).toBe("failed");
    expect(palace.roomOf(king)?.roomId).toBe(WORLD_PLAZA_ROOM_ID);
  });

  it("a guest cannot be person-locked — a lock binds an account", async () => {
    const guest = fakeSocket();
    expect(
      palace.enterHall(guest, { userId: null, displayName: "Wanderer", avatarUrl: null, profileSlug: null }),
    ).toBe(true);
    const outcome = await asAdmin("world.lock_person", { target: "Wanderer", minutes: 30 });
    expect(outcome.status).toBe("failed");
    expect(String(lastAudit().resultReason)).toContain("guest");
    expect(h.fake.store("worldPersonLocks").rows).toHaveLength(0);
  });
});
