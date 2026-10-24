import { Router } from "express";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { requireAuth } from "../middlewares/require-auth";
import {
  db,
  generationHistoryTable,
  hubProjectsTable,
  creatorProfilesTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  libraryAssetFromGeneration,
  libraryAssetFromHub,
  type LibraryAssetDTO,
} from "../lib/asset-library";
import {
  ASSET_LICENCES,
  buildLicenceCertificatePdf,
  buildProvenanceRecord,
  isLicenceId,
  type ProvenanceRecord,
} from "../lib/provenance";

/* ─── Provenance & licence-certificate doors (Stack-100 #3, lane F7) ────
   GET  /api/provenance/:kind/:id              → the asset's record
   POST /api/provenance/:kind/:id/licence      → state a licence for it
   GET  /api/provenance/:kind/:id/certificate  → the licence certificate PDF

   :kind/:id are the asset library's own ids split ("hub:<entryId>" /
   "gen:<rowId>"). Every lookup is scoped to the caller's user id — an
   asset that isn't theirs (or doesn't exist) is a 404, never a leak.
   The licence choice is stored with the asset itself: inside the hub
   project's assets JSONB entry, or the generation row's result JSONB —
   data-level writes into existing columns, no schema change. */

const router = Router();

type AssetKind = "hub" | "gen";

interface LoadedAsset {
  dto: LibraryAssetDTO;
  record: ProvenanceRecord;
  /** Raw stored licence slot, for the write path. */
  hubProjectRow?: { id: string; assets: unknown[] };
  hubAssetIndex?: number;
  genRowId?: string;
  genResult?: Record<string, unknown>;
}

async function creatorName(userId: string): Promise<string | null> {
  const rows = await db
    .select({ displayName: creatorProfilesTable.displayName })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId));
  return rows[0]?.displayName ?? null;
}

async function loadGenAsset(userId: string, id: string): Promise<LoadedAsset | null> {
  const rows = await db
    .select()
    .from(generationHistoryTable)
    .where(and(eq(generationHistoryTable.id, id), eq(generationHistoryTable.userId, userId)));
  const row = rows[0];
  if (!row) return null;
  const dto = libraryAssetFromGeneration(row as never);
  if (!dto) return null;
  const result = (typeof row.result === "object" && row.result !== null ? row.result : {}) as Record<string, unknown>;
  const stored = (result["provenance"] ?? {}) as { licence?: unknown };
  const record = buildProvenanceRecord({
    assetId: dto.id,
    title: dto.label,
    mediaKind: dto.mediaKind,
    origin: "generation",
    creatorId: userId,
    creatorName: await creatorName(userId),
    createdAt: dto.createdAt,
    generationType: row.generationType,
    prompt: row.prompt,
    creditsUsed: row.creditsUsed,
    saveStatus: row.saveStatus,
    storedLicence: stored.licence,
  });
  return { dto, record, genRowId: row.id, genResult: result };
}

async function loadHubAsset(userId: string, id: string): Promise<LoadedAsset | null> {
  /* Same read model as GET /api/asset-library: the caller's most recently
     updated hub project is "the current project" the library reads. */
  const projects = await db
    .select()
    .from(hubProjectsTable)
    .where(eq(hubProjectsTable.user_id, userId))
    .orderBy(desc(hubProjectsTable.updated_at))
    .limit(1);
  const project = projects[0];
  if (!project) return null;
  const assets = (Array.isArray(project.assets) ? project.assets : []) as Array<Record<string, unknown>>;
  const index = assets.findIndex((a) => a && a["id"] === id);
  if (index < 0) return null;
  const entry = assets[index]!;
  const dto = libraryAssetFromHub(entry as never);
  if (!dto) return null;
  const stored = (entry["provenance"] ?? {}) as { licence?: unknown };
  const record = buildProvenanceRecord({
    assetId: dto.id,
    title: dto.label,
    mediaKind: dto.mediaKind,
    origin: "project",
    creatorId: userId,
    creatorName: await creatorName(userId),
    createdAt: dto.createdAt,
    hubKind: dto.hubKind,
    hubDetail: dto.detail,
    storedLicence: stored.licence,
  });
  return { dto, record, hubProjectRow: { id: project.id, assets }, hubAssetIndex: index };
}

async function loadAsset(userId: string, kind: AssetKind, id: string): Promise<LoadedAsset | null> {
  return kind === "gen" ? loadGenAsset(userId, id) : loadHubAsset(userId, id);
}

/* ─── Shared loader for the Publish/Scheduler flow (wave 3) ──────────────
   The scheduler stamps a post with the provenance record of the asset
   being published. It loads the record through THIS door — same
   ownership scoping (another creator's asset is simply not found) —
   so publish surfaces a record, never a re-derivation from a URL. */
export async function loadProvenanceRecordForUser(
  userId: string,
  assetId: string,
): Promise<ProvenanceRecord | null> {
  const idx = assetId.indexOf(":");
  if (idx <= 0) return null;
  const kind = assetId.slice(0, idx);
  const id = assetId.slice(idx + 1);
  if (kind !== "hub" && kind !== "gen") return null;
  const loaded = await loadAsset(userId, kind, id);
  return loaded?.record ?? null;
}

