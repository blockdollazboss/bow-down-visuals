/**
 * voice.ts — The World's voice: a WebRTC mesh for the King's Hall.
 *
 * Small-room mesh (the server caps voice at 12 — see lib/world-room.ts):
 * every voice member holds one RTCPeerConnection per other member.
 * Glare rule, deliberately boring: the NEWCOMER offers. When you join
 * voice, the server's voice.state lists everyone already in — you
 * offer to each of them; members already inside never offer to you,
 * they only answer. One initiator per pair, no perfect-negotiation
 * dance, no offer collisions.
 *
 * Volume is proximity: each remote stream runs through a gain the page
 * updates from avatar distance (gainForDistance) — walk closer, hear
 * them; cross the hall, they fade out. Mute is local-track mute (the
 * mic track disables; peers hear silence, the mesh stays up).
 *
 * The mesh is ROOM-WIDE, not proximity-gated: connections are held
 * with every in-voice peer (server cap 12) whatever the distance —
 * proximity lives purely in the receive gains. That's what makes the
 * voice modes (owner's order, 2026-10-16) honest: Lobby (hear the
 * whole hall) is a gain policy, not a connection trick — the streams
 * are already here. Deafen is the same policy at zero, plus the mic
 * mute the toggle machine orders alongside it.
 *
 * NAT note: connections use a public STUN server for candidate
 * gathering, plus a TURN relay when the server's voice config
 * supplies one (lib/world/voice-ice — the config seam, item 100).
 * No relay is configured by default, so on the small share of
 * networks where peer-to-peer is fully blocked a pair still can't
 * connect — but that is no longer silent: every peer connection's
 * state is tracked and surfaced (see VoicePeerConnectionState), a
 * failed pair says so plainly in the voice UI, and Retry re-offers
 * instead of leaving dead air unexplained.
 *
 * Everything RTC/media is behind injected deps so the mesh logic is
 * unit-tested in node with fake peer connections.
 *
 * Lip levels: each browser sink ALSO taps an analyser off the raw
 * stream (pre-gain) so the hall can move a character figure's lips
 * with its speaker's voice (`levelFor` / `VoiceSink.getLevel`) —
 * measurement only; the audio path above is untouched.
 */

import { SpeechLevelTracker, rmsFromTimeDomain } from "./lips";
import { buildIceServers, type IceServerConfig } from "./voice-ice";

export const VOICE_FULL_HEAR_DISTANCE = 2; // metres: full volume inside this
export const VOICE_MAX_DISTANCE = 16; // metres: silence beyond this

/** Proximity volume curve: 1 up close, smooth fade to 0 at max range. */
export function gainForDistance(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= VOICE_FULL_HEAR_DISTANCE) return 1;
  if (distanceM >= VOICE_MAX_DISTANCE) return 0;
  const t = (VOICE_MAX_DISTANCE - distanceM) / (VOICE_MAX_DISTANCE - VOICE_FULL_HEAR_DISTANCE);
  return t * t * (3 - 2 * t); // smoothstep — no volume cliff at the edge
}

/** How this client hears the mesh — the voice modes' ears:
 *   proximity — the distance curve, exactly as it always was
 *   lobby     — everyone in voice at full volume, near or far
 *   silent    — deafened: nobody is heard at all
 *  Pure, so the policy math is unit-tested without a mesh. (Deafen's
 *  other half — your own mic muted — is the toggle machine's job,
 *  not the gain's.) */
export type VoiceGainPolicy = "proximity" | "lobby" | "silent";

export function gainForPolicy(policy: VoiceGainPolicy, distanceM: number): number {
  if (policy === "lobby") return 1;
  if (policy === "silent") return 0;
  return gainForDistance(distanceM);
}

export interface VoiceSignalData {
  kind: "offer" | "answer" | "ice";
  sdp?: string;
  candidate?: unknown;
}

export interface RtcDescriptionLike {
  type: string;
  sdp?: string;
}

