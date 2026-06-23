import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";

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

  const { data, error } = await req.userSupabase!
    .from("artist_vaults")
    .insert({
      user_id: req.userId,
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
    .select("id")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({ id: data?.id });
});

router.get("/artist-vaults", requireAuth, async (req, res) => {
  const { data: vaults, error } = await req.userSupabase!
    .from("artist_vaults")
    .select("*")
    .eq("user_id", req.userId)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ vaults: vaults ?? [] });
});

router.put("/artist-vaults/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const parsed = ArtistVaultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid artist vault data" });
    return;
  }
  const d = parsed.data;

  const { error } = await req.userSupabase!
    .from("artist_vaults")
    .update({
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", req.userId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true });
});

router.patch("/artist-vaults/:id/set-active", requireAuth, async (req, res) => {
  const { id } = req.params;

  await req.userSupabase!
    .from("artist_vaults")
    .update({ is_active: false })
    .eq("user_id", req.userId);

  const { error } = await req.userSupabase!
    .from("artist_vaults")
    .update({ is_active: true })
    .eq("id", id)
    .eq("user_id", req.userId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true });
});

router.delete("/artist-vaults/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  const { error } = await req.userSupabase!
    .from("artist_vaults")
    .delete()
    .eq("id", id)
    .eq("user_id", req.userId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true });
});

export default router;
