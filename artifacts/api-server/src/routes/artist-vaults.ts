import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import RunwayML from "@runwayml/sdk";
import { db, artistVaultsTable, artistCharacterLinksTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../lib/credits";
import { SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT } from "./generate/clip-pricing";

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

/* ── Character reference video (paid) ────────────────────────────────────
 * Generates a 5s "living portrait" video from the character's reference photo
 * via Seedance 2.5 image-to-video. Credits are charged only on SUCCEEDED.
 * When set, character selection shows the autoplaying video instead of the photo. */

const REF_VIDEO_DURATION_SEC = 5;
const REF_VIDEO_CREDITS =
  REF_VIDEO_DURATION_SEC * SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT; // 15

const refVideoTasks = new Map<
  string,
  { userId: string; vaultId: string; credits: number }
>();

/** Submit a reference-video generation for a character. */
router.post("/artist-vaults/:id/reference-video", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);

  const [vault] = await db
    .select({
      id: artistVaultsTable.id,
      artist_name: artistVaultsTable.artist_name,
      reference_image_url: artistVaultsTable.reference_image_url,
    })
    .from(artistVaultsTable)
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
      ),
    );
  if (!vault) {
    res.status(404).json({ error: "Character not found" });
    return;
  }

  const photoUrl = vault.reference_image_url?.trim();
  if (!photoUrl || !/^https:\/\//i.test(photoUrl)) {
    res.status(400).json({
      error: "Add a reference photo for this character first — the video is generated from it.",
    });
    return;
  }

  /* Credit check before submitting. */
  const { data: profile } = await req.userSupabase!
    .from("profiles")
    .select("credits")
    .eq("id", req.userId!)
    .single();
  const credits: number = (profile as { credits?: number } | null)?.credits ?? 0;
  if (credits < REF_VIDEO_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Not enough credits. A character video costs ${REF_VIDEO_CREDITS} credits.`,
      required: REF_VIDEO_CREDITS,
      balance: credits,
    });
    return;
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Video generation is not configured on the server" });
    return;
  }

  try {
    const client = new RunwayML({ apiKey });
    const prompt =
      `Living portrait of ${vault.artist_name || "this character"}: subtle idle motion, ` +
      `gentle breathing, slight natural head movement and slow blink, cinematic soft light. ` +
      `Keep the face, hairstyle, clothing and overall appearance exactly as in the reference photo — ` +
      `no new elements, no camera cuts.`;
    const task = await client.imageToVideo.create({
      model: "seedance2_5",
      promptImage: photoUrl,
      promptText: prompt,
      duration: REF_VIDEO_DURATION_SEC,
      ratio: "720:1280",
      audio: false,
    });

    refVideoTasks.set(task.id, {
      userId: req.userId!,
      vaultId: id,
      credits: REF_VIDEO_CREDITS,
    });
    req.log.info({ taskId: task.id, vaultId: id }, "[ref-video] task submitted — credits pending on SUCCEEDED");
    res.json({ taskId: task.id, creditCost: REF_VIDEO_CREDITS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err: msg }, "[ref-video] submission failed — no credits charged");
    res.status(502).json({ error: "Video generation failed to start. No credits were charged." });
  }
});

/** Poll a reference-video task. On SUCCEEDED: charge credits + save to the vault. */
router.get("/artist-vaults/:id/reference-video/:taskId", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const taskId = String(req.params["taskId"]);

  const pending = refVideoTasks.get(taskId);
  if (!pending || pending.userId !== req.userId || pending.vaultId !== id) {
    res.status(404).json({ error: "Unknown video task" });
    return;
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Video generation is not configured on the server" });
    return;
  }

  try {
    const client = new RunwayML({ apiKey });
    const task = await client.tasks.retrieve(taskId);

    if (task.status === "SUCCEEDED") {
      const videoUrl = (task.output as string[] | undefined)?.[0] ?? null;
      refVideoTasks.delete(taskId);
      if (!videoUrl) {
        res.json({ status: "succeeded", url: null });
        return;
      }
      /* Charge credits (once — guarded by pendingTasks presence). */
      try {
        await chargeCreditsAtomic(req.userId!, pending.credits, {
          action: "Character Reference Video",
          projectId: null,
        });
      } catch (e) {
        if (e instanceof LedgerWriteError) {
          req.log.error({ taskId, err: e.message }, "[ref-video] ledger write failed after charge");
        } else {
          throw e;
        }
      }
      /* Save to the vault. */
      await db
        .update(artistVaultsTable)
        .set({ reference_video_url: videoUrl, updated_at: new Date() })
        .where(
          and(
            eq(artistVaultsTable.id, id),
            eq(artistVaultsTable.user_id, req.userId!),
          ),
        );
      res.json({ status: "succeeded", url: videoUrl });
      return;
    }

    if (task.status === "FAILED" || task.status === "CANCELLED") {
      refVideoTasks.delete(taskId);
      res.json({ status: "failed" });
      return;
    }

    res.json({ status: "processing" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ taskId, err: msg }, "[ref-video] poll failed");
    res.status(502).json({ error: "Could not check video status" });
  }
});

/** Remove a character's reference video (keeps the photo). */
router.delete("/artist-vaults/:id/reference-video", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  await db
    .update(artistVaultsTable)
    .set({ reference_video_url: null, reference_video_path: null, updated_at: new Date() })
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
      ),
    );
  res.json({ success: true });
});

export default router;
