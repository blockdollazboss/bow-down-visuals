/**
 * stations.ts — The palace's DOORS: the access layer (plan Step 3).
 *
 * A station is a physical spot in a room — a desk, a cabinet, a
 * counter — with a name plate in the 3D scene and a walk-up prompt
 * on the page. Activating one opens the room's REAL feature as an
 * in-world panel (the screen-remote pattern): the site's actual
 * page/component, mounted inside the palace, never a replica and
 * never a redirect out. This module is the one registry both sides
 * read: the scene builds a marker per station, the page computes
 * the nearest one for the prompt and mounts its panel.
 *
 * `panel.kind`:
 *   "page"        — mount the app's own route component at `path`
 *                   inside the panel host's in-panel router. Desks
 *                   of the Create Wing open the Create house at its
 *                   panel (`/create?panel=song`) — the same deep
 *                   links the site's own redirects use.
 *   "custom"      — a world-native panel built from real data (the
 *                   Front Row gallery from the public court, the
 *                   Music Hall jukebox, the Treasury's drop rails,
 *                   the Kingdom Board).
 *   "stepthrough" — a full-screen takeover INSIDE /world with a
 *                   "Return to the palace" bar (the Visual Vibes
 *                   editor: a working surface you step INTO, not a
 *                   panel you peek at).
 *
 * `membersOnly`: the feature needs an account. Guests still get
 * the station, its name and its pitch — plus the sign-in ask —
 * never a dead button (guests are look-only palace-wide already;
 * the server enforces the rest).
 */
import {
  HALL_ROOM_ID,
  MUSIC_HALL_ID,
  GAME_ROOMS_ID,
  CREATE_WING_ID,
  COURTYARD_ID,
  TREASURY_ID,
  ROYAL_COURT_ID,
  BRANDING_ATELIER_ID,
} from "./palace-layout";

export type StationPanel =
  | { kind: "page"; path: string }
  | { kind: "custom"; id: string }
  | { kind: "stepthrough"; path: string };

export interface PalaceStation {
  id: string;
  roomId: string;
  name: string;
  /** One line: what this door IS — shown on the prompt and on the
   *  guest pitch, so a station never has to be opened to be
   *  understood. */
  tagline: string;
  x: number;
  z: number;
  membersOnly: boolean;
  panel: StationPanel;
}

/** How close a walker must stand for the prompt (metres). */
export const STATION_PROMPT_RADIUS = 2.3;

