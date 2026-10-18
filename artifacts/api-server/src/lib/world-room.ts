/**
 * world-room.ts — The World: presence for ONE room of the palace.
 * Socket state only (no DB rows): peers live in this process for
 * exactly as long as their socket does, and despawn the moment it
 * closes. The palace registry (lib/world-palace.ts) runs one
 * WorldRoom per palace room — the King's Hall (this class's default
 * configuration: spawn, stage, screen) plus the Music Hall, the Game
 * Rooms, the Create Wing and the Courtyard — and moves peers between
 * them when they walk through a doorway (a `room.enter` frame, which
 * the REGISTRY intercepts; it never reaches a room). Presence, chat
 * and the voice mesh are all room-scoped: you see and hear the room
 * you are standing in, and proximity voice stops at doorways.
 *
 * Rides the shared live gateway (lib/live-ws.ts) in its own room,
 * separate from chat/control rooms. Protocol (JSON frames):
 *
 *   client → server
 *     { type: "move", x, y, z, rotY }        position sync (throttled)
 *     { type: "action", action }             perform an avatar action
 *                                            (bow/wave/cheer/clap/spin
 *                                            once; dance/sit toggle —
 *                                            re-sending the toggle ends
 *                                            it; null stops now)
 *     { type: "say", body }                  room text (signed-in only)
 *     { type: "ping" }                       the client's session
 *                                            keepalive (see below)
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
 *     { type: "jukebox.add", trackId }        Music Hall: put a song
 *                                            on the room jukebox
 *                                            (members only; id only —
 *                                            verified published track)
 *     { type: "jukebox.playpause", playing }  the song adder (or the
 *                                            host): shared play/pause
 *     { type: "jukebox.skip" }                adder/host: next song
 *     { type: "jukebox.remove", entryId }     pull your queued song
 *     { type: "drop.claim" }                  claim the drop spectacle
 *                                            that landed in THIS room
 *                                            (members only, first-come;
 *                                            World Events, item 3.4)
 *     { type: "moment.celebrate", kind }      ask the room to witness
 *                                            a win: kind "quest" (a
 *                                            quest reward I just
 *                                            claimed) or "levelup"
 *                                            (my Creator Level just
 *                                            rose). The intent carries
 *                                            NO facts — the server
 *                                            verifies the win against
 *                                            its own records before
 *                                            anything is broadcast
 *                                            (see peer.moment below);
 *                                            an unverified intent is
 *                                            dropped silently, and
 *                                            guests' intents always
 *                                            are (guests witness,
 *                                            never star)
 *     { type: "admin.mute", peerId, muted }   host only: mute/unmute a
 *                                            member's voice server-side
 *     { type: "admin.remove", peerId }        host only: remove a
 *                                            person from the hall
 *   server → client
 *     { type: "welcome", peerId, room, you, peers }   on join (full
 *                                            snapshot; `room` names
 *                                            the room you stand in —
 *                                            a doorway transfer sends
 *                                            a fresh welcome for the
 *                                            new room, same peerId)
 *     { type: "peer.join", peer } / { type: "peer.leave", peerId }
 *     { type: "peer.move", peerId, x, y, z, rotY }
 *     { type: "peer.action", peerId, action }   a peer started (or
 *                                            stopped) an avatar action
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
 *     { type: "jukebox.state", jukebox }       the Music Hall jukebox
 *                                            now (also in `welcome`):
 *                                            current song + its
 *                                            anchor-stamped position,
 *                                            and the up-next queue
 *     { type: "jukebox.denied", reason }      a jukebox action was
 *                                            refused (guests /
 *                                            unplayable / queue-full /
 *                                            not-yours /
 *                                            listening-party)
 *     { type: "jukebox.nowplaying", moment }  a song just STARTED on
 *                                            the jukebox (THE-GAME
 *                                            §5(a)'s "first play"
 *                                            moment): the track's
 *                                            title + its creator, from
 *                                            server data — the room
 *                                            hears whose song this is
 *     { type: "drop.landed", drop }           a drop spectacle landed
 *                                            in this room (herald
 *                                            moment, room-scoped)
 *     { type: "drop.state", drop }            the room's drop now
 *                                            (also inside `welcome`);
 *                                            null = no drop stands
 *     { type: "drop.claimed", drop, claim }   a claim landed, witnessed
 *                                            by the room: claim.name
 *                                            + claim.amountVb are
 *                                            server truth
 *     { type: "drop.denied", reason }         a claim was refused
 *                                            (guests / no-drop /
 *                                            already-claimed /
 *                                            claimed-out / budget)
 *     { type: "peer.moment", moment }         a win, witnessed by the
 *                                            room (THE-GAME §5(a)):
 *                                            moment.kind "quest" →
 *                                            { peerId, name, questName,
 *                                            rewardVb } — the quest +
 *                                            reward read from the
 *                                            server's own claim
 *                                            record + QUEST_DEFS;
 *                                            moment.kind "levelup" →
 *                                            { peerId, name, stars } —
 *                                            the new Creator Level,
 *                                            read from the level
 *                                            rails and deduped per
 *                                            session. Wins are
 *                                            public; the moment
 *                                            carries NO balance and
 *                                            NO progress detail.
 *                                            SHAPE NOTE: `peer.moment`
 *                                            is deliberately
 *                                            announcement-shaped
 *                                            ({ kind, peerId, name,
 *                                            ... }) so the Ring 3
 *                                            palace-wide announce
 *                                            channel (THE-GAME §5(b))
 *                                            can adopt/extend this
 *                                            exact payload and carry
 *                                            it past the room's walls
 *                                            later — this lane does
 *                                            NOT build that channel;
 *                                            the moment speaks to
 *                                            this room only
 *     { type: "peer.hostmute", peerId, muted }  the host muted/unmuted
 *                                            a member's voice
 *     { type: "admin.denied" }                a host action attempted
 *                                            by a non-host
 *     { type: "removed", reason } then close 4413 — the host removed
 *                                            this peer from the hall
 *     { type: "replaced" } then close 4414 — this peer's own
 *                                            identity rejoined on a
 *                                            newer connection; this
 *                                            copy stepped aside
 *     { type: "room_full", cap } then close 4429 when at presence cap
 *     { type: "pong" }                       answer to the client's
 *                                            keepalive ping
 *
 * The keepalive is an APPLICATION frame on purpose. The gateway's
 * protocol-level ping (lib/live-ws.ts, every 30 s) never reaches the
 * browser: the hosting router terminates control frames on its own
 * leg (measured live, 2026-10-17 — six-minute guest sessions saw
 * zero protocol pings while data frames flowed normally), so a lone
 * guest standing still produces NO traffic on the browser's leg and
 * the router reaps the "idle" socket inside a couple of minutes.
 * The client's ping (every ~25 s while inside) and this pong are
 * data frames: they cross every leg, keep the path warm, and give
 * the client positive proof the path still carries frames — silence
 * past its liveness window means the path is dead, not quiet.
 *
 * The same router fact cuts the other way for PRESENCE: the router
 * answers the gateway's pings, so a dead or frozen browser's socket
 * can look alive to the server indefinitely — its close never
 * arrives and its peer would stand in the hall forever (measured
 * live, 2026-10-17: spawn-frozen guest ghosts an hour+ old; the
 * headcount lied). So frames are the only presence truth here
 * too: every inbound frame stamps the peer's lastSeenAt, the
 * palace sweeps peers silent past WORLD_PEER_STALE_MS, and a
 * rejoining identity (member account / guest tab session)
 * replaces its own ghost on the spot (see evictIdentity).
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
  /** The member's Creator Level stars (1–6), resolved by the route
   *  layer at the door from the API's own level rails (the highest
   *  level recorded in level_celebrations — the same record the
   *  /api/retention/level-check endpoint reads — defaulting to 1,
   *  the product's new-creator level, when nothing is recorded).
   *  Never a client claim. Guests carry none. The stars live on the
   *  peer record and render on the NAMEPLATE only (owner default,
   *  THE-GAME §5 Q1) — never on the character art. */
  stars?: number;
  /** Host authority, resolved by the route layer from the site's
   *  admin identity (ADMIN_EMAILS) at the handshake — a client can
   *  never claim it, and a guest is never an admin. */
  admin?: boolean;
  /** A guest's per-tab session id (the `?guest=` handshake param,
   *  sanitized by the route layer). Members never need it — their
   *  userId is their presence key. It exists so a guest's rejoin
   *  (reload, reconnect) can REPLACE its own lingering ghost peer
   *  instead of stacking a second "Guest" next to it: one tab,
   *  one presence. Two tabs hold two ids and stay two guests. */
  guestSessionId?: string | null;
}

/** The presence key two connections with the same identity share:
 *  members by account, guests by their tab's session id, and null
 *  for a connection carrying neither (a raw probe — it can linger
 *  only until the staleness sweep, never evict anyone). */
