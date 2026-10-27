import { Router, type Request, type Response } from "express";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db } from "@workspace/db";
import {
  creatorProfilesTable,
  profileVideosTable,
  challengesTable,
  challengeEntriesTable,
  challengePrizesTable,
  challengeWinnersTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { effectiveStatus, optionalViewerId, slugify, requireOwnProfile, toChallengeDto } from "./challenge-engine";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import { ALT_TEXT_MAX_CHARS, sanitizeAltText } from "../lib/alt-text";

/* #29: profile_videos.thumbnail_alt_text lands via a held migration
   (numbering assigned at join). Probe once and cache — the same
   graceful-degradation pattern as publish.ts's season probe — so the
   shorts door keeps working before the column lands: the creator's
   cover description is accepted and simply not stored yet. */
let shortAltColKnown: boolean | null = null;
async function profileVideosHasAltText(): Promise<boolean> {
  if (shortAltColKnown !== null) return shortAltColKnown;
  try {
    const r = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'profile_videos' AND column_name = 'thumbnail_alt_text'
    `);
    shortAltColKnown = ((r.rows[0] as { n?: number } | undefined)?.n ?? 0) === 1;
  } catch {
    shortAltColKnown = false;
  }
  return shortAltColKnown;
}

/* Mirror-on-save (2026-10-13 law): short videos/thumbnails/sounds and
   challenge covers are re-hosted into permanent storage at save time;
   read payloads are deep-refreshed so stored refs mint fresh URLs. */

/* ─── Shorts / TikTok mechanics ────────────────────────────────────────────
   Vertical short-video feed, sounds, duets/stitches, hashtags.
   Mounted by the coordinator under /api (paths below are relative to it):
     GET  /shorts/feed            algorithmic For You feed (public)
     GET  /shorts/:id             single short (public)
     POST /shorts                 publish a short (auth)
     POST /videos/:id/duet        duet a video (auth)
     POST /videos/:id/stitch      stitch a video (auth)
     GET  /videos/:id/duets       children duets (public)
     GET  /videos/:id/stitches    children stitches (public)
     PATCH /videos/:id/duet-settings  creator's per-video duet switch (auth, owner)
     GET  /shorts/king-duet       Duet the King event rail (public, #173/N3)
     POST /videos/:id/king-feature    the King's featured pick (auth, house only)
     DELETE /videos/:id/king-feature  unfeature (auth, house only)
     GET  /sounds/trending        trending sounds (public)
     GET  /sounds/:id             sound page (public)
     GET  /hashtag/:tag           tagged content across tables (public)
   Challenges are NOT served here: every /challenges/* route lives on the
   challenge engine (routes/challenge-engine.ts), mounted exactly once by
   the coordinator in routes/index.ts. This router only imports the
   engine's shared helpers (challenge DTO, status, slug) for its own
   payloads — it does not mount the engine.
   Everything links to everything: creator profiles, sound pages, challenge
   pages, duet/stitch parents AND children, comments, share with ?ref=CODE.
*/

const router = Router();


/** Bow Down official creator slugs get a home-field boost in the feed. */
const OFFICIAL_SLUGS = (process.env["BDV_OFFICIAL_SLUGS"] ?? "bow-down-visuals,thy-cheat-code,bowdownvisuals")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/* ── Rate limits ────────────────────────────────────────────────────────── */

const feedLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Whoa — the feed needs a breather. One sec. 🦈" },
});

const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? (req.ip ? ipKeyGenerator(req.ip) : "unknown"),
  message: { error: "Too many moves, too fast. Catch your breath. 🦈" },
});

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Cursor: base64url({ s: score, id }). Lenient — garbage in, fresh page out. */
function encodeCursor(score: number, id: string): string {
  return Buffer.from(JSON.stringify({ s: score, id }), "utf8").toString("base64url");
}
function decodeCursor(raw: unknown): { s: number; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { s?: unknown; id?: unknown };
    if (typeof o.s === "number" && Number.isFinite(o.s) && typeof o.id === "string" && o.id) {
      return { s: o.s, id: o.id };
    }
  } catch { /* fresh page */ }
  return null;
}

function makeSoundId(title: string): string {
  return `${slugify(title, 40)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Best-effort notification to a profile owner; never fails the request. */
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
  } catch { /* notifications are non-critical */ }
}

/** Keep sound_use_count honest across every video sharing a sound_id. */
async function refreshSoundUseCount(soundId: string): Promise<void> {
  await db.execute(sql`
    UPDATE profile_videos v
    SET sound_use_count = sub.c
    FROM (SELECT COUNT(*)::int AS c FROM profile_videos WHERE sound_id = ${soundId}) sub
    WHERE v.sound_id = ${soundId}
  `);
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

interface ShortRow extends Record<string, unknown> {
  id: string;
  profile_id: string;
  title: string;
  video_url: string;
  thumbnail_url: string | null;
  thumbnail_alt_text?: string | null;
  description: string;
  tags: string[];
  duration_sec: number;
  view_count: unknown;
  like_count: unknown;
  repost_count: unknown;
  comment_count: unknown;
  download_price_cents: unknown;
  duet_with: string | null;
  stitch_with: string | null;
  /* Duet Rails (#173): the creator's per-video duet switch + the
     King's featured-pick stamp (N3). pv.* carries both columns. */
  duets_enabled?: boolean | null;
  king_featured_at?: string | null;
  creator_is_official?: boolean | null;
  sound_id: string | null;
  sound_title: string | null;
  sound_url: string | null;
  sound_use_count: unknown;
  created_at: string;
  score: unknown;
  creator_slug: string;
  creator_name: string;
  creator_avatar: string | null;
  viewer_liked: boolean;
  viewer_following: boolean;
  duet_count: unknown;
  stitch_count: unknown;
  challenges: Array<{ slug: string; title: string; hashtag: string }> | null;
  duet_parent_id: string | null;
  duet_parent_title: string | null;
  duet_parent_slug: string | null;
  stitch_parent_id: string | null;
  stitch_parent_title: string | null;
  stitch_parent_slug: string | null;
}

function shapeShort(r: ShortRow) {
  return {
    id: r.id,
    profile_id: r.profile_id,
    title: r.title,
    video_url: r.video_url,
    thumbnail_url: r.thumbnail_url,
    thumbnail_alt_text: r.thumbnail_alt_text ?? null,
    description: r.description,
    tags: r.tags ?? [],
    duration_sec: num(r.duration_sec),
    view_count: num(r.view_count),
    like_count: num(r.like_count),
    repost_count: num(r.repost_count),
    comment_count: num(r.comment_count),
    download_price_cents: num(r.download_price_cents),
    duet_with: r.duet_with,
    stitch_with: r.stitch_with,
    /* #173: a missing/NULL switch reads as its DB default — duets ON.
       The duet door hides and POST refuses only on an explicit off. */
    duets_enabled: r.duets_enabled !== false,
    king_featured_at: r.king_featured_at ?? null,
    sound: r.sound_id ? { id: r.sound_id, title: r.sound_title, url: r.sound_url, use_count: num(r.sound_use_count) } : null,
    score: num(r.score),
    creator: { id: r.profile_id, slug: r.creator_slug, display_name: r.creator_name, avatar_url: r.creator_avatar, is_official: !!r.creator_is_official },
    duet_parent: r.duet_parent_id ? { id: r.duet_parent_id, title: r.duet_parent_title, creator_slug: r.duet_parent_slug } : null,
    stitch_parent: r.stitch_parent_id ? { id: r.stitch_parent_id, title: r.stitch_parent_title, creator_slug: r.stitch_parent_slug } : null,
    duet_count: num(r.duet_count),
    stitch_count: num(r.stitch_count),
    challenges: Array.isArray(r.challenges) ? r.challenges : [],
    viewer_liked: !!r.viewer_liked,
    viewer_following: !!r.viewer_following,
    created_at: r.created_at,
  };
}

/* ── GET /shorts/feed — the For You page, but they own it ───────────────────
   score = engagement velocity × recency decay × follow boost × BDV boost
   velocity = (likes×3 + comments×2 + reposts×4 + views×0.1 + 1) / hours_old
   decay    = 1 / (1 + hours_old/72)          (≈3-day half-life)
   follow   = 2.5× when the viewer follows the creator
   bdv      = 1.5× for official Bow Down creators (home-field advantage)
   Keyset cursor: (score, id) — stable while the ranking shifts underneath. */
router.get("/shorts/feed", feedLimiter, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "10"), 10) || 10, 1), 30);
    const cursor = decodeCursor(req.query["cursor"]);
    const viewerId: string | null = await optionalViewerId(req);
    const result = await db.execute(sql`
      WITH base AS (
        SELECT pv.*,
               cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar, cp.is_official AS creator_is_official,
               CASE WHEN f.profile_id IS NOT NULL THEN 2.5 ELSE 1.0 END AS follow_mult,
               CASE WHEN cp.slug = ANY(${sql`ARRAY[${sql.join(OFFICIAL_SLUGS.map((s) => sql`${s}`), sql`, `)}]::text[]`}) THEN 1.5 ELSE 1.0 END AS bdv_mult,
               CASE WHEN l.user_id IS NOT NULL THEN true ELSE false END AS viewer_liked,
               CASE WHEN f.profile_id IS NOT NULL THEN true ELSE false END AS viewer_following,
               ((pv.like_count * 3.0 + pv.comment_count * 2.0 + pv.repost_count * 4.0 + pv.view_count * 0.1 + 1.0)
                 / GREATEST(EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0, 1.0))
                 / (1.0 + EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0 / 72.0) AS base_score,
               (SELECT COUNT(*)::int FROM profile_videos d WHERE d.duet_with = pv.id AND d.is_published = true) AS duet_count,
               (SELECT COUNT(*)::int FROM profile_videos s WHERE s.stitch_with = pv.id AND s.is_published = true) AS stitch_count,
               (SELECT COALESCE(json_agg(json_build_object('slug', c.slug, 'title', c.title, 'hashtag', c.hashtag)), '[]'::json)
                  FROM challenge_entries ce JOIN challenges c ON c.id = ce.challenge_id
                 WHERE ce.video_id = pv.id) AS challenges,
               dp.id AS duet_parent_id, dp.title AS duet_parent_title, dcp.slug AS duet_parent_slug,
               sp.id AS stitch_parent_id, sp.title AS stitch_parent_title, scp.slug AS stitch_parent_slug
        FROM profile_videos pv
        JOIN creator_profiles cp ON cp.id = pv.profile_id
        LEFT JOIN follows f ON f.profile_id = pv.profile_id AND f.follower_user_id = ${viewerId}
        LEFT JOIN likes l ON l.kind = 'video' AND l.target_id = pv.id AND l.user_id = ${viewerId}
        LEFT JOIN profile_videos dp ON dp.id = pv.duet_with
        LEFT JOIN creator_profiles dcp ON dcp.id = dp.profile_id
        LEFT JOIN profile_videos sp ON sp.id = pv.stitch_with
        LEFT JOIN creator_profiles scp ON scp.id = sp.profile_id
        WHERE pv.is_short = true AND pv.is_published = true
      ),
      scored AS (SELECT base.*, (follow_mult * bdv_mult * base_score) AS score FROM base)
      SELECT * FROM scored
      WHERE ${cursor ? sql`(score < ${cursor.s} OR (score = ${cursor.s} AND id < ${cursor.id}))` : sql`TRUE`}
      ORDER BY score DESC, id DESC
      LIMIT ${limit + 1}
    `);
    const rows = result.rows as ShortRow[];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(shapeShort);
    const last = items[items.length - 1];
    res.json(await refreshSupabaseStorageUrlsDeep({
      items,
      next_cursor: hasMore && last ? encodeCursor(last.score, last.id) : null,
    }));
  } catch (err) {
    req.log.error({ err }, "shorts feed error");
    res.status(500).json({ error: "The feed glitched. Scroll again. 🦈" });
  }
});

