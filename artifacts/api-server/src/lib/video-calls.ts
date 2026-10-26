/**
 * video-calls.ts — the pure brain of 1:1 video calls inside Messages
 * (Phase 1, Stack-200). Framework-free and env-passed-in, so the whole
 * contract is unit-tested without a socket or a database:
 *
 *   - who may call whom (DM privacy, inherited EXACTLY)
 *   - the call state machine (ringing -> accepted -> ended, and every
 *     honest settlement of an unanswered ring)
 *   - the signaling frame contract the LiveWsGateway relay enforces
 *   - the ICE config the client builds its RTCPeerConnection from
 *     (STUN default + the owner's self-hosted coturn relay, served
 *     all-or-nothing with ephemeral credentials — the same discipline
 *     as lib/world-voice-config.ts, whose signer this reuses)
 *
 * Media is WebRTC peer-to-peer. The server never sees audio or video;
 * it only creates/settles ledger rows (routes/video-calls.ts) and
 * relays signaling frames between the two participants of a live
 * call. No paid provider, $0.
 */

import { signTurnCredentials } from "./world-voice-config";

/* ── Privacy: calling rights inherit DM privacy EXACTLY ──────────────
   The DM rail (routes/community.ts) has exactly three conversation
   states, and a call is MORE intrusive than a message, so the call
   gate is the message gate, never looser:

     inbox   — both sides may call. This is the only callable state.
     request — nobody may call yet. The requester may SEND words
               (the DM rail allows that), but ringing someone who has
               not accepted your request would be exactly the dumb
               interruption the smart law forbids. Accept first.
     blocked — nobody may call, ever, and a block landing mid-ring or
               mid-call SEVERS the call (routes/community.ts block
               handler calls severVideoCallsForConversation).

   Guests cannot call at all: a guest has no account, no conversation
   and no session token, so every door here (REST requireAuth, WS
   token verify) refuses them before this predicate is even reached.
   A self-call is never a call. */

export type ConversationCallStatus = "inbox" | "request" | "blocked" | string;

export interface CallGateResult {
  allowed: boolean;
  /** Machine code for the client to render honestly; null when allowed. */
  code: "blocked" | "not_accepted" | "self_call" | "not_participant" | null;
  /** House-voice reason, safe to show the caller. */
  message: string | null;
}

export function canCallConversation(args: {
  conversationStatus: ConversationCallStatus;
  callerUserId: string;
  calleeUserId: string;
  callerIsParticipant: boolean;
}): CallGateResult {
  if (args.callerUserId === args.calleeUserId) {
    return { allowed: false, code: "self_call", message: "You can't call yourself." };
  }
  if (!args.callerIsParticipant) {
    return { allowed: false, code: "not_participant", message: "This conversation isn't yours to call from." };
  }
  if (args.conversationStatus === "blocked") {
    return { allowed: false, code: "blocked", message: "This conversation is blocked — calls are off." };
  }
  if (args.conversationStatus !== "inbox") {
    return {
      allowed: false,
      code: "not_accepted",
      message: "Calls open once you're both in each other's inbox — a message request has to be accepted first, so nobody gets rung out of nowhere.",
    };
  }
  return { allowed: true, code: null, message: null };
}

/** May these two users exchange signaling for this call right now?
 *  Re-checked at relay time (not only at call creation) so a block
 *  that lands mid-call stops the very next frame. */
export function canSignalForCall(args: {
  conversationStatus: ConversationCallStatus;
  callStatus: CallStatus;
  fromUserId: string;
  callerUserId: string;
  calleeUserId: string;
}): boolean {
  if (args.conversationStatus !== "inbox") return false;
  if (args.fromUserId !== args.callerUserId && args.fromUserId !== args.calleeUserId) return false;
  return args.callStatus === "ringing" || args.callStatus === "accepted";
}

/* ── The call state machine ────────────────────────────────────────── */

