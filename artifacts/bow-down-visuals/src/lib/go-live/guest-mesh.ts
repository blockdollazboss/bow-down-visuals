/**
 * guest-mesh.ts — the backstage WebRTC mesh (video + audio), modeled
 * on the World's VoiceMesh (lib/world/voice.ts) but carrying full
 * A/V tracks: backstage is a greenroom you can SEE, and an on-stage
 * guest's feed is what the host's studio canvas mixes to air.
 *
 * The mesh is transport-agnostic: signaling frames ride the backstage
 * socket (server relays them only between media-joined peers), peer
 * connections are injected, and remote streams are reported through
 * callbacks plus a lookup map — so the whole pairing dance is unit
 * testable with fake peer connections, like VoiceMesh.
 *
 * STUN-only (no TURN), matching the house's other meshes: a strict
 * NAT can still block a peer; the UI copy says so rather than
 * pretending otherwise.
 */
export interface GuestSignalData {
  kind: "offer" | "answer" | "ice";
  sdp?: string;
  candidate?: unknown;
}

export interface GuestRtcDescription {
  type: string;
  sdp?: string;
}

export interface GuestPeerConnectionLike {
  addTrack(track: unknown, stream: unknown): void;
  createOffer(): Promise<GuestRtcDescription>;
  createAnswer(): Promise<GuestRtcDescription>;
  setLocalDescription(desc: GuestRtcDescription): Promise<void>;
  setRemoteDescription(desc: GuestRtcDescription): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  close(): void;
  ontrack: ((ev: { streams: unknown[] }) => void) | null;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
}

export interface GuestMeshDeps {
  sendSignal(to: string, data: GuestSignalData): void;
  createPeerConnection(): GuestPeerConnectionLike;
  /** A peer's media stream arrived (first track). */
  onRemoteStream?: (peerId: string, stream: unknown) => void;
  /** A peer's connection was torn down. */
  onPeerGone?: (peerId: string) => void;
}

interface MeshPeer {
  pc: GuestPeerConnectionLike;
  pendingIce: unknown[];
  hasRemote: boolean;
  stream: unknown | null;
}

interface LocalStreamLike {
  getTracks(): unknown[];
}

export class GuestMesh {
  private peers = new Map<string, MeshPeer>();
  private localStream: LocalStreamLike | null = null;

  constructor(private deps: GuestMeshDeps) {}

  get peerCount(): number {
    return this.peers.size;
  }

  /** Begin: stash the local A/V stream. Pairing starts when the
   *  server's media.state arrives (handleMediaState) — the newcomer
   *  offers, exactly like VoiceMesh. */
  start(localStream: LocalStreamLike): void {
    this.localStream = localStream;
  }

  /** The server's answer to media.join: everyone already in media.
   *  As the newcomer I offer to each. */
  async handleMediaState(mediaPeerIds: string[]): Promise<void> {
    for (const peerId of mediaPeerIds) {
      if (!this.peers.has(peerId)) {
        await this.offerTo(peerId).catch(() => undefined);
      }
    }
  }

  /** A peer joined media after me: they will offer; nothing to do
   *  until their offer lands in handleSignal. Kept as a named hook
   *  so callers don't special-case it. */
  handlePeerJoinedMedia(_peerId: string): void {
    /* the newcomer offers — see handleMediaState */
  }

  async handleSignal(from: string, data: GuestSignalData): Promise<void> {
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

  /** The remote stream for a peer, once any track has arrived. */
  remoteStreamFor(peerId: string): unknown | null {
    return this.peers.get(peerId)?.stream ?? null;
  }

  dropPeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    try {
      peer.pc.close();
    } catch {
      /* already closed */
    }
    this.deps.onPeerGone?.(peerId);
  }

  leave(): void {
    for (const peerId of [...this.peers.keys()]) this.dropPeer(peerId);
    this.localStream = null;
  }

  private ensurePeer(peerId: string): MeshPeer {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const pc = this.deps.createPeerConnection();
    const peer: MeshPeer = { pc, pendingIce: [], hasRemote: false, stream: null };
    this.peers.set(peerId, peer);
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.deps.sendSignal(peerId, { kind: "ice", candidate: ev.candidate });
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (stream === undefined) return;
      peer.stream = stream;
      this.deps.onRemoteStream?.(peerId, stream);
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

/** Browser wiring: a real RTCPeerConnection, STUN-only like the
 *  house's other meshes. */
export function createGuestPeerConnection(): GuestPeerConnectionLike {
  return new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  }) as unknown as GuestPeerConnectionLike;
}
