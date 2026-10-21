/**
 * daily-quests.ts — The Daily Quest Trio over REST (World Ring 4,
 * THE-GAME):
 *
 *   GET  /api/retention/quests/daily        today's trio for the
 *                                           caller (auth): the
 *                                           three day-scoped
 *                                           quests the rotation
 *                                           dealt, their progress,
 *                                           the member's banked
 *                                           marks, and the shared
 *                                           weekly pool's state.
 *   POST /api/retention/quests/daily/claim  claim a completed
 *                                           daily quest
 *                                           ({ questKey }): pays
 *                                           its VB from the
 *                                           shared weekly quest
 *                                           pool (lib/quest-pool)
 *                                           plus its marks — a
 *                                           spent week refuses
 *                                           honestly (402) and
 *                                           the claim waits for
 *                                           next week; a past
 *                                           day's completion
 *                                           refuses as expired.
 *
 * All state + money rules live in lib/daily-quests; this file is
 * the HTTP shape only. Guests hold no hand: both doors are
 * members-only (requireAuth) — a guest has no trio, no progress,
 * no claim.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { getQuestsEnabled } from "../lib/retention";
import {
  createDailyClaimer,
  getDailyQuestsStatus,
  dbDailyQuestStore,
} from "../lib/daily-quests";
import { dbQuestPoolStore } from "../lib/quest-pool";

const router = Router();
const claimDailyQuest = createDailyClaimer();

router.get(
  "/retention/quests/daily",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    try {
      const userId = req.userId!;
      const [enabled, daily] = await Promise.all([
        getQuestsEnabled(userId),
        getDailyQuestsStatus(dbDailyQuestStore, dbQuestPoolStore, userId),
      ]);
      res.json({ enabled, daily });
    } catch (err) {
      logger.error({ err, userId: req.userId }, "[daily-quests] status read failed");
      res.status(500).json({ error: "Today's trio wouldn't answer. Try again." });
    }
  },
);

const claimDailySchema = z.object({ questKey: z.string().min(1).max(64) });

router.post(
  "/retention/quests/daily/claim",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const parsed = claimDailySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const userId = req.userId!;
      const enabled = await getQuestsEnabled(userId);
      const result = await claimDailyQuest(userId, parsed.data.questKey, { enabled });
      if (result.ok) {
        res.json({ claimed: true, amountVb: result.amountVb, marks: result.marks });
        return;
      }
      switch (result.reason) {
        case "unknown":
          res.status(400).json({ error: "That isn't one of the palace's daily quests.", code: "UNKNOWN_QUEST" });
          return;
        case "disabled":
          res.status(400).json({ error: "Quests are switched off in your settings.", code: "QUESTS_DISABLED" });
          return;
        case "not-active":
          res.status(409).json({
            error: "That quest isn't on today's slate — the trio turns at the day-turn, and a past day's finish expires with its day.",
            code: "NOT_TODAYS_QUEST",
          });
          return;
        case "not-completed":
          res.status(409).json({ error: "That daily quest isn't finished yet — it still waits on today's slate.", code: "NOT_COMPLETED" });
          return;
        case "already":
          res.status(409).json({ error: "You've claimed that daily quest already — it pays once.", code: "ALREADY_CLAIMED" });
          return;
        case "pool":
          res.status(402).json({
            error:
              "This week's quest pool is spent — daily rewards draw from the same pool as quest rewards, the King's gifts and the tutorial. The finish stands; its Visual Bucs wait for next week.",
            code: "POOL_SPENT",
          });
          return;
        default:
          res.status(500).json({ error: "That claim didn't land — nothing was paid. Try again.", code: "CLAIM_FAILED" });
          return;
      }
    } catch (err) {
      logger.error({ err, userId: req.userId }, "[daily-quests] claim failed");
      res.status(500).json({ error: "That claim didn't land — nothing was paid. Try again." });
    }
  },
);

export default router;
