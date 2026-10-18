/**
 * world-tutorial.ts — "Your First 10 Minutes" over REST (Ring 3,
 * Phase 6; THE-GAME §4.6 item 6):
 *
 *   GET  /api/world/tutorial        the caller's quest-line
 *                                   status (auth): where they
 *                                   stand, which steps are done.
 *                                   The read RECONCILES: fact
 *                                   steps (daily claim, song
 *                                   made, publish, quest claim)
 *                                   advance off the site's real
 *                                   rails on every read.
 *   POST /api/world/tutorial/claim  claim the completion reward
 *                                   (auth): pays once, ever, from
 *                                   the shared weekly quest pool
 *                                   (lib/quest-pool) — a spent
 *                                   week refuses honestly and the
 *                                   reward waits for a later week.
 *
 * All state + money rules live in lib/world-tutorial; this file
 * is the HTTP shape only. Guests hold no hand: both doors are
 * members-only (requireAuth).
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  getTutorialStatus,
  createTutorialClaimer,
  dbTutorialStore,
} from "../lib/world-tutorial";

const router = Router();
const claimTutorialReward = createTutorialClaimer();

router.get(
  "/world/tutorial",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      const status = await getTutorialStatus(dbTutorialStore, req.userId!);
      res.json({ tutorial: status });
    } catch (err) {
      logger.error({ err }, "[tutorial] status read failed");
      res.status(500).json({ error: "Your quest line wouldn't answer. Try again." });
    }
  },
);

router.post(
  "/world/tutorial/claim",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      const result = await claimTutorialReward(req.userId!);
      if (result.ok) {
        res.json({ claimed: true, amountVb: result.amountVb });
        return;
      }
      switch (result.reason) {
        case "not-completed":
          res.status(409).json({
            error: "The quest line isn't finished yet — the reward lands when all seven steps are done.",
            code: "NOT_COMPLETED",
          });
          return;
        case "already":
          res.status(409).json({
            error: "You've claimed the completion reward already — it pays once.",
            code: "ALREADY_CLAIMED",
          });
          return;
        case "pool":
          res.status(402).json({
            error:
              "This week's quest pool is spent — the completion reward draws from the same pool as quest rewards. It waits for you next week.",
            code: "POOL_SPENT",
          });
          return;
        default:
          res.status(500).json({
            error: "That claim didn't land — nothing was paid. Try again.",
            code: "CLAIM_FAILED",
          });
          return;
      }
    } catch (err) {
      logger.error({ err }, "[tutorial] claim failed");
      res.status(500).json({ error: "That claim didn't land — nothing was paid. Try again." });
    }
  },
);

export default router;
