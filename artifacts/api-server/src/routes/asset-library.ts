import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, hubProjectsTable, generationHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import {
  libraryAssetFromGeneration,
  libraryAssetFromHub,
  mergeLibraryAssets,
  type LibraryAssetDTO,
} from "../lib/asset-library";

/* ─── GET /api/asset-library (Stack 4 #5) ───────────────────────────────────
   The one asset library across desks: the caller's active hub-project
   assets (uploads + every desk's reported outputs) merged with their
   generation history, as explicit camelCase DTOs, newest first. Desks'
   pickers read from here instead of keeping per-tool lists. Empty library
   is a 200 with an empty array; a load failure is a 500 — never a fake
   empty. */

const router = Router();

router.get("/asset-library", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const [projectRows, generationRows] = await Promise.all([
      db.select().from(hubProjectsTable).where(eq(hubProjectsTable.user_id, userId)).limit(1),
      db
        .select()
        .from(generationHistoryTable)
        .where(eq(generationHistoryTable.userId, userId))
        .orderBy(desc(generationHistoryTable.createdAt))
        .limit(200),
    ]);

    const projectAssetsRaw = (projectRows[0]?.assets ?? []) as Array<{
      id: string; kind: string; url: string; label: string; detail?: string; createdAt: number;
    }>;
    const fromProject = projectAssetsRaw
      .map((a) => libraryAssetFromHub(a))
      .filter((a): a is LibraryAssetDTO => a !== null);
    const fromGenerations = generationRows
      .map((r) => libraryAssetFromGeneration(r as never))
      .filter((a): a is LibraryAssetDTO => a !== null);

    const merged = mergeLibraryAssets([fromProject, fromGenerations]);
    /* Storage refs are re-signed fresh on every read; legacy URLs pass through. */
    const assets = await Promise.all(
      merged.map(async (a) => ({ ...a, url: await refreshSupabaseStorageUrl(a.url) })),
    );
    res.json({ assets });
  } catch (err: unknown) {
    req.log.error({ err }, "asset-library GET error");
    res.status(500).json({ error: "Failed to load your asset library." });
  }
});

export default router;