/* ── GET /shorts/king-duet — Duet the King (N3, absorbed into #173) ────────
   The launch event ON these rails, not a second machine: the King's
   own posted clips (official Thy Cheat Code profile) whose duet
   switch is ON are the open doors — fans duet them through the exact
   same POST /videos/:id/duet rail — and the King's featured pick is
   a duet of one of those clips, stamped king_featured_at by the
   house. ANTI-FAKE: pick_kind is spelled out in the payload — the
   pick is a HOUSE pick, chosen by Thy Cheat Code, and the fan who
   made the duet is credited as its creator on every item. */
router.get("/shorts/king-duet", feedLimiter, async (req, res) => {
  try {
    const clips = await db.execute(sql`
      SELECT pv.id, pv.title, pv.video_url, pv.thumbnail_url, pv.view_count, pv.like_count, pv.created_at,
             cp.id AS creator_id, cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar
      FROM profile_videos pv
      JOIN creator_profiles cp ON cp.id = pv.profile_id
      WHERE cp.is_official = true AND pv.is_published = true AND pv.is_short = true AND pv.duets_enabled = true
      ORDER BY pv.created_at DESC
      LIMIT 12
    `);
    /* Duet counts via the builder (one grouped pass in JS over the
       ≤12 open clips) — no correlated subquery needed on this rail. */
    const clipIds = (clips.rows as Record<string, unknown>[]).map((r) => String(r["id"]));
    const duetCounts = new Map<string, number>();
    if (clipIds.length) {
      const childRows = await db.select({ duetWith: profileVideosTable.duetWith })
        .from(profileVideosTable)
        .where(and(inArray(profileVideosTable.duetWith, clipIds), eq(profileVideosTable.isPublished, true)));
      for (const c of childRows) {
        if (c.duetWith) duetCounts.set(c.duetWith, (duetCounts.get(c.duetWith) ?? 0) + 1);
      }
    }
    const featured = await db.execute(sql`
      SELECT pv.id, pv.title, pv.video_url, pv.thumbnail_url, pv.view_count, pv.like_count,
             pv.king_featured_at, pv.created_at,
             cp.id AS creator_id, cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar,
             dp.id AS duet_parent_id, dp.title AS duet_parent_title,
             dcp.slug AS duet_parent_slug, dcp.display_name AS duet_parent_name
      FROM profile_videos pv
      JOIN creator_profiles cp ON cp.id = pv.profile_id
      LEFT JOIN profile_videos dp ON dp.id = pv.duet_with
      LEFT JOIN creator_profiles dcp ON dcp.id = dp.profile_id
      WHERE pv.king_featured_at IS NOT NULL AND pv.is_published = true
      ORDER BY pv.king_featured_at DESC
      LIMIT 12
    `);
    const clipRows = clips.rows as Record<string, unknown>[];
    const featRows = featured.rows as Record<string, unknown>[];
    res.json(await refreshSupabaseStorageUrlsDeep({
      event: {
        name: "Duet the King",
        pick_kind: "house_pick",
        note: "Thy Cheat Code posts a clip and opens it for duets. The featured duet is the King's own house pick — and the fan who made it is credited right on the pick.",
      },
      king: clipRows.length
        ? { id: clipRows[0]!["creator_id"], slug: clipRows[0]!["creator_slug"], display_name: clipRows[0]!["creator_name"], avatar_url: clipRows[0]!["creator_avatar"] }
        : null,
      open_clips: clipRows.map((r) => ({
        id: r["id"], title: r["title"], video_url: r["video_url"], thumbnail_url: r["thumbnail_url"],
        view_count: num(r["view_count"]), like_count: num(r["like_count"]), duet_count: duetCounts.get(String(r["id"])) ?? 0,
        duets_enabled: true,
        creator: { id: r["creator_id"], slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"], is_official: true },
        created_at: r["created_at"],
      })),
      featured: featRows.map((r) => ({
        id: r["id"], title: r["title"], video_url: r["video_url"], thumbnail_url: r["thumbnail_url"],
        view_count: num(r["view_count"]), like_count: num(r["like_count"]),
        king_featured_at: r["king_featured_at"], created_at: r["created_at"],
        pick_kind: "house_pick",
        /* The fan is the featured video's creator — credited by construction. */
        creator: { id: r["creator_id"], slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"] },
        duet_parent: r["duet_parent_id"]
          ? { id: r["duet_parent_id"], title: r["duet_parent_title"], creator_slug: r["duet_parent_slug"], creator_name: r["duet_parent_name"] }
          : null,
      })),
    }));
  } catch (err) {
    req.log.error({ err }, "king-duet rail error");
    res.status(500).json({ error: "The King's rail glitched. Try again." });
  }
});

/** GET /shorts/:id — one short, fully linked (share target / deep links). */
router.get("/shorts/:id", feedLimiter, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const viewerId = await optionalViewerId(req);
    const result = await db.execute(sql`
      SELECT pv.*,
             cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar, cp.is_official AS creator_is_official,
             CASE WHEN f.profile_id IS NOT NULL THEN 2.5 ELSE 1.0 END AS follow_mult,
             CASE WHEN cp.slug = ANY(${sql`ARRAY[${sql.join(OFFICIAL_SLUGS.map((s) => sql`${s}`), sql`, `)}]::text[]`}) THEN 1.5 ELSE 1.0 END AS bdv_mult,
             CASE WHEN l.user_id IS NOT NULL THEN true ELSE false END AS viewer_liked,
             CASE WHEN f.profile_id IS NOT NULL THEN true ELSE false END AS viewer_following,
             ((pv.like_count * 3.0 + pv.comment_count * 2.0 + pv.repost_count * 4.0 + pv.view_count * 0.1 + 1.0)
               / GREATEST(EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0, 1.0))
               / (1.0 + EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0 / 72.0) AS base_score,
             (SELECT COUNT(*)::int FROM profile_videos d WHERE d.duet_with = pv.id AND d.is_published = true) AS duet_count,
             (SELECT COUNT(*)::int FROM profile_videos s WHERE s.stitch_with = pv.id AND s.is_published = true) AS stitch_count,
             (SELECT COALESCE(json_agg(json_build_object('slug', c.slug, 'title', c.title, 'hashtag', c.hashtag)), '[]'::json)
                FROM challenge_entries ce JOIN challenges c ON c.id = ce.challenge_id
               WHERE ce.video_id = pv.id) AS challenges,
             dp.id AS duet_parent_id, dp.title AS duet_parent_title, dcp.slug AS duet_parent_slug,
             sp.id AS stitch_parent_id, sp.title AS stitch_parent_title, scp.slug AS stitch_parent_slug
      FROM profile_videos pv
      JOIN creator_profiles cp ON cp.id = pv.profile_id
      LEFT JOIN follows f ON f.profile_id = pv.profile_id AND f.follower_user_id = ${viewerId}
      LEFT JOIN likes l ON l.kind = 'video' AND l.target_id = pv.id AND l.user_id = ${viewerId}
      LEFT JOIN profile_videos dp ON dp.id = pv.duet_with
      LEFT JOIN creator_profiles dcp ON dcp.id = dp.profile_id
      LEFT JOIN profile_videos sp ON sp.id = pv.stitch_with
      LEFT JOIN creator_profiles scp ON scp.id = sp.profile_id
      WHERE pv.id = ${id} AND pv.is_short = true AND pv.is_published = true
      LIMIT 1
    `);
    const rows = result.rows as (ShortRow & { follow_mult: unknown; bdv_mult: unknown; base_score: unknown })[];
    if (!rows.length) {
      res.status(404).json({ error: "That short doesn't exist here. Dead link, chief." });
      return;
    }
    const r = rows[0]!;
    r.score = num(r.follow_mult) * num(r.bdv_mult) * num(r.base_score);
    res.json({ short: await refreshSupabaseStorageUrlsDeep(shapeShort(r)) });
  } catch (err) {
    req.log.error({ err }, "short detail error");
    res.status(500).json({ error: "Couldn't pull up that short." });
  }
});

