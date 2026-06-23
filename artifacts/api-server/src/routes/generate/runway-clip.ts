import { Router } from "express";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();
const SIDECAR = "http://127.0.0.1:1106";
const CREDIT_COST = 5;

/**
 * Track which tasks have had credits charged so we can refund on failure.
 * Key: Runway taskId, Value: { userId, creditCost, creditsBefore }
 * Cleared on success (usage recorded) or failure (credits refunded).
 * In-memory only — clears on server restart (acceptable edge case).
 */
const chargedTasks = new Map<string, { userId: string; creditCost: number }>();

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

  /* ── Credit check ── */
  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] !== "production";
  if (!isDev && currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  /* ── Deduct credits before submitting (refunded on failure) ── */
  const creditsAfter = Math.max(0, currentCredits - CREDIT_COST);
  if (!isDev) {
    const { error: deductErr } = await req.userSupabase!
      .from("profiles")
      .update({ credits: creditsAfter })
      .eq("id", req.userId!);
    if (deductErr) {
      req.log.error({ err: deductErr }, "[runway-clip] failed to deduct credits");
      res.status(500).json({ error: "Failed to update credits. Please try again." });
      return;
    }
    req.log.info({ userId: req.userId, creditsAfter }, "[runway-clip] credits deducted");
  }

  const base = promptText.slice(0, 900);
  const neg = negativePrompt?.trim();
  const finalPrompt = neg ? `${base} | Avoid: ${neg}`.slice(0, 1000) : base;

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.textToVideo.create({
      model: "gen4.5",
      promptText: finalPrompt,
      duration: 5,
      ratio: ratio === "1280:720" ? "1280:720" : "720:1280",
    });

    /* Track this task so we can refund if it fails */
    if (!isDev) {
      chargedTasks.set(task.id, { userId: req.userId!, creditCost: CREDIT_COST });
    }

    res.json({ taskId: task.id });
  } catch (err: unknown) {
    /* Runway submission failed — restore credits immediately */
    if (!isDev) {
      await req.userSupabase!.from("profiles").update({ credits: currentCredits }).eq("id", req.userId!);
      req.log.info({ userId: req.userId, credits: currentCredits }, "[runway-clip] credits restored after submission failure");
    }
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
        req.log.warn("[runway-clip] DEFAULT_OBJECT_STORAGE_BUCKET_ID not set — returning raw Runway URL");
        /* Record usage even in this fallback path */
        const chargeInfo = chargedTasks.get(taskId);
        if (chargeInfo) {
          recordCreditUsage({ userId: chargeInfo.userId, action: "Runway Video Clip", creditsUsed: chargeInfo.creditCost }).catch(() => {});
          chargedTasks.delete(taskId);
        }
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

        /* Record credit usage on success */
        const chargeInfo = chargedTasks.get(taskId);
        if (chargeInfo) {
          recordCreditUsage({ userId: chargeInfo.userId, action: "Runway Video Clip", creditsUsed: chargeInfo.creditCost }).catch(() => {});
          chargedTasks.delete(taskId);
        }

        res.json({ status: "succeeded", url: signedUrl, objectPath: objectName });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[runway-clip] GCS upload failed, returning raw Runway URL as fallback");
        const chargeInfo = chargedTasks.get(taskId);
        if (chargeInfo) {
          recordCreditUsage({ userId: chargeInfo.userId, action: "Runway Video Clip", creditsUsed: chargeInfo.creditCost }).catch(() => {});
          chargedTasks.delete(taskId);
        }
        res.json({ status: "succeeded", url: runwayUrl });
      } finally {
        cleanup(tmpFile);
      }

    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      const failed = task as { status: string; failure?: string };
      const errMsg = failed.failure ?? "Runway returned a failure with no message";

      /* Refund credits if this task was charged */
      const chargeInfo = chargedTasks.get(taskId);
      if (chargeInfo && chargeInfo.userId === req.userId) {
        const currentCredits = req.userCredits ?? 0;
        const refundedCredits = currentCredits + chargeInfo.creditCost;
        await req.userSupabase!.from("profiles").update({ credits: refundedCredits }).eq("id", chargeInfo.userId);
        req.log.info({ taskId, userId: chargeInfo.userId, refundedCredits }, "[runway-clip] credits refunded after task failure");
        chargedTasks.delete(taskId);
      }

      const status = task.status === "CANCELLED" ? "cancelled" : "failed";
      res.json({ status, error: errMsg, creditsRefunded: !!chargeInfo });
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
