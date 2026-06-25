import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import { db, artistVaultsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

const ArtistVaultSchema = z.object({
  artistName: z.string().min(1),
  artistType: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  voiceStyle: z.string().optional().nullable(),
  visualStyle: z.string().optional().nullable(),
  hair: z.string().optional().nullable(),
  tattoos: z.string().optional().nullable(),
  jewelry: z.string().optional().nullable(),
  clothingStyle: z.string().optional().nullable(),
  brandColors: z.string().optional().nullable(),
  personality: z.string().optional().nullable(),
  doNotChangeRules: z.string().optional().nullable(),
  referenceImageUrl: z.string().optional().nullable(),
  referenceImagePath: z.string().optional().nullable(),
  consistencyPrompt: z.string().optional().nullable(),
});

router.post("/artist-vaults", requireAuth, async (req, res) => {
  const parsed = ArtistVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid artist vault data" });
    return;
  }
  const d = parsed.data;

  const [row] = await db
    .insert(artistVaultsTable)
    .values({
      user_id: req.userId!,
      artist_name: d.artistName,
      artist_type: d.artistType ?? null,
      genre: d.genre ?? null,
      voice_style: d.voiceStyle ?? null,
      visual_style: d.visualStyle ?? null,
      hair: d.hair ?? null,
      tattoos: d.tattoos ?? null,
      jewelry: d.jewelry ?? null,
      clothing_style: d.clothingStyle ?? null,
      brand_colors: d.brandColors ?? null,
      personality: d.personality ?? null,
      do_not_change_rules: d.doNotChangeRules ?? null,
      reference_image_url: d.referenceImageUrl ?? null,
      reference_image_path: d.referenceImagePath ?? null,
      consistency_prompt: d.consistencyPrompt ?? null,
      is_active: false,
    })
    .returning({ id: artistVaultsTable.id });

  res.status(201).json({ id: row?.id });
});

router.get("/artist-vaults", requireAuth, async (req, res) => {
  const vaults = await db
    .select()
    .from(artistVaultsTable)
    .where(eq(artistVaultsTable.user_id, req.userId!))
    .orderBy(desc(artistVaultsTable.created_at));

  res.json({ vaults });
});

router.put("/artist-vaults/:id", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const parsed = ArtistVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid artist vault data" });
    return;
  }
  const d = parsed.data;

  await db
    .update(artistVaultsTable)
    .set({
      artist_name: d.artistName,
      artist_type: d.artistType ?? null,
      genre: d.genre ?? null,
      voice_style: d.voiceStyle ?? null,
      visual_style: d.visualStyle ?? null,
      hair: d.hair ?? null,
      tattoos: d.tattoos ?? null,
      jewelry: d.jewelry ?? null,
      clothing_style: d.clothingStyle ?? null,
      brand_colors: d.brandColors ?? null,
      personality: d.personality ?? null,
      do_not_change_rules: d.doNotChangeRules ?? null,
      reference_image_url: d.referenceImageUrl ?? null,
      reference_image_path: d.referenceImagePath ?? null,
      consistency_prompt: d.consistencyPrompt ?? null,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
      ),
    );

  res.json({ success: true });
});

router.patch("/artist-vaults/:id/set-active", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);

  await db
    .update(artistVaultsTable)
    .set({ is_active: false })
    .where(eq(artistVaultsTable.user_id, req.userId!));

  await db
    .update(artistVaultsTable)
    .set({ is_active: true })
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
      ),
    );

  res.json({ success: true });
});

router.delete("/artist-vaults/:id", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);

  await db
    .delete(artistVaultsTable)
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
      ),
    );

  res.json({ success: true });
});

export default router;
