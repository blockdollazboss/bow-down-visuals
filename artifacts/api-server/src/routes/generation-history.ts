import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { getGenerationHistory } from "../lib/payment-record";

const router = Router();

router.get("/generation-history", requireAuth, async (req, res) => {
  try {
    const rows = await getGenerationHistory(req.userId!);
    const history = rows.map((r) => {
      const content = typeof r.result === "object" && r.result !== null
        ? (r.result as { content?: string }).content ?? ""
        : "";
      return {
        id:              r.id,
        generation_type: r.generationType,
        credits_used:    r.creditsUsed,
        save_status:     r.saveStatus,
        refunded:        r.refunded,
        project_id:      r.projectId ?? null,
        created_at:      r.createdAt,
        artist_name:     typeof r.result === "object" && r.result !== null
                           ? (r.result as { artistName?: string }).artistName ?? null
                           : null,
        song_title:      typeof r.result === "object" && r.result !== null
                           ? (r.result as { songTitle?: string }).songTitle ?? null
                           : null,
        result_preview:  content.slice(0, 400),
        result_content:  content,
      };
    });
    res.json({ history });
  } catch (err: unknown) {
    req.log.error({ err }, "generation-history GET error");
    res.status(500).json({ error: "Failed to load generation history." });
  }
});

export default router;
