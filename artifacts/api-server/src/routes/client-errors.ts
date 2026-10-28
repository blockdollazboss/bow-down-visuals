import { Router, type IRouter } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * POST /api/client-errors — the RouteErrorBoundary's self-report.
 *
 * Until this route existed, a boundary trip ("The vault guards
 * tripped.") left exactly one trace: a console.error in the affected
 * visitor's own browser. Trips were undiagnosable by construction —
 * on Oct 28 2026 the owner hit it twice (stack400 morning, stack500
 * afternoon) with no route, no error, and no server record for either.
 *
 * The report is deliberately tiny and PII-free: route PATH only (the
 * client strips query/hash before sending; the caps below bound every
 * field regardless), error name + truncated message, whether the
 * error looked like a chunk-load failure, the build identifier when
 * the bundle carries one, and the client timestamp. No auth — the
 * boundary wraps guest routes too. Nothing is stored: the server log
 * line IS the record (Render log search: "[client-error]").
 */
export const clientErrorSchema = z.object({
  route: z.string().min(1).max(200),
  errorName: z.string().min(1).max(100),
  errorMessage: z.string().max(500),
  chunkLike: z.boolean(),
  build: z.string().max(100).nullable().optional(),
  ts: z.string().min(1).max(40),
});

router.post("/client-errors", publicApiLimiter, (req, res) => {
  const parsed = clientErrorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid client error report." });
    return;
  }
  const { route, errorName, errorMessage, chunkLike, build, ts } =
    parsed.data;
  /* Only the parsed fields are logged — never the raw body — so a
     crafted report cannot smuggle extra keys into the log record. */
  logger.warn(
    {
      route,
      errorName,
      errorMessage,
      chunkLike,
      build: build ?? null,
      clientTs: ts,
    },
    "[client-error] route boundary trip",
  );
  res.status(204).end();
});

export default router;
