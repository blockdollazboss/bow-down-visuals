import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  db,
  creatorProfilesTable,
  profileTracksTable,
  profileVideosTable,
  playlistsTable,
  followsTable,
  playEventsTable,
  notificationsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import rateLimit from "express-rate-limit";

/* ─── Creator Streaming Platform — Discovery + Social (Worker 6) ──────────
   Vertical-aware discovery for ALL creators — music, video, gaming,
   podcast, film, tv, influencer, education, other. Not music-only.

   Public (rate-limited): charts, rising, brands, search, verticals,
   vertical pages, genres, new-this-week, related, play recording.
   Authed: activity feed, notifications inbox, notify fan-out.

   Mount (coordinator): router.use("/discovery", discoveryRouter)
   in artifacts/api-server/src/routes/index.ts. */

const router = Router();

/* ─── Verticals ─────────────────────────────────────────────────────────── */

export const VERTICALS = [
  "music",
  "video",
  "gaming",
  "podcast",
  "film",
  "tv",
  "influencer",
  "education",
  "other",
] as const;
export type Vertical = (typeof VERTICALS)[number];

const VERTICAL_LABELS: Record<string, string> = {
  music: "Music",
  video: "Video",
  gaming: "Gaming",
  podcast: "Podcasts",
  film: "Film",
  tv: "TV",
  influencer: "Influencers",
  education: "Education",
  other: "More",
};

const WINDOWS = ["today", "week", "all"] as const;
type Window = (typeof WINDOWS)[number];

function windowInterval(w: Window, days?: number): string | null {
  if (days) return `${days} days`;
  if (w === "today") return "1 day";
  if (w === "week") return "7 days";
  return null;
}

const clampLimit = (v: unknown, def = 20, max = 50): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
};

/* Plays can legitimately burst (a listening session); 120/min/IP. */
const playLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many plays logged. Slow down a touch." },
});

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((err) => {
      console.error("[discovery]", err);
      res.status(500).json({ error: "Discovery hiccup — try again." });
    });
  };

/* ─── Shared row shapes ─────────────────────────────────────────────────── */

interface ProfileLite {
  id: string;
  slug: string;
  display_name: string;
  avatar_url: string | null;
  vertical: string;
  follower_count: number;
  total_plays: number;
}

const PROFILE_COLS = sql`
  p.id, p.slug, p.display_name, p.avatar_url, p.vertical,
  p.follower_count, p.total_plays`;

/* Guide-to-money: every creator payload says whether they're selling and
   what they earned in the last 30 days. digital_sales lands in 0088, so
   this table always exists by the time 0094 applies. */
const EARNINGS_COLS = sql`,
  EXISTS (SELECT 1 FROM digital_sales ds WHERE ds.profile_id = p.id) AS has_sales,
  COALESCE((SELECT SUM(ds2.creator_amount_cents) FROM digital_sales ds2
            WHERE ds2.profile_id = p.id
              AND ds2.created_at >= NOW() - INTERVAL '30 days'), 0)::int AS month_earnings_cents`;

/* ─── Charts ──────────────────────────────────────────────────────────────
   GET /charts?window=today|week|all&vertical=&limit=
   GET /charts/tracks | /charts/videos | /charts/creators (same params;
   tracks/videos also accept genre=)
   Windowed charts aggregate play_events (fast via play_events_window_idx);
   all-time charts order by the counter columns. */

const ChartsQuery = z.object({
  window: z.enum(WINDOWS).default("all"),
  vertical: z.string().trim().toLowerCase().optional(),
  genre: z.string().trim().max(60).optional(),
  limit: z.coerce.number().optional(),
  /* Advanced (4-6 star creators): custom lookback in days, 1-90.
     Overrides `window` when present. Base charts/search/follow are
     never gated — this only adds precision for power users. */
  days: z.coerce.number().int().min(1).max(90).optional(),
});

function verticalFilter(vertical: string | undefined, alias = "p"): ReturnType<typeof sql> | null {
  if (!vertical) return null;
  if (!(VERTICALS as readonly string[]).includes(vertical)) return null;
  return sql`AND ${sql.raw(alias)}.vertical = ${vertical}`;
}