export function worldIdentityKey(
  identity: Pick<WorldIdentity, "userId" | "guestSessionId">,
): string | null {
  if (identity.userId) return `u:${identity.userId}`;
  if (identity.guestSessionId) return `g:${identity.guestSessionId}`;
  return null;
}

/** A Creative Vault character a member walks in as. Resolved
 *  server-side from the vault row the member owns — the client only
 *  ever sends the character's id, never a name or image URL, so a
 *  modified client can't dress itself in someone else's character.
 *  A character stands on its portrait (reference image) or, when
 *  the row carries a living asset instead, on its loop
 *  (reference video) — at least one of the two is always present;
 *  both ride the payload when the row has both. */
export interface WorldCharacterRef {
  id: string;
  name: string;
  portraitUrl: string | null;
  loopUrl: string | null;
  /** The character's stored voice-shaping profile (0142, G4), sanitized
   *  server-side from artist_vaults.voice_profile. Null/absent = no set
   *  voice — the member speaks as themselves. Only the SELF presence's
   *  profile is ever applied (shaping is send-side, on the speaker's
   *  own client); it rides the ref so the hall's resolution and the
   *  voice resolution stay one and the same pick. */
  voiceProfile?: import("./character-voice-profile").CharacterVoiceProfileStored | null;
}

/** The house palace guards — the World's approved default
 *  characters (owner approval, 2026-10-16: a male and a female King
 *  Shark guard). A guard pick is house property, not a vault row:
 *  there is no ownership to verify, so the room resolves these two
 *  ids itself and broadcasts the ref. The portrait URL is the
 *  figure's public slot; the scene stands the full-body guard
 *  figure for these ids, never the easel. Keep the ids in sync
 *  with the mirrored constants in the web client's figure lib. */
export const HOUSE_GUARD_ID = "house:palace-guard";
export const HOUSE_GUARD_FEMALE_ID = "house:palace-guard-female";
export const HOUSE_CHARACTER_REFS: Record<string, WorldCharacterRef> = {
  [HOUSE_GUARD_ID]: {
    id: HOUSE_GUARD_ID,
    name: "Palace Guard",
    portraitUrl: "/world/default-character.png",
    loopUrl: null,
  },
  [HOUSE_GUARD_FEMALE_ID]: {
    id: HOUSE_GUARD_FEMALE_ID,
    name: "Palace Guard — Female",
    portraitUrl: "/world/default-character-female.png",
    loopUrl: null,
  },
};

/** Injected by the route layer (which owns the DB): verify the
 *  character belongs to this user (or their active team) and carry
 *  a portrait or a living loop; return the ref to broadcast, or
 *  null to refuse the pick. */
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
  /** The booked World Event on the screen right now, when a
   *  scheduled stage show (item 3.1) holds the stage — late joiners
   *  read "LIVE: <title> by <hostName>" from this + the holder.
   *  Present only while a scheduled show holds; absent otherwise,
   *  so the walk-in shape is byte-identical to before. */
  event?: { id: string; title: string; hostName: string } | null;
}

/** Where a stage video is right now, from its server anchor. */
export function screenPositionAt(content: WorldScreenContent, nowMs: number): number {
  if (content.kind !== "video") return 0;
  const pb = content.playback;
  if (!pb.playing) return pb.anchorPosSec;
  return Math.max(0, pb.anchorPosSec + (nowMs - pb.anchorAtMs) / 1000);
}

/* ── The Music Hall jukebox ─────────────────────────────────────────
 * The Music Hall's room programming (plan Step 5): a shared queue
 * of real published songs, played for the whole room off ONE
 * server-stamped playback anchor — the same anchor math as the
 * stage's watch party, so every listener derives the same position
 * from the same stamp. Members add songs (id only; the injected
 * resolver re-verifies a real published track, exactly like
 * stage.video); guests listen. Transport (play/pause/skip) belongs
 * to whoever added the song that's playing — or the host. There is
 * no timer: the queue advances LAZILY, folded into every state read
 * and every jukebox frame, so a finished song hands over to the
 * next without a clock thread. Nothing is seeded: an untouched
 * jukebox is honestly idle. */

/** A published profile track the jukebox can play, resolved from an
 *  id the client picked from the catalog — never a URL it supplied. */
export interface WorldJukeboxTrackRef {
  id: string;
  title: string;
  url: string;
  /** Seconds; 0 = the row carries no duration (never auto-advances —
   *  it plays until someone skips it). */
  durationSec: number;
  creatorName: string | null;
  artworkUrl: string | null;
}

/** Injected by the route layer: verify a jukebox pick is a real,
 *  published, playable platform track (the member's own, or on a
 *  public profile); return the ref to broadcast, or null to refuse. */
export type WorldJukeboxTrackResolver = (
  userId: string,
  trackId: string,
) => Promise<WorldJukeboxTrackRef | null>;

/** One queued song: the track + who put it on (transport authority
 *  and the queue's honesty both ride on the adder). */
export interface WorldJukeboxEntry {
  entryId: string;
  track: WorldJukeboxTrackRef;
  addedByPeerId: string;
  addedByName: string;
  /** The adder's account id, when the entry was placed by the room
   *  itself for a booked listening party (its host may not be
   *  standing in the room under the same peerId the entry carries).
   *  Transport authority checks it alongside addedByPeerId. Absent
   *  on ordinary in-room adds — their shape is unchanged. */
  addedByUserId?: string;
}

/** The jukebox state every client in the Music Hall renders from —
 *  sent in `welcome` and broadcast as `jukebox.state` on change. */
export interface WorldJukeboxBroadcast {
  /** The song on now, with its position computed from the anchor at
   *  broadcast time (null = the jukebox is idle). */
  current: {
    entry: WorldJukeboxEntry;
    playback: { playing: boolean; positionSec: number };
  } | null;
  /** Up next, in order. */
  queue: WorldJukeboxEntry[];
  /** The booked listening party (item 3.2) whose queue this is, while
   *  one runs — present only then, so the open-queueing shape is
   *  byte-identical to before. */
  party?: { eventId: string; title: string; hostName: string } | null;
}

/* ── Drop spectacles (World Events, item 3.4) ──────────────────────
 * A booked drop lands IN a room at its hour. The room-scoped herald
 * frame (`drop.landed`) is deliberately shaped like a palace
 * announcement — { kind, title, roomId, roomName } plus the drop —
 * so the Ring 3 palace-wide announce channel (§5(b) of THE-GAME)
 * can adopt the same payload and carry it past the room's walls;
 * until then the herald speaks to the room the drop fell in, and
 * only that room can claim it: you had to BE there. Claims ride the
 * existing drop rails via the injected claimer (route layer owns
 * the DB + the weekly drop budget); the room owns the spectacle:
 * who is standing here, who already claimed, how many claims stand. */

/** The room's standing drop, as every client in the room renders it. */
export interface WorldDropBroadcast {
  eventId: string;
  title: string;
  roomId: string;
  roomName: string;
  amountVb: number;
  claimCap: number;
  claimsLeft: number;
}

/** Injected by the route layer: pay one claim through the existing
 *  drop rails (combined weekly drop budget + credit grant + drop
 *  ledger). The room calls it only for a member standing in the room
 *  who hasn't claimed and while claims stand. */
export type WorldDropClaimer = (
  userId: string,
  amountVb: number,
  eventId: string,
) => Promise<{ ok: true } | { ok: false; reason: "budget" | "error" }>;

/* ── Witnessed moments (THE-GAME §5(a)) ────────────────────────────
 * Wins are public, progress is private (owner default, §5 Q3): when
 * a member claims a quest reward or their Creator Level rises, the
 * ROOM witnesses it — but only ever from the server's own records.
 * The client's `moment.celebrate` intent is a bare ask carrying no
 * facts; the two injected rails below are the only sources the
 * broadcast is built from. */

/** A quest claim the server recorded, recent enough to witness:
 *  the quest's key, its display name and its VB reward (both from
 *  QUEST_DEFS, via the route layer), and when the claim landed. */
export interface WorldQuestClaimFact {
  questKey: string;
  questName: string;
  rewardVb: number;
  claimedAtMs: number;
}

/** Injected by the route layer: the member's most recent recorded
 *  quest claim at or after `sinceMs` (quest_progress claimed rows),
 *  or null when none stands. */
export type WorldQuestClaimFinder = (
  userId: string,
  sinceMs: number,
) => Promise<WorldQuestClaimFact | null>;

/** Injected by the route layer: the member's CURRENT Creator Level
 *  stars from the level rails (the same read that resolves the
 *  identity's stars at the door), or null when no level is recorded
 *  (the levelup verification then refuses — nothing to witness). */
export type WorldStarsResolver = (userId: string) => Promise<number | null>;

/** How fresh a quest claim must be for a celebrate intent to
 *  witness it. The claim flow fires the intent the moment the claim
 *  lands; two minutes leaves generous room for the round trip
 *  without letting a stale claim be re-announced all evening. */
