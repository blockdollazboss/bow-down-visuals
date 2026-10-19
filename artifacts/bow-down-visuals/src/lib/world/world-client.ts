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
 *        doorway — the registry transfers this peer to that room),
 *        moment.celebrate (ask the room to witness a win — a quest
 *        claim or a level-up; a bare intent carrying no facts, the
 *        server verifies the win against its own records first),
 *        announce.herald (host only: speak to the whole palace at
 *        once — intercepted by the palace registry, which verifies
 *        the host flag and broadcasts a palace.announce)
 *   in:  welcome (room + self + snapshot), palace.directory,
 *        palace.announce (a palace-wide moment — a drop landing, a
 *        show starting, a level rising, the King's daily moment, or
 *        the host's herald), announce.denied (my herald was
 *        refused: not the host, blank, or too soon after the last),
 *        room.unavailable, peer.join / peer.move / peer.leave,
 *        peer.action, peer.moment (a win the room witnessed — the
 *        room's statement, built entirely from server records),
 *        peer.say, peer.character, peer.voiceoff, peer.voicedeaf,
 *        voice.joined / voice.left / voice.state / voice.signal /
 *        voice.full / voice.denied, room_full, pong (the keepalive
 *        answer — see the session-longevity note at the connect
 *        constants)
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
 *  ownership-verified by the server; clients never invent these.
 *  portraitUrl is the character's reference image; loopUrl its
 *  living loop (the row's reference video, resolved server-side).
 *  Either may be null — a video-only character stands on its loop
 *  alone — but a legal ref always carries at least one. */
export interface WorldCharacterRef {
  id: string;
  name: string;
  portraitUrl: string | null;
  loopUrl: string | null;
  /** The character's set voice (0142, G4): the shaping profile the
   *  server resolved from the vault row, or null when the character
   *  has no set voice. Only ever applied to the SELF presence —
   *  shaping is send-side, on the speaker's own client. */
  voiceProfile?: import("./character-voice").StoredCharacterVoiceProfile | null;
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
  /** The member's Creator Level stars (1–6), resolved by the
   *  server at the door from its own level rails — members only;
   *  guests have no stars. The nameplate renders them beside the
   *  name (never on the character art, THE-GAME §5 Q1), and a
   *  witnessed level-up (peer.moment) restars the record live. */
  stars?: number;
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

export type WorldStatus = "connecting" | "inside" | "full" | "error" | "closed" | "removed" | "replaced";

/** The room this client stands in, as the server named it. */
export interface PalaceRoomInfo {
  id: string;
  name: string;
}

/** One booked event on a room's slate (World Events, 0145): the
 *  live one first, then what's next — "tonight at the palace". */
export interface PalaceDirectoryEvent {
  id: string;
  kind: string;
  title: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live";
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
  /** This room's booked slate (live + upcoming), when any. */
  events?: PalaceDirectoryEvent[];
  /** Creator rooms only (Ring 2, 3.5): the room owner's profile
   *  slug — present while someone stands in a creator's room. */
  slug?: string;
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
  /** The booked World Event on the screen, while a scheduled stage
   *  show holds it — "LIVE: <title> by <hostName>". Absent for
   *  walk-in shows and the ambient screen. */
  event?: { id: string; title: string; hostName: string } | null;
}

/** One song on the Music Hall jukebox: the track (resolved and
 *  verified server-side) + who put it on. */
export interface WorldJukeboxEntry {
  entryId: string;
  track: {
    id: string;
    title: string;
    url: string;
    durationSec: number;
    creatorName: string | null;
    artworkUrl: string | null;
  };
  addedByPeerId: string;
  addedByName: string;
}

/** The Music Hall jukebox, mirrored from the room: the song on now
 *  (with the position the server last stamped from its anchor) and
 *  the up-next queue. Null outside the Music Hall. */
export interface WorldJukeboxState {
  current: {
    entry: WorldJukeboxEntry;
    playback: { playing: boolean; positionSec: number };
  } | null;
  queue: WorldJukeboxEntry[];
  /** The booked listening party whose queue this is, while one
   *  runs. Absent during open queueing. */
  party?: { eventId: string; title: string; hostName: string } | null;
}

/** A song just STARTED on the Music Hall jukebox (THE-GAME §5(a)'s
 *  first-play moment): the track and its creator, from server data. */
export interface WorldNowPlayingMoment {
  entryId: string;
  trackId: string;
  title: string;
  creatorName: string | null;
  addedByName: string;
}

/** A win the room witnessed (THE-GAME §5(a)): a quest completion
 *  or a level-up, broadcast by the server from its OWN records
 *  after verifying the achiever's bare celebrate intent. Wins are
 *  public (owner default §5 Q3): the moment carries the quest's
 *  name + reward or the new star count — never a balance, never
 *  progress detail. */
export type WorldMoment =
  | { kind: "quest"; peerId: string; name: string; questName: string; rewardVb: number }
  | { kind: "levelup"; peerId: string; name: string; stars: number };

/** The herald cap, mirrored from the server (HERALD_MAX_CHARS in
 *  lib/world-palace): a herald is a headline, not a speech. */
export const HERALD_MAX_CHARS = 140;

export const ANNOUNCE_KINDS = ["herald", "drop", "show", "levelup", "king"] as const;
export type PalaceAnnounceKind = (typeof ANNOUNCE_KINDS)[number];

/** A palace-wide announcement (Ring 3, THE-GAME §5(b)): the palace
 *  speaking past one room's walls, delivered by the registry to
 *  every occupied room at once. Every field is server-built from
 *  server truth — the one exception is a herald's `text`, which is
 *  the host's own words (host-verified at the registry, capped,
 *  rate-limited). The page renders it as a banner + a line in the
 *  room log; the mute for it is the page's (see lib/world/announce). */
export interface WorldAnnouncement {
  kind: PalaceAnnounceKind;
  text: string;
  /** The room the moment belongs to, when it has one. */
  roomId?: string;
  roomName?: string;
  /** The person the moment is about, when it has one. */
  name?: string;
  /** For kind "levelup": the new Creator Level stars. */
  stars?: number;
  /** For kind "drop": the per-claim amount. */
  amountVb?: number;
  /** The server's stamp of the moment (ms epoch). */
  at: number;
}

/** A drop spectacle standing in the room you're in (World Events
 *  3.4): claimable by the members standing there, first-come. */
export interface WorldDropState {
  eventId: string;
  title: string;
  roomId: string;
  roomName: string;
  amountVb: number;
  claimCap: number;
  claimsLeft: number;
}

/** The King's daily moment standing in the hall (Ring 3) — the
 *  design of `WorldKingMomentBroadcast` in the room source.
 *  `claimed` answers for THIS client. Null when no court stands. */
export interface WorldKingMomentState {
  /** The palace day (UTC, YYYY-MM-DD) the moment belongs to. */
  date: string;
  /** When the claim window closes (ms epoch, server clock). */
  claimDeadlineMs: number;
  claimed: boolean;
}

/** Normalize one kingMoment payload (welcome / king.state) — an
 *  unrecognized shape reads as "no moment", never as a guess. */
function normalizeKingMoment(value: unknown): WorldKingMomentState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.date !== "string" || v.date.length === 0) return null;
  if (typeof v.claimDeadlineMs !== "number" || !Number.isFinite(v.claimDeadlineMs)) return null;
  return { date: v.date, claimDeadlineMs: v.claimDeadlineMs, claimed: v.claimed === true };
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
  /** Timer injection for the first-connect retry engine (tests
   *  drive the backoff + watchdog by hand; the browser omits these
   *  and gets the real timers). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface WorldSayEvent {
  peerId: string;
  displayName: string;
  body: string;
}

export type VoiceNotice = "full" | "denied-guest" | "denied-host";

const MOVE_SEND_INTERVAL_MS = 100; // ~10/s, matching the server throttle

/* ── Connect resilience ────────────────────────────────────────────
 * The door is retried, quietly, before it is ever called broken:
 * the staging box (and any waking host) can take seconds to accept
 * a socket, and a single dropped handshake used to be a dead end
 * with an error card. A connect sequence gets a bounded budget —
 * this many attempts in total, with a growing pause between them —
 * and a watchdog per attempt: an attempt that produces neither a
 * welcome nor a close within its window counts as failed, so a
 * hung connect retries instead of spinning forever. Once a welcome
 * lands the budget is spent for that sequence — but a LATER drop is
 * no longer instantly terminal: it opens a fresh, quiet reconnect
 * budget of its own (see "Session longevity" below).
 *
 * The window is sized by SEQUENCE, not by attempt. A FIRST connect
 * (this client has never been welcomed) may be waking the host:
 * the free-tier box spins down when idle and can take the better
 * part of a minute to accept a socket after a deploy or a quiet
 * spell — and the tail is long even on a warm, settled box
 * (measured live on staging, 2026-10-17: opens at 24.7 s in the
 * morning and tailing to 55.8 s later that day, while the welcome,
 * once the handshake landed, followed in 0–38 ms every time). So
 * EVERY attempt of a first connect gets the long window: an early
 * version gave only attempt 1 the long window, and a slow open on
 * attempt 2 or 3 (20 s) burned the whole budget into the error
 * card while the server was attaching the peer and answering in
 * milliseconds — presence flowed, welcomes were sent, and the page
 * discarded them as belonging to already-retired sockets.
 * A RE-connect (a session was established earlier in this client's
 * life, then dropped; the page's Re-enter builds a fresh client,
 * so this is the same-client path) gets the short window on every
 * attempt: the host demonstrably woke for the earlier session, so
 * a still-hanging handshake is a genuine hang and fails fast.
 *
 * The watchdog is armed when the attempt STARTS — before the
 * token fetch, not after the socket exists. The token fetch can
 * itself make network calls with no timeout of its own (session
 * validation, a refresh), and an uncovered hang there stranded
 * the page on "connecting" with no timer running at all. Token
 * fetch and handshake now share the attempt's one window; a hung
 * fetch fails the attempt exactly like a hung handshake. */
export const WORLD_CONNECT_MAX_ATTEMPTS = 3;
/** The pause before attempt 2 and attempt 3, respectively. */
export const WORLD_CONNECT_BACKOFF_MS: readonly number[] = [1_000, 2_000];
/** The welcome window for every attempt of a RE-connect sequence
 *  (a session was established before): fail fast, the host is
 *  awake and a hang is a hang. */
export const WORLD_WELCOME_WATCHDOG_MS = 20_000;
/** The welcome window for every attempt of a FIRST connect: long
 *  enough for a waking (or merely slow) host to accept the socket
 *  and answer — on every attempt, not just the first. */
export const WORLD_FIRST_WELCOME_WATCHDOG_MS = 60_000;

/* ── Session longevity ─────────────────────────────────────────────
 * Getting in was only half the door: a session that lands must also
 * STAY landed. Measured live (2026-10-17): a guest who entered fine
 * was dropped ~1–2 minutes later and the failure card stayed — two
 * gaps stacked:
 *
 * 1. NOTHING kept the path warm. The gateway's protocol ping (30 s,
 *    server-side) never reaches the browser — the hosting router
 *    terminates control frames on its own leg (six-minute probe
 *    sessions saw zero protocol pings while data frames flowed).
 *    App traffic is all change-driven, so a lone guest standing
 *    still produces complete silence on their leg, and the router
 *    reaps the "idle" socket inside a couple of minutes. The fix is
 *    an APPLICATION keepalive: while inside, the client sends a
 *    `ping` frame every WORLD_KEEPALIVE_INTERVAL_MS and the room
 *    answers `pong` — data frames cross every leg, so the path
 *    stays warm on the strictest idle window in the chain.
 * 2. A drop while inside was INSTANTLY terminal: the close went
 *    straight to the error card with no retry at all (the retry
 *    budget existed only before the first welcome). A hangout
 *    doesn't eject you for one dropped connection: a drop now runs
 *    a QUIET reconnect — status stays "inside", `reconnecting`
 *    flags the interlude for the page's slim notice, and the
 *    attempts carry the long first-connect windows (the host may
 *    be mid-restart — the exact case the long window exists for).
 *    Only a genuinely exhausted reconnect budget lands on the
 *    error card.
 *
 * The pong doubles as a dead-man's switch: silence is ambiguous
 * (a quiet room is legal), so the liveness clock runs off INBOUND
 * frames of any kind. The keepalive guarantees an inbound answer
 * every interval on a live path; no frame at all for
 * WORLD_LIVENESS_TIMEOUT_MS means the path is dead — possibly
 * silently, with the socket still claiming open — and the client
 * retires it and re-enters through the same quiet reconnect. */
/** How often an inside client sends its keepalive ping. Inside the
 *  strictest plausible intermediary idle window (55–120 s) with
 *  room to spare. */
export const WORLD_KEEPALIVE_INTERVAL_MS = 25_000;
/** No inbound frame of any kind for this long, while inside, and
 *  the path is presumed dead: three keepalive cycles with no pong
 *  is not a quiet room, it's a corpse. */
export const WORLD_LIVENESS_TIMEOUT_MS = 75_000;

export function defaultWorldSocketUrl(
  loc: { protocol: string; host: string },
  token: string | null,
  guestId?: string | null,
): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  /* A member's account is their presence key — no guest id rides
   * along. A guest carries their tab's session id so a rejoin
   * (reload, reconnect) replaces its own lingering ghost peer on
   * the server instead of stacking a second "Guest" beside it. */
  const q = token
    ? `?token=${encodeURIComponent(token)}`
    : guestId
      ? `?guest=${encodeURIComponent(guestId)}`
      : "";
  return `${proto}//${loc.host}/api/world/ws${q}`;
}

/** Close code the server uses when this peer was replaced by its
 *  own identity rejoining elsewhere (mirror of the server's
 *  WORLD_REPLACED_CLOSE_CODE in lib/world-room.ts). Terminal like
 *  the host's removal: no auto-reconnect — two tabs of one person
 *  must never evict each other in a loop. */
export const WORLD_REPLACED_CLOSE_CODE = 4414;

const WORLD_GUEST_SESSION_KEY = "bdv.world.guestSession";
const GUEST_ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;

/** A fresh guest session id, in the charset the server accepts. */
export function newWorldGuestSessionId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  ).slice(0, 32);
}