export interface RtcPeerConnectionLike {
  addTrack(track: unknown, stream: unknown): void;
  createOffer(): Promise<RtcDescriptionLike>;
  createAnswer(): Promise<RtcDescriptionLike>;
  setLocalDescription(desc: RtcDescriptionLike): Promise<void>;
  setRemoteDescription(desc: RtcDescriptionLike): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  close(): void;
  ontrack: ((ev: { streams: unknown[] }) => void) | null;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  /** The browser connection state ("new" | "connecting" | "connected"
   *  | "disconnected" | "failed" | "closed"). Optional: fakes and
   *  older wiring omit it and their peers simply stay "connecting"
   *  until a stream lands — never falsely "connected". */
  connectionState?: string;
  onconnectionstatechange?: (() => void) | null;
}

/** A peer connection's state in the three words the UI is allowed
 *  to say. "disconnected" maps to connecting on purpose: the browser
 *  is still trying (ICE restart), so the honest word is that the
 *  connection is being (re)made — it only becomes "failed" when the
 *  browser gives up and says failed. */
export type VoicePeerConnectionState = "connecting" | "connected" | "failed";

export function mapRtcConnectionState(raw: string | undefined | null): VoicePeerConnectionState {
  if (raw === "connected" || raw === "completed") return "connected";
  if (raw === "failed" || raw === "closed") return "failed";
  return "connecting";
}

export interface VoiceConnectionSummary {
  total: number;
  connected: number;
  connecting: number;
  failed: number;
  failedPeerIds: string[];
  /** empty = nobody else in voice · connected = every pair live ·
   *  connecting = pairs still being made, none failed ·
   *  partial = some live, some failed · failed = every pair failed */
  state: "empty" | "connected" | "connecting" | "partial" | "failed";
}

/** Roll per-peer states into the one aggregate the UI shows. Pure. */
export function summarizeVoiceConnections(
  states: ReadonlyMap<string, VoicePeerConnectionState>,
): VoiceConnectionSummary {
  let connected = 0;
  let connecting = 0;
  let failed = 0;
  const failedPeerIds: string[] = [];
  for (const [peerId, s] of states) {
    if (s === "connected") connected++;
    else if (s === "failed") {
      failed++;
      failedPeerIds.push(peerId);
    } else connecting++;
  }
  const total = states.size;
  let state: VoiceConnectionSummary["state"];
  if (total === 0) state = "empty";
  else if (failed === total) state = "failed";
  else if (failed > 0) state = "partial";
  else if (connected === total) state = "connected";
  else state = "connecting";
  return { total, connected, connecting, failed, failedPeerIds, state };
}

/**
 * A memoizing summarizer (Stack-100 #2 item 66): the mesh emits a
 * fresh snapshot Map on every peer change and the page re-renders
 * for many unrelated reasons, so rolling the summary up from
 * scratch on every snapshot/render — including join/partway states
 * where nothing changed — is wasted work and, worse, a NEW summary
 * object each time, which defeats any downstream memo on it. This
 * summarizer returns the SAME summary object while the snapshot's
 * contents are unchanged (same peers, same states), and recomputes
 * only when they actually differ. Contents are compared, not Map
 * identity — the page copies the mesh's Map into state.
 */
export function createVoiceConnectionSummarizer(): (
  states: ReadonlyMap<string, VoicePeerConnectionState>,
) => VoiceConnectionSummary {
  let lastKey: string | null = null;
  let lastSummary: VoiceConnectionSummary | null = null;
  return (states) => {
    let key = "";
    for (const [peerId, s] of states) key += `${peerId}=${s};`;
    if (lastSummary !== null && key === lastKey) return lastSummary;
    lastKey = key;
    lastSummary = summarizeVoiceConnections(states);
    return lastSummary;
  };
}

/** The headline the voice UI shows for a summary — plain words, no
 *  dead air dressed up as success. Without room context the empty
 *  state reads as no headline. WITH the room's occupant count
 *  (Stack-100 #2 item 63) the empty state is the room's honest
 *  quiet signal: you are in voice and nobody else is, so the room
 *  is voice-quiet — and that renders BY ROOM STATE at any occupant
 *  count (alone, or in a mixed room of 2+ where everyone else is
 *  text-only), never only when a room has exactly one member. */
