import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";

const router = Router();

const ArtistVaultSchema = z.object({
  artistName: z.string().min(1),
  artistType: z.string().optional().nullable(),
  artistDescription: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  visualStyle: z.string().optional().nullable(),
  hair: z.string().optional().nullable(),
  tattoos: z.string().optional().nullable(),
  jewelry: z.string().optional().nullable(),
  clothingStyle: z.string().optional().nullable(),
  brandColors: z.string().optional().nullable(),
  logoDescription: z.string().optional().nullable(),
  imageReferenceNotes: z.string().optional().nullable(),
  doNotChangeRules: z.string().optional().nullable(),
  specialStyleRules: z.string().optional().nullable(),
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
      artist_description: d.artistDescription ?? null,
      genre: d.genre ?? null,
      visual_style: d.visualStyle ?? null,
      hair: d.hair ?? null,
      tattoos: d.tattoos ?? null,
      jewelry: d.jewelry ?? null,
      clothing_style: d.clothingStyle ?? null,
      brand_colors: d.brandColors ?? null,
      logo_description: d.logoDescription ?? null,
      image_reference_notes: d.imageReferenceNotes ?? null,
      do_not_change_rules: d.doNotChangeRules ?? null,
      special_style_rules: d.specialStyleRules ?? null,
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
      artist_description: d.artistDescription ?? null,
      genre: d.genre ?? null,
      visual_style: d.visualStyle ?? null,
      hair: d.hair ?? null,
      tattoos: d.tattoos ?? null,
      jewelry: d.jewelry ?? null,
      clothing_style: d.clothingStyle ?? null,
      brand_colors: d.brandColors ?? null,
      logo_description: d.logoDescription ?? null,
      image_reference_notes: d.imageReferenceNotes ?? null,
      do_not_change_rules: d.doNotChangeRules ?? null,
      special_style_rules: d.specialStyleRules ?? null,
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