let cachedGuestSessionId: string | null = null;

/** This TAB's guest session id: minted once, kept in
 *  sessionStorage so a reload of the same tab keeps the same id
 *  (and replaces its ghost), while a new tab is a new guest.
 *  Storage failures (private modes, odd embeds) fall back to a
 *  memory-only id — rejoins within the page's life still replace,
 *  which is the case that matters most. */
export function worldGuestSessionId(): string {
  if (cachedGuestSessionId) return cachedGuestSessionId;
  try {
    const stored = window.sessionStorage.getItem(WORLD_GUEST_SESSION_KEY);
    if (stored && GUEST_ID_SHAPE.test(stored)) {
      cachedGuestSessionId = stored;
      return stored;
    }
  } catch {
    /* storage unavailable — memory-only id below */
  }
  const id = newWorldGuestSessionId();
  cachedGuestSessionId = id;
  try {
    window.sessionStorage.setItem(WORLD_GUEST_SESSION_KEY, id);
  } catch {
    /* memory-only — see above */
  }
  return id;
}

/** The page overlay for a client status — null means "you're inside,
 *  no overlay". Error and full are honest dead-ends with their own
 *  cards; closed (deliberate leave) shows nothing. */
export function worldOverlay(status: WorldStatus): "connecting" | "room-full" | "error" | "removed" | "replaced" | null {
  switch (status) {
    case "connecting":
      return "connecting";
    case "full":
      return "room-full";
    case "error":
      return "error";
    case "removed":
      return "removed";
    case "replaced":
      return "replaced";
    default:
      return null;
  }
}

