import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  playlistsTable,
  followsTable,
  profileCommentsTable,
  mediaCommentsTable,
  likesTable,
  repostsTable,
  playEventsTable,
  notificationsTable,
  dmcaReportsTable,
  shopsTable,
} from "@workspace/db";
import { eq, and, desc, sql, count, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { getRecruiterBadgeForUser } from "./referrals";
import { computeAchievements } from "./generate/milestones";
import { sendEmail, emailShell, escapeHtml, isEmailConfigured } from "../lib/email";

/** Operator emails for alerts (ADMIN_EMAILS, comma-separated). */
function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

const router = Router();

/* ── Creator Streaming Platform — public contract (for other workers) ───────
   ALL CREATORS — not music-only. `vertical` on creator_profiles classifies
   the lane ('music' | 'video' | 'gaming' | 'podcast' | 'film' | 'tv' |
   'influencer' | 'education' | 'other'). The profile_tracks and
   profile_videos table names stay stable (contract), but they hold GENERIC
   audio/video content: a podcaster's episodes live in profile_tracks, a
   YouTuber's uploads in profile_videos. Same columns, same counters.
   Vertical extras: stream_schedule JSONB on profiles (gamers: [{day,time,title}],
   twitch/youtube/kick URLs live in social_links); media_kit JSONB on profiles
   (influencers: {audience_size, engagement_rate, rates, niches});
   playlists.kind 'playlist'|'series' + profile_videos.season/episode for
   film/TV episodic series (ordered playlist items = episode order).
   profile_videos.sound_track_id (nullable FK -> profile_tracks, SET NULL):
   video <-> sound linkage.
   LINK GRAPH (every payload carries two-way link fields — no extra fetches):
   - profile payloads: id, slug, vertical + presence flags has_downloads
     (store), has_social_links, has_stream_schedule, has_media_kit,
     tip_jar_enabled (tips) + monetization_checklist {has_product,
     has_price, has_tip_jar, has_domain, has_audience} with
     money_moves_done / money_moves_total (5) — "guide them to the money":
     UI renders "N of 5 money moves done" with zero extra fetches.
     has_domain = user has a shop with a verified custom domain.
     Link: /artist/:slug everywhere.
   - track/video payloads: id, profile_id, profile_slug, buyable,
     download_price_cents; videos also carry sound {id,title,audio_url,
     artwork_url,profile_slug} | null.
   - playlists: id, owner_profile_id, owner_profile_slug, kind,
     items (raw {kind,id}) + resolved_items [{kind,id,title,artwork_url,
     profile_slug,buyable}] in read order.
   - comments (wall + media): id, author_user_id, author_profile_slug.
   - like/unlike/repost/unrepost: fresh like_count / repost_count.
   - play: fresh plays count (play_count / view_count).
   - follow/unfollow: fresh follower_count.
   - notifications: link field points at the in-site destination.
   Tables (lib/db/migrations 0085–0088, drizzle lib/db/src/schema/):
     creator_profiles(user_id UNIQUE, slug UNIQUE, display_name, bio,
       avatar_url, banner_url, theme_id DEFAULT 'gold-lux', theme_config JSONB,
       sections JSONB, featured_media JSONB, social_links JSONB,
       top_creators JSONB, tip_jar_enabled, ai_design JSONB, is_public,
       follower_count, total_plays, created_at, updated_at)
     profile_tracks(profile_id FK CASCADE, title, audio_url, artwork_url,
       genre, tags TEXT[], isrc, duration_sec,
       download_price_cents [0=stream-only, >0=paid download],
       play_count, like_count, repost_count, comment_count,
       is_published, created_at)
     profile_videos(profile_id FK CASCADE, title, video_url, thumbnail_url,
       description, genre, tags TEXT[], duration_sec, download_price_cents,
       view_count, like_count, repost_count, comment_count,
       is_published, created_at)
     playlists(owner_profile_id FK CASCADE, title, description, cover_url,
       is_public, items JSONB [{kind:'track'|'video', id}], follower_count)
     follows(follower_user_id, profile_id) PK both
     profile_comments(profile_id FK CASCADE, author_user_id, body)
     media_comments(kind 'track'|'video', media_id, author_user_id, body)
     likes(user_id, kind, target_id) PK all three
     reposts(user_id, track_id) PK both
     play_events(kind, media_id, user_id NULLABLE, played_at)
     notifications(user_id, kind, title, body, link, is_read)
     digital_sales(buyer_user_id, profile_id, item_kind 'track'|'album',
       item_id, stripe_session_id UNIQUE, amount_cents, platform_fee_cents,
       creator_amount_cents)
     download_links(token PK, sale_id FK CASCADE, file_url, expires_at, used_count)
     dmca_reports(reporter_name, reporter_email, reporter_org,
       infringing_urls JSONB, original_urls JSONB, description,
       agree_under_penalty, status DEFAULT 'new')
*/

/* ── Zod schemas ───────────────────────────────────────────────────────────── */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const slugSchema = z.string().trim().toLowerCase().regex(SLUG_RE,
  "Slug must be 3-40 chars: lowercase letters, numbers, hyphens; no leading/trailing hyphen.");

const VERTICALS = ["music", "video", "gaming", "podcast", "film", "tv", "influencer", "education", "other"] as const;
const verticalSchema = z.string().trim().toLowerCase().pipe(z.enum(VERTICALS));

const streamScheduleSchema = z.array(z.object({
  day: z.string().trim().max(20),
  time: z.string().trim().max(20),
  title: z.string().trim().max(120).optional(),
})).max(14);

const mediaKitSchema = z.record(z.string(), z.unknown());

const upsertProfileSchema = z.object({
  slug: slugSchema,
  display_name: z.string().trim().min(1).max(80),
  vertical: verticalSchema.optional().default("music"),
  stream_schedule: streamScheduleSchema.optional().default([]),
  media_kit: mediaKitSchema.optional().nullable(),
  bio: z.string().max(2000).optional().default(""),
  avatar_url: z.string().url().optional().nullable(),
  banner_url: z.string().url().optional().nullable(),
  theme_id: z.string().max(40).optional().default("gold-lux"),
  theme_config: z.record(z.string(), z.unknown()).optional().default({}),
  sections: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  featured_media: z.record(z.string(), z.unknown()).optional().nullable(),
  social_links: z.record(z.string(), z.string()).optional().default({}),
  top_creators: z.array(z.record(z.string(), z.unknown())).optional().default([]),
  tip_jar_enabled: z.boolean().optional().default(true),
  ai_design: z.record(z.string(), z.unknown()).optional().nullable(),
  is_public: z.boolean().optional().default(true),
});

const updateMeSchema = z.object({
  bio: z.string().max(2000).optional(),
  vertical: verticalSchema.optional(),
  stream_schedule: streamScheduleSchema.optional(),
  media_kit: mediaKitSchema.optional().nullable(),
  avatar_url: z.string().url().optional().nullable(),
  banner_url: z.string().url().optional().nullable(),
  theme_id: z.string().max(40).optional(),
  theme_config: z.record(z.string(), z.unknown()).optional(),
  sections: z.array(z.record(z.string(), z.unknown())).optional(),
  featured_media: z.record(z.string(), z.unknown()).optional().nullable(),
  social_links: z.record(z.string(), z.string()).optional(),
  top_creators: z.array(z.record(z.string(), z.unknown())).optional(),
  tip_jar_enabled: z.boolean().optional(),
  ai_design: z.record(z.string(), z.unknown()).optional().nullable(),
  is_public: z.boolean().optional(),
  display_name: z.string().trim().min(1).max(80).optional(),
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

const dmcaReportSchema = z.object({
  reporter_name: z.string().trim().min(1).max(120),
  reporter_email: z.string().trim().email().max(200),
  reporter_org: z.string().trim().max(200).optional().nullable(),
  infringing_urls: z.array(z.string().url().max(500)).min(1).max(25),
  original_urls: z.array(z.string().url().max(500)).max(25).optional().default([]),
  description: z.string().trim().min(20).max(5000),
  agree_under_penalty: z.string().trim().min(1).max(100),
});

/* ── Helpers ───────────────────────────────────────────────────────────────── */

const MEDIA_KINDS = ["track", "video"] as const;
type MediaKind = (typeof MEDIA_KINDS)[number];

function parseKind(v: unknown): MediaKind | null {
  return v === "track" || v === "video" ? v : null;
}

async function getProfileById(id: string) {
  const [row] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, id)).limit(1);
  return row ?? null;
}

async function getMedia(kind: MediaKind, id: string) {
  if (kind === "track") {
    const [row] = await db.select().from(profileTracksTable).where(eq(profileTracksTable.id, id)).limit(1);
    return row ?? null;
  }
  const [row] = await db.select().from(profileVideosTable).where(eq(profileVideosTable.id, id)).limit(1);
  return row ?? null;
}

/** Internal counter columns per media kind. Identifiers are constants — never user input. */
const COUNTER_TABLES: Record<MediaKind, string> = { track: "profile_tracks", video: "profile_videos" };
const COUNTER_COLUMNS: Record<string, string> = {
  "track:play": "play_count", "track:like": "like_count",
  "track:repost": "repost_count", "track:comment": "comment_count",
  "video:play": "view_count", "video:like": "like_count",
  "video:repost": "repost_count", "video:comment": "comment_count",
};

async function bumpCounter(
  kind: MediaKind,
  id: string,
  action: "play" | "like" | "repost" | "comment",
  delta: 1 | -1 = 1,
): Promise<void> {
  const table = COUNTER_TABLES[kind]!;
  const col = COUNTER_COLUMNS[`${kind}:${action}`]!;
  await db.execute(sql`
    UPDATE ${sql.identifier(table)}
    SET ${sql.identifier(col)} = GREATEST(${sql.identifier(col)} + ${delta}, 0)
    WHERE ${sql.identifier("id")} = ${id}
  `);
}

/** Best-effort notification to the profile owner; never fails the request. */
async function notify(profileOwnerUserId: string | null | undefined, n: {
  kind: string; title: string; body?: string; link?: string;
}) {
  if (!profileOwnerUserId) return;
  try {
    await db.insert(notificationsTable).values({
      userId: profileOwnerUserId,
      kind: n.kind,
      title: n.title,
      body: n.body ?? "",
      link: n.link ?? "",
    });
  } catch (err) {
    // Notification delivery is non-critical.
  }
}

/* ── Link-graph helpers ───────────────────────────────────────────────────────
   Rule: every payload carries what its neighbors need for two-way linking.
   - media payloads: profile_slug + buyable/download_price_cents + sound (videos)
   - comments: author_profile_slug
   - playlists: owner_profile_slug + resolved_items (kind/id/title/artwork/profile_slug)
   - profiles: presence flags (has_downloads = store, has_social_links, tip_jar_enabled, has_stream_schedule)
*/

async function authorSlugMap(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return map;
  const rows = await db.select({ userId: creatorProfilesTable.userId, slug: creatorProfilesTable.slug })
    .from(creatorProfilesTable)
    .where(inArray(creatorProfilesTable.userId, unique));
  for (const r of rows) map.set(r.userId, r.slug);
  return map;
}

function withAuthorSlugs<T extends { authorUserId: string }>(
  comments: T[], slugs: Map<string, string>,
): Array<T & { author_profile_slug: string | null }> {
  return comments.map((c) => ({
    ...c,
    author_profile_slug: slugs.get(c.authorUserId) ?? null,
  }));
}

type TrackRow = typeof profileTracksTable.$inferSelect;
type VideoRow = typeof profileVideosTable.$inferSelect;

function enrichTrack(row: TrackRow, profileSlug: string) {
  return {
    ...row,
    profile_slug: profileSlug,
    buyable: (row.downloadPriceCents ?? 0) > 0,
    download_price_cents: row.downloadPriceCents ?? 0,
  };
}

function enrichVideo(
  row: VideoRow,
  profileSlug: string,
  sounds: Map<string, { id: string; title: string; audio_url: string; artwork_url: string | null; profile_slug: string }>,
) {
  return {
    ...row,
    profile_slug: profileSlug,
    buyable: (row.downloadPriceCents ?? 0) > 0,
    download_price_cents: row.downloadPriceCents ?? 0,
    sound: row.soundTrackId ? (sounds.get(row.soundTrackId) ?? null) : null,
  };
}

/**
 * Presence flags + monetization checklist ("guide them to the money").
 * Every profile payload carries these so UI workers can render the
 * "N of 5 money moves done" Get-Paid nudge with zero extra round-trips.
 * The 5 money moves: has_product -> has_price -> has_tip_jar -> has_domain
 * -> has_audience. Vertical-agnostic: a gamer's VODs are products, a
 * podcaster's episodes are products, an educator's course videos too.
 */
async function profileExtras(profile: typeof creatorProfilesTable.$inferSelect) {
  const [tracks, videos, domainShops] = await Promise.all([
    db.select({ price: profileTracksTable.downloadPriceCents }).from(profileTracksTable).where(and(
      eq(profileTracksTable.profileId, profile.id),
      eq(profileTracksTable.isPublished, true),
    )),
    db.select({ price: profileVideosTable.downloadPriceCents }).from(profileVideosTable).where(and(
      eq(profileVideosTable.profileId, profile.id),
      eq(profileVideosTable.isPublished, true),
    )),
    db.select({ id: shopsTable.id }).from(shopsTable).where(and(
      eq(shopsTable.user_id, profile.userId),
      eq(shopsTable.domain_verified, true),
    )).limit(1),
  ]);
  const hasProduct = tracks.length + videos.length > 0;
  const hasPrice =
    tracks.some((t) => (t.price ?? 0) > 0) || videos.some((v) => (v.price ?? 0) > 0);
  const socialLinks = (profile.socialLinks ?? {}) as Record<string, string>;
  const monetization_checklist = {
    has_product: hasProduct,
    has_price: hasPrice,
    has_tip_jar: profile.tipJarEnabled ?? false,
    has_domain: domainShops.length > 0,
    has_audience: (profile.followerCount ?? 0) > 0,
  };
  const money_moves_done = Object.values(monetization_checklist).filter(Boolean).length;
  return {
    has_downloads: hasPrice,
    has_social_links: Object.keys(socialLinks).length > 0,
    has_stream_schedule: (profile.streamSchedule ?? []).length > 0,
    has_media_kit: profile.mediaKit !== null,
    monetization_checklist,
    money_moves_done,
    money_moves_total: 5,
  };
}

/** Batch-resolve sound linkage for videos: sound_track_id -> {id,title,audio_url,artwork_url,profile_slug}. */
async function soundMapFor(
  videos: VideoRow[], profileSlug: string,
): Promise<Map<string, { id: string; title: string; audio_url: string; artwork_url: string | null; profile_slug: string }>> {
  const map = new Map<string, { id: string; title: string; audio_url: string; artwork_url: string | null; profile_slug: string }>();
  const ids = [...new Set(videos.map((v) => v.soundTrackId).filter((x): x is string => !!x))];
  if (ids.length === 0) return map;
  const rows = await db.select().from(profileTracksTable).where(inArray(profileTracksTable.id, ids));
  for (const t of rows) {
    map.set(t.id, {
      id: t.id,
      title: t.title,
      audio_url: t.audioUrl,
      artwork_url: t.artworkUrl,
      profile_slug: profileSlug,
    });
  }
  return map;
}

type PlaylistRow = typeof playlistsTable.$inferSelect;

interface ResolvedPlaylistItem {
  kind: "track" | "video";
  id: string;
  title: string;
  artwork_url: string | null;
  profile_slug: string;
  buyable: boolean;
}

/** Resolve playlist items (stored as {kind,id}) into linkable detail objects. */
async function resolvePlaylistItems(
  playlists: PlaylistRow[], profileSlug: string,
): Promise<Array<PlaylistRow & { owner_profile_slug: string; resolved_items: ResolvedPlaylistItem[] }>> {
  const trackIds = new Set<string>();
  const videoIds = new Set<string>();
  for (const p of playlists) {
    for (const item of p.items ?? []) {
      if (item?.kind === "track" && item.id) trackIds.add(item.id);
      if (item?.kind === "video" && item.id) videoIds.add(item.id);
    }
  }
  const [tracks, videos] = await Promise.all([
    trackIds.size
      ? db.select().from(profileTracksTable).where(inArray(profileTracksTable.id, [...trackIds]))
      : Promise.resolve([] as TrackRow[]),
    videoIds.size
      ? db.select().from(profileVideosTable).where(inArray(profileVideosTable.id, [...videoIds]))
      : Promise.resolve([] as VideoRow[]),
  ]);
  const byId = new Map<string, ResolvedPlaylistItem>();
  for (const t of tracks) {
    byId.set(t.id, {
      kind: "track", id: t.id, title: t.title,
      artwork_url: t.artworkUrl, profile_slug: profileSlug,
      buyable: (t.downloadPriceCents ?? 0) > 0,
    });
  }
  for (const v of videos) {
    byId.set(v.id, {
      kind: "video", id: v.id, title: v.title,
      artwork_url: v.thumbnailUrl, profile_slug: profileSlug,
      buyable: (v.downloadPriceCents ?? 0) > 0,
    });
  }
  return playlists.map((p) => ({
    ...p,
    owner_profile_slug: profileSlug,
    resolved_items: (p.items ?? [])
      .map((item) => (item?.id ? byId.get(item.id) ?? null : null))
      .filter((x): x is ResolvedPlaylistItem => x !== null),
  }));
}

/** Rate limiter: 1 counted play per IP per media item per 60s window. */
const playLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip ?? "unknown"}|${req.params["kind"] ?? "?"}|${req.params["id"] ?? "?"}`,
  message: { error: "Already counted that play — the cheat code remembers. 🦈" },
});

/* ── Profiles ──────────────────────────────────────────────────────────────── */

/** Public profile page payload. 404 when the profile is private. */
router.get("/creator-profiles/:slug", async (req, res) => {
  try {
    const [profile] = await db
      .select()
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, String(req.params["slug"]).toLowerCase()))
      .limit(1);
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private. 🦈" });
      return;
    }

    const [topTracks, topVideos, profilePlaylists, counts] = await Promise.all([
      db.select().from(profileTracksTable)
        .where(and(eq(profileTracksTable.profileId, profile.id), eq(profileTracksTable.isPublished, true)))
        .orderBy(desc(profileTracksTable.playCount)).limit(5),
      db.select().from(profileVideosTable)
        .where(and(eq(profileVideosTable.profileId, profile.id), eq(profileVideosTable.isPublished, true)))
        .orderBy(desc(profileVideosTable.viewCount)).limit(5),
      db.select().from(playlistsTable)
        .where(and(eq(playlistsTable.ownerProfileId, profile.id), eq(playlistsTable.isPublic, true)))
        .orderBy(desc(playlistsTable.createdAt)).limit(5),
      db.select({ trackCount: count() }).from(profileTracksTable)
        .where(and(eq(profileTracksTable.profileId, profile.id), eq(profileTracksTable.isPublished, true)))
        .then(async (trackRows) => {
          const videoRows = await db.select({ videoCount: count() }).from(profileVideosTable)
            .where(and(eq(profileVideosTable.profileId, profile.id), eq(profileVideosTable.isPublished, true)));
          const playlistRows = await db.select({ playlistCount: count() }).from(playlistsTable)
            .where(and(eq(playlistsTable.ownerProfileId, profile.id), eq(playlistsTable.isPublic, true)));
          return {
            tracks: trackRows[0]?.trackCount ?? 0,
            videos: videoRows[0]?.videoCount ?? 0,
            playlists: playlistRows[0]?.playlistCount ?? 0,
          };
        }),
    ]);

    const sounds = await soundMapFor(topVideos, profile.slug);
    const extras = await profileExtras(profile);
    /* Virality wave: recruiter badge (Kingpin tier) for the profile header. */
    const recruiterBadge = await getRecruiterBadgeForUser(profile.userId).catch(() => null);

    res.json({
      profile: {
        id: profile.id,
        slug: profile.slug,
        display_name: profile.displayName,
        vertical: profile.vertical,
        stream_schedule: profile.streamSchedule,
        media_kit: profile.mediaKit,
        bio: profile.bio,
        avatar_url: profile.avatarUrl,
        banner_url: profile.bannerUrl,
        theme_id: profile.themeId,
        theme_config: profile.themeConfig,
        sections: profile.sections,
        featured_media: profile.featuredMedia,
        social_links: profile.socialLinks,
        top_creators: profile.topCreators,
        tip_jar_enabled: profile.tipJarEnabled,
        follower_count: profile.followerCount,
        total_plays: profile.totalPlays,
        created_at: profile.createdAt,
        // Virality wave: the creator's referral rank badge (null when none).
        recruiter_badge: recruiterBadge,
        // Presence flags + monetization checklist — neighbors link off these
        // without extra round-trips; UI renders "N of 5 money moves done".
        ...extras,
      },
      counts,
      top_tracks: topTracks.map((t) => enrichTrack(t, profile.slug)),
      top_videos: topVideos.map((v) => enrichVideo(v, profile.slug, sounds)),
      playlists: await resolvePlaylistItems(profilePlaylists, profile.slug),
    });
  } catch (err) {
    req.log.error({ err }, "creator-profiles/:slug error");
    res.status(500).json({ error: "The profile wouldn't load. Give it another shot." });
  }
});

/** GET /api/creator-profiles/:slug/achievements — public trophy shelf:
   every crossed milestone threshold (streams, followers, earnings,
   releases) for a public profile. 404 when the profile is private. */
router.get("/creator-profiles/:slug/achievements", async (req, res) => {
  try {
    const [profile] = await db
      .select({
        userId: creatorProfilesTable.userId,
        isPublic: creatorProfilesTable.isPublic,
        displayName: creatorProfilesTable.displayName,
        avatarUrl: creatorProfilesTable.avatarUrl,
        slug: creatorProfilesTable.slug,
      })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, String(req.params["slug"]).toLowerCase()))
      .limit(1);
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private. 🦈" });
      return;
    }
    const { achievements, totals } = await computeAchievements(profile.userId);
    res.json({
      achievements,
      totals,
      profile: {
        slug: profile.slug,
        display_name: profile.displayName,
        avatar_url: profile.avatarUrl,
      },
    });
  } catch (err) {
    req.log.error({ err }, "creator-profiles/:slug/achievements error");
    res.status(500).json({ error: "The trophy shelf wouldn't load. Give it another shot." });
  }
});

/** Create or update the caller's profile (one per user). */
router.post("/creator-profiles", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const parsed = upsertProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That profile data didn't pass the vibe check.", details: parsed.error.issues });
      return;
    }
    const data = parsed.data;

    const [existing] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId)).limit(1);

    // Slug must be unique across OTHER profiles.
    const [slugTaken] = await db.select({ id: creatorProfilesTable.id }).from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, data.slug)).limit(1);
    if (slugTaken && (!existing || slugTaken.id !== existing.id)) {
      res.status(409).json({ error: "That handle's already claimed. Cheat-code thinkers pick a fresh one." });
      return;
    }

    const values = {
      userId,
      slug: data.slug,
      displayName: data.display_name,
      vertical: data.vertical,
      streamSchedule: data.stream_schedule,
      mediaKit: data.media_kit ?? null,
      bio: data.bio,
      avatarUrl: data.avatar_url ?? null,
      bannerUrl: data.banner_url ?? null,
      themeId: data.theme_id,
      themeConfig: data.theme_config,
      sections: data.sections,
      featuredMedia: data.featured_media ?? null,
      socialLinks: data.social_links,
      topCreators: data.top_creators,
      tipJarEnabled: data.tip_jar_enabled,
      aiDesign: data.ai_design ?? null,
      isPublic: data.is_public,
      updatedAt: new Date(),
    };

    if (existing) {
      const [updated] = await db.update(creatorProfilesTable).set(values)
        .where(eq(creatorProfilesTable.id, existing.id)).returning();
      res.json({ profile: { ...updated, ...(await profileExtras(updated)) }, created: false });
      return;
    }
    const [created] = await db.insert(creatorProfilesTable).values(values).returning();
    res.status(201).json({ profile: { ...created, ...(await profileExtras(created)) }, created: true });
  } catch (err) {
    req.log.error({ err }, "creator-profiles POST error");
    res.status(500).json({ error: "The save fumbled. Run it back." });
  }
});

/** Update the caller's profile (theme, sections, bio, links, etc.). */
router.put("/creator-profiles/me", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That profile data didn't pass the vibe check.", details: parsed.error.issues });
      return;
    }
    const data = parsed.data;

    const [existing] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId)).limit(1);
    if (!existing) {
      res.status(404).json({ error: "No profile yet — claim your corner of the cheat code first." });
      return;
    }

    const patch: Partial<typeof creatorProfilesTable.$inferInsert> = { updatedAt: new Date() };
    if (data.vertical !== undefined) patch.vertical = data.vertical;
    if (data.stream_schedule !== undefined) patch.streamSchedule = data.stream_schedule;
    if (data.media_kit !== undefined) patch.mediaKit = data.media_kit;
    if (data.bio !== undefined) patch.bio = data.bio;
    if (data.avatar_url !== undefined) patch.avatarUrl = data.avatar_url;
    if (data.banner_url !== undefined) patch.bannerUrl = data.banner_url;
    if (data.theme_id !== undefined) patch.themeId = data.theme_id;
    if (data.theme_config !== undefined) patch.themeConfig = data.theme_config;
    if (data.sections !== undefined) patch.sections = data.sections;
    if (data.featured_media !== undefined) patch.featuredMedia = data.featured_media;
    if (data.social_links !== undefined) patch.socialLinks = data.social_links;
    if (data.top_creators !== undefined) patch.topCreators = data.top_creators;
    if (data.tip_jar_enabled !== undefined) patch.tipJarEnabled = data.tip_jar_enabled;
    if (data.ai_design !== undefined) patch.aiDesign = data.ai_design;
    if (data.is_public !== undefined) patch.isPublic = data.is_public;
    if (data.display_name !== undefined) patch.displayName = data.display_name;

    const [updated] = await db.update(creatorProfilesTable).set(patch)
      .where(eq(creatorProfilesTable.id, existing.id)).returning();
    res.json({ profile: { ...updated, ...(await profileExtras(updated)) } });
  } catch (err) {
    req.log.error({ err }, "creator-profiles/me error");
    res.status(500).json({ error: "The update slipped. Try again." });
  }
});

/** Slug availability check for the profile editor. */
router.get("/creator-profiles/check-slug", requireAuth, async (req, res) => {
  try {
    const raw = String(req.query["slug"] ?? "");
    const parsed = slugSchema.safeParse(raw);
    if (!parsed.success) {
      res.json({ available: false, valid: false, error: parsed.error.issues[0]?.message ?? "Invalid slug." });
      return;
    }
    const slug = parsed.data;
    const [taken] = await db.select({ id: creatorProfilesTable.id, userId: creatorProfilesTable.userId })
      .from(creatorProfilesTable).where(eq(creatorProfilesTable.slug, slug)).limit(1);
    const available = !taken || taken.userId === req.userId;
    res.json({ available, valid: true, slug });
  } catch (err) {
    req.log.error({ err }, "creator-profiles/check-slug error");
    res.status(500).json({ error: "Couldn't check that handle. Try again." });
  }
});

/* ── Follows ───────────────────────────────────────────────────────────────── */

router.post("/creator-profiles/:id/follow", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const profile = await getProfileById(String(req.params["id"]));
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private. 🦈" });
      return;
    }
    if (profile.userId === userId) {
      res.status(400).json({ error: "Following yourself? Bold. It doesn't work, but we respect the confidence." });
      return;
    }
    await db.insert(followsTable)
      .values({ followerUserId: userId, profileId: profile.id })
      .onConflictDoNothing({ target: [followsTable.followerUserId, followsTable.profileId] });
    await db.update(creatorProfilesTable)
      .set({ followerCount: sql`${creatorProfilesTable.followerCount} + 1`, updatedAt: new Date() })
      .where(eq(creatorProfilesTable.id, profile.id));
    await notify(profile.userId, {
      kind: "follow",
      title: "New follower on deck 🦈",
      body: "Someone just followed your creator profile — keep the cheat code coming.",
      link: `/artist/${profile.slug}`,
    });
    res.json({ followed: true, follower_count: (profile.followerCount ?? 0) + 1 });
  } catch (err) {
    req.log.error({ err }, "follow error");
    res.status(500).json({ error: "The follow didn't stick. Try again." });
  }
});

router.delete("/creator-profiles/:id/unfollow", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const profile = await getProfileById(String(req.params["id"]));
    if (!profile) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private. 🦈" });
      return;
    }
    const deleted = await db.delete(followsTable)
      .where(and(eq(followsTable.followerUserId, userId), eq(followsTable.profileId, profile.id)))
      .returning({ id: followsTable.profileId });
    if (deleted.length > 0) {
      await db.update(creatorProfilesTable)
        .set({ followerCount: sql`GREATEST(${creatorProfilesTable.followerCount} - 1, 0)`, updatedAt: new Date() })
        .where(eq(creatorProfilesTable.id, profile.id));
    }
    res.json({ followed: false, follower_count: Math.max((profile.followerCount ?? 1) - 1, 0) });
  } catch (err) {
    req.log.error({ err }, "unfollow error");
    res.status(500).json({ error: "The unfollow didn't stick. Try again." });
  }
});

/* ── Wall comments ─────────────────────────────────────────────────────────── */

router.get("/creator-profiles/:id/comments", async (req, res) => {
  try {
    const profile = await getProfileById(String(req.params["id"]));
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private. 🦈" });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 20), 1), 100);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
    const comments = await db.select().from(profileCommentsTable)
      .where(eq(profileCommentsTable.profileId, profile.id))
      .orderBy(desc(profileCommentsTable.createdAt)).limit(limit).offset(offset);
    const slugs = await authorSlugMap(comments.map((c) => c.authorUserId));
    res.json({ comments: withAuthorSlugs(comments, slugs) });
  } catch (err) {
    req.log.error({ err }, "wall comments GET error");
    res.status(500).json({ error: "Comments wouldn't load. Give it another shot." });
  }
});

router.post("/creator-profiles/:id/comments", requireAuth, async (req, res) => {
  try {
    const profile = await getProfileById(String(req.params["id"]));
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "This creator hasn't set up shop yet — or the profile went private. 🦈" });
      return;
    }
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That comment didn't pass the vibe check.", details: parsed.error.issues });
      return;
    }
    const [comment] = await db.insert(profileCommentsTable).values({
      profileId: profile.id,
      authorUserId: req.userId!,
      body: parsed.data.body,
    }).returning();
    const slugs = await authorSlugMap([comment.authorUserId]);
    await notify(profile.userId, {
      kind: "comment",
      title: "Fresh ink on your wall 🦈",
      body: parsed.data.body.slice(0, 120),
      link: `/artist/${profile.slug}`,
    });
    res.status(201).json({ comment: withAuthorSlugs([comment], slugs)[0] });
  } catch (err) {
    req.log.error({ err }, "wall comments POST error");
    res.status(500).json({ error: "The comment didn't land. Try again." });
  }
});

/* ── Media comments ────────────────────────────────────────────────────────── */

router.get("/media/:kind/:id/comments", async (req, res) => {
  try {
    const kind = parseKind(req.params["kind"]);
    if (!kind) {
      res.status(400).json({ error: "kind has to be 'track' or 'video' — pick a lane." });
      return;
    }
    const media = await getMedia(kind, String(req.params["id"]));
    if (!media) {
      res.status(404).json({ error: "That upload doesn't exist here. Dead link, chief." });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query["limit"] ?? 20), 1), 100);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);
    const comments = await db.select().from(mediaCommentsTable)
      .where(and(eq(mediaCommentsTable.kind, kind), eq(mediaCommentsTable.mediaId, media.id)))
      .orderBy(desc(mediaCommentsTable.createdAt)).limit(limit).offset(offset);
    const slugs = await authorSlugMap(comments.map((c) => c.authorUserId));
    res.json({ comments: withAuthorSlugs(comments, slugs) });
  } catch (err) {
    req.log.error({ err }, "media comments GET error");
    res.status(500).json({ error: "Comments wouldn't load. Give it another shot." });
  }
});

router.post("/media/:kind/:id/comments", requireAuth, async (req, res) => {
  try {
    const kind = parseKind(req.params["kind"]);
    if (!kind) {
      res.status(400).json({ error: "kind has to be 'track' or 'video' — pick a lane." });
      return;
    }
    const media = await getMedia(kind, String(req.params["id"]));
    if (!media) {
      res.status(404).json({ error: "That upload doesn't exist here. Dead link, chief." });
      return;
    }
    const parsed = commentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That comment didn't pass the vibe check.", details: parsed.error.issues });
      return;
    }
    const [comment] = await db.insert(mediaCommentsTable).values({
      kind,
      mediaId: media.id,
      authorUserId: req.userId!,
      body: parsed.data.body,
    }).returning();
    await bumpCounter(kind, media.id, "comment");
    const profile = await getProfileById(media.profileId);
    const commentSlugs = await authorSlugMap([comment.authorUserId]);
    if (profile && profile.userId !== req.userId) {
      await notify(profile.userId, {
        kind: "comment",
        title: `Someone's talking about "${media.title}" 🦈`,
        body: parsed.data.body.slice(0, 120),
        link: `/artist/${profile.slug}`,
      });
    }
    res.status(201).json({ comment: withAuthorSlugs([comment], commentSlugs)[0] });
  } catch (err) {
    req.log.error({ err }, "media comments POST error");
    res.status(500).json({ error: "The comment didn't land. Try again." });
  }
});

