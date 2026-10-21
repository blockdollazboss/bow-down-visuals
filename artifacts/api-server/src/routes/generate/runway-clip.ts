import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { invokeRailHandler, type RailCoreDeps, type RailCoreResult } from "../../lib/rail-core";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import {
  uploadMediaToSupabaseStorage,
  uploadFileStreamToSupabaseStorage,
  SUPABASE_CLIPS_BUCKET,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRef,
} from "../../lib/objectStorage";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../../lib/credits";
import { recordClipCharge } from "../../lib/clip-charge-obligations";
import {
  GEN45_CREDIT_COST,
  SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT,
  SEEDANCE_1080P_CREDITS_PER_SEC_DEFAULT,
  SEEDANCE_DRAFT_CREDITS_PER_SEC_DEFAULT,
  SEEDANCE_PRICING_APPROVED,
  SEEDANCE_PRICING_VERSION,
  VEO_CREDITS_PER_SEC_DEFAULT,
  VEO_PRICING_APPROVED,
  VEO_PRICING_VERSION,
  modelSupportsEndFrame,
  resolveClipPlan,
} from "./clip-pricing";
import { submitVeoVideo, pollVeoOperation, downloadVeoVideoToFile } from "../../lib/veo-client";
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
const SEEDANCE_CREDITS_PER_SEC_DRAFT =
  Number(process.env["SEEDANCE_CREDITS_PER_SEC_DRAFT"]) ||
  SEEDANCE_DRAFT_CREDITS_PER_SEC_DEFAULT;
/* Veo 3.1 (Google) credits/sec at 720p. Env-overridable without a deploy. */
const VEO_CREDITS_PER_SEC =
  Number(process.env["VEO_CREDITS_PER_SEC"]) ||
  VEO_CREDITS_PER_SEC_DEFAULT;

/**
 * Tracks submitted Runway tasks so credits are only charged on SUCCEEDED.
 * Key: Runway taskId (or veo-<uuid> for Veo)  Value: { userId, projectId, credits, veoOperation? }
 * Cleared on SUCCEEDED (after charging) or FAILED/CANCELLED.
 * In-memory only — a server restart before polling completes means credits
 * won't be charged for that clip (acceptable; user gets a free clip, not a spurious charge).
 */
const pendingTasks = new Map<string, { userId: string; projectId: string | null; credits: number; veoOperation?: string }>();

/**
 * Tracks successfully charged tasks so generated-clips.ts can issue a refund
 * if the subsequent DB save fails.
 * Key: Runway taskId  Value: { userId, credits, refunded }
 * Auto-expires after 1 hour to prevent unbounded memory growth.
 *
 * D3 (migration 0183): this map is now only the FAST PATH. Every charge
 * also writes a durable clip_charge_obligations row at charge time —
 * that row is the source of truth, so a server restart between the
 * charge and the save no longer loses the refund (the stale sweeper
 * in lib/clip-charge-obligations.ts resolves orphaned rows).
 */
export const chargedTasks = new Map<string, { userId: string; credits: number; refunded: boolean }>();

/* Write the durable charge→refund obligation for a charge that just
   landed. A failed record must never break clip delivery — it is
   logged CRITICAL and the in-memory entry above remains the fallback
   (the pre-D3 behavior for this one task). */
