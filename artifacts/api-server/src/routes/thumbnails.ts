import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, generationHistoryTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";

const router = Router();

interface ThumbnailResult {
  thumbnailUrl?: string;
  artistName?: string;
  songTitle?: string;
  actionLabel?: string;
}

/**
 * GET /api/thumbnails — the user's thumbnail library, newest first.
 * Reads from generation_history (generationType = "thumbnail"), the same rows
 * the Thumbnail Maker writes via recordThumbnailHistory. Storage refs are
 * re-signed fresh on every read, exactly like /api/generation-history.
 */
router.get("/thumbnails", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(generationHistoryTable)
      .where(
        and(
          eq(generationHistoryTable.userId, req.userId!),
          eq(generationHistoryTable.generationType, "thumbnail"),
        ),
      )
      .orderBy(desc(generationHistoryTable.createdAt));

    const thumbnails = await Promise.all(
      rows.map(async (r) => {
        const result =
          typeof r.result === "object" && r.result !== null
            ? (r.result as ThumbnailResult)
            : ({} as ThumbnailResult);
        const ref = result.thumbnailUrl ?? null;
        return {
          id: r.id,
          thumbnail_url: ref ? await refreshSupabaseStorageUrl(ref) : null,
          artist_name: result.artistName ?? null,
          song_title: result.songTitle ?? null,
          action_label: result.actionLabel ?? null,
          credits_used: r.creditsUsed,
          created_at: r.createdAt,
        };
      }),
    );
    res.json({ thumbnails });
  } catch (err: unknown) {
    req.log.error({ err }, "thumbnails GET error");
    res.status(500).json({ error: "Failed to load thumbnails." });
  }
});

/**
 * DELETE /api/thumbnails/:id — removes a thumbnail from the user's library.
 * Non-destructive: deletes the history row only. The image object in
 * Supabase storage is never touched.
 */
router.delete("/thumbnails/:id", requireAuth, async (req, res) => {
  try {
    const thumbnailId = String(req.params["id"]);
    const scope = and(
      eq(generationHistoryTable.id, thumbnailId),
      eq(generationHistoryTable.userId, req.userId!),
      eq(generationHistoryTable.generationType, "thumbnail"),
    );
    const existing = await db
      .select({ id: generationHistoryTable.id })
      .from(generationHistoryTable)
      .where(scope)
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "Thumbnail not found." });
      return;
    }
    await db.delete(generationHistoryTable).where(scope);
    res.json({ deleted: true });
  } catch (err: unknown) {
    req.log.error({ err }, "thumbnails DELETE error");
    res.status(500).json({ error: "Failed to delete thumbnail." });
  }
});

export default router;
