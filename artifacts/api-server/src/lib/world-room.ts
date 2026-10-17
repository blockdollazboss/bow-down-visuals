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
 *     { type: "voice.deaf", deaf }           deafen (voice modes):
 *                                            the member STAYS in the
 *                                            mesh but hears nobody and
 *                                            mutes their own mic; the
 *                                            room carries the flag so
 *                                            name plates can say
 *                                            "deafened" — a different
 *                                            mark from voice-off
 *     { type: "voice.signal", to, data }     WebRTC offer/answer/ice
 *                                            relay (voice members only)
 *     { type: "stage.live", streamId }       take the stage with my
 *                                            live stream (verified
 *                                            mine + live server-side)
 *     { type: "stage.video", videoId }        take the stage with a
 *                                            catalog video (watch
 *                                            party; id only, resolved
 *                                            + verified server-side)
 *     { type: "screen.reel" }                 holder: screen back to
 *                                            the King's Reel (stage
 *                                            stays held)
 *     { type: "screen.playpause", playing, positionSec }
 *                                            holder: shared play/pause
 *                                            for a stage video
 *     { type: "stage.end" }                   holder: release the
 *                                            stage + screen to idle
 *     { type: "admin.mute", peerId, muted }   host only: mute/unmute a
 *                                            member's voice server-side
 *     { type: "admin.remove", peerId }        host only: remove a
 *                                            person from the hall
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
 *     { type: "peer.voicedeaf", peerId, deaf }  a peer deafened (or
 *                                            lifted it) — name plates
 *                                            mark the deafened
 *     { type: "voice.state", voicePeerIds }     answer to voice.join
 *     { type: "voice.signal", from, data }      relayed signaling
 *     { type: "voice.full" } / { type: "voice.denied", reason }
 *     { type: "screen.state", screen }         the stage + screen now
 *                                            (also inside `welcome`):
 *                                            who holds the stage and
 *                                            what's playing, with the
 *                                            video's position stamped
 *     { type: "screen.denied", holderName }   someone else holds the
 *                                            stage — one hand only
 *     { type: "peer.hostmute", peerId, muted }  the host muted/unmuted
 *                                            a member's voice
 *     { type: "admin.denied" }                a host action attempted
 *                                            by a non-host
 *     { type: "removed", reason } then close 4413 — the host removed
 *                                            this peer from the hall
 *     { type: "room_full", cap } then close 4429 when at presence cap
 *
 * House rules baked in: presence cap 30 with an honest full state,
 * voice mesh cap 12 (a mesh beyond that melts phones), guests are
 * look-only (present and visible, labeled guests — no voice, no say),
 * move sync throttled to ~10/s per peer server-side so a runaway
 * client can't flood the room.
 *
 * The stage + the big screen are one authority: whoever holds the
 * stage holds the screen — one hand, no fighting. A stage holder is
 * a member whose live stream or catalog video the room verified;
 * when they leave, the stage releases and the screen falls back to
 * the King's Reel. The host (an admin identity, resolved server-
 * side at the door — never a client claim) outranks the holder at
 * all times: instant takeover, screen override, ending a show,
 * muting a voice, removing a person.
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
  /** Host authority, resolved by the route layer from the site's
   *  admin identity (ADMIN_EMAILS) at the handshake — a client can
   *  never claim it, and a guest is never an admin. */
  admin?: boolean;
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

/** A member's own live stream, verified at stage-claim time: the row
 *  is theirs and truly live. Title/name/slug title the screen. */
export interface WorldStageLiveRef {
  streamId: string;
  title: string;
  performerName: string;
  performerSlug: string | null;
}

/** Injected by the route layer: verify a stage claim names the
 *  member's OWN live stream; return its ref, or null to refuse. */
export type WorldStageStreamResolver = (
  userId: string,
  streamId: string,
) => Promise<WorldStageLiveRef | null>;

/** A catalog video the big screen can play: a platform video or a
 *  stream replay, resolved from an id the client picked from the
 *  catalog — never a URL the client supplied. */
export interface WorldScreenVideoRef {
  id: string;
  title: string;
  url: string;
  mediaKind: "file" | "hls";
  creatorName: string | null;
}

/** Injected by the route layer: verify a screen-video pick is a real
 *  playable platform video (the member's own, or public); return the
 *  ref to broadcast, or null to refuse. */
export type WorldScreenVideoResolver = (
  userId: string,
  videoId: string,
) => Promise<WorldScreenVideoRef | null>;

/** What's on the big screen while a stage is held. ("reel" with a
 *  holder = the holder parked the screen on the King's Reel without
 *  giving the stage up.) */