export const CALL_STATUSES = [
  "ringing", "accepted", "declined", "missed", "cancelled",
  "busy", "blocked", "failed", "ended",
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const TERMINAL_CALL_STATUSES: readonly CallStatus[] = [
  "declined", "missed", "cancelled", "busy", "blocked", "failed", "ended",
];

export function isTerminalCallStatus(status: CallStatus): boolean {
  return TERMINAL_CALL_STATUSES.includes(status);
}

/** How long a ring goes unanswered before it settles as missed.
 *  Long enough to find a phone, short enough to never feel like a
 *  pocket-dial ambush (smart law: no dumb interruptions). */
export const RING_TIMEOUT_MS = 45_000;

/** One live call per person: a second inbound ring while ringing or
 *  talking settles as busy instead of stacking interruptions. */
export function isLiveCallStatus(status: CallStatus): boolean {
  return status === "ringing" || status === "accepted";
}

export type CallAction =
  | "accept" | "decline" | "cancel" | "hangup"
  | "timeout" | "block" | "busy" | "fail" | "disconnect";

export interface CallTransition {
  status: CallStatus;
  endReason: string;
}

/**
 * The one place a call settles. Returns the next status + end reason,
 * or null when the action is not legal from the current status (a
 * settled call never moves again; only the two participants' own
 * actions are passed here — the route checks WHO is acting).
 *
 *   ringing  + accept     -> accepted (live; endReason unused)
 *   ringing  + decline    -> declined  (callee said no)
 *   ringing  + cancel     -> missed    (caller hung up pre-answer:
 *                                       the callee's history honestly
 *                                       reads "missed", reason kept)
 *   ringing  + timeout    -> missed
 *   ringing  + busy       -> busy      (callee already in a call)
 *   ringing  + block      -> blocked   (a block severed the ring)
 *   ringing  + fail       -> failed
 *   accepted + hangup     -> ended
 *   accepted + block      -> blocked   (a block severed the call)
 *   accepted + disconnect -> ended     (peer vanished; talk happened)
 *   ringing  + disconnect -> missed    (caller vanished mid-ring)
 */
export function transitionCall(status: CallStatus, action: CallAction): CallTransition | null {
  if (isTerminalCallStatus(status)) return null;
  if (status === "ringing") {
    switch (action) {
      case "accept": return { status: "accepted", endReason: "" };
      case "decline": return { status: "declined", endReason: "declined" };
      case "cancel": return { status: "missed", endReason: "caller_cancelled" };
      case "timeout": return { status: "missed", endReason: "ring_timeout" };
      case "busy": return { status: "busy", endReason: "busy" };
      case "block": return { status: "blocked", endReason: "blocked" };
      case "fail": return { status: "failed", endReason: "failed" };
      case "disconnect": return { status: "missed", endReason: "disconnect" };
      case "hangup": return { status: "missed", endReason: "caller_cancelled" };
      default: return null;
    }
  }
  if (status === "accepted") {
    switch (action) {
      case "hangup": return { status: "ended", endReason: "hangup" };
      case "block": return { status: "blocked", endReason: "blocked" };
      case "disconnect": return { status: "ended", endReason: "disconnect" };
      case "fail": return { status: "ended", endReason: "failed" };
      default: return null;
    }
  }
  return null;
}

/** Who may perform an action on a call. The route resolves the actor;
 *  this is the pure rule: decline/accept belong to the callee, cancel
 *  to the ringing caller, hangup to either side once live. System
 *  actions (timeout/block/busy/fail/disconnect) are server-driven and
 *  are not gated here. */
export function actorMayAct(args: {
  action: CallAction;
  status: CallStatus;
  actorUserId: string;
  callerUserId: string;
  calleeUserId: string;
}): boolean {
  const { action, status, actorUserId, callerUserId, calleeUserId } = args;
  switch (action) {
    case "accept":
    case "decline":
      return status === "ringing" && actorUserId === calleeUserId;
    case "cancel":
      return status === "ringing" && actorUserId === callerUserId;
    case "hangup":
      return status === "accepted" && (actorUserId === callerUserId || actorUserId === calleeUserId);
    default:
      return false;
  }
}

/** Talk time for the ledger + history label; null unless the call was
 *  answered and has an end. Never negative, whole seconds. */
export function callDurationSeconds(
  answeredAt: Date | string | null | undefined,
  endedAt: Date | string | null | undefined,
): number | null {
  if (!answeredAt || !endedAt) return null;
  const a = new Date(answeredAt).getTime();
  const e = new Date(endedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(e) || e < a) return null;
  return Math.floor((e - a) / 1000);
}

export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

/* ── In-thread history labels ──────────────────────────────────────── */

export interface CallHistoryEntry {
  id: string;
  conversationId: string;
  callerUserId: string;
  calleeUserId: string;
  status: CallStatus;
  endReason: string | null;
  durationSeconds: number | null;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
}

/** The one honest line a history entry renders as, from the VIEWER's
 *  side of the call. Mirrored client-side in lib/video-call.ts —
 *  keep the two in step. */
export function callHistoryLabel(entry: CallHistoryEntry, viewerUserId: string): string {
  const mine = entry.callerUserId === viewerUserId;
  const dur = entry.durationSeconds != null ? ` · ${formatCallDuration(entry.durationSeconds)}` : "";
  switch (entry.status) {
    case "ringing": return mine ? "Calling…" : "Incoming video call…";
    case "accepted": return `Video call${dur}`;
    case "ended": return `Video call${dur}`;
    case "declined": return mine ? "Video call declined" : "You declined the video call";
    case "missed":
      if (entry.endReason === "caller_cancelled") {
        return mine ? "Video call cancelled" : "Missed video call";
      }
      return mine ? "Video call — no answer" : "Missed video call";
    case "cancelled": return mine ? "Video call cancelled" : "Missed video call";
    case "busy": return mine ? "Video call — they were on another call" : "Missed video call (you were on a call)";
    case "blocked": return "Video call ended — conversation blocked";
    case "failed": return "Video call couldn't connect";
    default: return "Video call";
  }
}

/* ── Signaling frames (relayed over the existing WS gateway) ───────
   The client socket connects to /api/dm/calls/ws?token=… (session
   token, same verify as every other gateway route — guests have no
   token and are refused at the door). Frames are JSON, capped well
   under the gateway's 64 KB ceiling: an SDP offer for 1:1 A/V is a
   few KB; anything larger is not a call frame. */

export const MAX_SIGNAL_FRAME_BYTES = 32 * 1024;

export type SignalKind = "offer" | "answer" | "ice";

export type CallClientFrame =
  | { type: "call.signal"; callId: string; data: { kind: SignalKind; sdp?: string; candidate?: unknown } }
  | { type: "call.ping" };

export type CallServerEvent =
  | { type: "call.ring"; call: CallHistoryEntry; callerName: string }
  | { type: "call.accepted"; callId: string; conversationId: string }
  | { type: "call.declined"; callId: string; conversationId: string }
  | { type: "call.ended"; callId: string; conversationId: string; status: CallStatus; endReason: string | null; durationSeconds: number | null }
  | { type: "call.signal"; callId: string; fromUserId: string; data: { kind: SignalKind; sdp?: string; candidate?: unknown } }
  | { type: "call.busy"; callId: string; conversationId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse + validate one client frame. Anything malformed, oversized
 *  or off-contract returns null — the relay drops it silently rather
 *  than bouncing junk at the peer. */
export function parseCallClientFrame(raw: string): CallClientFrame | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_SIGNAL_FRAME_BYTES) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (o["type"] === "call.ping") return { type: "call.ping" };
  if (o["type"] !== "call.signal") return null;
  if (typeof o["callId"] !== "string" || !UUID_RE.test(o["callId"])) return null;
  const data = o["data"] as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  const kind = data["kind"];
  if (kind !== "offer" && kind !== "answer" && kind !== "ice") return null;
  if ((kind === "offer" || kind === "answer") && typeof data["sdp"] !== "string") return null;
  if (kind === "ice" && !("candidate" in data)) return null;
  return {
    type: "call.signal",
    callId: o["callId"],
    data: {
      kind,
      ...(typeof data["sdp"] === "string" ? { sdp: data["sdp"] } : {}),
      ...(kind === "ice" ? { candidate: data["candidate"] } : {}),
    },
  };
}

