/**
 * world-room.ts — The World: presence for the King's Hall, the site's
 * one shared VR room. Socket state only (no DB rows): peers live in
 * this process for exactly as long as their socket does, and despawn
 * the moment it closes.
 *
 * Rides the shared live gateway (lib/live-ws.ts) in its own room,
 * separate from chat/control rooms. Protocol (JSON frames):
 *
 *   client → server
 *     { type: "move", x, y, z, rotY }        position sync (throttled)
 *     { type: "say", body }                  room text (signed-in only)
 *     { type: "character", characterId }     walk in as a Creative Vault
 *                                            character (id only — the
 *                                            server resolves + verifies
 *                                            ownership; null clears)
 *     { type: "voice.join" } / { type: "voice.leave" }
 *     { type: "voice.off", off }             the member's proximity-
 *                                            voice switch: off means
 *                                            they neither send nor hear
 *                                            voice (and are out of the
 *                                            mesh); the room carries
 *                                            the flag so name plates
 *                                            can say "voice off"
 *     { type: "voice.signal", to, data }     WebRTC offer/answer/ice
 *                                            relay (voice members only)
 *   server → client
 *     { type: "welcome", peerId, you, peers }   on join (full snapshot)
 *     { type: "peer.join", peer } / { type: "peer.leave", peerId }
 *     { type: "peer.move", peerId, x, y, z, rotY }
 *     { type: "peer.say", peerId, body }
 *     { type: "peer.character", peerId, character }   a peer's vault
 *                                            character (or null) changed
 *     { type: "voice.joined", peerId } / { type: "voice.left", peerId }
 *     { type: "peer.voiceoff", peerId, off }    a peer's voice switch
 *                                            flipped (name plates mark
 *                                            the voice-off)
 *     { type: "voice.state", voicePeerIds }     answer to voice.join
 *     { type: "voice.signal", from, data }      relayed signaling
 *     { type: "voice.full" } / { type: "voice.denied", reason }
 *     { type: "room_full", cap } then close 4429 when at presence cap
 *
 * House rules baked in: presence cap 30 with an honest full state,
 * voice mesh cap 12 (a mesh beyond that melts phones), guests are
 * look-only (present and visible, labeled guests — no voice, no say),
 * move sync throttled to ~10/s per peer server-side so a runaway
 * client can't flood the room.
 */
import { RoomHub, WS_OPEN, type WsClientSocket } from "./live-ws";

export const WORLD_ROOM_ID = "world:kings-hall";
export const WORLD_PRESENCE_CAP = 30;
export const WORLD_VOICE_CAP = 12;
export const MOVE_MIN_INTERVAL_MS = 90;
export const SAY_MAX_CHARS = 300;
export const SAY_MIN_INTERVAL_MS = 800;
const MAX_FRAME_CHARS = 8192;

/* Hall bounds (metres) — the client builds the room to these; the
 * server clamps so a modified client can't park anyone in the walls. */
export const HALL_BOUNDS = { minX: -13.5, maxX: 13.5, minZ: -17, maxZ: 11.5 };

/** Avatar tints — gold-family and jewel tones that read on black marble.
 *  Derived from a stable key so every client paints a member the same. */
export const WORLD_TINTS = [
  "#d4af37", // house gold
  "#f0d98c", // pale gold
  "#b8860b", // dark gold
  "#7fd4c1", // jade
  "#8ab6ff", // sapphire mist
  "#e08aff", // amethyst
  "#ff9d7a", // coral
  "#a8e07a", // peridot
] as const;

export function tintForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return WORLD_TINTS[Math.abs(hash) % WORLD_TINTS.length]!;
}

export interface WorldIdentity {
  /** null = guest (look-only). */
  userId: string | null;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
}

/** A Creative Vault character a member walks in as. Resolved
 *  server-side from the vault row the member owns — the client only
 *  ever sends the character's id, never a name or image URL, so a
 *  modified client can't dress itself in someone else's character. */
export interface WorldCharacterRef {
  id: string;
  name: string;
  portraitUrl: string;
}

/** Injected by the route layer (which owns the DB): verify the
 *  character belongs to this user (or their active team) and carry a
 *  portrait; return the ref to broadcast, or null to refuse the pick. */
export type WorldCharacterResolver = (
  userId: string,
  characterId: string,
) => Promise<WorldCharacterRef | null>;

export interface WorldPeerDto {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
  tint: string;
  guest: boolean;
  voice: boolean;
  /** The member's proximity-voice switch is OFF: they can't hear
   *  voice and won't be heard — distinct from merely not having
   *  joined voice yet. Name plates mark it so nobody talks to
   *  someone who can't hear them. */
  voiceOff: boolean;
  character: WorldCharacterRef | null;
  x: number;
  y: number;
  z: number;
  rotY: number;
}

