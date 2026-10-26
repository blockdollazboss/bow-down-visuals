/**
 * video-call.ts — the client half of 1:1 video calls inside Messages
 * (Phase 1, Stack-200). Pure and framework-free where it counts, so
 * the whole contract is unit-tested without a camera or a socket:
 *
 *   - history labels (a MIRROR of the server brain in
 *     artifacts/api-server/src/lib/video-calls.ts — keep in step)
 *   - the signaling socket URL + server-event parser
 *   - merging call entries into a thread's message list by time
 *   - the WebRTC peer session (RTCPeerConnection + getUserMedia are
 *     INJECTED, so tests drive fakes; the dock component passes the
 *     real browser objects)
 *
 * Media is WebRTC peer-to-peer: this code talks SDP/ICE over the
 * signaling socket and media flows browser-to-browser (via the
 * owner's self-hosted coturn relay when direct paths fail). The
 * server never sees audio or video. No paid provider, $0.
 */

/* ── Types (mirror of the server's CallHistoryEntry) ───────────────── */

export type CallStatus =
  | "ringing" | "accepted" | "declined" | "missed" | "cancelled"
  | "busy" | "blocked" | "failed" | "ended";

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

export interface IceConfig {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  relayConfigured: boolean;
}

/* ── Durations + history labels (mirror of the server brain) ───────── */

export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

/** The one honest line a history entry renders as, from the VIEWER's
 *  side of the call. Mirrors the server label exactly. */
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

/** A missed call the VIEWER still owes a callback for: it rang them,
 *  they never answered, and it wasn't their own doing. Drives the
 *  "missed" styling + the call-back affordance in the thread. */
export function isMissedForViewer(entry: CallHistoryEntry, viewerUserId: string): boolean {
  if (entry.calleeUserId !== viewerUserId) return false;
  return entry.status === "missed" || entry.status === "busy";
}

/* ── Thread merge: calls interleave with messages by time ──────────── */

export interface ThreadMessageLike {
  id: string;
  created_at: string;
}

export type ThreadItem<M extends ThreadMessageLike> =
  | { kind: "message"; at: number; message: M }
  | { kind: "call"; at: number; call: CallHistoryEntry };

/** One chronological thread: messages and call entries sorted by
 *  their creation time (stable — messages win ties, they were the
 *  rail that existed first). Live/ringing entries ride along too:
 *  the thread shows the call that is happening, not just history. */
export function mergeThreadItems<M extends ThreadMessageLike>(
  messages: readonly M[],
  calls: readonly CallHistoryEntry[],
): Array<ThreadItem<M>> {
  const items: Array<ThreadItem<M>> = [
    ...messages.map((message): ThreadItem<M> => ({
      kind: "message", at: new Date(message.created_at).getTime() || 0, message,
    })),
    ...calls.map((call): ThreadItem<M> => ({
      kind: "call", at: new Date(call.createdAt).getTime() || 0, call,
    })),
  ];
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.at - b.item.at) || (a.i - b.i))
    .map(({ item }) => item);
}

/* ── Signaling socket ──────────────────────────────────────────────── */

/** Same-origin WS URL for the call signaling gateway. The token is
 *  the member's session token — guests have none and never connect. */
