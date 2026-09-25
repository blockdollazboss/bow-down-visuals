import { Router } from "express";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRef,
} from "../../lib/objectStorage";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../../lib/credits";
import {
  GEN45_CREDIT_COST,
  SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT,
  SEEDANCE_1080P_CREDITS_PER_SEC_DEFAULT,
  SEEDANCE_PRICING_APPROVED,
  SEEDANCE_PRICING_VERSION,
  resolveClipPlan,
} from "./clip-pricing";
import { getLockedPack } from "./pre-production";
import type { PackIngredients } from "@workspace/db";

const router = Router();
/* Site credits charged per second of Seedance 2.5 video, per resolution tier.
   Env-overridable so the rate can be tuned without a deploy; the client
   mirrors these defaults. A legacy flat SEEDANCE_CREDITS_PER_SEC is still
   honored as a fallback for both tiers when the per-tier vars are unset. */
const SEEDANCE_CREDITS_PER_SEC_720P =
  Number(process.env["SEEDANCE_CREDITS_PER_SEC_720P"]) ||
  Number(process.env["SEEDANCE_CREDITS_PER_SEC"]) ||
  SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT;
const SEEDANCE_CREDITS_PER_SEC_1080P =
  Number(process.env["SEEDANCE_CREDITS_PER_SEC_1080P"]) ||
  Number(process.env["SEEDANCE_CREDITS_PER_SEC"]) ||
  SEEDANCE_1080P_CREDITS_PER_SEC_DEFAULT;

/**
 * Tracks submitted Runway tasks so credits are only charged on SUCCEEDED.
 * Key: Runway taskId  Value: { userId, projectId, credits }
 * Cleared on SUCCEEDED (after charging) or FAILED/CANCELLED.
 * In-memory only — a server restart before polling completes means credits
 * won't be charged for that clip (acceptable; user gets a free clip, not a spurious charge).
 */
const pendingTasks = new Map<string, { userId: string; projectId: string | null; credits: number }>();

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
 * Grabs the last frame of a previously-generated clip and uploads it to
 * Supabase Storage so it can be used as Runway's `promptImage` for the next
 * scene — chaining wardrobe/lighting/pose across scenes instead of resetting
 * to the static vault photo every time. Returns a short-lived signed HTTPS
 * URL (Runway requires a public HTTPS URL) or null on any failure so callers
 * can fall back to the vault photo.
 */