async function topTracks(window: Window, vertical: string | undefined, genre: string | undefined, limit: number, days?: number) {
  const vf = verticalFilter(vertical);
  const gf = genre ? sql`AND t.genre ILIKE ${genre}` : null;
  if (window === "all") {
    const rows = await db.execute(sql`
      SELECT t.id, t.profile_id, t.title, t.genre, t.artwork_url, t.audio_url,
             t.play_count, t.like_count, t.duration_sec, t.created_at,
             ${PROFILE_COLS}
      FROM profile_tracks t
      JOIN creator_profiles p ON p.id = t.profile_id
      WHERE t.is_published AND p.is_public ${vf ?? sql``} ${gf ?? sql``}
      ORDER BY t.play_count DESC
      LIMIT ${limit}`);
    return rows as unknown as Array<Record<string, unknown>>;
  }
  const interval = windowInterval(window, days)!;
  const rows = await db.execute(sql`
    SELECT t.id, t.profile_id, t.title, t.genre, t.artwork_url, t.audio_url,
           t.play_count, t.like_count, t.duration_sec, t.created_at,
           ${PROFILE_COLS},
           COUNT(*)::int AS window_plays
    FROM play_events e
    JOIN profile_tracks t ON t.id = e.media_id
    JOIN creator_profiles p ON p.id = t.profile_id
    WHERE e.kind = 'track'
      AND e.played_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      AND t.is_published AND p.is_public ${vf ?? sql``} ${gf ?? sql``}
    GROUP BY t.id, p.id
    ORDER BY window_plays DESC
    LIMIT ${limit}`);
  return rows as unknown as Array<Record<string, unknown>>;
}

async function topVideos(window: Window, vertical: string | undefined, genre: string | undefined, limit: number, days?: number) {
  const vf = verticalFilter(vertical);
  const gf = genre ? sql`AND v.genre ILIKE ${genre}` : null;
  if (window === "all") {
    const rows = await db.execute(sql`
      SELECT v.id, v.profile_id, v.title, v.genre, v.thumbnail_url, v.video_url,
             v.view_count, v.like_count, v.duration_sec, v.created_at,
             ${PROFILE_COLS}
      FROM profile_videos v
      JOIN creator_profiles p ON p.id = v.profile_id
      WHERE v.is_published AND p.is_public ${vf ?? sql``} ${gf ?? sql``}
      ORDER BY v.view_count DESC
      LIMIT ${limit}`);
    return rows as unknown as Array<Record<string, unknown>>;
  }
  const interval = windowInterval(window, days)!;
  const rows = await db.execute(sql`
    SELECT v.id, v.profile_id, v.title, v.genre, v.thumbnail_url, v.video_url,
           v.view_count, v.like_count, v.duration_sec, v.created_at,
           ${PROFILE_COLS},
           COUNT(*)::int AS window_plays
    FROM play_events e
    JOIN profile_videos v ON v.id = e.media_id
    JOIN creator_profiles p ON p.id = v.profile_id
    WHERE e.kind = 'video'
      AND e.played_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      AND v.is_published AND p.is_public ${vf ?? sql``} ${gf ?? sql``}
    GROUP BY v.id, p.id
    ORDER BY window_plays DESC
    LIMIT ${limit}`);
  return rows as unknown as Array<Record<string, unknown>>;
}

async function topCreators(window: Window, vertical: string | undefined, limit: number, days?: number) {
  const vf = verticalFilter(vertical);
  if (window === "all" && !days) {
    const rows = await db.execute(sql`
      SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio
      FROM creator_profiles p
      WHERE p.is_public ${vf ?? sql``}
      ORDER BY (p.total_plays + p.follower_count * 50) DESC
      LIMIT ${limit}`);
    return rows as unknown as Array<Record<string, unknown>>;
  }
  const interval = windowInterval(window, days)!;
  const rows = await db.execute(sql`
    WITH track_plays AS (
      SELECT t.profile_id AS pid, COUNT(*)::int AS wplays
      FROM play_events e
      JOIN profile_tracks t ON t.id = e.media_id
      WHERE e.kind = 'track' AND e.played_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      GROUP BY t.profile_id
    ), video_plays AS (
      SELECT v.profile_id AS pid, COUNT(*)::int AS wplays
      FROM play_events e
      JOIN profile_videos v ON v.id = e.media_id
      WHERE e.kind = 'video' AND e.played_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      GROUP BY v.profile_id
    ), new_follows AS (
      SELECT f.profile_id AS pid, COUNT(*)::int AS nfollows
      FROM follows f
      WHERE f.created_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
      GROUP BY f.profile_id
    )
    SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio,
           (COALESCE(tp.wplays, 0) + COALESCE(vp.wplays, 0))::int AS window_plays,
           COALESCE(nf.nfollows, 0)::int AS new_followers
    FROM creator_profiles p
    LEFT JOIN track_plays tp ON tp.pid = p.id
    LEFT JOIN video_plays vp ON vp.pid = p.id
    LEFT JOIN new_follows nf ON nf.pid = p.id
    WHERE p.is_public ${vf ?? sql``}
      AND (COALESCE(tp.wplays, 0) + COALESCE(vp.wplays, 0) + COALESCE(nf.nfollows, 0)) > 0
    ORDER BY (COALESCE(tp.wplays, 0) + COALESCE(vp.wplays, 0) + COALESCE(nf.nfollows, 0) * 50) DESC
    LIMIT ${limit}`);
  return rows as unknown as Array<Record<string, unknown>>;
}