export const MOMENT_QUEST_WINDOW_MS = 2 * 60_000;

/** At most one witnessed moment per peer per this interval — the
 *  room celebrates wins, it does not spam them. The slot is spent
 *  by the ATTEMPT, verified or not, so a runaway client can't turn
 *  the intent into a DB query pump either. */
export const MOMENT_MIN_INTERVAL_MS = 3_000;

/** The queue never grows past this — a runaway adder can't bury the
 *  room's evening under one person's catalog. */
export const JUKEBOX_QUEUE_CAP = 20;

/**
 * Avatar actions (owner order: "the avatar should be able to do
 * things"). One id set, mirrored by the client's lib/world/actions.ts.
 * "once" actions play through and settle; "toggle" actions (dance,
 * sit) hold until toggled off, replaced — or the wearer walks: a
 * move frame clears a held toggle server-side too, so a stale dance
 * can never outlive the walk that ended it.
 */
export const WORLD_ACTIONS = {
  bow: "once",
  wave: "once",
  cheer: "once",
  clap: "once",
  spin: "once",
  dance: "toggle",
  sit: "toggle",
} as const;
export type WorldActionId = keyof typeof WORLD_ACTIONS;

/** One action frame per peer per ~half second at most. */
export const ACTION_MIN_INTERVAL_MS = 500;

/** How long a one-shot action rides the peer DTO (welcome/join
 *  snapshots). The client's longest one-shot is 1.7 s; past this
 *  window the action has plainly finished wherever it played, and
 *  the DTO stops reporting it — otherwise a late joiner would meet
 *  a room where someone bows on loop forever. Toggles never
 *  expire here: they end by frame, or by the walk that clears
 *  them. */
export const ACTION_SNAPSHOT_MS = 2500;

/**
 * Per-instance room configuration. The King's Hall is the default
 * (bounds, spawn arc, stage); the palace registry (world-palace.ts)
 * constructs one WorldRoom per palace room with its own id, bounds
 * and spawn — and only the hall gets the stage/screen authority.
 */
export interface WorldRoomOptions {
  roomId?: string;
  name?: string;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn?: { x: number; z: number };
  stageEnabled?: boolean;
  /** Runs a jukebox (the Music Hall's queue + shared playback).
   *  Every other room refuses the jukebox frames. */
  jukeboxEnabled?: boolean;
}

/**
 * What a doorway transfer carries across: the peer keeps ONE identity
 * palace-wide — same peerId, same character, same voice flags — while
 * presence (and its voice mesh) becomes the new room's.
 */
export interface WorldTransferState {
  identity: WorldIdentity;
  peerId: string;
  character: WorldCharacterRef | null;
  voiceOff: boolean;
  voiceDeaf: boolean;
  /** The session's witnessed-moment dedupe high-water mark: the
   *  highest stars this peer's session has already announced. It
   *  crosses doorways with the peer (the identity's `stars` rides
   *  inside `identity` itself) so a transfer can never replay a
   *  level-up the palace already witnessed. */
  announcedStars: number;
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
  /** The member's Creator Level stars (1–6) — present on members
   *  only; guests carry no stars. Rendered on the nameplate beside
   *  the name, never on the character art (THE-GAME §5 Q1). */
  stars?: number;
  /** The host muted this member's voice server-side: out of the
   *  mesh, and voice.join is refused until the host unmutes. */
  hostMuted: boolean;
  character: WorldCharacterRef | null;
  /** The avatar action this presence is performing right now
   *  (toggles persist in the snapshot so a late joiner walks into
   *  the dance already in progress). */
  action: WorldActionId | null;
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
  /** The action being performed + when it started (server clock) —
   *  the snapshot carries the id; clients replay the pose from
   *  their own receipt time, which is close enough for an emote. */
  action: { id: WorldActionId; at: number } | null;
  lastActionAt: number;
  /** Creator Level stars as the room currently states them (the
   *  door-resolved identity value; a witnessed level-up restars it
   *  in place so late joiners read the new rank). Undefined for
   *  guests. */
  stars: number | undefined;
  /** The highest stars this peer's session has already witnessed
   *  announced (levelup dedupe): seeded from the join stars, raised
   *  by every levelup broadcast, carried across doorways. */
  announcedStars: number;
  /** The last moment.celebrate attempt (rate gate — see
   *  MOMENT_MIN_INTERVAL_MS). */
  lastMomentAt: number;
  /** The last quest claim this session witnessed, keyed
   *  `<questKey>@<claimedAtMs>` — one claim, one moment, even if
   *  the intent is re-sent inside the freshness window. */
  lastQuestMomentKey: string | null;
  x: number;
  y: number;
  z: number;
  rotY: number;
  lastMoveAt: number;
  lastSayAt: number;
  /** The last time ANY frame arrived from this peer (attach counts
   *  as arrival). The staleness sweep reads it — see
   *  WORLD_PEER_STALE_MS for why frames, not socket state, are
   *  the presence truth. */
  lastSeenAt: number;
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

/** Close code when a peer is REPLACED by its own identity rejoining
 *  (same account, or same guest tab session): the evicted client
 *  shows its honest "you're in the World in another tab" card and
 *  never auto-reconnects — otherwise two tabs of one person would
 *  evict each other forever. */
export const WORLD_REPLACED_CLOSE_CODE = 4414;

/** How long a peer may go without a single inbound frame before
 *  the palace declares it gone and reaps it. Presence truth lives
 *  or dies on this number, because the socket's own close event
 *  cannot be trusted to arrive: the hosting router answers the
 *  gateway's protocol pings on its own leg, so a browser that
 *  died, froze or was discarded can leave a server-side socket
 *  that looks alive forever while its peer stands in the hall
 *  (measured live 2026-10-17: five spawn-frozen guest ghosts
 *  outlived their sessions by an hour+ and a returning owner was
 *  told "12 people" were inside). The ONLY liveness signal that
 *  crosses the router is application data — the client's app
 *  keepalive pings every 25 s inside (and ~60 s from a throttled
 *  background tab), and any other frame counts too. 90 s is
 *  three missed foreground pings with margin over the background
 *  cadence; a client wrongly reaped anyway recovers through its
 *  quiet reconnect, while a corpse is gone from the count. */
export const WORLD_PEER_STALE_MS = 90_000;

interface StageHolder {
  peerId: string;
  userId: string;
  name: string;
  slug: string | null;
}

export class WorldRoom {
  /** This room's hub channel + public id (the palace directory keys
   *  rooms by it). The hall keeps the original channel id, so the
   *  palace arrived without changing the hall's wire identity. */
  readonly roomId: string;
  /** The name on the door — shown in the directory and the welcome. */
  readonly roomName: string;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly spawnPoint: { x: number; z: number };
  /** Stage/screen authority lives in exactly one room: the hall.
   *  Other rooms refuse the stage frames (the screen is not theirs
   *  to hold) instead of growing a second authority. */
  readonly stageEnabled: boolean;
  /** The jukebox lives in exactly one room too: the Music Hall. */
  readonly jukeboxEnabled: boolean;
  /** Fired when anything the palace directory shows changes
   *  (membership, stage holder). The palace registry wires it to
   *  rebroadcast the directory; a standalone room leaves it unset. */
  onChange: (() => void) | null = null;
  /** Fired when the host of a SCHEDULED stage show ends it early
   *  through the existing stage controls (or walks out mid-live) —
   *  the events scheduler wires it to close the event row. Never
   *  fired for walk-in shows. */
  onScheduledShowEnded: ((eventId: string) => void) | null = null;
  private peers = new Map<WsClientSocket, WorldPeer>();
  private byPeerId = new Map<string, WorldPeer>();
  private counter = 0;
  /** The latest frame time this room has seen — the room's clock.
   *  DTO snapshot expiry (one-shot actions) reads it, so injected
   *  time in tests and gateway time in production stay one story. */
  private frameNow = 0;
  /** The stage: one holder, and the screen is theirs. Null = the
   *  stage is free and the screen runs its ambient programming. */
  private stageHolder: StageHolder | null = null;
  private screenContent: WorldScreenContent = { kind: "reel" };
  /** Bumped on every stage claim so a slow verification can't land
   *  after a newer claim (or a release) and resurrect a dead show. */
  private stageSeq = 0;
  /** The jukebox: the song on now (the queue's head, kept apart so
   *  the queue is strictly "up next"), its playback anchor, and the
   *  up-next list. An idle jukebox is current=null, queue empty. */
  private jukeboxCurrent: {
    entry: WorldJukeboxEntry;
    playback: { playing: boolean; anchorPosSec: number; anchorAtMs: number };
  } | null = null;
  private jukeboxQueue: WorldJukeboxEntry[] = [];
  private jukeboxEntryCounter = 0;
  /** The entry the room was last told is playing — the now-playing
   *  moment (§5(a)) fires exactly once per song start, when this
   *  changes to a new entry. */
  private lastNowPlayingEntryId: string | null = null;
  /** The booked stage show (World Events 3.1) currently holding the
   *  stage, when one is. The holder may be a pseudo-peer (the host
   *  isn't in the room — a booked video plays anyway); the host's
   *  account id is the authority key for their stage controls. */
  private scheduledShow: {
    eventId: string;
    hostUserId: string;
    title: string;
    hostName: string;
  } | null = null;
  /** The booked listening party (3.2) whose queue the jukebox is
   *  running, when one is. While it stands, the queue is the
   *  party's — open adds are refused (see jukebox.add). */
  private listeningParty: {
    eventId: string;
    hostUserId: string;
    title: string;
    hostName: string;
  } | null = null;
  /** The drop spectacle (3.4) standing in this room, when one has
   *  landed and not yet been swept. Claims are reserved
   *  synchronously (claimedUserIds + claimsLeft move BEFORE the
   *  async payout runs) so two fast claims can't both take the
   *  last spot; a failed payout rolls its reservation back. */
  private activeDrop: {
    eventId: string;
    title: string;
    amountVb: number;
    claimCap: number;
    claimsLeft: number;
    claimedUserIds: Set<string>;
  } | null = null;

