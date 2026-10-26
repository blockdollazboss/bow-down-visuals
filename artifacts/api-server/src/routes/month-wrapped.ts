import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  buildMonthWrapped,
  buildMonthWrappedShareText,
  drizzleMonthWrappedPrefsStore,
  drizzleMonthWrappedSource,
  getMonthWrappedPrefs,
  isFutureMonth,
  isValidMonthKey,
  previousMonthKey,
  setMonthWrappedPrefs,
} from "../lib/month-wrapped";

const router = Router();

/* ─── Your Month, Wrapped (Stack-200, idea #170) ──────────────────────
   GET   /api/month-wrapped?month=YYYY-MM — the caller's ONE recap for
          that month, computed from real platform tables. Default month
          = the previous (last complete) month. An opted-out creator
          gets { enabled: false, recap: null } — no recap is made.
          A creator with no profile gets recap: null + reason.
   GET   /api/month-wrapped/prefs — the opt-out state (default on)
   PATCH /api/month-wrapped/prefs — { enabled } opt out / back in

   Sharing is the creator's action only: the response carries the
   share text; this API never posts or sends anything. */

router.get("/month-wrapped/prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getMonthWrappedPrefs(drizzleMonthWrappedPrefsStore, req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[month-wrapped] prefs read failed");
    res.status(500).json({ error: "Could not load your Wrapped preferences" });
  }
});

const prefsSchema = z.object({ enabled: z.boolean() });

router.patch("/month-wrapped/prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = prefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await setMonthWrappedPrefs(drizzleMonthWrappedPrefsStore, req.userId!, parsed.data));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[month-wrapped] prefs write failed");
    res.status(500).json({ error: "Could not save your Wrapped preferences" });
  }
});

router.get("/month-wrapped", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthParam = typeof req.query["month"] === "string" ? req.query["month"] : null;
    const month = monthParam ?? previousMonthKey(now);
    if (!isValidMonthKey(month) || isFutureMonth(month, now)) {
      res.status(400).json({ error: "month must be a past or current month, formatted YYYY-MM" });
      return;
    }
    const prefs = await getMonthWrappedPrefs(drizzleMonthWrappedPrefsStore, req.userId!);
    if (!prefs.enabled) {
      res.json({ enabled: false, month, recap: null });
      return;
    }
    const raw = await drizzleMonthWrappedSource.loadRaw(req.userId!, month);
    if (!raw) {
      res.json({ enabled: true, month, recap: null, reason: "no_creator_profile" });
      return;
    }
    const recap = buildMonthWrapped(raw, now);
    res.json({ enabled: true, month, recap, shareText: buildMonthWrappedShareText(recap) });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[month-wrapped] recap failed");
    res.status(500).json({ error: "Could not build your monthly recap — try again." });
  }
});

export default router;