/* ── Likes / reposts ───────────────────────────────────────────────────────── */

router.post("/media/:kind/:id/like", requireAuth, async (req, res) => {
  try {
    const kind = parseKind(req.params["kind"]);
    if (!kind) {
      res.status(400).json({ error: "kind has to be 'track' or 'video' — pick a lane." });
      return;
    }
    const media = await getMedia(kind, String(req.params["id"]));
    if (!media) {
      res.status(404).json({ error: "That upload doesn't exist here. Dead link, chief." });
      return;
    }
    await db.insert(likesTable)
      .values({ userId: req.userId!, kind, targetId: media.id })
      .onConflictDoNothing({ target: [likesTable.userId, likesTable.kind, likesTable.targetId] });
    await bumpCounter(kind, media.id, "like");
    const profile = await getProfileById(media.profileId);
    if (profile && profile.userId !== req.userId) {
      await notify(profile.userId, {
        kind: "like",
        title: `Your upload "${media.title}" just got some love 🦈`,
        link: `/artist/${profile.slug}`,
      });
    }
    const fresh = await getMedia(kind, media.id);
    res.json({ liked: true, like_count: fresh?.likeCount ?? media.likeCount + 1 });
  } catch (err) {
    req.log.error({ err }, "like error");
    res.status(500).json({ error: "The like didn't land. Try again." });
  }
});

