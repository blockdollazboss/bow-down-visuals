import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

/**
 * Public social-proof stats engine — GET /api/public/stats
 *
 * Aggregates REAL counts from the Render Postgres DB — never invented,
 * never hardcoded. Served from an in-memory cache (10-min TTL) plus a
 * `Cache-Control: public, max-age=600` header, so marketing surfaces get
 * instant numbers and the DB never feels the load.
 *
 * Each query is individually guarded: if one table is missing or a query
 * fails, that stat falls back to 0 while the rest still return honestly.
 */
const router: IRouter = Router();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface PublicStats {
  /** Total creator profiles on the platform. */
  creators: number;
  /** Published tracks across all creator profiles. */
  tracks_published: number;
  /** Published videos across all creator profiles. */
  videos_published: number;
  /** Raw play events on the platform. */
  plays: number;
  /** Real money actually received by creators via recorded royalty payouts (USD). */
  paid_out_usd: number;
  /** Visual Bucs awarded to creators via referral revenue-share payouts. */
  referral_bucs_awarded: number;
  /** Creator counts by vertical (music | video | gaming | podcast | film | tv | influencer | education | other). */
  verticals: Record<string, number>;
  generated_at: string;
}

let cache: { data: PublicStats; expiresAt: number } | null = null;

/** Run one cheap aggregate; on ANY failure return 0 so one bad table can't sink the whole payload. */
async function safeCount(queryText: string): Promise<number> {
  try {
    const r = await pool.query(queryText);
    const v = r.rows?.[0]?.n;
    const n = typeof v === "string" ? Number(v) : Number(v ?? 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function computeStats(): Promise<PublicStats> {
  const [
    creators,
    tracks_published,
    videos_published,
    plays,
    paid_out_usd,
    referral_bucs_awarded,
  ] = await Promise.all([
    safeCount("SELECT COUNT(*) AS n FROM creator_profiles"),
    safeCount("SELECT COUNT(*) AS n FROM profile_tracks WHERE is_published = true"),
    safeCount("SELECT COUNT(*) AS n FROM profile_videos WHERE is_published = true"),
    safeCount("SELECT COUNT(*) AS n FROM play_events"),
    safeCount(
      "SELECT COALESCE(SUM(received_amount), 0) AS n FROM royalty_payouts WHERE status IN ('received', 'partial')",
    ),
    safeCount("SELECT COALESCE(SUM(referrer_credits_awarded), 0) AS n FROM referral_payouts"),
  ]);

  const verticals: Record<string, number> = {};
  try {
    const r = await pool.query(
      "SELECT vertical AS v, COUNT(*) AS n FROM creator_profiles GROUP BY vertical",
    );
    for (const row of r.rows) {
      const n = Number(row.n ?? 0);
      if (row.v && Number.isFinite(n) && n >= 0) verticals[String(row.v)] = n;
    }
  } catch {
    /* leave verticals empty — still honest */
  }

  return {
    creators,
    tracks_published,
    videos_published,
    plays,
    // NUMERIC comes back as a string; keep 2dp for money.
    paid_out_usd: Math.round(paid_out_usd * 100) / 100,
    referral_bucs_awarded: Math.round(referral_bucs_awarded),
    verticals,
    generated_at: new Date().toISOString(),
  };
}

router.get("/public/stats", async (_req, res) => {
  try {
    if (cache && Date.now() < cache.expiresAt) {
      res.setHeader("Cache-Control", "public, max-age=600");
      res.setHeader("X-Stats-Cache", "HIT");
      return res.json({ ...cache.data, cached: true });
    }
    const data = await computeStats();
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    res.setHeader("Cache-Control", "public, max-age=600");
    res.setHeader("X-Stats-Cache", "MISS");
    return res.json({ ...data, cached: false });
  } catch (err) {
    // Last-resort: serve stale numbers rather than breaking a marketing page.
    if (cache) {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.setHeader("X-Stats-Cache", "STALE");
      return res.json({ ...cache.data, cached: true, stale: true });
    }
    return res.status(503).json({ error: "stats unavailable" });
  }
});

export default router;
