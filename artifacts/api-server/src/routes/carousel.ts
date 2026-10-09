import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { deductCredits } from "../lib/credits.js";

const router = Router();

/**
 * POST /api/carousel/export
 * Charges 100 Visual Bucs for a carousel PNG export. The actual slide
 * rendering is client-side (canvas → PNG); this endpoint records the
 * spend so the ledger stays honest.
 */
router.post("/api/carousel/export", requireAuth, async (req, res) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    const slideCount = Math.min(Math.max(Number(req.body?.slideCount) || 1, 1), 10);
    const newBalance = await deductCredits(userId, 100);
    res.json({ ok: true, slideCount, charged: 100, balance: newBalance });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    const status = /insufficient|balance/i.test(message) ? 402 : 500;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;