interface WorldPeer extends WorldIdentity {
  peerId: string;
  socket: WsClientSocket;
  tint: string;
  guest: boolean;
  voice: boolean;
  voiceOff: boolean;
  character: WorldCharacterRef | null;
  /** Bumped on every character pick/clear so a slow resolution can't
   *  land after a newer pick and resurrect a stale character. */
  characterSeq: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  lastMoveAt: number;
  lastSayAt: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export class WorldRoom {
  private peers = new Map<WsClientSocket, WorldPeer>();
  private byPeerId = new Map<string, WorldPeer>();
  private counter = 0;

  constructor(
    private hub: RoomHub,
    private deps: { resolveCharacter?: WorldCharacterResolver } = {},
  ) {}

  size(): number {
    return this.peers.size;
  }

  voiceSize(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.voice) n++;
    return n;
  }

  peerFor(socket: WsClientSocket): WorldPeerDto | null {
    const peer = this.peers.get(socket);
    return peer ? this.dto(peer) : null;
  }

  private dto(peer: WorldPeer): WorldPeerDto {
    return {
      peerId: peer.peerId,
      displayName: peer.displayName,
      avatarUrl: peer.avatarUrl,
      profileSlug: peer.profileSlug,
      tint: peer.tint,
      guest: peer.guest,
      voice: peer.voice,
      voiceOff: peer.voiceOff,
      character: peer.character,
      x: peer.x,
      y: peer.y,
      z: peer.z,
      rotY: peer.rotY,
    };
  }

  private send(peer: WorldPeer, payload: unknown): void {
    if (peer.socket.readyState !== WS_OPEN) return;
    try {
      peer.socket.send(JSON.stringify(payload));
    } catch {
      /* the close handler reaps it */
    }
  }

