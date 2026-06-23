import { Router } from "express";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";

const router = Router();
const SIDECAR = "http://127.0.0.1:1106";

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url.slice(0, 80)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);
}

async function signGetUrl(bucketName: string, objectName: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method: "GET", expires_at: expiresAt }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to sign URL: ${res.status}`);
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

function cleanup(f: string) {
  try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
}

/** DEV: confirm RUNWAYML_API_SECRET exists without revealing its value */
router.get("/generate-runway-clip/debug-check", requireAuth, (_req, res) => {
  const key = process.env["RUNWAYML_API_SECRET"];
  res.json({
    secretExists: !!key,
    secretLength: key ? key.length : 0,
  });
});

router.post("/generate-runway-clip", requireAuth, async (req, res) => {
  const { promptText, negativePrompt, ratio } = req.body as {
    promptText?: string;
    negativePrompt?: string;
    ratio?: "1280:720" | "720:1280";
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
      ratio: ratio === "1280:720" ? "1280:720" : "720:1280",
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
      const runwayUrl = task.output[0] ?? null;
      if (!runwayUrl) {
        res.json({ status: "succeeded", url: null });
        return;
      }

      /* — Re-upload to GCS so the URL never expires — */
      const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
      if (!bucketId) {
        /* fallback: return the Runway URL directly (will expire) */
        req.log.warn("[runway-clip] DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — returning raw Runway URL");
        res.json({ status: "succeeded", url: runwayUrl });
        return;
      }

      const tmpFile = path.join(os.tmpdir(), `runway-${randomUUID()}.mp4`);
      try {
        req.log.info({ taskId }, "[runway-clip] downloading clip from Runway");
        await downloadToFile(runwayUrl, tmpFile);

        const objectName = `clips/${randomUUID()}.mp4`;
        const bucket = objectStorageClient.bucket(bucketId);
        const gcsFile = bucket.file(objectName);

        req.log.info({ objectName }, "[runway-clip] uploading clip to GCS");
        await gcsFile.save(readFileSync(tmpFile), {
          contentType: "video/mp4",
          resumable: false,
        });

        const signedUrl = await signGetUrl(bucketId, objectName);
        req.log.info({ objectName }, "[runway-clip] clip saved to GCS, returning signed URL");
        res.json({ status: "succeeded", url: signedUrl, objectPath: objectName });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[runway-clip] GCS upload failed, returning raw Runway URL as fallback");
        /* fallback to Runway URL — will expire but at least the user sees their clip */
        res.json({ status: "succeeded", url: runwayUrl });
      } finally {
        cleanup(tmpFile);
      }

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
