/**
 * world.ts — The World: the palace (the King's Hall + its rooms).
 *
 *   WS  /api/world/ws?token=<session?>   presence + voice signaling
 *   GET /api/world/screen                what the hall's big screen plays
 *   GET /api/world/directory             who's in which palace room
 *
 * Presence is socket state (lib/world-room.ts, one instance per
 * palace room, registered in lib/world-palace.ts) on the shared live
 * gateway — no DB rows, no migration: despawning is a socket close.
 * The token is OPTIONAL here, unlike chat: a valid session token makes
 * you a named member (voice + text); no token (or a stale one) makes
 * you a guest — present and visible, labeled a guest, look-only.
 *
 * The screen is honest programming: when a stream is actually live
 * site-wide, the screen carries that stream (its HLS, same playback
 * rules as the watch page); otherwise it plays the hall's featured
 * reel. Nothing is ever labeled "live" that isn't.
 */
import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import {
  db,
  artistVaultsTable,
  creatorProfilesTable,
  liveStreamsTable,
  profileTracksTable,
  profileVideosTable,
  questProgressTable,
  royalCourtTable,
  shopsTable,
} from "@workspace/db";
import { QUEST_DEFS } from "../lib/retention";
import { getCreatorRank } from "../lib/creator-rank";
import { publicApiLimiter } from "../lib/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { playbackUrlsFromWhip } from "../lib/cloudflare-stream";
import { getUserActiveTeam } from "../lib/teams";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import {
  LiveWsGateway,
  RoomHub,
  verifyAccessToken,
  type AccessTokenVerifier,
  type WsClientSocket,
} from "../lib/live-ws";
import {
  type WorldCharacterRef,
  type WorldIdentity,
  type WorldJukeboxTrackRef,
  type WorldQuestClaimFact,
  type WorldScreenVideoRef,
  type WorldStageLiveRef,
} from "../lib/world-room";
import { WorldPalace, creatorRoomIdForSlug } from "../lib/world-palace";
import { sanitizeCharacterVoiceProfile } from "../lib/character-voice-profile";
import {
  WorldEventScheduler,
  WORLD_EVENT_TICK_MS,
  claimSpectacleDrop,
} from "../lib/world-events";
import {
  KingMomentScheduler,
  KING_MOMENT_TICK_MS,
  createKingMomentClaimer,
} from "../lib/world-king-moment";
import { createStageTipper } from "../lib/world-stage-tips";

const router = Router();

/* ── The big screen ─────────────────────────────────────────────────────── */

export interface WorldScreenDto {
  mode: "live" | "featured" | "video";
  title: string;
  creatorName: string | null;
  streamId: string | null;
  /** HLS playlist URL when live (same-origin proxy path or provider URL). */
  hlsUrl: string | null;
  /** Plain video file URL when featured or a watch-party file video. */
  videoUrl: string | null;
  /** Who holds the stage while a show is on (null = ambient screen). */
  stage: { name: string; slug: string | null } | null;
  /** Watch-party videos: the shared playback state, position stamped
   *  at response time — joiners start roughly where the room is. */
  playback: { playing: boolean; positionSec: number } | null;
  videoId: string | null;
}

/** The hall's featured reel when nothing is live: the King himself,
 *  looping — a file the site already ships (public/videos). */
export const WORLD_FEATURED_VIDEO_URL = "/videos/shark-king-360-loop.mp4";

/** Pure pick: a live row only becomes "live" on the screen when it has
 *  a playable HLS URL; a live-but-unplayable row falls back to the
 *  featured reel rather than a black screen labeled live. */
export function pickScreenContent(
  live: { id: string; title: string; creatorName: string | null; hlsUrl: string | null } | null,
): WorldScreenDto {
  if (live && live.hlsUrl) {
    return {
      mode: "live",
      title: live.title,
      creatorName: live.creatorName,
      streamId: live.id,
      hlsUrl: live.hlsUrl,
      videoUrl: null,
      stage: null,
      playback: null,
      videoId: null,
    };
  }
  return {
    mode: "featured",
    title: "The King's Reel",
    creatorName: null,
    streamId: null,
    hlsUrl: null,
    videoUrl: WORLD_FEATURED_VIDEO_URL,
    stage: null,
    playback: null,
    videoId: null,
  };
}

/** A stage video (watch party) as the screen DTO: the URL rides the
 *  field matching its kind (file → videoUrl, HLS → hlsUrl), the
 *  playback stamp rides along so a joiner starts where the room is. */
export function stageVideoScreen(
  video: WorldScreenVideoRef,
  playback: { playing: boolean; positionSec: number },
  holder: { name: string; slug: string | null },
): WorldScreenDto {
  return {
    mode: "video",
    title: video.title,
    creatorName: video.creatorName,
    streamId: null,
    hlsUrl: video.mediaKind === "hls" ? video.url : null,
    videoUrl: video.mediaKind === "file" ? video.url : null,
    stage: holder,
    playback,
    videoId: video.id,
  };
}

/** The live palace, once the WS endpoint is mounted — the HTTP
 *  endpoints read the same instances the sockets talk to, so HTTP
 *  and WS never disagree. */
let activePalace: WorldPalace | null = null;

