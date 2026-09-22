import { Router } from "express";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";
import { recordCreditUsage } from "../../lib/payment-record";
import { getSupabaseAdmin } from "../../lib/supabase-admin";

const router = Router();
const SIDECAR = "http://127.0.0.1:1106";
const CREDIT_COST = 5;

/**
 * Tracks submitted Runway tasks so credits are only charged on SUCCEEDED.
 * Key: Runway taskId  Value: { userId, projectId }
 * Cleared on SUCCEEDED (after charging) or FAILED/CANCELLED.
 * In-memory only — a server restart before polling completes means credits
 * won't be charged for that clip (acceptable; user gets a free clip, not a spurious charge).
 */
const pendingTasks = new Map<string, { userId: string; projectId: string | null }>();

/**
 * Tracks successfully charged tasks so generated-clips.ts can issue a refund
 * if the subsequent DB save fails.
 * Key: Runway taskId  Value: { userId, credits, refunded }
 * Auto-expires after 1 hour to prevent unbounded memory growth.
 */
export const chargedTasks = new Map<string, { userId: string; credits: number; refunded: boolean }>();

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

/**
 * Runway's raw `task.failure` string is explicitly documented as "not
 * recommended to return to users directly without adding context." We map
 * the machine-readable `failureCode` to a clear, actionable message — most
 * importantly for content-moderation rejections of the reference photo,
 * which should never look like a generic/confusing failure. Falls back to
 * the raw failure text (or a generic message) for anything unrecognized.
 */
function describeRunwayFailure(failureCode: string | null, rawFailure: string | null): string {
  const code = (failureCode ?? "").toUpperCase();
  if (code.includes("MODERATION") || code.includes("SAFETY") || code.includes("CONTENT")) {
    return "Runway rejected the reference photo (content moderation). Try a different vault photo, or remove it to generate from the text prompt alone.";
  }
  if (code.includes("INPUT_PREPROCESSING") || code.includes("IMAGE") || code.includes("ASSET")) {
    return "Runway couldn't process the reference photo. Try a different image — it may be corrupted, too small, or an unsupported format.";
  }
  if (code.includes("INTERNAL") || code.includes("TIMEOUT")) {
    return "Runway had an internal error generating this clip. Please try again.";
  }
  return rawFailure ?? "Runway generation failed with no further details.";
}

/**
 * Grabs the last frame of a previously-generated clip and re-uploads it as a
 * signed-URL JPEG so it can be used as Runway's `promptImage` for the next
 * scene — chaining wardrobe/lighting/pose across scenes instead of resetting
 * to the static vault photo every time. Best-effort: any failure (download,
 * ffmpeg, upload) returns null so callers can fall back to the vault photo.
 */
async function extractLastFrameUrl(clipUrl: string): Promise<string | null> {
  const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  if (!bucketId) return null;

  const tmpVideo = path.join(os.tmpdir(), `chain-src-${randomUUID()}.mp4`);
  const tmpFrame = path.join(os.tmpdir(), `chain-frame-${randomUUID()}.jpg`);

  try {
    await downloadToFile(clipUrl, tmpVideo);

    await new Promise<void>((resolve, reject) => {
      /* Seek to ~1s before end-of-file and grab the single last decodable frame. */
      const ff = spawn("ffmpeg", [
        "-y",
        "-sseof", "-1",
        "-i", tmpVideo,
        "-update", "1",
        "-q:v", "2",
        "-frames:v", "1",
        tmpFrame,
      ]);
      let stderr = "";
      ff.stderr.on("data", (d) => { stderr += d.toString(); });
      ff.on("error", reject);
      ff.on("close", (code) => {
        if (code === 0 && existsSync(tmpFrame)) resolve();
        else reject(new Error(`ffmpeg last-frame extraction exited ${code}: ${stderr.slice(-400)}`));
      });
    });

    const objectName = `chain-frames/${randomUUID()}.jpg`;
    const bucket = objectStorageClient.bucket(bucketId);
    await bucket.file(objectName).save(readFileSync(tmpFrame), { contentType: "image/jpeg", resumable: false });
    return await signGetUrl(bucketId, objectName);
  } catch {
    return null;
  } finally {
    cleanup(tmpVideo);
    cleanup(tmpFrame);
  }
}