router.delete("/media/:kind/:id/unlike", requireAuth, async (req, res) => {
  try {
    const kind = parseKind(req.params["kind"]);
    if (!kind) {
      res.status(400).json({ error: "kind has to be 'track' or 'video' — pick a lane." });
      return;
    }
    const deleted = await db.delete(likesTable)
      .where(and(
        eq(likesTable.userId, req.userId!),
        eq(likesTable.kind, kind),
        eq(likesTable.targetId, String(req.params["id"])),
      ))
      .returning({ targetId: likesTable.targetId });
    if (deleted.length > 0) {
      await bumpCounter(kind, String(req.params["id"]), "like", -1);
    }
    const fresh = await getMedia(kind, String(req.params["id"]));
    res.json({ liked: false, like_count: fresh?.likeCount ?? 0 });
  } catch (err) {
    req.log.error({ err }, "unlike error");
    res.status(500).json({ error: "The unlike didn't stick. Try again." });
  }
});

router.post("/tracks/:id/repost", requireAuth, async (req, res) => {
  try {
    const [track] = await db.select().from(profileTracksTable)
      .where(eq(profileTracksTable.id, String(req.params["id"]))).limit(1);
    if (!track) {
      res.status(404).json({ error: "That audio doesn't exist here. Dead link, chief." });
      return;
    }
    await db.insert(repostsTable)
      .values({ userId: req.userId!, trackId: track.id })
      .onConflictDoNothing({ target: [repostsTable.userId, repostsTable.trackId] });
    await bumpCounter("track", track.id, "repost");
    const profile = await getProfileById(track.profileId);
    if (profile && profile.userId !== req.userId) {
      await notify(profile.userId, {
        kind: "repost",
        title: `"${track.title}" just got reposted — your reach is compounding 🦈`,
        link: `/artist/${profile.slug}`,
      });
    }
    const [fresh] = await db.select().from(profileTracksTable)
      .where(eq(profileTracksTable.id, track.id)).limit(1);
    res.json({ reposted: true, repost_count: fresh?.repostCount ?? track.repostCount + 1 });
  } catch (err) {
    req.log.error({ err }, "repost error");
    res.status(500).json({ error: "The repost didn't land. Try again." });
  }
});

