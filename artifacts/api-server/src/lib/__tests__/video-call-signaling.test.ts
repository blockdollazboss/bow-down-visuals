/**
 * video-call-signaling (hub) — pins:
 *  - events fan out to every live socket a member holds, dead sockets
 *    are pruned, and a member with no socket is simply unreachable
 *    (the ring ledger + timeout own that story, not a fake delivery);
 *  - a signal frame relays ONLY between the two participants of a
 *    ringing/live call on an inbox conversation — strangers, settled
 *    calls and blocked threads relay nothing;
 *  - malformed frames relay nothing; ping is swallowed as keepalive.
 */
import { describe, it, expect } from "vitest";
import { VideoCallHub, type SignalingCallView } from "../video-call-signaling";
import type { WsClientSocket } from "../live-ws";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const CALL_ID = "44444444-4444-4444-8444-444444444444";

function fakeSocket(): WsClientSocket & { sent: string[] } {
  const s: any = {
    readyState: 1,
    sent: [] as string[],
    send(data: string) { s.sent.push(data); },
    close() { s.readyState = 3; },
    terminate() { s.readyState = 3; },
    ping() {},
    on() { return s; },
  };
  return s;
}

const liveCall: SignalingCallView = {
  id: CALL_ID, conversationId: "55555555-5555-4555-8555-555555555555",
  callerUserId: ME, calleeUserId: OTHER, status: "accepted", conversationStatus: "inbox",
};
const getCall = async (id: string) => (id === CALL_ID ? liveCall : null);
const frame = (data: unknown) => JSON.stringify({ type: "call.signal", callId: CALL_ID, data });

describe("VideoCallHub delivery", () => {
  it("fans out to all of a member's sockets and reports reachability", async () => {
    const hub = new VideoCallHub();
    const a = fakeSocket(); const b = fakeSocket();
    hub.attach(OTHER, a); hub.attach(OTHER, b);
    expect(hub.isOnline(OTHER)).toBe(true);
    expect(hub.socketCount(OTHER)).toBe(2);
    const n = hub.sendToUser(OTHER, { type: "call.accepted", callId: CALL_ID, conversationId: liveCall.conversationId });
    expect(n).toBe(2);
    expect(a.sent).toHaveLength(1);
    expect(JSON.parse(b.sent[0]!).type).toBe("call.accepted");
    hub.detach(a);
    expect(hub.socketCount(OTHER)).toBe(1);
    hub.detach(b);
    expect(hub.isOnline(OTHER)).toBe(false);
    expect(hub.sendToUser(OTHER, { type: "call.accepted", callId: CALL_ID, conversationId: "x" })).toBe(0);
  });
  it("prunes dead sockets instead of counting them delivered", () => {
    const hub = new VideoCallHub();
    const dead = fakeSocket(); dead.readyState = 3;
    hub.attach(OTHER, dead);
    expect(hub.sendToUser(OTHER, { type: "call.accepted", callId: CALL_ID, conversationId: "x" })).toBe(0);
    expect(hub.socketCount(OTHER)).toBe(0);
  });
});

describe("VideoCallHub.relayFrame", () => {
  function setup() {
    const hub = new VideoCallHub();
    const peerSock = fakeSocket();
    hub.attach(OTHER, peerSock);
    return { hub, peerSock };
  }
  it("relays an offer from caller to callee with the sender named", async () => {
    const { hub, peerSock } = setup();
    const ok = await hub.relayFrame(ME, frame({ kind: "offer", sdp: "v=0..." }), getCall);
    expect(ok).toBe(true);
    const got = JSON.parse(peerSock.sent[0]!);
    expect(got).toEqual({ type: "call.signal", callId: CALL_ID, fromUserId: ME, data: { kind: "offer", sdp: "v=0..." } });
  });
  it("relays ICE back from callee to caller", async () => {
    const hub = new VideoCallHub();
    const callerSock = fakeSocket();
    hub.attach(ME, callerSock);
    const ok = await hub.relayFrame(OTHER, frame({ kind: "ice", candidate: { candidate: "x" } }), getCall);
    expect(ok).toBe(true);
    expect(JSON.parse(callerSock.sent[0]!).fromUserId).toBe(OTHER);
  });
  it("a stranger's frame goes nowhere", async () => {
    const { hub, peerSock } = setup();
    expect(await hub.relayFrame(THIRD, frame({ kind: "offer", sdp: "v=0" }), getCall)).toBe(false);
    expect(peerSock.sent).toHaveLength(0);
  });
  it("a blocked thread or a settled call relays nothing", async () => {
    const { hub, peerSock } = setup();
    const blocked = async () => ({ ...liveCall, conversationStatus: "blocked" });
    expect(await hub.relayFrame(ME, frame({ kind: "offer", sdp: "v=0" }), blocked)).toBe(false);
    const ended = async () => ({ ...liveCall, status: "ended" as const });
    expect(await hub.relayFrame(ME, frame({ kind: "ice", candidate: {} }), ended)).toBe(false);
    expect(peerSock.sent).toHaveLength(0);
  });
  it("unknown calls and junk frames relay nothing; ping is a calm keepalive", async () => {
    const { hub, peerSock } = setup();
    expect(await hub.relayFrame(ME, frame({ kind: "offer", sdp: "v=0" }), async () => null)).toBe(false);
    expect(await hub.relayFrame(ME, "garbage", getCall)).toBe(false);
    expect(await hub.relayFrame(ME, JSON.stringify({ type: "call.ping" }), getCall)).toBe(true);
    expect(peerSock.sent).toHaveLength(0);
  });
  it("a valid frame to an offline peer reports not-delivered (no fake success)", async () => {
    const hub = new VideoCallHub();
    expect(await hub.relayFrame(ME, frame({ kind: "offer", sdp: "v=0" }), getCall)).toBe(false);
  });
});