router.get("/charts", publicApiLimiter, asyncHandler(async (req, res) => {
  const q = ChartsQuery.parse(req.query);
  const limit = clampLimit(q.limit, 10);
  const [tracks, videos, creators] = await Promise.all([
    topTracks(q.window, q.vertical, q.genre, limit, q.days),
    topVideos(q.window, q.vertical, q.genre, limit, q.days),
    topCreators(q.window, q.vertical, limit, q.days),
  ]);
  res.json({
    window: q.window,
    vertical: q.vertical ?? null,
    vertical_label: q.vertical ? VERTICAL_LABELS[q.vertical] ?? q.vertical : null,
    tracks, videos, creators,
  });
}));

router.get("/charts/tracks", publicApiLimiter, asyncHandler(async (req, res) => {
  const q = ChartsQuery.parse(req.query);
  res.json({ window: q.window, vertical: q.vertical ?? null, tracks: await topTracks(q.window, q.vertical, q.genre, clampLimit(q.limit), q.days) });
}));

router.get("/charts/videos", publicApiLimiter, asyncHandler(async (req, res) => {
  const q = ChartsQuery.parse(req.query);
  res.json({ window: q.window, vertical: q.vertical ?? null, videos: await topVideos(q.window, q.vertical, q.genre, clampLimit(q.limit), q.days) });
}));

router.get("/charts/creators", publicApiLimiter, asyncHandler(async (req, res) => {
  const q = ChartsQuery.parse(req.query);
  res.json({ window: q.window, vertical: q.vertical ?? null, creators: await topCreators(q.window, q.vertical, clampLimit(q.limit), q.days) });
}));

/* ─── Rising ("Breaking") ─────────────────────────────────────────────────
   GET /rising?vertical=&limit= — creators gaining followers fastest in the
   last 7 days. This is the "next big creator gets found here" rail. */

router.get("/rising", publicApiLimiter, asyncHandler(async (req, res) => {
  const q = ChartsQuery.parse(req.query);
  const limit = clampLimit(q.limit, 10);
  const vf = verticalFilter(q.vertical);
  const rows = await db.execute(sql`
    WITH new_follows AS (
      SELECT f.profile_id AS pid, COUNT(*)::int AS nfollows
      FROM follows f
      WHERE f.created_at >= NOW() - INTERVAL '7 days'
      GROUP BY f.profile_id
    ), week_plays AS (
      SELECT t.profile_id AS pid, COUNT(*)::int AS wplays
      FROM play_events e
      JOIN profile_tracks t ON t.id = e.media_id AND e.kind = 'track'
      WHERE e.played_at >= NOW() - INTERVAL '7 days'
      GROUP BY t.profile_id
    )
    SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio,
           nf.nfollows::int AS new_followers,
           COALESCE(wp.wplays, 0)::int AS week_plays
    FROM creator_profiles p
    JOIN new_follows nf ON nf.pid = p.id
    LEFT JOIN week_plays wp ON wp.pid = p.id
    WHERE p.is_public ${vf ?? sql``} AND nf.nfollows >= 2
    ORDER BY nf.nfollows DESC, wp.wplays DESC NULLS LAST
    LIMIT ${limit}`);
  res.json({ vertical: q.vertical ?? null, rising: rows });
}));

/* ─── Rising earners ────────────────────────────────────────────────────────
   GET /rising-earners?vertical=&limit= — guide to the money: creators
   ranked by what fans actually paid them (creator_amount_cents, last
   30 days). Streaming is vanity; selling is sanity. */

router.get("/rising-earners", publicApiLimiter, asyncHandler(async (req, res) => {
  const q = ChartsQuery.parse(req.query);
  const limit = clampLimit(q.limit, 10);
  const vf = verticalFilter(q.vertical);
  const rows = await db.execute(sql`
    WITH earnings AS (
      SELECT ds.profile_id AS pid,
             SUM(ds.creator_amount_cents)::int AS earned_cents,
             COUNT(*)::int AS sales
      FROM digital_sales ds
      WHERE ds.created_at >= NOW() - INTERVAL '30 days'
      GROUP BY ds.profile_id
    )
    SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio,
           e.earned_cents::int AS earned_cents_30d,
           e.sales::int AS sales_30d
    FROM creator_profiles p
    JOIN earnings e ON e.pid = p.id
    WHERE p.is_public ${vf ?? sql``}
    ORDER BY e.earned_cents DESC
    LIMIT ${limit}`);
  res.json({ vertical: q.vertical ?? null, earners: rows });
}));

/* ─── For brands ("Work with creators") ───────────────────────────────────
   GET /brands?vertical=&limit= — read-only influencer discovery for the
   brand-deal flow. Surfaces top public creators with audience stats;
   outreach itself happens in /brand-deals (no new sidebar items). */

