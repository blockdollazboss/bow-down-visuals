import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { getGenerationHistory } from "../lib/payment-record";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";

const router = Router();

router.get("/generation-history", requireAuth, async (req, res) => {
  try {
    const rows = await getGenerationHistory(req.userId!);
    const history = await Promise.all(rows.map(async (r) => {
      const result = typeof r.result === "object" && r.result !== null ? r.result : {};
      const content = (result as { content?: string }).content ?? "";
      const videoUrl = (result as { videoUrl?: string }).videoUrl ?? null;
      const thumbnailUrl = (result as { thumbnailUrl?: string }).thumbnailUrl ?? null;
      return {
        id:              r.id,
        generation_type: r.generationType,
        credits_used:    r.creditsUsed,
        save_status:     r.saveStatus,
        refunded:        r.refunded,
        project_id:      r.projectId ?? null,
        created_at:      r.createdAt,
        artist_name:     (result as { artistName?: string }).artistName ?? null,
        song_title:      (result as { songTitle?: string }).songTitle ?? null,
        /* Storage refs are re-signed fresh on every read; legacy URLs pass through. */
        video_url:       videoUrl ? await refreshSupabaseStorageUrl(videoUrl) : null,
        thumbnail_url:   thumbnailUrl ? await refreshSupabaseStorageUrl(thumbnailUrl) : null,
        scene_id:        (result as { sceneId?: string }).sceneId ?? null,
        action_label:    (result as { actionLabel?: string }).actionLabel ?? null,
        result_preview:  content.slice(0, 400),
        result_content:  content,
      };
    }));
    res.json({ history });
  } catch (err: unknown) {
    req.log.error({ err }, "generation-history GET error");
    res.status(500).json({ error: "Failed to load generation history." });
  }
});

export default router;