router.get("/world/screen", publicApiLimiter, async (_req, res) => {
  try {
    /* The stage outranks ambient programming: whoever holds it owns
     * the screen. A stage video needs no DB at all — the room
     * verified it at pick time and carries the playback stamp. */
    const stage = activePalace?.hallRoom.screenBroadcast() ?? null;
    if (stage?.holder) {
      if (stage.mode === "video" && stage.video && stage.playback) {
        res.json({
          screen: refreshSupabaseStorageUrlsDeep(
            stageVideoScreen(stage.video, stage.playback, stage.holder),
          ),
        });
        return;
      }
      if (stage.mode === "reel") {
        /* The holder parked the screen on the Reel on purpose. */
        res.json({ screen: { ...pickScreenContent(null), stage: stage.holder } });
        return;
      }
      if (stage.mode === "live" && stage.streamId) {
        const [stageRow] = await db
          .select()
          .from(liveStreamsTable)
          .where(and(eq(liveStreamsTable.id, stage.streamId), eq(liveStreamsTable.status, "live")))
          .limit(1);
        if (stageRow) {
          const hlsUrl =
            stageRow.provider === "own-server"
              ? `/api/live-streams/${stageRow.id}/hls/playlist.m3u8`
              : playbackUrlsFromWhip(stageRow.whip_url).hls_url;
          if (hlsUrl) {
            let creatorName: string | null = null;
            try {
              const [profile] = await db
                .select({ displayName: creatorProfilesTable.displayName })
                .from(creatorProfilesTable)
                .where(eq(creatorProfilesTable.id, stageRow.profile_id))
                .limit(1);
              creatorName = profile?.displayName ?? null;
            } catch {
              /* the stream title still titles the screen honestly */
            }
            res.json({
              screen: {
                ...pickScreenContent({ id: stageRow.id, title: stageRow.title, creatorName, hlsUrl }),
                stage: stage.holder,
              },
            });
            return;
          }
        }
        /* The stage stream ended at the source: fall through to the
         * ambient screen rather than pointing the hall at a corpse. */
      }
    }
    const [row] = await db
      .select()
      .from(liveStreamsTable)
      .where(eq(liveStreamsTable.status, "live"))
      .orderBy(desc(liveStreamsTable.started_at))
      .limit(1);
    if (!row) {
      res.json({ screen: pickScreenContent(null) });
      return;
    }
    const hlsUrl =
      row.provider === "own-server"
        ? `/api/live-streams/${row.id}/hls/playlist.m3u8`
        : playbackUrlsFromWhip(row.whip_url).hls_url;
    let creatorName: string | null = null;
    try {
      const [profile] = await db
        .select({ displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.id, row.profile_id))
        .limit(1);
      creatorName = profile?.displayName ?? null;
    } catch {
      /* the stream title still titles the screen honestly */
    }
    res.json({ screen: pickScreenContent({ id: row.id, title: row.title, creatorName, hlsUrl }) });
  } catch (err) {
    logger.error({ err }, "[world] screen lookup failed");
    res.status(500).json({ error: "Couldn't load the hall's screen. Try again." });
  }
});

/* ── The screen catalog ───────────────────────────────────────────
 * What the stage remote can offer: the signed-in member's own
 * published videos + stream replays first, then the public catalog.
 * Ids only ever identify content — a pick is re-verified and its URL
 * re-derived server-side when it reaches the room (the same rule as
 * character picks: never trust a client-supplied URL). */
export interface WorldScreenCatalogItem {
  id: string;
  title: string;
  creatorName: string | null;
  mediaKind: "file" | "hls";
  durationSec: number;
}

function mediaKindOf(url: string): "file" | "hls" {
  return /\.m3u8($|\?)/i.test(url) ? "hls" : "file";
}

function catalogVideoItem(
  row: typeof profileVideosTable.$inferSelect,
  creatorName: string | null,
): WorldScreenCatalogItem {
  return {
    id: `video:${row.id}`,
    title: row.title,
    creatorName,
    mediaKind: mediaKindOf(row.videoUrl),
    durationSec: row.durationSec,
  };
}

function catalogReplayItem(
  row: typeof liveStreamsTable.$inferSelect,
  creatorName: string | null,
): WorldScreenCatalogItem {
  return {
    id: `replay:${row.id}`,
    title: row.title,
    creatorName,
    mediaKind: mediaKindOf(row.vod_url ?? ""),
    durationSec: 0,
  };
}

/**
 * The palace directory over HTTP: every room, its headcount, who's
 * inside, and whether the hall's stage is live. Public like the
 * screen endpoint — the front-door signal ("your people are in the
 * Music Hall") for surfaces that haven't stepped in yet. Before the
 * WS mount (or in a process without one), every room reads empty —
 * honest zeros, never a stale crowd.
 */
router.get("/world/directory", publicApiLimiter, (_req, res) => {
  res.json({
    rooms: activePalace
      ? activePalace.directory()
      : [
          { id: "world:kings-hall", name: "The King's Hall", count: 0, members: [], live: false },
          { id: "world:music-hall", name: "Music Hall", count: 0, members: [], live: false },
          { id: "world:game-rooms", name: "Game Rooms", count: 0, members: [], live: false },
          { id: "world:create-wing", name: "Create Wing", count: 0, members: [], live: false },
          { id: "world:courtyard", name: "Courtyard", count: 0, members: [], live: false },
          { id: "world:treasury", name: "Treasury", count: 0, members: [], live: false },
          { id: "world:royal-court", name: "Royal Court Chamber", count: 0, members: [], live: false },
          { id: "world:branding-atelier", name: "Branding Atelier", count: 0, members: [], live: false },
        ],
  });
});

router.get("/world/screen-catalog", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const [myProfile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);

    const mine: WorldScreenCatalogItem[] = [];
    if (myProfile) {
      const myVideos = await db
        .select()
        .from(profileVideosTable)
        .where(and(eq(profileVideosTable.profileId, myProfile.id), eq(profileVideosTable.isPublished, true)))
        .orderBy(desc(profileVideosTable.createdAt))
        .limit(20);
      mine.push(...myVideos.filter((v) => v.videoUrl).map((v) => catalogVideoItem(v, myProfile.displayName)));
      const myReplays = await db
        .select()
        .from(liveStreamsTable)
        .where(and(eq(liveStreamsTable.user_id, userId), isNotNull(liveStreamsTable.vod_url)))
        .orderBy(desc(liveStreamsTable.created_at))
        .limit(10);
      mine.push(...myReplays.filter((r) => r.vod_url).map((r) => catalogReplayItem(r, myProfile.displayName)));
    }

    const publicVideos = await db
      .select({ video: profileVideosTable, creatorName: creatorProfilesTable.displayName })
      .from(profileVideosTable)
      .innerJoin(creatorProfilesTable, eq(profileVideosTable.profileId, creatorProfilesTable.id))
      .where(
        and(
          eq(profileVideosTable.isPublished, true),
          eq(creatorProfilesTable.isPublic, true),
          myProfile ? ne(profileVideosTable.profileId, myProfile.id) : undefined,
        ),
      )
      .orderBy(desc(profileVideosTable.createdAt))
      .limit(20);
    const publicReplays = await db
      .select({ stream: liveStreamsTable, creatorName: creatorProfilesTable.displayName })
      .from(liveStreamsTable)
      .innerJoin(creatorProfilesTable, eq(liveStreamsTable.profile_id, creatorProfilesTable.id))
      .where(
        and(
          isNotNull(liveStreamsTable.vod_url),
          eq(creatorProfilesTable.isPublic, true),
          ne(liveStreamsTable.user_id, userId),
        ),
      )
      .orderBy(desc(liveStreamsTable.created_at))
      .limit(10);

    const pub: WorldScreenCatalogItem[] = [
      ...publicVideos.filter((r) => r.video.videoUrl).map((r) => catalogVideoItem(r.video, r.creatorName)),
      ...publicReplays.filter((r) => r.stream.vod_url).map((r) => catalogReplayItem(r.stream, r.creatorName)),
    ];
    res.json(await refreshSupabaseStorageUrlsDeep({ catalog: { mine, public: pub } }));
  } catch (err) {
    logger.error({ err }, "[world] screen catalog lookup failed");
    res.status(500).json({ error: "Couldn't load the screen catalog. Try again." });
  }
});