/* ── POST /shorts — publish a short (auth). Never gated by Creator Level:
   watching and posting stay open at 1 star. ─────────────────────────────── */
const postShortSchema = z.object({
  profile_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  video_url: z.string().url().max(2048),
  thumbnail_url: z.string().url().max(2048).optional().nullable(),
  /* #29: accessibility description of the cover frame — creator-written
     or AI-suggested, editable before it ships. */
  thumbnail_alt_text: z.string().max(ALT_TEXT_MAX_CHARS).optional().nullable(),
  description: z.string().max(2000).optional().default(""),
  tags: z.array(z.string().trim().max(40)).max(30).optional().default([]),
  duration_sec: z.number().int().min(0).max(180).optional().default(0),
  sound_id: z.string().trim().max(80).optional().nullable(),
  sound_title: z.string().trim().max(120).optional().nullable(),
  sound_url: z.string().url().max(2048).optional().nullable(),
  duet_with: z.string().uuid().optional().nullable(),
  stitch_with: z.string().uuid().optional().nullable(),
  /* #173: publish with duets already off (default: on). */
  duets_enabled: z.boolean().optional(),
  challenge_id: z.string().uuid().optional().nullable(),
  is_published: z.boolean().optional().default(true),
});

async function insertShort(
  userId: string,
  b: z.infer<typeof postShortSchema>,
): Promise<{ short?: Record<string, unknown>; error?: string; status?: number }> {
  const profile = await requireOwnProfile(userId, b.profile_id);
  if (!profile) return { error: "That's not your profile. Claim it first.", status: 403 };

  let parent: { id: string; profileId: string; title: string } | null = null;
  const parentId = b.duet_with ?? b.stitch_with;
  if (parentId) {
    const [row] = await db.select({
      id: profileVideosTable.id, profileId: profileVideosTable.profileId, title: profileVideosTable.title,
      duetsEnabled: profileVideosTable.duetsEnabled,
    }).from(profileVideosTable).where(eq(profileVideosTable.id, parentId)).limit(1);
    if (!row) return { error: "The original video doesn't exist. Dead link, chief.", status: 404 };
    /* Duet Rails (#173): the original creator holds the switch. A
       duet against a switched-off video is refused HERE — the one
       funnel both POST /shorts (duet_with) and POST /videos/:id/duet
       pass through — so no door (feed rail, MediaLinkBar, editor
       deep link) can sneak past it. Stitches are a separate kind
       and are not governed by the duet switch. */
    if (b.duet_with && row.duetsEnabled === false) {
      return { error: "Duets are off for this video — the creator turned them off.", status: 403 };
    }
    parent = row;
  }

  let soundId = b.sound_id?.trim() || null;
  if (!soundId && b.sound_title?.trim()) soundId = makeSoundId(b.sound_title.trim());

  const [inserted] = await db.insert(profileVideosTable).values({
    profileId: b.profile_id,
    title: b.title.trim(),
    videoUrl: (await mirrorExternalMediaUrl(b.video_url, { kind: "video", ownerKey: userId })) ?? b.video_url,
    thumbnailUrl: b.thumbnail_url
      ? ((await mirrorExternalMediaUrl(b.thumbnail_url, { kind: "image", ownerKey: userId })) ?? b.thumbnail_url)
      : null,
    description: b.description ?? "",
    tags: b.tags ?? [],
    durationSec: b.duration_sec ?? 0,
    isShort: true,
    duetsEnabled: b.duets_enabled ?? true,
    duetWith: b.duet_with ?? null,
    stitchWith: b.stitch_with ?? null,
    soundId,
    soundTitle: b.sound_title?.trim() || null,
    soundUrl: b.sound_url
      ? ((await mirrorExternalMediaUrl(b.sound_url, { kind: "audio", ownerKey: userId })) ?? b.sound_url)
      : null,
    isPublished: b.is_published ?? true,
  }).returning();

  /* #29 cover alt text: set via a separate best-effort UPDATE, only when
     the probe says the column exists — the insert itself never carries
     it, so a pre-migration database publishes the short exactly as
     before and the description is simply not stored yet. */
  const coverAltText = sanitizeAltText(b.thumbnail_alt_text);
  if (coverAltText && inserted && (await profileVideosHasAltText())) {
    await db
      .execute(sql`UPDATE profile_videos SET thumbnail_alt_text = ${coverAltText} WHERE id = ${inserted.id}`)
      .catch(() => {});
    (inserted as Record<string, unknown>)["thumbnailAltText"] = coverAltText;
  }

  if (soundId) await refreshSoundUseCount(soundId);

  if (b.challenge_id) {
    const [ch] = await db.select().from(challengesTable).where(eq(challengesTable.id, b.challenge_id)).limit(1);
    if (ch) {
      await db.insert(challengeEntriesTable)
        .values({ challengeId: ch.id, videoId: inserted!.id })
        .onConflictDoNothing({ target: [challengeEntriesTable.challengeId, challengeEntriesTable.videoId] });
      await db.execute(sql`
        UPDATE challenges SET entry_count = (
          SELECT COUNT(*)::int FROM challenge_entries WHERE challenge_id = ${ch.id}
        ) WHERE id = ${ch.id}
      `);
    }
  }

  if (parent) {
    const kind = b.duet_with ? "duet" : "stitch";
    const owner = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, parent.profileId)).limit(1).then((r) => r[0] ?? null);
    if (owner && owner.userId !== userId) {
      await notify(owner.userId, {
        kind,
        title: `${profile.displayName} just ${kind}ed your short "${parent.title}" 🦈`,
        body: b.title.trim(),
        link: `/shorts?start=${inserted!.id}`,
      });
    }
  }

  return { short: await refreshSupabaseStorageUrlsDeep(inserted) };
}