router.get("/brands", publicApiLimiter, asyncHandler(async (req, res) => {
  const q = ChartsQuery.parse(req.query);
  const limit = clampLimit(q.limit, 12);
  const vf = verticalFilter(q.vertical);
  const rows = await db.execute(sql`
    SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio,
           (SELECT t.genre FROM profile_tracks t
             WHERE t.profile_id = p.id AND t.is_published AND t.genre IS NOT NULL
             GROUP BY t.genre ORDER BY COUNT(*) DESC LIMIT 1) AS top_genre,
           (SELECT COUNT(*)::int FROM profile_tracks t
             WHERE t.profile_id = p.id AND t.is_published) AS track_count,
           (SELECT COUNT(*)::int FROM profile_videos v
             WHERE v.profile_id = p.id AND v.is_published) AS video_count
    FROM creator_profiles p
    WHERE p.is_public ${vf ?? sql``}
    ORDER BY p.follower_count DESC
    LIMIT ${limit}`);
  res.json({
    vertical: q.vertical ?? null,
    note: "Read-only discovery. Start outreach from /brand-deals.",
    creators: rows,
  });
}));

/* ─── Search ──────────────────────────────────────────────────────────────
   GET /search?q=&type=all|creator|track|video|playlist&vertical=&genre=&limit=
   Fast ILIKE scans with sane per-type limits; vertical + genre chips. */

const SearchQuery = z.object({
  q: z.string().trim().min(1).max(80),
  type: z.enum(["all", "creator", "track", "video", "playlist"]).default("all"),
  vertical: z.string().trim().toLowerCase().optional(),
  genre: z.string().trim().max(60).optional(),
  limit: z.coerce.number().optional(),
});

router.get("/search", publicApiLimiter, asyncHandler(async (req, res) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.json({ q: "", creators: [], tracks: [], videos: [], playlists: [] });
    return;
  }
  const q = parsed.data;
  const like = `%${q.q.replace(/[%_]/g, "")}%`;
  const per = clampLimit(q.limit, 8, 20);
  const vf = verticalFilter(q.vertical);
  const gf = q.genre ? sql`AND genre ILIKE ${q.genre}` : null;
  const out: Record<string, unknown> = { q: q.q };

  if (q.type === "all" || q.type === "creator") {
    out.creators = await db.execute(sql`
      SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio
      FROM creator_profiles p
      WHERE p.is_public ${vf ?? sql``}
        AND (p.display_name ILIKE ${like} OR p.slug ILIKE ${like})
      ORDER BY p.follower_count DESC
      LIMIT ${per}`);
  }
  if (q.type === "all" || q.type === "track") {
    out.tracks = await db.execute(sql`
      SELECT t.id, t.profile_id, t.title, t.genre, t.artwork_url,
             t.play_count, t.like_count, t.duration_sec,
             ${PROFILE_COLS}
      FROM profile_tracks t
      JOIN creator_profiles p ON p.id = t.profile_id
      WHERE t.is_published AND p.is_public ${vf ?? sql``} ${gf ?? sql``}
        AND (t.title ILIKE ${like} OR t.genre ILIKE ${like})
      ORDER BY t.play_count DESC
      LIMIT ${per}`);
  }
  if (q.type === "all" || q.type === "video") {
    out.videos = await db.execute(sql`
      SELECT v.id, v.profile_id, v.title, v.genre, v.thumbnail_url,
             v.view_count, v.like_count, v.duration_sec,
             ${PROFILE_COLS}
      FROM profile_videos v
      JOIN creator_profiles p ON p.id = v.profile_id
      WHERE v.is_published AND p.is_public ${vf ?? sql``} ${gf ?? sql``}
        AND v.title ILIKE ${like}
      ORDER BY v.view_count DESC
      LIMIT ${per}`);
  }
  if (q.type === "all" || q.type === "playlist") {
    out.playlists = await db.execute(sql`
      SELECT pl.id, pl.title, pl.description, pl.cover_url, pl.follower_count,
             ${PROFILE_COLS}
      FROM playlists pl
      JOIN creator_profiles p ON p.id = pl.owner_profile_id
      WHERE pl.is_public AND p.is_public ${vf ?? sql``}
        AND pl.title ILIKE ${like}
      ORDER BY pl.follower_count DESC
      LIMIT ${per}`);
  }
  res.json(out);
}));

/* ─── Verticals ───────────────────────────────────────────────────────────
   GET /verticals — every lane with live counts.
   GET /vertical/:vertical — landing page payload: top creators, top audio,
   top videos, new this week, rising. */

