import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { buildTrendFeed } from "../lib/trend-radar";

const router = Router();

/* ─── Trend Radar (#178) — the real-signal daily feed ──────────────────
   GET /api/trend-radar?genre= — rising sounds, topics, and formats
   computed ONLY from real play_events windows (last 24h vs the prior
   7 days). This is the Trends page's honest-data rail: nothing here
   is predicted or padded, and a quiet niche answers with fewer rows.
   The AI trend-predictor keeps its own surface; it is NOT a source
   for this feed. */

router.get("/trend-radar", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const genre =
    typeof req.query.genre === "string" && req.query.genre.trim()
      ? req.query.genre.trim().slice(0, 60)
      : undefined;
  try {
    res.json(await buildTrendFeed({ genre }));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[trend-radar] feed failed");
    res.status(500).json({ error: "Could not build the trend feed" });
  }
});

export default router;
