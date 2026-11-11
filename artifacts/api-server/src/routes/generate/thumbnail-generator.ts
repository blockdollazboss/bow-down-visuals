import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { randomUUID, createHash } from "crypto";
import { toFile } from "openai";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, buildChargeIdempotencyKey, refundCreditsGuaranteed } from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import {
  attributionOptIn,
  resolveAttributionFont,
  attributionDrawtext,
  burnAttributionIntoImage,
} from "../../lib/attribution";

const router = Router();

/** Credits per generation batch (4 variations). Env-overridable without a deploy. */
const BATCH_CREDIT_COST =
  Number(process.env["THUMBNAIL_GENERATOR_CREDITS"]) || 200;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/* Served with a replayed result (C-36 honesty): the stored batch comes
   back verbatim and says an identical ask cannot be re-bought. */
const REPLAY_NOTE = "These are the thumbnails you already made for this request — tweak the prompt or style for a fresh batch.";

/** Maps the site's aspect-ratio picker to OpenAI image sizes. */
const ASPECT_SIZES: Record<string, "1536x1024" | "1024x1536"> = {
  "16:9": "1536x1024", // YouTube landscape
  "9:16": "1024x1536", // Shorts / TikTok portrait
};

/** Style presets offered in the picker — each injects art direction into the prompt. */
export const STYLE_PRESETS: Record<string, string> = {
  "bold-text-pop":
    "Bold text-pop style: huge chunky 3D headline text dominating the frame, ultra-high contrast, " +
    "vibrant saturated colors, thick outlines and drop shadows on the text, explosive energy, " +
    "YouTube clickbait aesthetic done premium",
  "shocked-face":
    "Shocked-face reaction style: extreme close-up of a face with a shocked / surprised / mind-blown expression, " +
    "wide eyes, open mouth, dramatic rim lighting, blurred high-energy background, arrow or circle graphic accents",
  "before-after":
    "Before/after split style: the frame split into two contrasting halves (dull vs vibrant, plain vs transformed), " +
    "clear visual transformation story, bold divider line, each side telling one half of the story",
  luxury:
    "Luxury style: black and gold premium aesthetic, cinematic studio lighting, elegant serif headline text, " +
    "marble / velvet / gold-foil textures, restrained composition, expensive and exclusive feel",
  gaming:
    "Gaming style: neon-drenched esports aesthetic, glowing RGB accents, dynamic action pose, " +
    "lens flares and particle effects, bold aggressive typography, dark background with electric color pops",
  vlog:
    "Vlog style: bright, friendly, approachable daytime energy, natural lighting, casual authentic feel, " +
    "clean readable headline text, warm colors, lifestyle photography look",
};

/* Multer for the optional face-photo upload (identity lock). 10 MB cap, images only. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed for the face photo."));
  },
});

interface GenerateRequest {
  prompt: string;
  stylePreset?: string;
  aspectRatio?: "16:9" | "9:16";
  overlayText?: string;
  /** Creator font library family name for the headline (art direction). */
  overlayFont?: string;
}

/**
 * Builds the full image prompt for one variation. Each of the 4 variations
 * gets a slightly different compositional twist so the batch feels like real
 * options, not copies.
 */
function buildVariationPrompt(
  base: GenerateRequest,
  variationIndex: number,
): string {
  const styleDirection =
    (base.stylePreset && STYLE_PRESETS[base.stylePreset]) || STYLE_PRESETS["bold-text-pop"];
  const compositionTwists = [
    "Composition: subject slightly left of center, headline text on the right third.",
    "Composition: tight centered composition, subject filling the frame, text stacked top and bottom.",
    "Composition: dramatic low-angle framing, subject right of center, headline text upper-left.",
    "Composition: wide cinematic framing with strong leading lines, text anchored bottom-center.",
  ];
  const twist = compositionTwists[variationIndex % compositionTwists.length];

  const parts = [
    `YouTube thumbnail, ultra high quality, designed to stop the scroll.`,
    `Subject / scene: ${base.prompt}`.slice(0, 1500),
    `Style direction: ${styleDirection}.`,
    twist,
    base.overlayText
      ? `On-image headline text (spell it EXACTLY, large and readable even at small sizes): "${base.overlayText.slice(0, 80)}".`
      : `No text on the image unless it dramatically improves click-through — keep any text to 3 words max, huge and readable.`,
    ...(base.overlayText && base.overlayFont
      ? [`Headline typeface: set the headline in a "${base.overlayFont.slice(0, 60)}" style of lettering.`]
      : []),
    `Rules: no watermarks, no logos, no blurry faces, no distorted hands, no misspelled words, ` +
      `sharp focus on the subject, professional color grade.`,
  ];
  return parts.join("\n").slice(0, 4000);
}

