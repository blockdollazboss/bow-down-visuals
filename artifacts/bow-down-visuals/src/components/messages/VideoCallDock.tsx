import { plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Video, VideoOff, Mic, MicOff, PhoneOff, PhoneIncoming,
  SwitchCamera, X,
} from "lucide-react";
import {
  VideoCallPeer, buildCallWsUrl, parseCallServerEvent, buildSignalFrame,
  CALL_PING_FRAME, formatCallDuration,
  type CallHistoryEntry, type CallServerEvent, type IceConfig, type SignalData,
} from "@/lib/video-call";

/* ─── VideoCallDock — 1:1 video calls INSIDE Messages (Phase 1) ───────
   Docked in the Messages page, never a standalone surface: the call
   button lives on the open thread, an incoming ring lands as a card
   over whatever thread you're reading (with a door back to its own
   thread), and the live call panel sits inside the thread pane.

   Media is WebRTC peer-to-peer; signaling rides the call socket
   (/api/dm/calls/ws, session token — guests never connect). Writes
   (start / accept / decline / end) go through the REST ledger routes
   so the DM privacy gate and the state machine live in exactly one
   place server-side. Styling follows the Messages page palette
   (near-black ground, gold accent), which the global theme tables
   remap for the light theme — both themes are designed, as ever. */

interface CommunityApiLike {
  get: (p: string) => Promise<unknown>;
  post: (p: string, body?: unknown) => Promise<unknown>;
}

type Phase =
  | { kind: "idle" }
  | { kind: "outgoing"; call: CallHistoryEntry }
  | { kind: "incoming"; call: CallHistoryEntry; callerName: string }
  | { kind: "live"; call: CallHistoryEntry; answeredAt: number };

interface IceResponse { ice: IceConfig; relayConfigured?: boolean }