router.get("/verticals", publicApiLimiter, asyncHandler(async (_req, res) => {
  const rows = (await db.execute(sql`
    SELECT p.vertical,
           COUNT(*)::int AS creators,
           COALESCE(SUM(p.follower_count), 0)::int AS followers,
           COALESCE(SUM(p.total_plays), 0)::int AS plays
    FROM creator_profiles p
    WHERE p.is_public
    GROUP BY p.vertical
  `)) as unknown as Array<{ vertical: string; creators: number; followers: number; plays: number }>;
  const byVertical = new Map(rows.map((r) => [r.vertical, r]));
  res.json({
    verticals: VERTICALS.map((v) => ({
      key: v,
      label: VERTICAL_LABELS[v],
      creators: byVertical.get(v)?.creators ?? 0,
      followers: byVertical.get(v)?.followers ?? 0,
      plays: byVertical.get(v)?.plays ?? 0,
    })),
  });
}));

const VerticalParam = z.object({ vertical: z.string().trim().toLowerCase() });

router.get("/vertical/:vertical", publicApiLimiter, asyncHandler(async (req, res) => {
  const { vertical } = VerticalParam.parse(req.params);
  if (!(VERTICALS as readonly string[]).includes(vertical)) {
    res.status(404).json({ error: "Unknown vertical." });
    return;
  }
  const limit = clampLimit(req.query.limit, 8, 12);
  const vf = sql`AND p.vertical = ${vertical}`;
  const [creators, tracks, videos, fresh] = await Promise.all([
    db.execute(sql`SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio FROM creator_profiles p
      WHERE p.is_public ${vf} ORDER BY (p.total_plays + p.follower_count * 50) DESC LIMIT ${limit}`),
    db.execute(sql`SELECT t.id, t.profile_id, t.title, t.genre, t.artwork_url, t.play_count, t.like_count, t.duration_sec, ${PROFILE_COLS}
      FROM profile_tracks t JOIN creator_profiles p ON p.id = t.profile_id
      WHERE t.is_published AND p.is_public ${vf} ORDER BY t.play_count DESC LIMIT ${limit}`),
    db.execute(sql`SELECT v.id, v.profile_id, v.title, v.genre, v.thumbnail_url, v.view_count, v.like_count, v.duration_sec, ${PROFILE_COLS}
      FROM profile_videos v JOIN creator_profiles p ON p.id = v.profile_id
      WHERE v.is_published AND p.is_public ${vf} ORDER BY v.view_count DESC LIMIT ${limit}`),
    db.execute(sql`
      (SELECT 'track' AS kind, t.id, t.profile_id, t.title, t.artwork_url AS thumb, t.created_at, ${PROFILE_COLS}
       FROM profile_tracks t JOIN creator_profiles p ON p.id = t.profile_id
       WHERE t.is_published AND p.is_public ${vf} AND t.created_at >= NOW() - INTERVAL '14 days')
      UNION ALL
      (SELECT 'video' AS kind, v.id, v.profile_id, v.title, v.thumbnail_url AS thumb, v.created_at, ${PROFILE_COLS}
       FROM profile_videos v JOIN creator_profiles p ON p.id = v.profile_id
       WHERE v.is_published AND p.is_public ${vf} AND v.created_at >= NOW() - INTERVAL '14 days')
      ORDER BY created_at DESC LIMIT ${limit}`),
  ]);
  const rising = await db.execute(sql`
    WITH nf AS (SELECT f.profile_id AS pid, COUNT(*)::int AS n
                FROM follows f WHERE f.created_at >= NOW() - INTERVAL '7 days' GROUP BY f.profile_id)
    SELECT ${PROFILE_COLS}${EARNINGS_COLS}, nf.n::int AS new_followers
    FROM creator_profiles p JOIN nf ON nf.pid = p.id
    WHERE p.is_public ${vf} AND nf.n >= 2
    ORDER BY nf.n DESC LIMIT ${limit}`);
  res.json({
    vertical,
    label: VERTICAL_LABELS[vertical],
    creators, tracks, videos,
    new_this_week: fresh,
    rising,
  });
}));

/* ─── Genres ──────────────────────────────────────────────────────────────
   GET /genres?vertical= — distinct genres with counts (music-flavored lanes
   use genres; every vertical still gets charts + search).
   GET /genre/:genre?vertical= — tracks, videos, creators for a genre. */

router.get("/genres", publicApiLimiter, asyncHandler(async (req, res) => {
  const vertical = typeof req.query.vertical === "string" ? req.query.vertical.toLowerCase() : undefined;
  const vf = verticalFilter(vertical);
  const rows = await db.execute(sql`
    SELECT genre, COUNT(*)::int AS items FROM (
      SELECT t.genre FROM profile_tracks t
      JOIN creator_profiles p ON p.id = t.profile_id
      WHERE t.is_published AND p.is_public AND t.genre IS NOT NULL ${vf ?? sql``}
      UNION ALL
      SELECT v.genre FROM profile_videos v
      JOIN creator_profiles p ON p.id = v.profile_id
      WHERE v.is_published AND p.is_public AND v.genre IS NOT NULL ${vf ?? sql``}
    ) g GROUP BY genre ORDER BY items DESC LIMIT 60`);
  res.json({ vertical: vertical ?? null, genres: rows });
}));

