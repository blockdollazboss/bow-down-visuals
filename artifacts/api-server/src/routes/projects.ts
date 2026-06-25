import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import { markGenerationHistorySaved, markGenerationHistoryRefunded, recordCreditUsage } from "../lib/payment-record";

const router = Router();

const SaveProjectSchema = z.object({
  projectType:  z.string().min(1),
  title:        z.string().min(1),
  artistName:   z.string().optional().nullable(),
  songTitle:    z.string().optional().nullable(),
  genre:        z.string().optional().nullable(),
  mood:         z.string().optional().nullable(),
  inputData:    z.record(z.unknown()).optional().default({}),
  outputData:   z.record(z.unknown()).optional().default({}),
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
          const { data: freshProfile } = await req.userSupabase!
            .from("profiles").select("credits").eq("id", req.userId!).single();
          const currentCredits = (freshProfile?.credits as number | null) ?? 0;
          await req.userSupabase!.from("profiles")
            .update({ credits: currentCredits + refundedAmount })
            .eq("id", req.userId!);
          recordCreditUsage({
            userId:      req.userId!,
            action:      "Refund — project save failed",
            creditsUsed: -refundedAmount,
          }).catch(() => {});
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

  res.json({ projects: projects ?? [] });
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

  const { error: delErr } = await req.userSupabase!
    .from("projects")
    .delete()
    .eq("id", id)
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
      style:        existing.style ?? null,
      platform:     existing.platform ?? null,
      input_data:   existing.input_data,
      output_data:  updatedOutputData,
      credits_used: existing.credits_used,
      created_at:   existing.created_at,
    });

  if (insErr) {
    await req.userSupabase!.from("projects").insert(existing);
    res.status(500).json({ error: insErr.message });
    return;
  }

  res.json({ success: true });
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