/** The peer of `userId` on a call — null when they are not on it. */
export function callPeerOf(call: { callerUserId: string; calleeUserId: string }, userId: string): string | null {
  if (call.callerUserId === userId) return call.calleeUserId;
  if (call.calleeUserId === userId) return call.callerUserId;
  return null;
}

/* ── ICE config: STUN default + the owner's coturn relay ─────────────
   The relay is the self-hosted coturn on the owner's Oracle VM
   (see infra/coturn/). Its coordinates arrive ONLY through env:

     VIDEO_CALL_TURN_URLS        comma-separated turn:/turns: URLs
     VIDEO_CALL_TURN_SECRET      coturn static-auth-secret (ephemeral
                                 per-call credentials are signed from
                                 it; the secret never leaves the server)
     VIDEO_CALL_TURN_USERNAME / VIDEO_CALL_TURN_CREDENTIAL
                                 static fallback pair, only when no
                                 secret is set

   When no VIDEO_CALL_* env is set, the World's relay env
   (WORLD_TURN_*) is honoured instead — one coturn can serve both,
   and the owner should not have to configure the same box twice.
   All-or-nothing, exactly like world-voice-config: a half-set relay
   serves NO relay, and the client falls back to STUN-only with
   honest copy rather than a silently broken TURN entry. */

export interface VideoCallIceConfig {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  /** True when a TURN relay made it into the config. */
  relayConfigured: boolean;
}

export const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

type EnvLike = Record<string, string | undefined>;

function cleanTurnUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const url = part.trim();
    if ((url.startsWith("turn:") || url.startsWith("turns:")) && !out.includes(url)) out.push(url);
  }
  return out;
}

export function buildVideoCallIceConfig(
  env: EnvLike,
  opts: { userId?: string | null; nowMs?: number } = {},
): VideoCallIceConfig {
  const urls =
    cleanTurnUrls(env["VIDEO_CALL_TURN_URLS"]).length > 0
      ? cleanTurnUrls(env["VIDEO_CALL_TURN_URLS"])
      : cleanTurnUrls(env["WORLD_TURN_URLS"]);
  const stun: VideoCallIceConfig["iceServers"] = [{ urls: DEFAULT_STUN_URLS }];
  if (urls.length === 0) return { iceServers: stun, relayConfigured: false };

  const secret = env["VIDEO_CALL_TURN_SECRET"] || env["WORLD_TURN_SECRET"] || "";
  const turnUrls = urls.length === 1 ? urls[0]! : urls;
  if (secret) {
    const { username, credential } = signTurnCredentials(secret, opts.userId, opts.nowMs ?? Date.now());
    return { iceServers: [...stun, { urls: turnUrls, username, credential }], relayConfigured: true };
  }
  const username = (env["VIDEO_CALL_TURN_USERNAME"] || env["WORLD_TURN_USERNAME"] || "").trim();
  const credential = env["VIDEO_CALL_TURN_CREDENTIAL"] || env["WORLD_TURN_CREDENTIAL"] || "";
  if (!username || !credential) return { iceServers: stun, relayConfigured: false };
  return { iceServers: [...stun, { urls: turnUrls, username, credential }], relayConfigured: true };
}