export class WorldClient {
  status: WorldStatus = "connecting";
  /** True while a dropped session is quietly re-entering: the
   *  status stays "inside" (the hall stays up behind the page's
   *  slim reconnecting notice) until the welcome lands or the
   *  reconnect budget is genuinely exhausted. */
  reconnecting = false;
  self: WorldPeer | null = null;
  peers = new Map<string, WorldPeer>();
  voicePeerIds = new Set<string>();
  /** The stage + screen, as the room last stated it (welcome, then
   *  every `screen.state`). Null until the welcome lands. Only the
   *  hall carries screen state — a transfer welcome from another
   *  room omits it and the hall's last state stands. */
  screen: WorldScreenState | null = null;
  /** The Music Hall jukebox, as the room last stated it (welcome,
   *  then every `jukebox.state`). Only the Music Hall carries it —
   *  entering any other room clears it: the music stays behind the
   *  door you walked out of. */
  jukebox: WorldJukeboxState | null = null;
  /** The last song the jukebox STARTED (the §5(a) first-play
   *  moment), as last announced by the room. */
  nowPlaying: WorldNowPlayingMoment | null = null;
  /** The drop spectacle standing in the room I'm in, when one has
   *  landed (welcome snapshot, then drop.* frames). */
  drop: WorldDropState | null = null;
  /** The King's daily moment standing in the hall, while its claim
   *  window stands (the hall welcome, then king.* frames; any other
   *  room's welcome clears it — the court is the hall's). */
  kingMoment: WorldKingMomentState | null = null;
  /** The last win the room witnessed (a quest completion or a
   *  level-up), as last broadcast by the server. */
  lastMoment: WorldMoment | null = null;
  /** The last palace-wide announcement, as last broadcast by the
   *  registry (any room's moment, the King's moment, the host's
   *  herald). The page's banner + mute read this; the socket keeps
   *  receiving announcements while muted — the mute is the page's
   *  presentation choice, not a server state. */
  announce: WorldAnnouncement | null = null;
  /** The room this client stands in (set by every welcome). */
  room: PalaceRoomInfo | null = null;
  /** The palace directory — who's where — as last broadcast (and
   *  re-sent inside every transfer). Empty until the first frame. */
  directory: PalaceDirectoryEntry[] = [];

