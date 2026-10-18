/**
 * creator-rooms.ts — Creator Rooms' pure client seam (Ring 2, 3.5).
 *
 * The data comes from the two world-shaped reads the palace
 * server owns (artifacts/api-server/src/routes/world.ts):
 *   GET /api/world/creator-rooms        the rooms directory
 *   GET /api/world/creator-rooms/:slug  one room's data
 * Both answer camelCase DTOs; this module parses them defensively
 * at the boundary (a malformed row drops out, never crashes the
 * panel), builds the Shelf-player inputs the room's music rail and
 * screen play through, and parses the /world?creator=<slug> deep
 * entry — the param is the contract the profiles' "Visit in the
 * World" door points at (that link itself is website-side).
 *
 * The room's identity in the palace is `creator:<slug>`
 * (palace-layout's creatorRoomId); the registry materializes the
 * server instance when the detail read lands, and the doorway
 * transfer (WorldClient.enterRoom) does the walking.
 */
import { creatorRoomId } from "./palace-layout";
import { shelfPlayInput, type ShelfPlayInput } from "./shelf";
import type { CourtMember } from "@/lib/royal-court";

export { creatorRoomId };

/* ─── Wire shapes (mirrors of the server DTOs) ────────────────────── */

export interface CreatorRoomTheme {
  primary: string;
  accent: string;
  background: string;
}

export interface CreatorRoomSummary {
  slug: string;
  displayName: string;
  roomName: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  theme: CreatorRoomTheme;
  hasContent: boolean;
  occupantCount: number;
}

export interface CreatorRoomTrack {
  id: string;
  title: string;
  audioUrl: string;
  artworkUrl: string | null;
  durationSec: number;
  playCount: number;
  likeCount: number;
  commentCount: number;
}

export interface CreatorRoomVideo {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSec: number;
  viewCount: number;
}

export interface CreatorRoomFrontRowMember {
  position: number;
  profileId: string;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CreatorRoomDetail {
  roomId: string;
  slug: string;
  displayName: string;
  roomName: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  theme: CreatorRoomTheme;
  followerCount: number;
  occupantCount: number;
  featuredVideo: CreatorRoomVideo | null;
  featuredTrack: CreatorRoomTrack | null;
  tracks: CreatorRoomTrack[];
  frontRow: CreatorRoomFrontRowMember[];
  storefront: { id: string; handle: string; name: string } | null;
}

/* ─── Parsing ─────────────────────────────────────────────────────── */

const HOUSE_THEME: CreatorRoomTheme = {
  primary: "#d4af37",
  accent: "#f0d488",
  background: "#0d0a04",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function parseTheme(v: unknown): CreatorRoomTheme {
  if (!isRecord(v)) return { ...HOUSE_THEME };
  const hex = (x: unknown, fallback: string) =>
    typeof x === "string" && HEX_COLOR.test(x) ? x : fallback;
  return {
    primary: hex(v["primary"], HOUSE_THEME.primary),
    accent: hex(v["accent"], HOUSE_THEME.accent),
    background: hex(v["background"], HOUSE_THEME.background),
  };
}

function parseSummary(raw: unknown): CreatorRoomSummary | null {
  if (!isRecord(raw)) return null;
  const slug = str(raw["slug"]);
  const displayName = str(raw["displayName"]);
  if (!slug || !displayName) return null;
  return {
    slug,
    displayName,
    roomName: str(raw["roomName"], `${displayName}'s Room`),
    avatarUrl: strOrNull(raw["avatarUrl"]),
    bannerUrl: strOrNull(raw["bannerUrl"]),
    theme: parseTheme(raw["theme"]),
    hasContent: raw["hasContent"] === true,
    occupantCount: num(raw["occupantCount"]),
  };
}

/** The rooms directory payload → clean summaries. Malformed rows
 *  drop out; a malformed body is an empty directory. */
export function parseCreatorRoomDirectory(payload: unknown): CreatorRoomSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload["rooms"])) return [];
  return payload["rooms"].map(parseSummary).filter((r) => r !== null);
}

function parseTrack(raw: unknown): CreatorRoomTrack | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const audioUrl = str(raw["audioUrl"]);
  if (!id || !audioUrl) return null;
  return {
    id,
    title: str(raw["title"], "Untitled"),
    audioUrl,
    artworkUrl: strOrNull(raw["artworkUrl"]),
    durationSec: num(raw["durationSec"]),
    playCount: num(raw["playCount"]),
    likeCount: num(raw["likeCount"]),
    commentCount: num(raw["commentCount"]),
  };
}

function parseVideo(raw: unknown): CreatorRoomVideo | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const videoUrl = str(raw["videoUrl"]);
  if (!id || !videoUrl) return null;
  return {
    id,
    title: str(raw["title"], "Untitled"),
    videoUrl,
    thumbnailUrl: strOrNull(raw["thumbnailUrl"]),
    durationSec: num(raw["durationSec"]),
    viewCount: num(raw["viewCount"]),
  };
}

function parseFrontRowMember(raw: unknown): CreatorRoomFrontRowMember | null {
  if (!isRecord(raw)) return null;
  const profileId = str(raw["profileId"]);
  const slug = str(raw["slug"]);
  if (!profileId || !slug) return null;
  return {
    position: num(raw["position"]),
    profileId,
    slug,
    displayName: str(raw["displayName"], "Creator"),
    avatarUrl: strOrNull(raw["avatarUrl"]),
  };
}

/** One room's data payload → the detail the panels and the scene
 *  dressing read. Null when the payload carries no usable room
 *  (the caller treats that like the server's 404: the room isn't
 *  open). */
