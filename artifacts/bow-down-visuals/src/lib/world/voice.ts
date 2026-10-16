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
 * NAT note: connections use a public STUN server for candidate
 * gathering. There is no TURN relay configured in v1 — on the small
 * share of networks where peer-to-peer is fully blocked, a pair simply
 * won't hear each other; the room, presence and text still work.
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

export const VOICE_FULL_HEAR_DISTANCE = 2; // metres: full volume inside this
export const VOICE_MAX_DISTANCE = 16; // metres: silence beyond this

/** Proximity volume curve: 1 up close, smooth fade to 0 at max range. */
export function gainForDistance(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM <= VOICE_FULL_HEAR_DISTANCE) return 1;
  if (distanceM >= VOICE_MAX_DISTANCE) return 0;
  const t = (VOICE_MAX_DISTANCE - distanceM) / (VOICE_MAX_DISTANCE - VOICE_FULL_HEAR_DISTANCE);
  return t * t * (3 - 2 * t); // smoothstep — no volume cliff at the edge
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
}

interface MeshPeer {
  pc: RtcPeerConnectionLike;
  sink: VoiceSink | null;
  /** ICE candidates that arrived before the remote description. */
  pendingIce: unknown[];
  hasRemote: boolean;
}

export class VoiceMesh {
  private peers = new Map<string, MeshPeer>();
  private localStream: { getAudioTracks(): Array<{ enabled: boolean }> } | null = null;
  private muted = false;

  constructor(private deps: VoiceMeshDeps) {}

  get peerCount(): number {
    return this.peers.size;
  }

  get isMuted(): boolean {
    return this.muted;
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

  /** Proximity pass: the page calls this as avatars move. `positions`
   *  holds every voice peer's current spot; a peer missing from the
   *  map is treated as out of range (silence, never a blast). */
  updateVolumes(self: { x: number; z: number }, positions: Map<string, { x: number; z: number }>): void {
    for (const [peerId, peer] of this.peers) {
      if (!peer.sink) continue;
      const pos = positions.get(peerId);
      if (!pos) {
        peer.sink.setGain(0);
        continue;
      }
      const dx = pos.x - self.x;
      const dz = pos.z - self.z;
      peer.sink.setGain(gainForDistance(Math.hypot(dx, dz)));
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
    const peer: MeshPeer = { pc, sink: null, pendingIce: [], hasRemote: false };
    this.peers.set(peerId, peer);
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

export function createBrowserPeerConnection(): RtcPeerConnectionLike {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  }) as unknown as RtcPeerConnectionLike;
}

/** Remote voice playback: stream → gain → speakers. The AudioContext
 *  is shared and created lazily on first use (autoplay policies want a
 *  user gesture upstream — joining voice IS that gesture). */
let sharedCtx: AudioContext | null = null;
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