router.post("/shorts", requireAuth, writeLimiter, async (req, res) => {
  try {
    const parsed = postShortSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "That short's missing something.", details: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const out = await insertShort(req.userId!, parsed.data);
    if (out.error) {
      res.status(out.status ?? 400).json({ error: out.error });
      return;
    }
    res.status(201).json({ short: out.short });
  } catch (err) {
    req.log.error({ err }, "shorts POST error");
    res.status(500).json({ error: "The short didn't post. Try again." });
  }
});

/* ── POST /videos/:id/duet & /videos/:id/stitch ────────────────────────────
   Duet/stitch controls unlock at 2 stars (data-min-stars="2" in the UI);
   the API itself stays open — the ladder is a UI guide, not a wall. */
const linkShortSchema = z.object({
  profile_id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  video_url: z.string().url().max(2048),
  thumbnail_url: z.string().url().max(2048).optional().nullable(),
  thumbnail_alt_text: z.string().max(ALT_TEXT_MAX_CHARS).optional().nullable(),
  description: z.string().max(2000).optional().default(""),
  tags: z.array(z.string().trim().max(40)).max(30).optional().default([]),
  duration_sec: z.number().int().min(0).max(180).optional().default(0),
  is_published: z.boolean().optional().default(true),
});

function linkShortHandler(kind: "duet" | "stitch") {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const parentId = String(req.params["id"]);
      const parsed = linkShortSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "That short's missing something.", details: parsed.error.issues.map((i) => i.message) });
        return;
      }
      const out = await insertShort(req.userId!, {
        ...parsed.data,
        sound_id: null, sound_title: null, sound_url: null,
        duet_with: kind === "duet" ? parentId : null,
        stitch_with: kind === "stitch" ? parentId : null,
        challenge_id: null,
      });
      if (out.error) {
        res.status(out.status ?? 400).json({ error: out.error });
        return;
      }
      res.status(201).json({ short: out.short, kind });
    } catch (err) {
      req.log.error({ err }, `${kind} error`);
      res.status(500).json({ error: `The ${kind} didn't land. Try again.` });
    }
  };
}
router.post("/videos/:id/duet", requireAuth, writeLimiter, linkShortHandler("duet"));
router.post("/videos/:id/stitch", requireAuth, writeLimiter, linkShortHandler("stitch"));

