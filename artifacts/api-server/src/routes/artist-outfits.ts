import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import { db, artistVaultsTable, artistOutfitsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";

const router = Router();

const httpsUrl = z
  .string()
  .trim()
  .min(1)
  .refine((u) => /^https?:\/\//i.test(u), { message: "image_url must be an http(s) URL" });

const CreateOutfitSchema = z.object({
  label: z.string().trim().min(1).max(120),
  image_url: httpsUrl,
  image_path: z.string().trim().max(500).optional().nullable(),
});

const UpdateOutfitSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  is_default: z.boolean().optional(),
});

/** 404 unless the vault exists AND belongs to the caller. */
async function requireOwnedVault(vaultId: string, userId: string) {
  const rows = await db
    .select({ id: artistVaultsTable.id })
    .from(artistVaultsTable)
    .where(and(eq(artistVaultsTable.id, vaultId), eq(artistVaultsTable.user_id, userId)))
    .limit(1);
  return rows[0] ?? null;
}

async function requireOwnedOutfit(vaultId: string, outfitId: string, userId: string) {
  const vault = await requireOwnedVault(vaultId, userId);
  if (!vault) return null;
  const rows = await db
    .select()
    .from(artistOutfitsTable)
    .where(and(eq(artistOutfitsTable.id, outfitId), eq(artistOutfitsTable.vault_id, vaultId)))
    .limit(1);
  return rows[0] ?? null;
}

/* ── GET /api/artist-vaults/:vaultId/outfits — list the vault's wardrobe ── */
router.get("/artist-vaults/:vaultId/outfits", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const vault = await requireOwnedVault(vaultId, req.userId!);
  if (!vault) {
    res.status(404).json({ error: "Artist vault not found" });
    return;
  }
  const outfits = await db
    .select()
    .from(artistOutfitsTable)
    .where(eq(artistOutfitsTable.vault_id, vaultId))
    .orderBy(asc(artistOutfitsTable.sort_order), asc(artistOutfitsTable.created_at));
  res.json({ outfits });
});

/* ── POST /api/artist-vaults/:vaultId/outfits — add an outfit ── */
router.post("/artist-vaults/:vaultId/outfits", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const vault = await requireOwnedVault(vaultId, req.userId!);
  if (!vault) {
    res.status(404).json({ error: "Artist vault not found" });
    return;
  }
  const parsed = CreateOutfitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid outfit data", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  const existing = await db
    .select({ id: artistOutfitsTable.id })
    .from(artistOutfitsTable)
    .where(eq(artistOutfitsTable.vault_id, vaultId))
    .limit(1);
  const isFirst = existing.length === 0;

  const [row] = await db
    .insert(artistOutfitsTable)
    .values({
      vault_id: vaultId,
      label: d.label,
      image_url: d.image_url,
      image_path: d.image_path ?? null,
      is_default: isFirst,
    })
    .returning();

  res.status(201).json({ outfit: row });
});

/* ── PATCH /api/artist-vaults/:vaultId/outfits/:outfitId — rename / set default ── */
router.patch("/artist-vaults/:vaultId/outfits/:outfitId", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const outfitId = String(req.params["outfitId"]);
  const outfit = await requireOwnedOutfit(vaultId, outfitId, req.userId!);
  if (!outfit) {
    res.status(404).json({ error: "Outfit not found" });
    return;
  }
  const parsed = UpdateOutfitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid outfit data", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  if (d.is_default === true) {
    await db
      .update(artistOutfitsTable)
      .set({ is_default: false })
      .where(eq(artistOutfitsTable.vault_id, vaultId));
  }
  const set: Record<string, unknown> = {};
  if (d.label !== undefined) set["label"] = d.label;
  if (d.is_default !== undefined) set["is_default"] = d.is_default;
  if (Object.keys(set).length > 0) {
    await db
      .update(artistOutfitsTable)
      .set(set)
      .where(eq(artistOutfitsTable.id, outfitId));
  }

  res.json({ success: true });
});

/* ── DELETE /api/artist-vaults/:vaultId/outfits/:outfitId — remove (row only) ── */
router.delete("/artist-vaults/:vaultId/outfits/:outfitId", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const outfitId = String(req.params["outfitId"]);
  const outfit = await requireOwnedOutfit(vaultId, outfitId, req.userId!);
  if (!outfit) {
    res.status(404).json({ error: "Outfit not found" });
    return;
  }
  // Non-destructive by design: only the row is removed. The image object in
  // Supabase storage is never touched.
  await db.delete(artistOutfitsTable).where(eq(artistOutfitsTable.id, outfitId));
  res.json({ success: true });
});

export default router;
