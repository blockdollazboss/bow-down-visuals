/**
 * Stage tips in the room (lib/world-room, Ring 3, item 3.3).
 *
 * Pinned contract:
 * - Members only (guests are refused "guests"), a stage actually
 *   held in this room ("no-stage"), never your own stage ("self").
 * - Amounts ride the house tip bounds from lib/live-config —
 *   integers from 100 to 1,000,000 VB; anything else is "amount".
 * - One tip per member per pace window ("too-fast"); the pace is
 *   set when the attempt is taken, before the transfer runs.
 * - The performer is captured at send time; the transfer itself is
 *   the injected tipper's. A landed tip is WITNESSED by the whole
 *   room (stage.tipped — tipper name, performer name, amount);
 *   a refused transfer answers only the tipper.
 */
import { describe, it, expect, vi } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldRoom,
  type WorldIdentity,
  type WorldStageTipper,
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

function stageRoom(tipper: WorldStageTipper) {
  return new WorldRoom(new RoomHub(), {
    tipStagePerformer: tipper,
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

async function roomWithStage(tipper: WorldStageTipper) {
  const room = stageRoom(tipper);
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

const okTipper = () => vi.fn(async () => ({ ok: true as const }));

describe("stage.tip", () => {
  it("a landed tip is witnessed by the room with server truth (tipper, performer, amount)", async () => {
    const tipper = okTipper();
    const { room, star, fan } = await roomWithStage(tipper as WorldStageTipper);
    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0 + 100);
    await flush();
    expect(tipper).toHaveBeenCalledTimes(1);
    const arg = tipper.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(arg).toMatchObject({
      fromUserId: "user-Fan",
      toUserId: "user-Star",
      amountVb: 250,
      roomId: "world:kings-hall",
    });
    expect(typeof arg.attemptKey).toBe("string");
    const witnessed = star.sent.find((m) => m.type === "stage.tipped");
    expect(witnessed.tip).toEqual({ name: "Fan", performerName: "Star", amountVb: 250 });
    expect(fan.sent.find((m) => m.type === "stage.tipped")).toBeTruthy();
  });

  it("a guest is refused (guests) and the tipper never runs", async () => {
    const tipper = okTipper();
    const { room } = await roomWithStage(tipper as WorldStageTipper);
    const g = fakeSocket();
    room.attach(g, guest());
    g.sent = [];
    room.handleFrame(g, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0 + 100);
    await flush();
    expect(g.sent.find((m) => m.type === "stage.tip.denied")?.reason).toBe("guests");
    expect(tipper).not.toHaveBeenCalled();
  });

  it("with no stage held, a tip reads no-stage; the performer tipping themselves reads self", async () => {
    const tipper = okTipper();
    const bare = stageRoom(tipper as WorldStageTipper);
    const fan = fakeSocket();
    bare.attach(fan, member("Fan"));
    bare.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0);
    await flush();
    expect(fan.sent.find((m) => m.type === "stage.tip.denied")?.reason).toBe("no-stage");

    const { room, star } = await roomWithStage(tipper as WorldStageTipper);
    room.handleFrame(star, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0 + 100);
    await flush();
    expect(star.sent.find((m) => m.type === "stage.tip.denied")?.reason).toBe("self");
    expect(tipper).not.toHaveBeenCalled();
  });

  it("amounts ride the house bounds: 99, a fraction, and 1,000,001 refuse; 100 and 1,000,000 land", async () => {
    const tipper = okTipper();
    const { room, fan } = await roomWithStage(tipper as WorldStageTipper);
    const denied = () => fan.sent.filter((m) => m.type === "stage.tip.denied").pop()?.reason;
    let t = T0 + 100;
    for (const bad of [99, 100.5, 1_000_001, 0, -5]) {
      fan.sent = [];
      room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: bad }), t);
      await flush();
      expect(denied()).toBe("amount");
      t += 3_000;
    }
    expect(tipper).not.toHaveBeenCalled();
    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 100 }), t);
    await flush();
    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 1_000_000 }), t + 3_000);
    await flush();
    expect(tipper).toHaveBeenCalledTimes(2);
  });

  it("a second tip inside the pace window reads too-fast; after it, tips flow again", async () => {
    const tipper = okTipper();
    const { room, fan } = await roomWithStage(tipper as WorldStageTipper);
    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 100 }), T0 + 100);
    await flush();
    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 100 }), T0 + 500);
    await flush();
    expect(fan.sent.filter((m) => m.type === "stage.tip.denied").pop()?.reason).toBe("too-fast");
    expect(tipper).toHaveBeenCalledTimes(1);
    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 100 }), T0 + 2_200);
    await flush();
    expect(tipper).toHaveBeenCalledTimes(2);
  });

  it("a refused transfer answers only the tipper with the transfer's reason", async () => {
    const tipper = vi.fn(async () => ({ ok: false as const, reason: "insufficient" as const }));
    const { room, star, fan } = await roomWithStage(tipper as unknown as WorldStageTipper);
    room.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 500 }), T0 + 100);
    await flush();
    expect(fan.sent.find((m) => m.type === "stage.tip.denied")?.reason).toBe("insufficient");
    expect(star.sent.find((m) => m.type === "stage.tipped")).toBeUndefined();
  });

  it("a room without the stage refuses tips entirely (no-stage)", async () => {
    const tipper = okTipper();
    const treasury = new WorldRoom(
      new RoomHub(),
      { tipStagePerformer: tipper as WorldStageTipper },
      { roomId: "world:treasury", name: "Treasury" },
    );
    const fan = fakeSocket();
    treasury.attach(fan, member("Fan"));
    treasury.handleFrame(fan, JSON.stringify({ type: "stage.tip", amountVb: 250 }), T0);
    await flush();
    expect(fan.sent.find((m) => m.type === "stage.tip.denied")?.reason).toBe("no-stage");
    expect(tipper).not.toHaveBeenCalled();
  });
});
