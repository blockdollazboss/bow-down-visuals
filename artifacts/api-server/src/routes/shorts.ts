import { Router, type Request, type Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { db } from "@workspace/db";
import {
  creatorProfilesTable,
  profileVideosTable,
  challengesTable,
  challengeEntriesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";

/* ─── Shorts / TikTok mechanics ────────────────────────────────────────────
   Vertical short-video feed, sounds, duets/stitches, challenges, hashtags.
   Mounted by the coordinator under /api (paths below are relative to it):
     GET  /shorts/feed            algorithmic For You feed (public)
     GET  /shorts/:id             single short (public)
     POST /shorts                 publish a short (auth)
     POST /videos/:id/duet        duet a video (auth)
     POST /videos/:id/stitch      stitch a video (auth)
     GET  /videos/:id/duets       children duets (public)
     GET  /videos/:id/stitches    children stitches (public)
     GET  /sounds/trending        trending sounds (public)
     GET  /sounds/:id             sound page (public)
     POST /challenges             create a challenge (auth)
     GET  /challenges/trending    trending challenges (public)
     GET  /challenges/:slug       challenge detail + entries (public)
     POST /challenges/:slug/enter enter a video (auth)
     GET  /hashtag/:tag           tagged content across tables (public)
   Everything links to everything: creator profiles, sound pages, challenge
   pages, duet/stitch parents AND children, comments, share with ?ref=CODE.
*/

const router = Router();

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";

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
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Too many moves, too fast. Catch your breath. 🦈" },
});

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Best-effort viewer resolution for public endpoints — never fails the request. */
async function optionalViewerId(req: Request): Promise<string | null> {
  const h = req.headers["authorization"];
  if (!h?.startsWith("Bearer ")) return null;
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: { user }, error } = await client.auth.getUser(h.slice(7));
    if (error || !user) return null;
    return user.id;
  } catch {
    return null;
  }
}

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

function slugify(s: string, max = 48): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, max) || "untitled";
}