/* ── The Music Hall jukebox catalog ─────────────────────────────────────
 * The songs the jukebox can be fed: published profile tracks — the
 * member's own and everyone's on a public profile. Ids are the
 * `track:<uuid>` form the jukebox resolver re-verifies at add time,
 * so a catalog row is a pick, never a playable URL. */
export interface WorldJukeboxCatalogItem {
  id: string;
  title: string;
  creatorName: string | null;
  durationSec: number;
  artworkUrl: string | null;
}

router.get("/world/jukebox-catalog", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const [myProfile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);

    const mine: WorldJukeboxCatalogItem[] = [];
    if (myProfile) {
      const myTracks = await db
        .select()
        .from(profileTracksTable)
        .where(and(eq(profileTracksTable.profileId, myProfile.id), eq(profileTracksTable.isPublished, true)))
        .orderBy(desc(profileTracksTable.createdAt))
        .limit(30);
      mine.push(
        ...myTracks
          .filter((t) => t.audioUrl)
          .map((t) => ({
            id: `track:${t.id}`,
            title: t.title,
            creatorName: myProfile.displayName,
            durationSec: t.durationSec,
            artworkUrl: t.artworkUrl,
          })),
      );
    }

    const publicTracks = await db
      .select({ track: profileTracksTable, creatorName: creatorProfilesTable.displayName })
      .from(profileTracksTable)
      .innerJoin(creatorProfilesTable, eq(profileTracksTable.profileId, creatorProfilesTable.id))
      .where(
        and(
          eq(profileTracksTable.isPublished, true),
          eq(creatorProfilesTable.isPublic, true),
          myProfile ? ne(profileTracksTable.profileId, myProfile.id) : undefined,
        ),
      )
      .orderBy(desc(profileTracksTable.createdAt))
      .limit(30);
    const pub: WorldJukeboxCatalogItem[] = publicTracks
      .filter((r) => r.track.audioUrl)
      .map((r) => ({
        id: `track:${r.track.id}`,
        title: r.track.title,
        creatorName: r.creatorName,
        durationSec: r.track.durationSec,
        artworkUrl: r.track.artworkUrl,
      }));
    res.json(await refreshSupabaseStorageUrlsDeep({ catalog: { mine, public: pub } }));
  } catch (err) {
    logger.error({ err }, "[world] jukebox catalog lookup failed");
    res.status(500).json({ error: "Couldn't load the song catalog. Try again." });
  }
});

/* ── My music — owned playback, published or not (Ring 2, 2.14) ─────────
 * GET /api/world/my-music — the signed-in member's OWN profile tracks,
 * drafts and unpublished included, each with the streamable audio URL
 * the site itself streams from (the row's audio_url, storage-refreshed
 * at the boundary like every world payload). The public media detail
 * (GET /api/media/track/:id) 404s unpublished tracks by design, so an
 * owner could never hear their own unreleased songs in the palace;
 * this is the one world-shaped read that closes that gap, following
 * the screen-catalog precedent (requireAuth, caller's profile first).
 *
 * OWNERSHIP IS THE QUERY: rows are selected by the caller's own
 * profile id and nothing else — there is no id parameter, so there is
 * no way to ask for anyone else's music. The DTO is camelCase (the
 * world catalogs' house shape); the client normalizes at its boundary
 * in lib/world/shelf.ts (parseMyMusic). */
export interface WorldMyMusicItem {
  id: string;
  title: string;
  artistName: string | null;
  artworkUrl: string | null;
  audioUrl: string;
  genre: string | null;
  durationSec: number;
  isPublished: boolean;
  likeCount: number;
  commentCount: number;
  playCount: number;
  createdAt: string;
}

type ProfileTrackRow = typeof profileTracksTable.$inferSelect;

/** Pure DTO mapper (exported for route tests): one own-track row →
 *  the world-shaped item. Dates ride as ISO strings, never Date
 *  objects, so the wire shape is the tested shape. */