router.delete("/tracks/:id/unrepost", requireAuth, async (req, res) => {
  try {
    const deleted = await db.delete(repostsTable)
      .where(and(
        eq(repostsTable.userId, req.userId!),
        eq(repostsTable.trackId, String(req.params["id"])),
      ))
      .returning({ trackId: repostsTable.trackId });
    if (deleted.length > 0) {
      await bumpCounter("track", String(req.params["id"]), "repost", -1);
    }
    const [fresh] = await db.select().from(profileTracksTable)
      .where(eq(profileTracksTable.id, String(req.params["id"]))).limit(1);
    res.json({ reposted: false, repost_count: fresh?.repostCount ?? 0 });
  } catch (err) {
    req.log.error({ err }, "unrepost error");
    res.status(500).json({ error: "The unrepost didn't stick. Try again." });
  }
});

/* ── Plays (public, rate-limited) ──────────────────────────────────────────── */

router.post("/media/:kind/:id/play", playLimiter, async (req, res) => {
  try {
    const kind = parseKind(req.params["kind"]);
    if (!kind) {
      res.status(400).json({ error: "kind has to be 'track' or 'video' — pick a lane." });
      return;
    }
    const media = await getMedia(kind, String(req.params["id"]));
    if (!media) {
      res.status(404).json({ error: "That upload doesn't exist here. Dead link, chief." });
      return;
    }
    await bumpCounter(kind, media.id, "play");
    await db.insert(playEventsTable).values({
      kind,
      mediaId: media.id,
      userId: req.userId ?? null,
    });
    await db.update(creatorProfilesTable)
      .set({ totalPlays: sql`${creatorProfilesTable.totalPlays} + 1`, updatedAt: new Date() })
      .where(eq(creatorProfilesTable.id, media.profileId));
    const fresh = await getMedia(kind, media.id);
    res.json({
      ok: true,
      plays: kind === "track" ? (fresh as TrackRow | null)?.playCount : (fresh as VideoRow | null)?.viewCount,
    });
  } catch (err) {
    req.log.error({ err }, "play error");
    res.status(500).json({ error: "The play didn't count. Hit it again." });
  }
});

