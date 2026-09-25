import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import { markGenerationHistorySaved, markGenerationHistoryRefunded } from "../lib/payment-record";
import { refundCredits } from "../lib/credits";
import { db, generatedClipsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { refreshSupabaseStorageUrlsDeep, normalizeToStorageRef } from "../lib/objectStorage";
import { getSupabaseAdmin } from "../lib/supabase-admin";
/* TEMPORARY (2026-09-22): clip recovery via Replit backend — REMOVE AFTER USE */
import { recoverExpiredClipsViaReplit } from "../lib/clipRecovery";

const router = Router();

const SaveProjectSchema = z.object({
  projectType:  z.string().min(1),
  title:        z.string().min(1),
  artistName:   z.string().optional().nullable(),
  songTitle:    z.string().optional().nullable(),
  genre:        z.string().optional().nullable(),
  mood:         z.string().optional().nullable(),
  inputData:    z.record(z.string(), z.unknown()).optional().default({}),
  outputData:   z.record(z.string(), z.unknown()).optional().default({}),
  creditsUsed:  z.number().int().min(0).optional().default(0),
  genHistoryId: z.string().uuid().optional().nullable(),
});

router.post("/projects", requireAuth, async (req, res) => {
  const parsed = SaveProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project data" });
    return;
  }
  const d = parsed.data;

  const { data: project, error } = await req.userSupabase!
    .from("projects")
    .insert({
      user_id:      req.userId,
      project_type: d.projectType,
      title:        d.title,
      artist_name:  d.artistName ?? null,
      song_title:   d.songTitle  ?? null,
      genre:        d.genre      ?? null,
      mood:         d.mood       ?? null,
      input_data:   d.inputData,
      output_data:  d.outputData,
      credits_used: d.creditsUsed,
    })
    .select("id")
    .single();

  if (error) {
    // Attempt to refund credits. Read fresh profile credits — req.userCredits is stale
    // (set before the generate route ran its own deduction).
    let refunded = false;
    if (d.genHistoryId) {
      const refundedAmount = await markGenerationHistoryRefunded(d.genHistoryId).catch(() => 0);
      if (refundedAmount > 0) {
        try {
          // refundCredits(): restores the balance and writes a negative ledger
          // entry. A ledger failure is logged loudly (money is already back —
          // reporting gap, not a loss).
          await refundCredits(req.userId!, refundedAmount, {
            action: "Refund — project save failed",
          });
          refunded = true;
        } catch { /* non-fatal — user can contact support */ }
      }
    }
    res.status(500).json({ error: error.message, refunded });
    return;
  }

  if (d.genHistoryId && project?.id) {
    markGenerationHistorySaved(d.genHistoryId, project.id).catch(() => {});
  }

  res.status(201).json({ id: project?.id });
});

router.get("/projects", requireAuth, async (req, res) => {
  const { data: projects, error } = await req.userSupabase!
    .from("projects")
    .select("id, project_type, title, artist_name, song_title, genre, mood, input_data, output_data, credits_used, created_at")
    .eq("user_id", req.userId)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  /* Stored clip URLs may be storage refs — re-sign fresh on every read; legacy URLs pass through. */
  const refreshedProjects = await Promise.all(
    (projects ?? []).map(async (project) => ({
      ...project,
      output_data: await refreshSupabaseStorageUrlsDeep(project.output_data),
    })),
  );

  res.json({ projects: refreshedProjects });
});

router.get("/projects/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: project, error } = await req.userSupabase!
    .from("projects")
    .select("id, project_type, title, artist_name, song_title, genre, mood, input_data, output_data, credits_used, created_at")
    .eq("id", id)
    .eq("user_id", req.userId)
    .single();

  if (error || !project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  /* Stored clip URLs may be storage refs — re-sign fresh on every read; legacy URLs pass through. */
  project.output_data = await refreshSupabaseStorageUrlsDeep(project.output_data);

  res.json({ project });
});

