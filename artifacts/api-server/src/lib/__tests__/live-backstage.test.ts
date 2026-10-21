/**
 * Unit tests for the backstage room (lib/live-backstage): token
 * helpers, room caps, rejoin replacement, media relay gates, and the
 * host/guest presence DTO honesty (a guest is labeled a guest in
 * every frame shape).
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  BackstageRoom,
  GUEST_ROOM_CAP,
  mintGuestToken,
  guestTokenLookup,
  guestTokenHint,
  guestTokensMatch,
} from "../live-backstage";

function fakeSocket() {
  const sent: string[] = [];
  const listeners = new Map<string, Array<(...args: never[]) => void>>();
  const socket = {
    readyState: 1,
    sent,
    closedWith: null as { code?: number; reason?: string } | null,
    send(data: string) {
      sent.push(data);
    },
    close(code?: number, reason?: string) {
      socket.closedWith = { code, reason };
    },
    terminate() {},
    ping() {},
    on(event: string, listener: (...args: never[]) => void) {
      const arr = listeners.get(event) ?? [];
      arr.push(listener);
      listeners.set(event, arr);
      return socket;
    },
    frames(): any[] {
      return sent.map((s) => JSON.parse(s));
    },
  };
  return socket as unknown as WsClientSocket & typeof socket;
}

function hostIdentity() {
  return { kind: "host" as const, userId: "host-1", guestSessionId: null, displayName: "Host", guestState: null };
}
function guestIdentity(id: string, name = "Casey") {
  return {
    kind: "guest" as const,
    userId: null,
    guestSessionId: id,
    displayName: name,
    guestState: "backstage" as const,
  };
}

describe("guest tokens", () => {
  it("mint unique high-entropy tokens; lookup is a stable hash; hint is the tail", () => {
    const a = mintGuestToken();
    const b = mintGuestToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
    expect(guestTokenLookup(a)).toBe(guestTokenLookup(a));
    expect(guestTokenLookup(a)).not.toBe(guestTokenLookup(b));
    expect(guestTokenLookup(a)).not.toContain(a);
    expect(guestTokenHint(a)).toBe(a.slice(-4));
    expect(guestTokensMatch(guestTokenLookup(a), guestTokenLookup(a))).toBe(true);
    expect(guestTokensMatch(guestTokenLookup(a), guestTokenLookup(b))).toBe(false);
  });
});

describe("BackstageRoom", () => {
  it("welcomes host + guest with honest DTOs and broadcasts joins", () => {
    const room = new BackstageRoom(new RoomHub(), "s1", "host-1");
    const host = fakeSocket();
    const guest = fakeSocket();
    expect(room.attach(host, hostIdentity())).toBe(true);
    expect(room.attach(guest, guestIdentity("g1"))).toBe(true);
    const gw = guest.frames().find((f) => f.type === "welcome");
    expect(gw.you.guest).toBe(true);
    expect(gw.you.kind).toBe("guest");
    expect(gw.peers).toHaveLength(1);
    expect(gw.peers[0].kind).toBe("host");
    const join = host.frames().find((f) => f.type === "peer.join");
    expect(join.peer.guest).toBe(true);
    expect(join.peer.displayName).toBe("Casey");
  });

  it("caps the room at GUEST_ROOM_CAP guests (the host is extra)", () => {
    const room = new BackstageRoom(new RoomHub(), "s1", "host-1");
    room.attach(fakeSocket(), hostIdentity());
    for (let i = 0; i < GUEST_ROOM_CAP; i++) {
      expect(room.attach(fakeSocket(), guestIdentity(`g${i}`))).toBe(true);
    }
    const overflow = fakeSocket();
    expect(room.attach(overflow, guestIdentity("one-too-many"))).toBe(false);
    expect(overflow.closedWith?.code).toBe(4429);
  });

  it("a guest rejoin replaces their old socket instead of doubling them", () => {
    const room = new BackstageRoom(new RoomHub(), "s1", "host-1");
    const first = fakeSocket();
    const second = fakeSocket();
    room.attach(first, guestIdentity("g1"));
    room.attach(second, guestIdentity("g1"));
    expect(room.guestCount()).toBe(1);
    expect(room.peersDto()[0].displayName).toBe("Casey");
  });

  it("media signaling requires media.join on both ends", () => {
    const room = new BackstageRoom(new RoomHub(), "s1", "host-1");
    const host = fakeSocket();
    const guest = fakeSocket();
    room.attach(host, hostIdentity());
    room.attach(guest, guestIdentity("g1"));
    const guestPeer = room.peersDto().find((p) => p.kind === "guest")!;
    const hostPeer = room.peersDto().find((p) => p.kind === "host")!;
    room.handleFrame(guest, JSON.stringify({ type: "media.signal", to: hostPeer.peerId, data: { kind: "offer" } }));
    expect(host.frames().some((f) => f.type === "media.signal")).toBe(false);
    room.handleFrame(host, JSON.stringify({ type: "media.join" }));
    room.handleFrame(guest, JSON.stringify({ type: "media.join" }));
    room.handleFrame(guest, JSON.stringify({ type: "media.signal", to: hostPeer.peerId, data: { kind: "offer", sdp: "x" } }));
    const relayed = host.frames().find((f) => f.type === "media.signal");
    expect(relayed.from).toBe(guestPeer.peerId);
    /* media.leave cuts the relay again */
    room.handleFrame(guest, JSON.stringify({ type: "media.leave" }));
    room.handleFrame(guest, JSON.stringify({ type: "media.signal", to: hostPeer.peerId, data: { kind: "offer" } }));
    expect(host.frames().filter((f) => f.type === "media.signal")).toHaveLength(1);
  });

  it("endGuestSession tells the guest why and drops only them", () => {
    const room = new BackstageRoom(new RoomHub(), "s1", "host-1");
    const host = fakeSocket();
    const g1 = fakeSocket();
    const g2 = fakeSocket();
    room.attach(host, hostIdentity());
    room.attach(g1, guestIdentity("g1"));
    room.attach(g2, guestIdentity("g2", "Robin"));
    room.endGuestSession("g1", "revoked");
    expect(g1.frames().some((f) => f.type === "session.ended" && f.reason === "revoked")).toBe(true);
    expect(g1.closedWith?.code).toBe(4403);
    expect(room.guestCount()).toBe(1);
    expect(g2.frames().some((f) => f.type === "session.ended")).toBe(false);
  });

  it("applyGuestState mirrors the DB fact to every peer", () => {
    const room = new BackstageRoom(new RoomHub(), "s1", "host-1");
    const host = fakeSocket();
    const guest = fakeSocket();
    room.attach(host, hostIdentity());
    room.attach(guest, guestIdentity("g1"));
    room.applyGuestState("g1", "on_stage");
    expect(host.frames().some((f) => f.type === "peer.state" && f.guestState === "on_stage")).toBe(true);
    expect(room.peersDto().find((p) => p.kind === "guest")?.guestState).toBe("on_stage");
    expect(room.onStageCount()).toBe(1);
  });

  it("closeAll ends the room for everyone", () => {
    const room = new BackstageRoom(new RoomHub(), "s1", "host-1");
    const host = fakeSocket();
    const guest = fakeSocket();
    room.attach(host, hostIdentity());
    room.attach(guest, guestIdentity("g1"));
    room.closeAll("The stream has ended.");
    expect(guest.frames().some((f) => f.type === "backstage.closed")).toBe(true);
    expect(room.size()).toBe(0);
  });
});