function makeSoundId(title: string): string {
  return `${slugify(title, 40)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Profile must belong to the caller. */
async function requireOwnProfile(userId: string, profileId: string) {
  const [p] = await db.select().from(creatorProfilesTable)
    .where(and(eq(creatorProfilesTable.id, profileId), eq(creatorProfilesTable.userId, userId)))
    .limit(1);
  return p ?? null;
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
    sound: r.sound_id ? { id: r.sound_id, title: r.sound_title, url: r.sound_url, use_count: num(r.sound_use_count) } : null,
    score: num(r.score),
    creator: { id: r.profile_id, slug: r.creator_slug, display_name: r.creator_name, avatar_url: r.creator_avatar },
    duet_parent: r.duet_parent_id ? { id: r.duet_parent_id, title: r.duet_parent_title, creator_slug: r.duet_parent_slug } : null,
    stitch_parent: r.stitch_parent_id ? { id: r.stitch_parent_id, title: r.stitch_parent_title, creator_slug: r.stitch_parent_slug } : null,
    duet_count: num(r.duet_count),
    stitch_count: num(r.stitch_count),
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
               cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar,
               CASE WHEN f.profile_id IS NOT NULL THEN 2.5 ELSE 1.0 END AS follow_mult,
               CASE WHEN cp.slug = ANY(${OFFICIAL_SLUGS}::text[]) THEN 1.5 ELSE 1.0 END AS bdv_mult,
               CASE WHEN l.user_id IS NOT NULL THEN true ELSE false END AS viewer_liked,
               CASE WHEN f.profile_id IS NOT NULL THEN true ELSE false END AS viewer_following,
               ((pv.like_count * 3.0 + pv.comment_count * 2.0 + pv.repost_count * 4.0 + pv.view_count * 0.1 + 1.0)
                 / GREATEST(EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0, 1.0))
                 / (1.0 + EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0 / 72.0) AS base_score,
               (SELECT COUNT(*)::int FROM profile_videos d WHERE d.duet_with = pv.id AND d.is_published = true) AS duet_count,
               (SELECT COUNT(*)::int FROM profile_videos s WHERE s.stitch_with = pv.id AND s.is_published = true) AS stitch_count,
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
    res.json({
      items,
      next_cursor: hasMore && last ? encodeCursor(last.score, last.id) : null,
    });
  } catch (err) {
    req.log.error({ err }, "shorts feed error");
    res.status(500).json({ error: "The feed glitched. Scroll again. 🦈" });
  }
});

/** GET /shorts/:id — one short, fully linked (share target / deep links). */
router.get("/shorts/:id", feedLimiter, async (req, res) => {
  try {
    const id = String(req.params["id"]);
    const viewerId = await optionalViewerId(req);
    const result = await db.execute(sql`
      SELECT pv.*,
             cp.slug AS creator_slug, cp.display_name AS creator_name, cp.avatar_url AS creator_avatar,
             CASE WHEN f.profile_id IS NOT NULL THEN 2.5 ELSE 1.0 END AS follow_mult,
             CASE WHEN cp.slug = ANY(${OFFICIAL_SLUGS}::text[]) THEN 1.5 ELSE 1.0 END AS bdv_mult,
             CASE WHEN l.user_id IS NOT NULL THEN true ELSE false END AS viewer_liked,
             CASE WHEN f.profile_id IS NOT NULL THEN true ELSE false END AS viewer_following,
             ((pv.like_count * 3.0 + pv.comment_count * 2.0 + pv.repost_count * 4.0 + pv.view_count * 0.1 + 1.0)
               / GREATEST(EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0, 1.0))
               / (1.0 + EXTRACT(EPOCH FROM (now() - pv.created_at)) / 3600.0 / 72.0) AS base_score,
             (SELECT COUNT(*)::int FROM profile_videos d WHERE d.duet_with = pv.id AND d.is_published = true) AS duet_count,
             (SELECT COUNT(*)::int FROM profile_videos s WHERE s.stitch_with = pv.id AND s.is_published = true) AS stitch_count,
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
    res.json({ short: shapeShort(r) });
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
  description: z.string().max(2000).optional().default(""),
  tags: z.array(z.string().trim().max(40)).max(30).optional().default([]),
  duration_sec: z.number().int().min(0).max(180).optional().default(0),
  sound_id: z.string().trim().max(80).optional().nullable(),
  sound_title: z.string().trim().max(120).optional().nullable(),
  sound_url: z.string().url().max(2048).optional().nullable(),
  duet_with: z.string().uuid().optional().nullable(),
  stitch_with: z.string().uuid().optional().nullable(),
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
    }).from(profileVideosTable).where(eq(profileVideosTable.id, parentId)).limit(1);
    if (!row) return { error: "The original video doesn't exist. Dead link, chief.", status: 404 };
    if (row.id === b.profile_id) return { error: "Can't duet your own profile — pick a video.", status: 400 };
    parent = row;
  }

  let soundId = b.sound_id?.trim() || null;
  if (!soundId && b.sound_title?.trim()) soundId = makeSoundId(b.sound_title.trim());

  const [inserted] = await db.insert(profileVideosTable).values({
    profileId: b.profile_id,
    title: b.title.trim(),
    videoUrl: b.video_url,
    thumbnailUrl: b.thumbnail_url ?? null,
    description: b.description ?? "",
    tags: b.tags ?? [],
    durationSec: b.duration_sec ?? 0,
    isShort: true,
    duetWith: b.duet_with ?? null,
    stitchWith: b.stitch_with ?? null,
    soundId,
    soundTitle: b.sound_title?.trim() || null,
    soundUrl: b.sound_url ?? null,
    isPublished: b.is_published ?? true,
  }).returning();

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

  return { short: inserted };
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
    }).from(profileVideosTable)
      .where(and(eq(col, parentId), eq(profileVideosTable.isPublished, true)))
      .orderBy(desc(profileVideosTable.createdAt))
      .limit(limit);
    const creatorIds = [...new Set(rows.map((r) => r.profileId))];
    const creators = creatorIds.length
      ? await db.select({
          id: creatorProfilesTable.id, slug: creatorProfilesTable.slug,
          displayName: creatorProfilesTable.displayName, avatarUrl: creatorProfilesTable.avatarUrl,
        }).from(creatorProfilesTable).where(sql`${creatorProfilesTable.id} = ANY(${creatorIds}::uuid[])`)
      : [];
    const byId = new Map(creators.map((c) => [c.id, c]));
    res.json({
      parent_id: parentId,
      kind,
      items: rows.map((r) => ({
        id: r.id, title: r.title, video_url: r.videoUrl, thumbnail_url: r.thumbnailUrl,
        view_count: r.viewCount, like_count: r.likeCount, created_at: r.createdAt,
        creator: byId.get(r.profileId) ?? null,
      })),
    });
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
    res.json({
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
    });
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
    res.json({
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
        id: v.id, title: v.title, price_cents: v.download_price_cents, creator: v.creator,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "sound detail error");
    res.status(500).json({ error: "Couldn't load that sound." });
  }
});