export function myMusicItemFromTrack(row: ProfileTrackRow, artistName: string | null): WorldMyMusicItem {
  return {
    id: row.id,
    title: row.title,
    artistName,
    artworkUrl: row.artworkUrl ?? null,
    audioUrl: row.audioUrl,
    genre: row.genre ?? null,
    durationSec: row.durationSec ?? 0,
    isPublished: row.isPublished === true,
    likeCount: row.likeCount ?? 0,
    commentCount: row.commentCount ?? 0,
    playCount: row.playCount ?? 0,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

router.get("/world/my-music", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const [myProfile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    if (!myProfile) {
      res.json({ tracks: [] });
      return;
    }
    const rows = await db
      .select()
      .from(profileTracksTable)
      .where(eq(profileTracksTable.profileId, myProfile.id))
      .orderBy(desc(profileTracksTable.createdAt))
      .limit(50);
    const tracks = rows
      .filter((t) => t.audioUrl)
      .map((t) => myMusicItemFromTrack(t, myProfile.displayName));
    /* Awaited on purpose: res.json() on the un-awaited promise would
       serialize to {} — the stored audio_url may be a storage ref
       that only the refresh turns into a playable URL. */
    res.json(await refreshSupabaseStorageUrlsDeep({ tracks }));
  } catch (err) {
    logger.error({ err }, "[world] my-music lookup failed");
    res.status(500).json({ error: "Couldn't load your songs. Try again." });
  }
});

/* ── Creator Rooms — the directory + the room's data (Ring 2, 3.5) ──────
 * GET /api/world/creator-rooms        every PUBLIC Grand Stage
 *                                     profile's room: slug, name,
 *                                     artwork, theme hues, whether
 *                                     they're "home" (has published
 *                                     work on the walls), and how
 *                                     many people are standing in
 *                                     their room right now.
 * GET /api/world/creator-rooms/:slug  one room's data: the featured
 *                                     video/track (the profile's
 *                                     spotlight pin first, else the
 *                                     newest published), the music
 *                                     rail (published tracks with
 *                                     playable URLs), the Front Row
 *                                     (the creator's court, public
 *                                     members only), and their
 *                                     storefront when they run a
 *                                     shop.
 *
 * Publicness is enforced from the profile record itself: a profile
 * that is missing OR not public is the same 404 — a private
 * creator's room does not exist, and the endpoint never confirms
 * which half of that sentence applies. Public like the directory
 * endpoint (guests may enter and look; member-gated stations pitch
 * as everywhere else). Reading a room's data also materializes its
 * palace instance (WorldPalace.noteCreatorRoom), so the doorway
 * transfer that follows always has somewhere to land. The DTOs are
 * camelCase, the world catalogs' house shape; the client parses at
 * its boundary in lib/world/creator-rooms.ts. */
export interface WorldCreatorRoomTheme {
  primary: string;
  accent: string;
  background: string;
}

export interface WorldCreatorRoomSummary {
  slug: string;
  displayName: string;
  roomName: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  theme: WorldCreatorRoomTheme;
  hasContent: boolean;
  occupantCount: number;
}

export interface WorldCreatorRoomTrack {
  id: string;
  title: string;
  audioUrl: string;
  artworkUrl: string | null;
  durationSec: number;
  playCount: number;
  likeCount: number;
  commentCount: number;
}

export interface WorldCreatorRoomVideo {
  id: string;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  durationSec: number;
  viewCount: number;
}

export interface WorldCreatorRoomFrontRowMember {
  position: number;
  profileId: string;
  slug: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface WorldCreatorRoomDetail {
  roomId: string;
  slug: string;
  displayName: string;
  roomName: string;
  bio: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  theme: WorldCreatorRoomTheme;
  followerCount: number;
  occupantCount: number;
  featuredVideo: WorldCreatorRoomVideo | null;
  featuredTrack: WorldCreatorRoomTrack | null;
  tracks: WorldCreatorRoomTrack[];
  frontRow: WorldCreatorRoomFrontRowMember[];
  storefront: { id: string; handle: string; name: string } | null;
}

type CreatorProfileRow = typeof creatorProfilesTable.$inferSelect;

/** The house hues a room wears when the creator's theme_config
 *  carries nothing usable — the palace's own gold language. */
export const CREATOR_ROOM_DEFAULT_THEME: WorldCreatorRoomTheme = {
  primary: "#d4af37",
  accent: "#f0d488",
  background: "#0d0a04",
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function hexOr(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
}

/** Pure: a profile's theme_config → the room's hues. The config is
 *  free-form JSONB (the profile page merges preset defaults over
 *  it); the room reads only colors.primary/accent/background and
 *  validates each as a hex color — anything else wears the house
 *  gold rather than an unvalidated string. */
export function creatorRoomThemeFromConfig(
  themeConfig: Record<string, unknown> | null | undefined,
): WorldCreatorRoomTheme {
  const colors =
    themeConfig && typeof themeConfig === "object" && !Array.isArray(themeConfig)
      ? (themeConfig["colors"] as Record<string, unknown> | undefined)
      : undefined;
  return {
    primary: hexOr(colors?.["primary"], CREATOR_ROOM_DEFAULT_THEME.primary),
    accent: hexOr(colors?.["accent"], CREATOR_ROOM_DEFAULT_THEME.accent),
    background: hexOr(colors?.["background"], CREATOR_ROOM_DEFAULT_THEME.background),
  };
}

/** Pure DTO mapper (exported for route tests): one public profile
 *  row → its creator-room directory row. */
export function creatorRoomSummaryFromProfile(
  profile: CreatorProfileRow,
  parts: { hasContent: boolean; occupantCount: number },
): WorldCreatorRoomSummary {
  const name = profile.displayName;
  return {
    slug: profile.slug,
    displayName: name,
    roomName: `${name}'s Room`,
    avatarUrl: profile.avatarUrl ?? null,
    bannerUrl: profile.bannerUrl ?? null,
    theme: creatorRoomThemeFromConfig(profile.themeConfig),
    hasContent: parts.hasContent,
    occupantCount: parts.occupantCount,
  };
}

function creatorRoomTrackFromRow(row: ProfileTrackRow): WorldCreatorRoomTrack {
  return {
    id: row.id,
    title: row.title,
    audioUrl: row.audioUrl,
    artworkUrl: row.artworkUrl ?? null,
    durationSec: row.durationSec ?? 0,
    playCount: row.playCount ?? 0,
    likeCount: row.likeCount ?? 0,
    commentCount: row.commentCount ?? 0,
  };
}

type ProfileVideoRow = typeof profileVideosTable.$inferSelect;

function creatorRoomVideoFromRow(row: ProfileVideoRow): WorldCreatorRoomVideo {
  return {
    id: row.id,
    title: row.title,
    videoUrl: row.videoUrl,
    thumbnailUrl: row.thumbnailUrl ?? null,
    durationSec: row.durationSec ?? 0,
    viewCount: row.viewCount ?? 0,
  };
}

/** Pure (exported for route tests): the featured picks. The
 *  profile's spotlight pin wins when it names a PUBLISHED item of
 *  its kind; otherwise the newest published item of the kind
 *  (the rail lists arrive newest-first). A pin pointing at a
 *  draft falls back — a room never features work its owner hasn't
 *  published. */
export function pickFeaturedVideo(
  profile: Pick<CreatorProfileRow, "pinnedKind" | "pinnedItemId">,
  publishedNewestFirst: ProfileVideoRow[],
): WorldCreatorRoomVideo | null {
  if (profile.pinnedKind === "video" && profile.pinnedItemId) {
    const pinned = publishedNewestFirst.find((v) => v.id === profile.pinnedItemId);
    if (pinned) return creatorRoomVideoFromRow(pinned);
  }
  const first = publishedNewestFirst[0];
  return first ? creatorRoomVideoFromRow(first) : null;
}

export function pickFeaturedTrack(
  profile: Pick<CreatorProfileRow, "pinnedKind" | "pinnedItemId">,
  publishedNewestFirst: ProfileTrackRow[],
): WorldCreatorRoomTrack | null {
  if (profile.pinnedKind === "track" && profile.pinnedItemId) {
    const pinned = publishedNewestFirst.find((t) => t.id === profile.pinnedItemId);
    if (pinned) return creatorRoomTrackFromRow(pinned);
  }
  const first = publishedNewestFirst[0];
  return first ? creatorRoomTrackFromRow(first) : null;
}

const CREATOR_ROOM_LIST_LIMIT = 60;
const CREATOR_ROOM_TRACK_LIMIT = 12;

router.get("/world/creator-rooms", publicApiLimiter, async (_req, res) => {
  try {
    const profiles = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.isPublic, true))
      .orderBy(desc(creatorProfilesTable.followerCount))
      .limit(CREATOR_ROOM_LIST_LIMIT);
    /* "Home" = published work on the walls: any published track
     * or video. One pass per kind, keyed by profile id. */
    const withTracks = await db
      .select({ profileId: profileTracksTable.profileId })
      .from(profileTracksTable)
      .where(eq(profileTracksTable.isPublished, true));
    const withVideos = await db
      .select({ profileId: profileVideosTable.profileId })
      .from(profileVideosTable)
      .where(eq(profileVideosTable.isPublished, true));
    const home = new Set<string>([
      ...withTracks.map((r) => r.profileId),
      ...withVideos.map((r) => r.profileId),
    ]);
    const rooms = profiles.map((p) =>
      creatorRoomSummaryFromProfile(p, {
        hasContent: home.has(p.id),
        occupantCount: activePalace?.creatorRoom(p.slug)?.size() ?? 0,
      }),
    );
    res.json(await refreshSupabaseStorageUrlsDeep({ rooms }));
  } catch (err) {
    logger.error({ err }, "[world] creator-rooms directory failed");
    res.status(500).json({ error: "Couldn't load the Creator Rooms. Try again." });
  }
});

router.get("/world/creator-rooms/:slug", publicApiLimiter, async (req, res) => {
  try {
    const slug = String(req.params["slug"] ?? "");
    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(and(eq(creatorProfilesTable.slug, slug), eq(creatorProfilesTable.isPublic, true)))
      .limit(1);
    if (!profile) {
      /* Unknown and private are one answer: the room isn't open. */
      res.status(404).json({ error: "That creator's room isn't open — their profile is private or doesn't exist." });
      return;
    }
    const [tracks, videos, courtEntries, shops] = await Promise.all([
      db
        .select()
        .from(profileTracksTable)
        .where(and(eq(profileTracksTable.profileId, profile.id), eq(profileTracksTable.isPublished, true)))
        .orderBy(desc(profileTracksTable.createdAt))
        .limit(CREATOR_ROOM_TRACK_LIMIT),
      db
        .select()
        .from(profileVideosTable)
        .where(and(eq(profileVideosTable.profileId, profile.id), eq(profileVideosTable.isPublished, true)))
        .orderBy(desc(profileVideosTable.createdAt))
        .limit(CREATOR_ROOM_TRACK_LIMIT),
      db
        .select()
        .from(royalCourtTable)
        .where(eq(royalCourtTable.ownerProfileId, profile.id))
        .orderBy(asc(royalCourtTable.position)),
      db
        .select()
        .from(shopsTable)
        .where(eq(shopsTable.user_id, profile.userId))
        .limit(1),
    ]);
    /* The Front Row: the creator's court, public members only —
     * the same read rule as GET /creator-profiles/:slug/court. */
    let frontRow: WorldCreatorRoomFrontRowMember[] = [];
    if (courtEntries.length > 0) {
      const memberProfiles = await db
        .select()
        .from(creatorProfilesTable)
        .where(inArray(creatorProfilesTable.id, courtEntries.map((e) => e.memberProfileId)));
      const byId = new Map(memberProfiles.map((p) => [p.id, p]));
      frontRow = courtEntries.flatMap((entry) => {
        const member = byId.get(entry.memberProfileId);
        if (!member || !member.isPublic) return [];
        return [
          {
            position: entry.position,
            profileId: member.id,
            slug: member.slug,
            displayName: member.displayName,
            avatarUrl: member.avatarUrl ?? null,
          },
        ];
      });
    }
    const shop = shops[0];
    /* The read materializes the room: the walker's doorway
     * transfer (which follows this fetch in every entry flow)
     * lands in a real instance. */
    const room = activePalace?.noteCreatorRoom(profile.slug, profile.displayName);
    const detail: WorldCreatorRoomDetail = {
      roomId: creatorRoomIdForSlug(profile.slug),
      slug: profile.slug,
      displayName: profile.displayName,
      roomName: `${profile.displayName}'s Room`,
      bio: profile.bio ?? "",
      avatarUrl: profile.avatarUrl ?? null,
      bannerUrl: profile.bannerUrl ?? null,
      theme: creatorRoomThemeFromConfig(profile.themeConfig),
      followerCount: profile.followerCount ?? 0,
      occupantCount: room?.size() ?? 0,
      featuredVideo: pickFeaturedVideo(profile, videos.filter((v) => v.videoUrl)),
      featuredTrack: pickFeaturedTrack(profile, tracks.filter((t) => t.audioUrl)),
      tracks: tracks.filter((t) => t.audioUrl).map(creatorRoomTrackFromRow),
      frontRow,
      storefront: shop ? { id: shop.id, handle: shop.handle, name: shop.name } : null,
    };
    res.json(await refreshSupabaseStorageUrlsDeep({ room: detail }));
  } catch (err) {
    logger.error({ err }, "[world] creator-room detail failed");
    res.status(500).json({ error: "Couldn't load that creator's room. Try again." });
  }
});

/** The palace's creator-room resolver (registerWorldWs): a slug
 *  hosts a room exactly when a PUBLIC profile carries it — the
 *  same record the HTTP reads enforce. */
async function resolveCreatorRoom(slug: string): Promise<{ displayName: string } | null> {
  try {
    const [profile] = await db
      .select({ displayName: creatorProfilesTable.displayName })
      .from(creatorProfilesTable)
      .where(and(eq(creatorProfilesTable.slug, slug), eq(creatorProfilesTable.isPublic, true)))
      .limit(1);
    return profile ? { displayName: profile.displayName } : null;
  } catch (err) {
    logger.warn({ err, slug }, "[world] creator-room resolve failed — room stays closed");
    return null;
  }
}

/* ── Presence socket ────────────────────────────────────────────────────── */

export interface WorldWsDeps {
  verifyToken?: AccessTokenVerifier;
  resolveIdentity?: (userId: string) => Promise<WorldIdentity>;
}

/** Default identity: the member's creator profile when they have one
 *  (their display name + avatar ride the avatar), else a plain member
 *  name from their email. Identity failure never blocks entry — it
 *  degrades to a generic member, because the room is the product. */
async function defaultResolveIdentity(userId: string, email: string | null): Promise<WorldIdentity> {
  try {
    const [profile] = await db
      .select({
        displayName: creatorProfilesTable.displayName,
        avatarUrl: creatorProfilesTable.avatarUrl,
        slug: creatorProfilesTable.slug,
      })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    if (profile) {
      return {
        userId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl ?? null,
        profileSlug: profile.slug,
      };
    }
  } catch (err) {
    logger.warn({ err, userId }, "[world] identity profile lookup failed — generic member identity");
  }
  const fromEmail = email?.split("@")[0]?.trim();
  return { userId, displayName: fromEmail || "Creator", avatarUrl: null, profileSlug: null };
}

/** "Walk in as" resolver: a Creative Vault pick becomes a presence
 *  character ONLY when the vault row belongs to the member (or their
 *  active team — the same visibility rule as GET /artist-vaults), is
 *  not soft-deleted, and carries something to stand in the hall
 *  with: a portrait (reference image), a living loop (reference
 *  video), or both. A video-only character resolves with its
 *  loopUrl and a null portrait — its living portrait stands in the
 *  hall instead of the pick being refused. Both URLs ride out
 *  through the standard storage-URL refresh so every screen in the
 *  hall gets fresh, working URLs. The loop is keyed by the row's
 *  identity end to end — never by the character's (user-editable)
 *  name. */
async function resolveVaultCharacter(userId: string, characterId: string): Promise<WorldCharacterRef | null> {
  try {
    const activeTeam = await getUserActiveTeam(userId);
    const [row] = await db
      .select({
        id: artistVaultsTable.id,
        name: artistVaultsTable.artist_name,
        portrait: artistVaultsTable.reference_image_url,
        loop: artistVaultsTable.reference_video_url,
        voiceProfile: artistVaultsTable.voice_profile,
      })
      .from(artistVaultsTable)
      .where(
        and(
          eq(artistVaultsTable.id, characterId),
          isNull(artistVaultsTable.deleted_at),
          activeTeam
            ? or(
                eq(artistVaultsTable.user_id, userId),
                eq(artistVaultsTable.team_id, activeTeam.team.id),
              )
            : eq(artistVaultsTable.user_id, userId),
        ),
      )
      .limit(1);
    if (!row || (!row.portrait && !row.loop)) return null;
    const portraitUrl = row.portrait ? await refreshSupabaseStorageUrlsDeep(row.portrait) : null;
    const loopUrl = row.loop ? await refreshSupabaseStorageUrlsDeep(row.loop) : null;
    const portrait = typeof portraitUrl === "string" && portraitUrl ? portraitUrl.slice(0, 2048) : null;
    const loop = typeof loopUrl === "string" && loopUrl ? loopUrl.slice(0, 2048) : null;
    if (!portrait && !loop) return null;
    return {
      id: row.id,
      name: (row.name ?? "Character").slice(0, 80),
      portraitUrl: portrait,
      loopUrl: loop,
      /* G4: the character's set voice rides the ref (sanitized — raw
         JSONB is never trusted); unset stays null = neutral. */
      voiceProfile: sanitizeCharacterVoiceProfile(row.voiceProfile),
    };
  } catch (err) {
    logger.warn({ err, userId }, "[world] vault character lookup failed — pick refused");
    return null;
  }
}

/**
 * The member's Creator Level stars (THE-GAME §5(a)) — EARNED rank,
 * computed on the server from recorded work by lib/creator-rank.ts
 * (the single ladder). Until the earned-rank rewire this read the
 * highest level in level_celebrations, which the old self-picked dial
 * could write at will — a claim, not a record. Celebrations now only
 * witness crossings of this computation; they no longer define it.
 * A member with no recorded work stands at 1 star. Throws on DB
 * failure — the door degrades to a starless member identity (see
 * registerWorldWs); the moment verifier treats a failed read as "no
 * level on record" and witnesses nothing.
 */
export async function resolveCreatorStars(userId: string): Promise<number> {
  return (await getCreatorRank(userId)).stars;
}

/**
 * The witnessed-moment quest rail (THE-GAME §5(a)): the member's
 * most recent RECORDED quest claim at or after `sinceMs`, read from
 * quest_progress's claimed rows — the same rows the Treasury
 * history endpoint lists. The quest's name + reward come from
 * QUEST_DEFS (server truth); a claim whose key has no def (a
 * retired quest) is not witnessable and reads as no claim.
 */
export async function findRecentQuestClaim(
  userId: string,
  sinceMs: number,
): Promise<WorldQuestClaimFact | null> {
  try {
    const [row] = await db
      .select({ questKey: questProgressTable.questKey, claimedAt: questProgressTable.claimedAt })
      .from(questProgressTable)
      .where(
        and(
          eq(questProgressTable.userId, userId),
          isNotNull(questProgressTable.claimedAt),
          gte(questProgressTable.claimedAt, new Date(sinceMs)),
        ),
      )
      .orderBy(desc(questProgressTable.claimedAt))
      .limit(1);
    if (!row?.claimedAt) return null;
    const def = QUEST_DEFS.find((q) => q.key === row.questKey);
    if (!def) return null;
    return {
      questKey: def.key,
      questName: def.name,
      rewardVb: def.reward,
      claimedAtMs: new Date(row.claimedAt).getTime(),
    };
  } catch (err) {
    logger.warn({ err, userId }, "[world] quest claim lookup failed — moment not witnessed");
    return null;
  }
}

/** The site's host identity, resolved exactly the way the /api/admin
 *  routes resolve it: the ADMIN_EMAILS list, case-insensitive. A
 *  world admin is never a client claim — it is this check, at the
 *  door, on the verified token's email. */
export function isWorldAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** Stage-claim resolver: the stream must be the member's OWN and
 *  truly live — anything else refuses the claim and the screen keeps
 *  whatever it had. */
async function resolveStageStream(userId: string, streamId: string): Promise<WorldStageLiveRef | null> {
  try {
    const [row] = await db
      .select()
      .from(liveStreamsTable)
      .where(
        and(
          eq(liveStreamsTable.id, streamId),
          eq(liveStreamsTable.user_id, userId),
          eq(liveStreamsTable.status, "live"),
        ),
      )
      .limit(1);
    if (!row) return null;
    let performerName = "Creator";
    let performerSlug: string | null = null;
    if (row.profile_id) {
      const [profile] = await db
        .select({ displayName: creatorProfilesTable.displayName, slug: creatorProfilesTable.slug })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.id, row.profile_id))
        .limit(1);
      if (profile) {
        performerName = profile.displayName;
        performerSlug = profile.slug;
      }
    }
    return { streamId: row.id, title: row.title, performerName, performerSlug };
  } catch (err) {
    logger.warn({ err, userId }, "[world] stage stream lookup failed — claim refused");
    return null;
  }
}

