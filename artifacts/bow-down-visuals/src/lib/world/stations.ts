/**
 * stations.ts — The palace's DOORS: the native registry (v2).
 *
 * A station is a physical spot in a room — a desk, a cabinet, a
 * counter — with a name plate in the 3D scene and a walk-up prompt
 * on the page. Activating one opens a WORLD-NATIVE instrument built
 * for the room (the owner's law, Oct 17 2026: "Everything I interact
 * with should happen in the VR world") — never the website's 2D
 * page mounted in a panel. This module is the one registry both
 * sides read: the scene builds a marker per station, the page
 * computes the nearest one for the prompt and mounts its panel.
 *
 * `panel.kind` (v2 — "page" is RETIRED; no station auto-opens a
 * website page ever again):
 *   "native"      — an in-world instrument following one of the
 *                   seven shared patterns (see `NativePattern`).
 *                   Until a station's pattern surface ships, the
 *                   panel host renders the honest "being rebuilt"
 *                   placeholder WITH the transfer footer — never a
 *                   silent pull-up, never a dead end.
 *   "custom"      — a world-native panel built from real data (the
 *                   Front Row gallery from the public court, the
 *                   Music Hall jukebox, the Treasury's drop rails,
 *                   the Kingdom Board). Unchanged from v1.
 *   "stepthrough" — a full-screen takeover INSIDE /world with a
 *                   "Return to the palace" bar (the Visual Vibes
 *                   editor: a working surface you step INTO, not a
 *                   panel you peek at). Unchanged from v1.
 *
 * `websitePath`: the station's page on the website — the EXACT
 * string this door used to auto-open, deep links included (e.g.
 * `/create?panel=song`, `/branding-kit?tab=shop`). In v2 it is
 * ONLY the transfer target: the one quiet "Open on the website ↗"
 * button in the native panel's footer points here, in a new tab,
 * when a walker explicitly clicks it. It is never auto-opened,
 * never auto-focused, never a redirect. `null` for the six custom
 * stations — they were born world-native and never auto-opened a
 * page, so they carry no transfer target. The step-through editor
 * mirrors its panel path here for a uniform table.
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
  STAGE_GROUNDS_ID,
  LISTENING_GARDENS_ID,
  creatorSlugFromRoomId,
} from "./palace-layout";

/** The seven shared in-world patterns every native station is
 *  built from (NATIVE-PLAN §3.1–§3.7) — no 27 one-offs. */
export type NativePattern =
  | "board"
  | "shelf"
  | "shop"
  | "social"
  | "games"
  | "create"
  | "business";