  /* Assignable handlers — the page wires scene + voice + chat log. */
  onStatus: ((status: WorldStatus) => void) | null = null;
  /** The quiet-reconnect interlude started/ended — the page shows
   *  its slim "reconnecting" notice off this, never a card. */
  onReconnectingChange: ((reconnecting: boolean) => void) | null = null;
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
  /** The Music Hall jukebox changed (a song added, skipped, the
   *  transport worked) — the page re-renders the queue and re-syncs
   *  its room audio to the new stamp. */
  onJukebox: ((jukebox: WorldJukeboxState) => void) | null = null;
  /** A jukebox action was refused (guests / unplayable / queue-full
   *  / not-yours) — the panel says why instead of failing silently. */
  onJukeboxDenied: ((reason: string) => void) | null = null;
  /** A song just started on the jukebox — the first-play moment
   *  naming the song + its creator. */
  onNowPlaying: ((moment: WorldNowPlayingMoment) => void) | null = null;
  /** A drop spectacle landed in this room (the herald moment). */
  onDropLanded: ((drop: WorldDropState) => void) | null = null;
  /** The room's drop state changed (landed claims ticking down, or
   *  the chest swept). Null = no drop stands. */
  onDrop: ((drop: WorldDropState | null) => void) | null = null;
  /** A claim landed, witnessed by the room: who + how much, from
   *  server truth. */
  onDropClaimed: ((claim: { name: string; amountVb: number }, drop: WorldDropState | null) => void) | null = null;
  /** A win was witnessed in this room (a quest completion or a
   *  level-up — THE-GAME §5(a)). The achiever's peer record has
   *  already been restarred when this fires for a level-up. */
  onMoment: ((moment: WorldMoment) => void) | null = null;
  /** My claim was refused (guests / no-drop / already-claimed /
   *  claimed-out / budget). */
  onDropDenied: ((reason: string) => void) | null = null;
  /** The King's moment changed (hall welcome / king.state) — the
   *  new standing state, or null when the court closed. */
  onKingMoment: ((moment: WorldKingMomentState | null) => void) | null = null;
  /** A member claimed the King's gift in the hall — witnessed
   *  publicly (name + amount are server truth). */
  onKingClaimed: ((claim: { name: string; amountVb: number }) => void) | null = null;
  /** My gift claim was refused (guests / no-moment / closed /
   *  already / pool / error). */
  onKingDenied: ((reason: string) => void) | null = null;
  /** A stage tip landed in this room — witnessed publicly
   *  (tipper name + performer name + amount are server truth). */
  onStageTipped: ((tip: { name: string; performerName: string; amountVb: number }) => void) | null = null;
  /** My stage tip was refused (guests / no-stage / self / amount /
   *  too-fast / insufficient / disabled / error). */
  onStageTipDenied: ((reason: string) => void) | null = null;
  /** A palace-wide announcement landed (any room's moment, the
   *  King's daily moment, the host's herald). */
  onAnnounce: ((announce: WorldAnnouncement) => void) | null = null;
  /** My herald was refused by the registry (not the host, blank
   *  text, or inside the rate-limit window). */
  onAnnounceDenied: (() => void) | null = null;
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
  /** Connect retry state: sockets opened so far in this connect
   *  sequence, whether a welcome has landed in it, and the two
   *  pending timers (welcome watchdog, backoff). Alongside them:
   *  `sessionEstablished` — latched by the first welcome this
   *  client EVER receives and never reset (it sizes the watchdog
   *  windows: first connect vs re-connect), and `attemptGeneration`
   *  — a monotone stamp each attempt (and each connect/disconnect)
   *  takes, so a retired attempt's late continuations and timers
   *  can always tell they are stale. */
  private connectAttemptsMade = 0;
  private everInside = false;
  private sessionEstablished = false;
  private attemptGeneration = 0;
  /** A connect sequence (entry or quiet reconnect) is running:
   *  attempts, watchdogs and backoffs are live, and socket events
   *  route to the attempt engine instead of the drop handling.
   *  `sequenceIsReconnect` marks the quiet kind: status stays
   *  "inside" throughout, windows are the long ones, and a landed
   *  welcome re-homes the page (the old session's voice mesh died
   *  with its socket). */
  private inSequence = false;
  private sequenceIsReconnect = false;
  private welcomeWatchdog: unknown = null;
  private retryTimer: unknown = null;
  /** The keepalive/liveness timer (inside only) and the last time
   *  ANY inbound frame landed, on the injected clock. */
  private keepaliveTimer: unknown = null;
  private lastInboundAt = 0;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
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
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer ??
      ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get isGuest(): boolean {
    return this.self?.guest ?? true;
  }

  get inVoice(): boolean {
    return !!this.self && this.voicePeerIds.has(this.self.peerId);
  }

  async connect(): Promise<void> {
    this.clearConnectTimers();
    this.stopKeepalive();
    /* A new sequence retires everything the old one left in
     * flight — a token fetch still out there must never open a
     * socket for a sequence that no longer exists. */
    this.attemptGeneration += 1;
    this.connectAttemptsMade = 0;
    this.everInside = false;
    this.inSequence = true;
    this.sequenceIsReconnect = false;
    this.setReconnecting(false);
    this.setStatus("connecting");
    await this.openAttempt();
  }

  /** A session that already landed lost its socket (or its path
   *  went provably silent): re-enter QUIETLY. The hall stays up —
   *  status never leaves "inside" — while a fresh attempt sequence
   *  with the long, wake-tolerant windows runs under the
   *  `reconnecting` flag. A landed welcome ends the interlude (and
   *  re-homes the page, like a doorway transfer: the old session's
   *  voice mesh died with its socket); an exhausted budget is the
   *  honest error card, finally. */
  private beginReconnect(): void {
    if (this.status !== "inside" || this.inSequence) return;
    this.stopKeepalive();
    this.clearConnectTimers();
    this.attemptGeneration += 1;
    this.connectAttemptsMade = 0;
    this.everInside = false;
    this.inSequence = true;
    this.sequenceIsReconnect = true;
    this.setReconnecting(true);
    void this.openAttempt();
  }

  private setReconnecting(value: boolean): void {
    if (this.reconnecting === value) return;
    this.reconnecting = value;
    this.onReconnectingChange?.(value);
  }

