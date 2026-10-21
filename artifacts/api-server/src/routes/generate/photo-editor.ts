import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { db, photoPresetsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../../middlewares/require-auth";
import { uploadMediaToSupabaseStorage, refreshSupabaseStorageUrl } from "../../lib/objectStorage";
import {
  clampDevelop, buildRenderArgs, buildDevelopFilter, normalizeOutputSpecs, runBatchLookSync,
  type PhotoOutputSpec,
} from "../../lib/photo-render";

/**
 * Photo desk editor endpoints (Stack 7). Editing is FREE (editor-free
 * law) — no credit charges anywhere in this file; only AI generations
 * charge, elsewhere. Raster photos only.
 *
 *  POST /photo-editor/render-multi   one photo + recipe → many outputs
 *  POST /photo-editor/batch-look-sync one recipe → many photos,
 *                                    per-photo outcomes, never silent
 *  POST /photo-presets               save a named look
 *  GET  /photo-presets               my presets
 *  GET  /photo-presets/public/:slug  public preset page data (no auth)
 *  DELETE /photo-presets/:id
 */

const router = Router();
const execFileAsync = promisify(execFile);

const developSchema = z.object({
  exposure: z.number().optional(), brightness: z.number().optional(),
  contrast: z.number().optional(), temperature: z.number().optional(),
  hue: z.number().optional(), saturation: z.number().optional(),
  lightness: z.number().optional(), rotateDeg: z.number().optional(),
  crop: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable().optional(),
}).optional();

const recipeSchema = z.object({ develop: developSchema }).optional();

function watermarkPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../bow-down-visuals/public/bdv-watermark.webp"),
    resolve(here, "../../../../artifacts/bow-down-visuals/public/bdv-watermark.webp"),
    resolve(process.cwd(), "artifacts/bow-down-visuals/public/bdv-watermark.webp"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function downloadImage(imageUrl: string, dest: string): Promise<void> {
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error("Image URL must be http(s).");
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Could not download the photo (${res.status}).`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Render one photo with a recipe to one spec; upload; return its URL. */
async function renderAndUpload(
  userId: string, imageUrl: string,
  recipe: Parameters<typeof clampDevelop>[0], spec: PhotoOutputSpec,
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "photo-editor-"));
  const inputPath = join(workDir, "input.img");
  const outputPath = join(workDir, `output.${spec.format}`);
  try {
    await downloadImage(imageUrl, inputPath);
    const wm = spec.watermark ? watermarkPath() : null;
    if (spec.watermark && !wm) throw new Error("Branding stamp asset is unavailable on this server.");
    await execFileAsync("ffmpeg", buildRenderArgs({
      inputPath, outputPath, recipe, spec, watermarkPath: wm,
    }), { timeout: 60_000 });
    const buffer = await readFile(outputPath);
    const objectName = `photo-editor/${userId}/${randomUUID()}.${spec.format}`;
    const storageRef = await uploadMediaToSupabaseStorage(
      objectName, buffer, spec.format === "png" ? "image/png" : "image/jpeg",
    );
    return await refreshSupabaseStorageUrl(storageRef);
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}

/* ── Multi-recipe export ────────────────────────────────────────────── */
const renderMultiSchema = z.object({
  imageUrl: z.string().trim().min(1).max(2048),
  recipe: recipeSchema,
  outputs: z.unknown().optional(),
});

router.post("/photo-editor/render-multi", requireAuth, async (req, res) => {
  const parsed = renderMultiSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", message: "imageUrl is required." });
    return;
  }
  const specs = normalizeOutputSpecs(parsed.data.outputs);
  if (!specs) {
    res.status(400).json({ error: "INVALID_OUTPUTS", message: "outputs must be 1–8 specs with format png|jpg and a size." });
    return;
  }
  const recipe = clampDevelop(parsed.data.recipe?.develop);
  const outputs: Array<{ specId: string; format: string; width: number; height: number; watermark: boolean; ok: boolean; url: string | null; error: string | null }> = [];
  for (const spec of specs) {
    try {
      const url = await renderAndUpload(req.userId!, parsed.data.imageUrl, recipe, spec);
      outputs.push({ specId: spec.id, format: spec.format, width: spec.width, height: spec.height, watermark: spec.watermark, ok: true, url, error: null });
    } catch (err) {
      outputs.push({ specId: spec.id, format: spec.format, width: spec.width, height: spec.height, watermark: spec.watermark, ok: false, url: null, error: err instanceof Error ? err.message : "Render failed." });
    }
  }
  res.json({ outputs, succeeded: outputs.filter((o) => o.ok).length, failed: outputs.filter((o) => !o.ok).length });
});

/* ── Batch look-sync ────────────────────────────────────────────────── */
const batchSchema = z.object({
  imageUrls: z.array(z.string().trim().min(1).max(2048)).min(1).max(50),
  recipe: recipeSchema,
  format: z.enum(["png", "jpg"]).optional().default("jpg"),
});

router.post("/photo-editor/batch-look-sync", requireAuth, async (req, res) => {
  const parsed = batchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", message: "imageUrls (1–50) and a recipe are required." });
    return;
  }
  // Batch renders keep each photo's native geometry: develop filter
  // only, no scale/pad — the recipe is the look, not a resize.
  const outcome = await runBatchLookSync(parsed.data.imageUrls, parsed.data.recipe?.develop, async (imageUrl, develop) => {
    const workDir = await mkdtemp(join(tmpdir(), "photo-batch-"));
    const inputPath = join(workDir, "input.img");
    const outputPath = join(workDir, `output.${parsed.data.format}`);
    try {
      await downloadImage(imageUrl, inputPath);
      const vf = buildDevelopFilter(develop);
      await execFileAsync("ffmpeg", ["-y", "-i", inputPath, ...(vf ? ["-vf", vf] : []), "-frames:v", "1", outputPath], { timeout: 60_000 });
      const buffer = await readFile(outputPath);
      const objectName = `photo-editor/${req.userId}/batch/${randomUUID()}.${parsed.data.format}`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, parsed.data.format === "png" ? "image/png" : "image/jpeg");
      return await refreshSupabaseStorageUrl(storageRef);
    } finally {
      await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
    }
  });
  res.json(outcome);
});

/* ── Preset packs ───────────────────────────────────────────────────── */
const presetCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  recipe: z.object({ develop: developSchema }),
  isPublic: z.boolean().optional().default(false),
});

function presetDto(row: typeof photoPresetsTable.$inferSelect) {
  return {
    id: row.id, name: row.name, recipe: row.recipe, isPublic: row.is_public,
    shareSlug: row.share_slug, storeProductId: row.store_product_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "preset";
  return `${base}-${randomUUID().slice(0, 8)}`;
}

router.post("/photo-presets", requireAuth, async (req, res) => {
  const parsed = presetCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", message: "name and recipe.develop are required." });
    return;
  }
  const recipe = { develop: clampDevelop(parsed.data.recipe.develop) };
  const [row] = await db.insert(photoPresetsTable).values({
    user_id: req.userId!, name: parsed.data.name, recipe,
    is_public: parsed.data.isPublic,
    share_slug: parsed.data.isPublic ? slugify(parsed.data.name) : null,
  }).returning();
  res.status(201).json({ preset: row ? presetDto(row) : null });
});

router.get("/photo-presets", requireAuth, async (req, res) => {
  const rows = await db.select().from(photoPresetsTable)
    .where(eq(photoPresetsTable.user_id, req.userId!))
    .orderBy(desc(photoPresetsTable.created_at));
  res.json({ presets: rows.map(presetDto) });
});

/* Public preset page data — only is_public rows, by slug. */
router.get("/photo-presets/public/:slug", async (req, res) => {
  const [row] = await db.select().from(photoPresetsTable)
    .where(and(eq(photoPresetsTable.share_slug, (req.params as { slug: string }).slug), eq(photoPresetsTable.is_public, true)));
  if (!row) {
    res.status(404).json({ error: "PRESET_NOT_FOUND", message: "That preset is not public or does not exist." });
    return;
  }
  res.json({ preset: presetDto(row) });
});

router.delete("/photo-presets/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const deleted = await db.delete(photoPresetsTable)
    .where(and(eq(photoPresetsTable.id, id), eq(photoPresetsTable.user_id, req.userId!)))
    .returning();
  if (!deleted.length) {
    res.status(404).json({ error: "PRESET_NOT_FOUND", message: "Preset not found." });
    return;
  }
  res.json({ deleted: true });
});

export default router;
