/**
 * the-crowns.ts — The Crowns over REST (N8, provisional
 * migration 0283_the_crowns):
 *
 *   GET /api/crowns               the awards read: the published
 *                                 categories, the year in progress
 *                                 with its live leader boards, and
 *                                 every decided year's frozen
 *                                 record, newest first.
 *   GET /api/crowns/worn/:userId  the profile crown read: the
 *                                 crowns that creator currently
 *                                 wears (a pure read over the
 *                                 frozen awards — the crown comes
 *                                 off by itself at its expiry).
 *
 * PUBLIC, guests included — the awards are public spectacle like
 * the Season Marks Wall (wins public, balances private; nothing
 * here is a balance, and no VB moves in The Crowns — crowns are
 * honor). The deciding itself is run by the scheduler in
 * lib/the-crowns (started from routes/world.ts); this file only
 * reads.
 */
import { Router, type Request, type Response } from "express";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  activeCrowns,
  crownYearForDate,
  currentCrownLeaders,
  dbCrownsStore,
  toCrownCategoryDto,
  toCrownYearDto,
  CROWN_CATEGORIES,
  type CrownCategoryLeadersDto,
} from "../lib/the-crowns";

const router = Router();

/* The live leader boards are the one computed read on this
 * route; the year's windowed counts change only when a creator
 * works, so a 60 s in-process memo (the marks wall's cadence)
 * keeps the boards cheap without ever showing a long-stale year.
 * Decided years are frozen rows and are read straight through. */
const LIVE_TTL_MS = 60_000;
let liveCache: { crownKey: string; at: number; leaders: CrownCategoryLeadersDto[] } | null =
  null;

async function liveLeaders(
  info: ReturnType<typeof crownYearForDate>,
): Promise<CrownCategoryLeadersDto[]> {
  if (liveCache && liveCache.crownKey === info.crownKey && Date.now() - liveCache.at < LIVE_TTL_MS) {
    return liveCache.leaders;
  }
  const leaders = await currentCrownLeaders(dbCrownsStore, info);
  liveCache = { crownKey: info.crownKey, at: Date.now(), leaders };
  return leaders;
}

router.get("/crowns", publicApiLimiter, async (_req: Request, res: Response) => {
  try {
    const info = crownYearForDate(new Date());
    const [leaders, years] = await Promise.all([
      liveLeaders(info),
      dbCrownsStore.listYears(),
    ]);
    res.json({
      categories: CROWN_CATEGORIES.map(toCrownCategoryDto),
      current: {
        year: info.year,
        crownKey: info.crownKey,
        name: info.name,
        startsAt: info.startsAt.toISOString(),
        endsAt: info.endsAt.toISOString(),
        leaders,
      },
      years: years.map(toCrownYearDto),
    });
  } catch (err) {
    logger.error({ err }, "[crowns] awards read failed");
    res.status(500).json({ error: "Couldn't load The Crowns. Try again." });
  }
});

router.get("/crowns/worn/:userId", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId ?? "");
    if (!userId) {
      res.status(400).json({ error: "A creator id is required." });
      return;
    }
    const years = await dbCrownsStore.listYears();
    res.json({ userId, crowns: activeCrowns(years, userId) });
  } catch (err) {
    logger.error({ err }, "[crowns] worn read failed");
    res.status(500).json({ error: "Couldn't load the crowns. Try again." });
  }
});

export default router;