export function voiceConnectionHeadline(
  summary: VoiceConnectionSummary,
  roomOccupants?: number,
): string {
  switch (summary.state) {
    case "empty":
      return typeof roomOccupants === "number"
        ? "Quiet in here — you're the only one in voice right now"
        : "";
    case "connected":
      return "Voice connected";
    case "connecting":
      return "Voice connecting…";
    case "partial":
      return "Voice connected — but some people here couldn't be reached";
    case "failed":
      return "Voice couldn't connect — your network may be blocking peer-to-peer voice. You can still walk the hall and use text.";
  }
}

/** One remote voice: its stream + the volume control over it. The
 *  browser implementation wraps an AudioContext gain node; tests
 *  inject a recorder. */
export interface VoiceSink {
  setGain(value: number): void;
  dispose(): void;
  /** The speaker's current voice level (0..1, smoothed) when the sink
   *  can measure one — tapped BEFORE the proximity gain, so a far-off
   *  friend's lips still move while their voice is faint. Drives the
   *  hall's character lip motion; sinks without it read as silent. */
  getLevel?: () => number;
}

export interface VoiceMeshDeps {
  sendSignal(to: string, data: VoiceSignalData): void;
  createPeerConnection(): RtcPeerConnectionLike;
  createSink(peerId: string, stream: unknown): VoiceSink;
  /** Called when a peer's audio stream first arrives (UI "speaking" hooks). */
  onRemoteStream?: (peerId: string) => void;
  /** Called with the FULL per-peer connection-state snapshot whenever
   *  any pair's state changes (and when peers come and go), so the UI
   *  can show the truth instead of assuming silence means success. */
  onPeerConnectionStates?: (states: ReadonlyMap<string, VoicePeerConnectionState>) => void;
}

interface MeshPeer {
  pc: RtcPeerConnectionLike;
  sink: VoiceSink | null;
  /** ICE candidates that arrived before the remote description. */
  pendingIce: unknown[];
  hasRemote: boolean;
  connState: VoicePeerConnectionState;
}

export class VoiceMesh {
  private peers = new Map<string, MeshPeer>();
  private localStream: { getAudioTracks(): Array<{ enabled: boolean }> } | null = null;
  private muted = false;
  private gainPolicy: VoiceGainPolicy = "proximity";

  constructor(private deps: VoiceMeshDeps) {}

  get peerCount(): number {
    return this.peers.size;
  }

  /** One peer's tracked connection state (undefined once dropped). */
  connectionStateFor(peerId: string): VoicePeerConnectionState | undefined {
    return this.peers.get(peerId)?.connState;
  }

  /** A snapshot of every pair's connection state — what the UI
   *  renders and summarizeVoiceConnections rolls up. */
  connectionStates(): Map<string, VoicePeerConnectionState> {
    const out = new Map<string, VoicePeerConnectionState>();
    for (const [peerId, peer] of this.peers) out.set(peerId, peer.connState);
    return out;
  }

  /** Retry ONE failed (or stuck) pair: tear its dead connection down
   *  and offer fresh. The glare rule bends here on purpose — for a
   *  connection that never came up, a re-offer from either side is
   *  the only recovery there is, and the pair's signaling is idle, so
   *  there is no live negotiation to collide with. Returns false
   *  when there is nothing to retry (unknown peer, or I've left). */
  async retryPeer(peerId: string): Promise<boolean> {
    const peer = this.peers.get(peerId);
    if (!peer || !this.localStream) return false;
    this.dropPeer(peerId);
    await this.offerTo(peerId).catch(() => undefined);
    return true;
  }

  private emitConnectionStates(): void {
    this.deps.onPeerConnectionStates?.(this.connectionStates());
  }