/* Failure refunds go through lib/credits' refundCreditsGuaranteed:
   the ledger-traced refund (balance restored AND the paired negative
   ledger row written), one loud retry, and the charge's key voided
   only when the refund landed. The local helper this replaces
   credited the profile directly via addCreditsToProfile with NO
   ledger row — the charge stood unpaired in the member's credit
   history while the failure response claimed the refund happened. */

/* ── CA-KEY replay layer ──────────────────────────────────────────────
   Every charge on this rail now carries a REAL idempotency key the
   server derives itself (buildChargeIdempotencyKey): a sane client
   key is honored, otherwise the request-intent hash IS the key. A
   replay therefore serves the stored batch — with replayed: true and
   the C-36 honesty note — instead of re-charging and re-generating.
   (REPLAY_NOTE is declared once, above.) Join15 composition: the
   durable stored-result table (migration 0333) sits in front of this
   in-process layer — the handler checks it before the balance gate
   and writes to it beside the in-process store-before-answer. */
interface ThumbnailStoredResult { body: Record<string, unknown>; at: number }
const thumbnailStoredResults = new Map<string, ThumbnailStoredResult>();
const thumbnailInFlight = new Map<string, Promise<Record<string, unknown>>>();
const THUMBNAIL_MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetThumbnailReplayCache(): void {
  thumbnailStoredResults.clear();
  thumbnailInFlight.clear();
}

/**
 * POST /api/thumbnail-generator
 * Generates 4 thumbnail variations in one batch for 2 credits.
 * Charge-before-generate: credits are deducted up front and auto-refunded
 * if generation fails before any image succeeds.
 */
/* ── Request validation ── */
const thumbnailGeneratorSchema = z.object({
  prompt: z.string().min(3, "A text prompt (3+ characters) is required.").max(2000),
  stylePreset: z.string().max(100).optional(),
  aspectRatio: z.enum(["16:9", "9:16"]).optional(),
  overlayText: z.string().max(200).optional(),
  overlayFont: z.string().max(60).optional(),
  /** Virality: opt-in "Made with Bow Down Visuals" corner credit burned post-generation (paid export → opt-in). */
  attribution: attributionOptIn(),
});

