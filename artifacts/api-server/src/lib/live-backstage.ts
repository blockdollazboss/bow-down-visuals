/**
 * live-backstage.ts — the Go Live greenroom (competitor study G3).
 * Presence + media signaling state for one stream's backstage,
 * socket-only like the stage rooms (lib/stage-room.ts): a room exists
 * in this process exactly while its stream is live and peers are
 * connected. Media is a WebRTC mesh relayed over the same gateway —
 * small-room by design (StreamYard's shape): the host plus up to
 * GUEST_ROOM_CAP guests, STUN-only (no TURN), so a strict NAT can
 * still block a peer's media; that limitation is stated in the client
 * copy, not hidden.
 *
 * Who is who, honestly: the host is a signed-in member (session
 * token). A guest is NOT a member — they hold a guest session minted
 * from an invite link (routes/live-guests.ts), their peer carries
 * guest: true everywhere, and no frame ever presents them as anything
 * else. Guest state (backstage / on_stage) is a DATABASE fact owned
 * by the REST rail; this room only mirrors it for presence and media:
 * the audience program feed never comes from here — an on-stage
 * guest reaches the audience only through the host's studio canvas.
 *
 * Backstage talk never reaches the audience: chat writes ride REST
 * into live_backstage_messages (a table the audience chat rail never
 * reads) and delivery rides this room only — host + guest sockets.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { RoomHub, WS_OPEN, type WsClientSocket } from "./live-ws";

/** Guests in one backstage at once (the host is extra). */
export const GUEST_ROOM_CAP = 10;
/** Guests the host can put on stage at once (program-tile sanity). */
export const ON_STAGE_GUEST_CAP = 5;
export const BACKSTAGE_SAY_MAX = 500;

/* ── Invite / session tokens ─────────────────────────────────────────
   High-entropy random tokens; only their SHA-256 hex is ever stored
   (the RTMP ingest-key treatment, 0193). The plain token exists only
   in the mint response and in the link the host shares. */