/* ── PATCH /videos/:id/duet-settings — the creator's duet switch (#173) ────
   Per-video, held by the ORIGINAL creator (the profile that owns the
   video) — never buried in global settings. Flipping it off closes
   the duet door everywhere at once: the feed/MediaLinkBar stop
   offering it and insertShort refuses new duets at POST. Existing
   duets are untouched — the switch governs new duets, not history. */
const duetSettingsSchema = z.object({ duets_enabled: z.boolean() });
router.patch("/videos/:id/duet-settings", requireAuth, writeLimiter, async (req, res) => {
  try {
    const videoId = String(req.params["id"]);
    const parsed = duetSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Send duets_enabled as true or false." });
      return;
    }
    const [video] = await db.select({
      id: profileVideosTable.id, profileId: profileVideosTable.profileId,
    }).from(profileVideosTable).where(eq(profileVideosTable.id, videoId)).limit(1);
    if (!video) {
      res.status(404).json({ error: "That video doesn't exist. Dead link, chief." });
      return;
    }
    const own = await requireOwnProfile(req.userId!, video.profileId);
    if (!own) {
      res.status(403).json({ error: "Only the video's creator holds its duet switch." });
      return;
    }
    await db.update(profileVideosTable)
      .set({ duetsEnabled: parsed.data.duets_enabled })
      .where(eq(profileVideosTable.id, videoId));
    res.json({ id: videoId, duets_enabled: parsed.data.duets_enabled });
  } catch (err) {
    req.log.error({ err }, "duet-settings error");
    res.status(500).json({ error: "The switch didn't flip. Try again." });
  }
});