  /* ── Keepalive + liveness (inside only) ──────────────────────────
   * One timer, re-armed each tick. The tick pings (the data frame
   * that keeps every leg of the path warm) and checks the inbound
   * clock: the ping guarantees a `pong` back on a live path, so a
   * full liveness window of total silence — no pong, no peer
   * traffic, nothing — is a dead path even when the socket still
   * claims to be open. */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.lastInboundAt = this.now();
    const tick = () => {
      this.keepaliveTimer = null;
      if (this.status !== "inside" || this.inSequence) return;
      if (this.now() - this.lastInboundAt > WORLD_LIVENESS_TIMEOUT_MS) {
        this.handleDeadPath();
        return;
      }
      this.send({ type: "ping" });
      this.keepaliveTimer = this.setTimer(tick, WORLD_KEEPALIVE_INTERVAL_MS);
    };
    this.keepaliveTimer = this.setTimer(tick, WORLD_KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      this.clearTimer(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  /** The path went silent past proof: retire the (possibly
   *  zombie) socket ourselves — nulling it first means its late
   *  close event is identity-guarded into silence — and re-enter
   *  through the same quiet reconnect a real close would start. */
  private handleDeadPath(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }
    this.beginReconnect();
  }

  /** One connection attempt: a watchdog, a fresh token, a fresh
   *  socket. Every failure route (error, close of ANY code before
   *  the welcome, a hung handshake, a hung token fetch, a socket
   *  that won't even construct) funnels into failConnectAttempt
   *  while the sequence's budget lasts — the status never leaves
   *  "connecting" between attempts, so the page just keeps showing
   *  its entering state and no error card flashes for a transient. */
  private async openAttempt(): Promise<void> {
    this.connectAttemptsMade += 1;
    const generation = ++this.attemptGeneration;
    /* The watchdog arms FIRST, before the token fetch: the fetch
     * is part of the attempt and shares its window (see the
     * constants above). Guests pay nothing for this — their token
     * read is a local null, and the timer is the same one the
     * handshake would have armed anyway. */
    this.armWelcomeWatchdog(generation);
    let token: string | null = null;
    try {
      token = await this.deps.getAccessToken();
    } catch {
      token = null; // a token hiccup downgrades to guest, never blocks the door
    }
    /* The watchdog may have retired this attempt while the token
     * was in flight (or a disconnect / a whole new connect landed):
     * a stale attempt must not open. The generation is the precise
     * guard — the attempt count alone can coincide across
     * sequences. (The sequence flag, not the status: a quiet
     * reconnect's attempts run while the status stays "inside".) */
    if (generation !== this.attemptGeneration || !this.inSequence) return;
    let socket: WorldSocketLike;
    try {
      socket = this.deps.openSocket(this.deps.socketUrl(token));
    } catch {
      this.failConnectAttempt();
      return;
    }
    this.socket = socket;
    /* Handlers check identity: a superseded attempt's socket (the
     * watchdog already closed it, we're on a newer one) must never
     * act on its late events. */
    socket.onmessage = (ev) => {
      if (this.socket === socket) this.handleFrame(ev.data);
    };
    socket.onclose = (ev) => {
      if (this.socket === socket) this.handleSocketClose(ev);
    };
    socket.onerror = () => {
      if (this.socket === socket) this.handleSocketFailure();
    };
  }

  private handleSocketClose(ev: { code?: number }): void {
    /* Replaced by my own identity rejoining elsewhere: terminal,
     * whatever the frame said or didn't say — the server sends a
     * `replaced` frame first, but the close code alone must be
     * enough, because a reconnect here would evict the newer
     * copy and start a tab war. */
    if (ev.code === WORLD_REPLACED_CLOSE_CODE) {
      this.clearConnectTimers();
      this.setStatus("replaced");
      return;
    }
    if (this.status === "full" || this.status === "removed" || this.status === "replaced") return; // already explained itself
    if (this.inSequence && !this.everInside) {
      /* A close before this sequence's welcome — clean (1000/1005,
       * a draining server) or abnormal (1006, a killed handshake) —
       * is a failed attempt, not a dead room: it retries inside the
       * same budget, and only an exhausted budget shows the card.
       * (Before the retry engine, a clean close landed on "closed",
       * which has no overlay at all — a bare dead room.) */
      this.failConnectAttempt();
      return;
    }
    if (this.status === "inside") {
      /* A real drop, mid-visit, of any code: the session was
       * established and the path is gone (a router reap, a host
       * restart, a network handoff). It used to land on the error
       * card instantly — one dropped connection ejected you from
       * the hangout. Now it opens the quiet reconnect: the hall
       * stays up and only a genuinely exhausted budget shows the
       * card. (A deliberate leave never reaches here —
       * disconnect() nulls the socket before closing it, so this
       * handler is identity-guarded silent.) */
      this.beginReconnect();
    }
  }

  private handleSocketFailure(): void {
    if (this.inSequence && !this.everInside) {
      this.failConnectAttempt();
    }
  }

  /** The current attempt is dead: retire its socket quietly and
   *  either schedule the next attempt (backoff, status untouched)
   *  or, with the budget spent, land on the honest error state. */
  private failConnectAttempt(): void {
    this.clearWelcomeWatchdog();
    /* Retire the attempt's identity too: a token fetch still in
     * flight for it resolves into a generation that no longer
     * matches, and its continuation opens nothing. */
    this.attemptGeneration += 1;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }
    if (this.connectAttemptsMade >= WORLD_CONNECT_MAX_ATTEMPTS) {
      /* The budget is genuinely spent: the sequence closes, the
       * reconnecting interlude (if this was one) ends, and the
       * honest error card lands — for an entry and a reconnect
       * alike. */
      this.inSequence = false;
      this.sequenceIsReconnect = false;
      this.setReconnecting(false);
      this.setStatus("error");
      return;
    }
    const delay =
      WORLD_CONNECT_BACKOFF_MS[this.connectAttemptsMade - 1] ??
      WORLD_CONNECT_BACKOFF_MS[WORLD_CONNECT_BACKOFF_MS.length - 1]!;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      if (!this.inSequence || this.everInside) return;
      void this.openAttempt();
    }, delay);
  }

  /** An attempt that lands neither a welcome nor a close inside
   *  its window is a failed attempt — without this, a hung connect
   *  spins on "connecting" forever (there was no timer at all).
   *  The window is sequence-aware: every attempt of a first
   *  connect gets the long window; every attempt of a same-client
   *  re-connect gets the short one; and every attempt of a QUIET
   *  reconnect (a dropped session re-entering) gets the long
   *  window too — its likeliest cause is the host mid-restart,
   *  the exact case the long window exists for (see the constants
   *  above). The callback is generation-guarded: a watchdog that
   *  somehow outlives its attempt (a callback already queued when
   *  the clear landed) recognizes its dead generation and does
   *  nothing — it can never re-error a live session. */
  private armWelcomeWatchdog(generation: number): void {
    this.clearWelcomeWatchdog();
    const windowMs =
      this.sequenceIsReconnect || !this.sessionEstablished
        ? WORLD_FIRST_WELCOME_WATCHDOG_MS
        : WORLD_WELCOME_WATCHDOG_MS;
    this.welcomeWatchdog = this.setTimer(() => {
      this.welcomeWatchdog = null;
      if (generation !== this.attemptGeneration) return;
      if (!this.inSequence || this.everInside) return;
      this.failConnectAttempt();
    }, windowMs);
  }

  private clearWelcomeWatchdog(): void {
    if (this.welcomeWatchdog !== null) {
      this.clearTimer(this.welcomeWatchdog);
      this.welcomeWatchdog = null;
    }
  }

  private clearConnectTimers(): void {
    this.clearWelcomeWatchdog();
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer);
      this.retryTimer = null;
    }
  }

  disconnect(): void {
    this.setStatus("closed");
    this.clearConnectTimers();
    this.stopKeepalive();
    this.inSequence = false;
    this.sequenceIsReconnect = false;
    this.setReconnecting(false);
    this.attemptGeneration += 1; // an in-flight attempt opens nothing after this
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }
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

  /* ── The Music Hall jukebox ─────────────────────────────────────
   * Plain intents; the room enforces members-only adds and
   * adder-or-host transport on every one. */

  /** Put a song on the jukebox (catalog id only — the server
   *  re-verifies the published track and derives its URL). */
  jukeboxAdd(trackId: string): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "jukebox.add", trackId });
  }

  /** Shared play/pause for the song on now. */
  jukeboxPlayPause(playing: boolean): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "jukebox.playpause", playing });
  }

  /** Skip the song on now. */
  jukeboxSkip(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "jukebox.skip" });
  }

  /** Pull one of my queued songs back off. */
  jukeboxRemove(entryId: string): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "jukebox.remove", entryId });
  }

  /* ── Drop spectacles (World Events 3.4) ────────────────────────
   * One intent; the room enforces members-only, in-room, first-come
   * on it. Guests don't even send it — they watch. */

  /** Claim the drop standing in this room. */
  claimDrop(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "drop.claim" });
  }

  /* ── The King's daily moment (Ring 3) ──────────────────────────
   * One intent; the hall enforces members-only, in-window, once a
   * day, and the quest-pool envelope on it. */

  /** Claim the King's audience gift while his moment stands. */
  claimKingGift(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "king.claim" });
  }

  /* ── Stage tips from seats (Ring 3, item 3.3) ──────────────────
   * One intent with the amount; the room enforces members-only,
   * a held stage, never your own stage, the house bounds and the
   * pace — and the transfer moves the money server-side. */

  /** Tip the member holding this room's stage. */
  tipStage(amountVb: number): void {
    if (this.status !== "inside" || this.isGuest) return;
    if (!Number.isInteger(amountVb) || amountVb <= 0) return;
    this.send({ type: "stage.tip", amountVb });
  }

  /* ── Witnessed moments (THE-GAME §5(a)) ───────────────────────
   * Bare intents: "a win just happened — witness it if it's real."
   * They carry NO facts (no quest name, no reward, no level): the
   * server verifies the win against its own records and only then
   * broadcasts peer.moment to the room. An unverified intent is
   * dropped server-side, silently. Guests never send them — they
   * witness, they never star. */

  /** Ask the room to witness a quest reward I just claimed. */
  celebrateQuest(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "moment.celebrate", kind: "quest" });
  }

  /** Ask the room to witness my Creator Level rising. */
  celebrateLevelup(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "moment.celebrate", kind: "levelup" });
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

  /** Herald the whole palace (host only): the registry intercepts
   *  the intent, verifies the host flag against my room's peer
   *  record, and broadcasts a palace.announce to every room. The
   *  text is trimmed + capped here as a courtesy — the server caps
   *  and rate-limits it regardless. Returns false without sending
   *  when it can't land (not inside, not the host, blank), so the
   *  compose box can stay honest. */
  herald(text: string): boolean {
    if (this.status !== "inside" || !this.self?.admin) return false;
    const clean = text.trim().slice(0, HERALD_MAX_CHARS);
    if (!clean) return false;
    this.send({ type: "announce.herald", text: clean });
    return true;
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

    /* Every inbound frame is proof of life for the liveness
     * clock — a busy room keeps the clock fed on its own traffic;
     * a quiet room is fed by the keepalive's pongs. */
    this.lastInboundAt = this.now();

    switch (frame["type"]) {
      case "pong": {
        /* The keepalive's answer. The timestamp above is the whole
         * handling — nothing renders, nothing routes. */
        return;
      }
      case "room_full": {
        /* Terminal for the sequence too: a full hall is never
         * retried against, entry or reconnect alike — the close
         * that follows must find nothing left to fail over. */
        this.inSequence = false;
        this.sequenceIsReconnect = false;
        this.setReconnecting(false);
        this.clearConnectTimers();
        this.setStatus("full");
        return;
      }
      case "welcome": {
        /* The welcome spends the sequence's budget for good and
         * silences the watchdog. It also latches the session for
         * this client's life: any later ENTRY sequence is a
         * RE-connect and arms the short watchdog windows. And it
         * (re)starts the keepalive — entry, doorway transfer, and
         * quiet-reconnect landings all keep the path warm from
         * here. */
        this.everInside = true;
        this.sessionEstablished = true;
        const completedReconnect = this.sequenceIsReconnect;
        this.inSequence = false;
        this.sequenceIsReconnect = false;
        this.setReconnecting(false);
        this.clearConnectTimers();
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
        /* The jukebox rides the welcome only in the Music Hall;
         *  any other room's welcome clears it (the music does not
         *  follow you through a doorway). */
        this.jukebox =
          frame["jukebox"] && typeof frame["jukebox"] === "object"
            ? (frame["jukebox"] as WorldJukeboxState)
            : null;
        /* A drop standing in the room rides the welcome the same
         *  way; any other room's welcome clears it — the chest stays
         *  in the room it landed in. */
        this.drop =
          frame["drop"] && typeof frame["drop"] === "object"
            ? (frame["drop"] as WorldDropState)
            : null;
        /* The King's moment rides the HALL welcome the same way;
         *  any other room's welcome clears it — the court stays in
         *  the hall it opened in. */
        this.kingMoment = normalizeKingMoment(frame["kingMoment"]);
        this.onKingMoment?.(this.kingMoment);
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
        this.startKeepalive();
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
        // teardown) — only when the room actually changed. A
        // QUIET-RECONNECT landing re-homes it too, same room or
        // not: the session is brand new, and everything tied to
        // the dead socket (the voice mesh above all) is over.
        if (wasInside && (completedReconnect || prevRoomId !== this.room.id)) {
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
        // Explicit normalizer (DTO discipline): a ref is legal when
        // it carries an id, a name, and at least one way to stand —
        // a portrait, a living loop, or both. Anything else is no
        // character at all.
        let character: WorldCharacterRef | null = null;
        if (raw && typeof raw === "object") {
          const r = raw as Record<string, unknown>;
          const portraitUrl = typeof r["portraitUrl"] === "string" && r["portraitUrl"] ? r["portraitUrl"] : null;
          const loopUrl = typeof r["loopUrl"] === "string" && r["loopUrl"] ? r["loopUrl"] : null;
          /* The character's set voice (0142, G4) rides the same ref —
             the server sanitizes it before broadcast; the shape
             check here is the client's own DTO discipline. Only the
             SELF presence's profile is ever applied (send-side). */
          const rawProfile = r["voiceProfile"];
          const voiceProfile =
            rawProfile && typeof rawProfile === "object" &&
            typeof (rawProfile as Record<string, unknown>)["pitchSemitones"] === "number" &&
            typeof (rawProfile as Record<string, unknown>)["formantRatio"] === "number" &&
            typeof (rawProfile as Record<string, unknown>)["formantGainDb"] === "number"
              ? (rawProfile as WorldCharacterRef["voiceProfile"])
              : null;
          if (
            typeof r["id"] === "string" && r["id"] &&
            typeof r["name"] === "string" &&
            (portraitUrl !== null || loopUrl !== null)
          ) {
            character = { id: r["id"], name: r["name"], portraitUrl, loopUrl };
            /* Absent stays absent — the field is only attached when
               the character actually has a set voice. */
            if (voiceProfile) character.voiceProfile = voiceProfile;
          }
        }
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
      case "jukebox.state": {
        if (frame["jukebox"] && typeof frame["jukebox"] === "object") {
          this.jukebox = frame["jukebox"] as WorldJukeboxState;
          this.onJukebox?.(this.jukebox);
        }
        return;
      }
      case "jukebox.denied": {
        this.onJukeboxDenied?.(typeof frame["reason"] === "string" ? frame["reason"] : "refused");
        return;
      }
      case "jukebox.nowplaying": {
        if (frame["moment"] && typeof frame["moment"] === "object") {
          this.nowPlaying = frame["moment"] as WorldNowPlayingMoment;
          this.onNowPlaying?.(this.nowPlaying);
        }
        return;
      }
      case "king.state": {
        /* The room's copy is anonymous (claimed:false); my own
         * answered copy carries my flag. A same-day state that
         * would un-claim me is a broadcast, not my answer — keep a
         * landed claim landed. */
        const next = normalizeKingMoment(frame["kingMoment"]);
        if (
          next &&
          this.kingMoment?.date === next.date &&
          this.kingMoment.claimed &&
          !next.claimed
        ) {
          next.claimed = true;
        }
        this.kingMoment = next;
        this.onKingMoment?.(next);
        return;
      }
      case "king.claimed": {
        const claim = frame["claim"];
        if (claim && typeof claim === "object") {
          const c = claim as Record<string, unknown>;
          if (typeof c.name === "string" && typeof c.amountVb === "number") {
            this.onKingClaimed?.({ name: c.name, amountVb: c.amountVb });
          }
        }
        return;
      }
      case "king.denied": {
        this.onKingDenied?.(typeof frame["reason"] === "string" ? frame["reason"] : "error");
        return;
      }
      case "stage.tipped": {
        const tip = frame["tip"];
        if (tip && typeof tip === "object") {
          const t = tip as Record<string, unknown>;
          if (
            typeof t.name === "string" &&
            typeof t.performerName === "string" &&
            typeof t.amountVb === "number"
          ) {
            this.onStageTipped?.({
              name: t.name,
              performerName: t.performerName,
              amountVb: t.amountVb,
            });
          }
        }
        return;
      }
      case "stage.tip.denied": {
        this.onStageTipDenied?.(typeof frame["reason"] === "string" ? frame["reason"] : "error");
        return;
      }
      case "drop.landed": {
        if (frame["drop"] && typeof frame["drop"] === "object") {
          this.drop = frame["drop"] as WorldDropState;
          this.onDropLanded?.(this.drop);
          this.onDrop?.(this.drop);
        }
        return;
      }
      case "drop.state": {
        this.drop =
          frame["drop"] && typeof frame["drop"] === "object"
            ? (frame["drop"] as WorldDropState)
            : null;
        this.onDrop?.(this.drop);
        return;
      }
      case "drop.claimed": {
        if (frame["drop"] && typeof frame["drop"] === "object") {
          this.drop = frame["drop"] as WorldDropState;
        }
        const claim = frame["claim"] as { name?: unknown; amountVb?: unknown } | undefined;
        this.onDropClaimed?.(
          {
            name: typeof claim?.name === "string" ? claim.name : "A creator",
            amountVb: typeof claim?.amountVb === "number" ? claim.amountVb : 0,
          },
          this.drop,
        );
        this.onDrop?.(this.drop);
        return;
      }
      case "drop.denied": {
        this.onDropDenied?.(typeof frame["reason"] === "string" ? frame["reason"] : "refused");
        return;
      }
      case "peer.moment": {
        /* A witnessed win. Explicit normalizer (DTO discipline):
         * a quest moment is legal only with its quest name + a
         * numeric reward, a levelup only with a 1–6 star count —
         * anything else is not a moment the page may present. */
        const raw = frame["moment"];
        if (!raw || typeof raw !== "object") return;
        const m = raw as Record<string, unknown>;
        const peerId = typeof m["peerId"] === "string" ? m["peerId"] : "";
        const name = typeof m["name"] === "string" ? m["name"] : "";
        if (!peerId || !name) return;
        let moment: WorldMoment | null = null;
        if (
          m["kind"] === "quest" &&
          typeof m["questName"] === "string" && m["questName"] &&
          typeof m["rewardVb"] === "number"
        ) {
          moment = { kind: "quest", peerId, name, questName: m["questName"], rewardVb: m["rewardVb"] };
        } else if (
          m["kind"] === "levelup" &&
          typeof m["stars"] === "number" &&
          Number.isInteger(m["stars"]) &&
          m["stars"] >= 1 && m["stars"] <= 6
        ) {
          moment = { kind: "levelup", peerId, name, stars: m["stars"] };
        }
        if (!moment) return;
        this.lastMoment = moment;
        /* The restar applies to the peer record itself (self
         * included — the record I broadcast IS this record), so
         * the nameplate the room reads carries the new rank from
         * this frame on. */
        if (moment.kind === "levelup") {
          const target = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
          if (target) target.stars = moment.stars;
        }
        this.onMoment?.(moment);
        return;
      }
      case "palace.announce": {
        /* A palace-wide moment. Explicit normalizer (DTO
         * discipline): a known kind and a non-empty headline or it
         * isn't an announcement the page may present; the optional
         * fields ride only when they're the right shape. */
        const raw = frame["announce"];
        if (!raw || typeof raw !== "object") return;
        const a = raw as Record<string, unknown>;
        const kind = typeof a["kind"] === "string" ? a["kind"] : "";
        const text = typeof a["text"] === "string" ? a["text"] : "";
        if (!(ANNOUNCE_KINDS as readonly string[]).includes(kind) || !text) return;
        const announce: WorldAnnouncement = {
          kind: kind as PalaceAnnounceKind,
          text,
          ...(typeof a["roomId"] === "string" ? { roomId: a["roomId"] } : {}),
          ...(typeof a["roomName"] === "string" ? { roomName: a["roomName"] } : {}),
          ...(typeof a["name"] === "string" ? { name: a["name"] } : {}),
          ...(typeof a["stars"] === "number" ? { stars: a["stars"] } : {}),
          ...(typeof a["amountVb"] === "number" ? { amountVb: a["amountVb"] } : {}),
          at: typeof a["at"] === "number" ? a["at"] : this.now(),
        };
        this.announce = announce;
        this.onAnnounce?.(announce);
        return;
      }
      case "announce.denied": {
        this.onAnnounceDenied?.();
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
        this.clearConnectTimers();
        this.setStatus("removed");
        return;
      }
      case "replaced": {
        /* My own identity rejoined on a newer connection (another
         * tab, another device): this copy steps aside. The close
         * follows immediately; the status must survive it — and no
         * reconnect may ever fire from here, or the two copies
         * would evict each other forever. */
        this.clearConnectTimers();
        this.setStatus("replaced");
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

/** One booked World Event (the palace calendar, 0145), as the REST
 *  slate serves it — mirrors the DTO in routes/world-events. */
export interface WorldEventDto {
  id: string;
  /* 'contest' joined the calendar in 0158 (World Contests, 2.24);
   * 'office_hours' in 0159 (3.7) — the slate has carried both
   * since their migrations landed. */
  kind: "stage_show" | "listening_party" | "drop" | "contest" | "office_hours";
  roomId: string;
  hostUserId: string;
  hostName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  payload: Record<string, unknown>;
  status: "scheduled" | "live" | "done" | "cancelled";
  createdAt: string;
}

/** The palace calendar over HTTP: live + upcoming events, soonest
 *  first — the "tonight at the palace" read for the board and any
 *  surface that hasn't stepped in yet (Lane K renders the board
 *  block from this + the directory slate). Mirrors
 *  GET /api/world/events. */
export async function fetchWorldEvents(signal?: AbortSignal): Promise<WorldEventDto[]> {
  const res = await fetch("/api/world/events", { signal });
  if (!res.ok) throw new Error(`world events ${res.status}`);
  const body = (await res.json()) as { events?: WorldEventDto[] };
  return Array.isArray(body.events) ? body.events : [];
}

/** The palace calendar read (UPGRADE-PROGRAM 3.9): the same public
 *  slate as fetchWorldEvents PLUS the server's look back — done
 *  events that ended within the last 7 days (server-capped at 20,
 *  most recent first) under `recent`. Public, like the slate: the
 *  Kingdom Board's calendar reads the same for guests and members;
 *  only the walking is members'. */
export async function fetchWorldEventCalendar(
  signal?: AbortSignal,
): Promise<{ events: WorldEventDto[]; recent: WorldEventDto[] }> {
  const res = await fetch("/api/world/events?recent=1", { signal });
  if (!res.ok) throw new Error(`world events ${res.status}`);
  const body = (await res.json()) as { events?: WorldEventDto[]; recent?: WorldEventDto[] };
  return {
    events: Array.isArray(body.events) ? body.events : [],
    recent: Array.isArray(body.recent) ? body.recent : [],
  };
}
