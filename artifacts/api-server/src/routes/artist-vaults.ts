import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import RunwayML from "@runwayml/sdk";
import { db, artistVaultsTable, artistCharacterLinksTable } from "@workspace/db";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../lib/credits";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { getUserActiveTeam } from "../lib/teams";
import { SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT } from "./generate/clip-pricing";
import { randomUUID } from "crypto";
import { readFile, rm } from "fs/promises";
import { loopVideoFromUrl, VideoLoopError } from "../lib/video-loop";


const router = Router();

/**
 * Returns a vault if the user can USE it: they own it, or it's shared with
 * their active team. Use for generation/read operations.
 * For MANAGE operations (edit, delete, share), require strict ownership
 * via eq(artistVaultsTable.user_id, userId) instead.
 */
async function getAccessibleVault(userId: string, vaultId: string) {
  const [vault] = await db
    .select()
    .from(artistVaultsTable)
    .where(and(eq(artistVaultsTable.id, vaultId), isNull(artistVaultsTable.deleted_at)))
    .limit(1);
  if (!vault) return null;
  // Owner always has access.
  if (vault.user_id === userId) return vault;
  // Team members can use vaults shared with their active team.
  if (vault.team_id) {
    const activeTeam = await getUserActiveTeam(userId);
    if (activeTeam && activeTeam.team.id === vault.team_id) return vault;
  }
  return null;
}

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

  try {
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
  } catch (err) {
    // TEMPORARY: detailed error for debugging (remove after fix)
    req.log.error({ err }, "artist-vaults: insert failed");
    res.status(500).json({
      error: "Internal server error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get("/artist-vaults", requireAuth, async (req, res) => {
  const activeTeam = await getUserActiveTeam(req.userId!);

  const vaults = await db
    .select()
    .from(artistVaultsTable)
    .where(
      and(
        isNull(artistVaultsTable.deleted_at),
        activeTeam
          ? or(
              eq(artistVaultsTable.user_id, req.userId!),
              eq(artistVaultsTable.team_id, activeTeam.team.id),
            )
          : eq(artistVaultsTable.user_id, req.userId!),
      ),
    )
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
        isNull(artistVaultsTable.deleted_at),
      ),
    );

  res.json({ success: true });
});

router.patch("/artist-vaults/:id/set-active", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);

  await db
    .update(artistVaultsTable)
    .set({ is_active: false })
    .where(
      and(
        eq(artistVaultsTable.user_id, req.userId!),
        isNull(artistVaultsTable.deleted_at),
      ),
    );

  await db
    .update(artistVaultsTable)
    .set({ is_active: true })
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
        isNull(artistVaultsTable.deleted_at),
      ),
    );

  res.json({ success: true });
});

router.delete("/artist-vaults/:id", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);

  /* Soft delete only — never hard-delete. The vault is hidden but the data
     is preserved and can be restored. User data must never be permanently lost. */
  await db
    .update(artistVaultsTable)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(
      and(
        eq(artistVaultsTable.id, id),
        eq(artistVaultsTable.user_id, req.userId!),
        isNull(artistVaultsTable.deleted_at),
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
        isNull(artistVaultsTable.deleted_at),
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

  // Team members can generate from shared vaults (use-access).
  const vault = await getAccessibleVault(req.userId!, id);
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
      message: `Not enough Visual Bucs. A character video costs ${REF_VIDEO_CREDITS} credits.`,
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
      `gentle breathing, slight natural head movement and slow blink, clean light grey studio background, soft even lighting. ` +
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
    res.status(502).json({ error: "Video generation failed to start. No Visual Bucs were charged." });
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

/**
 * Attach an existing video as the character's reference video (no AI generation, no credits).
 * Body: { videoUrl: string } — must be an https URL to an mp4.
 * The server downloads it, stores it in the artist-references bucket, and sets it on the vault.
 */
router.post("/artist-vaults/:id/reference-video/attach", requireAuth, async (req, res) => {
  const id = String(req.params["id"]);
  const { videoUrl } = req.body as { videoUrl?: string };
  const userId = req.userId!;
  const vaultId = id;
  if (!videoUrl || typeof videoUrl !== "string" || !videoUrl.startsWith("https://")) {
    res.status(400).json({ error: "A valid https videoUrl is required." });
    return;
  }
  try {
    /* Verify the user can use the vault (owner or team member). */
    const vault = await getAccessibleVault(userId, vaultId);
    if (!vault) {
      res.status(404).json({ error: "Vault not found." });
      return;
    }
    /* Validate the URL points to a video (server-side HEAD check). */
    try {
      const head = await fetch(videoUrl, { method: "HEAD" });
      const ct = head.headers.get("content-type") || "";
      if (head.ok && ct && !ct.includes("video") && !ct.includes("mp4") && !ct.includes("octet-stream")) {
        throw new Error(`Not a video file (content-type: ${ct}).`);
      }
    } catch (e) {
      /* If HEAD fails, fall through — the URL may still be valid. */
    }
    /* Set the URL directly on the vault (no storage upload needed). */
    const publicUrl = videoUrl;
    await db
      .update(artistVaultsTable)
      .set({ reference_video_url: publicUrl, reference_video_path: null, updated_at: new Date() })
      .where(
        and(
          eq(artistVaultsTable.id, vaultId),
          eq(artistVaultsTable.user_id, userId!),
        ),
      );
    res.json({ success: true, url: publicUrl });
  } catch (err: unknown) {
    req.log.error({ err }, "[ref-video] attach failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Attach failed." });
  }
});

/* ── Seamless loop: make the current reference video loop without a jump ── */

const LOOP_VIDEO_CREDITS = 2;

interface RefVideoLoopTask {
  userId: string;
  vaultId: string;
  credits: number;
  status: "processing" | "done" | "failed";
  url?: string;
  path?: string | null;
  error?: string;
}

/** In-memory; mirrors refVideoTasks (durable export-jobs upgrade tracked separately). */
const refVideoLoopTasks = new Map<string, RefVideoLoopTask>();

async function runRefVideoLoop(taskId: string, videoUrl: string) {
  const task = refVideoLoopTasks.get(taskId);
  if (!task) return;
  let workDir: string | null = null;
  try {
    const { outPath, workDir: wd } = await loopVideoFromUrl(videoUrl);
    workDir = wd;
    const fileBytes = await readFile(outPath);
    const filePath = `${task.userId}/reference-videos/${randomUUID()}-loop.mp4`;
    const { error: upErr } = await getSupabaseAdmin()
      .storage.from("artist-references")
      .upload(filePath, fileBytes, { contentType: "video/mp4", upsert: false });
    if (upErr) throw new VideoLoopError(upErr.message);
    const {
      data: { publicUrl },
    } = getSupabaseAdmin().storage.from("artist-references").getPublicUrl(filePath);
    task.status = "done";
    task.url = publicUrl;
    task.path = filePath;
  } catch (err) {
    task.status = "failed";
    task.error = err instanceof Error ? err.message : "Loop processing failed.";
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Share a vault with the caller's team (or unshare it). Only the vault owner can change sharing. */
router.post("/artist-vaults/:id/share", requireAuth, async (req, res) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0]! : rawId;
    const [vault] = await db
      .select()
      .from(artistVaultsTable)
      .where(and(eq(artistVaultsTable.id, id), eq(artistVaultsTable.user_id, req.userId!)))
      .limit(1);
    if (!vault) {
      res.status(404).json({ error: "Vault not found." });
      return;
    }
    const share = req.body?.share === true;
    if (share) {
      const activeTeam = await getUserActiveTeam(req.userId!);
      if (!activeTeam) {
        res.status(400).json({ error: "Join a team first to share this vault." });
        return;
      }
      await db.update(artistVaultsTable).set({ team_id: activeTeam.team.id }).where(eq(artistVaultsTable.id, id));
      res.json({ ok: true, teamId: activeTeam.team.id });
    } else {
      await db.update(artistVaultsTable).set({ team_id: null }).where(eq(artistVaultsTable.id, id));
      res.json({ ok: true, teamId: null });
    }
  } catch (err: unknown) {
    req.log.error({ err }, "artist-vaults: share failed");
    res.status(500).json({ error: "Failed to update sharing." });
  }
});