/** Screen-video resolver: a catalog id (`video:<id>` for a published
 *  profile video, `replay:<id>` for a stream replay) becomes a
 *  playable ref only when the content is the member's own or sits on
 *  a public profile. The URL is derived here, from the row — the
 *  client never supplies one. */
async function resolveScreenVideo(userId: string, videoId: string): Promise<WorldScreenVideoRef | null> {
  try {
    const sep = videoId.indexOf(":");
    if (sep <= 0) return null;
    const kind = videoId.slice(0, sep);
    const id = videoId.slice(sep + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    if (kind === "video") {
      const [row] = await db
        .select()
        .from(profileVideosTable)
        .where(and(eq(profileVideosTable.id, id), eq(profileVideosTable.isPublished, true)))
        .limit(1);
      if (!row?.videoUrl) return null;
      const [profile] = await db
        .select()
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.id, row.profileId))
        .limit(1);
      if (!profile || (profile.userId !== userId && !profile.isPublic)) return null;
      const url = await refreshSupabaseStorageUrlsDeep(row.videoUrl);
      if (typeof url !== "string" || !url) return null;
      return {
        id: videoId,
        title: row.title.slice(0, 120),
        url: url.slice(0, 2048),
        mediaKind: mediaKindOf(url),
        creatorName: profile.displayName,
      };
    }
    if (kind === "replay") {
      const [row] = await db
        .select()
        .from(liveStreamsTable)
        .where(and(eq(liveStreamsTable.id, id), isNotNull(liveStreamsTable.vod_url)))
        .limit(1);
      if (!row?.vod_url) return null;
      let creatorName: string | null = null;
      let own = row.user_id === userId;
      if (row.profile_id) {
        const [profile] = await db
          .select()
          .from(creatorProfilesTable)
          .where(eq(creatorProfilesTable.id, row.profile_id))
          .limit(1);
        if (profile) {
          creatorName = profile.displayName;
          own = own || profile.isPublic;
        }
      }
      if (!own) return null;
      const url = await refreshSupabaseStorageUrlsDeep(row.vod_url);
      if (typeof url !== "string" || !url) return null;
      return {
        id: videoId,
        title: row.title.slice(0, 120),
        url: url.slice(0, 2048),
        mediaKind: mediaKindOf(url),
        creatorName,
      };
    }
    return null;
  } catch (err) {
    logger.warn({ err, userId }, "[world] screen video lookup failed — pick refused");
    return null;
  }
}