export function mintGuestToken(): string {
  return randomBytes(32).toString("base64url");
}
export function guestTokenLookup(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
export function guestTokenHint(token: string): string {
  return token.slice(-4);
}
export function guestTokensMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type BackstageGuestState = "backstage" | "on_stage";

export interface BackstageIdentity {
  kind: "host" | "guest";
  userId: string | null;
  guestSessionId: string | null;
  displayName: string;
  guestState: BackstageGuestState | null;
}

interface Peer extends BackstageIdentity {
  peerId: string;
  socket: WsClientSocket;
  media: boolean;
}

export interface BackstagePeerDto {
  peerId: string;
  kind: "host" | "guest";
  guest: boolean;
  guestSessionId: string | null;
  displayName: string;
  guestState: BackstageGuestState | null;
  media: boolean;
}

export class BackstageRoom {
  private peers = new Map<WsClientSocket, Peer>();
  private counter = 0;
  constructor(
    private hub: RoomHub,
    readonly streamId: string,
    readonly hostUserId: string,
  ) {}
  private roomKey() {
    return `backstage:${this.streamId}`;
  }
  size() {
    return this.peers.size;
  }
  guestCount() {
    let n = 0;
    for (const p of this.peers.values()) if (p.kind === "guest") n++;
    return n;
  }
  onStageCount() {
    let n = 0;
    for (const p of this.peers.values()) if (p.kind === "guest" && p.guestState === "on_stage") n++;
    return n;
  }
  private dto(p: Peer): BackstagePeerDto {
    return {
      peerId: p.peerId,
      kind: p.kind,
      guest: p.kind === "guest",
      guestSessionId: p.guestSessionId,
      displayName: p.displayName,
      guestState: p.guestState,
      media: p.media,
    };
  }
  peersDto(): BackstagePeerDto[] {
    return [...this.peers.values()].map((p) => this.dto(p));
  }
  private send(p: Peer, payload: unknown) {
    if (p.socket.readyState === WS_OPEN) {
      try {
        p.socket.send(JSON.stringify(payload));
      } catch {
        /* reaped on close */
      }
    }
  }
  private broadcast(payload: unknown) {
    for (const p of this.peers.values()) this.send(p, payload);
  }

  attach(socket: WsClientSocket, identity: BackstageIdentity): boolean {
    if (identity.kind === "guest" && this.guestCount() >= GUEST_ROOM_CAP) {
      try {
        socket.send(JSON.stringify({ type: "room_full", cap: GUEST_ROOM_CAP }));
      } catch {
        /* closing */
      }
      try {
        socket.close(4429, "room_full");
      } catch {
        /* gone */
      }
      return false;
    }
    /* One live socket per guest session: a rejoin replaces the old
       socket (the world-ghost rule) instead of doubling the guest. */
    if (identity.kind === "guest" && identity.guestSessionId) {
      for (const p of [...this.peers.values()]) {
        if (p.guestSessionId === identity.guestSessionId) this.detach(p.socket);
      }
    }
    this.counter++;
    const peer: Peer = {
      ...identity,
      peerId: `b${this.counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      socket,
      media: false,
    };
    this.peers.set(socket, peer);
    this.hub.join(this.roomKey(), socket);
    this.send(peer, {
      type: "welcome",
      peerId: peer.peerId,
      you: this.dto(peer),
      peers: this.peersDto().filter((d) => d.peerId !== peer.peerId),
      guestCap: GUEST_ROOM_CAP,
      onStageCap: ON_STAGE_GUEST_CAP,
    });
    for (const p of this.peers.values()) if (p !== peer) this.send(p, { type: "peer.join", peer: this.dto(peer) });
    return true;
  }

  detach(socket: WsClientSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    this.hub.leave(this.roomKey(), socket);
    this.broadcast({ type: "peer.leave", peerId: peer.peerId });
    if (this.peers.size === 0) backstageRooms.delete(this.streamId);
  }

  /** End every socket for a guest session (revoke / remove / stream
   *  end): the peer is told why, then dropped. */
  endGuestSession(guestSessionId: string, reason: string): void {
    for (const p of [...this.peers.values()]) {
      if (p.guestSessionId !== guestSessionId) continue;
      this.send(p, { type: "session.ended", reason });
      this.detach(p.socket);
      try {
        p.socket.close(4403, reason);
      } catch {
        /* gone */
      }
    }
  }

  /** Mirror a DB state change the REST rail made (promote / demote). */
  applyGuestState(guestSessionId: string, state: BackstageGuestState): void {
    for (const p of this.peers.values()) {
      if (p.guestSessionId !== guestSessionId) continue;
      p.guestState = state;
      this.broadcast({ type: "peer.state", peerId: p.peerId, guestSessionId, guestState: state });
    }
  }

  /** Chat delivery from the REST write path: host + guests only —
   *  this room has no audience sockets by construction. */
  deliverChat(payload: unknown): void {
    this.hub.broadcast(this.roomKey(), payload);
  }

  /** End the whole backstage (stream end): everyone is told, then
   *  detached; sockets themselves close from the client side. */
  closeAll(reason: string): void {
    this.broadcast({ type: "backstage.closed", reason });
    for (const socket of [...this.peers.keys()]) this.detach(socket);
  }

  handleFrame(socket: WsClientSocket, raw: string): void {
    const peer = this.peers.get(socket);
    if (!peer || raw.length > 32768) return;
    let frame: Record<string, unknown>;
    try {
      const p: unknown = JSON.parse(raw);
      if (!p || typeof p !== "object") return;
      frame = p as Record<string, unknown>;
    } catch {
      return;
    }
    switch (frame["type"]) {
      case "media.join": {
        /* Everyone backstage may join the greenroom mesh — host and
           guests alike. On-stage is a program-canvas fact, not a
           mesh gate: the host hears a backstage guest to coach them,
           the audience hears only what the host's canvas mixes. */
        peer.media = true;
        this.send(peer, {
          type: "media.state",
          mediaPeerIds: [...this.peers.values()].filter((p) => p.media && p !== peer).map((p) => p.peerId),
        });
        this.broadcast({ type: "media.joined", peerId: peer.peerId });
        return;
      }
      case "media.leave": {
        if (!peer.media) return;
        peer.media = false;
        this.broadcast({ type: "media.left", peerId: peer.peerId });
        return;
      }
      case "media.signal": {
        if (!peer.media) return;
        const to = typeof frame["to"] === "string" ? frame["to"] : "";
        const target = [...this.peers.values()].find((p) => p.peerId === to);
        if (target?.media) this.send(target, { type: "media.signal", from: peer.peerId, data: frame["data"] ?? null });
        return;
      }
      default:
        return;
    }
  }
}

/** Live backstage rooms by stream id (process-local presence). */
export const backstageRooms = new Map<string, BackstageRoom>();
export function getOrCreateBackstageRoom(hub: RoomHub, streamId: string, hostUserId: string): BackstageRoom {
  let r = backstageRooms.get(streamId);
  if (!r) {
    r = new BackstageRoom(hub, streamId, hostUserId);
    backstageRooms.set(streamId, r);
  }
  return r;
}
export function getBackstageRoom(streamId: string): BackstageRoom | null {
  return backstageRooms.get(streamId) ?? null;
}

/** Tear a stream's backstage down entirely (stream end). */
export function closeBackstage(streamId: string, reason: string): void {
  const room = backstageRooms.get(streamId);
  if (!room) return;
  room.closeAll(reason);
  backstageRooms.delete(streamId);
}