router.get("/genre/:genre", publicApiLimiter, asyncHandler(async (req, res) => {
  const genre = String(req.params.genre ?? "").slice(0, 60);
  const vertical = typeof req.query.vertical === "string" ? req.query.vertical.toLowerCase() : undefined;
  const vf = verticalFilter(vertical);
  const gf = sql`ILIKE ${genre}`;
  const limit = clampLimit(req.query.limit, 12, 24);
  const [tracks, videos, creators] = await Promise.all([
    db.execute(sql`SELECT t.id, t.profile_id, t.title, t.genre, t.artwork_url, t.play_count, t.like_count, ${PROFILE_COLS}
      FROM profile_tracks t JOIN creator_profiles p ON p.id = t.profile_id
      WHERE t.is_published AND p.is_public AND t.genre ${gf} ${vf ?? sql``}
      ORDER BY t.play_count DESC LIMIT ${limit}`),
    db.execute(sql`SELECT v.id, v.profile_id, v.title, v.genre, v.thumbnail_url, v.view_count, v.like_count, ${PROFILE_COLS}
      FROM profile_videos v JOIN creator_profiles p ON p.id = v.profile_id
      WHERE v.is_published AND p.is_public AND v.genre ${gf} ${vf ?? sql``}
      ORDER BY v.view_count DESC LIMIT ${limit}`),
    db.execute(sql`SELECT DISTINCT ${PROFILE_COLS}${EARNINGS_COLS} FROM creator_profiles p
      WHERE p.is_public ${vf ?? sql``} AND (
        EXISTS (SELECT 1 FROM profile_tracks t WHERE t.profile_id = p.id AND t.is_published AND t.genre ${gf})
        OR EXISTS (SELECT 1 FROM profile_videos v WHERE v.profile_id = p.id AND v.is_published AND v.genre ${gf})
      ) ORDER BY p.follower_count DESC LIMIT ${limit}`),
  ]);
  res.json({ genre, vertical: vertical ?? null, tracks, videos, creators });
}));

/* ─── New this week ───────────────────────────────────────────────────────
   GET /new-this-week?vertical=&limit= — recently published public
   tracks + videos, newest first. Feeds the homepage "fresh drops" rail. */

router.get("/new-this-week", publicApiLimiter, asyncHandler(async (req, res) => {
  const vertical = typeof req.query.vertical === "string" ? req.query.vertical.toLowerCase() : undefined;
  const vf = verticalFilter(vertical);
  const limit = clampLimit(req.query.limit, 12, 30);
  const rows = await db.execute(sql`
    (SELECT 'track' AS kind, t.id, t.profile_id, t.title, t.genre, t.artwork_url AS thumb,
            t.play_count AS plays, t.created_at, ${PROFILE_COLS}
     FROM profile_tracks t JOIN creator_profiles p ON p.id = t.profile_id
     WHERE t.is_published AND p.is_public ${vf ?? sql``} AND t.created_at >= NOW() - INTERVAL '7 days')
    UNION ALL
    (SELECT 'video' AS kind, v.id, v.profile_id, v.title, v.genre, v.thumbnail_url AS thumb,
            v.view_count AS plays, v.created_at, ${PROFILE_COLS}
     FROM profile_videos v JOIN creator_profiles p ON p.id = v.profile_id
     WHERE v.is_published AND p.is_public ${vf ?? sql``} AND v.created_at >= NOW() - INTERVAL '7 days')
    ORDER BY created_at DESC LIMIT ${limit}`);
  res.json({ vertical: vertical ?? null, items: rows });
}));

/* ─── Related ─────────────────────────────────────────────────────────────
   GET /related/creators/:slug — same vertical, ordered by plays. Worker 1's
   /artist/:slug page (and Worker 2's player) can embed this rail.
   GET /related/track/:id — same-genre tracks, ordered by plays. */

router.get("/related/creators/:slug", publicApiLimiter, asyncHandler(async (req, res) => {
  const slug = String(req.params.slug ?? "").slice(0, 120);
  const limit = clampLimit(req.query.limit, 8, 12);
  const self = await db
    .select({ id: creatorProfilesTable.id, vertical: creatorProfilesTable.vertical })
    .from(creatorProfilesTable)
    .where(sql`${creatorProfilesTable.slug} = ${slug} AND ${creatorProfilesTable.isPublic} = true`)
    .limit(1);
  if (!self.length) {
    res.status(404).json({ error: "Creator not found." });
    return;
  }
  const me = self[0]!;
  const rows = await db.execute(sql`
    SELECT ${PROFILE_COLS}${EARNINGS_COLS}, p.bio
    FROM creator_profiles p
    WHERE p.is_public AND p.id != ${me.id} AND p.vertical = ${me.vertical}
    ORDER BY p.total_plays DESC
    LIMIT ${limit}`);
  res.json({ slug, vertical: me.vertical, related: rows });
}));