/** Jukebox resolver: a catalog id (`track:<uuid>`) becomes a
 *  playable ref only when the track is truly published and sits on
 *  the member's own profile or a public one. The URL is derived
 *  here, from the row — the client never supplies one. Mirrors
 *  resolveScreenVideo deliberately: same id-only discipline. */
async function resolveJukeboxTrack(userId: string, trackId: string): Promise<WorldJukeboxTrackRef | null> {
  try {
    if (!trackId.startsWith("track:")) return null;
    const id = trackId.slice("track:".length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const [row] = await db
      .select()
      .from(profileTracksTable)
      .where(and(eq(profileTracksTable.id, id), eq(profileTracksTable.isPublished, true)))
      .limit(1);
    if (!row?.audioUrl) return null;
    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, row.profileId))
      .limit(1);
    if (!profile || (profile.userId !== userId && !profile.isPublic)) return null;
    const url = await refreshSupabaseStorageUrlsDeep(row.audioUrl);
    if (typeof url !== "string" || !url) return null;
    return {
      id: trackId,
      title: row.title.slice(0, 120),
      url: url.slice(0, 2048),
      durationSec: row.durationSec,
      creatorName: profile.displayName,
      artworkUrl: row.artworkUrl,
    };
  } catch (err) {
    logger.warn({ err, userId }, "[world] jukebox track lookup failed — pick refused");
    return null;
  }
}

