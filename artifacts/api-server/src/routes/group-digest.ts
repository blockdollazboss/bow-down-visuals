import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  drizzleGroupDigestPrefsStore,
  getGroupDigestPrefs,
  setGroupDigestPrefs,
} from "../lib/group-digest";

const router = Router();

/* ─── Group digest prefs ────────────────────────────────────────────────
   GET   /api/group-digest-prefs — the account's digest switches
                                   (default on / weekly / bell-only
                                   when no row exists yet)
   PATCH /api/group-digest-prefs — update any subset

   The periodic per-group activity digest (lib/group-digest.ts) reads
   these before every pass and honors them exactly: enabled=false
   means no digest is ever created for the account, frequency picks
   the daily/weekly window, and email_enabled (default OFF) is the
   only way a digest also goes out by email. Owner-scoped: the routes
   only ever touch the caller's own row. */

router.get("/group-digest-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getGroupDigestPrefs(drizzleGroupDigestPrefsStore, req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[group-digest] prefs read failed");
    res.status(500).json({ error: "Could not load group digest preferences" });
  }
});

const groupDigestPrefsSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: z.enum(["daily", "weekly"]).optional(),
  email_enabled: z.boolean().optional(),
});

router.patch("/group-digest-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = groupDigestPrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await setGroupDigestPrefs(drizzleGroupDigestPrefsStore, req.userId!, parsed.data));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[group-digest] prefs write failed");
    res.status(500).json({ error: "Could not save group digest preferences" });
  }
});

export default router;