router.post(
  "/thumbnail-generator",
  requireAuth,
  upload.single("facePhoto"),
  async (req, res) => {
    const parsed = thumbnailGeneratorSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid thumbnail request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { prompt, stylePreset, aspectRatio, overlayText, overlayFont, attribution } = parsed.data;

    if (prompt.trim().length < 3) {
      res.status(400).json({ error: "A text prompt (3+ characters) is required." });
      return;
    }

    const ratio: "16:9" | "9:16" =
      aspectRatio === "9:16" ? "9:16" : "16:9";
    const size = ASPECT_SIZES[ratio];

    /* The face photo is part of the request's INTENT (its hash keys
       the charge), so it is read before any funding decision. The
       upload itself was already buffered by multer above. */
    const facePhotoBuffer = req.file?.buffer ?? null;

    /* Pre-flight provider gate: a missing OPENAI_API_KEY refuses
       BEFORE any charge. getOpenAI() throws the refusal synchronously
       when the key is absent; before this gate existed, that throw
       surfaced inside the generation loop — after the 200 VB charge —
       which is exactly the path the Nov 11 $0 probe's thumbnail
       charge took. Sibling gates (headshot-studio, photo-backdrop)
       refuse the same way, ahead of every funding decision. */
    try {
      getOpenAI();
    } catch {
      res.status(503).json({
        error: "OPENAI_API_KEY is not configured — this AI feature is unavailable.",
      });
      return;
    }

    /* Idempotency: every call carries a real server-derived key. A
       sane client per-attempt key is honored; otherwise the key is
       the INTENT hash (prompt + style + ratio + overlays +
       attribution + the face photo's hash) — the ledger dedups on
       this key, so an identical re-ask can never double-charge. */
    const clientKey = typeof (req.body as { idempotencyKey?: unknown } | null)?.idempotencyKey === "string"
      ? (req.body as { idempotencyKey: string }).idempotencyKey
      : null;
    const idempotencyKey = buildChargeIdempotencyKey(
      "thumbnail-generator", req.userId!, clientKey,
      {
        prompt: prompt.trim(),
        stylePreset: stylePreset ?? null,
        aspectRatio: ratio,
        overlayText: overlayText ?? null,
        overlayFont: overlayFont ?? null,
        attribution: attribution ?? null,
        facePhotoHash: facePhotoBuffer
          ? createHash("sha256").update(facePhotoBuffer).digest("hex")
          : null,
      },
    );

    /* Stored-result pre-check (migration 0333) BEFORE any funding —
       including the balance gate below: a replay under a landed key
       was already paid for, so it is answered from the durable row
       (stored body verbatim + replayed/replayNote) with no charge
       and no provider call, even after a server restart, and even
       if the balance has since been spent down. Fail-open: a
       storage miss or failure falls through to the charge below. */
    const stored = await findStoredGenerationResult("thumbnail-generator", idempotencyKey, req.userId!);
    if (stored) {
      res.json({ ...stored, replayed: true, replayNote: REPLAY_NOTE });
      return;
    }

    const currentCredits = req.userCredits ?? 0;
    const isDev = process.env["NODE_ENV"] === "development";
    req.log.info(
      { userId: req.userId, currentCredits, required: BATCH_CREDIT_COST, ratio },
      "[thumbnail-generator] request received",
    );
    if (!isDev && currentCredits < BATCH_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of Visual Bucs. Buy more Visual Bucs to keep creating.",
      });
      return;
    }

    const cached = thumbnailStoredResults.get(idempotencyKey);
    if (cached) {
      res.json({ ...cached.body, replayed: true, replayNote: REPLAY_NOTE });
      return;
    }

    const pending = thumbnailInFlight.get(idempotencyKey);
    if (pending) {
      const twinBody = await pending.catch(() => null);
      if (twinBody && typeof twinBody["__status"] !== "number") {
        res.json({ ...twinBody, replayed: true, replayNote: REPLAY_NOTE });
        return;
      }
      /* The twin failed (refunded + key voided) — fall through fresh. */
    }

    const run = runThumbnailBatch(req, {
      prompt: prompt.trim(),
      stylePreset,
      ratio,
      size,
      overlayText,
      overlayFont,
      attribution,
      facePhotoBuffer,
      idempotencyKey,
    });
    thumbnailInFlight.set(idempotencyKey, run);
    let body: Record<string, unknown>;
    try {
      body = await run;
    } finally {
      if (thumbnailInFlight.get(idempotencyKey) === run) thumbnailInFlight.delete(idempotencyKey);
    }

    if (typeof body["__status"] === "number") {
      const status = body["__status"] as number;
      const { __status: _ignored, ...errorBody } = body;
      res.status(status).json(errorBody);
      return;
    }

    /* Store BEFORE answering (contracts/post-assist pattern), fail-open. */
    try {
      if (thumbnailStoredResults.size >= THUMBNAIL_MAX_STORED_RESULTS) {
        const oldest = thumbnailStoredResults.keys().next().value as string | undefined;
        if (oldest !== undefined) thumbnailStoredResults.delete(oldest);
      }
      thumbnailStoredResults.set(idempotencyKey, { body, at: Date.now() });
      /* Durable twin of the in-process store (migration 0333): the
         row is what a post-restart replay is served from. Fail-open
         inside the helper — never fails this paid success. */
      await storeGenerationResult("thumbnail-generator", idempotencyKey, req.userId!, { ...body });
    } catch { /* storing is best-effort */ }

    const postCharge = thumbnailStoredResults.get(idempotencyKey);
    if (postCharge && postCharge.body !== body) {
      res.json({ ...postCharge.body, replayed: true, replayNote: REPLAY_NOTE });
      return;
    }

    res.json(body);
  },
);

/**
 * Charge → generate → (refund + void on failure) for one batch. Runs
 * under the handler's in-flight registration so a concurrent twin waits
 * for this run instead of double-charging.
 */
