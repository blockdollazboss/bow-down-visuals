/**
 * stage-room.ts — Stage audio rooms (Stack 10 #6). Presence + voice
 * signaling state, socket-only like the World (lib/world-room.ts):
 * a room exists in this process exactly while its row is open and
 * peers are connected. Voice is a WebRTC mesh relayed over the same
 * gateway — small-room by design: speaker cap 8, total presence cap
 * 25, STUN-only (no TURN), so a strict NAT can still block a peer's
 * audio; that limitation is stated in the client copy, not hidden.
 * Guests (no sign-in) may listen only: no mic, no text.
 * The host promotes listeners to speaker and demotes speakers; only
 * speakers may join the voice mesh. Text chat rides the same frames.
 */
import { RoomHub, WS_OPEN, type WsClientSocket } from "./live-ws";

export const STAGE_SPEAKER_CAP = 8;
export const STAGE_PRESENCE_CAP = 25;
export const STAGE_SAY_MAX = 500;

export interface StageIdentity { userId: string | null; displayName: string }
interface Peer extends StageIdentity {
  peerId: string; socket: WsClientSocket; role: "host" | "speaker" | "listener"; voice: boolean;
}
export interface StagePeerDto { peerId: string; displayName: string; role: Peer["role"]; guest: boolean; voice: boolean }

export class StageRoom {
  private peers = new Map<WsClientSocket, Peer>();
  private counter = 0;
  constructor(private hub: RoomHub, readonly roomId: string, readonly hostUserId: string) {}
  private roomKey() { return `stage:${this.roomId}`; }
  size() { return this.peers.size; }
  speakerCount() { let n = 0; for (const p of this.peers.values()) if (p.role !== "listener") n++; return n; }
  private dto(p: Peer): StagePeerDto { return { peerId: p.peerId, displayName: p.displayName, role: p.role, guest: p.userId === null, voice: p.voice }; }
  peersDto(): StagePeerDto[] { return [...this.peers.values()].map((p) => this.dto(p)); }
  private send(p: Peer, payload: unknown) { if (p.socket.readyState === WS_OPEN) { try { p.socket.send(JSON.stringify(payload)); } catch { /* reaped on close */ } } }
  private broadcast(payload: unknown) { for (const p of this.peers.values()) this.send(p, payload); }

  attach(socket: WsClientSocket, identity: StageIdentity): boolean {
    if (this.peers.size >= STAGE_PRESENCE_CAP) {
      try { socket.send(JSON.stringify({ type: "room_full", cap: STAGE_PRESENCE_CAP })); } catch { /* closing */ }
      try { socket.close(4429, "room_full"); } catch { /* gone */ }
      return false;
    }
    this.counter++;
    const peer: Peer = {
      ...identity, peerId: `s${this.counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      socket, role: identity.userId && identity.userId === this.hostUserId ? "host" : "listener", voice: false,
    };
    this.peers.set(socket, peer);
    this.hub.join(this.roomKey(), socket);
    this.send(peer, { type: "welcome", peerId: peer.peerId, you: this.dto(peer), peers: this.peersDto().filter((d) => d.peerId !== peer.peerId), speakerCap: STAGE_SPEAKER_CAP, presenceCap: STAGE_PRESENCE_CAP });
    for (const p of this.peers.values()) if (p !== peer) this.send(p, { type: "peer.join", peer: this.dto(peer) });
    return true;
  }

  detach(socket: WsClientSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    this.hub.leave(this.roomKey(), socket);
    this.broadcast({ type: "peer.leave", peerId: peer.peerId });
  }

  /** Host-only role change. Returns an honest error string or null. */
  setRole(bySocket: WsClientSocket, targetPeerId: string, role: "speaker" | "listener"): string | null {
    const actor = this.peers.get(bySocket);
    if (!actor || actor.role !== "host") return "Only the host can change who speaks.";
    const target = [...this.peers.values()].find((p) => p.peerId === targetPeerId);
    if (!target) return "That person isn't in the room anymore.";
    if (target.role === "host") return "The host always keeps the stage.";
    if (role === "speaker" && target.role !== "speaker" && this.speakerCount() >= STAGE_SPEAKER_CAP) {
      return `The stage is full — ${STAGE_SPEAKER_CAP} speakers at once is the room limit.`;
    }
    target.role = role;
    if (role === "listener") target.voice = false;
    this.broadcast({ type: "peer.role", peerId: target.peerId, role, voice: target.voice });
    return null;
  }

  handleFrame(socket: WsClientSocket, raw: string): void {
    const peer = this.peers.get(socket);
    if (!peer || raw.length > 16384) return;
    let frame: Record<string, unknown>;
    try { const p: unknown = JSON.parse(raw); if (!p || typeof p !== "object") return; frame = p as Record<string, unknown>; } catch { return; }
    switch (frame["type"]) {
      case "say": {
        if (!peer.userId) { this.send(peer, { type: "denied", reason: "Guests listen only — sign in to chat." }); return; }
        const body = typeof frame["body"] === "string" ? frame["body"].trim().slice(0, STAGE_SAY_MAX) : "";
        if (!body) return;
        this.broadcast({ type: "peer.say", peerId: peer.peerId, displayName: peer.displayName, body });
        return;
      }
      case "role.set": {
        const role = frame["role"] === "speaker" || frame["role"] === "listener" ? frame["role"] : null;
        const target = typeof frame["peerId"] === "string" ? frame["peerId"] : "";
        if (!role || !target) return;
        const err = this.setRole(socket, target, role);
        if (err) this.send(peer, { type: "denied", reason: err });
        return;
      }
      case "voice.join": {
        if (!peer.userId) { this.send(peer, { type: "voice.denied", reason: "Guests listen only — sign in and get promoted to speak." }); return; }
        if (peer.role === "listener") { this.send(peer, { type: "voice.denied", reason: "You're a listener here — the host promotes listeners to speaker." }); return; }
        peer.voice = true;
        this.send(peer, { type: "voice.state", voicePeerIds: [...this.peers.values()].filter((p) => p.voice && p !== peer).map((p) => p.peerId) });
        this.broadcast({ type: "voice.joined", peerId: peer.peerId });
        return;
      }
      case "voice.leave": {
        if (!peer.voice) return;
        peer.voice = false;
        this.broadcast({ type: "voice.left", peerId: peer.peerId });
        return;
      }
      case "voice.signal": {
        if (!peer.voice) return;
        const to = typeof frame["to"] === "string" ? frame["to"] : "";
        const target = [...this.peers.values()].find((p) => p.peerId === to);
        if (target?.voice) this.send(target, { type: "voice.signal", from: peer.peerId, data: frame["data"] ?? null });
        return;
      }
      default: return;
    }
  }
}

/** Live rooms by stage_rooms row id (process-local presence). */
export const stageRooms = new Map<string, StageRoom>();
export function getOrCreateStageRoom(hub: RoomHub, roomId: string, hostUserId: string): StageRoom {
  let r = stageRooms.get(roomId);
  if (!r) { r = new StageRoom(hub, roomId, hostUserId); stageRooms.set(roomId, r); }
  return r;
}
