/**
 * video-call (client brain) — pins:
 *  - history labels mirror the server brain from both sides, incl.
 *    missed-for-viewer (the callback affordance) rules;
 *  - thread merge interleaves calls + messages chronologically;
 *  - the WS URL is same-origin, scheme-correct, token-encoded;
 *  - server events parse strictly — junk is dropped, never thrown;
 *  - the peer session: caller offers, callee answers a held offer,
 *    early ICE queues until the remote description lands, mute /
 *    camera-off flip track.enabled (never stop), flip swaps the
 *    video sender's track with the other facingMode, close stops
 *    every local track exactly once.
 */
import { describe, it, expect, vi } from "vitest";
import {
  callHistoryLabel, isMissedForViewer, formatCallDuration,
  mergeThreadItems, buildCallWsUrl, parseCallServerEvent,
  buildSignalFrame, nextFacingMode, VideoCallPeer,
  type CallHistoryEntry, type MediaStreamLike, type MediaTrackLike,
  type PeerConnectionLike,
} from "./video-call";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function entry(over: Partial<CallHistoryEntry> = {}): CallHistoryEntry {
  return {
    id: "c1", conversationId: "conv1", callerUserId: ME, calleeUserId: OTHER,
    status: "ended", endReason: "hangup", durationSeconds: 65,
    createdAt: "2026-01-01T00:00:00Z", answeredAt: "2026-01-01T00:00:05Z",
    endedAt: "2026-01-01T00:01:10Z", ...over,
  };
}

describe("labels — mirror of the server brain", () => {
  it("ended calls read with duration from both sides", () => {
    expect(callHistoryLabel(entry(), ME)).toBe("Video call · 1m 05s");
    expect(callHistoryLabel(entry(), OTHER)).toBe("Video call · 1m 05s");
    expect(formatCallDuration(3661)).toBe("1h 01m");
    expect(formatCallDuration(9)).toBe("9s");
  });
  it("missed reads by side and cause", () => {
    const missed = entry({ status: "missed", endReason: "ring_timeout", durationSeconds: null });
    expect(callHistoryLabel(missed, ME)).toBe("Video call — no answer");
    expect(callHistoryLabel(missed, OTHER)).toBe("Missed video call");
    const cancelled = entry({ status: "missed", endReason: "caller_cancelled", durationSeconds: null });
    expect(callHistoryLabel(cancelled, ME)).toBe("Video call cancelled");
    expect(callHistoryLabel(cancelled, OTHER)).toBe("Missed video call");
  });
  it("declined / busy / blocked / failed are honest on both sides", () => {
    expect(callHistoryLabel(entry({ status: "declined" }), ME)).toBe("Video call declined");
    expect(callHistoryLabel(entry({ status: "declined" }), OTHER)).toBe("You declined the video call");
    expect(callHistoryLabel(entry({ status: "busy" }), ME)).toContain("another call");
    expect(callHistoryLabel(entry({ status: "blocked" }), ME)).toContain("blocked");
    expect(callHistoryLabel(entry({ status: "failed" }), OTHER)).toContain("couldn't connect");
  });
  it("isMissedForViewer only fires for the callee of an unanswered ring", () => {
    expect(isMissedForViewer(entry({ status: "missed" }), OTHER)).toBe(true);
    expect(isMissedForViewer(entry({ status: "busy" }), OTHER)).toBe(true);
    expect(isMissedForViewer(entry({ status: "missed" }), ME)).toBe(false);
    expect(isMissedForViewer(entry({ status: "ended" }), OTHER)).toBe(false);
    expect(isMissedForViewer(entry({ status: "declined" }), OTHER)).toBe(false);
  });
});

describe("mergeThreadItems", () => {
  it("interleaves calls between messages by creation time", () => {
    const msgs = [
      { id: "m1", created_at: "2026-01-01T00:00:00Z" },
      { id: "m2", created_at: "2026-01-01T00:10:00Z" },
    ];
    const calls = [entry({ id: "c1", createdAt: "2026-01-01T00:05:00Z" })];
    const out = mergeThreadItems(msgs, calls);
    expect(out.map((i) => i.kind)).toEqual(["message", "call", "message"]);
    expect(out[1]).toMatchObject({ kind: "call", call: { id: "c1" } });
  });
  it("empty calls leave the message list untouched and ordered", () => {
    const msgs = [
      { id: "m2", created_at: "2026-01-01T00:10:00Z" },
      { id: "m1", created_at: "2026-01-01T00:00:00Z" },
    ];
    expect(mergeThreadItems(msgs, []).map((i) => i.kind)).toEqual(["message", "message"]);
    expect(mergeThreadItems([], [])).toEqual([]);
  });
});

