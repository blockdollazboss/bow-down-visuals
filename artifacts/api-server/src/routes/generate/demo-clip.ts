import { Router } from "express";
import { z } from "zod";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();

const demoClipSchema = z.object({
  promptText: z.string().trim().min(1, "promptText is required"),
  negativePrompt: z.string().trim().max(1000).optional().default(""),
});

router.post("/generate-demo-clip", requireAuth, async (req, res) => {
  const parsed = demoClipSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { promptText, negativePrompt } = parsed.data;

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key not configured on server" });
    return;
  }

  const base = promptText.slice(0, 900);
  const finalPrompt = negativePrompt
    ? `${base} | Avoid: ${negativePrompt}`.slice(0, 1000)
    : base;

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.textToVideo.create({
      model: "gen4.5",
      promptText: finalPrompt,
      duration: 5,
      ratio: "1280:720",
    });
    res.json({ taskId: task.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to start generation";
    res.status(500).json({ error: msg });
  }
});

router.get("/generate-demo-clip/:taskId", requireAuth, async (req, res) => {
  const taskId = (req.params as { taskId: string }).taskId;

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key not configured on server" });
    return;
  }

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.tasks.retrieve(taskId);

    if (task.status === "SUCCEEDED") {
      res.json({ status: "succeeded", url: task.output[0] ?? null });
    } else if (task.status === "FAILED") {
      const failed = task as { status: "FAILED"; failure?: string };
      res.json({ status: "failed", error: failed.failure ?? "Generation failed" });
    } else if (task.status === "CANCELLED") {
      res.json({ status: "cancelled", error: "Task was cancelled" });
    } else {
      const running = task as { status: string; progress?: number };
      res.json({ status: "processing", progress: running.progress ?? null });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to poll task";
    res.status(500).json({ error: msg });
  }
});

export default router;
