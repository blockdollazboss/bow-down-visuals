import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();

/** 2 credits per A/B test — one GPT vision call analyzing up to 4 thumbnails. */
export const THUMBNAIL_TEST_CREDIT_COST = Number(process.env["THUMBNAIL_TEST_CREDIT_COST"]) || 2;
/** 2 credits to render an improved version ("Apply suggestions"). */
export const THUMBNAIL_IMPROVE_CREDIT_COST = Number(process.env["THUMBNAIL_IMPROVE_CREDIT_COST"]) || 2;

const MAX_THUMBNAILS = 4;
const MIN_THUMBNAILS = 2;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB per thumbnail

/** Image model for "Apply suggestions" — env-overridable, same default as stream-pack. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_THUMBNAILS },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const testMetaSchema = z.object({
  title: z.string().max(200).optional().default(""),
  niche: z.string().max(100).optional().default(""),
});

/* ── Pure, testable helpers ───────────────────────────────────────────── */

export interface ThumbnailScore {
  curiosityGap: number;
  readability: number;
  emotionalImpact: number;
  colorContrast: number;
  facePresence: number;
  overall: number;
}

export interface ThumbnailAnalysis {
  index: number;
  scores: ThumbnailScore;
  strengths: string[];
  weaknesses: string[];
  tips: string[];
}

export interface ThumbnailTestResult {
  analyses: ThumbnailAnalysis[];
  winnerIndex: number;
  confidence: number;
  reasoning: string;
  disclaimer: string;
}

const SCORE_KEYS = [
  "curiosityGap",
  "readability",
  "emotionalImpact",
  "colorContrast",
  "facePresence",
  "overall",
] as const;

function clampScore(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.min(100, Math.max(0, v));
}

function clampStrings(arr: unknown, max = 5): string[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, max);
}

/**
 * Parse and sanitize the model's JSON output into a ThumbnailTestResult.
 * Never throws — returns null when the output is unusable, so the caller
 * can refund instead of charging for garbage.
 */
export function parseTestResult(raw: string, count: number): ThumbnailTestResult | null {
  let parsed: unknown;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const rawAnalyses = obj["analyses"];
  if (!Array.isArray(rawAnalyses) || rawAnalyses.length !== count) return null;

  const analyses: ThumbnailAnalysis[] = [];
  for (let i = 0; i < rawAnalyses.length; i++) {
    const a = rawAnalyses[i] as Record<string, unknown>;
    const s = (a["scores"] ?? {}) as Record<string, unknown>;
    analyses.push({
      index: i,
      scores: {
        curiosityGap: clampScore(s["curiosityGap"]),
        readability: clampScore(s["readability"]),
        emotionalImpact: clampScore(s["emotionalImpact"]),
        colorContrast: clampScore(s["colorContrast"]),
        facePresence: clampScore(s["facePresence"]),
        overall: clampScore(s["overall"]),
      },
      strengths: clampStrings(a["strengths"], 4),
      weaknesses: clampStrings(a["weaknesses"], 4),
      tips: clampStrings(a["tips"], 5),
    });
  }

  const winnerIndex = typeof obj["winnerIndex"] === "number" ? Math.round(obj["winnerIndex"]) : 0;
  if (winnerIndex < 0 || winnerIndex >= count) return null;

  return {
    analyses,
    winnerIndex,
    confidence: clampScore(obj["confidence"]),
    reasoning: typeof obj["reasoning"] === "string" ? obj["reasoning"].slice(0, 1000) : "",
    disclaimer:
      "This is an AI prediction based on thumbnail best practices — not a guarantee of actual click-through performance. Real-world results depend on title, audience, timing, and platform.",
  };
}

/**
 * Build the vision prompt for the A/B test. Asks for strict JSON so the
 * response is machine-parseable. Frames the output as a prediction, never
 * a certainty.
 */
