import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { getPaymentHistory, getCreditUsage } from "../lib/payment-record";

const router = Router();

router.get("/credits/history", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const [purchases, usage] = await Promise.all([
      getPaymentHistory(userId),
      getCreditUsage(userId),
    ]);
    res.json({ purchases, usage });
  } catch (err: unknown) {
    req.log.error({ err }, "credits/history error");
    res.status(500).json({ error: "Failed to load credit history." });
  }
});

export default router;