export type WorldScreenContent =
  | { kind: "reel" }
  | { kind: "live"; streamId: string; title: string }
  | {
      kind: "video";
      video: WorldScreenVideoRef;
      /** Server-stamped playback anchor: the position (seconds) at
       *  anchorAtMs; while playing, everyone derives the current
       *  position from the same stamp — approximate sync by design. */
      playback: { playing: boolean; anchorPosSec: number; anchorAtMs: number };
    };

/** The screen state every client renders from — sent in `welcome`
 *  and broadcast as `screen.state` on every change. */
export interface WorldScreenBroadcast {
  mode: "reel" | "live" | "video";
  holder: { peerId: string; name: string; slug: string | null } | null;
  title: string | null;
  streamId: string | null;
  video: WorldScreenVideoRef | null;
  /** For video mode: playing + the position right now (computed
   *  from the anchor at broadcast time). */
  playback: { playing: boolean; positionSec: number } | null;
  /** A one-off honest note riding this one broadcast (a takeover,
   *  a show ending) — null on plain state syncs. */
  notice: string | null;
}

/** Where a stage video is right now, from its server anchor. */
export function screenPositionAt(content: WorldScreenContent, nowMs: number): number {
  if (content.kind !== "video") return 0;
  const pb = content.playback;
  if (!pb.playing) return pb.anchorPosSec;
  return Math.max(0, pb.anchorPosSec + (nowMs - pb.anchorAtMs) / 1000);
}

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
  /** Deafened (the voice modes' Deafen): still in the mesh, hearing
   *  nobody, own mic muted — distinct from voiceOff (fully out).
   *  Name plates mark it so silence isn't read as ignoring. */
  voiceDeaf: boolean;
  /** Host authority (resolved at the door; guests never). */
  admin: boolean;
  /** The host muted this member's voice server-side: out of the
   *  mesh, and voice.join is refused until the host unmutes. */
  hostMuted: boolean;
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
  voiceDeaf: boolean;
  admin: boolean;
  hostMuted: boolean;
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

/** Close code when the host removes a peer (private-use range, the
 *  same family as room_full's 4429): the client shows its honest
 *  "removed by the host" card for it. */
export const WORLD_REMOVED_CLOSE_CODE = 4413;

interface StageHolder {
  peerId: string;
  userId: string;
  name: string;
  slug: string | null;
}

export class WorldRoom {
  private peers = new Map<WsClientSocket, WorldPeer>();
  private byPeerId = new Map<string, WorldPeer>();
  private counter = 0;
  /** The stage: one holder, and the screen is theirs. Null = the
   *  stage is free and the screen runs its ambient programming. */
  private stageHolder: StageHolder | null = null;
  private screenContent: WorldScreenContent = { kind: "reel" };
  /** Bumped on every stage claim so a slow verification can't land
   *  after a newer claim (or a release) and resurrect a dead show. */
  private stageSeq = 0;

  constructor(
    private hub: RoomHub,
    private deps: {
      resolveCharacter?: WorldCharacterResolver;
      resolveStageStream?: WorldStageStreamResolver;
      resolveScreenVideo?: WorldScreenVideoResolver;
    } = {},
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
      voiceDeaf: peer.voiceDeaf,
      admin: peer.admin,
      hostMuted: peer.hostMuted,
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
      voiceDeaf: false,
      admin: identity.userId !== null && identity.admin === true,
      hostMuted: false,
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
    this.send(peer, {
      type: "welcome",
      peerId,
      you: this.dto(peer),
      peers: snapshot,
      // Late joiners land on the right screen: the stage as it stands.
      screen: this.screenBroadcast(),
    });
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
    /* No orphaned stage: the holder leaving ends the show and the
     * screen falls back to the Reel for everyone still inside. */
    if (this.stageHolder?.peerId === peer.peerId) {
      this.stageHolder = null;
      this.screenContent = { kind: "reel" };
      this.stageSeq++;
      this.hub.broadcast(WORLD_ROOM_ID, {
        type: "screen.state",
        screen: this.screenBroadcast(`${peer.displayName}'s show has ended.`),
      });
    }
    this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.leave", peerId: peer.peerId });
  }

  /* ── The stage + screen ─────────────────────────────────────────── */

