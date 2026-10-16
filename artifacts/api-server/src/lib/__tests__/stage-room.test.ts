/** Stack 10 #6 — stage room protocol: host/speaker/listener roles,
 *  promotion caps, guest listen-only, voice mesh gating, text chat. */
import { describe, it, expect } from "vitest";
import { StageRoom, STAGE_SPEAKER_CAP } from "../stage-room";
import { RoomHub, type WsClientSocket } from "../live-ws";

class FakeSocket {
  readyState = 1; sent: any[] = []; closed: number | null = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code?: number) { this.closed = code ?? null; }
  terminate() {} ping() {}
  on() { return this; }
  types() { return this.sent.map((m) => m.type); }
}
const asSock = (s: FakeSocket) => s as unknown as WsClientSocket;

function roomWith(nListeners: number) {
  const room = new StageRoom(new RoomHub(), "room-1", "host-user");
  const host = new FakeSocket();
  room.attach(asSock(host), { userId: "host-user", displayName: "Host" });
  const listeners: FakeSocket[] = [];
  for (let i = 0; i < nListeners; i++) {
    const s = new FakeSocket();
    room.attach(asSock(s), { userId: `user-${i}`, displayName: `Fan ${i}` });
    listeners.push(s);
  }
  const peerIdOf = (s: FakeSocket) => s.sent.find((m) => m.type === "welcome")?.peerId as string;
  return { room, host, listeners, peerIdOf };
}

describe("StageRoom", () => {
  it("host joins as host, members as listeners; guests are listen-only for voice and text", () => {
    const { room } = roomWith(1);
    const guest = new FakeSocket();
    room.attach(asSock(guest), { userId: null, displayName: "Guest" });
    room.handleFrame(asSock(guest), JSON.stringify({ type: "voice.join" }));
    expect(guest.types()).toContain("voice.denied");
    room.handleFrame(asSock(guest), JSON.stringify({ type: "say", body: "hi" }));
    expect(guest.types()).toContain("denied");
  });

  it("a listener cannot join voice until the host promotes them", () => {
    const { room, host, listeners, peerIdOf } = roomWith(1);
    const fan = listeners[0]!;
    room.handleFrame(asSock(fan), JSON.stringify({ type: "voice.join" }));
    expect(fan.types()).toContain("voice.denied");
    const err = room.setRole(asSock(host), peerIdOf(fan), "speaker");
    expect(err).toBeNull();
    room.handleFrame(asSock(fan), JSON.stringify({ type: "voice.join" }));
    expect(fan.types()).toContain("voice.state");
  });

  it("only the host changes roles, and the speaker cap is honest", () => {
    const { room, listeners, peerIdOf } = roomWith(STAGE_SPEAKER_CAP + 2);
    // a listener trying to promote someone is refused
    expect(room.setRole(asSock(listeners[0]!), peerIdOf(listeners[1]!), "speaker")).toMatch(/Only the host/);
    // fill the stage: host already counts as one speaker
    const hostSock = (room as any); // promote via a fresh room host socket below
    void hostSock;
  });

  it("speaker cap: host + promotions stop at the cap with a named limit", () => {
    const room = new StageRoom(new RoomHub(), "room-2", "host-user");
    const host = new FakeSocket();
    room.attach(asSock(host), { userId: "host-user", displayName: "Host" });
    const socks: FakeSocket[] = [];
    for (let i = 0; i < STAGE_SPEAKER_CAP + 1; i++) {
      const s = new FakeSocket(); room.attach(asSock(s), { userId: `u-${i}`, displayName: `U${i}` }); socks.push(s);
    }
    const pid = (s: FakeSocket) => s.sent.find((m) => m.type === "welcome")?.peerId as string;
    let lastErr: string | null = null; let promoted = 0;
    for (const s of socks) { const e = room.setRole(asSock(host), pid(s), "speaker"); if (e) lastErr = e; else promoted++; }
    expect(room.speakerCount()).toBe(STAGE_SPEAKER_CAP);
    expect(promoted).toBe(STAGE_SPEAKER_CAP - 1);
    expect(lastErr).toMatch(/stage is full/i);
  });

  it("text chat broadcasts to the room with the author's name", () => {
    const { room, listeners } = roomWith(2);
    room.handleFrame(asSock(listeners[0]!), JSON.stringify({ type: "say", body: "hello stage" }));
    const got = listeners[1]!.sent.find((m) => m.type === "peer.say");
    expect(got?.body).toBe("hello stage");
  });
});
