/**
 * Stage shoutouts in the room (lib/world-room, Ring 3, item 3.3
 * remainder).
 *
 * Pinned contract:
 * - Members only (guests are refused "guests" — before any price
 *   lookup or charge attempt can exist), a stage actually held in
 *   this room ("no-stage"), never your own stage ("self").
 * - The message is witnessed text: trimmed, non-empty, within the
 *   room's say bound (SAY_MAX_CHARS) — anything else is "message",
 *   and a paid message is never silently truncated.
 * - One shoutout per member per pace window ("too-fast"); the
 *   pace is set when the attempt is taken, before the purchase
 *   runs.
 * - The performer is captured at send time; the purchase itself
 *   is the injected shoutouter's (price from the performer's
 *   shoutout rail settings, the rail's flat-5% split). A landed
 *   shoutout is WITNESSED by the whole room (stage.shouted — fan
 *   name, performer name, message, and the amount from the
 *   shoutouter's result — server truth, never the frame); a
 *   refused purchase answers only the buyer.
 */
import { describe, it, expect, vi } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldRoom,
  type WorldIdentity,
  type WorldStageShoutouter,
} from "../world-room";

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

const member = (name: string): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
});
const guest = (): WorldIdentity => ({
  userId: null,
  displayName: "Guest",
  avatarUrl: null,
  profileSlug: null,
});

const flush = () => new Promise<void>((r) => setImmediate(r));
const T0 = 5_000_000;

function stageRoom(shoutouter?: WorldStageShoutouter, extra: { stageEnabled?: boolean } = {}) {
  return new WorldRoom(new RoomHub(), {
    ...(shoutouter ? { shoutOutStagePerformer: shoutouter } : {}),
    ...(extra.stageEnabled !== undefined ? { stageEnabled: extra.stageEnabled } : {}),
    resolveStageStream: async (userId, streamId) =>
      streamId === "stream-1"
        ? {
            streamId,
            title: "Friday Set",
            performerName: userId.replace("user-", ""),
            performerSlug: userId.replace("user-", "").toLowerCase(),
          }
        : null,
  });
}

async function roomWithStage(shoutouter?: WorldStageShoutouter) {
  const room = stageRoom(shoutouter);
  const star = fakeSocket();
  const fan = fakeSocket();
  room.attach(star, member("Star"));
  room.attach(fan, member("Fan"));
  room.handleFrame(star, JSON.stringify({ type: "stage.live", streamId: "stream-1" }), T0);
  await flush();
  star.sent = [];
  fan.sent = [];
  return { room, star, fan };
}

const okShoutouter = () => vi.fn(async () => ({ ok: true as const, amountVb: 250 }));
const shoutFrame = (message: unknown) => JSON.stringify({ type: "stage.shoutout", message });