export function buildTestPrompt(title: string, niche: string, count: number): string {
  const contextLine =
    title || niche
      ? `Context: ${[title && `video title "${title}"`, niche && `niche "${niche}"`].filter(Boolean).join(", ")}.`
      : "";
  return [
    `You are a YouTube thumbnail strategist. You are shown ${count} thumbnail variants for the same video, in order (Thumbnail 1 … Thumbnail ${count}).`,
    contextLine,
    "",
    "Score EACH thumbnail 0-100 on:",
    "- curiosityGap: does it create an open loop / make viewers need to click to resolve it?",
    "- readability: is any text readable at small (mobile feed) size? (Score 50 if no text — neutral, not penalized.)",
    "- emotionalImpact: does the imagery trigger a strong emotion (shock, awe, desire, outrage, joy)?",
    "- colorContrast: do the subject and text pop against the background? Would it stand out in a crowded feed?",
    "- facePresence: is there a clear, expressive human face? (Score 50 if no face — neutral, not penalized.)",
    "- overall: your holistic click-worthiness score.",
    "",
    "Then pick the predicted winner and explain why. Be specific and actionable in your tips —",
    'name the exact element to change ("make the text 30% larger", "add a red arrow pointing at X"), not vague advice.',
    "",
    "IMPORTANT: this is a PREDICTION based on best practices, not a guarantee. Keep confidence honest —",
    "rarely above 85 unless one thumbnail is clearly superior on multiple dimensions.",
    "",
    "Respond with ONLY valid JSON (no markdown fences) in this exact shape:",
    "{",
    '  "analyses": [',
    "    {",
    '      "scores": { "curiosityGap": 0, "readability": 0, "emotionalImpact": 0, "colorContrast": 0, "facePresence": 0, "overall": 0 },',
    '      "strengths": ["..."],',
    '      "weaknesses": ["..."],',
    '      "tips": ["specific improvement ..."]',
    "    }",
    "  ],",
    '  "winnerIndex": 0,',
    '  "confidence": 0,',
    '  "reasoning": "why the winner wins in 2-3 sentences"',
    "}",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function toDataUrl(buffer: Buffer, mimetype: string): string {
  return `data:${mimetype};base64,${buffer.toString("base64")}`;
}

/* ── Routes ───────────────────────────────────────────────────────────── */

/**
 * POST /api/thumbnail-test
 * Multipart: thumbnails (2-4 image files), optional title + niche fields.
 * 200 { result, creditsUsed, creditsRemaining } — charged 2 credits up front,
 * refunded automatically when the AI call fails or returns unusable output.
 */
router.post(
  "/thumbnail-test",
  requireAuth,
  upload.array("thumbnails", MAX_THUMBNAILS),
  async (req: Request, res: Response) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length < MIN_THUMBNAILS) {
      res.status(400).json({
        error: "too_few_thumbnails",
        message: `Upload at least ${MIN_THUMBNAILS} thumbnails to run a test (max ${MAX_THUMBNAILS}).`,
      });
      return;
    }

    const meta = testMetaSchema.safeParse(req.body ?? {});
    const title = meta.success ? meta.data.title : "";
    const niche = meta.success ? meta.data.niche : "";

    const balance = req.userCredits ?? 0;
    if (balance < THUMBNAIL_TEST_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to run thumbnail tests.",
      });
      return;
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, THUMBNAIL_TEST_CREDIT_COST, {
        action: "Thumbnail A/B Test",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to run thumbnail tests.",
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({
          error: "ledger_write_failed",
          message: "Credit ledger write failed — no credits were charged. Please try again.",
        });
        return;
      }
      throw err;
    }

    try {
      const imageParts = files.map((f) => ({
        type: "image_url" as const,
        image_url: { url: toDataUrl(f.buffer, f.mimetype), detail: "high" as const },
      }));

      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          {
            role: "user",
            content: [
              { type: "text" as const, text: buildTestPrompt(title, niche, files.length) },
              ...imageParts,
            ],
          },
        ],
        max_completion_tokens: 2500,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      const result = parseTestResult(raw, files.length);
      if (!result) {
        throw new Error("The AI returned an unusable analysis. Your credits were refunded.");
      }

      req.log.info(
        { userId: req.userId, winnerIndex: result.winnerIndex, confidence: result.confidence },
        "[thumbnail-test] success",
      );
      res.json({ result, creditsUsed: THUMBNAIL_TEST_CREDIT_COST, creditsRemaining });
    } catch (err) {
      // Refund: the user paid for an analysis they didn't get.
      try {
        await refundCredits(req.userId!, THUMBNAIL_TEST_CREDIT_COST, {
          action: "Thumbnail A/B Test — Refund (analysis failed)",
        });
      } catch (refundErr) {
        void refundErr; // logged inside refundCredits; don't mask the original failure
      }
      const message = err instanceof Error ? err.message : "Thumbnail test failed";
      const refunded = message.includes("refunded");
      res.status(500).json({ error: refunded ? "analysis_failed_refunded" : "analysis_failed", message });
    }
  },
);