export function buildCallWsUrl(
  locationLike: { protocol: string; host: string },
  token: string,
): string {
  const scheme = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${locationLike.host}/api/dm/calls/ws?token=${encodeURIComponent(token)}`;
}

export type CallServerEvent =
  | { type: "call.hello"; userId: string }
  | { type: "call.ring"; call: CallHistoryEntry; callerName: string }
  | { type: "call.accepted"; callId: string; conversationId: string }
  | { type: "call.declined"; callId: string; conversationId: string }
  | { type: "call.ended"; callId: string; conversationId: string; status: CallStatus; endReason: string | null; durationSeconds: number | null }
  | { type: "call.signal"; callId: string; fromUserId: string; data: SignalData }
  | { type: "call.busy"; callId: string; conversationId: string };

export interface SignalData {
  kind: "offer" | "answer" | "ice";
  sdp?: string;
  candidate?: unknown;
}

const CALL_STATUSES: readonly string[] = [
  "ringing", "accepted", "declined", "missed", "cancelled",
  "busy", "blocked", "failed", "ended",
];

function isCallEntry(v: unknown): v is CallHistoryEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o["id"] === "string"
    && typeof o["conversationId"] === "string"
    && typeof o["callerUserId"] === "string"
    && typeof o["calleeUserId"] === "string"
    && typeof o["status"] === "string" && CALL_STATUSES.includes(o["status"])
    && typeof o["createdAt"] === "string";
}

/** Parse one raw server frame. Malformed or off-contract frames
 *  return null — the dock drops them rather than crashing a call. */
export function parseCallServerEvent(raw: string): CallServerEvent | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  switch (o["type"]) {
    case "call.hello":
      return typeof o["userId"] === "string" ? { type: "call.hello", userId: o["userId"] } : null;
    case "call.ring":
      return isCallEntry(o["call"]) && typeof o["callerName"] === "string"
        ? { type: "call.ring", call: o["call"], callerName: o["callerName"] }
        : null;
    case "call.accepted":
    case "call.declined":
    case "call.busy":
      return typeof o["callId"] === "string" && typeof o["conversationId"] === "string"
        ? { type: o["type"], callId: o["callId"], conversationId: o["conversationId"] } as CallServerEvent
        : null;
    case "call.ended":
      return typeof o["callId"] === "string" && typeof o["conversationId"] === "string"
        && typeof o["status"] === "string" && CALL_STATUSES.includes(o["status"])
        ? {
            type: "call.ended", callId: o["callId"], conversationId: o["conversationId"],
            status: o["status"] as CallStatus,
            endReason: typeof o["endReason"] === "string" ? o["endReason"] : null,
            durationSeconds: typeof o["durationSeconds"] === "number" ? o["durationSeconds"] : null,
          }
        : null;
    case "call.signal": {
      if (typeof o["callId"] !== "string" || typeof o["fromUserId"] !== "string") return null;
      const data = o["data"] as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return null;
      const kind = data["kind"];
      if (kind !== "offer" && kind !== "answer" && kind !== "ice") return null;
      if ((kind === "offer" || kind === "answer") && typeof data["sdp"] !== "string") return null;
      return {
        type: "call.signal", callId: o["callId"], fromUserId: o["fromUserId"],
        data: {
          kind,
          ...(typeof data["sdp"] === "string" ? { sdp: data["sdp"] } : {}),
          ...(kind === "ice" ? { candidate: data["candidate"] } : {}),
        },
      };
    }
    default:
      return null;
  }
}

/** Serialize one client signaling frame (the server's parser caps
 *  frames at 32 KB and drops anything off-contract). */
export function buildSignalFrame(callId: string, data: SignalData): string {
  return JSON.stringify({ type: "call.signal", callId, data });
}

export const CALL_PING_FRAME = JSON.stringify({ type: "call.ping" });

/* ── Camera facing (flip) ──────────────────────────────────────────── */

export type FacingMode = "user" | "environment";

export function nextFacingMode(current: FacingMode): FacingMode {
  return current === "user" ? "environment" : "user";
}

/* ── The WebRTC peer session ─────────────────────────────────────────
   One session per call. Browser objects are injected so tests can
   drive fakes:

     createPeerConnection(ice) -> a minimal RTCPeerConnection shape
     getUserMedia(constraints) -> a minimal MediaStream shape

   The caller runs startOutgoing() (media -> offer -> signal). The
   callee runs acceptIncoming(offerSdp) once they answer (media ->
   set remote -> answer -> signal); ICE candidates that arrive
   before the remote description queue up and flush after it lands.
   Mute / camera-off toggle the local tracks' `enabled` flag (the
   mic/cam never actually release mid-call, so un-muting is instant
   and the peer sees a silent/black feed, not a renegotiation).
   Flip re-acquires the video track with the other facingMode and
   replaceTrack()s it onto the existing sender. */

export interface MediaTrackLike {
  kind: string;
  enabled: boolean;
  stop: () => void;
}

export interface MediaStreamLike {
  getTracks: () => MediaTrackLike[];
  getAudioTracks: () => MediaTrackLike[];
  getVideoTracks: () => MediaTrackLike[];
  addTrack?: (track: MediaTrackLike) => void;
  removeTrack?: (track: MediaTrackLike) => void;
}

export interface PeerConnectionLike {
  addTrack: (track: MediaTrackLike, stream: MediaStreamLike) => { replaceTrack: (t: MediaTrackLike) => Promise<void> };
  createOffer: () => Promise<{ sdp?: string }>;
  createAnswer: () => Promise<{ sdp?: string }>;
  setLocalDescription: (d: { type: string; sdp?: string }) => Promise<void>;
  setRemoteDescription: (d: { type: string; sdp?: string }) => Promise<void>;
  addIceCandidate: (c: unknown) => Promise<void>;
  close: () => void;
  onicecandidate: ((e: { candidate: unknown }) => void) | null;
  ontrack: ((e: { streams: MediaStreamLike[] }) => void) | null;
}

export interface VideoCallPeerDeps {
  createPeerConnection: (ice: IceConfig) => PeerConnectionLike;
  getUserMedia: (constraints: { audio: boolean; video: { facingMode: FacingMode } | boolean }) => Promise<MediaStreamLike>;
  sendSignal: (data: SignalData) => void;
  onRemoteStream: (stream: MediaStreamLike | null) => void;
  onLocalStream: (stream: MediaStreamLike | null) => void;
}

export class VideoCallPeer {
  private pc: PeerConnectionLike | null = null;
  private local: MediaStreamLike | null = null;
  private pendingIce: unknown[] = [];
  private remoteSet = false;
  facing: FacingMode = "user";
  muted = false;
  cameraOff = false;

  constructor(private deps: VideoCallPeerDeps) {}

  private async open(ice: IceConfig): Promise<PeerConnectionLike> {
    const pc = this.deps.createPeerConnection(ice);
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.deps.sendSignal({ kind: "ice", candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams?.[0];
      if (stream) this.deps.onRemoteStream(stream);
    };
    this.local = await this.deps.getUserMedia({ audio: true, video: { facingMode: this.facing } });
    /* Toggles flipped while the camera was still opening still land. */
    for (const t of this.local.getAudioTracks()) t.enabled = !this.muted;
    for (const t of this.local.getVideoTracks()) t.enabled = !this.cameraOff;
    for (const track of this.local.getTracks()) {
      const sender = pc.addTrack(track, this.local);
      if (track.kind === "video") this.videoSender = sender;
    }
    this.deps.onLocalStream(this.local);
    return pc;
  }

  /** Caller side: open media, create + send the offer. */
  async startOutgoing(ice: IceConfig): Promise<void> {
    const pc = await this.open(ice);
    const offer = await pc.createOffer();
    await pc.setLocalDescription({ type: "offer", sdp: offer.sdp });
    this.deps.sendSignal({ kind: "offer", sdp: offer.sdp });
  }

  /** Callee side: open media, take the caller's offer, send the answer. */
  async acceptIncoming(ice: IceConfig, offerSdp: string): Promise<void> {
    const pc = await this.open(ice);
    await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
    this.remoteSet = true;
    await this.flushIce();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription({ type: "answer", sdp: answer.sdp });
    this.deps.sendSignal({ kind: "answer", sdp: answer.sdp });
  }

  /** One inbound signal frame from the peer. */
  async handleSignal(data: SignalData): Promise<void> {
    if (!this.pc) {
      /* ICE can beat the offer/answer to us; queue it all — accept /
         start paths flush once a remote description exists. An SDP
         frame with no peer connection is the caller's offer racing
         the callee's accept tap — the DOCK holds offers, not us. */
      if (data.kind === "ice") this.pendingIce.push(data.candidate);
      return;
    }
    if (data.kind === "answer" && data.sdp) {
      await this.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      this.remoteSet = true;
      await this.flushIce();
    } else if (data.kind === "ice") {
      if (this.remoteSet) await this.pc.addIceCandidate(data.candidate).catch(() => {});
      else this.pendingIce.push(data.candidate);
    }
    /* A second offer mid-call (renegotiation) is Phase 2 — Phase 1
       never renegotiates, so offers arriving at a live pc are dropped. */
  }

  private async flushIce(): Promise<void> {
    if (!this.pc) return;
    const queued = this.pendingIce.splice(0);
    for (const c of queued) await this.pc.addIceCandidate(c).catch(() => {});
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.local) for (const t of this.local.getAudioTracks()) t.enabled = !muted;
  }

  setCameraOff(off: boolean): void {
    this.cameraOff = off;
    if (this.local) for (const t of this.local.getVideoTracks()) t.enabled = !off;
  }

  /** Flip to the other camera: re-acquire video with the next
   *  facingMode and swap it onto the existing sender — no
   *  renegotiation, the audio track and connection never blink. */
  async flipCamera(): Promise<FacingMode> {
    this.facing = nextFacingMode(this.facing);
    if (!this.pc || !this.local) return this.facing;
    const fresh = await this.deps.getUserMedia({ audio: false, video: { facingMode: this.facing } });
    const newTrack = fresh.getVideoTracks()[0];
    const oldTrack = this.local.getVideoTracks()[0];
    if (!newTrack) return this.facing;
    newTrack.enabled = !this.cameraOff;
    if (this.videoSender) await this.videoSender.replaceTrack(newTrack);
    if (oldTrack) {
      this.local.removeTrack?.(oldTrack);
      oldTrack.stop();
    }
    this.local.addTrack?.(newTrack);
    this.deps.onLocalStream(this.local);
    return this.facing;
  }

  /** The video sender captured at open() time — flipCamera swaps its
   *  track instead of renegotiating. */
  private videoSender: { replaceTrack: (t: MediaTrackLike) => Promise<void> } | null = null;

  close(): void {
    if (this.local) for (const t of this.local.getTracks()) { try { t.stop(); } catch { /* already gone */ } }
    this.local = null;
    if (this.pc) { try { this.pc.close(); } catch { /* already gone */ } }
    this.pc = null;
    this.remoteSet = false;
    this.pendingIce = [];
    this.videoSender = null;
    this.deps.onRemoteStream(null);
    this.deps.onLocalStream(null);
  }
}