describe("stage.shoutout", () => {
  it("a landed shoutout is witnessed by the room with server truth (fan, performer, message, charged amount)", async () => {
    const shoutouter = okShoutouter();
    const { room, star, fan } = await roomWithStage(shoutouter as WorldStageShoutouter);
    room.handleFrame(fan, shoutFrame("  Play the anthem!  "), T0 + 100);
    await flush();
    expect(shoutouter).toHaveBeenCalledTimes(1);
    const arg = shoutouter.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(arg).toMatchObject({
      fromUserId: "user-Fan",
      toUserId: "user-Star",
      message: "Play the anthem!",
      roomId: "world:kings-hall",
    });
    expect(typeof arg.attemptKey).toBe("string");
    expect((arg.attemptKey as string).length).toBeGreaterThan(0);
    const witnessed = star.sent.find((m) => m.type === "stage.shouted");
    expect(witnessed.shout).toEqual({
      name: "Fan",
      performerName: "Star",
      message: "Play the anthem!",
      amountVb: 250,
    });
    expect(fan.sent.find((m) => m.type === "stage.shouted")).toBeTruthy();
  });

  it("a guest is refused (guests) and the shoutouter never runs — no charge attempt exists", async () => {
    const shoutouter = okShoutouter();
    const { room } = await roomWithStage(shoutouter as WorldStageShoutouter);
    const g = fakeSocket();
    room.attach(g, guest());
    g.sent = [];
    room.handleFrame(g, shoutFrame("Play the anthem!"), T0 + 100);
    await flush();
    expect(shoutouter).not.toHaveBeenCalled();
    expect(g.sent).toEqual([{ type: "stage.shoutout.denied", reason: "guests" }]);
  });

  it("no stage held: refused (no-stage), shoutouter never runs", async () => {
    const shoutouter = okShoutouter();
    const room = stageRoom(shoutouter as WorldStageShoutouter);
    const fan = fakeSocket();
    room.attach(fan, member("Fan"));
    fan.sent = [];
    room.handleFrame(fan, shoutFrame("Play the anthem!"), T0);
    await flush();
    expect(shoutouter).not.toHaveBeenCalled();
    expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "no-stage" }]);
  });

  it("a stage-less room shape (stage disabled) also answers no-stage", async () => {
    const shoutouter = okShoutouter();
    const room = stageRoom(shoutouter as WorldStageShoutouter, { stageEnabled: false });
    const fan = fakeSocket();
    room.attach(fan, member("Fan"));
    fan.sent = [];
    room.handleFrame(fan, shoutFrame("Play the anthem!"), T0);
    await flush();
    expect(shoutouter).not.toHaveBeenCalled();
    expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "no-stage" }]);
  });

  it("never your own stage (self)", async () => {
    const shoutouter = okShoutouter();
    const { room, star } = await roomWithStage(shoutouter as WorldStageShoutouter);
    room.handleFrame(star, shoutFrame("Play the anthem!"), T0 + 100);
    await flush();
    expect(shoutouter).not.toHaveBeenCalled();
    expect(star.sent).toEqual([{ type: "stage.shoutout.denied", reason: "self" }]);
  });

  it("message problems refuse (message): missing, blank, non-string, over the say bound", async () => {
    const shoutouter = okShoutouter();
    const { room, fan } = await roomWithStage(shoutouter as WorldStageShoutouter);
    const badFrames = [
      JSON.stringify({ type: "stage.shoutout" }),
      shoutFrame(""),
      shoutFrame("   "),
      shoutFrame(42),
      shoutFrame("x".repeat(301)),
    ];
    let t = T0 + 100;
    for (const frame of badFrames) {
      fan.sent = [];
      room.handleFrame(fan, frame, t);
      await flush();
      expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "message" }]);
      t += 5_000;
    }
    expect(shoutouter).not.toHaveBeenCalled();
  });

  it("a message exactly at the say bound (300) is accepted whole", async () => {
    const shoutouter = okShoutouter();
    const { room, fan } = await roomWithStage(shoutouter as WorldStageShoutouter);
    room.handleFrame(fan, shoutFrame("x".repeat(300)), T0 + 100);
    await flush();
    expect(shoutouter).toHaveBeenCalledTimes(1);
    const arg = shoutouter.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect((arg.message as string).length).toBe(300);
  });

  it("pace: a second shoutout inside the window is refused (too-fast)", async () => {
    const shoutouter = okShoutouter();
    const { room, fan } = await roomWithStage(shoutouter as WorldStageShoutouter);
    room.handleFrame(fan, shoutFrame("First!"), T0 + 100);
    await flush();
    fan.sent = [];
    room.handleFrame(fan, shoutFrame("Second!"), T0 + 200);
    await flush();
    expect(shoutouter).toHaveBeenCalledTimes(1);
    expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "too-fast" }]);
  });

  it("a purchase refusal answers only the buyer — the room witnesses nothing", async () => {
    const shoutouter = vi.fn(async () => ({ ok: false as const, reason: "not-offered" as const }));
    const { room, star, fan } = await roomWithStage(shoutouter as unknown as WorldStageShoutouter);
    room.handleFrame(fan, shoutFrame("Play the anthem!"), T0 + 100);
    await flush();
    expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "not-offered" }]);
    expect(star.sent.find((m) => m.type === "stage.shouted")).toBeUndefined();
  });

  it("an insufficient refusal passes through untouched", async () => {
    const shoutouter = vi.fn(async () => ({ ok: false as const, reason: "insufficient" as const }));
    const { room, fan } = await roomWithStage(shoutouter as unknown as WorldStageShoutouter);
    room.handleFrame(fan, shoutFrame("Play the anthem!"), T0 + 100);
    await flush();
    expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "insufficient" }]);
  });

  it("no shoutouter wired: the buyer hears error, nothing is witnessed", async () => {
    const { room, star, fan } = await roomWithStage(undefined);
    room.handleFrame(fan, shoutFrame("Play the anthem!"), T0 + 100);
    await flush();
    expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "error" }]);
    expect(star.sent.find((m) => m.type === "stage.shouted")).toBeUndefined();
  });

  it("a throwing shoutouter answers the buyer error, never a witness", async () => {
    const shoutouter = vi.fn(async () => {
      throw new Error("rail down");
    });
    const { room, star, fan } = await roomWithStage(shoutouter as unknown as WorldStageShoutouter);
    room.handleFrame(fan, shoutFrame("Play the anthem!"), T0 + 100);
    await flush();
    expect(fan.sent).toEqual([{ type: "stage.shoutout.denied", reason: "error" }]);
    expect(star.sent.find((m) => m.type === "stage.shouted")).toBeUndefined();
  });
});