/**
 * POST /api/thumbnail-test/improve
 * Multipart: thumbnail (1 image file), tips (string).
 * Renders an improved version of the thumbnail applying the AI's suggestions.
 * 200 { imageUrl, creditsUsed, creditsRemaining } — 2 credits, refunded on failure.
 */
router.post(
  "/thumbnail-test/improve",
  requireAuth,
  upload.single("thumbnail"),
  async (req: Request, res: Response) => {
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      res.status(400).json({ error: "missing_thumbnail", message: "Upload the thumbnail to improve." });
      return;
    }
    const tips = typeof req.body?.tips === "string" ? req.body.tips.slice(0, 2000) : "";
    if (!tips.trim()) {
      res.status(400).json({ error: "missing_tips", message: "Provide the improvement tips to apply." });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < THUMBNAIL_IMPROVE_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to generate improved thumbnails.",
      });
      return;
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, THUMBNAIL_IMPROVE_CREDIT_COST, {
        action: "Thumbnail A/B Test — Apply Suggestions",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to generate improved thumbnails.",
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({
          error: "ledger_write_failed",
          message: "Credit ledger write failed — no credits were charged. Please try again.",
        });
        return;
      }
      throw err;
    }

    try {
      const imageResp = await getOpenAI().images.generate({
        model: IMAGE_MODEL,
        prompt: (
          `Recreate this YouTube thumbnail as an improved, higher-converting version. ` +
          `Keep the same subject, composition, and any text content, but apply these specific improvements: ${tips}\n\n` +
          `Style: bold, high-contrast, readable at small mobile-feed size, professional creator aesthetic. ` +
          `16:9 YouTube thumbnail. No watermarks.`
        ).slice(0, 4000),
        size: "1536x1024",
        n: 1,
      });
      const b64 = imageResp.data?.[0]?.b64_json;
      if (!b64) throw new Error("Image generation returned no image data.");

      const buffer = Buffer.from(b64, "base64");
      const objectName = `thumbnail-tests/${randomUUID()}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
      const imageUrl = await refreshSupabaseStorageUrl(storageRef);

      req.log.info({ userId: req.userId }, "[thumbnail-test] improve success");
      res.json({ imageUrl, creditsUsed: THUMBNAIL_IMPROVE_CREDIT_COST, creditsRemaining });
    } catch (err) {
      try {
        await refundCredits(req.userId!, THUMBNAIL_IMPROVE_CREDIT_COST, {
          action: "Thumbnail A/B Test — Refund (improve failed)",
        });
      } catch (refundErr) {
        void refundErr;
      }
      const message = err instanceof Error ? err.message : "Improved thumbnail generation failed";
      res.status(500).json({ error: "improve_failed", message });
    }
  },
);

export default router;
