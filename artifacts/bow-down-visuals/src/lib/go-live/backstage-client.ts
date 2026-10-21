/**
 * backstage-client.ts — one backstage connection: the socket
 * (presence, state mirrors, chat delivery, media signaling) plus the
 * GuestMesh it feeds. Shared by the host's GuestPanel and the guest
 * page; the difference between them is only which token opens the
 * door and what the UI does with the events.
 *
 * Chat WRITES never ride this socket — they go through REST
 * (guest-api.ts) so pacing + persistence have one home, exactly like
 * the audience chat rail. This client only receives chat frames.
 */
import { GuestMesh, createGuestPeerConnection, type GuestSignalData } from "./guest-mesh";
import type { BackstageMessageDto } from "./guest-api";

export interface BackstagePeer {
  peerId: string;
  kind: "host" | "guest";
  guest: boolean;
  guestSessionId: string | null;
  displayName: string;
  guestState: "backstage" | "on_stage" | null;
  media: boolean;
}

export interface BackstageClientEvents {
  onPeers?: (peers: BackstagePeer[], me: BackstagePeer | null) => void;
  onChat?: (message: BackstageMessageDto) => void;
  /** A peer's A/V stream arrived; sessionId is null for the host peer. */
  onRemoteStream?: (sessionId: string | null, peerId: string, stream: MediaStream) => void;
  onRemoteGone?: (sessionId: string | null, peerId: string) => void;
  onGuestState?: (sessionId: string, state: "backstage" | "on_stage") => void;
  onSessionEnded?: (reason: string) => void;
  onBackstageClosed?: (reason: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface BackstageClientOptions {
  streamId: string;
  /** Host door: the member's session access token. */
  token?: string | null;
  /** Guest door: the guest session token from join. */
  guestToken?: string | null;
  events?: BackstageClientEvents;
}

export class BackstageClient {
  private ws: WebSocket | null = null;
  private mesh: GuestMesh | null = null;
  private peers = new Map<string, BackstagePeer>();
  private me: BackstagePeer | null = null;
  private localStream: MediaStream | null = null;
  private mediaJoined = false;
  private closed = false;

  constructor(private opts: BackstageClientOptions) {}

  get myPeerId(): string | null {
    return this.me?.peerId ?? null;
  }

  get isMediaJoined(): boolean {
    return this.mediaJoined;
  }

  connect(localStream: MediaStream | null = null): void {
    if (this.ws) return;
    this.localStream = localStream;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const auth = this.opts.guestToken
      ? `guest=${encodeURIComponent(this.opts.guestToken)}`
      : `token=${encodeURIComponent(this.opts.token ?? "")}`;
    const ws = new WebSocket(`${proto}//${window.location.host}/api/live/${this.opts.streamId}/backstage/ws?${auth}`);
    this.ws = ws;
    ws.onopen = () => this.opts.events?.onConnectionChange?.(true);
    ws.onclose = () => {
      this.opts.events?.onConnectionChange?.(false);
      this.ws = null;
    };
    ws.onmessage = (ev) => {
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(String(ev.data));
        if (!parsed || typeof parsed !== "object") return;
        frame = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      this.handleFrame(frame);
    };
    this.mesh = new GuestMesh({
      sendSignal: (to, data) => this.send({ type: "media.signal", to, data }),
      createPeerConnection: () => createGuestPeerConnection(),
      onRemoteStream: (peerId, stream) => {
        const peer = this.peers.get(peerId);
        this.opts.events?.onRemoteStream?.(peer?.guestSessionId ?? null, peerId, stream as MediaStream);
      },
      onPeerGone: (peerId) => {
        const peer = this.peers.get(peerId);
        this.opts.events?.onRemoteGone?.(peer?.guestSessionId ?? null, peerId);
      },
    });
    if (this.localStream) this.mesh.start(this.localStream);
  }

  /** Join the greenroom mesh (camera/mic live backstage). */
  joinMedia(): void {
    if (!this.ws || this.mediaJoined) return;
    this.mediaJoined = true;
    this.send({ type: "media.join" });
  }

  leaveMedia(): void {
    if (!this.ws || !this.mediaJoined) return;
    this.mediaJoined = false;
    this.send({ type: "media.leave" });
    this.mesh?.leave();
    if (this.localStream) this.mesh?.start(this.localStream);
  }

  /** Late camera: swap the local stream and re-pair (peers are
   *  rebuilt so the new tracks ride from the start). */
  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    if (!this.mesh) return;
    this.mesh.leave();
    if (stream) this.mesh.start(stream);
    if (this.mediaJoined) {
      this.send({ type: "media.leave" });
      this.send({ type: "media.join" });
    }
  }

  close(): void {
    this.closed = true;
    this.mesh?.leave();
    this.mesh = null;
    try {
      this.ws?.close();
    } catch {
      /* gone */
    }
    this.ws = null;
  }

  private send(frame: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(frame));
      } catch {
        /* reaped on close */
      }
    }
  }

  private emitPeers(): void {
    this.opts.events?.onPeers?.([...this.peers.values()], this.me);
  }

  private peerFromDto(dto: Record<string, unknown>): BackstagePeer {
    return {
      peerId: String(dto["peerId"] ?? ""),
      kind: dto["kind"] === "host" ? "host" : "guest",
      guest: dto["guest"] === true,
      guestSessionId: (dto["guestSessionId"] as string | null) ?? null,
      displayName: String(dto["displayName"] ?? ""),
      guestState: (dto["guestState"] as "backstage" | "on_stage" | null) ?? null,
      media: dto["media"] === true,
    };
  }

  private handleFrame(frame: Record<string, unknown>): void {
    switch (frame["type"]) {
      case "welcome": {
        const you = this.peerFromDto((frame["you"] as Record<string, unknown>) ?? {});
        this.me = you;
        this.peers.clear();
        this.peers.set(you.peerId, you);
        for (const raw of (frame["peers"] as Array<Record<string, unknown>>) ?? []) {
          const peer = this.peerFromDto(raw);
          this.peers.set(peer.peerId, peer);
        }
        this.emitPeers();
        return;
      }
      case "peer.join": {
        const peer = this.peerFromDto((frame["peer"] as Record<string, unknown>) ?? {});
        this.peers.set(peer.peerId, peer);
        this.emitPeers();
        return;
      }
      case "peer.leave": {
        const peerId = String(frame["peerId"] ?? "");
        this.peers.delete(peerId);
        this.mesh?.dropPeer(peerId);
        this.emitPeers();
        return;
      }
      case "peer.state": {
        const peerId = String(frame["peerId"] ?? "");
        const state = frame["guestState"] === "on_stage" ? "on_stage" : "backstage";
        const peer = this.peers.get(peerId);
        if (peer) {
          peer.guestState = state;
          this.emitPeers();
        }
        const sessionId = (frame["guestSessionId"] as string | null) ?? peer?.guestSessionId ?? null;
        if (sessionId) this.opts.events?.onGuestState?.(sessionId, state);
        return;
      }
      case "media.state": {
        const ids = (frame["mediaPeerIds"] as string[]) ?? [];
        for (const id of ids) {
          const peer = this.peers.get(id);
          if (peer) peer.media = true;
        }
        this.emitPeers();
        void this.mesh?.handleMediaState(ids);
        return;
      }
      case "media.joined": {
        const peerId = String(frame["peerId"] ?? "");
        const peer = this.peers.get(peerId);
        if (peer) peer.media = true;
        this.emitPeers();
        return;
      }
      case "media.left": {
        const peerId = String(frame["peerId"] ?? "");
        const peer = this.peers.get(peerId);
        if (peer) peer.media = false;
        this.mesh?.dropPeer(peerId);
        this.emitPeers();
        return;
      }
      case "media.signal": {
        const from = String(frame["from"] ?? "");
        void this.mesh?.handleSignal(from, (frame["data"] as GuestSignalData) ?? ({} as GuestSignalData));
        return;
      }
      case "backstage.chat": {
        const message = frame["message"] as BackstageMessageDto | undefined;
        if (message) this.opts.events?.onChat?.(message);
        return;
      }
      case "session.ended": {
        this.opts.events?.onSessionEnded?.(String(frame["reason"] ?? "Your backstage pass has ended."));
        return;
      }
      case "backstage.closed": {
        this.opts.events?.onBackstageClosed?.(String(frame["reason"] ?? "The stream has ended."));
        return;
      }
      default:
        return;
    }
  }
}
