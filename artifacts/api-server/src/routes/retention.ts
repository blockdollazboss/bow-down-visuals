import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  getStreakStatus,
  claimStreakMilestone,
  getQuestsStatus,
  claimQuestReward,
  getRetentionPrefs,
  setRetentionPrefs,
} from "../lib/retention";

const router = Router();

/* ─── Creation Streaks + Weekly Quests ────────────────────────────────────
   GET  /api/retention/streak        — streak status + milestone progress
   POST /api/retention/streak/claim  — claim a reached milestone ({ days })
   GET  /api/retention/quests        — current week's quests + progress
   POST /api/retention/quests/claim  — claim a completed quest ({ questKey })
   GET  /api/retention/prefs         — retention on/off prefs (streaks, quests,
                                    daily drop, away digest)
   PATCH /api/retention/prefs        — update prefs
   Both systems respect retention_prefs: nothing tracks and nothing pays
   out while the user has the system switched off. */

router.get("/retention/streak", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getStreakStatus(req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention] streak status failed");
    res.status(500).json({ error: "Could not load streak status" });
  }
});

const claimStreakSchema = z.object({ days: z.number().int().positive() });

router.post("/retention/streak/claim", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = claimStreakSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = await claimStreakMilestone(req.userId!, parsed.data.days);
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed";
    const status = message === "Milestone already claimed" ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

router.get("/retention/quests", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getQuestsStatus(req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention] quests status failed");
    res.status(500).json({ error: "Could not load quests" });
  }
});

const claimQuestSchema = z.object({ questKey: z.string().min(1).max(64) });

router.post("/retention/quests/claim", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = claimQuestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    const result = await claimQuestReward(req.userId!, parsed.data.questKey);
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed";
    const status = message === "Quest reward already claimed" ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

router.get("/retention/prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getRetentionPrefs(req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention] prefs read failed");
    res.status(500).json({ error: "Could not load preferences" });
  }
});

const prefsSchema = z.object({
  creation_streaks_enabled: z.boolean().optional(),
  quests_enabled: z.boolean().optional(),
  /* Added for Thy Daily Drop + While You Were Away digest. */
  daily_drop_enabled: z.boolean().optional(),
  away_digest_enabled: z.boolean().optional(),
});

router.patch("/retention/prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await setRetentionPrefs(req.userId!, parsed.data));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[retention] prefs write failed");
    res.status(500).json({ error: "Could not save preferences" });
  }
});

export default router;