router.get("/related/track/:id", publicApiLimiter, asyncHandler(async (req, res) => {
  const id = String(req.params.id ?? "");
  const limit = clampLimit(req.query.limit, 8, 12);
  const self = await db
    .select({
      id: profileTracksTable.id,
      profileId: profileTracksTable.profileId,
      genre: profileTracksTable.genre,
    })
    .from(profileTracksTable)
    .where(sql`${profileTracksTable.id} = ${id}::uuid AND ${profileTracksTable.isPublished} = true`)
    .limit(1);
  if (!self.length) {
    res.status(404).json({ error: "Track not found." });
    return;
  }
  const me = self[0]!;
  const gf = me.genre ? sql`AND t.genre ILIKE ${me.genre}` : sql`AND t.profile_id = ${me.profileId}`;
  const rows = await db.execute(sql`
    SELECT t.id, t.profile_id, t.title, t.genre, t.artwork_url, t.play_count, t.like_count, t.duration_sec, ${PROFILE_COLS}
    FROM profile_tracks t
    JOIN creator_profiles p ON p.id = t.profile_id
    WHERE t.is_published AND p.is_public AND t.id != ${me.id}::uuid ${gf}
    ORDER BY t.play_count DESC
    LIMIT ${limit}`);
  res.json({ id, genre: me.genre, related: rows });
}));

/* ─── Follow status (auth) ────────────────────────────────────────────────
   GET /following?ids=<uuid>,<uuid> → { "<id>": true|false }.
   Powers inline follow buttons on charts/search/vertical pages. */

router.get("/following", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 50);
  if (!ids.length) {
    res.json({});
    return;
  }
  const rows = (await db.execute(sql`
    SELECT profile_id AS pid FROM follows
    WHERE follower_user_id = ${userId}::uuid
      AND profile_id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'::uuid`).join(",")}]`)})`)) as unknown as Array<{ pid: string }>;
  const set = new Set(rows.map((r) => r.pid));
  res.json(Object.fromEntries(ids.map((id) => [id, set.has(id)])));
}));

/* ─── Play recording ──────────────────────────────────────────────────────
   POST /play { kind: 'track'|'video', mediaId } — canonical play logger.
   Inserts the play_events row AND bumps the counter columns + the profile's
   total_plays, so windowed charts and all-time charts stay in sync.
   Other workers: call this endpoint (or POST /api/media/:kind/:id/play)
   instead of writing play_events directly. */

const PlayBody = z.object({
  kind: z.enum(["track", "video"]),
  mediaId: z.string().uuid(),
});

router.post("/play", playLimiter, asyncHandler(async (req, res) => {
  const parsed = PlayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "kind ('track'|'video') and mediaId (uuid) required." });
    return;
  }
  const { kind, mediaId } = parsed.data;
  await db.insert(playEventsTable).values({
    kind,
    mediaId,
    userId: (req as Request & { userId?: string }).userId ?? null,
  });
  if (kind === "track") {
    const updated = await db.execute(sql`
      UPDATE profile_tracks SET play_count = play_count + 1
      WHERE id = ${mediaId}::uuid AND is_published
      RETURNING profile_id`);
    const row = (updated as unknown as Array<{ profile_id: string }>)[0];
    if (row) {
      await db.execute(sql`UPDATE creator_profiles SET total_plays = total_plays + 1 WHERE id = ${row.profile_id}::uuid`);
    }
  } else {
    const updated = await db.execute(sql`
      UPDATE profile_videos SET view_count = view_count + 1
      WHERE id = ${mediaId}::uuid AND is_published
      RETURNING profile_id`);
    const row = (updated as unknown as Array<{ profile_id: string }>)[0];
    if (row) {
      await db.execute(sql`UPDATE creator_profiles SET total_plays = total_plays + 1 WHERE id = ${row.profile_id}::uuid`);
    }
  }
  res.json({ ok: true });
}));

/* ─── Activity feed (auth) ────────────────────────────────────────────────
   GET /feed — new releases from followed creators (last 30 days),
   newest first. The client tracks "last visit" in localStorage to badge
   "new since your last visit". */