describe("signaling socket contract", () => {
  it("builds a same-origin ws/wss URL with the token encoded", () => {
    expect(buildCallWsUrl({ protocol: "https:", host: "x.com" }, "a b"))
      .toBe("wss://x.com/api/dm/calls/ws?token=a%20b");
    expect(buildCallWsUrl({ protocol: "http:", host: "localhost:1" }, "t"))
      .toBe("ws://localhost:1/api/dm/calls/ws?token=t");
  });
  it("parses every server event shape", () => {
    expect(parseCallServerEvent(JSON.stringify({ type: "call.hello", userId: ME })))
      .toEqual({ type: "call.hello", userId: ME });
    const ring = parseCallServerEvent(JSON.stringify({ type: "call.ring", call: entry({ status: "ringing" }), callerName: "Caller" }));
    expect(ring).toMatchObject({ type: "call.ring", callerName: "Caller" });
    expect(parseCallServerEvent(JSON.stringify({
      type: "call.signal", callId: "c1", fromUserId: OTHER, data: { kind: "offer", sdp: "v=0" },
    }))).toEqual({ type: "call.signal", callId: "c1", fromUserId: OTHER, data: { kind: "offer", sdp: "v=0" } });
    expect(parseCallServerEvent(JSON.stringify({
      type: "call.ended", callId: "c1", conversationId: "conv1", status: "ended", endReason: "hangup", durationSeconds: 12,
    }))).toMatchObject({ type: "call.ended", status: "ended", durationSeconds: 12 });
  });
  it("drops junk instead of throwing", () => {
    expect(parseCallServerEvent("not json")).toBeNull();
    expect(parseCallServerEvent("")).toBeNull();
    expect(parseCallServerEvent(JSON.stringify({ type: "call.ring", call: { id: 1 } }))).toBeNull();
    expect(parseCallServerEvent(JSON.stringify({ type: "call.signal", callId: "c", fromUserId: "u", data: { kind: "offer" } }))).toBeNull();
    expect(parseCallServerEvent(JSON.stringify({ type: "something.else" }))).toBeNull();
  });
  it("buildSignalFrame round-trips the client contract", () => {
    expect(JSON.parse(buildSignalFrame("c1", { kind: "ice", candidate: { x: 1 } })))
      .toEqual({ type: "call.signal", callId: "c1", data: { kind: "ice", candidate: { x: 1 } } });
  });
  it("flip alternates facing modes", () => {
    expect(nextFacingMode("user")).toBe("environment");
    expect(nextFacingMode("environment")).toBe("user");
  });
});

/* ── Peer session over fakes ───────────────────────────────────────── */

function fakeTrack(kind: string): MediaTrackLike & { stopped: number } {
  return { kind, enabled: true, stopped: 0, stop() { this.stopped += 1; } };
}
function fakeStream(tracks: MediaTrackLike[]): MediaStreamLike & { tracks: MediaTrackLike[] } {
  const s = {
    tracks: [...tracks],
    getTracks: () => [...s.tracks],
    getAudioTracks: () => s.tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => s.tracks.filter((t) => t.kind === "video"),
    addTrack: (t: MediaTrackLike) => { s.tracks.push(t); },
    removeTrack: (t: MediaTrackLike) => { s.tracks = s.tracks.filter((x) => x !== t); },
  };
  return s;
}
function fakePc() {
  const senders: Array<{ track: MediaTrackLike; replaceTrack: ReturnType<typeof vi.fn> }> = [];
  const pc: PeerConnectionLike & { senders: typeof senders; addedIce: unknown[]; remote: unknown; closed: boolean } = {
    senders, addedIce: [], remote: null, closed: false,
    onicecandidate: null, ontrack: null,
    addTrack: (track) => {
      const sender = { track, replaceTrack: vi.fn(async (t: MediaTrackLike) => { sender.track = t; }) };
      senders.push(sender);
      return sender;
    },
    createOffer: async () => ({ sdp: "offer-sdp" }),
    createAnswer: async () => ({ sdp: "answer-sdp" }),
    setLocalDescription: async () => {},
    setRemoteDescription: async (d) => { pc.remote = d; },
    addIceCandidate: async (c) => { pc.addedIce.push(c); },
    close: () => { pc.closed = true; },
  };
  return pc;
}

