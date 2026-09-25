import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── AI Media Detector ──────────────────────────────────────────────────
   Upload an image, video, or audio file (or paste a URL) and GPT-6 Sol
   forensically analyzes it for AI-generation tells: unnatural skin texture,
   inconsistent lighting, warped hands/text, repetitive patterns, compression
   anomalies for images; per-frame artifact analysis for video (frames are
   extracted client-side via canvas); codec/metadata anomaly analysis for
   audio.

   2 credits per analysis — env-overridable. Charge-before-analyze with
   auto-refund on failure (mirrors the contract-analyzer pattern).

   Honest framing: this is an AI-assisted assessment, not a definitive
   forensic verdict. Sophisticated generations can fool any detector. */

const router = Router();

/* 2 credits per detection — env-overridable. One structured GPT-6 completion. */
const DETECTION_CREDITS = Number(process.env["MEDIA_DETECTION_CREDIT_COST"]) || 2;
export { DETECTION_CREDITS };

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const MAX_FRAMES = 3;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/") ||
      file.mimetype.startsWith("audio/") ||
      /\.(png|jpe?g|webp|gif|bmp|mp4|mov|webm|m4a|mp3|wav|ogg|flac)$/i.test(file.originalname);
    cb(null, ok);
  },
});

const jsonBodySchema = z.object({
  mediaUrl: z.string().url().max(2000).optional(),
  frames: z.array(z.string().max(8_000_000)).max(MAX_FRAMES).optional(),
  fileName: z.string().max(255).optional(),
  mimeType: z.string().max(100).optional(),
  audioMetadata: z
    .object({
      durationSec: z.number().optional(),
      bitrate: z.number().optional(),
      sampleRate: z.number().optional(),
      channels: z.number().optional(),
      codec: z.string().max(60).optional(),
    })
    .optional(),
});

type MediaKind = "image" | "video" | "audio";

function kindFromMime(mime: string): MediaKind | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

const IMAGE_SYSTEM_PROMPT = `You are a forensic media analyst specializing in detecting AI-generated imagery. Analyze the provided image and determine whether it was likely created by a generative AI model (diffusion models, GANs, etc.) or captured/created by a human (photo, digital art, 3D render made by a human artist).

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "verdict": "<likely_ai|likely_human|uncertain>",
  "confidence": <0-100 integer>,
  "summary": "<2-3 sentence explanation of your verdict in plain language>",
  "signals": [
    { "name": "<short signal name, e.g. 'Unnatural skin texture'>", "description": "<1-2 sentence plain-English explanation of what you observed>", "severity": "<low|medium|high>", "supportsAi": <true if this signal points toward AI generation, false if it points toward human creation> }
  ]
}

What to examine — be specific and cite what you actually see, not generic possibilities:
- Human anatomy: hands (finger count, merging, joints), ears, teeth, eyes (gaze direction, reflections, asymmetry)
- Skin: overly smooth/plastic texture, waxy pores, unnatural subsurface scattering
- Text/logos: garbled, warped, misspelled, or melted lettering
- Backgrounds: warped architecture, impossible geometry, melting objects, inconsistent perspective
- Lighting: shadows pointing in contradictory directions, reflections that don't match the scene
- Repetitive patterns: tiling artifacts, cloned textures, symmetric details that shouldn't be symmetric
- Photographic realism cues: natural sensor noise/grain, depth of field falloff, chromatic aberration, motion blur consistency
- Composition: "too perfect" studio lighting on every element, uncanny symmetry

Rules:
- "uncertain" with moderate confidence is an honest answer when evidence is mixed — do not force a verdict.
- Confidence should reflect evidence strength: 90+ only for overwhelming artifact evidence or clearly authentic photographic traits.
- Every signal must describe something observable in THIS image, not a hypothetical.
- If the image is obviously a cartoon, illustration, or 3D render, judge whether the underlying artwork looks AI-generated vs human-made, and say so.`;

