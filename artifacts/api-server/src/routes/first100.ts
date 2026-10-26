/**
 * first100.ts — First 100 Fans (#155) over REST:
 *
 *   GET  /api/first100            the caller's First 100 status:
 *                                 real fan count (live from follows),
 *                                 milestone states, the guided steps
 *                                 against real state, and the first
 *                                 fans in follow order (auth)
 *   POST /api/first100/celebrate  fire the recognition for every
 *                                 milestone reached but not yet
 *                                 celebrated (exactly once each, via
 *                                 the notifications rail), then
 *                                 return the fresh status (auth)
 *   POST /api/first100/dismiss    snooze the dashboard card for 7
 *                                 days (smart law — a new milestone
 *                                 still breaks the snooze) (auth)
 *
 * All rules live in lib/first100; this file is the HTTP shape only.
 * The feature is free — no route here touches credits, and the read
 * never writes: celebrations happen only through the explicit
 * celebrate call, so a dashboard load can never spam the bell.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { celebrateFirst100, dismissFirst100, getFirst100Status } from "../lib/first100";

const router = Router();

function handleError(res: Response, err: unknown, what: string): void {
  logger.error({ err }, `[first100] ${what} failed`);
  res.status(500).json({ error: "First 100 Fans stumbled. Try again." });
}

router.get("/first100", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ first100: await getFirst100Status(req.userId!) });
  } catch (err) {
    handleError(res, err, "status read");
  }
});

router.post("/first100/celebrate", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ first100: await celebrateFirst100(req.userId!) });
  } catch (err) {
    handleError(res, err, "celebrate");
  }
});

router.post("/first100/dismiss", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json({ first100: await dismissFirst100(req.userId!) });
  } catch (err) {
    handleError(res, err, "dismiss");
  }
});

export default router;