  constructor(
    private hub: RoomHub,
    private deps: {
      resolveCharacter?: WorldCharacterResolver;
      resolveStageStream?: WorldStageStreamResolver;
      resolveScreenVideo?: WorldScreenVideoResolver;
      resolveJukeboxTrack?: WorldJukeboxTrackResolver;
      claimWorldDrop?: WorldDropClaimer;
      resolveStars?: WorldStarsResolver;
      findRecentQuestClaim?: WorldQuestClaimFinder;
    } = {},
    opts: WorldRoomOptions = {},
  ) {
    this.roomId = opts.roomId ?? WORLD_ROOM_ID;
    this.roomName = opts.name ?? "The King's Hall";
    this.bounds = opts.bounds ?? HALL_BOUNDS;
    this.spawnPoint = opts.spawn ?? { x: 0, z: 9.5 };
    this.stageEnabled = opts.stageEnabled ?? this.roomId === WORLD_ROOM_ID;
    this.jukeboxEnabled = opts.jukeboxEnabled ?? false;
  }

  size(): number {
    return this.peers.size;
  }

  /** Display names inside, for the palace directory ("your people
   *  are in the Music Hall" is the whole point of the board). */
  memberNames(): string[] {
    return [...this.peers.values()].map((p) => p.displayName);
  }

  /** A show is on the stage (the directory's LIVE flag). */
  stageHeld(): boolean {
    return this.stageHolder !== null;
  }

