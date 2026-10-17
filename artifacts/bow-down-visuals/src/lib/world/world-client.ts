/**
 * world-client.ts — The World's presence client: the palace socket
 * brain. Framework-free (the React page is a thin shell) so the whole
 * protocol behaviour is unit-tested in node with fake sockets.
 *
 * Protocol mirrors lib/world-room.ts + lib/world-palace.ts on the
 * server:
 *   out: move (throttled to ~10/s here AND on the server), say,
 *        action (perform an avatar action — the shared id set in
 *        actions.ts; the server relays it to the room), character
 *        (walk in as a Creative Vault character — id only, the
 *        server verifies ownership and resolves the portrait),
 *        voice.join / voice.leave, voice.off (the proximity-voice
 *        switch — off means no sending, no hearing, mic released),
 *        voice.deaf (deafen — still in the mesh, hearing nobody,
 *        mic muted), voice.signal, room.enter (walked through a
 *        doorway — the registry transfers this peer to that room)
 *   in:  welcome (room + self + snapshot), palace.directory,
 *        room.unavailable, peer.join / peer.move / peer.leave,
 *        peer.action,
 *        peer.say, peer.character, peer.voiceoff, peer.voicedeaf,
 *        voice.joined / voice.left / voice.state / voice.signal /
 *        voice.full / voice.denied, room_full
 *
 * Presence is room-scoped: this client only ever holds the room it
 * stands in. A doorway transfer arrives as a FRESH welcome (same
 * peerId, new room, new snapshot) — onRoomChanged fires so the page
 * can tear the old room's voice session down (the mesh is the
 * room's; it never crosses a doorway).
 * Guests (no session token, or a stale one the server couldn't verify)
 * arrive as guest peers: present and visible, no voice, no say — the
 * client hides those controls off `self.guest`, the server enforces it.
 */

/** A Creative Vault character standing in the hall — resolved and
 *  ownership-verified by the server; clients never invent these. */
export interface WorldCharacterRef {
  id: string;
  name: string;
  portraitUrl: string;
}

export type { WorldActionId } from "./actions";
import type { WorldActionId } from "./actions";

