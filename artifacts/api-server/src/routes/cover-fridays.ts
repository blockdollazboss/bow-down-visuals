/**
 * cover-fridays.ts — Cover Fridays over REST (N19):
 *
 *   GET /api/challenges/cover-fridays   the ritual's read: this
 *     week's house cover theme (ALWAYS resolved — the rotation
 *     is a pure function of the ISO week, so the read serves a
 *     theme even before the week's challenge row exists), the
 *     week's challenge state, the featured crowned cover
 *     (credited), and the recent crowns.
 *
 * PUBLIC, guests included — the ritual is public spectacle like
 * the weekly contest (wins public, balances private; no VB
 * moves in Cover Fridays — the crown is the feature). Entering
 * rides the engine's POST /api/challenges/:slug/enter with the
 * week's cover-fridays slug, and votes ride the engine's vote
 * rail — this file adds no entry or vote surface of its own.
 * The cadence (ensuring the week's challenge + the King's
 * Monday crowning) is run by the scheduler in lib/cover-fridays
 * (started from routes/world.ts); this file only reads.
 */
import { Router, type Request, type Response } from "express";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import {
  coverThemeForWeek,
  coverWeekForDate,
  dbCoverFridaysStore,
  COVER_FRIDAYS_PAST_CROWNS,
} from "../lib/cover-fridays";

const router = Router();

router.get("/challenges/cover-fridays", publicApiLimiter, async (_req: Request, res: Response) => {
  try {
    const info = coverWeekForDate(new Date());
    const { theme } = coverThemeForWeek(info.isoWeek);
    const [challenge, crowned] = await Promise.all([
      dbCoverFridaysStore.getChallenge(info.slug),
      dbCoverFridaysStore.crownedCovers(COVER_FRIDAYS_PAST_CROWNS),
    ]);
    /* Thumbnail / avatar values are stored as storage refs —
       wrap the assembled payload like the weekly endpoint does
       so the featured cover actually renders. */
    res.json(await refreshSupabaseStorageUrlsDeep({
      week_key: info.weekKey,
      theme,
      friday_at: info.fridayAt.toISOString(),
      crown_by_at: info.crownByAt.toISOString(),
      challenge: challenge
        ? {
            slug: challenge.slug,
            status: challenge.status,
            entry_count: challenge.entryCount,
            starts_at: challenge.startsAt.toISOString(),
            ends_at: challenge.endsAt.toISOString(),
          }
        : null,
      featured: crowned[0] ?? null,
      past_crowns: crowned.slice(1),
    }));
  } catch (err) {
    logger.error({ err }, "[cover-fridays] ritual read failed");
    res.status(500).json({ error: "Couldn't load Cover Fridays. Try again." });
  }
});

export default router;
