import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { publicApiLimiter } from "../middlewares/rate-limit";
import { logger } from "../lib/logger";
import {
  drizzleSoundPrefsStore,
  getSoundPrefs,
  setSoundPrefs,
} from "../lib/sound-prefs";

const router = Router();

/* ─── Signature-sound prefs (Stack-200 UPGRADES 183) ────────────────────
   GET   /api/sound-prefs — the account's sound switches (all-on
                            default when no row exists yet)
   PATCH /api/sound-prefs — update any subset of the switches

   The site's sound engine reads these and gates every play on them:
   master off = total silence, a kind off = that kind silent. */

router.get("/sound-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getSoundPrefs(drizzleSoundPrefsStore, req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[sound-prefs] read failed");
    res.status(500).json({ error: "Could not load sound preferences" });
  }
});

const soundPrefsSchema = z.object({
  master_enabled: z.boolean().optional(),
  notifications_enabled: z.boolean().optional(),
  messages_enabled: z.boolean().optional(),
  success_stings_enabled: z.boolean().optional(),
  errors_enabled: z.boolean().optional(),
  ringtone_enabled: z.boolean().optional(),
});

router.patch("/sound-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = soundPrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await setSoundPrefs(drizzleSoundPrefsStore, req.userId!, parsed.data));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[sound-prefs] write failed");
    res.status(500).json({ error: "Could not save sound preferences" });
  }
});

export default router;
