import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";

const router = Router();

const SaveProjectSchema = z.object({
  projectType: z.string().min(1),
  title: z.string().min(1),
  artistName: z.string().optional().nullable(),
  songTitle: z.string().optional().nullable(),
  genre: z.string().optional().nullable(),
  mood: z.string().optional().nullable(),
  inputData: z.record(z.unknown()).optional().default({}),
  outputData: z.record(z.unknown()).optional().default({}),
  creditsUsed: z.number().int().min(0).optional().default(0),
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
      user_id: req.userId,
      project_type: d.projectType,
      title: d.title,
      artist_name: d.artistName ?? null,
      song_title: d.songTitle ?? null,
      genre: d.genre ?? null,
      mood: d.mood ?? null,
      input_data: d.inputData,
      output_data: d.outputData,
      credits_used: d.creditsUsed,
    })
    .select("id")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
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

router.patch("/projects/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const body = req.body as { scenes?: unknown[]; outputData?: Record<string, unknown> };

  const { data: existing, error: fetchErr } = await req.userSupabase!
    .from("projects")
    .select("output_data")
    .eq("id", id)
    .eq("user_id", req.userId)
    .single();

  if (fetchErr || !existing) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const current = (existing.output_data as Record<string, unknown>) ?? {};
  const updated: Record<string, unknown> = {
    ...current,
    ...(body.outputData ?? {}),
    ...(body.scenes !== undefined ? { scenes: body.scenes } : {}),
  };

  const { error } = await req.userSupabase!
    .from("projects")
    .update({ output_data: updated })
    .eq("id", id)
    .eq("user_id", req.userId);

  if (error) {
    res.status(500).json({ error: error.message });
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