async function recordDurableClipCharge(
  log: Request["log"],
  taskId: string,
  userId: string,
  credits: number,
  projectId: string | null,
): Promise<void> {
  try {
    await recordClipCharge({ taskId, userId, credits, projectId });
  } catch (err) {
    log.error(
      { err, taskId, userId, credits },
      "[runway-clip] CRITICAL: durable clip-charge record failed — refund protection is in-memory only for this task",
    );
  }
}

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
/* ── Request validation ── */
const runwayClipSchema = z.object({
  promptText: z.string().max(5000).optional(),
  negativePrompt: z.string().max(2000).optional().nullable(),
  ratio: z.enum(["1280:720", "720:1280"]).optional(),
  projectId: z.string().max(100).optional().nullable(),
  referenceImageUrl: z.string().max(2048).optional().nullable(),
  /** Final frame of the immediately-preceding scene's clip, used to chain
   *  wardrobe/lighting/pose across scenes. Falls back to referenceImageUrl
   *  (vault photo) when absent or unusable. */
  previousClipUrl: z.string().max(2048).optional().nullable(),
  /** Optional end-frame (last-frame) keyframe image: the visual the clip
   *  must land on. Only forwarded to models whose API accepts a last frame
   *  (seedance2_5, veo3_1 — see CLIP_END_FRAME_SUPPORT in clip-pricing.ts);
   *  gen4.5's PromptImage type allows position 'first' only, so the field
   *  is dropped for it. Part of the existing generation charge — no
   *  separate price. A locked pack's ingredient wins over this field. */
  endFrameImageUrl: z.string().max(2048).optional().nullable(),
  /** Video model: "gen4.5" (default, 5s), "seedance2_5" (premium, up to
   *  30s), or "veo3_1" (cinematic; refused until VEO_PRICING_APPROVED). */
  model: z.enum(["gen4.5", "seedance2_5", "veo3_1"]).optional(),
  /** Requested clip length in seconds. Only honored for seedance2_5 (3–30s). */
  durationSec: z.number().finite().min(1).max(60).optional(),
  /** Output resolution tier for seedance2_5. */
  resolution: z.enum(["720p", "1080p"]).optional(),
  /** Draft mode: cheap 480p preview for iterating on a shot. Only for seedance2_5.
   *  The response includes the seed — re-submit with the same seed +
   *  resolution "1080p" to enhance the keeper to full res. */
  draft: z.boolean().optional(),
  /** Explicit seed for reproducible generations (0–4294967295). The server
   *  generates one when omitted; the response always includes the seed used. */
  seed: z.number().int().min(0).max(4294967295).optional(),
  /** Locked pre-production pack + shot: when present, the prompt, negative
   *  prompt, model, duration, and ratio come from the pack's locked
   *  ingredients — the client's promptText is ignored. */
  packId: z.string().max(100).optional().nullable(),
  shotNumber: z.number().int().min(0).max(1000).optional().nullable(),
});

