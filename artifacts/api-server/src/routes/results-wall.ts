/**
 * Public Results Wall (Stack-200, dedupe audit #177) — routes.
 *
 *   GET  /api/results-wall            PUBLIC wall: recorded, verified
 *                                     milestone events of OPTED-IN
 *                                     creators only (prefs filtered at
 *                                     query time — revocation instant)
 *   GET  /api/results-wall/me         caller's own prefs + events
 *                                     (private view; scans lazily when
 *                                     the last scan is stale)
 *   POST /api/results-wall/scan       force a derivation scan of the
 *                                     CALLER's own platform records
 *   PUT  /api/results-wall/opt-in     { optedIn } — the master switch
 *   PUT  /api/results-wall/visibility { hiddenKinds } — per-kind switch
 *
 * There is deliberately NO endpoint that creates an event from request
 * data: events come only from the derivation scan over platform records
 * (lib/results-wall.ts). FREE — no credits anywhere in this feature.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { isMissingSchemaError } from "../lib/pg-errors";
import {
  getMyResults,
  getPublicWall,
  maybeScanCreatorResults,
  scanCreatorResults,
  setResultsWallHiddenKinds,
  setResultsWallOptIn,
  staleOptedInUserIds,
  RESULTS_WALL_KIND_SET,
} from "../lib/results-wall";

const router = Router();

function notReady(res: Response) {
  res.status(503).json({
    error: "results_wall_not_ready",
    message: "The Results Wall isn't switched on for this server yet.",
  });
}

router.get("/results-wall", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 50;
    const events = await getPublicWall(limit);
    /* Opportunistic freshness: kick background scans for opted-in
       creators whose records may have crossed a new line. Fire-and-
       forget — the response never waits on a scan (smart law: the
       wall stays quiet and fast; new milestones simply appear). */
    staleOptedInUserIds()
      .then((ids) => ids.forEach((id) => maybeScanCreatorResults(id)))
      .catch(() => { /* freshness is best-effort */ });
    res.json({ events });
  } catch (err) {
    if (isMissingSchemaError(err)) return notReady(res);
    req.log.error({ err }, "results-wall public error");
    res.status(500).json({ error: "The Results Wall wouldn't load. Give it another shot." });
  }
});

router.get("/results-wall/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const state = await getMyResults(userId, { scanIfStale: true });
    res.json(state);
  } catch (err) {
    if (isMissingSchemaError(err)) return notReady(res);
    req.log.error({ err }, "results-wall/me error");
    res.status(500).json({ error: "Your results wouldn't load. Give it another shot." });
  }
});

router.post("/results-wall/scan", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const result = await scanCreatorResults(userId);
    if (!result) {
      res.status(404).json({ error: "Create your creator profile first — your results live on it." });
      return;
    }
    const state = await getMyResults(userId);
    res.json({ ...state, scan: result });
  } catch (err) {
    if (isMissingSchemaError(err)) return notReady(res);
    req.log.error({ err }, "results-wall/scan error");
    res.status(500).json({ error: "The check didn't go through. Give it another shot." });
  }
});

const optInSchema = z.object({ optedIn: z.boolean() });

router.put("/results-wall/opt-in", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = optInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send optedIn as true or false." });
    return;
  }
  try {
    const prefs = await setResultsWallOptIn(userId, parsed.data.optedIn);
    if (!prefs) {
      res.status(404).json({ error: "Create your creator profile first — your results live on it." });
      return;
    }
    /* Opting in is the moment a creator expects their verified
       milestones to appear — scan now so the wall is never stale
       at the exact moment they join it. */
    if (parsed.data.optedIn) maybeScanCreatorResults(userId);
    res.json({ prefs });
  } catch (err) {
    if (isMissingSchemaError(err)) return notReady(res);
    req.log.error({ err }, "results-wall/opt-in error");
    res.status(500).json({ error: "That switch didn't save. Give it another shot." });
  }
});

const visibilitySchema = z.object({
  hiddenKinds: z.array(z.string().min(1).max(64)).max(8),
});

router.put("/results-wall/visibility", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = visibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send hiddenKinds as a list of milestone kinds." });
    return;
  }
  const unknown = parsed.data.hiddenKinds.filter((k) => !RESULTS_WALL_KIND_SET.has(k));
  if (unknown.length > 0) {
    res.status(400).json({ error: `Unknown milestone kind${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` });
    return;
  }
  try {
    const prefs = await setResultsWallHiddenKinds(userId, parsed.data.hiddenKinds);
    if (!prefs) {
      res.status(404).json({ error: "Create your creator profile first — your results live on it." });
      return;
    }
    res.json({ prefs });
  } catch (err) {
    if (isMissingSchemaError(err)) return notReady(res);
    req.log.error({ err }, "results-wall/visibility error");
    res.status(500).json({ error: "That switch didn't save. Give it another shot." });
  }
});

export default router;