export function registerWorldWs(gateway: LiveWsGateway, deps: WorldWsDeps = {}): WorldPalace {
  const verify = deps.verifyToken ?? verifyAccessToken;
  const hub = new RoomHub();
  const palace = new WorldPalace(
    hub,
    {
      resolveCharacter: resolveVaultCharacter,
      resolveStageStream,
      resolveScreenVideo,
      resolveJukeboxTrack,
      /* Drop spectacles (3.4) pay through the existing drop rails —
       * the claimer owns the weekly budget check + grant + ledger. */
      claimWorldDrop: claimSpectacleDrop,
      /* The King's daily moment (Ring 3): the hall's gift claims
       * pay through the weekly quest pool — the claimer owns the
       * window check, the pool envelope, the once-a-day ledger and
       * the grant (lib/world-king-moment). Only the hall receives
       * the full deps object, so only the hall can hold court. */
      claimKingMoment: createKingMomentClaimer(),
      /* Stage tips from seats (Ring 3, item 3.3): the transfer
       * (debit → world_stage_tips ledger → performer credit,
       * refunds on failure) lives in lib/world-stage-tips; the
       * palace hands it to the two stage rooms (hall + Music
       * Hall). No fee — no house rule prices a cut of VB tips. */
      tipStagePerformer: createStageTipper(),
      /* Witnessed moments (THE-GAME §5(a)): the rooms verify quest +
       * levelup intents against these rails. A failed stars read is
       * "no level on record" — the moment is refused, never guessed. */
      resolveStars: async (userId) => {
        try {
          return await resolveCreatorStars(userId);
        } catch (err) {
          logger.warn({ err, userId }, "[world] stars lookup failed — moment not witnessed");
          return null;
        }
      },
      findRecentQuestClaim,
    },
    /* Creator Rooms (3.5): doorway transfers to a `creator:<slug>`
     * resolve the slug against the public profile record before
     * the room materializes. */
    { resolveCreatorRoom },
  );
  activePalace = palace;
  /* Presence truth: reap frame-silent peers on a tick — a dead
   * browser's close cannot be trusted to arrive through the
   * hosting router (see WORLD_PEER_STALE_MS in lib/world-room). */
  palace.startPresenceSweeper();

  gateway.register("/api/world/ws", async ({ socket, query }) => {
    const token = query.get("token");
    const auth = token ? await verify(token).catch(() => null) : null;
    /* A guest's per-tab session id: sanitized to a tame charset —
     * anything else is treated as no id (the guest still enters;
     * their rejoins just can't replace a ghost until it goes
     * stale). Members never use it; their account is the key. */
    const guestRaw = query.get("guest");
    const guestSessionId =
      guestRaw && /^[A-Za-z0-9_-]{8,64}$/.test(guestRaw) ? guestRaw : null;

    let identity: WorldIdentity;
    if (auth) {
      identity = deps.resolveIdentity
        ? await deps.resolveIdentity(auth.userId).catch(() => ({
            userId: auth.userId,
            displayName: "Creator",
            avatarUrl: null,
            profileSlug: null,
          }))
        : await defaultResolveIdentity(auth.userId, auth.email);
    } else {
      identity = {
        userId: null,
        displayName: "Guest",
        avatarUrl: null,
        profileSlug: null,
        guestSessionId,
      };
    }
    /* Host authority rides the verified token's email — resolved
     * here, server-side, the same way the admin routes resolve it. */
    identity = { ...identity, admin: auth ? isWorldAdminEmail(auth.email) : false };

    /* Creator Level stars ride the identity too — resolved here,
     * at the door, from the API's level rails (resolveCreatorStars),
     * never from anything the client sent. A failed read degrades
     * to a starless member: the room still opens, the nameplate
     * simply shows no stars yet. Guests never reach this line. */
    if (identity.userId) {
      try {
        identity = { ...identity, stars: await resolveCreatorStars(identity.userId) };
      } catch (err) {
        logger.warn({ err, userId: identity.userId }, "[world] stars lookup failed at the door — starless member");
      }
    }

    const client = socket as unknown as WsClientSocket;
    /* Everyone enters through the hall; doorways move them after.
     * The directory rides the attach's change broadcast — the
     * joiner is inside when it fires, so entry carries exactly one
     * palace.directory frame, right after the welcome. */
    if (!palace.enterHall(client, identity)) return; // room_full already sent
    socket.on("message", (data) => {
      try {
        palace.handleFrame(client, data.toString());
      } catch (err) {
        logger.warn({ err }, "[world] frame handling failed");
      }
    });
    socket.on("close", () => palace.detach(client));
    socket.on("error", () => palace.detach(client));
  });

  return palace;
}