  /** The screen state as every client renders it, right now. */
  screenBroadcast(notice: string | null = null, now = Date.now()): WorldScreenBroadcast {
    const holder = this.stageHolder
      ? { peerId: this.stageHolder.peerId, name: this.stageHolder.name, slug: this.stageHolder.slug }
      : null;
    const content = this.screenContent;
    if (!holder || content.kind === "reel") {
      return { mode: "reel", holder, title: null, streamId: null, video: null, playback: null, notice };
    }
    if (content.kind === "live") {
      return {
        mode: "live",
        holder,
        title: content.title,
        streamId: content.streamId,
        video: null,
        playback: null,
        notice,
      };
    }
    return {
      mode: "video",
      holder,
      title: content.video.title,
      streamId: null,
      video: content.video,
      playback: { playing: content.playback.playing, positionSec: screenPositionAt(content, now) },
      notice,
    };
  }

  /** The stream the screen should prefer, when the stage is live. */
  stageStreamId(): string | null {
    return this.stageHolder && this.screenContent.kind === "live" ? this.screenContent.streamId : null;
  }

  /** The stage's video content, when a watch party is on the screen. */
  stageVideo(): { video: WorldScreenVideoRef; positionSec: number; playing: boolean } | null {
    if (!this.stageHolder || this.screenContent.kind !== "video") return null;
    return {
      video: this.screenContent.video,
      positionSec: screenPositionAt(this.screenContent, Date.now()),
      playing: this.screenContent.playback.playing,
    };
  }

  private broadcastScreen(notice: string | null = null): void {
    this.hub.broadcast(WORLD_ROOM_ID, { type: "screen.state", screen: this.screenBroadcast(notice) });
  }

  /** Who may drive the screen: its holder — or the host, always. */
  private canControlScreen(peer: WorldPeer): boolean {
    return peer.admin || (this.stageHolder !== null && this.stageHolder.peerId === peer.peerId);
  }