/* ── Challenges ─────────────────────────────────────────────────────────── */

const HASHTAG_RE = /^[a-z0-9_]{2,40}$/;
function normHashtag(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const h = v.trim().replace(/^#+/, "").toLowerCase();
  return HASHTAG_RE.test(h) ? h : null;
}

const createChallengeSchema = z.object({
  profile_id: z.string().uuid(),
  title: z.string().trim().min(3).max(80),
  hashtag: z.string().trim().min(2).max(42),
  description: z.string().max(2000).optional().default(""),
  cover_url: z.string().url().max(2048).optional().nullable(),
  prize_text: z.string().trim().max(300).optional().default(""),
});

/** POST /challenges — start one. Every challenge carries the prize/earning angle. */
router.post("/challenges", requireAuth, writeLimiter, async (req, res) => {
  try {
    const parsed = createChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Challenge needs a name and a hashtag.", details: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const hashtag = normHashtag(parsed.data.hashtag);
    if (!hashtag) {
      res.status(400).json({ error: "Hashtag: letters, numbers, underscores only. No # needed — we add the drip." });
      return;
    }
    const profile = await requireOwnProfile(req.userId!, parsed.data.profile_id);
    if (!profile) {
      res.status(403).json({ error: "That's not your profile. Claim it first." });
      return;
    }
    let slug = slugify(parsed.data.title, 44);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? slug : `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      const [inserted] = await db.insert(challengesTable).values({
        slug: candidate,
        title: parsed.data.title.trim(),
        description: parsed.data.description ?? "",
        hashtag,
        coverUrl: parsed.data.cover_url ?? null,
        creatorProfileId: parsed.data.profile_id,
        prizeText: parsed.data.prize_text ?? "",
      }).onConflictDoNothing({ target: challengesTable.slug }).returning();
      if (inserted) {
        res.status(201).json({ challenge: inserted });
        return;
      }
    }
    res.status(409).json({ error: "That challenge name's taken. Remix it." });
  } catch (err) {
    req.log.error({ err }, "challenge create error");
    res.status(500).json({ error: "The challenge didn't launch. Try again." });
  }
});

/** GET /challenges/trending — what the streets are running right now. */
router.get("/challenges/trending", feedLimiter, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query["limit"] ?? "20"), 10) || 20, 1), 50);
    const rows = await db.select({
      id: challengesTable.id, slug: challengesTable.slug, title: challengesTable.title,
      description: challengesTable.description, hashtag: challengesTable.hashtag,
      coverUrl: challengesTable.coverUrl, prizeText: challengesTable.prizeText,
      entryCount: challengesTable.entryCount, totalViews: challengesTable.totalViews,
      createdAt: challengesTable.createdAt, creatorProfileId: challengesTable.creatorProfileId,
    }).from(challengesTable)
      .orderBy(desc(challengesTable.entryCount), desc(challengesTable.totalViews))
      .limit(limit);
    res.json({ challenges: rows });
  } catch (err) {
    req.log.error({ err }, "challenges trending error");
    res.status(500).json({ error: "Couldn't load challenges." });
  }
});

/** GET /challenges/:slug — hero + entries. The money angle leads. */
router.get("/challenges/:slug", feedLimiter, async (req, res) => {
  try {
    const slug = String(req.params["slug"]);
    const [ch] = await db.select().from(challengesTable).where(eq(challengesTable.slug, slug)).limit(1);
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name. Start it yourself — the crown's empty." });
      return;
    }
    const entries = await db.execute(sql`
      SELECT pv.id, pv.title, pv.video_url, pv.thumbnail_url, pv.view_count, pv.like_count,
             pv.created_at, ce.created_at AS entered_at,
             cp.id AS profile_id, cp.slug AS creator_slug, cp.display_name AS creator_name,
             cp.avatar_url AS creator_avatar
      FROM challenge_entries ce
      JOIN profile_videos pv ON pv.id = ce.video_id
      JOIN creator_profiles cp ON cp.id = pv.profile_id
      WHERE ce.challenge_id = ${ch.id} AND pv.is_published = true
      ORDER BY pv.view_count DESC
      LIMIT 48
    `);
    res.json({
      challenge: {
        id: ch.id, slug: ch.slug, title: ch.title, description: ch.description,
        hashtag: ch.hashtag, cover_url: ch.coverUrl, prize_text: ch.prizeText,
        entry_count: ch.entryCount, total_views: ch.totalViews, created_at: ch.createdAt,
      },
      entries: (entries.rows as Record<string, unknown>[]).map((r) => ({
        id: r["id"], title: r["title"], video_url: r["video_url"], thumbnail_url: r["thumbnail_url"],
        view_count: Number(r["view_count"] ?? 0), like_count: Number(r["like_count"] ?? 0),
        entered_at: r["entered_at"], created_at: r["created_at"],
        creator: { id: r["profile_id"], slug: r["creator_slug"], display_name: r["creator_name"], avatar_url: r["creator_avatar"] },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "challenge detail error");
    res.status(500).json({ error: "Couldn't load that challenge." });
  }
});

const enterChallengeSchema = z.object({
  video_id: z.string().uuid(),
});

/** POST /challenges/:slug/enter — link your video. Tags the hashtag automatically. */
router.post("/challenges/:slug/enter", requireAuth, writeLimiter, async (req, res) => {
  try {
    const slug = String(req.params["slug"]);
    const parsed = enterChallengeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "video_id is required — which video's entering?" });
      return;
    }
    const [ch] = await db.select().from(challengesTable).where(eq(challengesTable.slug, slug)).limit(1);
    if (!ch) {
      res.status(404).json({ error: "No challenge by that name." });
      return;
    }
    const [video] = await db.select().from(profileVideosTable)
      .where(eq(profileVideosTable.id, parsed.data.video_id)).limit(1);
    if (!video) {
      res.status(404).json({ error: "That video doesn't exist here." });
      return;
    }
    const profile = await requireOwnProfile(req.userId!, video.profileId);
    if (!profile) {
      res.status(403).json({ error: "That's not your video to enter." });
      return;
    }
    const [entry] = await db.insert(challengeEntriesTable)
      .values({ challengeId: ch.id, videoId: video.id })
      .onConflictDoNothing({ target: [challengeEntriesTable.challengeId, challengeEntriesTable.videoId] })
      .returning();
    if (entry) {
      await db.execute(sql`
        UPDATE challenges SET entry_count = (
          SELECT COUNT(*)::int FROM challenge_entries WHERE challenge_id = ${ch.id}
        ) WHERE id = ${ch.id}
      `);
      const tag = `#${ch.hashtag}`;
      const tags = [...new Set([...(video.tags ?? []), tag, ch.hashtag])].slice(0, 30);
      await db.update(profileVideosTable).set({ tags }).where(eq(profileVideosTable.id, video.id));
    }
    res.json({ entered: true, already_entered: !entry });
  } catch (err) {
    req.log.error({ err }, "challenge enter error");
    res.status(500).json({ error: "The entry didn't land. Try again." });
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
    const challenges = await db.select({
      slug: challengesTable.slug, title: challengesTable.title, hashtag: challengesTable.hashtag,
      coverUrl: challengesTable.coverUrl, prizeText: challengesTable.prizeText, entryCount: challengesTable.entryCount,
    }).from(challengesTable).where(eq(challengesTable.hashtag, tag)).limit(12);

    const vids = (videos.rows as Record<string, unknown>[]);
    res.json({
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
      challenges,
    });
  } catch (err) {
    req.log.error({ err }, "hashtag error");
    res.status(500).json({ error: "Couldn't load that tag." });
  }
});

export default router;