  private setConnState(peer: MeshPeer, next: VoicePeerConnectionState): void {
    if (peer.connState === next) return;
    peer.connState = next;
    this.emitConnectionStates();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get policy(): VoiceGainPolicy {
    return this.gainPolicy;
  }

  /** How I hear the room (the voice mode's gain policy). Applies on
   *  the page's next proximity pass — a quarter second at most — so
   *  a mode flip never needs the mesh rebuilt: the connections were
   *  always room-wide, only the gains change. */
  setGainPolicy(policy: VoiceGainPolicy): void {
    this.gainPolicy = policy;
  }

  /** Begin: stash the mic stream. Pairing starts when the server's
   *  voice.state arrives (handleVoiceState) — the newcomer offers. */
  start(localStream: { getAudioTracks(): Array<{ enabled: boolean }> }): void {
    this.localStream = localStream;
    this.applyMute();
  }

  /** The server's answer to my voice.join: everyone already in voice.
   *  As the newcomer I offer to each — one connection per peer. */
  async handleVoiceState(voicePeerIds: string[]): Promise<void> {
    for (const peerId of voicePeerIds) {
      if (!this.peers.has(peerId)) {
        await this.offerTo(peerId).catch(() => undefined);
      }
    }
  }

  async handleSignal(from: string, data: VoiceSignalData): Promise<void> {
    if (!data || typeof data !== "object") return;
    if (data.kind === "offer" && typeof data.sdp === "string") {
      const peer = this.ensurePeer(from);
      await peer.pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
      peer.hasRemote = true;
      await this.flushIce(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.deps.sendSignal(from, { kind: "answer", sdp: answer.sdp });
      return;
    }
    if (data.kind === "answer" && typeof data.sdp === "string") {
      const peer = this.peers.get(from);
      if (!peer) return;
      await peer.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      peer.hasRemote = true;
      await this.flushIce(peer);
      return;
    }
    if (data.kind === "ice") {
      const peer = this.peers.get(from);
      if (!peer) return;
      if (peer.hasRemote) {
        await peer.pc.addIceCandidate(data.candidate).catch(() => undefined);
      } else {
        peer.pendingIce.push(data.candidate);
      }
    }
  }

  /** A peer's live voice level (0..1, smoothed) — 0 for peers with no
   *  stream or a sink that can't measure. The hall reads this to move
   *  a character figure's lips with its speaker's voice. */
  levelFor(peerId: string): number {
    const rec = this.peers.get(peerId);
    return rec?.sink?.getLevel ? rec.sink.getLevel() : 0;
  }

  /** A peer left voice (or the room): tear their connection down. */
  dropPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    peer.sink?.dispose();
    try {
      peer.pc.close();
    } catch {
      /* already closed */
    }
    this.emitConnectionStates();
  }

  /** End my voice session entirely (mic stream itself is owned by the
   *  caller, which stops its tracks). */
  leave(): void {
    for (const peerId of [...this.peers.keys()]) this.dropPeer(peerId);
    this.localStream = null;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute();
  }

  /** Volume pass: the page calls this as avatars move. `positions`
   *  holds every voice peer's current spot. How a peer's gain is
   *  decided is the current policy's business:
   *   - proximity: distance curve; a peer missing from the map is
   *     out of range (silence, never a blast)
   *   - lobby: full volume whether placed or not — the whole hall
   *   - silent (deafened): zero, placed or not */
  updateVolumes(self: { x: number; z: number }, positions: Map<string, { x: number; z: number }>): void {
    for (const [peerId, peer] of this.peers) {
      if (!peer.sink) continue;
      const pos = positions.get(peerId);
      if (!pos) {
        peer.sink.setGain(this.gainPolicy === "lobby" ? 1 : 0);
        continue;
      }
      const dx = pos.x - self.x;
      const dz = pos.z - self.z;
      peer.sink.setGain(gainForPolicy(this.gainPolicy, Math.hypot(dx, dz)));
    }
  }

  private applyMute(): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !this.muted;
    }
  }

  private ensurePeer(peerId: string): MeshPeer {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const pc = this.deps.createPeerConnection();
    const peer: MeshPeer = { pc, sink: null, pendingIce: [], hasRemote: false, connState: "connecting" };
    this.peers.set(peerId, peer);
    this.emitConnectionStates();
    /* Track the browser's own verdict on this pair. A PC without the
     *  hook (test fakes) keeps the honest default: "connecting" until
     *  a stream actually lands (ontrack below), never assumed live. */
    pc.onconnectionstatechange = () => {
      this.setConnState(peer, mapRtcConnectionState(pc.connectionState));
    };
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.deps.sendSignal(peerId, { kind: "ice", candidate: ev.candidate });
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream === undefined) return;
      peer.sink?.dispose();
      peer.sink = this.deps.createSink(peerId, stream);
      /* Media is actually flowing — that IS connected, whatever the
       *  state hook said (or couldn't say, on a fake). A later real
       *  failure still overrides via onconnectionstatechange. */
      if (peer.connState === "connecting") this.setConnState(peer, "connected");
      this.deps.onRemoteStream?.(peerId);
    };
    return peer;
  }

  private async offerTo(peerId: string): Promise<void> {
    const peer = this.ensurePeer(peerId);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.deps.sendSignal(peerId, { kind: "offer", sdp: offer.sdp });
  }

  private async flushIce(peer: MeshPeer): Promise<void> {
    const pending = peer.pendingIce.splice(0);
    for (const candidate of pending) {
      await peer.pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }
}

