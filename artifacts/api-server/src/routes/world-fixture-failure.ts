/**
 * world-fixture-failure.ts — the World fixture failure beacon.
 *
 *  POST /api/world/fixture-failure   (signed-in session)
 *  body { postId, body, attempts, errorName, errorMessage, userAgent }
 *
 * The World client sends this ONCE per fixture post per session when
 * a fixture body's fast load plan runs out — the King or a guard's
 * GLB never landed and the post is standing on its fallback (Oct 27:
 * the King stood as a gold capsule for the owner's whole session and
 * the only trace was a console warning on his machine).
 *
 * There is deliberately NO table and NO migration: the report lands
 * in the structured server log as a warn. That is where an operator
 * looks when the owner says "the King was a capsule again" — the
 * failure becomes diagnosable from the logs (which post, which body,
 * how many attempts, what error, which browser) without asking
 * anyone to open a developer console.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

const FixtureFailureSchema = z.object({
  postId: z.string().min(1).max(64),
  body: z.enum(["guard-male", "guard-female", "king"]),
  attempts: z.number().int().min(1).max(100),
  errorName: z.string().min(1).max(120),
  errorMessage: z.string().min(1).max(500),
  userAgent: z.string().max(300),
});

router.post(
  "/world/fixture-failure",
  requireAuth,
  publicApiLimiter,
  (req: Request, res: Response) => {
    const parsed = FixtureFailureSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid fixture failure report." });
      return;
    }
    logger.warn(
      { fixtureFailure: parsed.data, userId: req.userId ?? null },
      "world: fixture body failed to load (client beacon)",
    );
    res.status(202).json({ ok: true });
  },
);

export default router;