async function extractLastFrameUrl(clipUrl: string): Promise<string | null> {
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
    const storageRef = await uploadMediaToSupabaseStorage(objectName, readFileSync(tmpFrame), "image/jpeg");
    /* Runway needs a plain HTTPS URL — mint one (consumed immediately as promptImage). */
    const signed = await refreshSupabaseStorageUrl(storageRef);
    return signed.startsWith("http") ? signed : null;
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
  const { promptText, negativePrompt, ratio, projectId, referenceImageUrl, previousClipUrl, model, durationSec, resolution, packId, shotNumber } = req.body as {
    promptText?: string;
    negativePrompt?: string;
    ratio?: "1280:720" | "720:1280";
    projectId?: string | null;
    referenceImageUrl?: string | null;
    /** Final frame of the immediately-preceding scene's clip, used to chain
     *  wardrobe/lighting/pose across scenes. Falls back to referenceImageUrl
     *  (vault photo) when absent or unusable. */
    previousClipUrl?: string | null;
    /** Video model: "gen4.5" (default, 5s) or "seedance2_5" (premium, up to 30s). */
    model?: "gen4.5" | "seedance2_5";
    /** Requested clip length in seconds. Only honored for seedance2_5 (3–30s). */
    durationSec?: number;
    /** Output resolution tier for seedance2_5. */
    resolution?: "720p" | "1080p";
    /** Locked pre-production pack + shot: when present, the prompt, negative
     *  prompt, model, duration, and ratio come from the pack's locked
     *  ingredients — the client's promptText is ignored. */
    packId?: string | null;
    shotNumber?: number | null;
  };

  /* ── Locked pack mode: everything comes from the locked-in ingredients ─── */
  let lockedIngredients: PackIngredients | null = null;
  if (packId) {
    try {
      const pack = await getLockedPack(req.userId!, String(packId));
      const list = (pack.ingredients as PackIngredients[] | null) ?? [];
      lockedIngredients = list.find((g) => g.shotNumber === Number(shotNumber)) ?? null;
      if (!lockedIngredients) {
        res.status(404).json({ error: `Shot ${shotNumber} is not in the locked pack.` });
        return;
      }
    } catch (err: any) {
      res.status(err?.status ?? 500).json({ error: err?.message ?? "Failed to load the locked pack." });
      return;
    }
  }

  const effectivePrompt = lockedIngredients?.prompt ?? promptText;
  const effectiveNegative = lockedIngredients?.negativePrompt ?? negativePrompt;
  const effectiveModel = lockedIngredients?.model ?? model;
  const effectiveDuration = lockedIngredients?.durationSec ?? durationSec;
  const effectiveRatio = (lockedIngredients?.ratio === "1280:720" ? "1280:720" : "720:1280") as "1280:720" | "720:1280";

  if (!effectivePrompt?.trim()) {
    res.status(400).json({ error: "promptText is required" });
    return;
  }

  /* ── Model + duration resolution ───────────────────────────────────────── */
  const plan = resolveClipPlan({
    model: effectiveModel,
    durationSec: effectiveDuration,
    resolution,
    ratio,
    creditsPerSec720p: SEEDANCE_CREDITS_PER_SEC_720P,
    creditsPerSec1080p: SEEDANCE_CREDITS_PER_SEC_1080P,
  });
  const useSeedance = plan.useSeedance;
  const resolvedDurationSec = plan.durationSec;
  /* Duration-proportional pricing for the premium model; flat 5 for gen4.5. */
  const creditCost = plan.creditCost;

  /* ── Seedance pricing approval gate ──────────────────────────────────────
     The per-scene Seedance price is a proposal until the user approves it.
     Refuse here — BEFORE reference resolution, the Runway submission, the
     credit pre-check, and pending-task tracking — so no scene generation can
     run and no credits can move until the price is approved. Flip
     SEEDANCE_PRICING_APPROVED in clip-pricing.ts (reviewed commit) after the
     user's explicit approval. */
  if (useSeedance && !SEEDANCE_PRICING_APPROVED) {
    req.log.warn(
      { userId: req.userId, pricingVersion: SEEDANCE_PRICING_VERSION },
      "[runway-clip] Seedance submission BLOCKED — pricing pending user approval",
    );
    res.status(402).json({
      error: "seedance_pricing_pending_approval",
      message:
        "Seedance 2.5 scene pricing is pending approval, so generations are paused. No credits were charged and no video was generated.",
      pricingVersion: SEEDANCE_PRICING_VERSION,
    });
    return;
  }

  /* ── Reference image resolution ──────────────────────────────────────────
     Priority: 1) last frame of the previous scene's clip (continuity chain),
     2) the Artist Vault reference photo, 3) text-only (no image reference).
     Runway's image-to-video flow requires a public HTTPS URL. ─────────────── */
  let prevClip = previousClipUrl?.trim();
  /* The frontend may send a stable storage ref (supabase://…) instead of a
     signed URL — mint a fetchable HTTPS URL first so scene chaining keeps
     working regardless of which form arrives. */
  if (prevClip && !/^https:\/\//i.test(prevClip) && parseSupabaseStorageRef(prevClip)) {
    const resolved = await refreshSupabaseStorageUrl(prevClip);
    prevClip = resolved.startsWith("http") ? resolved : undefined;
  }
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
    { userId: req.userId, currentCredits, requiredCredits: creditCost, model: useSeedance ? "seedance2_5" : "gen4.5" },
    "[runway-clip] credit check started",
  );

  if (currentCredits < creditCost) {
    req.log.info(
      { userId: req.userId, currentCredits, requiredCredits: creditCost },
      "[runway-clip] credit check FAILED — insufficient credits",
    );
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  req.log.info(
    { userId: req.userId, currentCredits, requiredCredits: creditCost },
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

  /* Lip-sync-friendly cinematography: appended to Seedance generations so
     downstream Sync.so jobs get a forward-facing, clearly-visible mouth —
     the single biggest lever on lip-sync quality. */
  const PERFORMANCE_DIRECTIVE =
    "Performance framing for lip sync: performer faces the camera directly, " +
    "mouth clearly visible and well lit, stable medium close-up, minimal " +
    "head turns, no hands or objects covering the mouth, smooth and minimal " +
    "camera movement.";

  const AVOID_TERMS =
    "frozen pose, static portrait, still image, slideshow, photo animation, " +
    "no camera movement, no body movement";

  /* Detect outro / closing scene from the prompt text */
  const isOutro = /\b(outro|closing|final scene|ending|walk away|farewell|fade out)\b/i.test(
    effectivePrompt,
  );

  const base = effectivePrompt.trim().slice(0, 480);
  const motionBlock = `${MOTION_DIRECTIVE}${isOutro ? ` ${OUTRO_DIRECTIVE}` : ""}`;
  /* Locked pack continuity: the ingredients' continuity notes ride along. */
  const continuityBlock = lockedIngredients?.continuityNotes?.trim()
    ? ` Continuity lock: ${lockedIngredients.continuityNotes.trim()}`.slice(0, 200)
    : "";
  const content = `${base} ${motionBlock}${continuityBlock}`.trim();

  const neg = effectiveNegative?.trim();
  const avoidBlock = [neg, AVOID_TERMS].filter(Boolean).join(", ");
  /* gen4.5 image-to-video caps promptText at 1000 UTF-16 code units; text-to-video allows more. */
  const promptCap = useImageRef ? 1000 : 1400;
  const finalPrompt = `${content} | Avoid: ${avoidBlock}`.slice(0, promptCap);

  const client = new RunwayML({ apiKey });
  const resolvedRatio = effectiveRatio;
  /* Seedance 2.5 resolution mapping: 720p stays at the base ratio, 1080p
     steps up to the full-HD variant. Generated audio is always off — music
     videos get their audio from the song, not the video model. */
  const seedanceRatio = plan.seedanceRatio;

  req.log.info(
    { userId: req.userId, ratio: effectiveRatio, mode: useImageRef ? "image-to-video" : "text-to-video", model: effectiveModel, durationSec: resolvedDurationSec, packId: packId ?? null, shotNumber: shotNumber ?? null },
    "[runway-clip] Runway generation started",
  );

  try {
    /* Seedance 2.5 prompt: the model accepts up to 15000 characters, so keep
       the lip-sync-friendly performance direction intact instead of the
       aggressive truncation gen4.5 needs. */
    const seedancePrompt = `${content} ${PERFORMANCE_DIRECTIVE} | Avoid: ${avoidBlock}`.slice(0, 4000);

    /* Image-to-video: anchor the artist's face/look to their vault photo so every
       generated scene keeps the same visual identity. Falls back to text-to-video
       when no usable reference photo is provided. */
    const task = useSeedance
      ? useImageRef
        ? await client.imageToVideo.create({
            model: "seedance2_5",
            promptImage: refImage!,
            promptText: seedancePrompt,
            duration: resolvedDurationSec,
            ratio: seedanceRatio,
            audio: false,
          })
        : await client.textToVideo.create({
            model: "seedance2_5",
            promptText: seedancePrompt,
            duration: resolvedDurationSec,
            ratio: seedanceRatio,
            audio: false,
          })
      : useImageRef
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

    pendingTasks.set(task.id, { userId: req.userId!, projectId: projectId ?? null, credits: creditCost });
    req.log.info({ taskId: task.id, userId: req.userId }, "[runway-clip] task submitted — credits pending on SUCCEEDED");

    res.json({ taskId: task.id, referenceSource, creditCost, model: useSeedance ? "seedance2_5" : "gen4.5", durationSec: resolvedDurationSec });
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
        /* Duration-proportional cost for Seedance, flat 5 for gen4.5. */
        const cost = pending.credits ?? GEN45_CREDIT_COST;
        /* Fresh credit read to avoid stale middleware value */
        const { data: freshProfile } = await req.userSupabase!
          .from("profiles")
          .select("credits")
          .eq("id", req.userId!)
          .single();

        const freshCredits: number = (freshProfile as { credits?: number } | null)?.credits ?? 0;
        req.log.info(
          { taskId, userId: req.userId, freshCredits, requiredCredits: cost },
          "[runway-clip] current credits before deduction",
        );

        // chargeCreditsAtomic(): fresh-read deduct + strict ledger write. The
        // clip was already delivered, so on ledger failure the deduction
        // stands (rollback disabled) and the gap is logged CRITICAL — never
        // silent.
        /* Record credit_usage */
        const projectId = pending.projectId ?? null;
        try {
          const creditsAfter = await chargeCreditsAtomic(
            req.userId!,
            cost,
            { action: "Runway Video Clip", projectId },
            { rollbackOnLedgerFailure: false },
          );
          req.log.info(
            { taskId, userId: req.userId, creditsAfter, deducted: cost },
            "[runway-clip] credits deducted",
          );

          /* Track for possible refund if the subsequent save fails */
          chargedTasks.set(taskId, { userId: req.userId!, credits: cost, refunded: false });
          setTimeout(() => chargedTasks.delete(taskId), 60 * 60 * 1000); /* expire after 1 h */
        } catch (err) {
          if (err instanceof LedgerWriteError) {
            req.log.error({ err, taskId }, "[runway-clip] CRITICAL: ledger write failed after deduction — clip delivered, charge has no ledger trace");
          } else {
            req.log.error({ err, taskId }, "[runway-clip] credit deduction FAILED — clip delivered without charge");
          }
        }

        pendingTasks.delete(taskId);

      } else if (pending && pending.userId !== req.userId) {
        req.log.warn({ taskId, submitter: pending.userId, poller: req.userId }, "[runway-clip] userId mismatch on poll — skipping charge");
      } else if (!pending) {
        req.log.info({ taskId }, "[runway-clip] SUCCEEDED poll after charge already processed — skipping duplicate");
      }

      /* ── Upload to Supabase Storage and persist the STABLE STORAGE REF ──
         Short-lived signed URLs are minted per-read (GET handlers), so
         playback never rots the way 7-day GCS signatures did. The frontend
         gets a playable preview URL right now plus `storageRef` to persist;
         POST /api/generated-clips also normalizes server-side, so even if
         the client saves the preview URL, the DB still ends up with the ref. */
      const tmpFile = path.join(os.tmpdir(), `runway-${randomUUID()}.mp4`);
      try {
        req.log.info({ taskId }, "[runway-clip] downloading clip from Runway");
        await downloadToFile(runwayUrl, tmpFile);

        const objectName = `clips/${randomUUID()}.mp4`;
        req.log.info({ objectName }, "[runway-clip] uploading clip to Supabase Storage");
        const storageRef = await uploadMediaToSupabaseStorage(objectName, readFileSync(tmpFile), "video/mp4");

        const previewUrl = await refreshSupabaseStorageUrl(storageRef);
        req.log.info({ objectName, taskId }, "[runway-clip] clip saved to Supabase Storage — returning storage ref + preview URL");

        res.json({ status: "succeeded", url: previewUrl, storageRef, objectPath: storageRef });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[runway-clip] Supabase upload failed — returning raw Runway URL as fallback");
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