/* ── Browser wiring (used by the world page; the mesh itself stays
   dependency-injected and testable) ─────────────────────────────────── */

/** Build a browser peer connection from a session's ICE servers —
 *  the list lib/world/voice-ice built from the server's voice config
 *  (STUN default, plus a TURN relay when one is configured). Defaults
 *  to exactly the STUN-only config the mesh has always used. */
export function createBrowserPeerConnection(
  iceServers: IceServerConfig[] = buildIceServers(null),
): RtcPeerConnectionLike {
  return new RTCPeerConnection({
    iceServers: iceServers as RTCIceServer[],
  }) as unknown as RtcPeerConnectionLike;
}

/** Remote voice playback: stream → gain → speakers. The AudioContext
 *  is shared and created lazily on first use (autoplay policies want a
 *  user gesture upstream — joining voice IS that gesture). */
let sharedCtx: AudioContext | null = null;

/** Your OWN voice level, tapped off your mic stream with the same
 *  analyser + smoothing the remote sinks use — so your character's
 *  lips move to your voice exactly the way everyone else's move to
 *  theirs. Measurement only; nothing is recorded or sent twice (the
 *  mesh already carries the audio). Muting disables the mic track,
 *  and a disabled track reads as silence here too. */
export function createLocalLevelTap(stream: unknown): { getLevel: () => number; dispose: () => void } {
  const ctx = (sharedCtx ??= new AudioContext());
  void ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream as MediaStream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const tracker = new SpeechLevelTracker();
  return {
    getLevel() {
      analyser.getByteTimeDomainData(samples);
      return tracker.push(rmsFromTimeDomain(samples));
    },
    dispose() {
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* already torn down */
      }
    },
  };
}
export function createBrowserVoiceSink(_peerId: string, stream: unknown): VoiceSink {
  const ctx = (sharedCtx ??= new AudioContext());
  void ctx.resume().catch(() => undefined);
  const source = ctx.createMediaStreamSource(stream as MediaStream);
  const gain = ctx.createGain();
  gain.gain.value = 0; // silent until the first proximity pass places them
  source.connect(gain);
  gain.connect(ctx.destination);
  // Lip-motion tap: an analyser on the RAW stream (pre-gain, so a
  // distant speaker's lips still move even when their voice is too
  // faint to hear) feeding the shared speech smoothing.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const tracker = new SpeechLevelTracker();
  return {
    setGain(value: number) {
      gain.gain.setTargetAtTime(value, ctx.currentTime, 0.08);
    },
    getLevel() {
      analyser.getByteTimeDomainData(samples);
      return tracker.push(rmsFromTimeDomain(samples));
    },
    dispose() {
      try {
        source.disconnect();
        gain.disconnect();
        analyser.disconnect();
      } catch {
        /* already torn down */
      }
    },
  };
}