router.patch("/projects/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const body = req.body as { scenes?: unknown[]; outputData?: Record<string, unknown> };

  const { data: existing, error: fetchErr } = await req.userSupabase!
    .from("projects")
    .select("id, user_id, project_type, title, artist_name, song_title, genre, mood, style, platform, input_data, output_data, credits_used, created_at")
    .eq("id", id)
    .eq("user_id", req.userId)
    .single();

  if (fetchErr || !existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const current = (existing.output_data as Record<string, unknown>) ?? {};
  const updatedOutputData: Record<string, unknown> = {
    ...current,
    ...(body.outputData ?? {}),
    ...(body.scenes !== undefined ? { scenes: body.scenes } : {}),
  };

  /* Update output_data in place. Previously this did a delete-then-insert, which could
   * permanently lose the project if the insert failed (or if two saves raced) between the
   * delete and the re-insert — a plain UPDATE is atomic and can never drop the row.
   *
   * NOTE: the projects table's RLS UPDATE policy is broken/missing (updates via the
   * user-scoped client silently no-op with 0 rows affected, no error). Ownership was
   * already verified above via the RLS-protected SELECT, so it's safe to use the
   * service-role client here — we still scope by both id and user_id explicitly. */
  const { error: updErr } = await getSupabaseAdmin()
    .from("projects")
    .update({ output_data: updatedOutputData })
    .eq("id", id)
    .eq("user_id", req.userId);

  if (updErr) {
    res.status(500).json({ error: updErr.message });
    return;
  }

  res.json({ success: true });
});

