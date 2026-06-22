import { Router } from "express";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();

router.post("/generate-runway-clip", requireAuth, async (req, res) => {
  const { promptText, negativePrompt } = req.body as {
    promptText?: string;
    negativePrompt?: string;
  };

  if (!promptText?.trim()) {
    res.status(400).json({ error: "promptText is required" });
    return;
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  const base = promptText.slice(0, 900);
  const neg = negativePrompt?.trim();
  const finalPrompt = neg
    ? `${base} | Avoid: ${neg}`.slice(0, 1000)
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
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    res.status(500).json({ error: msg });
  }
});

router.get("/generate-runway-clip/:taskId", requireAuth, async (req, res) => {
  const taskId = (req.params as { taskId: string }).taskId;

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.tasks.retrieve(taskId);

    if (task.status === "SUCCEEDED") {
      res.json({ status: "succeeded", url: task.output[0] ?? null });
    } else if (task.status === "FAILED") {
      const failed = task as { status: "FAILED"; failure?: string };
      res.json({ status: "failed", error: failed.failure ?? "Runway returned a failure with no message" });
    } else if (task.status === "CANCELLED") {
      res.json({ status: "cancelled", error: "Task was cancelled by Runway" });
    } else {
      const running = task as { status: string; progress?: number };
      res.json({ status: "processing", progress: running.progress ?? null });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to poll Runway task";
    res.status(500).json({ error: msg });
  }
});

export default router;
