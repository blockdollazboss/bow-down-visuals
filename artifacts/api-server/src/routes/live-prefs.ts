import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  drizzleLivePrefsStore,
  getLivePrefs,
  setLivePrefs,
} from "../lib/creator-live-prefs";

const router = Router();

/* ─── Creator live prefs (UPGRADE deltas #172 / #166) ───────────────────
   GET   /api/live-prefs — the account's live automation switches
                           (all-on default when no row exists yet)
   PATCH /api/live-prefs — update any subset; the Stage Manager's
                           link rules ride as one list

   Auto-Highlights and the Stage Manager co-host read these switches
   and gate every automated action on them — an off switch means the
   house does not act, full stop. */

router.get("/live-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getLivePrefs(drizzleLivePrefsStore, req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[live-prefs] read failed");
    res.status(500).json({ error: "Could not load live preferences" });
  }
});

const linkRuleSchema = z.object({
  keyword: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  url: z.string().min(1).max(1000),
});

const livePrefsSchema = z.object({
  auto_highlights_enabled: z.boolean().optional(),
  stage_manager_enabled: z.boolean().optional(),
  stage_manager_pin_enabled: z.boolean().optional(),
  stage_manager_links_enabled: z.boolean().optional(),
  stage_manager_sting_enabled: z.boolean().optional(),
  stage_manager_flags_enabled: z.boolean().optional(),
  stage_manager_link_rules: z.array(linkRuleSchema).max(25).optional(),
});

router.patch("/live-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = livePrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await setLivePrefs(drizzleLivePrefsStore, req.userId!, parsed.data));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[live-prefs] write failed");
    res.status(500).json({ error: "Could not save live preferences" });
  }
});

export default router;