export const PALACE_STATIONS: PalaceStation[] = [
  /* ── The King's Hall ─────────────────────────────────────────── */
  {
    id: "kingdom-board",
    roomId: HALL_ROOM_ID,
    name: "The Kingdom Board",
    tagline: "What's live, who's where, and the word around the palace.",
    x: -5.5,
    z: 10.7,
    membersOnly: false,
    panel: { kind: "custom", id: "kingdom-board" },
  },
  {
    id: "post-office",
    roomId: HALL_ROOM_ID,
    name: "Post Office",
    tagline: "Your messages — write to anyone in the kingdom from here.",
    x: 5.5,
    z: 10.7,
    membersOnly: true,
    panel: { kind: "page", path: "/messages" },
  },

  /* ── Music Hall ──────────────────────────────────────────────── */
  {
    id: "jukebox",
    roomId: MUSIC_HALL_ID,
    name: "The Jukebox",
    tagline: "The room's queue — put a song on and it plays for everyone here.",
    x: -21,
    z: -7.6,
    membersOnly: false,
    panel: { kind: "custom", id: "jukebox" },
  },
  {
    id: "listening-booth",
    roomId: MUSIC_HALL_ID,
    name: "Listening Booth",
    tagline: "Your music library — every song you've made, in one booth.",
    x: -27.2,
    z: -2,
    membersOnly: true,
    panel: { kind: "page", path: "/my-music" },
  },
  {
    id: "charts-desk",
    roomId: MUSIC_HALL_ID,
    name: "The Charts",
    tagline: "What's climbing across the kingdom right now.",
    x: -24.5,
    z: 2.1,
    membersOnly: false,
    panel: { kind: "page", path: "/charts" },
  },

  /* ── Game Rooms ──────────────────────────────────────────────── */
  {
    id: "arcade-cabinets",
    roomId: GAME_ROOMS_ID,
    name: "Arcade Cabinets",
    tagline: "The arcade — trivia, skeet, the runner and the rest, for real stakes.",
    x: -24,
    z: 4.5,
    membersOnly: true,
    panel: { kind: "page", path: "/arcade" },
  },
  {
    id: "marble-table",
    roomId: GAME_ROOMS_ID,
    name: "The Marble Table",
    tagline: "Party games with real people — open a room or join one at the table.",
    x: -21,
    z: 10.9,
    membersOnly: true,
    panel: { kind: "page", path: "/party" },
  },

  /* ── Create Wing ─────────────────────────────────────────────── */
  {
    id: "my-studio",
    roomId: CREATE_WING_ID,
    name: "My Studio",
    tagline: "Your studio door — projects, vault and everything that's yours.",
    x: 15.1,
    z: -2,
    membersOnly: true,
    panel: { kind: "page", path: "/dashboard" },
  },
  {
    id: "visual-vibes-editor",
    roomId: CREATE_WING_ID,
    name: "Visual Vibes Editor",
    tagline: "Step through into the full editor — the whole workbench, in-world.",
    x: 21,
    z: -7.6,
    membersOnly: true,
    panel: { kind: "stepthrough", path: "/video-editor" },
  },
  {
    id: "song-desk",
    roomId: CREATE_WING_ID,
    name: "Song Desk",
    tagline: "Make a song — words in, a finished track out.",
    x: 16.5,
    z: 2.1,
    membersOnly: true,
    panel: { kind: "page", path: "/create?panel=song" },
  },
  {
    id: "video-desk",
    roomId: CREATE_WING_ID,
    name: "Video Desk",
    tagline: "Make a video — the music-video desk.",
    x: 21,
    z: 2.1,
    membersOnly: true,
    panel: { kind: "page", path: "/create?panel=video" },
  },
  {
    id: "song-video-desk",
    roomId: CREATE_WING_ID,
    name: "Song + Video Desk",
    tagline: "Song and video together — one sitting, one finished piece.",
    x: 25.5,
    z: 2.1,
    membersOnly: true,
    panel: { kind: "page", path: "/create?panel=song-video" },
  },
  {
    id: "cover-art-desk",
    roomId: CREATE_WING_ID,
    name: "Cover Art Desk",
    tagline: "Cover art for the piece — the face it wears out in the world.",
    x: 27.2,
    z: -5,
    membersOnly: true,
    panel: { kind: "page", path: "/create?panel=coverart" },
  },
  {
    id: "audio-desk",
    roomId: CREATE_WING_ID,
    name: "Audio Studio Desk",
    tagline: "The audio studio — record, clean and shape sound.",
    x: 27.2,
    z: 0.5,
    membersOnly: true,
    panel: { kind: "page", path: "/audio-studio" },
  },
  {
    id: "thumbnail-desk",
    roomId: CREATE_WING_ID,
    name: "Thumbnail Desk",
    tagline: "Thumbnails that get the click — the studio desk.",
    x: 15.1,
    z: -6,
    membersOnly: true,
    panel: { kind: "page", path: "/thumbnail-studio" },
  },

  /* ── Treasury ────────────────────────────────────────────────── */
  {
    id: "daily-drop",
    roomId: TREASURY_ID,
    name: "The Daily Drop",
    tagline: "Today's drop — free Visual Bucs for showing up, claimed right here.",
    x: -25,
    z: -16.9,
    membersOnly: true,
    panel: { kind: "custom", id: "treasury-daily" },
  },
  {
    id: "shark-drops",
    roomId: TREASURY_ID,
    name: "Shark Drops",
    tagline: "The hourly crate and the King's shark drops — first come, first served.",
    x: -21,
    z: -16.9,
    membersOnly: true,
    panel: { kind: "custom", id: "treasury-shark" },
  },
  {
    id: "quest-board",
    roomId: TREASURY_ID,
    name: "The Quest Board",
    tagline: "Quests that pay — create, finish, collect. The board keeps the tally.",
    x: -17,
    z: -16.9,
    membersOnly: true,
    panel: { kind: "custom", id: "treasury-quests" },
  },

  /* ── Royal Court Chamber ─────────────────────────────────────── */
  {
    id: "front-row-gallery",
    roomId: ROYAL_COURT_ID,
    name: "The Front Row Gallery",
    tagline: "The King's Front Row — the honored creators, portrait by portrait.",
    x: 21,
    z: -16.9,
    membersOnly: false,
    panel: { kind: "custom", id: "front-row" },
  },
  {
    id: "crowns-desk",
    roomId: ROYAL_COURT_ID,
    name: "Crowns & Memberships",
    tagline: "Memberships and the Front Row's honors — yours to hold or to offer.",
    x: 27.2,
    z: -13.5,
    membersOnly: false,
    panel: { kind: "page", path: "/memberships" },
  },

  /* ── Branding Atelier ────────────────────────────────────────── */
  {
    id: "branding-kit-desk",
    roomId: BRANDING_ATELIER_ID,
    name: "Branding Kit",
    tagline: "Your whole look in one kit — logo, colors, the works.",
    x: 18,
    z: 4.5,
    membersOnly: false,
    panel: { kind: "page", path: "/branding-kit" },
  },
  {
    id: "branding-shop-desk",
    roomId: BRANDING_ATELIER_ID,
    name: "Branding Shop",
    tagline: "The shop — printed and shipped for you, your brand on real goods.",
    x: 24,
    z: 4.5,
    membersOnly: false,
    panel: { kind: "page", path: "/branding-kit?tab=shop" },
  },
  {
    id: "press-kit-desk",
    roomId: BRANDING_ATELIER_ID,
    name: "Press Kit",
    tagline: "The press kit the world reads — bio, photos, your best work.",
    x: 27.2,
    z: 8,
    membersOnly: false,
    panel: { kind: "page", path: "/press-kit" },
  },

  /* ── Courtyard ───────────────────────────────────────────────── */
  {
    id: "marketplace",
    roomId: COURTYARD_ID,
    name: "The Marketplace",
    tagline: "Every creator's shopfront on the square — browse and buy in-world.",
    x: -9,
    z: 24.9,
    membersOnly: false,
    panel: { kind: "page", path: "/storefronts" },
  },
  {
    id: "community-hall",
    roomId: COURTYARD_ID,
    name: "Community Hall",
    tagline: "Groups, events and the whole kingdom's conversation.",
    x: -3,
    z: 24.9,
    membersOnly: false,
    panel: { kind: "page", path: "/community" },
  },
  {
    id: "promote-room",
    roomId: COURTYARD_ID,
    name: "Promote Room",
    tagline: "Put your work in lights — promotion that reaches the whole site.",
    x: 3.5,
    z: 24.9,
    membersOnly: false,
    panel: { kind: "page", path: "/promote" },
  },
  {
    id: "get-paid-room",
    roomId: COURTYARD_ID,
    name: "Get Paid Room",
    tagline: "Your earnings — every Visual Buc your work has made, counted.",
    x: 12,
    z: 18,
    membersOnly: true,
    panel: { kind: "page", path: "/earnings" },
  },
];

export const STATION_BY_ID = new Map(PALACE_STATIONS.map((s) => [s.id, s]));

/** Stations standing in one room, in registry order. */
export function stationsInRoom(roomId: string): PalaceStation[] {
  return PALACE_STATIONS.filter((s) => s.roomId === roomId);
}

/** The station a walker is close enough to use, or null. Nearest
 *  wins when two prompts overlap; the radius is the prompt's whole
 *  promise — walk up, and it offers; walk away, and it lets go. */
export function nearestStation(
  roomId: string,
  x: number,
  z: number,
  radius = STATION_PROMPT_RADIUS,
): PalaceStation | null {
  let best: PalaceStation | null = null;
  let bestDist = radius;
  for (const s of PALACE_STATIONS) {
    if (s.roomId !== roomId) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d <= bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}