const submitRunwayClipHandler = async (req: Request, res: Response) => {
  const parsed = runwayClipSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid runway clip request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { promptText, negativePrompt, ratio, projectId, referenceImageUrl, previousClipUrl, endFrameImageUrl, model, durationSec, resolution, draft, seed, packId, shotNumber } = parsed.data;

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
  /* The end frame rides the locked pack like every other ingredient: a
     locked shot's end frame wins over the per-request field. */
  const effectiveEndFrame = lockedIngredients?.endFrameImageUrl ?? endFrameImageUrl;
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
    draft,
    creditsPerSec720p: SEEDANCE_CREDITS_PER_SEC_720P,
    creditsPerSec1080p: SEEDANCE_CREDITS_PER_SEC_1080P,
    creditsPerSecDraft: SEEDANCE_CREDITS_PER_SEC_DRAFT,
    creditsPerSecVeo: VEO_CREDITS_PER_SEC,
  });
  const useSeedance = plan.useSeedance;
  const useVeo = plan.useVeo;
  const isDraft = plan.isDraft;
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
        "Seedance 2.5 scene pricing is pending approval, so generations are paused. No Visual Bucs were charged and no video was generated.",
      pricingVersion: SEEDANCE_PRICING_VERSION,
    });
    return;
  }

  /* ── Veo 3.1 pricing approval gate (same pattern as Seedance) ────────────
     Refuse BEFORE any Gemini call, credit check, or pending-task tracking. */
  if (useVeo && !VEO_PRICING_APPROVED) {
    req.log.warn(
      { userId: req.userId, pricingVersion: VEO_PRICING_VERSION },
      "[runway-clip] Veo 3.1 submission BLOCKED — pricing pending user approval",
    );
    res.status(402).json({
      error: "veo_pricing_pending_approval",
      message:
        "Veo 3.1 scene pricing is pending approval, so generations are paused. No Visual Bucs were charged and no video was generated.",
      pricingVersion: VEO_PRICING_VERSION,
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

  /* ── End-frame resolution ────────────────────────────────────────────────
     Only models whose provider API accepts a last frame ever see the end
     frame (seedance2_5 / veo3_1). For gen4.5 it is dropped here — the SDK's
     Gen4_5.PromptImage position is 'first' only — so the parameter is
     absent from the provider request, never sent-and-ignored. A stable
     storage ref is minted to HTTPS exactly like the chaining clip URL. */
  let endFrameUrl: string | undefined;
  if (modelSupportsEndFrame(plan.model)) {
    let ef = effectiveEndFrame?.trim();
    if (ef && !/^https:\/\//i.test(ef) && parseSupabaseStorageRef(ef)) {
      const resolved = await refreshSupabaseStorageUrl(ef);
      ef = resolved.startsWith("http") ? resolved : undefined;
    }
    if (ef && /^https:\/\//i.test(ef)) {
      endFrameUrl = ef;
    } else if (ef) {
      req.log.warn("[runway-clip] end frame supplied but not a usable HTTPS URL — generating without it");
    }
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  // Veo 3.1 runs on Gemini, never touches Runway — don't block it on the
  // Runway key.
  if (!apiKey && !useVeo) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  req.log.info(
    { userId: req.userId, currentCredits, requiredCredits: creditCost, model: plan.model },
    "[runway-clip] credit check started",
  );

  if (currentCredits < creditCost) {
    req.log.info(
      { userId: req.userId, currentCredits, requiredCredits: creditCost },
      "[runway-clip] credit check FAILED — insufficient credits",
    );
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
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

  /* ── Veo 3.1 (Google) path: cinematic clips with native audio ────────────
     Async like Runway: submit the long-running operation, track it in
     pendingTasks under a veo-<uuid> id, and let the GET poller below drive
     it to completion. Credits are only charged on success. Positioned after
     the credit pre-check above — no free generations. */
  if (useVeo) {
    try {
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;
      if (useImageRef) {
        try {
          const imgRes = await fetch(refImage!, { signal: AbortSignal.timeout(60_000) });
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            if (buf.length > 0 && buf.length <= 8 * 1024 * 1024) {
              imageBase64 = buf.toString("base64");
              imageMimeType = imgRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
            }
          }
        } catch {
          req.log.warn("[runway-clip] Veo reference image fetch failed — text-to-video fallback");
        }
      }
      /* End frame (Veo 3.1 first/last-frame interpolation): fetched with
         the same discipline as the first frame. Veo never accepts a lone
         last frame, so it is only forwarded when a first frame landed. */
      let lastFrameBase64: string | undefined;
      let lastFrameMimeType: string | undefined;
      if (endFrameUrl && imageBase64) {
        try {
          const efRes = await fetch(endFrameUrl, { signal: AbortSignal.timeout(60_000) });
          if (efRes.ok) {
            const buf = Buffer.from(await efRes.arrayBuffer());
            if (buf.length > 0 && buf.length <= 8 * 1024 * 1024) {
              lastFrameBase64 = buf.toString("base64");
              lastFrameMimeType = efRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
            }
          }
        } catch {
          req.log.warn("[runway-clip] Veo end-frame fetch failed — generating without an end frame");
        }
      }
      /* Veo generates its own audio natively (dialogue/SFX/ambience) — that
         is its signature strength, so unlike Seedance we leave it on. */
      const veoPrompt = `${content} ${PERFORMANCE_DIRECTIVE}`.slice(0, 4000);
      const operation = await submitVeoVideo({
        prompt: veoPrompt,
        aspectRatio: effectiveRatio === "720:1280" ? "9:16" : "16:9",
        imageBase64,
        imageMimeType,
        lastFrameBase64,
        lastFrameMimeType,
        resolution: "720p",
      });
      const veoTaskId = `veo-${randomUUID()}`;
      pendingTasks.set(veoTaskId, {
        userId: req.userId!,
        projectId: projectId ?? null,
        credits: creditCost,
        veoOperation: operation,
      });
      req.log.info({ taskId: veoTaskId, userId: req.userId, operation }, "[runway-clip] Veo 3.1 task submitted — credits pending on success");
      res.json({
        taskId: veoTaskId,
        referenceSource,
        creditCost,
        model: "veo3_1",
        durationSec: resolvedDurationSec,
        endFrameUsed: !!lastFrameBase64,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Veo 3.1 submission failed";
      req.log.error({ err: msg }, "[runway-clip] Veo 3.1 submission failed — no credits charged");
      res.status(500).json({ error: msg });
    }
    return;
  }

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

    /* Explicit seed for reproducibility — the draft→enhance flow re-submits
       with the draft's seed at 1080p to preserve its composition/motion.
       Random when the client doesn't supply one. */
    const resolvedSeed = useSeedance
      ? (typeof seed === "number" ? seed : Math.floor(Math.random() * 4294967296))
      : undefined;

    /* Image-to-video: anchor the artist's face/look to their vault photo so every
       generated scene keeps the same visual identity. Falls back to text-to-video
       when no usable reference photo is provided. */
    /* Seedance end-frame keyframes: when an end frame is set, promptImage
       becomes the positioned keyframe array — the first frame (when one
       resolved) at 'first', the end frame at 'last'. Seedance's keyframe
       mode cannot mix positioned and unpositioned images, so the first
       frame is positioned too. With no end frame the request keeps its
       exact pre-end-frame shape (plain string / text-to-video). gen4.5
       never reaches this branch's keyframes — endFrameUrl is only
       resolved for models that support it. */
    const task = useSeedance
      ? useImageRef || endFrameUrl
        ? await client.imageToVideo.create({
            model: "seedance2_5",
            promptImage: endFrameUrl
              ? [
                  ...(refImage ? [{ uri: refImage, position: "first" as const }] : []),
                  { uri: endFrameUrl, position: "last" as const },
                ]
              : refImage!,
            promptText: seedancePrompt,
            duration: resolvedDurationSec,
            ratio: seedanceRatio,
            audio: false,
            seed: resolvedSeed,
          })
        : await client.textToVideo.create({
            model: "seedance2_5",
            promptText: seedancePrompt,
            duration: resolvedDurationSec,
            ratio: seedanceRatio,
            audio: false,
            seed: resolvedSeed,
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

    res.json({
      taskId: task.id,
      referenceSource,
      creditCost,
      model: useSeedance ? "seedance2_5" : "gen4.5",
      durationSec: resolvedDurationSec,
      endFrameUsed: useSeedance && !!endFrameUrl,
      ...(useSeedance ? { seed: resolvedSeed, isDraft } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[runway-clip] submission failed — no credits charged");
    res.status(500).json({ error: msg });
  }
};

router.post("/generate-runway-clip", requireAuth, generationLimiter, submitRunwayClipHandler);

/* Operator core (Phase 2 Lane E): the Tier 3 generate.video tool
   submits through this exact handler in-process (lib/rail-core) —
   same pre-check; credits stay pending on SUCCEEDED exactly as the
   page's flow leaves them. (HTTP rate limiting stays on the route;
   the operator path carries the executor's own gates.) */
export async function runSubmitRunwayClip(
  deps: RailCoreDeps,
  body: unknown,
): Promise<RailCoreResult> {
  return invokeRailHandler(submitRunwayClipHandler as never, deps, { body });
}

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-runway-clip/:taskId
   Poll Runway task status.
   - SUCCEEDED → fresh credit read → deduct 5 credits → record usage → return signed URL
   - FAILED/CANCELLED → no charge → return error
   - Still running → return { status: "processing", progress }
───────────────────────────────────────────────────────────────────────────── */
const pollRunwayClipHandler = async (req: Request, res: Response) => {
  const { taskId } = req.params as { taskId: string };

  /* ── Veo 3.1 poll branch ─────────────────────────────────────────────────
     Veo tasks are tracked under veo-<uuid> ids with the Gemini operation
     name in pendingTasks. Same money rules as Runway: charge only on
     success, once, guarded by pendingTasks presence. */
  if (taskId.startsWith("veo-")) {
    const pending = pendingTasks.get(taskId);
    if (!pending?.veoOperation) {
      res.json({ status: "failed", error: "Unknown or expired Veo task." });
      return;
    }
    try {
      const poll = await pollVeoOperation(pending.veoOperation);
      if (!poll.done) {
        res.json({ status: "processing", progress: null });
        return;
      }
      if (poll.error || !poll.videoUri) {
        pendingTasks.delete(taskId);
        req.log.info({ taskId, error: poll.error }, "[runway-clip] Veo 3.1 task failed — no credits charged");
        res.json({ status: "failed", error: poll.error ?? "Veo 3.1 generation failed." });
        return;
      }
      /* ── Download from Google, persist to Supabase Storage ──
         Charge happens ONLY after the clip is safely stored: if the
         download/upload fails, no credits move and the user can retry. */
      const tmpFile = path.join(os.tmpdir(), `veo-${randomUUID()}.mp4`);
      try {
        req.log.info({ taskId }, "[runway-clip] downloading clip from Veo");
        // 2026-10-12 OOM fix: stream Veo download + upload via disk —
        // the whole clip used to sit in RAM twice (download Buffer,
        // then upload).
        await downloadVeoVideoToFile(poll.videoUri, tmpFile);
        const objectName = `clips/${randomUUID()}.mp4`;
        const storageRef = await uploadFileStreamToSupabaseStorage(SUPABASE_CLIPS_BUCKET, objectName, tmpFile, "video/mp4");
        const previewUrl = await refreshSupabaseStorageUrl(storageRef);

        /* ── Charge once, guarded by pendingTasks presence ── */
        if (pending.userId === req.userId) {
          const cost = pending.credits;
          try {
            const creditsAfter = await chargeCreditsAtomic(
              req.userId!,
              cost,
              { action: "Veo Video Clip", projectId: pending.projectId ?? null },
              { rollbackOnLedgerFailure: false },
            );
            req.log.info({ taskId, userId: req.userId, creditsAfter, deducted: cost }, "[runway-clip] Veo 3.1 credits deducted");
            chargedTasks.set(taskId, { userId: req.userId!, credits: cost, refunded: false });
            setTimeout(() => chargedTasks.delete(taskId), 60 * 60 * 1000);
            await recordDurableClipCharge(req.log, taskId, req.userId!, cost, pending.projectId ?? null);
          } catch (err) {
            if (err instanceof LedgerWriteError) {
              req.log.error({ err, taskId }, "[runway-clip] CRITICAL: ledger write failed after Veo deduction");
            } else {
              req.log.error({ err, taskId }, "[runway-clip] Veo credit deduction FAILED — clip delivered without charge");
            }
          }
        } else {
          req.log.warn({ taskId }, "[runway-clip] Veo userId mismatch on poll — skipping charge");
        }
        pendingTasks.delete(taskId);

        req.log.info({ objectName, taskId }, "[runway-clip] Veo clip saved — returning storage ref + preview URL");
        res.json({ status: "succeeded", url: previewUrl, storageRef, objectPath: storageRef });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[runway-clip] Veo clip download/upload failed — no credits charged");
        res.json({ status: "failed", error: "Veo generated the clip but saving it failed. No Visual Bucs were charged — please try again." });
      } finally {
        cleanup(tmpFile);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Veo poll failed";
      req.log.error({ err: msg, taskId }, "[runway-clip] Veo poll error");
      res.status(500).json({ error: msg });
    }
    return;
  }

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
        /* Fresh credit read to avoid stale middleware value. The
           operator's completion driver has no session client (no
           browser token server-side), so it reads through the admin
           client instead — this read is informational (the charge
           itself fresh-reads inside chargeCreditsAtomic either way),
           and real requests always carry req.userSupabase, unchanged. */
        const { data: freshProfile } = await (req.userSupabase ?? getSupabaseAdmin())
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
          await recordDurableClipCharge(req.log, taskId, req.userId!, cost, projectId);
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
        // 2026-10-12 OOM fix: stream the upload from disk — readFileSync
        // used to load the entire MP4 into RAM (and block the event loop).
        const storageRef = await uploadFileStreamToSupabaseStorage(SUPABASE_CLIPS_BUCKET, objectName, tmpFile, "video/mp4");

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
};

router.get("/generate-runway-clip/:taskId", requireAuth, pollRunwayClipHandler);

/* Operator core (Phase 2 Lane E): the generate.video completion
   driver polls through this exact handler in-process (lib/rail-core)
   so an operator-started clip finishes — and is charged on success —
   by the rail's own code, not a copy of it. */
export async function runPollRunwayClip(
  deps: RailCoreDeps,
  taskId: string,
): Promise<RailCoreResult> {
  return invokeRailHandler(pollRunwayClipHandler as never, deps, { params: { taskId } });
}

export default router;