export type StationPanel =
  | { kind: "native"; pattern: NativePattern }
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
  /** The transfer target: the exact website path this station
   *  used to auto-open (deep links included), or null when the
   *  station never had one (the six customs). See the header. */
  websitePath: string | null;
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
    websitePath: null,
  },
  {
    id: "post-office",
    roomId: HALL_ROOM_ID,
    name: "Post Office",
    tagline: "Your messages — write to anyone in the kingdom from here.",
    x: 5.5,
    z: 10.7,
    membersOnly: true,
    panel: { kind: "native", pattern: "social" },
    websitePath: "/messages",
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
    websitePath: null,
  },
  {
    id: "listening-booth",
    roomId: MUSIC_HALL_ID,
    name: "Listening Booth",
    tagline: "Your music library — every song you've made, in one booth.",
    x: -27.2,
    z: -2,
    membersOnly: true,
    panel: { kind: "native", pattern: "shelf" },
    websitePath: "/my-music",
  },
  {
    /* Stack-100 #65: the Beats licensing marketplace — browse and
     * preview are public (the browse rail is), licensing, selling
     * and the seller dashboard pitch guests to sign in inside the
     * panel. It stands on the Music Hall's north wall, east of the
     * Charts desk. */
    id: "beats-desk",
    roomId: MUSIC_HALL_ID,
    name: "Beat Marketplace",
    tagline: "Beats to license — Basic, Premium, Exclusive and the producers' own custom licenses.",
    x: -18.5,
    z: 2.1,
    membersOnly: false,
    panel: { kind: "custom", id: "beats-desk" },
    websitePath: "/beats",
  },
  {
    id: "charts-desk",
    roomId: MUSIC_HALL_ID,
    name: "The Charts",
    tagline: "What's climbing across the kingdom right now.",
    x: -24.5,
    z: 2.1,
    membersOnly: false,
    panel: { kind: "native", pattern: "board" },
    websitePath: "/charts",
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
    panel: { kind: "native", pattern: "games" },
    websitePath: "/arcade",
  },
  {
    id: "marble-table",
    roomId: GAME_ROOMS_ID,
    name: "The Marble Table",
    tagline: "Party games with real people — open a room or join one at the table.",
    x: -21,
    z: 10.9,
    membersOnly: true,
    panel: { kind: "native", pattern: "games" },
    websitePath: "/party",
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
    panel: { kind: "native", pattern: "board" },
    websitePath: "/dashboard",
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
    websitePath: "/video-editor",
  },
  {
    id: "song-desk",
    roomId: CREATE_WING_ID,
    name: "Song Desk",
    tagline: "Make a song — words in, a finished track out.",
    x: 16.5,
    z: 2.1,
    membersOnly: true,
    panel: { kind: "native", pattern: "create" },
    websitePath: "/create?panel=song",
  },
  {
    id: "video-desk",
    roomId: CREATE_WING_ID,
    name: "Video Desk",
    tagline: "Make a video — the music-video desk.",
    x: 21,
    z: 2.1,
    membersOnly: true,
    panel: { kind: "native", pattern: "create" },
    websitePath: "/create?panel=video",
  },
  {
    id: "song-video-desk",
    roomId: CREATE_WING_ID,
    name: "Song + Video Desk",
    tagline: "Song and video together — one sitting, one finished piece.",
    x: 25.5,
    z: 2.1,
    membersOnly: true,
    panel: { kind: "native", pattern: "create" },
    websitePath: "/create?panel=song-video",
  },
  {
    id: "cover-art-desk",
    roomId: CREATE_WING_ID,
    name: "Cover Art Desk",
    tagline: "Cover art for the piece — the face it wears out in the world.",
    x: 27.2,
    z: -5,
    membersOnly: true,
    panel: { kind: "native", pattern: "create" },
    websitePath: "/create?panel=coverart",
  },
  {
    id: "audio-desk",
    roomId: CREATE_WING_ID,
    name: "Audio Studio Desk",
    tagline: "The audio studio — record, clean and shape sound.",
    x: 27.2,
    z: 0.5,
    membersOnly: true,
    panel: { kind: "native", pattern: "create" },
    websitePath: "/audio-studio",
  },
  {
    id: "thumbnail-desk",
    roomId: CREATE_WING_ID,
    name: "Thumbnail Desk",
    tagline: "Thumbnails that get the click — the studio desk.",
    x: 15.1,
    z: -6,
    membersOnly: true,
    panel: { kind: "native", pattern: "create" },
    websitePath: "/thumbnail-studio",
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
    websitePath: null,
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
    websitePath: null,
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
    websitePath: null,
  },
  {
    /* Stack-100 #61: the packs desk — buying Visual Bucs in-world
     * so an out-of-credits state is a door, not a dead end. It
     * stands at the row's east end (the Treasury's walk floor runs
     * to x -14.35); the panel rides the pricing page's own
     * checkout rail, hosted page in a new tab. */
    id: "packs-desk",
    roomId: TREASURY_ID,
    name: "Visual Buc Packs",
    tagline: "Top up your Visual Bucs right here — the real packs, the real checkout.",
    x: -15.2,
    z: -16.9,
    membersOnly: true,
    panel: { kind: "custom", id: "treasury-packs" },
    websitePath: null,
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
    websitePath: null,
  },
  {
    id: "season-marks-wall",
    roomId: ROYAL_COURT_ID,
    name: "The Season Marks Wall",
    tagline: "Every court season's final standings, carved as marks — who placed, and when.",
    x: 16.4,
    z: -16.9,
    membersOnly: false,
    panel: { kind: "custom", id: "season-marks" },
    websitePath: null,
  },
  {
    id: "crowns-desk",
    roomId: ROYAL_COURT_ID,
    name: "Crowns & Memberships",
    tagline: "Memberships and the Front Row's honors — yours to hold or to offer.",
    x: 27.2,
    z: -13.5,
    membersOnly: false,
    panel: { kind: "native", pattern: "shop" },
    websitePath: "/memberships",
  },
  {
    id: "winners-circle",
    roomId: ROYAL_COURT_ID,
    name: "The Winners' Circle",
    tagline: "The palace's contests — enter a work on a stage, and see who took the honors.",
    x: 19,
    z: -13.5,
    membersOnly: false,
    panel: { kind: "custom", id: "winners-circle" },
    websitePath: null,
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
    panel: { kind: "native", pattern: "business" },
    websitePath: "/branding-kit",
  },
  {
    id: "branding-shop-desk",
    roomId: BRANDING_ATELIER_ID,
    name: "Branding Shop",
    tagline: "The shop — printed and shipped for you, your brand on real goods.",
    x: 24,
    z: 4.5,
    membersOnly: false,
    panel: { kind: "native", pattern: "shop" },
    websitePath: "/branding-kit?tab=shop",
  },
  {
    id: "press-kit-desk",
    roomId: BRANDING_ATELIER_ID,
    name: "Press Kit",
    tagline: "The press kit the world reads — bio, photos, your best work.",
    x: 27.2,
    z: 8,
    membersOnly: false,
    panel: { kind: "native", pattern: "business" },
    websitePath: "/press-kit",
  },
  {
    /* The Jewelry Bench (Stack-100 #74): the Atelier's missing desk —
       the Logo-to-Luxury Studio's bench (design preview, STL,
       estimate, guide, NFC, consultant) on its own /api/jewelry
       rails. Stands on the Atelier's south wall between the branding
       kit and the press kit, clear of both prompts. */
    id: "jewelry-bench",
    roomId: BRANDING_ATELIER_ID,
    name: "Jewelry Bench",
    tagline: "Your logo, cast in gold — design it, price it, get it made.",
    x: 21,
    z: 8,
    membersOnly: false,
    panel: { kind: "native", pattern: "business" },
    websitePath: "/branding-kit?tab=jewelry",
  },

  /* ── Courtyard ───────────────────────────────────────────────── */
  {
    /* The plaza monument (Open World Phase 1): the Kingdom Board
     * stands at the plaza's heart too — the same live board as the
     * hall's, on the same panel id, open to guests exactly like
     * the hall's. The walker stands on the open plaza just south
     * of the monument, facing its engraved face — the plinth
     * itself is solid (overhaul stage 3 collision), so the
     * station point stands off it, in reading distance. */
    id: "kingdom-board-plaza",
    roomId: COURTYARD_ID,
    name: "The Kingdom Board",
    tagline: "The board out on the square — what's live, who's where, and the word around the palace.",
    x: 0,
    z: 22.6,
    membersOnly: false,
    panel: { kind: "custom", id: "kingdom-board" },
    websitePath: null,
  },
  {
    id: "marketplace",
    roomId: COURTYARD_ID,
    name: "The Marketplace",
    tagline: "Every creator's shopfront on the square — browse and buy in-world.",
    x: -9,
    z: 24.9,
    membersOnly: false,
    panel: { kind: "native", pattern: "shop" },
    websitePath: "/storefronts",
  },
  {
    id: "community-hall",
    roomId: COURTYARD_ID,
    name: "Community Hall",
    tagline: "Groups, events and the whole kingdom's conversation.",
    x: -3,
    z: 24.9,
    membersOnly: false,
    panel: { kind: "native", pattern: "social" },
    websitePath: "/community",
  },
  {
    id: "promote-room",
    roomId: COURTYARD_ID,
    name: "Promote Room",
    tagline: "Put your work in lights — promotion that reaches the whole site.",
    x: 3.5,
    z: 24.9,
    membersOnly: false,
    panel: { kind: "native", pattern: "business" },
    websitePath: "/promote",
  },
  {
    id: "get-paid-room",
    roomId: COURTYARD_ID,
    name: "Get Paid Room",
    tagline: "Your earnings — every Visual Buc your work has made, counted.",
    x: 12,
    z: 18,
    membersOnly: true,
    panel: { kind: "native", pattern: "board" },
    websitePath: "/earnings",
  },
  {
    id: "creator-rooms",
    roomId: COURTYARD_ID,
    name: "Creator Rooms",
    tagline: "The creators' own rooms — pick a creator and walk into their place.",
    x: 9.5,
    z: 24.4,
    membersOnly: false,
    panel: { kind: "custom", id: "creator-rooms" },
    websitePath: null,
  },

  /* ── Stage Grounds (Stage C item 31) ─────────────────────────── */
  {
    /* The district's one door: the bill at the head of the entry
     * path, where the gate walk meets the audience lawn. It opens
     * the Kingdom Board — the palace's live slate of what's on,
     * who's where and what's live — the same panel the hall's and
     * the monument's boards carry, born world-native like them
     * (never a website page). The district is look/listen space:
     * no stage authority docks here, and guests read the bill
     * exactly like members. */
    id: "stage-bill",
    roomId: STAGE_GROUNDS_ID,
    name: "The Stage Bill",
    tagline: "What's on at the palace — the live slate, read from the stage quarter.",
    x: -33.2,
    z: 19.5,
    membersOnly: false,
    panel: { kind: "custom", id: "kingdom-board" },
    websitePath: null,
  },

  /* ── Listening Gardens (Stage C item 32) ─────────────────────── */
  {
    /* The district's one door: the slate at the head of the
     * entry path, where the gate walk meets the parterre lawn.
     * It opens the Kingdom Board — the palace's live slate of
     * what's on, who's where and what's live — the same panel
     * the hall's, the monument's and the Stage Bill's boards
     * carry, born world-native like them (never a website page).
     * The district is look/listen space: no stage authority
     * docks here, and guests read the slate exactly like
     * members. */
    id: "gardens-slate",
    roomId: LISTENING_GARDENS_ID,
    name: "The Gardens Slate",
    tagline: "What's on at the palace — the live slate, read from the quiet of the gardens.",
    x: -26,
    z: 38.4,
    membersOnly: false,
    panel: { kind: "custom", id: "kingdom-board" },
    websitePath: null,
  },
];