const VIDEO_SYSTEM_PROMPT = `You are a forensic media analyst specializing in detecting AI-generated video. You are given up to 3 frames extracted from a video (start, middle, end). Analyze them for AI-generation tells.

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "verdict": "<likely_ai|likely_human|uncertain>",
  "confidence": <0-100 integer>,
  "summary": "<2-3 sentence explanation of your verdict in plain language>",
  "signals": [
    { "name": "<short signal name>", "description": "<1-2 sentence plain-English explanation of what you observed>", "severity": "<low|medium|high>", "supportsAi": <true|false> }
  ],
  "frameNotes": ["<optional per-frame observation>"]
}

What to examine across the frames:
- Temporal consistency: does the subject's face/clothing/background stay coherent across frames, or morph subtly?
- Anatomy artifacts per frame: hands, faces, teeth, eyes
- Background warping or "breathing" (subtle morphing of static elements)
- Texture flicker or shimmer on surfaces that should be stable
- Unnatural motion smoothness vs. authentic camera micro-jitter
- Lighting consistency across frames
- Watermarks or style signatures of known generators

Rules:
- Note explicitly that frame-based analysis cannot detect audio or full-motion tells — state this limitation in the summary when relevant.
- "uncertain" is honest when frames are low-resolution or evidence is mixed.
- Every signal must describe something observable in THESE frames.`;

const AUDIO_SYSTEM_PROMPT = `You are a forensic audio analyst. You are given technical metadata extracted from an audio file plus optional creator context. Assess whether the audio was likely AI-generated (AI voice clone, AI music, AI voiceover) or human-created (recorded performance, human voice).

IMPORTANT LIMITATION: you cannot hear the audio. Base your assessment ONLY on the metadata provided and known patterns. Be explicit about this limitation.

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "verdict": "<likely_ai|likely_human|uncertain>",
  "confidence": <0-100 integer>,
  "summary": "<2-3 sentence explanation, explicitly noting this is a metadata-based assessment, not a listening test>",
  "signals": [
    { "name": "<short signal name>", "description": "<1-2 sentence plain-English explanation>", "severity": "<low|medium|high>", "supportsAi": <true|false> }
  ]
}

Metadata patterns to weigh:
- AI voice/music generators often export at specific sample rates and bitrates (e.g. 44100 Hz MP3, 24000 Hz for some voice models)
- Missing or stripped ID3/metadata tags vs. rich DAW export metadata
- Duration patterns: AI generations often come in fixed lengths (exact 30s, 60s clips)
- Codec/container combinations unusual for human studio exports
- File naming patterns suggesting generator exports

Rules:
- Cap confidence at 70 for metadata-only audio assessments — never claim certainty without hearing the audio.
- Default to "uncertain" when metadata is generic or inconclusive.
- Recommend the creator listen for robotic prosody, unnatural breaths, and overly clean isolation as follow-up checks.`;

