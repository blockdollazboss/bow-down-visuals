import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import { db, artistVaultsTable, artistCharacterLinksTable } from "@workspace/db";
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
  themeId: z.string().optional().nullable(),
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
      theme_id: d.themeId ?? "gold-royalty",
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
      theme_id: d.themeId ?? "gold-royalty",
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

/* ── Character links: let other characters star in this character's content ── */

const CharacterLinkSchema = z.object({
  linkedCharacterId: z.string().uuid(),
  role: z.string().min(1).max(40).optional().nullable(),
});

/** List characters linked to this character (co-stars), with their vault data. */
router.get("/artist-vaults/:id/links", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);

  // Verify ownership of the character
  const [owner] = await db
    .select({ id: artistVaultsTable.id })
    .from(artistVaultsTable)
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
      ),
    );
  if (!owner) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  const links = await db
    .select()
    .from(artistCharacterLinksTable)
    .where(
      and(
        eq(artistCharacterLinksTable.character_id, id),
        eq(artistCharacterLinksTable.user_id, req.userId!),
      ),
    )
    .orderBy(desc(artistCharacterLinksTable.created_at));

  // Attach the linked character's vault data
  const enriched = await Promise.all(
    links.map(async (link) => {
      const [vault] = await db
        .select()
        .from(artistVaultsTable)
        .where(eq(artistVaultsTable.id, link.linked_character_id));
      return { ...link, character: vault ?? null };
    }),
  );

  res.json({ links: enriched });
});

/** Link another character to star in this character's content. */
router.post("/artist-vaults/:id/links", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const parsed = CharacterLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid link data" });
    return;
  }
  const { linkedCharacterId, role } = parsed.data;

  if (linkedCharacterId === id) {
    res.status(400).json({ error: "A character cannot link to itself" });
    return;
  }

  // Both characters must belong to the user
  const owned = await db
    .select({ id: artistVaultsTable.id })
    .from(artistVaultsTable)
    .where(eq(artistVaultsTable.user_id, req.userId!));
  const ownedIds = new Set(owned.map((o) => o.id));
  if (!ownedIds.has(id) || !ownedIds.has(linkedCharacterId)) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  const [link] = await db
    .insert(artistCharacterLinksTable)
    .values({
      user_id: req.userId!,
      character_id: id,
      linked_character_id: linkedCharacterId,
      role: role || "collaborator",
    })
    .onConflictDoNothing({
      target: [
        artistCharacterLinksTable.character_id,
        artistCharacterLinksTable.linked_character_id,
      ],
    })
    .returning({ id: artistCharacterLinksTable.id });

  res.status(201).json({ id: link?.id ?? null, alreadyLinked: !link });
});

/** Remove a character link. */
router.delete("/artist-vaults/:id/links/:linkId", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const linkId = String(req.params["linkId"]);

  await db
    .delete(artistCharacterLinksTable)
    .where(
      and(
        eq(artistCharacterLinksTable.id, linkId),
        eq(artistCharacterLinksTable.character_id, id),
        eq(artistCharacterLinksTable.user_id, req.userId!),
      ),
    );

  res.json({ success: true });
});

export default router;