/* ── Creator-room stations (Ring 2, item 3.5) ────────────────────────
 * The template's four doors, laid out on the template floor plan
 * (palace-layout CREATOR_ROOM_TEMPLATE: interior x 2.6..16.4,
 * z 26.4..38.0, the arch on its north wall at x 9.5). They can't
 * live in PALACE_STATIONS — their room id is dynamic
 * (`creator:<slug>`) — so they're built per room id here, in the
 * same shape, and `stationsInRoom`/`nearestStation` fold them in
 * for creator rooms. All four are CUSTOM panels fed by the room's
 * data endpoint (lib/world/creator-rooms): the music rail plays on
 * the Shelf player, the screen is the creator's featured video,
 * the store door is their storefront on the shop rails, the Front
 * Row is their court as Portrait Cards. None of them is
 * membersOnly: a creator's public place is look-and-listen for
 * guests, exactly like their public profile. */
export function creatorRoomStations(roomId: string): PalaceStation[] {
  const slug = creatorSlugFromRoomId(roomId);
  if (!slug) return [];
  const base = { roomId, membersOnly: false, websitePath: null as string | null };
  return [
    {
      ...base,
      id: "creator-front-row",
      name: "Their Front Row",
      tagline: "The creators they keep closest — portrait by portrait.",
      x: 3.9,
      z: 29.6,
      panel: { kind: "custom", id: "creator-front-row" } as StationPanel,
    },
    {
      ...base,
      id: "creator-music",
      name: "Their Music",
      tagline: "Their published songs — press play and listen right here.",
      x: 3.9,
      z: 34.6,
      panel: { kind: "custom", id: "creator-music" } as StationPanel,
    },
    {
      ...base,
      id: "creator-screen",
      name: "Their Screen",
      tagline: "Their featured video — the piece they put on the wall.",
      x: 9.5,
      z: 36.7,
      panel: { kind: "custom", id: "creator-screen" } as StationPanel,
    },
    {
      ...base,
      id: "creator-store",
      name: "Their Store",
      tagline: "Their shopfront — what's for sale, on the palace's shop rails.",
      x: 15.1,
      z: 34.6,
      panel: { kind: "custom", id: "creator-store" } as StationPanel,
    },
  ];
}

export const STATION_BY_ID = new Map(PALACE_STATIONS.map((s) => [s.id, s]));

/** Stations standing in one room, in registry order. Creator
 *  rooms answer with the template's four doors. */
export function stationsInRoom(roomId: string): PalaceStation[] {
  const fixed = PALACE_STATIONS.filter((s) => s.roomId === roomId);
  return [...fixed, ...creatorRoomStations(roomId)];
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
  for (const s of stationsInRoom(roomId)) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d <= bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}