router.get("/feed", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const limit = clampLimit(req.query.limit, 20, 50);
  const followed = await db
    .select({ profileId: followsTable.profileId })
    .from(followsTable)
    .where(sql`${followsTable.followerUserId} = ${userId}::uuid`);
  const ids = followed.map((f) => f.profileId);
  if (!ids.length) {
    res.json({ items: [], following: 0 });
    return;
  }
  const items = await db.execute(sql`
    (SELECT 'track' AS kind, t.id, t.profile_id, t.title, t.genre, t.artwork_url AS thumb,
            t.play_count AS plays, t.like_count, t.created_at, ${PROFILE_COLS}
     FROM profile_tracks t JOIN creator_profiles p ON p.id = t.profile_id
     WHERE t.is_published AND p.is_public
       AND t.profile_id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'::uuid`).join(",")}]`)})
       AND t.created_at >= NOW() - INTERVAL '30 days')
    UNION ALL
    (SELECT 'video' AS kind, v.id, v.profile_id, v.title, v.genre, v.thumbnail_url AS thumb,
            v.view_count AS plays, v.like_count, v.created_at, ${PROFILE_COLS}
     FROM profile_videos v JOIN creator_profiles p ON p.id = v.profile_id
     WHERE v.is_published AND p.is_public
       AND v.profile_id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id}'::uuid`).join(",")}]`)})
       AND v.created_at >= NOW() - INTERVAL '30 days')
    ORDER BY created_at DESC LIMIT ${limit}`);
  res.json({ items, following: ids.length });
}));

/* ─── Notifications ───────────────────────────────────────────────────────
   GET /notifications — inbox, newest first + unread count.
   POST /notifications/read { ids?: string[] } — mark read (all unread when
   ids omitted).
   POST /notify — cross-worker notify API (auth). Body:
     { kind, title, body?, link?, userId? } → one user, or
     { kind, title, body?, link?, profileId } → fan-out to every follower
     of the profile (caller must own the profile: creator_profiles.user_id).
   Worker 1 (follows): POST /notify { kind:'follow', title:`${name} followed
     you`, link:`/artist/${slug}`, userId: <artist owner> }.
   Worker 2 (publishing): POST /notify { kind:'release', title, body, link,
     profileId } on every publish. */

router.get("/notifications", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const limit = clampLimit(req.query.limit, 30, 50);
  const items = await db
    .select()
    .from(notificationsTable)
    .where(sql`${notificationsTable.userId} = ${userId}::uuid`)
    .orderBy(sql`${notificationsTable.createdAt} DESC`)
    .limit(limit);
  const unread = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM notifications
    WHERE user_id = ${userId}::uuid AND is_read = false`);
  res.json({ items, unread: (unread as unknown as Array<{ n: number }>)[0]?.n ?? 0 });
}));

router.post("/notifications/read", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 100)
    : null;
  if (ids && ids.length) {
    await db.execute(sql`
      UPDATE notifications SET is_read = true
      WHERE user_id = ${userId}::uuid AND id = ANY(${sql.raw(`ARRAY[${ids.map((id) => `'${id.replace(/'/g, "")}'::uuid`).join(",")}]`)})`);
  } else {
    await db.execute(sql`
      UPDATE notifications SET is_read = true
      WHERE user_id = ${userId}::uuid AND is_read = false`);
  }
  res.json({ ok: true });
}));

const NotifyBody = z.object({
  kind: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(140),
  body: z.string().trim().max(500).optional().default(""),
  link: z.string().trim().max(500).optional().default(""),
  userId: z.string().uuid().optional(),
  profileId: z.string().uuid().optional(),
});

router.post("/notify", requireAuth, asyncHandler(async (req, res) => {
  const parsed = NotifyBody.safeParse(req.body);
  if (!parsed.success || (!parsed.data.userId && !parsed.data.profileId)) {
    res.status(400).json({ error: "kind, title, and userId or profileId required." });
    return;
  }
  const { kind, title, body, link, userId, profileId } = parsed.data;

  if (userId) {
    await db.insert(notificationsTable).values({ userId, kind, title, body, link });
    res.json({ ok: true, notified: 1 });
    return;
  }

  // Fan-out to followers — caller must own the profile.
  const owned = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(sql`${creatorProfilesTable.id} = ${profileId}::uuid AND ${creatorProfilesTable.userId} = ${req.userId!}::uuid`)
    .limit(1);
  if (!owned.length) {
    res.status(403).json({ error: "Profile not found or not yours." });
    return;
  }
  const followers = (await db.execute(sql`
    SELECT follower_user_id AS uid FROM follows
    WHERE profile_id = ${profileId}::uuid
    LIMIT 5000`)) as unknown as Array<{ uid: string }>;
  const targets = followers.map((f) => f.uid).filter((uid) => uid !== req.userId);
  if (!targets.length) {
    res.json({ ok: true, notified: 0 });
    return;
  }
  // Chunked bulk insert keeps the fan-out to a couple of round-trips.
  for (let i = 0; i < targets.length; i += 500) {
    const chunk = targets.slice(i, i + 500);
    await db.execute(sql`
      INSERT INTO notifications (user_id, kind, title, body, link)
      SELECT u, ${kind}, ${title}, ${body}, ${link}
      FROM unnest(${sql.raw(`ARRAY[${chunk.map((u) => `'${u}'::uuid`).join(",")}]`)}) AS u`);
  }
  res.json({ ok: true, notified: targets.length });
}));

export default router;
export type { ProfileLite };