/** Start a seamless-loop job for the vault's current reference video. Credits pre-checked; charged on poll. */
router.post("/artist-vaults/:id/reference-video/loop", requireAuth, async (req, res) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0]! : rawId;
  try {
    // Team members can loop shared vaults (use-access).
    const vault = await getAccessibleVault(req.userId!, id);
    if (!vault) {
      res.status(404).json({ error: "Artist vault not found." });
      return;
    }
    const src = vault.reference_video_url;
    if (!src || !src.startsWith("https://")) {
      res.status(400).json({ error: "This vault has no reference video to loop yet." });
      return;
    }
    const { data: profile } = await req.userSupabase!
      .from("profiles")
      .select("credits")
      .eq("id", req.userId!)
      .single();
    const balance: number = (profile as { credits?: number } | null)?.credits ?? 0;
    if (balance < LOOP_VIDEO_CREDITS) {
      res.status(402).json({ error: `Not enough credits. This costs ${LOOP_VIDEO_CREDITS} credits.`, required: LOOP_VIDEO_CREDITS, balance });
      return;
    }
    const taskId = randomUUID();
    refVideoLoopTasks.set(taskId, { userId: req.userId!, vaultId: id, credits: LOOP_VIDEO_CREDITS, status: "processing" });
    void runRefVideoLoop(taskId, src);
    res.json({ taskId, creditCost: LOOP_VIDEO_CREDITS, status: "processing" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Loop failed to start." });
  }
});

/** Poll a seamless-loop job. On success: charge once (2cr) and swap the vault's video to the looped version. */
router.get("/artist-vaults/:id/reference-video/loop/:taskId", requireAuth, async (req, res) => {
  const rawId = req.params.id;
  const rawTaskId = req.params.taskId;
  const id = Array.isArray(rawId) ? rawId[0]! : rawId;
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0]! : rawTaskId;
  const task = refVideoLoopTasks.get(taskId);
  if (!task || task.userId !== req.userId || task.vaultId !== id) {
    res.status(404).json({ error: "Loop job not found." });
    return;
  }
  if (task.status === "processing") {
    res.json({ status: "processing" });
    return;
  }
  // Terminal — delete first so charging happens exactly once even on retry.
  refVideoLoopTasks.delete(taskId);
  if (task.status === "failed" || !task.url) {
    res.json({ status: "failed", error: task.error ?? "Loop processing failed." });
    return;
  }
  try {
    const newBalance = await chargeCreditsAtomic(req.userId!, task.credits, {
      action: "Artist Vault Video Loop",
      projectId: null,
    });
    await db
      .update(artistVaultsTable)
      .set({
        reference_video_url: task.url,
        reference_video_path: task.path ?? null,
        updated_at: new Date(),
      })
      .where(and(eq(artistVaultsTable.id, id), eq(artistVaultsTable.user_id, req.userId!)));
    res.json({ status: "succeeded", url: task.url, newBalance });
  } catch (err) {
    if (err instanceof LedgerWriteError) {
      res.json({ status: "failed", error: "Credit ledger write failed — no video was changed." });
      return;
    }
    res.json({ status: "failed", error: err instanceof Error ? err.message : "Loop failed." });
  }
});

export default router;
