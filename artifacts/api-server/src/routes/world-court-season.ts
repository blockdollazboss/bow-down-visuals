/**
 * world-court-season.ts — Court seasons over REST (World /
 * THE-GAME Ring 4, migration 0153):
 *
 *   GET /api/world/court-season   the Season Marks Wall's read:
 *                                 the current season (its span +
 *                                 live top of the court) and every
 *                                 settled season's frozen standings,
 *                                 newest first.
 *
 * PUBLIC, guests included — standings are public spectacle per
 * THE-GAME defaults (wins public, balances private; nothing here
 * is a balance, and no VB moves in a season — marks are honor).
 * The settling itself is run by the scheduler in
 * lib/world-court-season (started from routes/world.ts); this
 * file only reads.
 */
import { Router, type Request, type Response } from "express";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  currentSeasonStandings,
  dbCourtSeasonStore,
  seasonForDate,
  toCourtSeasonDto,
  toSettlementDto,
  type CourtSeasonStanding,
} from "../lib/world-court-season";

const router = Router();

/* The live standings are the one computed read on this route; the
 * windowed counts change only when a creator works, so a 60 s
 * in-process memo (the creator-rank cache's cadence) keeps the
 * wall cheap without ever showing a long-stale court. Settlements
 * are frozen rows and are read straight through. */
const LIVE_TTL_MS = 60_000;
let liveCache: { seasonKey: string; at: number; standings: CourtSeasonStanding[] } | null =
  null;

async function liveStandings(
  seasonKey: string,
  season: ReturnType<typeof seasonForDate>,
): Promise<CourtSeasonStanding[]> {
  if (liveCache && liveCache.seasonKey === seasonKey && Date.now() - liveCache.at < LIVE_TTL_MS) {
    return liveCache.standings;
  }
  const standings = await currentSeasonStandings(dbCourtSeasonStore, season);
  liveCache = { seasonKey, at: Date.now(), standings };
  return standings;
}

router.get("/world/court-season", publicApiLimiter, async (_req: Request, res: Response) => {
  try {
    const season = seasonForDate(new Date());
    const [standings, settlements] = await Promise.all([
      liveStandings(season.seasonKey, season),
      dbCourtSeasonStore.listSettlements(),
    ]);
    res.json({
      current: { ...toCourtSeasonDto(season), standings },
      seasons: settlements.map(toSettlementDto),
    });
  } catch (err) {
    logger.error({ err }, "[court-season] marks wall read failed");
    res.status(500).json({ error: "Couldn't load the season marks. Try again." });
  }
});

export default router;
