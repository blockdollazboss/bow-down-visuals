/**
 * video-calls (pure brain) — pins:
 *  - the call gate IS the DM gate: inbox only, blocked never,
 *    requests must be accepted before anyone can ring (a call is
 *    more intrusive than a message), self-calls and non-participants
 *    refused;
 *  - signaling re-checks privacy per frame (a mid-call block stops
 *    the next frame);
 *  - the state machine settles every ring honestly (declined /
 *    missed / busy / blocked / failed) and a settled call never moves;
 *  - actor rules: callee answers, caller cancels, either hangs up;
 *  - durations + history labels read honestly from both sides;
 *  - frames: malformed / oversized / off-contract are dropped;
 *  - ICE: STUN always; TURN only all-or-nothing, ephemeral-signed
 *    when a secret exists, VIDEO_CALL_* env wins over WORLD_TURN_*.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  canCallConversation, canSignalForCall, transitionCall, actorMayAct,
  isTerminalCallStatus, callDurationSeconds, formatCallDuration,
  callHistoryLabel, parseCallClientFrame, callPeerOf,
  buildVideoCallIceConfig, RING_TIMEOUT_MS, MAX_SIGNAL_FRAME_BYTES,
  type CallHistoryEntry,
} from "../video-calls";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CALL_ID = "44444444-4444-4444-8444-444444444444";

describe("canCallConversation — DM privacy, inherited exactly", () => {
  const base = { callerUserId: ME, calleeUserId: OTHER, callerIsParticipant: true };
  it("inbox: allowed", () => {
    expect(canCallConversation({ ...base, conversationStatus: "inbox" })).toEqual({
      allowed: true, code: null, message: null,
    });
  });
  it("blocked: refused, code blocked", () => {
    const g = canCallConversation({ ...base, conversationStatus: "blocked" });
    expect(g.allowed).toBe(false);
    expect(g.code).toBe("blocked");
  });
  it("request: refused — ringing someone who hasn't accepted is a dumb interruption", () => {
    const g = canCallConversation({ ...base, conversationStatus: "request" });
    expect(g.allowed).toBe(false);
    expect(g.code).toBe("not_accepted");
  });
  it("self-call refused; non-participant refused", () => {
    expect(canCallConversation({ ...base, conversationStatus: "inbox", calleeUserId: ME }).code).toBe("self_call");
    expect(canCallConversation({ ...base, conversationStatus: "inbox", callerIsParticipant: false }).code).toBe("not_participant");
  });
});

describe("canSignalForCall — per-frame privacy re-check", () => {
  const base = { conversationStatus: "inbox", callStatus: "accepted" as const, fromUserId: ME, callerUserId: ME, calleeUserId: OTHER };
  it("participant on a live call in an inbox thread: ok", () => {
    expect(canSignalForCall(base)).toBe(true);
    expect(canSignalForCall({ ...base, callStatus: "ringing" })).toBe(true);
  });
  it("a block landing mid-call stops the very next frame", () => {
    expect(canSignalForCall({ ...base, conversationStatus: "blocked" })).toBe(false);
  });
  it("strangers and settled calls cannot signal", () => {
    expect(canSignalForCall({ ...base, fromUserId: "33333333-3333-4333-8333-333333333333" })).toBe(false);
    expect(canSignalForCall({ ...base, callStatus: "ended" })).toBe(false);
    expect(canSignalForCall({ ...base, callStatus: "missed" })).toBe(false);
  });
});

describe("transitionCall — every settlement is honest", () => {
  it("the happy path: ringing -> accepted -> ended", () => {
    expect(transitionCall("ringing", "accept")).toEqual({ status: "accepted", endReason: "" });
    expect(transitionCall("accepted", "hangup")).toEqual({ status: "ended", endReason: "hangup" });
  });
  it("unanswered rings settle by cause", () => {
    expect(transitionCall("ringing", "decline")).toEqual({ status: "declined", endReason: "declined" });
    expect(transitionCall("ringing", "timeout")).toEqual({ status: "missed", endReason: "ring_timeout" });
    expect(transitionCall("ringing", "cancel")).toEqual({ status: "missed", endReason: "caller_cancelled" });
    expect(transitionCall("ringing", "busy")).toEqual({ status: "busy", endReason: "busy" });
    expect(transitionCall("ringing", "fail")).toEqual({ status: "failed", endReason: "failed" });
    expect(transitionCall("ringing", "disconnect")).toEqual({ status: "missed", endReason: "disconnect" });
  });
  it("a block severs ringing and live calls alike", () => {
    expect(transitionCall("ringing", "block")?.status).toBe("blocked");
    expect(transitionCall("accepted", "block")?.status).toBe("blocked");
  });
  it("illegal moves return null; settled calls never move", () => {
    expect(transitionCall("ringing", "hangup")?.status).toBe("missed"); // pre-answer hangup == cancel
    expect(transitionCall("accepted", "accept")).toBeNull();
    expect(transitionCall("accepted", "decline")).toBeNull();
    for (const s of ["declined", "missed", "cancelled", "busy", "blocked", "failed", "ended"] as const) {
      expect(isTerminalCallStatus(s)).toBe(true);
      expect(transitionCall(s, "accept")).toBeNull();
      expect(transitionCall(s, "hangup")).toBeNull();
    }
  });
  it("the ring window is 45 seconds", () => {
    expect(RING_TIMEOUT_MS).toBe(45_000);
  });
});

describe("actorMayAct", () => {
  const ids = { callerUserId: ME, calleeUserId: OTHER };
  it("only the callee answers or declines a ring", () => {
    expect(actorMayAct({ action: "accept", status: "ringing", actorUserId: OTHER, ...ids })).toBe(true);
    expect(actorMayAct({ action: "accept", status: "ringing", actorUserId: ME, ...ids })).toBe(false);
    expect(actorMayAct({ action: "decline", status: "ringing", actorUserId: OTHER, ...ids })).toBe(true);
  });
  it("only the caller cancels a ring; either side hangs up a live call", () => {
    expect(actorMayAct({ action: "cancel", status: "ringing", actorUserId: ME, ...ids })).toBe(true);
    expect(actorMayAct({ action: "cancel", status: "ringing", actorUserId: OTHER, ...ids })).toBe(false);
    expect(actorMayAct({ action: "hangup", status: "accepted", actorUserId: ME, ...ids })).toBe(true);
    expect(actorMayAct({ action: "hangup", status: "accepted", actorUserId: OTHER, ...ids })).toBe(true);
    expect(actorMayAct({ action: "hangup", status: "ringing", actorUserId: ME, ...ids })).toBe(false);
  });
});

describe("durations + history labels", () => {
  it("duration is answered->ended whole seconds, never negative, null without both ends", () => {
    expect(callDurationSeconds("2026-01-01T00:00:00Z", "2026-01-01T00:03:12Z")).toBe(192);
    expect(callDurationSeconds(null, new Date())).toBeNull();
    expect(callDurationSeconds(new Date(), null)).toBeNull();
    expect(callDurationSeconds("2026-01-01T00:03:00Z", "2026-01-01T00:00:00Z")).toBeNull();
  });
  it("formats compactly", () => {
    expect(formatCallDuration(9)).toBe("9s");
    expect(formatCallDuration(192)).toBe("3m 12s");
    expect(formatCallDuration(3725)).toBe("1h 02m");
  });
  const entry = (over: Partial<CallHistoryEntry>): CallHistoryEntry => ({
    id: CALL_ID, conversationId: "c", callerUserId: ME, calleeUserId: OTHER,
    status: "ended", endReason: "hangup", durationSeconds: 192,
    createdAt: "2026-01-01T00:00:00Z", answeredAt: "2026-01-01T00:00:05Z", endedAt: "2026-01-01T00:03:17Z",
    ...over,
  });
  it("labels read honestly from each side", () => {
    expect(callHistoryLabel(entry({}), ME)).toBe("Video call · 3m 12s");
    expect(callHistoryLabel(entry({ status: "missed", endReason: "ring_timeout", durationSeconds: null }), OTHER)).toBe("Missed video call");
    expect(callHistoryLabel(entry({ status: "missed", endReason: "ring_timeout", durationSeconds: null }), ME)).toBe("Video call — no answer");
    expect(callHistoryLabel(entry({ status: "missed", endReason: "caller_cancelled", durationSeconds: null }), ME)).toBe("Video call cancelled");
    expect(callHistoryLabel(entry({ status: "missed", endReason: "caller_cancelled", durationSeconds: null }), OTHER)).toBe("Missed video call");
    expect(callHistoryLabel(entry({ status: "declined", durationSeconds: null }), ME)).toBe("Video call declined");
    expect(callHistoryLabel(entry({ status: "declined", durationSeconds: null }), OTHER)).toBe("You declined the video call");
    expect(callHistoryLabel(entry({ status: "busy", durationSeconds: null }), ME)).toContain("another call");
  });
});

describe("parseCallClientFrame", () => {
  it("accepts offer/answer/ice and ping", () => {
    expect(parseCallClientFrame(JSON.stringify({ type: "call.signal", callId: CALL_ID, data: { kind: "offer", sdp: "v=0..." } })))
      .toEqual({ type: "call.signal", callId: CALL_ID, data: { kind: "offer", sdp: "v=0..." } });
    expect(parseCallClientFrame(JSON.stringify({ type: "call.signal", callId: CALL_ID, data: { kind: "ice", candidate: { candidate: "c" } } }))?.type).toBe("call.signal");
    expect(parseCallClientFrame(JSON.stringify({ type: "call.ping" }))).toEqual({ type: "call.ping" });
  });
  it("drops junk: bad json, bad call id, sdp-less offer, unknown kinds, oversize", () => {
    expect(parseCallClientFrame("not json")).toBeNull();
    expect(parseCallClientFrame(JSON.stringify({ type: "call.signal", callId: "nope", data: { kind: "offer", sdp: "x" } }))).toBeNull();
    expect(parseCallClientFrame(JSON.stringify({ type: "call.signal", callId: CALL_ID, data: { kind: "offer" } }))).toBeNull();
    expect(parseCallClientFrame(JSON.stringify({ type: "call.signal", callId: CALL_ID, data: { kind: "bye" } }))).toBeNull();
    expect(parseCallClientFrame(JSON.stringify({ type: "something.else", callId: CALL_ID }))).toBeNull();
    expect(parseCallClientFrame("x".repeat(MAX_SIGNAL_FRAME_BYTES + 1))).toBeNull();
  });
  it("callPeerOf names the other side, null for strangers", () => {
    const call = { callerUserId: ME, calleeUserId: OTHER };
    expect(callPeerOf(call, ME)).toBe(OTHER);
    expect(callPeerOf(call, OTHER)).toBe(ME);
    expect(callPeerOf(call, "33333333-3333-4333-8333-333333333333")).toBeNull();
  });
});

describe("buildVideoCallIceConfig", () => {
  it("no env: STUN only, relay honestly off", () => {
    const cfg = buildVideoCallIceConfig({});
    expect(cfg.relayConfigured).toBe(false);
    expect(cfg.iceServers).toHaveLength(1);
    expect(String(cfg.iceServers[0]!.urls)).toContain("stun:");
  });
  it("ephemeral secret: signed per-member pair, HMAC-SHA1 over the expiry username", () => {
    const now = 1_762_000_000_000;
    const cfg = buildVideoCallIceConfig(
      { VIDEO_CALL_TURN_URLS: "turn:141.148.45.254:3478", VIDEO_CALL_TURN_SECRET: "coturn-secret" },
      { userId: ME, nowMs: now },
    );
    expect(cfg.relayConfigured).toBe(true);
    const turn = cfg.iceServers[1]!;
    const expectedUser = `${Math.floor(now / 1000) + 3600}:${ME}`;
    expect(turn.username).toBe(expectedUser);
    expect(turn.credential).toBe(createHmac("sha1", "coturn-secret").update(expectedUser).digest("base64"));
  });
  it("static pair works; half a config serves NO relay", () => {
    const full = buildVideoCallIceConfig({
      VIDEO_CALL_TURN_URLS: "turn:relay.example.com:3478",
      VIDEO_CALL_TURN_USERNAME: "u", VIDEO_CALL_TURN_CREDENTIAL: "p",
    });
    expect(full.relayConfigured).toBe(true);
    expect(buildVideoCallIceConfig({ VIDEO_CALL_TURN_URLS: "turn:relay.example.com:3478" }).relayConfigured).toBe(false);
    expect(buildVideoCallIceConfig({ VIDEO_CALL_TURN_USERNAME: "u", VIDEO_CALL_TURN_CREDENTIAL: "p" }).relayConfigured).toBe(false);
  });
  it("falls back to the World relay env (one coturn serves both); VIDEO_CALL_* wins", () => {
    const worldOnly = buildVideoCallIceConfig({
      WORLD_TURN_URLS: "turn:world.example.com:3478", WORLD_TURN_USERNAME: "w", WORLD_TURN_CREDENTIAL: "wp",
    });
    expect(worldOnly.relayConfigured).toBe(true);
    expect(worldOnly.iceServers[1]!.urls).toBe("turn:world.example.com:3478");
    const both = buildVideoCallIceConfig({
      VIDEO_CALL_TURN_URLS: "turn:calls.example.com:3478", VIDEO_CALL_TURN_USERNAME: "c", VIDEO_CALL_TURN_CREDENTIAL: "cp",
      WORLD_TURN_URLS: "turn:world.example.com:3478", WORLD_TURN_USERNAME: "w", WORLD_TURN_CREDENTIAL: "wp",
    });
    expect(both.iceServers[1]!.urls).toBe("turn:calls.example.com:3478");
  });
  it("non-TURN urls never become a relay entry", () => {
    expect(buildVideoCallIceConfig({
      VIDEO_CALL_TURN_URLS: "stun:only.example.com", VIDEO_CALL_TURN_USERNAME: "u", VIDEO_CALL_TURN_CREDENTIAL: "p",
    }).relayConfigured).toBe(false);
  });
});
