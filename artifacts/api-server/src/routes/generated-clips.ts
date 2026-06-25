import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { db, generatedClipsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const SaveClipSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  sceneId: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  prompt: z.string().optional().nullable(),
  finalPrompt: z.string().optional().nullable(),
  runwayJobId: z.string().optional().nullable(),
  videoUrl: z.string().url(),
  thumbnailUrl: z.string().optional().nullable(),
  status: z.string().optional().default("completed"),
});

/* POST /api/generated-clips — save a clip immediately after generation */
router.post("/generated-clips", requireAuth, async (req, res) => {
  const parsed = SaveClipSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid clip data", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  try {
    const [clip] = await db
      .insert(generatedClipsTable)
      .values({
        user_id: req.userId!,
        project_id: d.projectId ?? null,
        scene_id: d.sceneId ?? null,
        title: d.title ?? null,
        prompt: d.prompt ?? null,
        final_prompt: d.finalPrompt ?? null,
        runway_job_id: d.runwayJobId ?? null,
        video_url: d.videoUrl,
        thumbnail_url: d.thumbnailUrl ?? null,
        status: d.status ?? "completed",
      })
      .returning({ id: generatedClipsTable.id });

    req.log.info({ clipId: clip?.id, userId: req.userId }, "[generated-clips] clip saved");
    res.status(201).json({ id: clip?.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save clip";
    req.log.error({ err: msg }, "[generated-clips] save failed");
    res.status(500).json({ error: msg });
  }
});

/* GET /api/generated-clips — list all clips for the current user */
router.get("/generated-clips", requireAuth, async (req, res) => {
  try {
    const clips = await db
      .select()
      .from(generatedClipsTable)
      .where(eq(generatedClipsTable.user_id, req.userId!))
      .orderBy(desc(generatedClipsTable.created_at))
      .limit(200);

    res.json({ clips });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch clips";
    res.status(500).json({ error: msg });
  }
});

/* DELETE /api/generated-clips/:id */
router.delete("/generated-clips/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    await db
      .delete(generatedClipsTable)
      .where(
        eq(generatedClipsTable.id, id),
      );
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete clip";
    res.status(500).json({ error: msg });
  }
});

export default router;
