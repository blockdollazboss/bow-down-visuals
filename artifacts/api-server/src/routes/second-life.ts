import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  drizzleRevivalStore,
  drizzleSecondLifePrefsStore,
  getSecondLifePrefs,
  setSecondLifeWatchEnabled,
} from "../lib/second-life";

const router = Router();

/* ─── Second Life (#161) — upgrade of Viral Spike Watch ────────────────
   GET   /api/second-life/prefs              — catalog-watch switch
                                               (watching ON by default)
   PATCH /api/second-life/prefs              — flip the switch; off
                                               means the spike watch
                                               skips this catalog
                                               entirely (no alerts, no
                                               revival proposals)
   GET   /api/second-life/revivals?status=   — the creator's revival
                                               queue (newest first)
   POST  /api/second-life/revivals/:id/decision { status }
                                             — approve or dismiss a
                                               proposal. Approving posts
                                               NOTHING: the plan is
                                               Create links the creator
                                               follows and publishes
                                               from Create. */

router.get("/second-life/prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getSecondLifePrefs(drizzleSecondLifePrefsStore, req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[second-life] prefs read failed");
    res.status(500).json({ error: "Could not load Second Life preferences" });
  }
});

const secondLifePrefsSchema = z.object({
  watch_enabled: z.boolean(),
});

router.patch("/second-life/prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = secondLifePrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(
      await setSecondLifeWatchEnabled(
        drizzleSecondLifePrefsStore,
        req.userId!,
        parsed.data.watch_enabled,
      ),
    );
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[second-life] prefs write failed");
    res.status(500).json({ error: "Could not save Second Life preferences" });
  }
});

router.get("/second-life/revivals", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  try {
    const rows = await drizzleRevivalStore.listForOwner(req.userId!, status);
    res.json({ revivals: rows });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[second-life] revival list failed");
    res.status(500).json({ error: "Could not load revival proposals" });
  }
});

const revivalDecisionSchema = z.object({
  status: z.enum(["approved", "dismissed"]),
});

router.post(
  "/second-life/revivals/:id/decision",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response) => {
    const parsed = revivalDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    try {
      const revivalId = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
      const decided = await drizzleRevivalStore.decide(
        revivalId,
        req.userId!,
        parsed.data.status,
      );
      if (!decided) {
        res.status(404).json({ error: "Revival proposal not found or already decided" });
        return;
      }
      res.json({ id: revivalId, status: parsed.data.status });
    } catch (err) {
      logger.error({ err, userId: req.userId }, "[second-life] revival decision failed");
      res.status(500).json({ error: "Could not record the decision" });
    }
  },
);

export default router;