  /** Clamp a proposed position into this room's bounds — doorway
   *  transfers land where the walker actually crossed, clamped. */
  clampToBounds(x: number, z: number): { x: number; z: number } {
    return {
      x: clamp(x, this.bounds.minX, this.bounds.maxX),
      z: clamp(z, this.bounds.minZ, this.bounds.maxZ),
    };
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
    // One-shots expire out of the snapshot (see ACTION_SNAPSHOT_MS);
    // the stored record clears with them so every reader agrees.
    // Measured on the room's frame clock (handleFrame's `now`),
    // never the wall clock — the two must never disagree.
    if (
      peer.action &&
      WORLD_ACTIONS[peer.action.id] === "once" &&
      this.frameNow - peer.action.at > ACTION_SNAPSHOT_MS
    ) {
      peer.action = null;
    }
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
      /* Stars ride members only — the field is absent (not null)
       * on guests, so an older client sees a byte-identical guest
       * record and a member record differs only by the addition. */
      ...(typeof peer.stars === "number" ? { stars: peer.stars } : {}),
      character: peer.character,
      action: peer.action?.id ?? null,
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
   *  close) when the room is at its presence cap. A doorway transfer
   *  passes `carry`: the peer keeps its peerId, character and voice
   *  flags, and lands at the crossing point instead of the spawn. */
  attach(
    socket: WsClientSocket,
    identity: WorldIdentity,
    carry?: {
      peerId?: string;
      character?: WorldCharacterRef | null;
      voiceOff?: boolean;
      voiceDeaf?: boolean;
      /** The session's levelup-announce high-water mark, carried
       *  across a doorway (see WorldTransferState). */
      announcedStars?: number;
      at?: { x: number; z: number; rotY?: number };
    },
  ): boolean {
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
    const peerId = carry?.peerId ?? `w${this.counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    /* Stars: members only, and only a sane 1–6 the door resolved —
     * anything else (a guest, a malformed identity) carries none. */
    const stars =
      identity.userId !== null &&
      typeof identity.stars === "number" &&
      Number.isInteger(identity.stars) &&
      identity.stars >= 1 &&
      identity.stars <= 6
        ? identity.stars
        : undefined;
    /* Spawn in a loose arc at the room entrance so arrivals don't stack
     * inside each other. */
    const slot = this.counter % 10;
    const at = carry?.at ? this.clampToBounds(carry.at.x, carry.at.z) : null;
    const peer: WorldPeer = {
      ...identity,
      peerId,
      socket,
      tint: tintForKey(identity.profileSlug ?? identity.userId ?? peerId),
      guest: identity.userId === null,
      voice: false,
      voiceOff: carry?.voiceOff === true,
      voiceDeaf: carry?.voiceDeaf === true,
      admin: identity.userId !== null && identity.admin === true,
      hostMuted: false,
      character: carry?.character ?? null,
      characterSeq: 0,
      action: null,
      lastActionAt: 0,
      stars,
      /* The dedupe seed: a doorway carry keeps the session's mark;
       * a fresh join seeds from the join stars themselves — the
       * level you walked in with is never "news" to announce. */
      announcedStars: carry?.announcedStars ?? stars ?? 0,
      lastMomentAt: 0,
      lastQuestMomentKey: null,
      x: at ? at.x : this.spawnPoint.x + (slot - 4.5) * 1.1,
      y: 0,
      z: at ? at.z : this.spawnPoint.z,
      /* Heading convention (shared with the client): rotY 0 faces the
       * stage/screen at the front of the hall (-Z). */
      rotY: carry?.at?.rotY ?? 0,
      lastMoveAt: 0,
      lastSayAt: 0,
      lastSeenAt: Date.now(),
    };
    this.peers.set(socket, peer);
    this.byPeerId.set(peerId, peer);
    this.hub.join(this.roomId, socket);

    const snapshot = [...this.peers.values()]
      .filter((p) => p !== peer)
      .map((p) => this.dto(p));
    this.send(peer, {
      type: "welcome",
      peerId,
      room: { id: this.roomId, name: this.roomName },
      you: this.dto(peer),
      peers: snapshot,
      // Late joiners land on the right screen: the stage as it stands.
      // Only the stage room carries screen state; other rooms omit it
      // and the client keeps the hall's last known state.
      ...(this.stageEnabled ? { screen: this.screenBroadcast() } : {}),
      // Same rule for the jukebox: only the Music Hall carries it,
      // and a late joiner lands mid-song at the room's position.
      ...(this.jukeboxEnabled ? { jukebox: this.jukeboxBroadcast() } : {}),
      // A drop standing in the room greets a late joiner too — the
      // chest is part of the room's state, not a one-off frame.
      ...(this.activeDrop ? { drop: this.dropBroadcast() } : {}),
    });
    // The joiner never hears its own join — `welcome` already told it
    // everything about itself; peer.join is strictly for the room.
    this.broadcastExcept(peer, { type: "peer.join", peer: this.dto(peer) });
    this.onChange?.();
    return true;
  }

  /** The transferable state of the peer on this socket, or null when
   *  the socket isn't in this room. Read BEFORE detach; the palace
   *  registry hands it to the destination room's attach. */
  peekTransferState(socket: WsClientSocket): WorldTransferState | null {
    const peer = this.peers.get(socket);
    if (!peer) return null;
    return {
      identity: {
        userId: peer.userId,
        displayName: peer.displayName,
        avatarUrl: peer.avatarUrl,
        profileSlug: peer.profileSlug,
        admin: peer.admin,
        /* The CURRENT stars (a level-up may have restarred the
         * peer since the door) — the destination room's record
         * starts from the rank the palace last stated. */
        stars: peer.stars,
      },
      peerId: peer.peerId,
      character: peer.character,
      voiceOff: peer.voiceOff,
      voiceDeaf: peer.voiceDeaf,
      announcedStars: peer.announcedStars,
    };
  }

  /** Remove a socket's peer (disconnect / error / doorway transfer).
   *  Broadcasts the despawn; also a voice departure when they were in
   *  the mesh — walking through a doorway ends the voice session,
   *  because the mesh is this room's. */
  detach(socket: WsClientSocket): void {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    this.byPeerId.delete(peer.peerId);
    this.hub.leave(this.roomId, socket);
    if (peer.voice) {
      this.hub.broadcast(this.roomId, { type: "voice.left", peerId: peer.peerId });
    }
    /* No orphaned stage: the holder leaving ends the show and the
     * screen falls back to the Reel for everyone still inside. */
    if (this.stageHolder?.peerId === peer.peerId) {
      this.stageHolder = null;
      this.screenContent = { kind: "reel" };
      this.stageSeq++;
      /* A scheduled host walking out mid-show ends the booked show
       * too (the scheduler closes the row). A booked VIDEO show
       * whose holder is the event pseudo-peer is untouched by the
       * host's comings and goings — the room keeps watching. */
      if (this.scheduledShow && this.scheduledShow.hostUserId === peer.userId) {
        const eventId = this.scheduledShow.eventId;
        this.scheduledShow = null;
        this.onScheduledShowEnded?.(eventId);
      }
      this.hub.broadcast(this.roomId, {
        type: "screen.state",
        screen: this.screenBroadcast(`${peer.displayName}'s show has ended.`),
      });
    }
    /* The jukebox is room programming: a song keeps playing for
     * whoever is still inside when its adder walks out (transport
     * falls to the host). But an EMPTY room resets it — nobody's
     * queue should drain into the void and greet the next visitor
     * half-finished. */
    if (this.jukeboxEnabled && this.peers.size === 0) {
      this.jukeboxCurrent = null;
      this.jukeboxQueue = [];
      /* A party whose room emptied is no longer running here — the
       * events scheduler sees the room not carrying it and re-drives
       * the start while its slot lasts. */
      this.listeningParty = null;
      this.lastNowPlayingEntryId = null;
    }
    this.hub.broadcast(this.roomId, { type: "peer.leave", peerId: peer.peerId });
    this.onChange?.();
  }

  /** Reap every peer that has gone frame-silent past
   *  WORLD_PEER_STALE_MS: its client is dead, frozen or discarded,
   *  whatever its socket still claims (see the constant for the
   *  router evidence). The detach is the truth-telling — the count
   *  and the directory drop the ghost the moment this runs — and
   *  the terminate buries the socket so its close handler meets
   *  an already-empty chair (detach is idempotent). Returns how
   *  many ghosts were reaped. */
  sweepStalePeers(now = Date.now()): number {
    const stale = [...this.peers.values()].filter((p) => now - p.lastSeenAt > WORLD_PEER_STALE_MS);
    for (const peer of stale) {
      this.detach(peer.socket);
      try {
        peer.socket.terminate();
      } catch {
        /* already gone — the detach was the point */
      }
    }
    return stale.length;
  }

  /** Evict this room's peer for an identity key when that identity
   *  is rejoining on a DIFFERENT socket: a rejoin replaces its own
   *  ghost instead of stacking beside it. The evicted peer gets
   *  the `replaced` frame and a WORLD_REPLACED close so a live
   *  client (the same person in a second tab) lands on its honest
   *  replaced card instead of reconnect-fighting its replacement;
   *  a corpse never reads the frame and is simply gone from the
   *  count. Returns how many peers were evicted. */
  evictIdentity(key: string, exceptSocket: WsClientSocket): number {
    const matches = [...this.peers.values()].filter(
      (p) => p.socket !== exceptSocket && worldIdentityKey(p) === key,
    );
    for (const peer of matches) {
      try {
        peer.socket.send(JSON.stringify({ type: "replaced" }));
      } catch {
        /* a corpse can't read — the detach below is the point */
      }
      this.detach(peer.socket);
      try {
        peer.socket.close(WORLD_REPLACED_CLOSE_CODE, "replaced");
      } catch {
        /* already gone */
      }
    }
    return matches.length;
  }

  /* ── The stage + screen ─────────────────────────────────────────── */

  /** The screen state as every client renders it, right now. */
  screenBroadcast(notice: string | null = null, now = Date.now()): WorldScreenBroadcast {
    const holder = this.stageHolder
      ? { peerId: this.stageHolder.peerId, name: this.stageHolder.name, slug: this.stageHolder.slug }
      : null;
    const content = this.screenContent;
    /* The booked event rides only while its show holds the stage. */
    const event = this.scheduledShow
      ? {
          id: this.scheduledShow.eventId,
          title: this.scheduledShow.title,
          hostName: this.scheduledShow.hostName,
        }
      : null;
    const withEvent = event ? { event } : {};
    if (!holder || content.kind === "reel") {
      return { mode: "reel", holder, title: null, streamId: null, video: null, playback: null, notice, ...withEvent };
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
        ...withEvent,
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
      ...withEvent,
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

  /* ── World Events drivers (the scheduler's hands) ─────────────────
   * The events scheduler (lib/world-events) drives booked moments
   * through these methods; the room stays the only authority over
   * its stage, jukebox and floor. Every method is idempotent from
   * the scheduler's side: starting what's already running is a
   * refusal, ending what isn't running is a no-op. */

  /** The peer standing in this room for an account, if any. */
  private peerForUserId(userId: string): WorldPeer | null {
    for (const p of this.peers.values()) if (p.userId === userId) return p;
    return null;
  }

  /** Is this peer the booked host of the scheduled show on stage? */
  private isScheduledHost(peer: WorldPeer): boolean {
    return this.scheduledShow !== null && peer.userId === this.scheduledShow.hostUserId;
  }

  /** The booked stage show currently holding the stage, if any. */
  scheduledShowEventId(): string | null {
    return this.scheduledShow?.eventId ?? null;
  }

  /**
   * Start a booked stage show (item 3.1): the screen takes the
   * booked content under the host's name. Refuses (false) when a
   * DIFFERENT show — walk-in or booked — holds the stage: a booking
   * never hijacks a live hand; the scheduler retries until the slot
   * ends. The holder is the host's own peer when they're standing
   * in the hall, else an event pseudo-peer the host's account still
   * controls (their stage controls match by account).
   */
  beginScheduledShow(input: {
    eventId: string;
    hostUserId: string;
    hostName: string;
    hostSlug: string | null;
    title: string;
    content: WorldScreenContent;
  }): boolean {
    if (!this.stageEnabled) return false;
    if (this.scheduledShow?.eventId === input.eventId) return true;
    if (this.stageHolder) return false;
    const hostPeer = this.peerForUserId(input.hostUserId);
    this.stageHolder = {
      peerId: hostPeer?.peerId ?? `event:${input.eventId}`,
      userId: input.hostUserId,
      name: input.hostName,
      slug: input.hostSlug,
    };
    this.scheduledShow = {
      eventId: input.eventId,
      hostUserId: input.hostUserId,
      title: input.title,
      hostName: input.hostName,
    };
    this.screenContent = input.content;
    this.stageSeq++;
    this.broadcastScreen(`LIVE: ${input.title} by ${input.hostName}`);
    this.onChange?.();
    return true;
  }

  /** End a booked stage show (its slot ran out, or it was
   *  cancelled): the stage releases and the screen returns to the
   *  King's Reel — an overrun show ends here too, whoever is mid-
   *  performance. No-op when this event isn't the one on stage. */
  endScheduledShow(eventId: string, notice: string | null = null): boolean {
    if (!this.scheduledShow || this.scheduledShow.eventId !== eventId) return false;
    this.scheduledShow = null;
    this.stageHolder = null;
    this.screenContent = { kind: "reel" };
    this.stageSeq++;
    this.broadcastScreen(notice);
    this.onChange?.();
    return true;
  }

  /** The booked listening party the jukebox is running, if any. */
  listeningPartyEventId(): string | null {
    return this.listeningParty?.eventId ?? null;
  }

  /**
   * Start a booked listening party (item 3.2): the jukebox takes the
   * party's queue, in order, under the host's name — replacing
   * whatever open queueing had lined up (the party IS the room's
   * programming for its slot). The room hears it in sync off the
   * same anchor as any jukebox song.
   */
  beginListeningParty(input: {
    eventId: string;
    hostUserId: string;
    hostName: string;
    title: string;
    tracks: WorldJukeboxTrackRef[];
    now: number;
  }): boolean {
    if (!this.jukeboxEnabled) return false;
    if (this.listeningParty?.eventId === input.eventId) return true;
    if (input.tracks.length === 0) return false;
    const hostPeer = this.peerForUserId(input.hostUserId);
    const entries: WorldJukeboxEntry[] = input.tracks.map((track) => ({
      entryId: `j${++this.jukeboxEntryCounter}`,
      track,
      addedByPeerId: hostPeer?.peerId ?? `event:${input.eventId}`,
      addedByName: input.hostName,
      addedByUserId: input.hostUserId,
    }));
    this.listeningParty = {
      eventId: input.eventId,
      hostUserId: input.hostUserId,
      title: input.title,
      hostName: input.hostName,
    };
    const [first, ...rest] = entries;
    this.jukeboxCurrent = {
      entry: first!,
      playback: { playing: true, anchorPosSec: 0, anchorAtMs: input.now },
    };
    this.jukeboxQueue = rest;
    this.broadcastJukebox(input.now);
    return true;
  }

  /** End a booked listening party: the jukebox returns to open
   *  queueing — honestly idle until the room queues something. */
  endListeningParty(eventId: string): boolean {
    if (!this.listeningParty || this.listeningParty.eventId !== eventId) return false;
    this.listeningParty = null;
    this.jukeboxCurrent = null;
    this.jukeboxQueue = [];
    this.broadcastJukebox(Date.now());
    return true;
  }

  /** The drop spectacle standing in this room, if any. */
  activeDropEventId(): string | null {
    return this.activeDrop?.eventId ?? null;
  }

  /** The room's standing drop as clients render it. */
  dropBroadcast(): WorldDropBroadcast | null {
    if (!this.activeDrop) return null;
    return {
      eventId: this.activeDrop.eventId,
      title: this.activeDrop.title,
      roomId: this.roomId,
      roomName: this.roomName,
      amountVb: this.activeDrop.amountVb,
      claimCap: this.activeDrop.claimCap,
      claimsLeft: this.activeDrop.claimsLeft,
    };
  }

  /**
   * Land a booked drop in this room (item 3.4): the chest appears
   * and the room gets its herald moment. `drop.landed` is ROOM-
   * scoped on purpose — this lane builds no palace-wide announce
   * channel (that's Ring 3 §5(b)) — but its payload is announcement-
   * shaped ({kind, title, roomId, roomName, drop}) so that channel
   * can adopt it verbatim later.
   */
  landDrop(input: { eventId: string; title: string; amountVb: number; claimCap: number }): boolean {
    if (this.activeDrop?.eventId === input.eventId) return true;
    if (this.activeDrop) return false; // one chest at a time in a room
    this.activeDrop = {
      eventId: input.eventId,
      title: input.title,
      amountVb: input.amountVb,
      claimCap: input.claimCap,
      claimsLeft: input.claimCap,
      claimedUserIds: new Set(),
    };
    this.hub.broadcast(this.roomId, {
      type: "drop.landed",
      kind: "drop",
      title: input.title,
      roomId: this.roomId,
      roomName: this.roomName,
      drop: this.dropBroadcast(),
    });
    return true;
  }

  /** Sweep a landed drop (slot over or cancelled). Late claims after
   *  this find no chest — drop.denied "no-drop". */
  endDrop(eventId: string): boolean {
    if (!this.activeDrop || this.activeDrop.eventId !== eventId) return false;
    this.activeDrop = null;
    this.hub.broadcast(this.roomId, { type: "drop.state", drop: null });
    return true;
  }

  /* ── The jukebox (Music Hall) ───────────────────────────────────── */

  /** Where the current song is right now, from its anchor. */
  private jukeboxPositionAt(now: number): number {
    const cur = this.jukeboxCurrent;
    if (!cur) return 0;
    if (!cur.playback.playing) return cur.playback.anchorPosSec;
    return Math.max(0, cur.playback.anchorPosSec + (now - cur.playback.anchorAtMs) / 1000);
  }

  /** The jukebox state as every client renders it, right now. A
   *  read folds in any lazy advance first, so the state is never
   *  stale by a finished song. */
  jukeboxBroadcast(now = Date.now()): WorldJukeboxBroadcast {
    this.advanceJukebox(now);
    const cur = this.jukeboxCurrent;
    return {
      current: cur
        ? {
            entry: cur.entry,
            playback: { playing: cur.playback.playing, positionSec: this.jukeboxPositionAt(now) },
          }
        : null,
      queue: [...this.jukeboxQueue],
      ...(this.listeningParty
        ? {
            party: {
              eventId: this.listeningParty.eventId,
              title: this.listeningParty.title,
              hostName: this.listeningParty.hostName,
            },
          }
        : {}),
    };
  }

  private broadcastJukebox(now: number): void {
    const jukebox = this.jukeboxBroadcast(now);
    this.hub.broadcast(this.roomId, { type: "jukebox.state", jukebox });
    /* §5(a) first-play moment: a NEW song just started — the room is
     * told whose it is (title + creator, both server-resolved when
     * the track was verified). Fires once per entry start: adds,
     * skips, lazy advances folded into a change broadcast, and party
     * starts all pass through here; plain state re-reads (welcome)
     * never re-announce a song already playing. */
    const currentEntryId = jukebox.current?.entry.entryId ?? null;
    if (currentEntryId !== this.lastNowPlayingEntryId) {
      this.lastNowPlayingEntryId = currentEntryId;
      if (jukebox.current) {
        const { entry } = jukebox.current;
        this.hub.broadcast(this.roomId, {
          type: "jukebox.nowplaying",
          moment: {
            entryId: entry.entryId,
            trackId: entry.track.id,
            title: entry.track.title,
            creatorName: entry.track.creatorName,
            addedByName: entry.addedByName,
          },
        });
      }
    }
  }

  /** Lazy advance — no timers. A PLAYING song whose position has run
   *  past its (known) duration hands over to the queue's head,
   *  carrying the overshoot into the next song's anchor so a chain
   *  of short songs stays in step. A paused song never advances;
   *  a song with no known duration never auto-advances. */
  private advanceJukebox(now: number): void {
    let guard = 0;
    while (this.jukeboxCurrent && guard++ < JUKEBOX_QUEUE_CAP + 2) {
      const cur = this.jukeboxCurrent;
      const dur = cur.entry.track.durationSec;
      if (!cur.playback.playing || !(dur > 0)) return;
      const pos = this.jukeboxPositionAt(now);
      if (pos < dur) return;
      const leftover = pos - dur;
      const next = this.jukeboxQueue.shift() ?? null;
      this.jukeboxCurrent = next
        ? {
            entry: next,
            playback: { playing: true, anchorPosSec: Math.min(leftover, Math.max(0, next.track.durationSec - 0.05)), anchorAtMs: now },
          }
        : null;
    }
  }

  /** Who may work the transport for the song on now: the member who
   *  added it — or the host, always. A listening-party entry's adder
   *  is its booked host, matched by account as well as by peer (the
   *  host may have walked in after the party started). */
  private canDriveJukebox(peer: WorldPeer): boolean {
    const cur = this.jukeboxCurrent;
    if (!cur) return peer.admin;
    return (
      peer.admin ||
      cur.entry.addedByPeerId === peer.peerId ||
      (cur.entry.addedByUserId != null && peer.userId === cur.entry.addedByUserId)
    );
  }

  /** Start the queue's head (or go idle when it's empty). The
   *  playing state carries across a skip: a paused jukebox stays
   *  paused on the new song, at zero. */
  private startNextJukebox(now: number, playing: boolean): void {
    const next = this.jukeboxQueue.shift() ?? null;
    this.jukeboxCurrent = next
      ? { entry: next, playback: { playing, anchorPosSec: 0, anchorAtMs: now } }
      : null;
  }

  private broadcastScreen(notice: string | null = null): void {
    this.hub.broadcast(this.roomId, { type: "screen.state", screen: this.screenBroadcast(notice) });
  }

  /** Who may drive the screen: its holder — or the host, always.
   *  A booked show's host drives it by ACCOUNT too: their holder
   *  record may be the event pseudo-peer (they booked it and the
   *  video started before they walked in). */
  private canControlScreen(peer: WorldPeer): boolean {
    return (
      peer.admin ||
      (this.stageHolder !== null && this.stageHolder.peerId === peer.peerId) ||
      this.isScheduledHost(peer)
    );
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
    /* Any arrived frame — parsed or not, keepalive ping included —
     * is proof of life at the only layer that crosses the hosting
     * router. The staleness sweep reads this stamp. */
    peer.lastSeenAt = now;
    if (now > this.frameNow) this.frameNow = now;
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    switch (frame["type"]) {
      case "ping": {
        /* Session keepalive: answered to the sender only — no
         * state, no broadcast, no rate bookkeeping. See the
         * protocol note at the top of this file for why this is an
         * application frame and not the gateway's protocol ping. */
        this.send(peer, { type: "pong" });
        return;
      }
      case "move": {
        if (now - peer.lastMoveAt < MOVE_MIN_INTERVAL_MS) return;
        peer.lastMoveAt = now;
        const prevX = peer.x;
        const prevZ = peer.z;
        peer.x = clamp(finiteOr(frame["x"], peer.x), this.bounds.minX, this.bounds.maxX);
        peer.z = clamp(finiteOr(frame["z"], peer.z), this.bounds.minZ, this.bounds.maxZ);
        peer.y = 0;
        const rot = finiteOr(frame["rotY"], peer.rotY);
        peer.rotY = Math.atan2(Math.sin(rot), Math.cos(rot));
        /* Walking ends a held toggle action (dance, sit) — the pose
         * layer reads movement the same way; the server mirrors it so
         * a fresh snapshot never shows a walker still dancing. */
        if (
          peer.action &&
          WORLD_ACTIONS[peer.action.id] === "toggle" &&
          Math.abs(peer.x - prevX) + Math.abs(peer.z - prevZ) > 0.05
        ) {
          peer.action = null;
          this.broadcastExcept(peer, { type: "peer.action", peerId: peer.peerId, action: null });
        }
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
      case "action": {
        /* Perform an avatar action. Everyone present performs —
         * guests included: an action is presence, not speech, and
         * the rate limit keeps it sane. The id must be one of the
         * shared WORLD_ACTIONS; anything else is ignored, so a
         * modified client can't invent poses the room renders. */
        if (now - peer.lastActionAt < ACTION_MIN_INTERVAL_MS) return;
        const raw = frame["action"];
        if (raw === null) {
          peer.lastActionAt = now;
          if (peer.action) {
            peer.action = null;
            this.broadcastExcept(peer, { type: "peer.action", peerId: peer.peerId, action: null });
          }
          return;
        }
        if (typeof raw !== "string" || !(raw in WORLD_ACTIONS)) return;
        const id = raw as WorldActionId;
        peer.lastActionAt = now;
        /* Re-performing the toggle you're holding turns it off —
         * the same press that started the dance ends it. */
        if (WORLD_ACTIONS[id] === "toggle" && peer.action?.id === id) {
          peer.action = null;
          this.broadcastExcept(peer, { type: "peer.action", peerId: peer.peerId, action: null });
          return;
        }
        peer.action = { id, at: now };
        this.broadcastExcept(peer, { type: "peer.action", peerId: peer.peerId, action: id });
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
        this.hub.broadcast(this.roomId, { type: "peer.say", peerId: peer.peerId, body });
        return;
      }
      case "character": {
        /* Walk in as a Creative Vault character. Members only (guests
         * have no vault). The client sends ONLY an id; the injected
         * resolver verifies ownership against the vault and returns
         * the name + portrait to broadcast — a refused pick (not
         * theirs, no portrait, vault row gone) changes nothing, so a
         * stale pick never strips a figure already standing. The two
         * house guard ids are the one exception: house property,
         * resolved by the room itself below. */
        if (peer.guest || !peer.userId) return;
        const raw = frame["characterId"];
        if (raw === null) {
          peer.characterSeq++;
          if (peer.character) {
            peer.character = null;
            this.hub.broadcast(this.roomId, {
              type: "peer.character",
              peerId: peer.peerId,
              character: null,
            });
          }
          return;
        }
        if (typeof raw !== "string" || !raw || raw.length > 64) return;
        if (peer.character?.id === raw) return;
        /* A house guard pick resolves right here — house property,
         * no vault, no resolver. It still rides the seq guard so a
         * slower vault resolution in flight can't land after it. */
        const houseRef = HOUSE_CHARACTER_REFS[raw];
        if (houseRef) {
          peer.characterSeq++;
          peer.character = houseRef;
          this.hub.broadcast(this.roomId, {
            type: "peer.character",
            peerId: peer.peerId,
            character: houseRef,
          });
          return;
        }
        const resolve = this.deps.resolveCharacter;
        if (!resolve) return;
        const seq = ++peer.characterSeq;
        void resolve(peer.userId, raw)
          .then((ref) => {
            if (!ref) return; // refused — keep whatever stands
            if (this.byPeerId.get(peer.peerId) !== peer) return; // left already
            if (peer.characterSeq !== seq) return; // a newer pick won
            peer.character = ref;
            this.hub.broadcast(this.roomId, {
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
        this.hub.broadcast(this.roomId, { type: "voice.joined", peerId: peer.peerId });
        this.send(peer, { type: "voice.state", voicePeerIds: this.voicePeerIds(peer) });
        return;
      }
      case "voice.leave": {
        if (!peer.voice) return;
        peer.voice = false;
        this.hub.broadcast(this.roomId, { type: "voice.left", peerId: peer.peerId });
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
          this.hub.broadcast(this.roomId, { type: "voice.left", peerId: peer.peerId });
        }
        if (off && peer.voiceDeaf) {
          /* Voice-off outranks deafen: the deafened mark clears on
           * the way out, so the plate tells the one story that
           * matters — this peer is out of voice entirely. */
          peer.voiceDeaf = false;
          this.hub.broadcast(this.roomId, { type: "peer.voicedeaf", peerId: peer.peerId, deaf: false });
        }
        peer.voiceOff = off;
        this.hub.broadcast(this.roomId, { type: "peer.voiceoff", peerId: peer.peerId, off });
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
        this.hub.broadcast(this.roomId, { type: "peer.voicedeaf", peerId: peer.peerId, deaf });
        return;
      }
      case "stage.live": {
        /* Take the stage with my live stream. The id is all the
         * client sends — the injected resolver verifies the stream
         * is mine and truly live before anything reaches a screen. */
        if (!this.stageEnabled) return;
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
        if (!this.stageEnabled) return;
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
      case "jukebox.add": {
        /* Put a song on the Music Hall jukebox. Members only —
         * guests listen. The id is all the client sends; the
         * injected resolver re-verifies a real published track
         * before anything reaches the room's speakers, exactly like
         * a stage.video pick. A refused pick changes nothing and
         * says so (jukebox.denied) instead of failing silently. */
        if (!this.jukeboxEnabled) return;
        if (peer.guest || !peer.userId) {
          this.send(peer, { type: "jukebox.denied", reason: "guests" });
          return;
        }
        /* A listening party owns the queue for its slot: open adds
         * wait for the party to end. The party's host (and the house
         * host) may still extend their own party's queue. */
        if (
          this.listeningParty &&
          !peer.admin &&
          peer.userId !== this.listeningParty.hostUserId
        ) {
          this.send(peer, { type: "jukebox.denied", reason: "listening-party" });
          return;
        }
        const trackId = typeof frame["trackId"] === "string" ? frame["trackId"] : "";
        if (!trackId || trackId.length > 96) return;
        const resolveTrack = this.deps.resolveJukeboxTrack;
        if (!resolveTrack) return;
        const userId = peer.userId;
        void resolveTrack(userId, trackId)
          .then((ref) => {
            if (this.byPeerId.get(peer.peerId) !== peer) return; // left already
            if (!ref) {
              this.send(peer, { type: "jukebox.denied", reason: "unplayable" });
              return;
            }
            /* Capacity is judged at landing time, not send time —
             * two adds in flight can't both slip past the cap. */
            this.advanceJukebox(now);
            const total = this.jukeboxQueue.length + (this.jukeboxCurrent ? 1 : 0);
            if (total >= JUKEBOX_QUEUE_CAP) {
              this.send(peer, { type: "jukebox.denied", reason: "queue-full" });
              return;
            }
            const entry: WorldJukeboxEntry = {
              entryId: `j${++this.jukeboxEntryCounter}`,
              track: ref,
              addedByPeerId: peer.peerId,
              addedByName: peer.displayName,
            };
            if (!this.jukeboxCurrent) {
              /* An idle jukebox starts the song now — adding IS
               * asking to hear it. */
              this.jukeboxCurrent = {
                entry,
                playback: { playing: true, anchorPosSec: 0, anchorAtMs: now },
              };
            } else {
              this.jukeboxQueue.push(entry);
            }
            this.broadcastJukebox(now);
          })
          .catch(() => undefined);
        return;
      }
      case "jukebox.playpause": {
        /* Shared play/pause, stamped by the server anchor: whoever
         * added the song on now (or the host) works the transport —
         * one hand on it, like the screen. */
        if (!this.jukeboxEnabled) return;
        this.advanceJukebox(now);
        const cur = this.jukeboxCurrent;
        if (!cur) return;
        if (!this.canDriveJukebox(peer)) {
          this.send(peer, { type: "jukebox.denied", reason: "not-yours" });
          return;
        }
        const playing = frame["playing"] === true;
        if (playing === cur.playback.playing) return;
        cur.playback = {
          playing,
          anchorPosSec: this.jukeboxPositionAt(now),
          anchorAtMs: now,
        };
        this.broadcastJukebox(now);
        return;
      }
      case "jukebox.skip": {
        /* End the song on now; the queue's head takes over in the
         * same playing state (a paused jukebox stays paused). */
        if (!this.jukeboxEnabled) return;
        this.advanceJukebox(now);
        if (!this.jukeboxCurrent) return;
        if (!this.canDriveJukebox(peer)) {
          this.send(peer, { type: "jukebox.denied", reason: "not-yours" });
          return;
        }
        this.startNextJukebox(now, this.jukeboxCurrent.playback.playing);
        this.broadcastJukebox(now);
        return;
      }
      case "jukebox.remove": {
        /* Pull one of YOUR queued songs back off (the host can pull
         * anyone's). The song on now is not removable here — skip
         * is the honest verb for that. */
        if (!this.jukeboxEnabled) return;
        const entryId = typeof frame["entryId"] === "string" ? frame["entryId"] : "";
        const idx = this.jukeboxQueue.findIndex((e) => e.entryId === entryId);
        if (idx < 0) return;
        const entry = this.jukeboxQueue[idx]!;
        if (
          !peer.admin &&
          entry.addedByPeerId !== peer.peerId &&
          !(entry.addedByUserId != null && peer.userId === entry.addedByUserId)
        ) {
          this.send(peer, { type: "jukebox.denied", reason: "not-yours" });
          return;
        }
        this.jukeboxQueue.splice(idx, 1);
        this.broadcastJukebox(now);
        return;
      }
      case "drop.claim": {
        /* Claim the drop that landed in THIS room. Members only —
         * guests watch spectacles, they don't hold a hand (the
         * access law + THE-GAME §5 Q5). First-come: the reservation
         * (claimsLeft + claimedUserIds) moves synchronously, before
         * the async payout, so two fast claims can't both take the
         * last spot; a failed payout rolls the reservation back and
         * the chest keeps its claim. A landed claim is WITNESSED:
         * the room sees who took it and how much — name + amount
         * from server truth, never a client claim. */
        if (peer.guest || !peer.userId) {
          this.send(peer, { type: "drop.denied", reason: "guests" });
          return;
        }
        const drop = this.activeDrop;
        if (!drop) {
          this.send(peer, { type: "drop.denied", reason: "no-drop" });
          return;
        }
        if (drop.claimedUserIds.has(peer.userId)) {
          this.send(peer, { type: "drop.denied", reason: "already-claimed" });
          return;
        }
        if (drop.claimsLeft <= 0) {
          this.send(peer, { type: "drop.denied", reason: "claimed-out" });
          return;
        }
        const claimer = this.deps.claimWorldDrop;
        if (!claimer) {
          this.send(peer, { type: "drop.denied", reason: "error" });
          return;
        }
        drop.claimedUserIds.add(peer.userId);
        drop.claimsLeft--;
        const userId = peer.userId;
        const claimName = peer.displayName;
        void claimer(userId, drop.amountVb, drop.eventId)
          .then((result) => {
            if (this.activeDrop !== drop) return; // swept mid-payout — the grant stands, the room has moved on
            if (!result.ok) {
              drop.claimedUserIds.delete(userId);
              drop.claimsLeft++;
              const claimant = this.peerForUserId(userId);
              if (claimant) {
                this.send(claimant, { type: "drop.denied", reason: result.reason });
              }
              return;
            }
            this.hub.broadcast(this.roomId, {
              type: "drop.claimed",
              drop: this.dropBroadcast(),
              claim: { name: claimName, amountVb: drop.amountVb },
            });
          })
          .catch(() => {
            if (this.activeDrop !== drop) return;
            drop.claimedUserIds.delete(userId);
            drop.claimsLeft++;
            const claimant = this.peerForUserId(userId);
            if (claimant) this.send(claimant, { type: "drop.denied", reason: "error" });
          });
        return;
      }
      case "moment.celebrate": {
        /* Witness a win (THE-GAME §5(a)): the room hears that a
         * quest was completed or a level rose — from the SERVER's
         * records, never the intent, which carries no facts at all
         * beyond the kind of win claimed. Guests witness, never
         * star: their intents are dropped here, silently, exactly
         * like their say frames. One moment per peer per
         * MOMENT_MIN_INTERVAL_MS; the attempt spends the slot. */
        if (peer.guest || !peer.userId) return;
        if (now - peer.lastMomentAt < MOMENT_MIN_INTERVAL_MS) return;
        peer.lastMomentAt = now;
        const kind = frame["kind"];
        if (kind === "quest") {
          const findClaim = this.deps.findRecentQuestClaim;
          if (!findClaim) return;
          const userId = peer.userId;
          void findClaim(userId, now - MOMENT_QUEST_WINDOW_MS)
            .then((claim) => {
              if (!claim) return; // no recorded claim — nothing to witness
              if (this.byPeerId.get(peer.peerId) !== peer) return; // left already
              /* The room re-checks the window on its own clock: a
               * finder that returns a stale claim anyway (a second
               * source, a clock skew) never gets witnessed. */
              if (claim.claimedAtMs < now - MOMENT_QUEST_WINDOW_MS) return;
              const claimKey = `${claim.questKey}@${claim.claimedAtMs}`;
              if (peer.lastQuestMomentKey === claimKey) return; // this claim already had its moment
              peer.lastQuestMomentKey = claimKey;
              this.hub.broadcast(this.roomId, {
                type: "peer.moment",
                moment: {
                  kind: "quest",
                  peerId: peer.peerId,
                  name: peer.displayName,
                  questName: claim.questName,
                  rewardVb: claim.rewardVb,
                },
              });
            })
            .catch(() => undefined);
          return;
        }
        if (kind === "levelup") {
          const resolveStars = this.deps.resolveStars;
          if (!resolveStars) return;
          const userId = peer.userId;
          void resolveStars(userId)
            .then((stars) => {
              if (typeof stars !== "number") return; // no level on record — nothing to witness
              if (this.byPeerId.get(peer.peerId) !== peer) return; // left already
              /* Session dedupe: only an INCREASE over the highest
               * stars this session has announced is news. A replay,
               * a rejoin at the same level, or a stale read changes
               * nothing and says nothing. */
              if (stars <= peer.announcedStars) return;
              peer.announcedStars = stars;
              /* The restar lands on the peer record itself, so the
               * room's snapshots (and a doorway transfer after it)
               * carry the new rank; clients apply it live off this
               * same broadcast. */
              peer.stars = stars;
              this.hub.broadcast(this.roomId, {
                type: "peer.moment",
                moment: {
                  kind: "levelup",
                  peerId: peer.peerId,
                  name: peer.displayName,
                  stars,
                },
              });
            })
            .catch(() => undefined);
          return;
        }
        return;
      }
      case "screen.reel": {
        /* The holder parks the screen on the King's Reel (the stage
         * itself stays held); the host can always do it too. */
        if (!this.stageEnabled) {
          this.denyScreen(peer);
          return;
        }
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
        if (!this.stageEnabled) {
          this.denyScreen(peer);
          return;
        }
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
        if (!this.stageEnabled) return;
        if (!this.stageHolder) return;
        if (!this.canControlScreen(peer)) {
          this.denyScreen(peer);
          return;
        }
        const wasMine = this.stageHolder.peerId === peer.peerId;
        this.stageHolder = null;
        this.screenContent = { kind: "reel" };
        this.stageSeq++;
        /* Ending a BOOKED show early closes the event too — the
         * scheduler hears it and marks the row done, so the slot
         * doesn't resurrect on the next tick. */
        if (this.scheduledShow) {
          const eventId = this.scheduledShow.eventId;
          this.scheduledShow = null;
          this.onScheduledShowEnded?.(eventId);
        }
        this.broadcastScreen(wasMine ? null : "The host ended the show.");
        this.onChange?.();
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
          this.hub.broadcast(this.roomId, { type: "voice.left", peerId: target.peerId });
        }
        this.hub.broadcast(this.roomId, { type: "peer.hostmute", peerId: target.peerId, muted });
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
    /* A booked show's host claims over their own event pseudo-peer
     *  holder — that's the "live" stage_show opening for its host:
     *  their stream takes the screen their booking opened. */
    const mineOrScheduled =
      this.stageHolder?.peerId === peer.peerId || this.isScheduledHost(peer);
    if (this.stageHolder && !mineOrScheduled && !peer.admin) {
      this.denyScreen(peer);
      return;
    }
    const seq = ++this.stageSeq;
    void resolve()
      .then((resolved) => {
        if (!resolved) return;
        if (this.byPeerId.get(peer.peerId) !== peer) return;
        if (this.stageSeq !== seq) return;
        if (
          this.stageHolder &&
          this.stageHolder.peerId !== peer.peerId &&
          !this.isScheduledHost(peer) &&
          !peer.admin
        )
          return;
        const takeover =
          this.stageHolder !== null && this.stageHolder.peerId !== peer.peerId;
        /* A host takeover displaces a booked show (the stage is the
         * host's, always): the event closes rather than lingering
         * as a label over someone else's show. The scheduled host
         * claiming over their own pseudo-peer is NOT a displacement
         * — it's their show going live. */
        if (this.scheduledShow && this.scheduledShow.hostUserId !== peer.userId) {
          const eventId = this.scheduledShow.eventId;
          this.scheduledShow = null;
          this.onScheduledShowEnded?.(eventId);
        }
        this.stageHolder = {
          peerId: peer.peerId,
          userId: peer.userId!,
          name: resolved.name,
          slug: resolved.slug,
        };
        this.screenContent = resolved.content;
        this.broadcastScreen(takeover ? "The host took the stage." : null);
        this.onChange?.();
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