/* ── Notifications ─────────────────────────────────────────────────────────── */

router.get("/notifications", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(notificationsTable)
      .where(eq(notificationsTable.userId, req.userId!))
      .orderBy(desc(notificationsTable.createdAt)).limit(50);
    const unread = rows.filter((r) => !r.isRead).length;
    res.json({ notifications: rows, unread_count: unread });
  } catch (err) {
    req.log.error({ err }, "notifications GET error");
    res.status(500).json({ error: "Notifications wouldn't load. Give it another shot." });
  }
});

router.post("/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const [updated] = await db.update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.id, String(req.params["id"])), eq(notificationsTable.userId, req.userId!)))
      .returning({ id: notificationsTable.id });
    if (!updated) {
      res.status(404).json({ error: "That notification's gone — probably old news anyway." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "notifications read error");
    res.status(500).json({ error: "Couldn't clear that one. Try again." });
  }
});

/* ── DMCA takedown reports (public) ──────────────────────────────────────────
   No reporting flow existed on the site (copyright.tsx is informational
   only), so this is the intake endpoint. Reports land in dmca_reports
   (status 'new') for manual operator review; the operator is also emailed
   when an email provider is configured (fail-open). */

router.post("/dmca/report", async (req, res) => {
  try {
    const parsed = dmcaReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That report didn't pass the vibe check.", details: parsed.error.issues });
      return;
    }
    const d = parsed.data;
    if (!/yes|true|agree/i.test(d.agree_under_penalty)) {
      res.status(400).json({ error: "You have to agree to the good-faith statement — under penalty of perjury, no shortcuts." });
      return;
    }
    const [report] = await db.insert(dmcaReportsTable).values({
      reporterName: d.reporter_name,
      reporterEmail: d.reporter_email,
      reporterOrg: d.reporter_org ?? null,
      infringingUrls: d.infringing_urls,
      originalUrls: d.original_urls,
      description: d.description,
      agreeUnderPenalty: d.agree_under_penalty,
    }).returning({ id: dmcaReportsTable.id });
    // Operator alert: log always; email when a provider is configured
    // (fail-open — a mail failure must never block the report).
    req.log.warn(
      { reportId: report.id, reporter: d.reporter_email, urls: d.infringing_urls.length },
      "DMCA takedown report received — manual review required",
    );
    if (isEmailConfigured()) {
      const admins = adminEmails();
      if (admins.length > 0) {
        const html = emailShell(
          "🚨 DMCA takedown report — review required",
          `<p style="margin:0 0 12px;">A new takedown report needs operator review:</p>
<div style="background:#0a0a0a;border:1px solid #d4af37;border-radius:8px;padding:16px;margin:0 0 16px;font-size:14px;">
<div><strong>Reporter:</strong> ${escapeHtml(d.reporter_name)}${d.reporter_org ? ` (${escapeHtml(d.reporter_org)})` : ""}</div>
<div><strong>Email:</strong> ${escapeHtml(d.reporter_email)}</div>
<div><strong>Infringing URLs:</strong> ${d.infringing_urls.length}</div>
<div><strong>Report ID:</strong> ${escapeHtml(report.id)}</div>
</div>
<p style="margin:0;color:#888;font-size:13px;">Review it in the admin panel under DMCA reports (status: new).</p>`
        );
        // Fire-and-forget: the report is already recorded.
        void sendEmail({ to: admins, subject: `DMCA report ${report.id} — review required`, html });
      }
    }
    res.status(201).json({ ok: true, id: report.id });
  } catch (err) {
    req.log.error({ err }, "dmca/report error");
    res.status(500).json({ error: "The report didn't go through. Try again." });
  }
});

