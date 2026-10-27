import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  drizzleViralSpikeStore,
  getViralSpikePrefs,
  runViralSpikeCheck,
  setViralSpikePrefs,
} from "../lib/viral-spike-service";

const router = Router();

/* ─── Viral-spike response kit (orphan wave; migration 9999) ────────────
   GET   /api/viral-spike-prefs — the creator's on/off switch (ON by
                                  default when no row exists yet)
   PATCH /api/viral-spike-prefs — flip the switch; OFF stops ALL
                                  sampling and surfacing for the account
   GET   /api/viral-spike-kits  — run a fresh check for the caller
                                  (sample the real counters, detect,
                                  fire at most one kit per post per
                                  cooldown window) and return the kits
                                  to surface. Read-only in effect for
                                  anyone whose data is still measuring:
                                  the honest answer then is
                                  status "ok" with measuring > 0 and
                                  no kits — never an invented spike.

   The kit NEVER acts: every step is a link the creator chooses to
   open (requires_creator_action is always true, auto_actions_taken
   is always 0). */

router.get("/viral-spike-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getViralSpikePrefs(drizzleViralSpikeStore, req.userId!));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[viral-spike] prefs read failed");
    res.status(500).json({ error: "Could not load viral-spike preferences" });
  }
});

const viralSpikePrefsSchema = z.object({
  enabled: z.boolean(),
});

router.patch("/viral-spike-prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = viralSpikePrefsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await setViralSpikePrefs(drizzleViralSpikeStore, req.userId!, parsed.data));
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[viral-spike] prefs write failed");
    res.status(500).json({ error: "Could not save viral-spike preferences" });
  }
});

router.get("/viral-spike-kits", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const result = await runViralSpikeCheck(drizzleViralSpikeStore, req.userId!);
    res.json(result);
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[viral-spike] kit check failed");
    res.status(500).json({ error: "Could not check for spikes" });
  }
});

export default router;