  private denyScreen(peer: WorldPeer): void {
    this.send(peer, {
      type: "screen.denied",
      holderName: this.stageHolder?.name ?? null,
    });
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
        if (peer.hostMuted) {
          /* The host's mute is server-side: no client setting can
           * talk its way back into the mesh. */
          this.send(peer, { type: "voice.denied", reason: "host" });
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
        if (off && peer.voiceDeaf) {
          /* Voice-off outranks deafen: the deafened mark clears on
           * the way out, so the plate tells the one story that
           * matters — this peer is out of voice entirely. */
          peer.voiceDeaf = false;
          this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.voicedeaf", peerId: peer.peerId, deaf: false });
        }
        peer.voiceOff = off;
        this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.voiceoff", peerId: peer.peerId, off });
        return;
      }
      case "voice.deaf": {
        /* Deafen (the voice modes). Members only — guests have no
         * voice to deafen. Unlike the switch, deafen does NOT leave
         * the mesh: the peer stays in voice (their client zeroes its
         * receive gains and mutes its mic track); the server's whole
         * job is the flag, so every name plate can say "deafened".
         * No voice.left, no voice.state change — membership is
         * untouched, and lifting it is just the flag flipping back. */
        if (peer.guest) return;
        const deaf = frame["deaf"] === true;
        if (deaf === peer.voiceDeaf) return;
        peer.voiceDeaf = deaf;
        this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.voicedeaf", peerId: peer.peerId, deaf });
        return;
      }
      case "stage.live": {
        /* Take the stage with my live stream. The id is all the
         * client sends — the injected resolver verifies the stream
         * is mine and truly live before anything reaches a screen. */
        if (peer.guest || !peer.userId) return;
        const streamId = typeof frame["streamId"] === "string" ? frame["streamId"] : "";
        if (!streamId || streamId.length > 64) return;
        const resolveStream = this.deps.resolveStageStream;
        if (!resolveStream) return;
        const userId = peer.userId;
        this.claimStage(peer, () =>
          resolveStream(userId, streamId).then((ref) =>
            ref
              ? {
                  content: { kind: "live", streamId: ref.streamId, title: ref.title } as WorldScreenContent,
                  name: ref.performerName,
                  slug: ref.performerSlug,
                }
              : null,
          ),
        );
        return;
      }
      case "stage.video": {
        /* Take the stage with a catalog video — a watch party. Same
         * id-only rule: the resolver verifies the pick is a real,
         * playable platform video (mine, or public). */
        if (peer.guest || !peer.userId) return;
        const videoId = typeof frame["videoId"] === "string" ? frame["videoId"] : "";
        if (!videoId || videoId.length > 96) return;
        const resolveVideo = this.deps.resolveScreenVideo;
        if (!resolveVideo) return;
        const userId = peer.userId;
        this.claimStage(peer, () =>
          resolveVideo(userId, videoId).then((ref) =>
            ref
              ? {
                  content: {
                    kind: "video",
                    video: ref,
                    playback: { playing: true, anchorPosSec: 0, anchorAtMs: now },
                  } as WorldScreenContent,
                  name: peer.displayName,
                  slug: peer.profileSlug,
                }
              : null,
          ),
        );
        return;
      }
      case "screen.reel": {
        /* The holder parks the screen on the King's Reel (the stage
         * itself stays held); the host can always do it too. */
        if (!this.canControlScreen(peer)) {
          this.denyScreen(peer);
          return;
        }
        if (this.screenContent.kind !== "reel") {
          this.screenContent = { kind: "reel" };
          this.broadcastScreen();
        }
        return;
      }
      case "screen.playpause": {
        /* Shared play/pause for a stage video: the holder (or host)
         * re-anchors the server stamp and everyone re-derives their
         * position from it — approximate sync, honestly labeled. */
        if (!this.canControlScreen(peer)) {
          this.denyScreen(peer);
          return;
        }
        if (this.screenContent.kind !== "video") return;
        const playing = frame["playing"] === true;
        const pos = finiteOr(frame["positionSec"], screenPositionAt(this.screenContent, now));
        this.screenContent = {
          ...this.screenContent,
          playback: {
            playing,
            anchorPosSec: clamp(pos, 0, 86400),
            anchorAtMs: now,
          },
        };
        this.broadcastScreen();
        return;
      }
      case "stage.end": {
        /* Release: the show is over, the screen falls back to the
         * Reel, the stage is free for the next creator. */
        if (!this.stageHolder) return;
        if (!this.canControlScreen(peer)) {
          this.denyScreen(peer);
          return;
        }
        const wasMine = this.stageHolder.peerId === peer.peerId;
        this.stageHolder = null;
        this.screenContent = { kind: "reel" };
        this.stageSeq++;
        this.broadcastScreen(wasMine ? null : "The host ended the show.");
        return;
      }
      case "admin.mute": {
        /* Host-only room mute. Server-side state: the member is out
         * of the mesh now and voice.join refuses them until the
         * host lifts it. Everyone is told (plates + their client). */
        if (!peer.admin) {
          this.send(peer, { type: "admin.denied" });
          return;
        }
        const target = this.byPeerId.get(typeof frame["peerId"] === "string" ? frame["peerId"] : "");
        if (!target || target === peer) return;
        const muted = frame["muted"] === true;
        if (target.hostMuted === muted) return;
        target.hostMuted = muted;
        if (muted && target.voice) {
          target.voice = false;
          this.hub.broadcast(WORLD_ROOM_ID, { type: "voice.left", peerId: target.peerId });
        }
        this.hub.broadcast(WORLD_ROOM_ID, { type: "peer.hostmute", peerId: target.peerId, muted });
        return;
      }
      case "admin.remove": {
        /* Host-only removal: the honest card first (`removed`),
         * then the despawn, then the close — the same pattern as
         * room_full, with its own close code. */
        if (!peer.admin) {
          this.send(peer, { type: "admin.denied" });
          return;
        }
        const target = this.byPeerId.get(typeof frame["peerId"] === "string" ? frame["peerId"] : "");
        if (!target || target === peer) return;
        this.send(target, { type: "removed", reason: "host" });
        const socket = target.socket;
        this.detach(socket);
        try {
          socket.close(WORLD_REMOVED_CLOSE_CODE, "removed_by_host");
        } catch {
          /* already gone */
        }
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

  /** Verify-then-set for stage claims. Authority is checked before
   *  the async verification runs and again when it lands — the stage
   *  must still be free, the claimant's, or host-takeable at that
   *  moment, and the claimant must still be in the room. A refused
   *  verification changes nothing: whatever is playing keeps
   *  playing. */
  private claimStage(
    peer: WorldPeer,
    resolve: () => Promise<{ content: WorldScreenContent; name: string; slug: string | null } | null>,
  ): void {
    if (this.stageHolder && this.stageHolder.peerId !== peer.peerId && !peer.admin) {
      this.denyScreen(peer);
      return;
    }
    const seq = ++this.stageSeq;
    void resolve()
      .then((resolved) => {
        if (!resolved) return;
        if (this.byPeerId.get(peer.peerId) !== peer) return;
        if (this.stageSeq !== seq) return;
        if (this.stageHolder && this.stageHolder.peerId !== peer.peerId && !peer.admin) return;
        const takeover =
          this.stageHolder !== null && this.stageHolder.peerId !== peer.peerId;
        this.stageHolder = {
          peerId: peer.peerId,
          userId: peer.userId!,
          name: resolved.name,
          slug: resolved.slug,
        };
        this.screenContent = resolved.content;
        this.broadcastScreen(takeover ? "The host took the stage." : null);
      })
      .catch(() => undefined);
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