/* ── Media detail + playlists (integration: Worker 2's player pages) ─────────
   These were in the frontend contract but never landed server-side.
   Every payload carries link-graph fields — no extra fetches needed. */

/** Serialize a profile row to the public artist ref shape. */
function artistRef(profile: typeof creatorProfilesTable.$inferSelect) {
  return {
    id: profile.id,
    slug: profile.slug,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    vertical: profile.vertical,
    follower_count: profile.followerCount,
  };
}

/** GET /api/media/track/:id — public audio detail + artist. */
router.get("/media/track/:id", async (req, res) => {
  try {
    const track = await getMedia("track", String(req.params["id"]));
    if (!track || !("audioUrl" in track) || !track.isPublished) {
      res.status(404).json({ error: "That audio isn't here. Dead link, chief." });
      return;
    }
    const profile = await getProfileById(track.profileId);
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "That audio isn't here. Dead link, chief." });
      return;
    }
    res.json({ track: enrichTrack(track, profile.slug), artist: artistRef(profile) });
  } catch (err) {
    req.log.error({ err }, "media/track detail error");
    res.status(500).json({ error: "Couldn't load that audio. Try again." });
  }
});

/** GET /api/media/video/:id — public video detail + artist + sound linkage. */
router.get("/media/video/:id", async (req, res) => {
  try {
    const video = await getMedia("video", String(req.params["id"]));
    if (!video || !("videoUrl" in video) || !video.isPublished) {
      res.status(404).json({ error: "That video isn't here. Dead link, chief." });
      return;
    }
    const profile = await getProfileById(video.profileId);
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "That video isn't here. Dead link, chief." });
      return;
    }
    const sounds = await soundMapFor([video], profile.slug);
    res.json({ video: enrichVideo(video, profile.slug, sounds), artist: artistRef(profile) });
  } catch (err) {
    req.log.error({ err }, "media/video detail error");
    res.status(500).json({ error: "Couldn't load that video. Try again." });
  }
});