export function VideoCallDock(props: {
  api: CommunityApiLike;
  getAccessToken: () => Promise<string | null>;
  currentUserId: string | null;
  activeConversationId: string | null;
  activeStatus: string;
  otherName: string;
  onOpenConversation: (id: string) => void;
  onCallsChanged: () => void;
  /** Lets the thread's "Call back" history button reach startCall. */
  registerStarter?: (fn: (() => void) | null) => void;
}) {
  const { api, getAccessToken, currentUserId } = props;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const wsRef = useRef<WebSocket | null>(null);
  const peerRef = useRef<VideoCallPeer | null>(null);
  const pendingOfferRef = useRef<Map<string, string>>(new Map());
  /* ICE candidates that beat the peer connection into existence
     (the caller trickles while the callee is still deciding) queue
     here by call id and drain into the peer once it opens. */
  const pendingIceRef = useRef<Map<string, unknown[]>>(new Map());
  const pendingAcceptRef = useRef<{ callId: string; ice: IceConfig } | null>(null);
  const sendQueueRef = useRef<string[]>([]);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const sendFrame = useCallback((frame: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
    else sendQueueRef.current.push(frame);
  }, []);

  const teardownPeer = useCallback(() => {
    peerRef.current?.close();
    peerRef.current = null;
    pendingAcceptRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
  }, []);

  const settleToIdle = useCallback((note?: string) => {
    teardownPeer();
    setPhase({ kind: "idle" });
    if (note) setNotice(note);
    propsRef.current.onCallsChanged();
  }, [teardownPeer]);

  const makePeer = useCallback((callId: string) => {
    const peer = new VideoCallPeer({
      createPeerConnection: (ice) =>
        new RTCPeerConnection({ iceServers: ice.iceServers }) as never,
      getUserMedia: (c) =>
        navigator.mediaDevices.getUserMedia(c as MediaStreamConstraints) as never,
      sendSignal: (data: SignalData) => sendFrame(buildSignalFrame(callId, data)),
      onRemoteStream: (s) => setRemoteStream(s as MediaStream | null),
      onLocalStream: (s) => setLocalStream(s as MediaStream | null),
    });
    peerRef.current = peer;
    return peer;
  }, [sendFrame]);

  /* If the offer was signaled before the callee tapped Accept, it is
     held in pendingOfferRef; if Accept lands first, the acceptance is
     held in pendingAcceptRef. Whichever arrives second completes the
     handshake — the human tap and the network race in either order. */
  const maybeAccept = useCallback(async () => {
    const pending = pendingAcceptRef.current;
    if (!pending) return;
    const offer = pendingOfferRef.current.get(pending.callId);
    if (!offer) return;
    pendingAcceptRef.current = null;
    pendingOfferRef.current.delete(pending.callId);
    const peer = makePeer(pending.callId);
    try {
      await peer.acceptIncoming(pending.ice, offer);
      for (const candidate of pendingIceRef.current.get(pending.callId) ?? []) {
        await peer.handleSignal({ kind: "ice", candidate });
      }
      pendingIceRef.current.delete(pending.callId);
    } catch {
      settleToIdle("The call couldn't connect — camera or mic permission is needed for video calls.");
    }
  }, [makePeer, settleToIdle]);

  const handleEvent = useCallback((ev: CallServerEvent) => {
    const cur = phaseRef.current;
    switch (ev.type) {
      case "call.ring": {
        if (cur.kind !== "idle") return; // one call at a time; the server settles extras as busy
        setNotice(null);
        setPhase({ kind: "incoming", call: ev.call, callerName: ev.callerName });
        propsRef.current.onCallsChanged();
        return;
      }
      case "call.signal": {
        if (ev.data.kind === "offer" && ev.data.sdp) {
          pendingOfferRef.current.set(ev.callId, ev.data.sdp);
          void maybeAccept();
          return;
        }
        if (peerRef.current && cur.kind !== "idle" && cur.call.id === ev.callId) {
          void peerRef.current.handleSignal(ev.data);
        } else {
          const q = pendingIceRef.current.get(ev.callId) ?? [];
          q.push(ev.data.candidate);
          pendingIceRef.current.set(ev.callId, q);
        }
        return;
      }
      case "call.accepted": {
        if (cur.kind === "outgoing" && cur.call.id === ev.callId) {
          setPhase({ kind: "live", call: cur.call, answeredAt: Date.now() });
        } else if (cur.kind === "incoming" && cur.call.id === ev.callId) {
          setPhase({ kind: "live", call: cur.call, answeredAt: Date.now() });
        }
        return;
      }
      case "call.declined": {
        if (cur.kind !== "idle" && cur.call.id === ev.callId) {
          settleToIdle("They declined the video call.");
        }
        return;
      }
      case "call.busy": {
        if (cur.kind === "outgoing" && cur.call.id === ev.callId) {
          settleToIdle("They're on another call right now.");
        }
        return;
      }
      case "call.ended": {
        if (cur.kind === "idle" || cur.call.id !== ev.callId) return;
        const note =
          ev.status === "missed" && cur.kind === "incoming" ? "Missed video call."
          : ev.status === "missed" ? "No answer — the ring timed out."
          : ev.status === "blocked" ? "The call ended — this conversation is blocked."
          : ev.status === "failed" ? "The call couldn't connect."
          : undefined;
        settleToIdle(note);
        return;
      }
      default:
        return;
    }
  }, [maybeAccept, settleToIdle]);

  /* Signaling socket: connect on mount, app-level ping every 25s
     (intermediaries eat protocol pings — the house rule), a single
     quiet reconnect 3s after an unexpected drop. */
  useEffect(() => {
    if (!currentUserId) return;
    let dead = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (dead) return;
      const token = await getAccessToken().catch(() => null);
      if (dead || !token) return;
      const ws = new WebSocket(buildCallWsUrl(window.location, token));
      wsRef.current = ws;
      ws.onopen = () => {
        for (const f of sendQueueRef.current.splice(0)) ws.send(f);
        ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(CALL_PING_FRAME);
        }, 25_000);
      };
      ws.onmessage = (msg) => {
        const ev = parseCallServerEvent(String(msg.data));
        if (ev) handleEvent(ev);
      };
      ws.onclose = () => {
        if (ping) { clearInterval(ping); ping = null; }
        if (!dead) retry = setTimeout(() => { void connect(); }, 3_000);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    }
    void connect();
    return () => {
      dead = true;
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [currentUserId, getAccessToken, handleEvent]);

  /* Live-call clock. */
  useEffect(() => {
    if (phase.kind !== "live") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - phase.answeredAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  /* Video elements follow the streams. */
  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
  }, [localStream, phase.kind]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, phase.kind]);

  /* Unmount: the socket close settles any live call server-side. */
  useEffect(() => () => { peerRef.current?.close(); }, []);

  const startCall = useCallback(async () => {
    const convId = propsRef.current.activeConversationId;
    if (!convId || phaseRef.current.kind !== "idle") return;
    setNotice(null);
    try {
      const d = (await api.post(`/api/dm/${convId}/call`)) as {
        call: CallHistoryEntry; ice: IceConfig; busy?: boolean;
      };
      if (d.busy) {
        setNotice("They're on another call right now.");
        propsRef.current.onCallsChanged();
        return;
      }
      setPhase({ kind: "outgoing", call: d.call });
      propsRef.current.onCallsChanged();
      const peer = makePeer(d.call.id);
      await peer.startOutgoing(d.ice);
    } catch (e) {
      setNotice(plainErrorText(e, "Couldn't start the call — try again."));
      teardownPeer();
      setPhase({ kind: "idle" });
    }
  }, [api, makePeer, teardownPeer]);

  useEffect(() => {
    props.registerStarter?.(() => { void startCall(); });
    return () => props.registerStarter?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCall]);

  const acceptCall = useCallback(async () => {
    const cur = phaseRef.current;
    if (cur.kind !== "incoming") return;
    try {
      const d = (await api.post(`/api/dm/calls/${cur.call.id}/accept`)) as IceResponse & { call: CallHistoryEntry };
      pendingAcceptRef.current = { callId: cur.call.id, ice: d.ice };
      setPhase({ kind: "live", call: cur.call, answeredAt: Date.now() });
      await maybeAccept();
    } catch (e) {
      settleToIdle(plainErrorText(e, "Couldn't answer — try again."));
    }
  }, [api, maybeAccept, settleToIdle]);

  const declineCall = useCallback(async () => {
    const cur = phaseRef.current;
    if (cur.kind !== "incoming") return;
    try { await api.post(`/api/dm/calls/${cur.call.id}/decline`); } catch { /* server settles regardless */ }
    settleToIdle();
  }, [api, settleToIdle]);

  const endCall = useCallback(async () => {
    const cur = phaseRef.current;
    if (cur.kind !== "outgoing" && cur.kind !== "live") return;
    try { await api.post(`/api/dm/calls/${cur.call.id}/end`); } catch { /* socket close settles it */ }
    settleToIdle();
  }, [api, settleToIdle]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      peerRef.current?.setMuted(!m);
      return !m;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    setCameraOff((off) => {
      peerRef.current?.setCameraOff(!off);
      return !off;
    });
  }, []);

  const flip = useCallback(() => {
    void peerRef.current?.flipCamera().catch(() => {
      setNotice("Couldn't switch cameras on this device.");
    });
  }, []);

  /* ── Render ──────────────────────────────────────────────────────── */

  const inCall = phase.kind === "live" || phase.kind === "outgoing";

  return (
    <div data-testid="video-call-dock">
      {notice && phase.kind === "idle" && (
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#e8c86a]/10 px-4 py-2 text-sm text-[#e8c86a]"
          data-testid="video-call-notice">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} title="Dismiss" className="text-[#e8c86a]/70 hover:text-[#e8c86a]">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {phase.kind === "idle" && props.activeConversationId && props.activeStatus === "inbox" && (
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
          <p className="text-xs text-white/40">Video is peer-to-peer — nothing is recorded or stored.</p>
          <button type="button" onClick={() => { void startCall(); }}
            data-testid="video-call-button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#e8c86a] px-4 py-1.5 text-sm font-bold text-black transition hover:bg-[#f2d67c]">
            <Video className="h-4 w-4" /> Video call
          </button>
        </div>
      )}
      {phase.kind === "idle" && props.activeConversationId && props.activeStatus !== "inbox" && (
        <div className="border-b border-white/10 px-4 py-2.5" data-testid="video-call-gated-note">
          <p className="text-xs text-white/40">
            Video calls open once you're both in each other's inbox — a message request has to be accepted first.
          </p>
        </div>
      )}

      {phase.kind === "incoming" && (
        <div className="border-b border-[#e8c86a]/40 bg-[#e8c86a]/10 px-4 py-3" data-testid="video-call-incoming">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8c86a] text-black">
              <PhoneIncoming className="h-5 w-5 animate-pulse" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{phase.callerName} is calling…</p>
              <p className="text-xs text-white/50">Incoming video call — answering turns your camera and mic on.</p>
            </div>
            {phase.call.conversationId !== props.activeConversationId && (
              <button type="button" onClick={() => props.onOpenConversation(phase.call.conversationId)}
                className="rounded-full border border-white/25 px-3 py-1.5 text-sm font-semibold text-white/80 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]">
                Open thread
              </button>
            )}
            <button type="button" onClick={() => { void declineCall(); }}
              data-testid="video-call-decline"
              className="rounded-full border border-red-400/50 px-4 py-1.5 text-sm font-bold text-red-300 hover:bg-red-400/10">
              Decline
            </button>
            <button type="button" onClick={() => { void acceptCall(); }}
              data-testid="video-call-accept"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#e8c86a] px-4 py-1.5 text-sm font-bold text-black hover:bg-[#f2d67c]">
              <Video className="h-4 w-4" /> Answer
            </button>
          </div>
        </div>
      )}

      {inCall && (
        <div className="border-b border-white/10 bg-black/60 px-4 py-3" data-testid="video-call-panel">
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
            <video ref={remoteVideoRef} autoPlay playsInline
              data-testid="video-call-remote"
              className="aspect-video w-full bg-black object-cover" />
            {!remoteStream && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/50">
                {phase.kind === "outgoing" ? `Calling ${props.otherName}… waiting for them to answer.` : "Connecting video…"}
              </div>
            )}
            <video ref={localVideoRef} autoPlay playsInline muted
              data-testid="video-call-local"
              className="absolute bottom-3 right-3 aspect-video w-28 rounded-lg border border-white/25 bg-black object-cover sm:w-36" />
            {phase.kind === "live" && (
              <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white"
                data-testid="video-call-elapsed">
                {formatCallDuration(elapsed)}
              </span>
            )}
            {cameraOff && (
              <span className="absolute bottom-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white/80">
                Your camera is off
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={toggleMute}
              data-testid="video-call-mute"
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ${muted ? "bg-red-400/20 text-red-200" : "border border-white/20 text-white/80 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]"}`}>
              {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {muted ? "Unmute" : "Mute"}
            </button>
            <button type="button" onClick={toggleCamera}
              data-testid="video-call-camera"
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold ${cameraOff ? "bg-red-400/20 text-red-200" : "border border-white/20 text-white/80 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]"}`}>
              {cameraOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />} {cameraOff ? "Camera on" : "Camera off"}
            </button>
            <button type="button" onClick={flip}
              data-testid="video-call-flip"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 hover:border-[#e8c86a]/60 hover:text-[#e8c86a]">
              <SwitchCamera className="h-4 w-4" /> Flip
            </button>
            <button type="button" onClick={() => { void endCall(); }}
              data-testid="video-call-end"
              className="inline-flex items-center gap-1.5 rounded-full bg-red-500 px-4 py-2 text-sm font-bold text-white hover:bg-red-400">
              <PhoneOff className="h-4 w-4" /> {phase.kind === "outgoing" ? "Cancel" : "End call"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