  /** Admit a socket. Returns false (after an honest room_full frame +
   *  close) when the hall is at its presence cap. */
  attach(socket: WsClientSocket, identity: WorldIdentity): boolean {
    if (this.peers.size >= WORLD_PRESENCE_CAP) {
      try {
        socket.send(JSON.stringify({ type: "room_full", cap: WORLD_PRESENCE_CAP }));
      } catch {
        /* closing anyway */
      }
      try {
        socket.close(4429, "room_full");
      } catch {
        /* already gone */
      }
      return false;
    }

    this.counter++;
    const peerId = `w${this.counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    /* Spawn in a loose arc at the hall entrance so arrivals don't stack
     * inside each other. */
    const slot = this.counter % 10;
    const peer: WorldPeer = {
      ...identity,
      peerId,
      socket,
      tint: tintForKey(identity.profileSlug ?? identity.userId ?? peerId),
      guest: identity.userId === null,
      voice: false,
      voiceOff: false,
      character: null,
      characterSeq: 0,
      x: (slot - 4.5) * 1.1,
      y: 0,
      z: 9.5,
      /* Heading convention (shared with the client): rotY 0 faces the
       * stage/screen at the front of the hall (-Z). */
      rotY: 0,
      lastMoveAt: 0,
      lastSayAt: 0,
    };
    this.peers.set(socket, peer);
    this.byPeerId.set(peerId, peer);
    this.hub.join(WORLD_ROOM_ID, socket);

    const snapshot = [...this.peers.values()]
      .filter((p) => p !== peer)
      .map((p) => this.dto(p));
    this.send(peer, { type: "welcome", peerId, you: this.dto(peer), peers: snapshot });
    // The joiner never hears its own join — `welcome` already told it
    // everything about itself; peer.join is strictly for the room.
    this.broadcastExcept(peer, { type: "peer.join", peer: this.dto(peer) });
    return true;
  }

  /** Remove a socket's peer (disconnect / error). Broadcasts the
   *  despawn; also a voice departure when they were in the mesh. */
  detach(socket: WsClientSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    this.byPeerId.delete(peer.peerId);
    this.hub.leave(WORLD_ROOM_ID, socket);
    if (peer.voice) {
      this.hub.broadcast(WORLD_ROOM_ID, { type: "voice.left", peerId: peer.peerId });
    }
    this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.leave", peerId: peer.peerId });
  }

  handleFrame(socket: WsClientSocket, raw: string, now = Date.now()): void {
    const peer = this.peers.get(socket);
    if (!peer || raw.length > MAX_FRAME_CHARS) return;
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    switch (frame["type"]) {
      case "move": {
        if (now - peer.lastMoveAt < MOVE_MIN_INTERVAL_MS) return;
        peer.lastMoveAt = now;
        peer.x = clamp(finiteOr(frame["x"], peer.x), HALL_BOUNDS.minX, HALL_BOUNDS.maxX);
        peer.z = clamp(finiteOr(frame["z"], peer.z), HALL_BOUNDS.minZ, HALL_BOUNDS.maxZ);
        peer.y = 0;
        const rot = finiteOr(frame["rotY"], peer.rotY);
        peer.rotY = Math.atan2(Math.sin(rot), Math.cos(rot));
        this.broadcastExcept(peer, {
          type: "peer.move",
          peerId: peer.peerId,
          x: peer.x,
          y: peer.y,
          z: peer.z,
          rotY: peer.rotY,
        });
        return;
      }
      case "say": {
        /* Guests are look-only: no voice, no text. The client doesn't
         * offer them a composer; this is the server-side backstop. */
        if (peer.guest) return;
        if (now - peer.lastSayAt < SAY_MIN_INTERVAL_MS) return;
        const body = typeof frame["body"] === "string" ? frame["body"].trim().slice(0, SAY_MAX_CHARS) : "";
        if (!body) return;
        peer.lastSayAt = now;
        this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.say", peerId: peer.peerId, body });
        return;
      }
      case "character": {
        /* Walk in as a Creative Vault character. Members only (guests
         * have no vault). The client sends ONLY an id; the injected
         * resolver verifies ownership against the vault and returns
         * the name + portrait to broadcast — a refused pick (not
         * theirs, no portrait, vault row gone) changes nothing, so a
         * stale pick never strips a figure already standing. */
        if (peer.guest || !peer.userId) return;
        const raw = frame["characterId"];
        if (raw === null) {
          peer.characterSeq++;
          if (peer.character) {
            peer.character = null;
            this.hub.broadcast(WORLD_ROOM_ID, {
              type: "peer.character",
              peerId: peer.peerId,
              character: null,
            });
          }
          return;
        }
        if (typeof raw !== "string" || !raw || raw.length > 64) return;
        if (peer.character?.id === raw) return;
        const resolve = this.deps.resolveCharacter;
        if (!resolve) return;
        const seq = ++peer.characterSeq;
        void resolve(peer.userId, raw)
          .then((ref) => {
            if (!ref) return; // refused — keep whatever stands
            if (this.byPeerId.get(peer.peerId) !== peer) return; // left already
            if (peer.characterSeq !== seq) return; // a newer pick won
            peer.character = ref;
            this.hub.broadcast(WORLD_ROOM_ID, {
              type: "peer.character",
              peerId: peer.peerId,
              character: ref,
            });
          })
          .catch(() => undefined);
        return;
      }
      case "voice.join": {
        if (peer.guest) {
          this.send(peer, { type: "voice.denied", reason: "guests" });
          return;
        }
        if (peer.voice) {
          this.send(peer, { type: "voice.state", voicePeerIds: this.voicePeerIds(peer) });
          return;
        }
        if (this.voiceSize() >= WORLD_VOICE_CAP) {
          this.send(peer, { type: "voice.full", cap: WORLD_VOICE_CAP });
          return;
        }
        peer.voice = true;
        this.hub.broadcast(WORLD_ROOM_ID, { type: "voice.joined", peerId: peer.peerId });
        this.send(peer, { type: "voice.state", voicePeerIds: this.voicePeerIds(peer) });
        return;
      }
      case "voice.leave": {
        if (!peer.voice) return;
        peer.voice = false;
        this.hub.broadcast(WORLD_ROOM_ID, { type: "voice.left", peerId: peer.peerId });
        return;
      }
      case "voice.off": {
        /* The proximity-voice switch. Members only — guests have no
         * voice to switch. OFF is total: out of the mesh first (the
         * room hears voice.left), then the flag lands so every name
         * plate can mark them voice-off. ON just clears the flag —
         * joining voice stays the separate, explicit act it is today,
         * so flipping the switch never starts a mic by itself. */
        if (peer.guest) return;
        const off = frame["off"] === true;
        if (off === peer.voiceOff && !peer.voice) return;
        if (off && peer.voice) {
          peer.voice = false;
          this.hub.broadcast(WORLD_ROOM_ID, { type: "voice.left", peerId: peer.peerId });
        }
        peer.voiceOff = off;
        this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.voiceoff", peerId: peer.peerId, off });
        return;
      }
      case "voice.signal": {
        /* WebRTC signaling relay: only between two voice members —
         * signaling is meaningless (and unaddressable) outside the mesh. */
        if (!peer.voice) return;
        const to = typeof frame["to"] === "string" ? frame["to"] : "";
        const target = this.byPeerId.get(to);
        if (!target || !target.voice || target === peer) return;
        const data = frame["data"];
        if (!data || typeof data !== "object") return;
        this.send(target, { type: "voice.signal", from: peer.peerId, data });
        return;
      }
      default:
        return;
    }
  }

  private voicePeerIds(except?: WorldPeer): string[] {
    const out: string[] = [];
    for (const p of this.peers.values()) {
      if (p.voice && p !== except) out.push(p.peerId);
    }
    return out;
  }

  private broadcastExcept(except: WorldPeer, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const p of this.peers.values()) {
      if (p === except) continue;
      if (p.socket.readyState !== WS_OPEN) continue;
      try {
        p.socket.send(data);
      } catch {
        /* reaped on close */
      }
    }
  }
}