async function runThumbnailBatch(
  req: { userId?: string; file?: { mimetype: string }; log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void } },
  input: {
    prompt: string;
    stylePreset?: string;
    ratio: "16:9" | "9:16";
    size: "1536x1024" | "1024x1536";
    overlayText?: string;
    overlayFont?: string;
    attribution?: unknown;
    facePhotoBuffer: Buffer | null;
    idempotencyKey: string;
  },
): Promise<Record<string, unknown>> {
  const { prompt, stylePreset, ratio, size, overlayText, overlayFont, attribution, facePhotoBuffer, idempotencyKey } = input;
    /* Charge up front — refunded below if nothing generates.
       P0-23: strict ledger + idempotency via chargeCredits. */
    const creditsAfter = await chargeCredits(
      req.userId!,
      BATCH_CREDIT_COST,
      { action: "thumbnail_batch_generate" },
      { idempotencyKey, personalOnly: true },
    );

    const images: Array<{ url: string; variation: number }> = [];

    try {
      for (let i = 0; i < 4; i++) {
        const imagePrompt = buildVariationPrompt(
          { prompt, stylePreset, aspectRatio: ratio, overlayText, overlayFont },
          i,
        );

        let b64: string | undefined;
        if (facePhotoBuffer) {
          /* Identity lock: edit the uploaded face photo instead of inventing a face. */
          const faceFile = await toFile(facePhotoBuffer, "face-reference.png", {
            type: req.file!.mimetype,
          });
          const lockedPrompt =
            `Using the exact person shown in the reference photo (same face, skin tone, identity — ` +
            `do not change who they are), create this YouTube thumbnail scene: ${imagePrompt}`.slice(0, 4000);
          const editResp = await getOpenAI().images.edit({
            model: IMAGE_MODEL,
            image: faceFile,
            prompt: lockedPrompt,
            size,
            n: 1,
          });
          b64 = editResp.data?.[0]?.b64_json;
        } else {
          const imageResp = await getOpenAI().images.generate({
            model: IMAGE_MODEL,
            prompt: imagePrompt,
            size,
            quality: "high",
            n: 1,
          });
          b64 = imageResp.data?.[0]?.b64_json;
        }

        if (!b64) {
          throw new Error(`Variation ${i + 1} returned no image data.`);
        }

        const objectName = `thumbnail-generator/${randomUUID()}.png`;
        let imageBuffer: Buffer = Buffer.from(b64, "base64");
        /* Virality: opt-in quiet corner credit burned post-generation (paid export → opt-in). */
        if (attribution) {
          const outW = ratio === "9:16" ? 1024 : 1536;
          imageBuffer = await burnAttributionIntoImage(imageBuffer, outW);
        }
        const storageRef = await uploadMediaToSupabaseStorage(
          objectName,
          imageBuffer,
          "image/png",
        );
        const url = await refreshSupabaseStorageUrl(storageRef);
        images.push({ url, variation: i + 1 });
        req.log.info(
          { userId: req.userId, variation: i + 1 },
          "[thumbnail-generator] variation complete",
        );
      }
    } catch (err: unknown) {
      /* Auto-refund, GUARANTEED: the ledger-traced refund, retried
         exactly once on failure, with the charge's idempotency key
         voided only when the refund landed. (CA-KEY: without the
         void the refunded key still read as "already charged", so
         the retry was suppressed as a replay and generated FREE;
         voiding on an UNLANDED refund would double-charge instead.)
         The response reports the refund's REAL outcome — it claimed
         creditsRefunded: true unconditionally before this fix. */
      const refunded = await refundCreditsGuaranteed(
        req.userId!,
        BATCH_CREDIT_COST,
        { action: "thumbnail_batch_generate — Refund" },
        { idempotencyKey },
      );
      const message = err instanceof Error ? err.message : "Thumbnail generation failed";
      if (refunded) {
        req.log.error(
          { userId: req.userId, err: message, completedVariations: images.length },
          "[thumbnail-generator] batch failed — Visual Bucs refunded",
        );
      } else {
        req.log.error(
          { userId: req.userId, err: message, completedVariations: images.length },
          "[thumbnail-generator] CRITICAL: batch failed AND the refund could not be landed after retry — charge stands, flagged for reconciliation",
        );
      }
      return {
        __status: 500,
        error: message,
        creditsRefunded: refunded,
        partialImages: images,
      };
    }

    /* Ledger row already written by chargeCredits above (Stack400 Lane 4 duplicate removed). */

    req.log.info(
      { userId: req.userId, creditsAfter, variations: images.length },
      "[thumbnail-generator] batch success",
    );

    return {      images,
      attribution,
      creditsUsed: BATCH_CREDIT_COST,
      creditsRemaining: creditsAfter,
      aspectRatio: ratio,
    };
}
export default router;