export interface WorldPeer {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
  tint: string;
  guest: boolean;
  voice: boolean;
  /** Proximity voice switched OFF for this peer: they neither send
   *  nor hear voice. Distinct from `voice` (in the mesh right now) —
   *  name plates mark the voice-off so nobody talks to a peer who
   *  can't hear them. */
  voiceOff: boolean;
  /** Deafened (the voice modes' Deafen): in the mesh but hearing
   *  nobody, mic muted — distinct from `voiceOff` (fully out, mic
   *  released); name plates mark the deafened so nobody mistakes
   *  silence for ignoring. */
  voiceDeaf: boolean;
  /** Host authority, resolved by the server at the door (never a
   *  client claim) — the hall shows host controls off this flag,
   *  and the server re-verifies every host action anyway. */
  admin: boolean;
  /** The host muted this peer's voice server-side. */
  hostMuted: boolean;
  character: WorldCharacterRef | null;
  /** The avatar action this presence is performing (toggles ride
   *  the snapshot, so walking into a room mid-dance shows the
   *  dance already in progress). */
  action: WorldActionId | null;
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export type WorldStatus = "connecting" | "inside" | "full" | "error" | "closed" | "removed";

/** The room this client stands in, as the server named it. */
export interface PalaceRoomInfo {
  id: string;
  name: string;
}

/** One row of the palace directory: a room, its headcount, who's
 *  inside (display names, server-capped), and whether a show holds
 *  the hall's stage. */
export interface PalaceDirectoryEntry {
  id: string;
  name: string;
  count: number;
  members: string[];
  live: boolean;
}

/** The hall's id — the palace's front door and its one stage room. */
export const HALL_ROOM_ID = "world:kings-hall";

/** The stage + big-screen state, mirrored from the room: who holds
 *  the stage, what's playing, and (for a watch-party video) the
 *  shared playback position the server last stamped. */
export interface WorldScreenState {
  mode: "reel" | "live" | "video";
  holder: { peerId: string; name: string; slug: string | null } | null;
  title: string | null;
  streamId: string | null;
  video: {
    id: string;
    title: string;
    url: string;
    mediaKind: "file" | "hls";
    creatorName: string | null;
  } | null;
  playback: { playing: boolean; positionSec: number } | null;
  notice: string | null;
}

export interface WorldSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface WorldClientDeps {
  /** Session access token for the handshake (null = guest visit). */
  getAccessToken: () => Promise<string | null>;
  /** Build the socket URL for this token (null token = no query param). */
  socketUrl: (token: string | null) => string;
  /** Open a socket (WebSocket in the browser; fakes in tests). */
  openSocket: (url: string) => WorldSocketLike;
  now?: () => number;
}

export interface WorldSayEvent {
  peerId: string;
  displayName: string;
  body: string;
}

export type VoiceNotice = "full" | "denied-guest" | "denied-host";

const MOVE_SEND_INTERVAL_MS = 100; // ~10/s, matching the server throttle

export function defaultWorldSocketUrl(loc: { protocol: string; host: string }, token: string | null): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${loc.host}/api/world/ws${q}`;
}

/** The page overlay for a client status — null means "you're inside,
 *  no overlay". Error and full are honest dead-ends with their own
 *  cards; closed (deliberate leave) shows nothing. */
export function worldOverlay(status: WorldStatus): "connecting" | "room-full" | "error" | "removed" | null {
  switch (status) {
    case "connecting":
      return "connecting";
    case "full":
      return "room-full";
    case "error":
      return "error";
    case "removed":
      return "removed";
    default:
      return null;
  }
}

export class WorldClient {
  status: WorldStatus = "connecting";
  self: WorldPeer | null = null;
  peers = new Map<string, WorldPeer>();
  voicePeerIds = new Set<string>();
  /** The stage + screen, as the room last stated it (welcome, then
   *  every `screen.state`). Null until the welcome lands. Only the
   *  hall carries screen state — a transfer welcome from another
   *  room omits it and the hall's last state stands. */
  screen: WorldScreenState | null = null;
  /** The room this client stands in (set by every welcome). */
  room: PalaceRoomInfo | null = null;
  /** The palace directory — who's where — as last broadcast (and
   *  re-sent inside every transfer). Empty until the first frame. */
  directory: PalaceDirectoryEntry[] = [];

  /* Assignable handlers — the page wires scene + voice + chat log. */
  onStatus: ((status: WorldStatus) => void) | null = null;
  onPeerJoin: ((peer: WorldPeer) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;
  /** A peer started (or stopped) an avatar action — the scene
   *  performs it on their figure. */
  onPeerAction: ((peerId: string, action: WorldActionId | null) => void) | null = null;
  onPeerCharacter: ((peerId: string, character: WorldCharacterRef | null) => void) | null = null;
  onPeerVoiceOff: ((peerId: string, off: boolean) => void) | null = null;
  onPeerVoiceDeaf: ((peerId: string, deaf: boolean) => void) | null = null;
  onSay: ((ev: WorldSayEvent) => void) | null = null;
  onSignal: ((from: string, data: unknown) => void) | null = null;
  onVoiceState: ((voicePeerIds: string[]) => void) | null = null;
  onVoicePeerJoined: ((peerId: string) => void) | null = null;
  onVoicePeerLeft: ((peerId: string) => void) | null = null;
  onVoiceNotice: ((notice: VoiceNotice) => void) | null = null;
  onScreen: ((screen: WorldScreenState) => void) | null = null;
  /** A screen action was refused: someone else holds the stage. */
  onScreenDenied: ((holderName: string | null) => void) | null = null;
  /** The host muted/unmuted ME (self only) — the page shows the
   *  honest notice and keeps me out of voice while it stands. */
  onHostMuted: ((muted: boolean) => void) | null = null;
  /** The palace directory changed (someone walked through a door,
   *  in or out of the palace, or a show took the stage). */
  onDirectory: ((rooms: PalaceDirectoryEntry[]) => void) | null = null;
  /** I walked through a doorway: a fresh welcome re-homed this
   *  client. The page resets the scene's room and tears down the
   *  old room's voice session in answer. */
  onRoomChanged: ((room: PalaceRoomInfo) => void) | null = null;
  /** A doorway transfer was refused: the destination is at its
   *  presence cap. I never left the room I'm in. */
  onRoomUnavailable: ((info: { roomId: string; name: string; cap: number }) => void) | null = null;

  private socket: WorldSocketLike | null = null;
  private lastMoveSentAt = 0;
  /** The vault character this client wants to stand as. `undefined` =
   *  never chosen this session (send nothing); a string id or null
   *  (house avatar) is (re)sent the moment we're inside. */
  private characterWanted: string | null | undefined = undefined;
  /** The voice switch as this client wants it. `undefined` = never
   *  touched (the room default: voice available); a boolean is (re)sent
   *  the moment we're inside, like a character pick. */
  private voiceOffWanted: boolean | undefined = undefined;
  /** Deafen, as this client wants it. Same want discipline as the
   *  voice switch: remembered pre-welcome, (re)sent on entry. */
  private voiceDeafWanted: boolean | undefined = undefined;
  private readonly now: () => number;

  constructor(private deps: WorldClientDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  get isGuest(): boolean {
    return this.self?.guest ?? true;
  }

  get inVoice(): boolean {
    return !!this.self && this.voicePeerIds.has(this.self.peerId);
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");
    let token: string | null = null;
    try {
      token = await this.deps.getAccessToken();
    } catch {
      token = null; // a token hiccup downgrades to guest, never blocks the door
    }
    const socket = this.deps.openSocket(this.deps.socketUrl(token));
    this.socket = socket;
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = (ev) => {
      if (this.status === "full" || this.status === "removed") return; // already explained itself
      if (this.status === "inside" || this.status === "connecting") {
        this.setStatus(ev.code === 1000 || ev.code === 1005 ? "closed" : "error");
      }
    };
    socket.onerror = () => {
      if (this.status === "connecting") this.setStatus("error");
    };
  }

  disconnect(): void {
    this.setStatus("closed");
    try {
      this.socket?.close();
    } catch {
      /* already gone */
    }
    this.socket = null;
    this.peers.clear();
    this.voicePeerIds.clear();
    this.self = null;
    this.room = null;
  }

  /** Perform an avatar action (or stop one with null). Everyone
   *  present performs — guests too: an action is presence, not
   *  speech. The page resolves a toggle press to the state it
   *  wants (pressing Dance while dancing sends null), so this is a
   *  plain setter: the scene performs my own action optimistically
   *  from the same call, and the room relays it to everyone else. */
  performAction(action: WorldActionId | null): void {
    if (this.status !== "inside" || !this.self) return;
    this.self.action = action;
    this.send({ type: "action", action });
  }

  /** Walk through a doorway into another palace room. `at` is the
   *  crossing point (the scene's own position as it crossed the
   *  plane) — the server clamps it into the destination and lands
   *  me there; without it I arrive at the room's spawn. The answer
   *  is a fresh welcome (onRoomChanged) or a refusal
   *  (onRoomUnavailable — a full room; I stay where I stand). */
  enterRoom(roomId: string, at?: { x: number; z: number; rotY: number }): void {
    if (this.status !== "inside" || !this.self) return;
    if (this.room?.id === roomId) return;
    this.send({ type: "room.enter", roomId, x: at?.x, z: at?.z, rotY: at?.rotY });
  }

  /** Position sync — throttled; the latest pose always wins the next
   *  window, so a fast turn never gets stuck a beat behind. */
  sendMove(x: number, z: number, rotY: number): void {
    if (this.status !== "inside" || !this.socket) return;
    const t = this.now();
    if (t - this.lastMoveSentAt < MOVE_SEND_INTERVAL_MS) return;
    this.lastMoveSentAt = t;
    this.send({ type: "move", x, y: 0, z, rotY });
  }

  /** Room text. Returns false without sending when it can't land
   *  (guest, not inside, empty) so the composer can stay honest. */
  say(body: string): boolean {
    if (this.status !== "inside" || this.isGuest) return false;
    const trimmed = body.trim();
    if (!trimmed) return false;
    this.send({ type: "say", body: trimmed });
    return true;
  }

  /** Walk in as a Creative Vault character (or back to the house
   *  avatar with null). Only the id crosses the wire — the server
   *  verifies ownership and resolves the portrait, then broadcasts
   *  the ref the whole hall renders. Safe to call before the welcome
   *  lands: the want is remembered and sent on entry. Guests' picks
   *  are never sent (the server would refuse them anyway). */
  setCharacter(characterId: string | null): void {
    this.characterWanted = characterId;
    if (this.status !== "inside" || !this.self || this.self.guest) return;
    this.send({ type: "character", characterId });
  }

  /** Flip the proximity-voice switch. OFF is announced to the room
   *  (the server drops us out of the mesh and flags the name plate);
   *  the page pairs it with releasing the mic. Safe to call before
   *  the welcome lands — the want is remembered and sent on entry.
   *  Guests never send it: they have no voice to switch. */
  setVoiceOff(off: boolean): void {
    this.voiceOffWanted = off;
    if (this.status !== "inside" || !this.self || this.self.guest) return;
    this.send({ type: "voice.off", off });
  }

  /** Deafen (or lift it). Announced to the room so name plates can
   *  mark the deafened; unlike the switch, it never touches the
   *  mesh membership — the gains and the mic mute are the page's
   *  side of the same act. Safe before the welcome lands; guests
   *  never send it. */
  setVoiceDeaf(deaf: boolean): void {
    this.voiceDeafWanted = deaf;
    if (this.status !== "inside" || !this.self || this.self.guest) return;
    this.send({ type: "voice.deaf", deaf });
  }

  joinVoice(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "voice.join" });
  }

  /* ── The stage + screen ───────────────────────────────────────────
   * One hand on the screen: the room enforces holder-or-host on every
   * one of these; the sends here are plain intents. */

  /** Take the stage with my live stream (id only — the server
   *  verifies it's mine and truly live). */
  takeStageLive(streamId: string): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "stage.live", streamId });
  }

  /** Take the stage with a catalog video — a watch party. */
  playStageVideo(videoId: string): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "stage.video", videoId });
  }

  /** Park the screen on the King's Reel (the stage stays held). */
  screenReel(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "screen.reel" });
  }

  /** Shared play/pause for the stage video, stamped by the server. */
  screenPlayPause(playing: boolean, positionSec: number): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "screen.playpause", playing, positionSec });
  }

  /** End the show: release the stage + screen back to idle. */
  endStage(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "stage.end" });
  }

  /* ── Host actions (the server re-verifies admin on every one) ── */

  adminMute(peerId: string, muted: boolean): void {
    if (this.status !== "inside" || !this.self?.admin) return;
    this.send({ type: "admin.mute", peerId, muted });
  }

  adminRemove(peerId: string): void {
    if (this.status !== "inside" || !this.self?.admin) return;
    this.send({ type: "admin.remove", peerId });
  }

  leaveVoice(): void {
    this.send({ type: "voice.leave" });
  }

  sendSignal(to: string, data: unknown): void {
    this.send({ type: "voice.signal", to, data });
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      /* a dying socket surfaces via onclose */
    }
  }

  private setStatus(status: WorldStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  private handleFrame(data: unknown): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = typeof data === "string" ? JSON.parse(data) : null;
      if (!parsed || typeof parsed !== "object") return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    switch (frame["type"]) {
      case "room_full": {
        this.setStatus("full");
        return;
      }
      case "welcome": {
        const you = frame["you"] as WorldPeer;
        const wasInside = this.status === "inside";
        const prevRoomId = this.room?.id ?? null;
        const roomFrame = frame["room"] as { id?: unknown; name?: unknown } | undefined;
        this.room = {
          id: typeof roomFrame?.id === "string" ? roomFrame.id : HALL_ROOM_ID,
          name: typeof roomFrame?.name === "string" ? roomFrame.name : "The King's Hall",
        };
        this.self = you;
        if (frame["screen"] && typeof frame["screen"] === "object") {
          this.screen = frame["screen"] as WorldScreenState;
        }
        this.peers.clear();
        /* A transfer welcome starts a new room's voice world: the
         * old mesh membership is gone with the old room. */
        this.voicePeerIds.clear();
        const snapshot = Array.isArray(frame["peers"]) ? (frame["peers"] as WorldPeer[]) : [];
        for (const peer of snapshot) {
          this.peers.set(peer.peerId, peer);
          if (peer.voice) this.voicePeerIds.add(peer.peerId);
        }
        this.setStatus("inside");
        // A pick made before the door opened applies on entry.
        if (this.characterWanted !== undefined && !you.guest) {
          this.send({ type: "character", characterId: this.characterWanted });
        }
        // So does a voice switch flipped before the door opened.
        if (this.voiceOffWanted !== undefined && !you.guest) {
          this.send({ type: "voice.off", off: this.voiceOffWanted });
        }
        // And a deafen chosen before the door opened.
        if (this.voiceDeafWanted !== undefined && !you.guest) {
          this.send({ type: "voice.deaf", deaf: this.voiceDeafWanted });
        }
        // A doorway transfer re-homes the page (scene room, voice
        // teardown) — only when the room actually changed.
        if (wasInside && prevRoomId !== this.room.id) {
          this.onRoomChanged?.(this.room);
        }
        return;
      }
      case "palace.directory": {
        const rooms = Array.isArray(frame["rooms"]) ? (frame["rooms"] as PalaceDirectoryEntry[]) : [];
        this.directory = rooms;
        this.onDirectory?.(rooms);
        return;
      }
      case "room.unavailable": {
        this.onRoomUnavailable?.({
          roomId: String(frame["roomId"] ?? ""),
          name: typeof frame["name"] === "string" ? frame["name"] : "That room",
          cap: typeof frame["cap"] === "number" ? frame["cap"] : 30,
        });
        return;
      }
      case "peer.character": {
        const peerId = String(frame["peerId"]);
        const raw = frame["character"];
        const character =
          raw && typeof raw === "object" &&
          typeof (raw as WorldCharacterRef).id === "string" &&
          typeof (raw as WorldCharacterRef).portraitUrl === "string"
            ? (raw as WorldCharacterRef)
            : null;
        const target = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
        if (target) target.character = character;
        this.onPeerCharacter?.(peerId, character);
        return;
      }
      case "peer.voiceoff": {
        const peerId = String(frame["peerId"]);
        const off = frame["off"] === true;
        const target = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
        if (target) target.voiceOff = off;
        this.onPeerVoiceOff?.(peerId, off);
        return;
      }
      case "peer.voicedeaf": {
        const peerId = String(frame["peerId"]);
        const deaf = frame["deaf"] === true;
        const target = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
        if (target) target.voiceDeaf = deaf;
        this.onPeerVoiceDeaf?.(peerId, deaf);
        return;
      }
      case "peer.join": {
        const peer = frame["peer"] as WorldPeer;
        if (!peer || peer.peerId === this.self?.peerId) return;
        this.peers.set(peer.peerId, peer);
        this.onPeerJoin?.(peer);
        return;
      }
      case "peer.action": {
        const peerId = String(frame["peerId"]);
        const raw = frame["action"];
        const action = typeof raw === "string" ? (raw as WorldActionId) : null;
        const target = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
        if (target) target.action = action;
        this.onPeerAction?.(peerId, action);
        return;
      }
      case "peer.move": {
        const peer = this.peers.get(String(frame["peerId"]));
        if (!peer) return;
        peer.x = Number(frame["x"] ?? peer.x);
        peer.y = Number(frame["y"] ?? peer.y);
        peer.z = Number(frame["z"] ?? peer.z);
        peer.rotY = Number(frame["rotY"] ?? peer.rotY);
        return;
      }
      case "peer.leave": {
        const peerId = String(frame["peerId"]);
        this.peers.delete(peerId);
        if (this.voicePeerIds.delete(peerId)) this.onVoicePeerLeft?.(peerId);
        this.onPeerLeave?.(peerId);
        return;
      }
      case "peer.say": {
        const peerId = String(frame["peerId"]);
        const author = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
        this.onSay?.({
          peerId,
          displayName: author?.displayName ?? "Someone in the hall",
          body: String(frame["body"] ?? ""),
        });
        return;
      }
      case "voice.joined": {
        const peerId = String(frame["peerId"]);
        this.voicePeerIds.add(peerId);
        const peer = this.peers.get(peerId);
        if (peer) peer.voice = true;
        if (this.self && peerId === this.self.peerId) this.self.voice = true;
        this.onVoicePeerJoined?.(peerId);
        return;
      }
      case "voice.left": {
        const peerId = String(frame["peerId"]);
        this.voicePeerIds.delete(peerId);
        const peer = this.peers.get(peerId);
        if (peer) peer.voice = false;
        if (this.self && peerId === this.self.peerId) this.self.voice = false;
        this.onVoicePeerLeft?.(peerId);
        return;
      }
      case "voice.state": {
        const ids = Array.isArray(frame["voicePeerIds"]) ? (frame["voicePeerIds"] as string[]) : [];
        if (this.self) this.voicePeerIds.add(this.self.peerId);
        this.onVoiceState?.(ids);
        return;
      }
      case "voice.signal": {
        this.onSignal?.(String(frame["from"]), frame["data"]);
        return;
      }
      case "voice.full": {
        this.onVoiceNotice?.("full");
        return;
      }
      case "voice.denied": {
        this.onVoiceNotice?.(frame["reason"] === "host" ? "denied-host" : "denied-guest");
        return;
      }
      case "screen.state": {
        if (frame["screen"] && typeof frame["screen"] === "object") {
          this.screen = frame["screen"] as WorldScreenState;
          this.onScreen?.(this.screen);
        }
        return;
      }
      case "screen.denied": {
        this.onScreenDenied?.(
          typeof frame["holderName"] === "string" ? frame["holderName"] : null,
        );
        return;
      }
      case "peer.hostmute": {
        const peerId = String(frame["peerId"]);
        const muted = frame["muted"] === true;
        const target = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
        if (target) target.hostMuted = muted;
        if (this.self && peerId === this.self.peerId) this.onHostMuted?.(muted);
        return;
      }
      case "removed": {
        /* The host removed me: the socket close follows immediately;
         * the status (and its honest card) must survive it. */
        this.setStatus("removed");
        return;
      }
      default:
        return;
    }
  }
}

/** The palace directory over HTTP — the front-door signal for the
 *  entry screen (who's in which room) before the socket even opens.
 *  Mirrors GET /api/world/directory on the server. */
export async function fetchWorldDirectory(signal?: AbortSignal): Promise<PalaceDirectoryEntry[]> {
  const res = await fetch("/api/world/directory", { signal });
  if (!res.ok) throw new Error(`world directory ${res.status}`);
  const body = (await res.json()) as { rooms?: PalaceDirectoryEntry[] };
  return Array.isArray(body.rooms) ? body.rooms : [];
}