/** GET /api/creator-profiles/:slug/media?kind=track|video&limit= — public media listing. */
router.get("/creator-profiles/:slug/media", async (req, res) => {
  try {
    const [profile] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, String(req.params["slug"]))).limit(1);
    if (!profile || !profile.isPublic) {
      res.status(404).json({ error: "No creator at that address." });
      return;
    }
    const kind = req.query["kind"] === "video" ? "video" : "track";
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "20"), 10) || 20, 1), 50);
    if (kind === "video") {
      const rows = await db.select().from(profileVideosTable).where(and(
        eq(profileVideosTable.profileId, profile.id),
        eq(profileVideosTable.isPublished, true),
      )).orderBy(desc(profileVideosTable.createdAt)).limit(limit);
      const sounds = await soundMapFor(rows, profile.slug);
      res.json({ items: rows.map((v) => enrichVideo(v, profile.slug, sounds)) });
    } else {
      const rows = await db.select().from(profileTracksTable).where(and(
        eq(profileTracksTable.profileId, profile.id),
        eq(profileTracksTable.isPublished, true),
      )).orderBy(desc(profileTracksTable.createdAt)).limit(limit);
      res.json({ items: rows.map((t) => enrichTrack(t, profile.slug)) });
    }
  } catch (err) {
    req.log.error({ err }, "profile media listing error");
    res.status(500).json({ error: "Couldn't load their catalog. Try again." });
  }
});