/* ── The King's featured pick (N3) ──────────────────────────────────────────
   House-only: the caller must own an OFFICIAL profile (today exactly
   one — Thy Cheat Code). The pick must be a published duet OF an
   official clip: you cannot feature a random video, and you cannot
   feature your own post — the featured creator is always the fan. */
async function callersOfficialProfile(userId: string) {
  const [p] = await db.select().from(creatorProfilesTable)
    .where(and(eq(creatorProfilesTable.userId, userId), eq(creatorProfilesTable.isOfficial, true)))
    .limit(1);
  return p ?? null;
}

router.post("/videos/:id/king-feature", requireAuth, writeLimiter, async (req, res) => {
  try {
    const videoId = String(req.params["id"]);
    const house = await callersOfficialProfile(req.userId!);
    if (!house) {
      res.status(403).json({ error: "Only the King's house account can feature a duet." });
      return;
    }
    const [video] = await db.select().from(profileVideosTable)
      .where(eq(profileVideosTable.id, videoId)).limit(1);
    if (!video) {
      res.status(404).json({ error: "That video doesn't exist. Dead link, chief." });
      return;
    }
    if (!video.duetWith) {
      res.status(400).json({ error: "The King's pick is a duet — this video isn't one." });
      return;
    }
    if (!video.isPublished) {
      res.status(400).json({ error: "An unpublished duet can't be featured." });
      return;
    }
    const [parent] = await db.select({ profileId: profileVideosTable.profileId })
      .from(profileVideosTable).where(eq(profileVideosTable.id, video.duetWith)).limit(1);
    const [parentProfile] = parent
      ? await db.select({ isOfficial: creatorProfilesTable.isOfficial })
          .from(creatorProfilesTable).where(eq(creatorProfilesTable.id, parent.profileId)).limit(1)
      : [undefined];
    if (!parentProfile?.isOfficial) {
      res.status(400).json({ error: "The King's pick must be a duet of the King's own clip." });
      return;
    }
    const featuredAt = new Date();
    await db.update(profileVideosTable)
      .set({ kingFeaturedAt: featuredAt })
      .where(eq(profileVideosTable.id, videoId));
    const fan = await db.select().from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, video.profileId)).limit(1).then((r) => r[0] ?? null);
    if (fan && fan.userId !== req.userId) {
      await notify(fan.userId, {
        kind: "king_featured",
        title: `👑 The King featured your duet "${video.title}"`,
        body: "Thy Cheat Code picked your duet as the King's featured pick — your name rides on it.",
        link: `/shorts?start=${videoId}`,
      });
    }
    res.json({ id: videoId, king_featured_at: featuredAt.toISOString(), pick_kind: "house_pick" });
  } catch (err) {
    req.log.error({ err }, "king-feature error");
    res.status(500).json({ error: "The pick didn't land. Try again." });
  }
});

router.delete("/videos/:id/king-feature", requireAuth, writeLimiter, async (req, res) => {
  try {
    const videoId = String(req.params["id"]);
    const house = await callersOfficialProfile(req.userId!);
    if (!house) {
      res.status(403).json({ error: "Only the King's house account can feature a duet." });
      return;
    }
    await db.update(profileVideosTable)
      .set({ kingFeaturedAt: null })
      .where(eq(profileVideosTable.id, videoId));
    res.json({ id: videoId, king_featured_at: null });
  } catch (err) {
    req.log.error({ err }, "king-unfeature error");
    res.status(500).json({ error: "The pick didn't lift. Try again." });
  }
});