function makePeer() {
  const pc = fakePc();
  const gumCalls: Array<{ audio: boolean; video: unknown }> = [];
  const streams: Array<MediaStreamLike & { tracks: MediaTrackLike[] }> = [];
  const sent: Array<{ kind: string; sdp?: string; candidate?: unknown }> = [];
  const localSeen: Array<MediaStreamLike | null> = [];
  const peer = new VideoCallPeer({
    createPeerConnection: () => pc,
    getUserMedia: async (c) => {
      gumCalls.push(c as never);
      const s = fakeStream([fakeTrack("audio"), fakeTrack("video")]);
      streams.push(s);
      return s;
    },
    sendSignal: (d) => sent.push(d),
    onRemoteStream: () => {},
    onLocalStream: (s) => localSeen.push(s),
  });
  return { peer, pc, sent, streams, gumCalls, localSeen };
}

const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }], relayConfigured: false };

describe("VideoCallPeer", () => {
  it("caller: opens media, adds tracks, sends the offer; local ICE flows out", async () => {
    const { peer, pc, sent } = makePeer();
    await peer.startOutgoing(ICE);
    expect(sent).toEqual([{ kind: "offer", sdp: "offer-sdp" }]);
    expect(pc.senders).toHaveLength(2);
    pc.onicecandidate?.({ candidate: { c: 1 } });
    expect(sent[1]).toEqual({ kind: "ice", candidate: { c: 1 } });
  });
  it("callee: takes the held offer, answers, and early ICE flushes after the remote lands", async () => {
    const { peer, pc, sent } = makePeer();
    await peer.handleSignal({ kind: "ice", candidate: { early: true } }); // before pc exists
    await peer.acceptIncoming(ICE, "offer-sdp");
    expect(pc.remote).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(sent).toEqual([{ kind: "answer", sdp: "answer-sdp" }]);
    expect(pc.addedIce).toEqual([{ early: true }]);
  });
  it("caller: an answer sets the remote; ICE before it queues, after it flows", async () => {
    const { peer, pc } = makePeer();
    await peer.startOutgoing(ICE);
    await peer.handleSignal({ kind: "ice", candidate: "early" });
    expect(pc.addedIce).toEqual([]);
    await peer.handleSignal({ kind: "answer", sdp: "answer-sdp" });
    expect(pc.addedIce).toEqual(["early"]);
    await peer.handleSignal({ kind: "ice", candidate: "late" });
    expect(pc.addedIce).toEqual(["early", "late"]);
  });
  it("mute / camera-off flip enabled, never stop; applied even mid-open", async () => {
    const { peer, streams } = makePeer();
    peer.setMuted(true);
    await peer.startOutgoing(ICE);
    const [audio, video] = streams[0]!.tracks;
    expect(audio!.enabled).toBe(false);
    expect(video!.enabled).toBe(true);
    peer.setCameraOff(true);
    expect(video!.enabled).toBe(false);
    peer.setMuted(false);
    expect(audio!.enabled).toBe(true);
    expect((audio as { stopped: number }).stopped).toBe(0);
  });
  it("flip re-acquires with the other facingMode and swaps the sender track", async () => {
    const { peer, pc, gumCalls, streams } = makePeer();
    await peer.startOutgoing(ICE);
    const facing = await peer.flipCamera();
    expect(facing).toBe("environment");
    expect(gumCalls[1]).toEqual({ audio: false, video: { facingMode: "environment" } });
    const videoSender = pc.senders.find((s) => s.track.kind === "video")!;
    expect(videoSender.replaceTrack).toHaveBeenCalledTimes(1);
    /* the local preview stream now holds the NEW track, old one stopped */
    expect(streams[0]!.getVideoTracks()).toHaveLength(1);
    expect(streams[0]!.getVideoTracks()[0]).toBe(streams[1]!.getVideoTracks()[0]);
  });
  it("close stops every local track and closes the pc", async () => {
    const { peer, pc, streams, localSeen } = makePeer();
    await peer.startOutgoing(ICE);
    peer.close();
    for (const t of streams[0]!.tracks) expect((t as { stopped: number }).stopped).toBe(1);
    expect(pc.closed).toBe(true);
    expect(localSeen[localSeen.length - 1]).toBeNull();
  });
});
