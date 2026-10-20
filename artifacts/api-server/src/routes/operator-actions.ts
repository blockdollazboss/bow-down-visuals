/**
 * operator-actions.ts — the member's own operator action trail.
 *
 *   GET /api/operator/actions   (auth) "what did you do for me" —
 *   the caller's OWN operator_actions rows, newest first. There is
 *   deliberately no way to widen this read: the query is scoped to
 *   the session's user id, full stop (the admin-wide read lives on
 *   the ADMIN_EMAILS bench in routes/admin.ts).
 *
 * Rows are written by the executor from rail results (Phase 2 Lane A);
 * this route only reads them back.
 */
import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { listMyOperatorActions } from "../lib/operator-executor";
import { logger } from "../lib/logger";

const router = Router();

router.get("/operator/actions", requireAuth, async (req, res) => {
  try {
    const limitRaw = Number(req.query["limit"]);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50;
    const rows = await listMyOperatorActions(req.userId!, limit);
    res.json({
      actions: rows.map((r) => ({
        id: r.id,
        tier: r.tier,
        toolId: r.toolId,
        summary: r.summary,
        target: r.target,
        channel: r.channel,
        priceQuoted: r.priceQuoted,
        priceCharged: r.priceCharged,
        result: r.result,
        resultReason: r.resultReason,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[operator] member action readback failed");
    res.status(500).json({ error: "Couldn't load your action history — please try again." });
  }
});

export default router;