/** GET /videos/:id/duets & /videos/:id/stitches — children link back to parents. */
async function childrenHandler(kind: "duet" | "stitch", req: Request, res: Response): Promise<void> {
  try {
    const parentId = String(req.params["id"]);
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "24"), 10) || 24, 1), 50);
    const col = kind === "duet" ? profileVideosTable.duetWith : profileVideosTable.stitchWith;
    const rows = await db.select({
      id: profileVideosTable.id, title: profileVideosTable.title, videoUrl: profileVideosTable.videoUrl,
      thumbnailUrl: profileVideosTable.thumbnailUrl, viewCount: profileVideosTable.viewCount,
      likeCount: profileVideosTable.likeCount, createdAt: profileVideosTable.createdAt,
      profileId: profileVideosTable.profileId,
      kingFeaturedAt: profileVideosTable.kingFeaturedAt,
    }).from(profileVideosTable)
      .where(and(eq(col, parentId), eq(profileVideosTable.isPublished, true)))
      .orderBy(desc(profileVideosTable.createdAt))
      .limit(limit);
    const creatorIds = [...new Set(rows.map((r) => r.profileId))];
    const creators = creatorIds.length
      ? await db.select({
          id: creatorProfilesTable.id, slug: creatorProfilesTable.slug,
          displayName: creatorProfilesTable.displayName, avatarUrl: creatorProfilesTable.avatarUrl,
        }).from(creatorProfilesTable).where(sql`${creatorProfilesTable.id} = ANY(${sql`ARRAY[${sql.join(creatorIds.map((i) => sql`${i}`), sql`, `)}]::uuid[]`})`)
      : [];
    const byId = new Map(creators.map((c) => [c.id, c]));
    res.json(await refreshSupabaseStorageUrlsDeep({
      parent_id: parentId,
      kind,
      items: rows.map((r) => ({
        id: r.id, title: r.title, video_url: r.videoUrl, thumbnail_url: r.thumbnailUrl,
        view_count: r.viewCount, like_count: r.likeCount, created_at: r.createdAt,
        /* #173/N3: the King's pick rides the children list so the
           lineage UI can crown it wherever duets are listed. */
        king_featured_at: r.kingFeaturedAt ?? null,
        creator: byId.get(r.profileId) ?? null,
      })),
    }));
  } catch (err) {
    req.log.error({ err }, `${kind} children error`);
    res.status(500).json({ error: "Couldn't load those." });
  }
}
router.get("/videos/:id/duets", feedLimiter, (req, res) => childrenHandler("duet", req, res));
router.get("/videos/:id/stitches", feedLimiter, (req, res) => childrenHandler("stitch", req, res));

/* ── Sounds ─────────────────────────────────────────────────────────────── */

/** GET /sounds/trending — top sounds by use count + recent velocity.
    "This sound is earning" flags when priced products use it. */
router.get("/sounds/trending", feedLimiter, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "20"), 10) || 20, 1), 50);
    const result = await db.execute(sql`
      SELECT sound_id,
             MAX(sound_title) AS sound_title,
             MAX(sound_url) AS sound_url,
             COUNT(*)::int AS use_count,
             COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS recent_count,
             COUNT(*) FILTER (WHERE download_price_cents > 0)::int AS earning_count,
             MAX(created_at) AS last_used_at
      FROM profile_videos
      WHERE sound_id IS NOT NULL AND sound_id <> '' AND is_published = true
      GROUP BY sound_id
      ORDER BY (COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') * 10 + COUNT(*)) DESC
      LIMIT ${limit}
    `);
    res.json(await refreshSupabaseStorageUrlsDeep({
      sounds: (result.rows as Record<string, unknown>[]).map((r) => ({
        id: r["sound_id"],
        title: r["sound_title"],
        url: r["sound_url"],
        use_count: Number(r["use_count"] ?? 0),
        recent_count: Number(r["recent_count"] ?? 0),
        earning_count: Number(r["earning_count"] ?? 0),
        is_earning: Number(r["earning_count"] ?? 0) > 0,
        last_used_at: r["last_used_at"],
      })),
    }));
  } catch (err) {
    req.log.error({ err }, "sounds trending error");
    res.status(500).json({ error: "The sounds went quiet. Try again." });
  }
});

/** GET /sounds/:id — sound page: meta + every video using it + the money link. */
router.get("/sounds/:id", feedLimiter, async (req, res) => {
  try {
    const soundId = String(req.params["id"]);
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "24"), 10) || 24, 1), 60);
    const meta = await db.execute(sql`
      SELECT MAX(sound_title) AS sound_title,
             MAX(sound_url) AS sound_url,
             COUNT(*)::int AS use_count,
             COUNT(*) FILTER (WHERE download_price_cents > 0)::int AS earning_count
      FROM profile_videos
      WHERE sound_id = ${soundId} AND is_published = true
    `);
    const m = (meta.rows[0] ?? {}) as Record<string, unknown>;
    if (!Number(m["use_count"] ?? 0)) {
      res.status(404).json({ error: "Never heard of that sound. 🦈" });
      return;
    }
    const videos = await db.execute(sql`
      SELECT pv.id, pv.title, pv.video_url, pv.thumbnail_url, pv.view_count, pv.like_count,
             pv.download_price_cents, pv.created_at,
             cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar
      FROM profile_videos pv
      JOIN creator_profiles cp ON cp.id = pv.profile_id
      WHERE pv.sound_id = ${soundId} AND pv.is_published = true
      ORDER BY pv.is_short DESC, pv.view_count DESC
      LIMIT ${limit}
    `);
    const vids = (videos.rows as Record<string, unknown>[]).map((r) => ({
      id: r["id"],
      title: r["title"],
      video_url: r["video_url"],
      thumbnail_url: r["thumbnail_url"],
      view_count: Number(r["view_count"] ?? 0),
      like_count: Number(r["like_count"] ?? 0),
      download_price_cents: Number(r["download_price_cents"] ?? 0),
      for_sale: Number(r["download_price_cents"] ?? 0) > 0,
      creator: { slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"] },
      created_at: r["created_at"],
    }));
    res.json(await refreshSupabaseStorageUrlsDeep({
      sound: {
        id: soundId,
        title: m["sound_title"],
        url: m["sound_url"],
        use_count: Number(m["use_count"] ?? 0),
        is_earning: Number(m["earning_count"] ?? 0) > 0,
        earning_count: Number(m["earning_count"] ?? 0),
      },
      videos: vids,
      earning_items: vids.filter((v) => v.for_sale).map((v) => ({
        id: v.id, title: v.title, price_cents: v.download_price_cents,
        /* sound.tsx gates the card <img> on thumbnail_url — it rides
           along from the same vid object and gets the same deep
           storage-URL refresh as videos[].thumbnail_url above. */
        thumbnail_url: v.thumbnail_url, creator: v.creator,
      })),
    }));
  } catch (err) {
    req.log.error({ err }, "sound detail error");
    res.status(500).json({ error: "Couldn't load that sound." });
  }
});

