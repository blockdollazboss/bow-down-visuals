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
 * Tracks submitted Runway tasks so we can charge credits only on SUCCEEDED.
 * Key: Runway taskId  Value: { userId }
 *
 * Credits are NOT charged at POST submission — only when the poll returns
 * SUCCEEDED. If the task FAILS or is CANCELLED, no credits are ever charged.
 * Cleared on SUCCEEDED (after charging) or FAILED/CANCELLED.
 * In-memory only — a server restart before polling completes means credits
 * won't be charged for that clip (acceptable; user gets a free clip, not
 * a spurious charge).
 */
const pendingTasks = new Map<string, { userId: string }>();

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
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "GET",
      expires_at: expiresAt,
    }),
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
  res.json({ secretExists: !!key, secretLength: key ? key.length : 0 });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-runway-clip
   1. Verify user has ≥ 5 credits (block if not).
   2. Submit job to Runway.
   3. Track task in pendingTasks — credits NOT yet charged.
   4. Return { taskId }.
───────────────────────────────────────────────────────────────────────────── */
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

  /* ── Credit pre-check (gate, no deduction yet) ── */
  const isDev = process.env["NODE_ENV"] !== "production";
  const currentCredits = req.userCredits ?? 0;
  if (!isDev && currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  const base = promptText.trim().slice(0, 900);
  const neg  = negativePrompt?.trim();
  const finalPrompt = neg ? `${base} | Avoid: ${neg}`.slice(0, 1000) : base;

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.textToVideo.create({
      model: "gen4.5",
      promptText: finalPrompt,
      duration: 5,
      ratio: ratio === "1280:720" ? "1280:720" : "720:1280",
    });

    /* Track so we can charge on SUCCEEDED */
    pendingTasks.set(task.id, { userId: req.userId! });
    req.log.info({ taskId: task.id, userId: req.userId }, "[runway-clip] task submitted, credits pending");

    res.json({ taskId: task.id });
  } catch (err: unknown) {
    /* Runway submission failed — credits were never touched */
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[runway-clip] submission failed");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-runway-clip/:taskId
   Poll Runway task status.
   - SUCCEEDED → charge 5 credits + record usage → return signed URL
   - FAILED/CANCELLED → no charge ever → return error
   - Still running → return { status: "processing", progress }
───────────────────────────────────────────────────────────────────────────── */
router.get("/generate-runway-clip/:taskId", requireAuth, async (req, res) => {
  const { taskId } = req.params as { taskId: string };

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.tasks.retrieve(taskId);

    /* ── SUCCEEDED ── */
    if (task.status === "SUCCEEDED") {
      const runwayUrl = (task.output as string[] | undefined)?.[0] ?? null;
      if (!runwayUrl) {
        /* Task says SUCCEEDED but no output URL — don't charge */
        pendingTasks.delete(taskId);
        res.json({ status: "succeeded", url: null });
        return;
      }

      const isDev = process.env["NODE_ENV"] !== "production";
      const pending = pendingTasks.get(taskId);

      /* ── Charge credits (only once, guarded by pendingTasks presence) ── */
      if (!isDev && pending && pending.userId === req.userId) {
        const currentCredits = req.userCredits ?? 0;
        const creditsAfter = Math.max(0, currentCredits - CREDIT_COST);
        const { error: deductErr } = await req.userSupabase!
          .from("profiles")
          .update({ credits: creditsAfter })
          .eq("id", req.userId!);
        if (deductErr) {
          req.log.error({ err: deductErr }, "[runway-clip] credit deduction failed after SUCCEEDED — clip delivered anyway");
        } else {
          req.log.info({ taskId, userId: req.userId, creditsAfter }, "[runway-clip] 5 credits charged on success");
          recordCreditUsage({
            userId: req.userId!,
            action: "Runway Video Clip",
            creditsUsed: CREDIT_COST,
            projectId: null,
          }).catch(() => {});
        }
        pendingTasks.delete(taskId);
      } else if (!isDev && pending && pending.userId !== req.userId) {
        /* Different user polling — skip charge for this user, let owner's next poll handle it */
        req.log.warn({ taskId, submitter: pending.userId, poller: req.userId }, "[runway-clip] userId mismatch on poll");
      } else if (!isDev && !pending) {
        /* pendingTasks entry already cleared (double-poll on SUCCEEDED) — skip duplicate charge */
        req.log.info({ taskId }, "[runway-clip] SUCCEEDED poll after charge already processed — skipping duplicate");
      }

      /* ── Re-upload to GCS so the signed URL never expires ── */
      const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
      if (!bucketId) {
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
        await gcsFile.save(readFileSync(tmpFile), { contentType: "video/mp4", resumable: false });

        const signedUrl = await signGetUrl(bucketId, objectName);
        req.log.info({ objectName }, "[runway-clip] clip saved, returning signed URL");

        res.json({ status: "succeeded", url: signedUrl, objectPath: objectName });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[runway-clip] GCS upload failed — returning raw Runway URL as fallback");
        res.json({ status: "succeeded", url: runwayUrl });
      } finally {
        cleanup(tmpFile);
      }

    /* ── FAILED / CANCELLED — credits were never charged ── */
    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      const errMsg = (task as { failure?: string }).failure ?? "Runway returned a failure with no message";
      req.log.info({ taskId, status: task.status }, "[runway-clip] task failed — no credits charged");
      pendingTasks.delete(taskId); /* clean up the pending entry */
      const status = task.status === "CANCELLED" ? "cancelled" : "failed";
      res.json({ status, error: errMsg });

    /* ── Still running ── */
    } else {
      const running = task as { progress?: number };
      res.json({ status: "processing", progress: running.progress ?? null });
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to poll Runway task";
    res.status(500).json({ error: msg });
  }
});

export default router;