function parseTarget(req: { params: Record<string, string> }): { kind: AssetKind; id: string } | null {
  const kind = req.params["kind"];
  const id = req.params["id"];
  if (kind !== "hub" && kind !== "gen") return null;
  if (!id || id.length > 200) return null;
  return { kind, id };
}

router.get("/provenance/:kind/:id", requireAuth, async (req, res) => {
  const target = parseTarget(req as never);
  if (!target) {
    res.status(404).json({ error: "Asset not found." });
    return;
  }
  try {
    const loaded = await loadAsset(req.userId!, target.kind, target.id);
    if (!loaded) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    res.json({ record: loaded.record, licenceOptions: ASSET_LICENCES });
  } catch (err: unknown) {
    req.log.error({ err }, "provenance GET error");
    res.status(500).json({ error: "Failed to load the provenance record." });
  }
});

router.post("/provenance/:kind/:id/licence", requireAuth, async (req, res) => {
  const target = parseTarget(req as never);
  if (!target) {
    res.status(404).json({ error: "Asset not found." });
    return;
  }
  const licence = (req.body as { licence?: unknown } | undefined)?.licence;
  if (!isLicenceId(licence)) {
    res.status(400).json({ error: "Unknown licence. Pick one of the offered licences." });
    return;
  }
  try {
    const loaded = await loadAsset(req.userId!, target.kind, target.id);
    if (!loaded) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    const stamp = { licence, licenceUpdatedAt: new Date().toISOString() };
    if (loaded.genRowId) {
      await db
        .update(generationHistoryTable)
        .set({ result: { ...(loaded.genResult ?? {}), provenance: stamp } as never })
        .where(and(eq(generationHistoryTable.id, loaded.genRowId), eq(generationHistoryTable.userId, req.userId!)));
    } else if (loaded.hubProjectRow && loaded.hubAssetIndex !== undefined) {
      const assets = [...loaded.hubProjectRow.assets] as Array<Record<string, unknown>>;
      assets[loaded.hubAssetIndex] = { ...assets[loaded.hubAssetIndex], provenance: stamp };
      await db
        .update(hubProjectsTable)
        .set({ assets: assets as never })
        .where(and(eq(hubProjectsTable.id, loaded.hubProjectRow.id), eq(hubProjectsTable.user_id, req.userId!)));
    }
    const updated = await loadAsset(req.userId!, target.kind, target.id);
    res.json({ record: updated?.record ?? { ...loaded.record, licence } });
  } catch (err: unknown) {
    req.log.error({ err }, "provenance licence POST error");
    res.status(500).json({ error: "Failed to save the licence." });
  }
});

/* The certificate carries the site's real logo — the whole illustrated
   lockup (logo-email.png, the PNG master of logo-static.webp) — embedded
   intact, or a typographic letterhead when the file isn't reachable.
   Resolved once per process; candidates cover dev (tsx from src), the
   bundled server (dist/), and a repo-root cwd. */
let logoCache: Buffer | null | undefined;
async function certificateLogo(): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;
  const candidates: string[] = [];
  if (process.env["PROVENANCE_LOGO_PATH"]) candidates.push(process.env["PROVENANCE_LOGO_PATH"]);
  try {
    candidates.push(fileURLToPath(new URL("../../../bow-down-visuals/public/logo-email.png", import.meta.url)));
  } catch { /* import.meta.url not file-backed in some runners */ }
  try {
    candidates.push(fileURLToPath(new URL("../../bow-down-visuals/public/logo-email.png", import.meta.url)));
  } catch { /* ditto */ }
  candidates.push(`${process.cwd()}/../bow-down-visuals/public/logo-email.png`);
  candidates.push(`${process.cwd()}/artifacts/bow-down-visuals/public/logo-email.png`);
  for (const path of candidates) {
    try {
      logoCache = await readFile(path);
      return logoCache;
    } catch { /* try the next candidate */ }
  }
  logoCache = null;
  return null;
}

function certificateFilename(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "asset"}-licence-certificate.pdf`;
}

router.get("/provenance/:kind/:id/certificate", requireAuth, async (req, res) => {
  const target = parseTarget(req as never);
  if (!target) {
    res.status(404).json({ error: "Asset not found." });
    return;
  }
  try {
    const loaded = await loadAsset(req.userId!, target.kind, target.id);
    if (!loaded) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    const pdf = await buildLicenceCertificatePdf(loaded.record, { logoPng: await certificateLogo() });
    res
      .status(200)
      .setHeader("Content-Type", "application/pdf")
      .setHeader("Content-Disposition", `attachment; filename="${certificateFilename(loaded.record.title)}"`)
      .send(pdf);
  } catch (err: unknown) {
    req.log.error({ err }, "provenance certificate GET error");
    res.status(500).json({ error: "Failed to build the certificate." });
  }
});

export default router;