/* ─────────────────────────────────────────────────────────────────────────────
   PATCH /api/projects/:projectId/scene-clip
   Attach an already-generated clip to a specific scene without charging credits.
   Matches scene by: sceneId (preferred) → sceneNumber (numeric) → section title.
   If clipId is provided, looks up the generated_clips record for thumbnail/jobId.
   Updates: demoClipUrl, thumbnailUrl, clipId, runwayJobId, generationStatus, provider.
───────────────────────────────────────────────────────────────────────────── */
router.patch("/projects/:projectId/scene-clip", requireAuth, async (req, res) => {
  const { projectId } = req.params as { projectId: string };
  const body = req.body as {
    clipUrl?: string;
    clipId?: string | null;
    sceneId?: string | null;
    sceneNumber?: number | null;
    sceneTitle?: string | null;
  };

  /* ── Optionally look up the generated_clips record for extra metadata ── */
  let resolvedClipUrl = body.clipUrl ?? null;
  let thumbnailUrl: string | null = null;
  let runwayJobId: string | null = null;

  if (body.clipId) {
    try {
      const [clipRow] = await db
        .select()
        .from(generatedClipsTable)
        .where(
          and(
            eq(generatedClipsTable.id, body.clipId),
            eq(generatedClipsTable.user_id, req.userId!),
          ),
        )
        .limit(1);
      if (clipRow) {
        resolvedClipUrl  = resolvedClipUrl ?? clipRow.video_url ?? null;
        thumbnailUrl     = clipRow.thumbnail_url ?? null;
        runwayJobId      = clipRow.runway_job_id ?? null;
      }
    } catch { /* non-fatal — proceed with whatever clipUrl was passed */ }
  }

  if (!resolvedClipUrl) {
    res.status(400).json({ error: "clipUrl is required (or provide a valid clipId)" });
    return;
  }

  /* Persist the stable storage ref when the URL points at our Supabase
     bucket (e.g. the 1-day preview URL from the generate poll) — readers
     re-sign fresh URLs from it on every read. */
  resolvedClipUrl = normalizeToStorageRef(resolvedClipUrl) ?? resolvedClipUrl;

  /* ── Fetch project ── */
  const { data: existing, error: fetchErr } = await req.userSupabase!
    .from("projects")
    .select("id, user_id, project_type, title, artist_name, song_title, genre, mood, style, platform, input_data, output_data, credits_used, created_at")
    .eq("id", projectId)
    .eq("user_id", req.userId)
    .single();

  if (fetchErr || !existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const outputData = (existing.output_data as Record<string, unknown>) ?? {};
  const scenes = (outputData["scenes"] as Record<string, unknown>[] | undefined) ?? [];

  if (scenes.length === 0) {
    res.status(422).json({ error: "This project has no scenes. Open the Video Editor and load or rebuild scenes first, then try again." });
    return;
  }

  /* ── Find matching scene ── */
  let matchIdx = -1;

  /* 1. Exact scene UUID match */
  if (body.sceneId) {
    matchIdx = scenes.findIndex((s) => s["id"] === body.sceneId);
  }
  /* 2. Scene number — coerce both sides to Number to survive JSON string/number mismatch */
  if (matchIdx === -1 && body.sceneNumber != null) {
    const wantNum = Number(body.sceneNumber);
    matchIdx = scenes.findIndex((s) => Number(s["sceneNumber"]) === wantNum);
  }
  /* 3. Section / title substring (case-insensitive) */
  if (matchIdx === -1 && body.sceneTitle) {
    const lower = body.sceneTitle.toLowerCase();
    matchIdx = scenes.findIndex(
      (s) =>
        String(s["section"] ?? "").toLowerCase().includes(lower) ||
        String(s["timestamp"] ?? "").toLowerCase().includes(lower),
    );
  }
  /* 4. "Outro" keyword fallback — last scene if section contains outro */
  if (matchIdx === -1) {
    const lastOutroIdx = [...scenes].map((s, i) => ({ s, i })).reverse()
      .find(({ s }) => /outro|closing|final/i.test(String(s["section"] ?? "")));
    if (lastOutroIdx) matchIdx = lastOutroIdx.i;
  }

  if (matchIdx === -1) {
    res.status(422).json({
      error: `No matching scene found. Tried sceneId=${body.sceneId ?? "—"}, sceneNumber=${body.sceneNumber ?? "—"}, sceneTitle=${body.sceneTitle ?? "—"}. Select the scene manually and try again.`,
    });
    return;
  }

  /* ── Patch the scene in the array ── */
  const updatedScenes = scenes.map((scene, i) => {
    if (i !== matchIdx) return scene;
    return {
      ...scene,
      demoClipUrl:      resolvedClipUrl,
      thumbnailUrl:     thumbnailUrl ?? scene["thumbnailUrl"] ?? null,
      clipId:           body.clipId ?? scene["clipId"] ?? null,
      runwayJobId:      runwayJobId ?? scene["runwayJobId"] ?? null,
      generationStatus: "completed",
      provider:         "Runway",
      generatedAt:      new Date().toISOString(),
    };
  });

  const updatedOutputData: Record<string, unknown> = {
    ...outputData,
    scenes: updatedScenes,
  };

  const matchedScene = scenes[matchIdx] as Record<string, unknown>;
  req.log.info(
    { projectId, userId: req.userId, sceneId: matchedScene["id"], section: matchedScene["section"] },
    "[projects] attaching clip to scene (no credits charged)",
  );

  /* ── Persist (delete + reinsert) ── */
  const { error: delErr } = await req.userSupabase!
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", req.userId);

  if (delErr) {
    res.status(500).json({ error: delErr.message });
    return;
  }

  const { error: insErr } = await req.userSupabase!
    .from("projects")
    .insert({
      id:           existing.id,
      user_id:      existing.user_id,
      project_type: existing.project_type,
      title:        existing.title,
      artist_name:  existing.artist_name,
      song_title:   existing.song_title,
      genre:        existing.genre,
      mood:         existing.mood,
      style:        (existing as Record<string, unknown>)["style"] ?? null,
      platform:     (existing as Record<string, unknown>)["platform"] ?? null,
      input_data:   existing.input_data,
      output_data:  updatedOutputData,
      credits_used: existing.credits_used,
      created_at:   existing.created_at,
    });

  if (insErr) {
    /* Restore original on failure — ignore restore errors */
    try { await req.userSupabase!.from("projects").insert(existing); } catch { /* non-fatal */ }
    res.status(500).json({ error: insErr.message });
    return;
  }

  res.json({
    success: true,
    scene: {
      index:     matchIdx + 1,
      section:   matchedScene["section"] ?? null,
      timestamp: matchedScene["timestamp"] ?? null,
    },
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/projects/:projectId/sync-clips
   Scan generated_clips for this project, match each completed clip to a scene
   that has no demoClipUrl, and batch-attach all matches.  No credits charged.
   Returns: { synced: N, skipped: N, scenes: updatedScenesArray }
───────────────────────────────────────────────────────────────────────────── */
router.post("/projects/:projectId/sync-clips", requireAuth, async (req, res) => {
  const { projectId } = req.params as { projectId: string };

  /* ── Fetch project ── */
  const { data: existing, error: fetchErr } = await req.userSupabase!
    .from("projects")
    .select("id, user_id, project_type, title, artist_name, song_title, genre, mood, style, platform, input_data, output_data, credits_used, created_at")
    .eq("id", projectId)
    .eq("user_id", req.userId)
    .single();

  if (fetchErr || !existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const outputData = (existing.output_data as Record<string, unknown>) ?? {};
  let scenes = (outputData["scenes"] as Record<string, unknown>[] | undefined) ?? [];

  if (scenes.length === 0) {
    res.status(422).json({ error: "No scenes found in this project. Open the Video Editor and load scenes first." });
    return;
  }

  /* ── TEMPORARY RECOVERY (2026-09-22, REMOVE AFTER USE) ──
     Recover clips whose Replit-GCS signed URLs expired (2026-07-14): pull
     fresh URLs from the still-running Replit backend, download the videos,
     and re-host them in Supabase Storage so playback works permanently.
     Runs FIRST, on the raw stored scenes, before the generated_clips check. */
  const preRecoveryScenes = scenes;
  scenes = await recoverExpiredClipsViaReplit(
    req.accessToken!,
    projectId,
    scenes,
  );
  const recoveredCount = scenes.filter(
    (s, i) => s["demoClipUrl"] !== preRecoveryScenes[i]?.["demoClipUrl"],
  ).length;

  /* ── Fetch completed clips for this project from generated_clips ── */
  const clips = await db
    .select()
    .from(generatedClipsTable)
    .where(
      and(
        eq(generatedClipsTable.user_id, req.userId!),
        eq(generatedClipsTable.project_id, projectId),
      ),
    )
    .orderBy(desc(generatedClipsTable.created_at));

  const completedClips = clips.filter((c) => c.video_url && c.status !== "failed");

  if (completedClips.length === 0) {
    /* TEMPORARY (2026-09-22): persist recovered scenes even when sync finds
       nothing — REMOVE AFTER USE */
    if (recoveredCount > 0) {
      const recoveredOutputData: Record<string, unknown> = { ...outputData, scenes };
      const { error: recDelErr } = await req.userSupabase!
        .from("projects")
        .delete()
        .eq("id", projectId)
        .eq("user_id", req.userId);
      if (!recDelErr) {
        const { error: recInsErr } = await req.userSupabase!.from("projects").insert({
          id:           existing.id,
          user_id:      existing.user_id,
          project_type: existing.project_type,
          title:        existing.title,
          artist_name:  existing.artist_name,
          song_title:   existing.song_title,
          genre:        existing.genre,
          mood:         existing.mood,
          style:        (existing as Record<string, unknown>)["style"] ?? null,
          platform:     (existing as Record<string, unknown>)["platform"] ?? null,
          input_data:   existing.input_data,
          output_data:  recoveredOutputData,
          credits_used: existing.credits_used,
          created_at:   existing.created_at,
        });
        if (recInsErr) {
          res.status(500).json({ error: `Recovery persist failed: ${recInsErr.message}` });
          return;
        }
      }
    }
    res.json({
      synced: 0,
      skipped: scenes.length,
      recovered: recoveredCount,
      scenes,
      message: recoveredCount > 0
        ? `Recovered ${recoveredCount} clip${recoveredCount !== 1 ? "s" : ""}.`
        : "No completed clips found for this project.",
    });
    return;
  }

  /* ── Match each clip to an unattached scene ── */
  /* Track which clips have been used to avoid double-attachment */
  const usedClipIds = new Set<string>();

  let synced = 0;
  const updatedScenes = scenes.map((scene) => {
    /* Skip scenes that already have a clip */
    if (scene["demoClipUrl"]) return scene;

    const sceneId     = scene["id"]           as string | undefined;
    const sceneNum    = Number(scene["sceneNumber"] ?? 0);
    const section     = String(scene["section"] ?? "").toLowerCase().trim();

    /* Find the best unused clip for this scene */
    const matchedClip = completedClips.find((clip) => {
      if (usedClipIds.has(clip.id)) return false;
      /* 1. Exact scene_id recorded when clip was generated */
      if (clip.scene_id && sceneId && clip.scene_id === sceneId) return true;
      /* 2. Scene number in clip title ("Scene 5") */
      const titleMatch = clip.title?.match(/scene\s*(\d+)/i);
      if (titleMatch && Number(titleMatch[1]) === sceneNum) return true;
      /* 3. Section keyword in clip title or prompt ("Outro", "Verse 1", …) */
      if (section.length > 2) {
        if (clip.title?.toLowerCase().includes(section)) return true;
        if (clip.prompt?.toLowerCase().includes(section)) return true;
      }
      return false;
    });

    if (!matchedClip) return scene;

    usedClipIds.add(matchedClip.id);
    synced++;
    return {
      ...scene,
      demoClipUrl:      matchedClip.video_url,
      thumbnailUrl:     matchedClip.thumbnail_url ?? null,
      clipId:           matchedClip.id,
      runwayJobId:      matchedClip.runway_job_id ?? null,
      generationStatus: "completed",
      provider:         "Runway",
      generatedAt:      matchedClip.created_at
        ? new Date(matchedClip.created_at).toISOString()
        : new Date().toISOString(),
    };
  });

  if (synced === 0) {
    res.json({ synced: 0, skipped: scenes.length, message: "No matching clips found for unattached scenes." });
    return;
  }

  /* ── Persist updated project (delete + reinsert) ── */
  const updatedOutputData: Record<string, unknown> = { ...outputData, scenes: updatedScenes };

  const { error: delErr } = await req.userSupabase!
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", req.userId);

  if (delErr) {
    res.status(500).json({ error: delErr.message });
    return;
  }

  const { error: insErr } = await req.userSupabase!
    .from("projects")
    .insert({
      id:           existing.id,
      user_id:      existing.user_id,
      project_type: existing.project_type,
      title:        existing.title,
      artist_name:  existing.artist_name,
      song_title:   existing.song_title,
      genre:        existing.genre,
      mood:         existing.mood,
      style:        (existing as Record<string, unknown>)["style"] ?? null,
      platform:     (existing as Record<string, unknown>)["platform"] ?? null,
      input_data:   existing.input_data,
      output_data:  updatedOutputData,
      credits_used: existing.credits_used,
      created_at:   existing.created_at,
    });

  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }

  req.log.info(
    { projectId, userId: req.userId, synced, total: scenes.length, recoveredCount },
    "[projects] sync-clips completed",
  );

  res.json({
    synced,
    skipped: scenes.length - synced,
    /* TEMPORARY (2026-09-22): recovery count — REMOVE AFTER USE */
    recovered: recoveredCount,
    scenes: updatedScenes,
  });
});

router.delete("/projects/:id", requireAuth, async (req, res) => {
  const { id } = req.params;

  const { error } = await req.userSupabase!
    .from("projects")
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