/* ── Hashtag hub — every tag is a doorway, never a dead end ─────────────── */

/** GET /hashtag/:tag — videos + shorts + tracks + challenges, all tagged. */
router.get("/hashtag/:tag", feedLimiter, async (req, res) => {
  try {
    const raw = String(req.params["tag"] ?? "");
    const tag = raw.trim().replace(/^#+/, "").toLowerCase();
    if (!tag || tag.length > 60) {
      res.status(400).json({ error: "That's not a tag." });
      return;
    }
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "24"), 10) || 24, 1), 60);
    const withTag = sql`EXISTS (
      SELECT 1 FROM unnest(pv.tags) AS t
      WHERE lower(t) IN (${tag}, ${"#" + tag})
    )`;
    const videos = await db.execute(sql`
      SELECT pv.id, pv.title, pv.video_url, pv.thumbnail_url, pv.is_short, pv.view_count, pv.like_count,
             pv.download_price_cents, pv.created_at,
             cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar
      FROM profile_videos pv
      JOIN creator_profiles cp ON cp.id = pv.profile_id
      WHERE pv.is_published = true AND ${withTag}
      ORDER BY pv.view_count DESC
      LIMIT ${limit}
    `);
    const tracks = await db.execute(sql`
      SELECT pt.id, pt.title, pt.audio_url, pt.artwork_url, pt.play_count, pt.like_count, pt.created_at,
             cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar
      FROM profile_tracks pt
      JOIN creator_profiles cp ON cp.id = pt.profile_id
      WHERE pt.is_published = true AND EXISTS (
        SELECT 1 FROM unnest(pt.tags) AS t WHERE lower(t) IN (${tag}, ${"#" + tag})
      )
      ORDER BY pt.play_count DESC
      LIMIT ${limit}
    `);
    const challengeRows = await db.select({
      id: challengesTable.id, slug: challengesTable.slug, title: challengesTable.title,
      description: challengesTable.description, hashtag: challengesTable.hashtag,
      coverUrl: challengesTable.coverUrl, prizeText: challengesTable.prizeText,
      entryCount: challengesTable.entryCount, totalViews: challengesTable.totalViews,
      createdAt: challengesTable.createdAt, creatorProfileId: challengesTable.creatorProfileId,
      status: challengesTable.status, startsAt: challengesTable.startsAt,
      endsAt: challengesTable.endsAt, judgingEndsAt: challengesTable.judgingEndsAt,
      prizePoolCredits: challengesTable.prizePoolCredits,
    }).from(challengesTable).where(eq(challengesTable.hashtag, tag)).limit(12);

    const vids = (videos.rows as Record<string, unknown>[]);
    res.json(await refreshSupabaseStorageUrlsDeep({
      tag,
      shorts: vids.filter((r) => !!r["is_short"]).map((r) => ({
        id: r["id"], title: r["title"], video_url: r["video_url"], thumbnail_url: r["thumbnail_url"],
        view_count: Number(r["view_count"] ?? 0), like_count: Number(r["like_count"] ?? 0),
        download_price_cents: Number(r["download_price_cents"] ?? 0),
        creator: { slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"] },
        created_at: r["created_at"],
      })),
      videos: vids.filter((r) => !r["is_short"]).map((r) => ({
        id: r["id"], title: r["title"], video_url: r["video_url"], thumbnail_url: r["thumbnail_url"],
        view_count: Number(r["view_count"] ?? 0), like_count: Number(r["like_count"] ?? 0),
        download_price_cents: Number(r["download_price_cents"] ?? 0),
        creator: { slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"] },
        created_at: r["created_at"],
      })),
      tracks: (tracks.rows as Record<string, unknown>[]).map((r) => ({
        id: r["id"], title: r["title"], audio_url: r["audio_url"], artwork_url: r["artwork_url"],
        play_count: Number(r["play_count"] ?? 0), like_count: Number(r["like_count"] ?? 0),
        creator: { slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"] },
        created_at: r["created_at"],
      })),
      challenges: challengeRows.map(toChallengeDto),
    }));
  } catch (err) {
    req.log.error({ err }, "hashtag error");
    res.status(500).json({ error: "Couldn't load that tag." });
  }
});

export default router;