/**
 * Start the palace calendar's scheduler tick (World Events, lib/
 * world-events): every WORLD_EVENT_TICK_MS it starts due stage
 * shows / listening parties / drops in their rooms, ends what's
 * over, and refreshes the directory slate. Called once from
 * index.ts after the WS mount — tests drive the scheduler class
 * directly instead, so no interval ever runs under vitest. The
 * first tick runs immediately: a restart mid-show re-drives the
 * live events' room state instead of stranding them.
 */
export function startWorldEventScheduler(palace: WorldPalace): { stop: () => void } {
  const scheduler = new WorldEventScheduler({
    palace,
    resolveScreenVideo,
    resolveJukeboxTrack,
  });
  const run = () => {
    void scheduler.tick().catch((err) => {
      logger.warn({ err }, "[world-events] scheduler tick failed");
    });
  };
  run();
  const timer = setInterval(run, WORLD_EVENT_TICK_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

/**
 * Start the King's daily moment scheduler (Ring 3, lib/
 * world-king-moment): every KING_MOMENT_TICK_MS it fires the day's
 * moment if the palace hasn't held it yet (herald through the
 * announce channel + the hall's claim window opens) and keeps the
 * hall's standing window in step with the durable king_moments
 * row. Called once from index.ts after the WS mount — tests drive
 * the scheduler class directly, so no interval runs under vitest.
 * The first tick runs immediately: a restart mid-window repairs
 * the hall's claim state from the row.
 */
export function startKingMomentScheduler(palace: WorldPalace): { stop: () => void } {
  const scheduler = new KingMomentScheduler({ palace });
  const run = () => {
    void scheduler.tick().catch((err) => {
      logger.warn({ err }, "[king-moment] scheduler tick failed");
    });
  };
  run();
  const timer = setInterval(run, KING_MOMENT_TICK_MS);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

export default router;