export function parseCreatorRoomDetail(payload: unknown): CreatorRoomDetail | null {
  if (!isRecord(payload) || !isRecord(payload["room"])) return null;
  const raw = payload["room"];
  const slug = str(raw["slug"]);
  const displayName = str(raw["displayName"]);
  if (!slug || !displayName) return null;
  const storefrontRaw = raw["storefront"];
  return {
    roomId: str(raw["roomId"], creatorRoomId(slug)),
    slug,
    displayName,
    roomName: str(raw["roomName"], `${displayName}'s Room`),
    bio: typeof raw["bio"] === "string" ? raw["bio"] : "",
    avatarUrl: strOrNull(raw["avatarUrl"]),
    bannerUrl: strOrNull(raw["bannerUrl"]),
    theme: parseTheme(raw["theme"]),
    followerCount: num(raw["followerCount"]),
    occupantCount: num(raw["occupantCount"]),
    featuredVideo: parseVideo(raw["featuredVideo"]),
    featuredTrack: parseTrack(raw["featuredTrack"]),
    tracks: Array.isArray(raw["tracks"])
      ? raw["tracks"].map(parseTrack).filter((t) => t !== null)
      : [],
    frontRow: Array.isArray(raw["frontRow"])
      ? raw["frontRow"].map(parseFrontRowMember).filter((m) => m !== null)
      : [],
    storefront:
      isRecord(storefrontRaw) && str(storefrontRaw["handle"])
        ? {
            id: str(storefrontRaw["id"]),
            handle: str(storefrontRaw["handle"]),
            name: str(storefrontRaw["name"], "Their shop"),
          }
        : null,
  };
}

/* ─── Endpoints ───────────────────────────────────────────────────── */

export function creatorRoomsDirectoryPath(): string {
  return "/api/world/creator-rooms";
}

export function creatorRoomDetailPath(slug: string): string {
  return `/api/world/creator-rooms/${encodeURIComponent(slug)}`;
}

export async function fetchCreatorRoomDirectory(
  signal?: AbortSignal,
): Promise<CreatorRoomSummary[]> {
  const res = await fetch(creatorRoomsDirectoryPath(), { signal });
  if (!res.ok) throw new Error(`creator rooms directory ${res.status}`);
  return parseCreatorRoomDirectory(await res.json());
}

/** One room's data, or null when the room isn't open (the server's
 *  404: unknown and private slugs are the same closed door). A
 *  network failure also reads null — the caller shows the honest
 *  "couldn't open" note either way. */
export async function fetchCreatorRoomDetail(
  slug: string,
  signal?: AbortSignal,
): Promise<CreatorRoomDetail | null> {
  try {
    const res = await fetch(creatorRoomDetailPath(slug), { signal });
    if (!res.ok) return null;
    return parseCreatorRoomDetail(await res.json());
  } catch {
    return null;
  }
}

/* ─── Deep entry ──────────────────────────────────────────────────── */

/** /world?creator=<slug> — the deep-entry param. Parsed once on
 *  entry, exactly like the party invite: the SLUG is never trusted
 *  from the link alone — the room's data read (which enforces
 *  publicness from the profile record) is what opens the door.
 *  Slugs are the profile URL slugs: lowercase letters, digits,
 *  dashes and underscores; anything else is not a slug and the
 *  param is ignored. */
export function parseCreatorRoomParam(search: string): string | null {
  try {
    const raw = new URLSearchParams(search).get("creator");
    if (!raw) return null;
    const slug = raw.trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-_]{0,79}$/.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/* ─── Playback hand-offs (the Shelf player) ───────────────────────── */

/** A rail track → the Shelf player's input. The room endpoint
 *  already resolved the playable URL server-side (published work
 *  on a public profile — the same trust the jukebox catalog
 *  carries), so the input rides it directly. */
export function creatorTrackPlayInput(
  track: CreatorRoomTrack,
  room: Pick<CreatorRoomDetail, "displayName" | "slug">,
): ShelfPlayInput {
  return shelfPlayInput({
    kind: "track",
    id: track.id,
    title: track.title,
    artistName: room.displayName,
    artworkUrl: track.artworkUrl,
    src: track.audioUrl,
    pagePath: `/track/${encodeURIComponent(track.id)}`,
    likeCount: track.likeCount,
    commentCount: track.commentCount,
    artistSlug: room.slug,
  });
}

/** The featured video → the Shelf player's input (its Now Playing
 *  card renders the <video> element; the room's screen mesh plays
 *  the same piece as the room's ambient screen). */
export function creatorVideoPlayInput(
  video: CreatorRoomVideo,
  room: Pick<CreatorRoomDetail, "displayName" | "slug">,
): ShelfPlayInput {
  return shelfPlayInput({
    kind: "video",
    id: video.id,
    title: video.title,
    artistName: room.displayName,
    artworkUrl: video.thumbnailUrl,
    src: video.videoUrl,
    pagePath: `/watch/${encodeURIComponent(video.id)}`,
    likeCount: 0,
    commentCount: 0,
    artistSlug: room.slug,
  });
}

/** The Front Row member as the Portrait Card's gallery member —
 *  the court DTO the card already speaks (lib/royal-court), so a
 *  portrait in a creator's room opens the same card the Royal
 *  Court Chamber's gallery opens. */
export function frontRowCourtMember(m: CreatorRoomFrontRowMember): CourtMember {
  return {
    position: m.position,
    profileId: m.profileId,
    slug: m.slug,
    displayName: m.displayName,
    avatarUrl: m.avatarUrl,
    profileUrl: `/artist/${m.slug}`,
    isPublic: true,
  };
}