/** DEV: confirm RUNWAYML_API_SECRET exists without revealing its value */
router.get("/generate-runway-clip/debug-check", requireAuth, (_req, res) => {
  const key = process.env["RUNWAYML_API_SECRET"];
  res.json({ secretExists: !!key, secretLength: key ? key.length : 0 });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-runway-clip
   1. Credit pre-check — always enforced (no dev bypass).
   2. Submit job to Runway.
   3. Track task in pendingTasks — credits NOT yet charged.
   4. Return { taskId }.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-runway-clip", requireAuth, async (req, res) => {
  const { promptText, negativePrompt, ratio, projectId, referenceImageUrl, previousClipUrl } = req.body as {
    promptText?: string;
    negativePrompt?: string;
    ratio?: "1280:720" | "720:1280";
    projectId?: string | null;
    referenceImageUrl?: string | null;
    /** Final frame of the immediately-preceding scene's clip, used to chain
     *  wardrobe/lighting/pose across scenes. Falls back to referenceImageUrl
     *  (vault photo) when absent or unusable. */
    previousClipUrl?: string | null;
  };

  if (!promptText?.trim()) {
    res.status(400).json({ error: "promptText is required" });
    return;
  }

  /* ── Reference image resolution ──────────────────────────────────────────
     Priority: 1) last frame of the previous scene's clip (continuity chain),
     2) the Artist Vault reference photo, 3) text-only (no image reference).
     Runway's image-to-video flow requires a public HTTPS URL. ─────────────── */
  const prevClip = previousClipUrl?.trim();
  const hasPrevClip = !!prevClip && /^https:\/\//i.test(prevClip);

  let refImage: string | undefined;
  let referenceSource: "previous_scene" | "vault_photo" | "none" = "none";

  if (hasPrevClip) {
    req.log.info({ prevClip: prevClip!.slice(0, 80) }, "[runway-clip] attempting scene-chain last-frame extraction");
    const chainedFrame = await extractLastFrameUrl(prevClip!);
    if (chainedFrame) {
      refImage = chainedFrame;
      referenceSource = "previous_scene";
      req.log.info("[runway-clip] using previous scene's last frame as reference");
    } else {
      req.log.warn("[runway-clip] last-frame extraction failed — falling back to vault photo");
    }
  }

  if (!refImage) {
    const vaultRef = referenceImageUrl?.trim();
    if (vaultRef && /^https:\/\//i.test(vaultRef)) {
      refImage = vaultRef;
      referenceSource = "vault_photo";
    }
  }

  const useImageRef = !!refImage;

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  req.log.info(
    { userId: req.userId, currentCredits, requiredCredits: CREDIT_COST },
    "[runway-clip] credit check started",
  );

  if (currentCredits < CREDIT_COST) {
    req.log.info(
      { userId: req.userId, currentCredits, requiredCredits: CREDIT_COST },
      "[runway-clip] credit check FAILED — insufficient credits",
    );
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  req.log.info(
    { userId: req.userId, currentCredits, requiredCredits: CREDIT_COST },
    "[runway-clip] credit check PASSED",
  );

  /* ── Motion enhancement ────────────────────────────────────────────────────
     Always inject motion direction so Runway generates real moving video
     instead of a still-image-style clip.
  ───────────────────────────────────────────────────────────────────────── */
  const MOTION_DIRECTIVE =
    "Real moving video: artist moves naturally with subtle body motion, " +
    "head turns, and live performance energy. " +
    "Slow tracking shot or cinematic handheld camera movement throughout. " +
    "Background has natural movement — light flicker, depth shifts, " +
    "street or environmental atmosphere in motion.";

  const OUTRO_DIRECTIVE =
    "Emotional closing shot: slow walk away, camera pulls back gradually, " +
    "gentle wind and shifting light, cinematic fade-out energy.";

  const AVOID_TERMS =
    "frozen pose, static portrait, still image, slideshow, photo animation, " +
    "no camera movement, no body movement";

  /* Detect outro / closing scene from the prompt text */
  const isOutro = /\b(outro|closing|final scene|ending|walk away|farewell|fade out)\b/i.test(
    promptText,
  );

  const base = promptText.trim().slice(0, 480);
  const motionBlock = `${MOTION_DIRECTIVE}${isOutro ? ` ${OUTRO_DIRECTIVE}` : ""}`;
  const content = `${base} ${motionBlock}`.trim();

  const neg = negativePrompt?.trim();
  const avoidBlock = [neg, AVOID_TERMS].filter(Boolean).join(", ");
  /* gen4.5 image-to-video caps promptText at 1000 UTF-16 code units; text-to-video allows more. */
  const promptCap = useImageRef ? 1000 : 1400;
  const finalPrompt = `${content} | Avoid: ${avoidBlock}`.slice(0, promptCap);

  const client = new RunwayML({ apiKey });
  const resolvedRatio = ratio === "1280:720" ? "1280:720" : "720:1280";

  req.log.info(
    { userId: req.userId, ratio, mode: useImageRef ? "image-to-video" : "text-to-video" },
    "[runway-clip] Runway generation started",
  );

  try {
    /* Image-to-video: anchor the artist's face/look to their vault photo so every
       generated scene keeps the same visual identity. Falls back to text-to-video
       when no usable reference photo is provided. */
    const task = useImageRef
      ? await client.imageToVideo.create({
          model: "gen4.5",
          promptImage: refImage!,
          promptText: finalPrompt,
          duration: 5,
          ratio: resolvedRatio,
          contentModeration: { publicFigureThreshold: "low" },
        })
      : await client.textToVideo.create({
          model: "gen4.5",
          promptText: finalPrompt,
          duration: 5,
          ratio: resolvedRatio,
        });

    pendingTasks.set(task.id, { userId: req.userId!, projectId: projectId ?? null });
    req.log.info({ taskId: task.id, userId: req.userId }, "[runway-clip] task submitted — credits pending on SUCCEEDED");

    res.json({ taskId: task.id, referenceSource });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[runway-clip] submission failed — no credits charged");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-runway-clip/:taskId
   Poll Runway task status.
   - SUCCEEDED → fresh credit read → deduct 5 credits → record usage → return signed URL
   - FAILED/CANCELLED → no charge → return error
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
        pendingTasks.delete(taskId);
        req.log.warn({ taskId }, "[runway-clip] SUCCEEDED but no output URL — no credits charged");
        res.json({ status: "succeeded", url: null });
        return;
      }

      const pending = pendingTasks.get(taskId);

      /* ── Charge credits (only once, guarded by pendingTasks presence) ── */
      if (pending && pending.userId === req.userId) {
        /* Fresh credit read to avoid stale middleware value */
        const { data: freshProfile } = await req.userSupabase!
          .from("profiles")
          .select("credits")
          .eq("id", req.userId!)
          .single();

        const freshCredits: number = (freshProfile as { credits?: number } | null)?.credits ?? 0;
        req.log.info(
          { taskId, userId: req.userId, freshCredits, requiredCredits: CREDIT_COST },
          "[runway-clip] current credits before deduction",
        );

        const creditsAfter = Math.max(0, freshCredits - CREDIT_COST);
        /* profiles UPDATE via user-scoped client silently no-ops under broken RLS UPDATE policy — use service role. */
        const { error: deductErr } = await getSupabaseAdmin()
          .from("profiles")
          .update({ credits: creditsAfter })
          .eq("id", req.userId!);

        if (deductErr) {
          req.log.error({ err: deductErr, taskId }, "[runway-clip] credit deduction FAILED — clip delivered without charge");
        } else {
          req.log.info(
            { taskId, userId: req.userId, creditsAfter, deducted: CREDIT_COST },
            "[runway-clip] credits deducted",
          );

          /* Record credit_usage */
          const projectId = pending.projectId ?? null;
          recordCreditUsage({
            userId:      req.userId!,
            action:      "Runway Video Clip",
            creditsUsed: CREDIT_COST,
            projectId,
          })
            .then(() => req.log.info({ taskId, userId: req.userId }, "[runway-clip] credit_usage saved"))
            .catch((e) => req.log.warn({ err: e }, "[runway-clip] credit_usage save failed (non-fatal)"));

          /* Track for possible refund if the subsequent save fails */
          chargedTasks.set(taskId, { userId: req.userId!, credits: CREDIT_COST, refunded: false });
          setTimeout(() => chargedTasks.delete(taskId), 60 * 60 * 1000); /* expire after 1 h */
        }

        pendingTasks.delete(taskId);

      } else if (pending && pending.userId !== req.userId) {
        req.log.warn({ taskId, submitter: pending.userId, poller: req.userId }, "[runway-clip] userId mismatch on poll — skipping charge");
      } else if (!pending) {
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
        req.log.info({ objectName, taskId }, "[runway-clip] clip saved to GCS — returning signed URL");

        res.json({ status: "succeeded", url: signedUrl, objectPath: objectName });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[runway-clip] GCS upload failed — returning raw Runway URL as fallback");
        res.json({ status: "succeeded", url: runwayUrl });
      } finally {
        cleanup(tmpFile);
      }

    /* ── FAILED / CANCELLED — credits were never charged ── */
    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      const rawFailure = (task as { failure?: string }).failure ?? null;
      const failureCode = (task as { failureCode?: string }).failureCode ?? null;
      const errMsg = describeRunwayFailure(failureCode, rawFailure);
      req.log.info(
        { taskId, status: task.status, failureCode, rawFailure },
        "[runway-clip] task failed — no credits charged",
      );
      pendingTasks.delete(taskId);
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
