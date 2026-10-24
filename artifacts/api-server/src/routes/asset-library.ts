import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, hubProjectsTable, generationHistoryTable, creatorProfilesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import {
  generationLinkageByUrl,
  libraryAssetFromGeneration,
  libraryAssetFromHub,
  mergeLibraryAssets,
  type LibraryAssetDTO,
} from "../lib/asset-library";
import { buildProvenanceRecord, type ProvenanceRecord } from "../lib/provenance";

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
      /* 0142: a user can hold many hub projects — the library reads the
         most recently updated one (the "current" project). */
      db.select().from(hubProjectsTable).where(eq(hubProjectsTable.user_id, userId)).orderBy(desc(hubProjectsTable.updated_at)).limit(1),
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

    /* Provenance records (lane F7): derived per asset from the same source
       rows + the creator's display name, so every library card can show its
       "Made with" facts and stated licence. Derivation failures degrade to
       no record on that asset — never a failed library. */
    const records = new Map<string, ProvenanceRecord>();
    try {
      const profileRows = await db
        .select({ displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.userId, userId));
      const creatorName = profileRows[0]?.displayName ?? null;
      /* Hub entries linked by URL to a generation row inherit its AI
         facts (the MEDIUM finding from the F7 review: a hub-only copy of
         a desk generation must not understate AI involvement); unlinked
         hub entries derive as "unknown", never as "no AI". */
      const linkage = generationLinkageByUrl(generationRows as never);
      for (const entry of projectAssetsRaw) {
        const dto = libraryAssetFromHub(entry);
        if (!dto) continue;
        const stored = (entry as unknown as { provenance?: { licence?: unknown } }).provenance;
        records.set(dto.id, buildProvenanceRecord({
          assetId: dto.id,
          title: dto.label,
          mediaKind: dto.mediaKind,
          origin: "project",
          creatorId: userId,
          creatorName,
          createdAt: dto.createdAt,
          hubKind: dto.hubKind,
          hubDetail: dto.detail,
          linkedGeneration: linkage.get(dto.url) ?? null,
          storedLicence: stored?.licence,
        }));
      }
      for (const row of generationRows) {
        const dto = libraryAssetFromGeneration(row as never);
        if (!dto) continue;
        const result = (typeof row.result === "object" && row.result !== null ? row.result : {}) as { provenance?: { licence?: unknown } };
        records.set(dto.id, buildProvenanceRecord({
          assetId: dto.id,
          title: dto.label,
          mediaKind: dto.mediaKind,
          origin: "generation",
          creatorId: userId,
          creatorName,
          createdAt: dto.createdAt,
          generationType: row.generationType,
          prompt: row.prompt,
          creditsUsed: row.creditsUsed,
          saveStatus: row.saveStatus,
          storedLicence: result.provenance?.licence,
        }));
      }
    } catch (provErr: unknown) {
      req.log?.warn?.({ err: provErr }, "asset-library provenance derivation failed; serving without records");
    }

    const merged = mergeLibraryAssets([fromProject, fromGenerations]);
    /* Storage refs are re-signed fresh on every read; legacy URLs pass through. */
    const assets = await Promise.all(
      merged.map(async (a) => ({
        ...a,
        url: await refreshSupabaseStorageUrl(a.url),
        provenance: records.get(a.id) ?? null,
      })),
    );
    res.json({ assets });
  } catch (err: unknown) {
    req.log.error({ err }, "asset-library GET error");
    res.status(500).json({ error: "Failed to load your asset library." });
  }
});

export default router;