/** GET /api/playlists/:id — public playlist + resolved items + owner. */
router.get("/playlists/:id", async (req, res) => {
  try {
    const [pl] = await db.select().from(playlistsTable)
      .where(eq(playlistsTable.id, String(req.params["id"]))).limit(1);
    if (!pl || !pl.isPublic) {
      res.status(404).json({ error: "That playlist isn't here. Dead link, chief." });
      return;
    }
    const owner = await getProfileById(pl.ownerProfileId);
    if (!owner || !owner.isPublic) {
      res.status(404).json({ error: "That playlist isn't here. Dead link, chief." });
      return;
    }
    const [resolved] = await resolvePlaylistItems([pl], owner.slug);
    res.json({ playlist: resolved, owner: artistRef(owner) });
  } catch (err) {
    req.log.error({ err }, "playlist detail error");
    res.status(500).json({ error: "Couldn't load that playlist. Try again." });
  }
});

const playlistBody = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  cover_url: z.string().max(500).nullable().optional(),
  is_public: z.boolean().default(true),
  kind: z.enum(["playlist", "series"]).default("playlist"),
});

/** GET /api/playlists/mine — my playlists (auth). */
router.get("/playlists/mine", requireAuth, async (req, res) => {
  try {
    const [profile] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, req.userId!)).limit(1);
    if (!profile) { res.json({ playlists: [] }); return; }
    const rows = await db.select().from(playlistsTable)
      .where(eq(playlistsTable.ownerProfileId, profile.id))
      .orderBy(desc(playlistsTable.createdAt));
    const resolved = await resolvePlaylistItems(rows, profile.slug);
    res.json({ playlists: resolved });
  } catch (err) {
    req.log.error({ err }, "playlists/mine error");
    res.status(500).json({ error: "Couldn't load your playlists. Try again." });
  }
});

/** POST /api/playlists — create (auth, needs own profile). */
router.post("/playlists", requireAuth, async (req, res) => {
  try {
    const body = playlistBody.parse(req.body);
    const [profile] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, req.userId!)).limit(1);
    if (!profile) {
      res.status(403).json({ error: "Set up your creator profile first — then the playlists flow." });
      return;
    }
    const [row] = await db.insert(playlistsTable).values({
      ownerProfileId: profile.id,
      title: body.title,
      description: body.description,
      coverUrl: body.cover_url ?? null,
      isPublic: body.is_public,
      kind: body.kind,
      items: [],
    }).returning();
    const [resolved] = await resolvePlaylistItems([row], profile.slug);
    res.status(201).json({ playlist: resolved });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Playlist needs a title, chief." }); return; }
    req.log.error({ err }, "playlist create error");
    res.status(500).json({ error: "Couldn't create that playlist. Try again." });
  }
});

const playlistItemBody = z.object({
  kind: z.enum(["track", "video"]),
  id: z.string().uuid(),
});

/** POST /api/playlists/:id/items — add item (auth, owner only). */
router.post("/playlists/:id/items", requireAuth, async (req, res) => {
  try {
    const { kind, id } = playlistItemBody.parse(req.body);
    const [pl] = await db.select().from(playlistsTable)
      .where(eq(playlistsTable.id, String(req.params["id"]))).limit(1);
    if (!pl) { res.status(404).json({ error: "Playlist not found." }); return; }
    const [profile] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, req.userId!)).limit(1);
    if (!profile || profile.id !== pl.ownerProfileId) {
      res.status(403).json({ error: "That's not your playlist to edit." });
      return;
    }
    const media = await getMedia(kind, id);
    if (!media || !media.isPublished) {
      res.status(404).json({ error: "That upload doesn't exist here." });
      return;
    }
    const items = [...(pl.items ?? [])];
    if (!items.some((i) => i?.kind === kind && i?.id === id)) items.push({ kind, id });
    await db.update(playlistsTable).set({ items }).where(eq(playlistsTable.id, pl.id));
    res.json({ ok: true, item_count: items.length });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Need a kind and id, chief." }); return; }
    req.log.error({ err }, "playlist add-item error");
    res.status(500).json({ error: "Couldn't add that. Try again." });
  }
});

/** DELETE /api/playlists/:id/items — remove item (auth, owner only). */
router.delete("/playlists/:id/items", requireAuth, async (req, res) => {
  try {
    const { kind, id } = playlistItemBody.parse(req.body);
    const [pl] = await db.select().from(playlistsTable)
      .where(eq(playlistsTable.id, String(req.params["id"]))).limit(1);
    if (!pl) { res.status(404).json({ error: "Playlist not found." }); return; }
    const [profile] = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, req.userId!)).limit(1);
    if (!profile || profile.id !== pl.ownerProfileId) {
      res.status(403).json({ error: "That's not your playlist to edit." });
      return;
    }
    const items = (pl.items ?? []).filter((i) => !(i?.kind === kind && i?.id === id));
    await db.update(playlistsTable).set({ items }).where(eq(playlistsTable.id, pl.id));
    res.json({ ok: true, item_count: items.length });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: "Need a kind and id, chief." }); return; }
    req.log.error({ err }, "playlist remove-item error");
    res.status(500).json({ error: "Couldn't remove that. Try again." });
  }
});

/** POST /api/playlists/:id/follow — follow a playlist (auth). */
router.post("/playlists/:id/follow", requireAuth, async (req, res) => {
  try {
    const [pl] = await db.select().from(playlistsTable)
      .where(eq(playlistsTable.id, String(req.params["id"]))).limit(1);
    if (!pl || !pl.isPublic) { res.status(404).json({ error: "Playlist not found." }); return; }
    await db.execute(sql`
      UPDATE playlists SET follower_count = follower_count + 1 WHERE id = ${pl.id}
    `);
    const [fresh] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, pl.id)).limit(1);
    res.json({ following: true, follower_count: fresh?.followerCount ?? 0 });
  } catch (err) {
    req.log.error({ err }, "playlist follow error");
    res.status(500).json({ error: "The follow didn't stick. Try again." });
  }
});

/** DELETE /api/playlists/:id/unfollow — unfollow (auth). */
router.delete("/playlists/:id/unfollow", requireAuth, async (req, res) => {
  try {
    const [pl] = await db.select().from(playlistsTable)
      .where(eq(playlistsTable.id, String(req.params["id"]))).limit(1);
    if (!pl) { res.status(404).json({ error: "Playlist not found." }); return; }
    await db.execute(sql`
      UPDATE playlists SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = ${pl.id}
    `);
    const [fresh] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, pl.id)).limit(1);
    res.json({ following: false, follower_count: fresh?.followerCount ?? 0 });
  } catch (err) {
    req.log.error({ err }, "playlist unfollow error");
    res.status(500).json({ error: "The unfollow didn't stick. Try again." });
  }
});

export default router;
