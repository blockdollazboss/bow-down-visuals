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
import { and, desc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import {
  db,
  artistVaultsTable,
  creatorProfilesTable,
  liveStreamsTable,
  profileTracksTable,
  profileVideosTable,
} from "@workspace/db";
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
  type WorldScreenVideoRef,
  type WorldStageLiveRef,
} from "../lib/world-room";
import { WorldPalace } from "../lib/world-palace";
import { sanitizeCharacterVoiceProfile } from "../lib/character-voice-profile";

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
    res.json(refreshSupabaseStorageUrlsDeep({ catalog: { mine, public: pub } }));
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
    res.json(refreshSupabaseStorageUrlsDeep({ catalog: { mine, public: pub } }));
  } catch (err) {
    logger.error({ err }, "[world] jukebox catalog lookup failed");
    res.status(500).json({ error: "Couldn't load the song catalog. Try again." });
  }
});

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
  const palace = new WorldPalace(hub, {
    resolveCharacter: resolveVaultCharacter,
    resolveStageStream,
    resolveScreenVideo,
    resolveJukeboxTrack,
  });
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

export default router;