/** Fetch a remote image URL server-side (first-party http/https only, 15MB cap). */
async function fetchImageFromUrl(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`URL did not return an image (got ${contentType || "unknown"})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) throw new Error("Remote image exceeds 15MB");
    return { buffer: buf, mime: contentType.split(";")[0]!.trim() };
  } finally {
    clearTimeout(timer);
  }
}

function bufferToDataUrl(buffer: Buffer, mime: string): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

router.post("/media", requireAuth, publicApiLimiter, upload.single("file"), async (req, res) => {
  let charged = false;
  try {
    const file = (req as Express.Request & { file?: Express.Multer.File }).file;
    let body: z.infer<typeof jsonBodySchema> = {};
    if (file) {
      // multipart: frames may arrive as a JSON string field
      const rawFrames = (req.body as Record<string, unknown>)?.["frames"];
      if (typeof rawFrames === "string") {
        try {
          const parsed = JSON.parse(rawFrames);
          if (Array.isArray(parsed)) body.frames = parsed.filter((f) => typeof f === "string");
        } catch {
          /* ignore malformed frames field */
        }
      }
      const rawMeta = (req.body as Record<string, unknown>)?.["audioMetadata"];
      if (typeof rawMeta === "string") {
        try {
          body.audioMetadata = JSON.parse(rawMeta);
        } catch {
          /* ignore */
        }
      }
    } else {
      const parsed = jsonBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
        return;
      }
      body = parsed.data;
    }

    // ── Determine media kind and build the vision payload ──
    let kind: MediaKind | null = null;
    let imageDataUrls: string[] = [];
    let systemPrompt = IMAGE_SYSTEM_PROMPT;
    let userText = "";
    let label = "media";

    if (file) {
      kind = kindFromMime(file.mimetype);
      label = file.originalname || file.mimetype;
      if (!kind) {
        res.status(400).json({ error: "unsupported_type", message: "Upload an image, video, or audio file." });
        return;
      }
      if (kind === "image") {
        imageDataUrls = [bufferToDataUrl(file.buffer, file.mimetype)];
      } else if (kind === "video") {
        const frames = (body.frames ?? []).filter((f) => f.startsWith("data:image/")).slice(0, MAX_FRAMES);
        if (frames.length === 0) {
          res.status(400).json({
            error: "no_frames",
            message: "Video analysis needs frames — extract them in the app and retry.",
          });
          return;
        }
        imageDataUrls = frames;
        systemPrompt = VIDEO_SYSTEM_PROMPT;
        userText = `Video file: ${label} (${file.mimetype}, ${(file.size / 1024 / 1024).toFixed(1)}MB). ${frames.length} frames extracted (start/middle/end).`;
      } else {
        systemPrompt = AUDIO_SYSTEM_PROMPT;
        const meta = body.audioMetadata ?? {};
        userText =
          `Audio file: ${label} (${file.mimetype}, ${(file.size / 1024).toFixed(0)}KB). ` +
          `Metadata — duration: ${meta.durationSec ?? "?"}s, bitrate: ${meta.bitrate ?? "?"}kbps, ` +
          `sample rate: ${meta.sampleRate ?? "?"}Hz, channels: ${meta.channels ?? "?"}, codec: ${meta.codec ?? "?"}.`;
      }
    } else if (body.mediaUrl) {
      // URL path: fetch server-side, must be an image
      let fetched;
      try {
        fetched = await fetchImageFromUrl(body.mediaUrl);
      } catch (e) {
        res.status(400).json({ error: "fetch_failed", message: e instanceof Error ? e.message : "Could not fetch URL." });
        return;
      }
      kind = "image";
      label = body.mediaUrl;
      imageDataUrls = [bufferToDataUrl(fetched.buffer, fetched.mime)];
      userText = `Image fetched from URL: ${body.mediaUrl}`;
    } else if (body.frames && body.frames.length > 0) {
      const frames = body.frames.filter((f) => f.startsWith("data:image/")).slice(0, MAX_FRAMES);
      if (frames.length === 0) {
        res.status(400).json({ error: "invalid_frames", message: "Frames must be image data URLs." });
        return;
      }
      kind = "video";
      label = body.fileName || "video frames";
      imageDataUrls = frames;
      systemPrompt = VIDEO_SYSTEM_PROMPT;
      userText = `${frames.length} video frames provided for analysis (${label}).`;
    } else if (body.audioMetadata) {
      kind = "audio";
      label = body.fileName || "audio file";
      systemPrompt = AUDIO_SYSTEM_PROMPT;
      const meta = body.audioMetadata;
      userText =
        `Audio file: ${label}${body.mimeType ? ` (${body.mimeType})` : ""}. ` +
        `Metadata — duration: ${meta.durationSec ?? "?"}s, bitrate: ${meta.bitrate ?? "?"}kbps, ` +
        `sample rate: ${meta.sampleRate ?? "?"}Hz, channels: ${meta.channels ?? "?"}, codec: ${meta.codec ?? "?"}.`;
    } else {
      res.status(400).json({
        error: "no_media",
        message: "Upload a file, paste a media URL, or provide video frames / audio metadata.",
      });
      return;
    }

    // ── Charge before analysis ──
    await chargeCredits(req.userId!, DETECTION_CREDITS, { action: "AI Media Detection" });
    charged = true;

    // ── Build the AI request ──
    const openai = getOpenAI();
    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } };
    const content: ContentPart[] = [];
    if (userText) content.push({ type: "text", text: userText });
    for (const url of imageDataUrls) {
      content.push({ type: "image_url", image_url: { url } });
    }
    if (content.length === 0) {
      content.push({ type: "text", text: "Analyze the provided media for AI-generation tells." });
    }

    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2500,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let detection: Record<string, unknown>;
    try {
      detection = JSON.parse(raw);
    } catch {
      throw new Error("AI returned unparseable detection result");
    }

    const verdict = detection["verdict"];
    if (verdict !== "likely_ai" && verdict !== "likely_human" && verdict !== "uncertain") {
      throw new Error("AI returned an invalid verdict");
    }

    res.json({
      detection,
      mediaKind: kind,
      label,
      creditsCharged: DETECTION_CREDITS,
      disclaimer:
        "This is an AI-assisted assessment, not a definitive forensic verdict. Sophisticated AI generations can fool any detector — treat high-stakes decisions accordingly.",
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, DETECTION_CREDITS, {
          action: "AI Media Detection (refund: analysis failed)",
        });
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[media-detector] refund failed");
      }
    }
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    logger.error({ err }, "[media-detector] detection failed");
    res.status(500).json({ error: "detection_failed" });
  }
});

export default router;
