/**
 * video-translator.ts — AI Video Translator backend.
 *
 *  POST /api/video-translator/languages  list supported target languages + pricing
 *  POST /api/video-translator/translate  upload video + target languages → dubbed videos
 *  GET  /api/video-translator/jobs/:jobId poll a translation job
 *
 * Pipeline (server-owned background job, no tab dependency):
 *   1. ffmpeg extracts audio from the uploaded video
 *   2. Whisper transcribes with word-level timestamps
 *   3. GPT-6 translates the transcript into each target language
 *      (uses the completions token parameter GPT-6 requires)
 *   4. ElevenLabs multilingual TTS dubs each translation with the chosen voice
 *   5. ffmpeg muxes each dubbed track under the original video
 *   6. SRT subtitle files are generated per language (free to download)
 *
 * Pricing: 5 credits per minute per language (env-overridable via
 * VIDEO_TRANSLATOR_CREDITS_PER_MINUTE). Charge-before-generate; automatic
 * refund on transcription / translation / TTS / muxing failure.
 *
 * Honest framing (also in the UI): this is AI dubbing, not human
 * translation — users should review before publishing.
 */
import { randomUUID, createHash } from "crypto";
import { execFile } from "child_process";
import { createReadStream, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Request, Response, Router, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  refundCreditsGuaranteed,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import { deterministicJobId, findJobCreateReplay, storeCompletedJobResult } from "./ca6-replay-guard";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { transcribeAudioTimed } from "../../lib/transcription";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import {
  attributionOptIn,
  resolveAttributionFont,
  attributionDrawtext,
} from "../../lib/attribution";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { DurableJobStore } from "../../lib/durable-job-store";
import { tmpUploadStorage, createAdminAwareUpload } from "../../lib/upload-storage";
import {
  DUB_CAPTION_LANGUAGES,
  isDubCaptionLanguage,
  dubCaptionLanguageLabel,
} from "../../lib/dub-caption-languages";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing ─────────────────────────────────────────────────────────── */

/** Credits charged per minute of source video, per target language. */
export const VIDEO_TRANSLATOR_CREDITS_PER_MINUTE =
  Number(process.env["VIDEO_TRANSLATOR_CREDITS_PER_MINUTE"]) || 500;

const VIDEO_TRANSLATOR_MAX_BYTES = 80 * 1024 * 1024; // 80 MB
const WHISPER_MAX_BYTES = 24 * 1024 * 1024; // 24 MB — chunk past this
const WHISPER_TIMEOUT_MS = 240_000;
const TTS_TIMEOUT_MS = 180_000;

/* ── Supported languages ───────────────────────────────────────────────
 * The canonical catalog lives in lib/dub-caption-languages.ts and is
 * shared with video-dub + translate-captions (ONE list for UI +
 * validation; widened to 15 with English added here). The exports below
 * keep this route's established shape for its importers/tests. */

export interface TargetLanguage {
  code: string;
  label: string;
  elevenLabsCode: string; // BCP-47 hint for multilingual TTS
}

export const TARGET_LANGUAGES: TargetLanguage[] = DUB_CAPTION_LANGUAGES.map((l) => ({
  code: l.code,
  label: l.label,
  elevenLabsCode: l.elevenLabsCode,
}));

export function isSupportedLanguage(code: string): boolean {
  return isDubCaptionLanguage(code);
}

export function languageLabel(code: string): string {
  return dubCaptionLanguageLabel(code);
}

/* ── Cost estimation (shared with frontend lib — keep in sync) ───────── */

interface TranslateEstimate {
  billableMinutes: number;
  languageCount: number;
  credits: number;
}

export function estimateTranslateCost(durationSec: number, languageCount: number): TranslateEstimate {
  const billableMinutes = Math.max(1, Math.ceil(durationSec / 60));
  return {
    billableMinutes,
    languageCount,
    credits: billableMinutes * languageCount * VIDEO_TRANSLATOR_CREDITS_PER_MINUTE,
  };
}

/* ── Transcript types ────────────────────────────────────────────────── */

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/* ── SRT generation (exported for tests) ─────────────────────────────── */

function srtTimestamp(sec: number): string {
  // Round to whole milliseconds first to avoid float artifacts
  // (e.g. 65.1 % 1 === 0.09999999999999432).
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const secInt = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, len: number) => String(n).padStart(len, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(secInt, 2)},${pad(ms, 3)}`;
}

export function buildSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, i) => `${i + 1}\n${srtTimestamp(seg.start)} --> ${srtTimestamp(seg.end)}\n${seg.text}\n`)
    .join("\n");
}

/* ── Translation prompt (exported for tests) ─────────────────────────── */

export function buildTranslationPrompt(
  segments: TranscriptSegment[],
  targetLabel: string,
): string {
  const numbered = segments.map((s, i) => `${i + 1}. ${s.text}`).join("\n");
  return (
    `Translate the following video transcript lines into ${targetLabel}. ` +
    `Keep the same line numbering and order. Translate naturally for spoken dubbing — ` +
    `concise, conversational, matching the tone. Return ONLY the numbered translated lines, ` +
    `one per line, in the format "N. translated text".\n\n${numbered}`
  );
}

/**
 * Parse the model's numbered-line response back into plain strings.
 * Falls back to raw lines when numbering is missing.
 */
export function parseTranslatedLines(response: string, expectedCount: number): string[] {
  const lines = response
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\d+\.\s*(.*)$/);
    parsed.push(m ? m[1].trim() : line);
  }
  // Never return more than expected; pad shortfalls with empty strings
  // so segment alignment stays positional.
  while (parsed.length < expectedCount) parsed.push("");
  return parsed.slice(0, expectedCount);
}

/* ── Job store (in-memory; server-owned, not tab-dependent) ───────────── */

export type TranslateJobStatus = "queued" | "processing" | "done" | "failed";

export interface TranslatedOutput {
  language: string;
  label: string;
  videoUrl: string | null;
  videoRef: string | null;
  srtUrl: string | null;
  srtRef: string | null;
  error: string | null;
}

export interface TranslateJob {
  id: string;
  userId: string;
  status: TranslateJobStatus;
  languages: string[];
  sourceName: string;
  durationSec: number | null;
  outputs: TranslatedOutput[];
  error: string | null;
  creditsCharged: number;
  createdAt: number;
  /** Virality: opt-in "Made with Bow Down Visuals" tag burned into the dubbed videos (paid export → opt-in). */
  attribution?: boolean;
  /* CA-6: the charge's idempotency key + the create-time balance, so
     the async runner can void on refund and the create body can be
     stored/replayed verbatim. */
  idempotencyKey?: string;
  creditsRemaining?: number;
  /** Durable jobs (0335): the exactly-once refund claim for the
   *  full-failure refund — claimed in the persisted row before the
   *  refund moves. (Partial-success refunds keep their own path:
   *  they land once, at the end of a completed run.) */
  creditsRefunded?: boolean;
  /** Durable jobs (0335): the worker's inputs, persisted with the job
   *  so a worker resumed after a restart re-runs the exact ask. The
   *  upload is disk-backed; if the file did not survive, the job
   *  settles (failed + refunded exactly once). */
  workerInput?: { uploadedPath: string; originalName: string; voiceId: string };
}

const jobs = new Map<string, TranslateJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

/* ── Durable job storage (migration 0335) ─────────────────────────
   The Map above is the working cache; generation_jobs is the
   record. Jobs persist at creation, mirror on settle, and a lookup
   that misses the Map rehydrates from the table — a job survives
   a server restart: its worker resumes from the persisted upload
   path when the file survived, and settles (failed + refunded
   exactly once, claim first) when it did not. Fail-open throughout
   (lib/generation-jobs). */
const jobStore = new DurableJobStore<TranslateJob>(jobs, {
  rail: "video-translator",
  statusOf: (j) => j.status,
  isTerminalStatus: (s) => s === "done" || s === "failed",
  setFailed: (j, error) => {
    j.status = "failed";
    j.error = error;
  },
  amountOf: (j) => j.creditsCharged,
  chargeKeyOf: (j) => j.idempotencyKey ?? null,
  refundAction: "AI Video Translator — Refund (job failed)",
  settleError: "Translation was interrupted by a server restart — your Visual Bucs were refunded.",
  resume: async (job) => {
    const input = job.workerInput;
    if (!input) return false;
    const survived = await fs.access(input.uploadedPath).then(
      () => true,
      () => false,
    );
    if (!survived) return false;
    void runTranslateJob(job, input.uploadedPath, input.originalName, input.voiceId);
    return true;
  },
});


/** Test hook: clear the in-memory job store. */
export function __clearTranslateJobs(): void {
  jobs.clear();
}

/* ── Provider helpers ────────────────────────────────────────────────── */

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

function ttsModel(): string {
  return process.env["ELEVENLABS_TTS_MODEL"] || "eleven_v4";
}

async function probeDurationSec(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputPath],
      { timeout: 30_000 },
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

async function extractAudio(inputPath: string, audioPath: string): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "128k", audioPath],
    { timeout: 300_000 },
  );
}

async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
): Promise<TranscriptSegment[]> {
  const result = await transcribeAudioTimed({
    buffer: audioBuffer,
    filename,
    mimeType: "audio/mpeg",
    signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
  });
  return (result.segments ?? [])
    .filter((s) => s.text && s.text.trim().length > 0)
    .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
}

async function translateSegments(
  segments: TranscriptSegment[],
  targetCode: string,
): Promise<string[]> {
  const target = TARGET_LANGUAGES.find((l) => l.code === targetCode);
  if (!target) throw new Error(`Unsupported language: ${targetCode}`);
  const prompt = buildTranslationPrompt(segments, target.label);
  const completion = await getOpenAI().chat.completions.create(
    {
      model: getTextModel(),
      max_completion_tokens: 4000,
      messages: [
        {
          role: "system",
          content:
            "You are a professional dubbing translator. Translate for natural spoken delivery.",
        },
        { role: "user", content: prompt },
      ],
    },
    { signal: AbortSignal.timeout(120_000) },
  );
  const text = completion.choices[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error(`Translation to ${target.label} returned empty output`);
  return parseTranslatedLines(text, segments.length);
}

async function synthesizeSpeech(
  text: string,
  voiceId: string,
  languageCode: string,
): Promise<Buffer> {
  const apiKey = elevenKey();
  if (!apiKey) throw new Error("Voice service is not configured on this server.");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ttsModel(),
        language_code: languageCode,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error({ status: res.status, errText: errText.slice(0, 300) }, "video-translator: TTS failed");
    throw new Error(`Dubbing voice generation failed (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Dubbing voice generation returned empty audio");
  return buf;
}

/** ffprobe: read the width of the first video stream (for the attribution tag sizing). */
async function probeVideoWidth(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", inputPath],
      { timeout: 30_000 },
    );
    const w = parseInt(stdout.trim(), 10);
    return Number.isFinite(w) && w > 0 ? w : null;
  } catch {
    return null;
  }
}

interface MuxDubbedOpts {
  /** Virality: burn the gold "Made with Bow Down Visuals" tag (opt-in; paid export). */
  attribution?: boolean;
  /** Resolved fontfile for the attribution tag; falls back to no tag when null. */
  attributionFontfile?: string | null;
  /** Output video width in px for tag sizing; probed per job when omitted. */
  outputWidth?: number;
}

async function muxDubbedVideo(
  videoPath: string,
  dubbedAudioPath: string,
  outputPath: string,
  opts: MuxDubbedOpts = {},
): Promise<void> {
  const args: string[] = [
    "-y",
    "-i", videoPath,
    "-i", dubbedAudioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
  ];
  if (opts.attribution && opts.attributionFontfile) {
    // The tag needs a filter pass, so the video stream is re-encoded
    // (otherwise it stays a straight -c:v copy).
    args.push(
      "-vf", attributionDrawtext(opts.attributionFontfile, opts.outputWidth ?? 1280),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    );
  } else {
    args.push("-c:v", "copy");
  }
  args.push("-c:a", "aac", "-b:a", "192k", "-shortest", outputPath);
  await execFileAsync("ffmpeg", args, { timeout: 600_000 });
}

/* ── Background worker ───────────────────────────────────────────────── */

export async function runTranslateJob(
  job: TranslateJob,
  uploadedPath: string,
  originalName: string,
  voiceId: string,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "translate-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);

  try {
    job.status = "processing";
    await fs.copyFile(uploadedPath, inputPath); // 2026-10-12 OOM fix: upload is disk-backed, never a RAM Buffer

    const durationSec = await probeDurationSec(inputPath);
    job.durationSec = durationSec;

    // 1. Extract audio
    const audioPath = join(workDir, "audio.mp3");
    await extractAudio(inputPath, audioPath);
    const audioBuffer = await fs.readFile(audioPath);

    // 2. Transcribe
    const segments = await transcribeAudio(audioBuffer, "audio.mp3");
    if (segments.length === 0) {
      throw new Error("No speech detected in this video — nothing to translate.");
    }

    // Virality: resolve the attribution font once for the burn (opt-in; paid export).
    const attributionFontfile = job.attribution ? await resolveAttributionFont() : null;
    const attributionWidth =
      job.attribution && attributionFontfile
        ? (await probeVideoWidth(inputPath)) ?? undefined
        : undefined;

    // 3–6. Per language: translate → TTS → mux → SRT → upload
    for (const langCode of job.languages) {
      const output = job.outputs.find((o) => o.language === langCode)!;
      try {
        const translatedTexts = await translateSegments(segments, langCode);
        const translatedSegments = segments.map((s, i) => ({
          ...s,
          text: translatedTexts[i] || s.text,
        }));

        // SRT (free artifact, always generated)
        const srt = buildSrt(translatedSegments);
        const srtRef = await uploadMediaToSupabaseStorage(
          `translate/${job.userId}/${job.id}-${langCode}.srt`,
          Buffer.from(srt, "utf-8"),
          "application/x-subrip",
        );
        output.srtRef = srtRef;
        output.srtUrl = await refreshSupabaseStorageUrl(srtRef);

        // Dubbed audio: join translated lines with pauses, synthesize in one call
        // per language (keeps TTS calls bounded; per-segment synthesis is a
        // follow-up for tighter lip alignment).
        const dubScript = translatedTexts.filter(Boolean).join(" ... ");
        const target = TARGET_LANGUAGES.find((l) => l.code === langCode)!;
        const dubbedAudio = await synthesizeSpeech(dubScript, voiceId, target.elevenLabsCode);
        const dubbedPath = join(workDir, `dub-${langCode}.mp3`);
        await fs.writeFile(dubbedPath, dubbedAudio);

        // Mux under original video
        const outPath = join(workDir, `dubbed-${langCode}.mp4`);
        await muxDubbedVideo(inputPath, dubbedPath, outPath, {
          attribution: job.attribution,
          attributionFontfile,
          outputWidth: attributionWidth,
        });
        const outBuffer = await fs.readFile(outPath);
        const videoRef = await uploadMediaToSupabaseStorage(
          `translate/${job.userId}/${job.id}-${langCode}.mp4`,
          outBuffer,
          "video/mp4",
        );
        output.videoRef = videoRef;
        output.videoUrl = await refreshSupabaseStorageUrl(videoRef);
      } catch (langErr) {
        output.error =
          langErr instanceof Error ? langErr.message : `Failed to dub ${languageLabel(langCode)}`;
        logger.error({ langErr, langCode }, "video-translator: language failed");
      }
    }

    const succeeded = job.outputs.filter((o) => o.videoUrl);
    if (succeeded.length === 0) {
      throw new Error(job.outputs[0]?.error ?? "Translation failed for all languages.");
    }
    job.status = "done";
    /* CA-6: persist the create body durably at success (a partial
       success still landed the job) so a replayed create after a
       restart is served from the store. Fail-open. Partial refunds
       below do NOT void the key — the charge partly stands. */
    if (job.idempotencyKey) {
      await storeCompletedJobResult("video-translator", job.idempotencyKey, job.userId, {
        jobId: job.id,
        status: "queued",
        languages: job.languages,
        attribution: job.attribution,
        creditsCharged: job.creditsCharged,
        creditsRemaining: job.creditsRemaining,
      });
    }
    if (succeeded.length < job.outputs.length) {
      // Partial success: refund proportionally for failed languages.
      const failedCount = job.outputs.length - succeeded.length;
      const perLang = Math.round(job.creditsCharged / job.outputs.length);
      const refundAmount = Math.min(job.creditsCharged, perLang * failedCount);
      if (refundAmount > 0) {
        /* Guaranteed refund (charge-on-failure lane): retried once
           on failure and logged at CRITICAL if it cannot land — the
           log-only catch this replaces left a failed partial refund
           with no second attempt. */
        await refundCreditsGuaranteed(job.userId, refundAmount, {
          action: `AI Video Translator — Partial refund (${failedCount} language(s) failed)`,
        });
      }
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Translation failed";
    /* Durable (0335): claim the refund BEFORE it moves — a job whose
       refund already landed never refunds twice. */
    const claimed = await jobStore.claimRefund(job);
    if (claimed) {
      let refunded = true;
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "AI Video Translator — Refund (job failed)",
        });
      } catch (refundErr) {
        refunded = false;
        void refundErr;
      }
      /* CA-6: a landed full refund voids the key, so the retry
         re-charges. (Partial-success refunds above never void.) */
      if (refunded && job.idempotencyKey) {
        await voidChargeIdempotencyKey(job.idempotencyKey).catch(() => false);
        await storeCompletedJobResult("video-translator", job.idempotencyKey, job.userId, null);
      }
    }
  } finally {
    void jobStore.sync(job); // durable: the settled state is the post-restart record
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(uploadedPath).catch(() => {});
  }
}

/* ── Upload ──────────────────────────────────────────────────────────── */

const upload = createAdminAwareUpload({
  storage: tmpUploadStorage,
  limits: { fileSize: VIDEO_TRANSLATOR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only video files are allowed"));
  },
});

/* ── Routes ──────────────────────────────────────────────────────────── */

const translateSchema = z.object({
  languages: z
    .array(z.string().min(1).max(10))
    .min(1, "Pick at least one target language.")
    .max(6, "Maximum 6 languages per job."),
  voiceId: z.string().min(1, "Voice is required.").max(100),
  durationSec: z.number().min(1).max(3600).optional(),
  attribution: attributionOptIn(),
});

/**
 * GET /api/video-translator/languages
 *
 * Supported target languages + per-minute pricing for the UI cost preview.
 * Free — no compute involved.
 */
router.get("/video-translator/languages", (_req, res) => {
  res.json({
    languages: TARGET_LANGUAGES,
    creditsPerMinutePerLanguage: VIDEO_TRANSLATOR_CREDITS_PER_MINUTE,
    honestyNote: "AI dubbing, not human translation — review before publishing.",
  });
});

/**
 * POST /api/video-translator/translate
 *
 * Upload a video + target languages → charge 5 credits/min/language →
 * server-owned background job → poll GET /api/video-translator/jobs/:jobId.
 * SRT subtitles per language are always generated (free to download).
 * Failed jobs are refunded automatically; partially-failed jobs get a
 * proportional refund for the languages that didn't complete.
 */
router.post(
  "/video-translator/translate",
  requireAuth,
  publicApiLimiter,
  upload.single("video"),
  async (req, res) => {
    let body: unknown = req.body;
    // multipart puts fields as strings; languages may arrive JSON-encoded
    if (typeof req.body?.languages === "string") {
      try {
        body = { ...req.body, languages: JSON.parse(req.body.languages) };
      } catch {
        body = { ...req.body, languages: req.body.languages.split(",") };
      }
    }
    if (typeof req.body?.durationSec === "string") {
      body = { ...(body as object), durationSec: Number(req.body.durationSec) };
    }

    const parsed = translateSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid translation request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const { languages, voiceId, durationSec, attribution } = parsed.data;
    const unknown = languages.filter((l) => !isSupportedLanguage(l));
    if (unknown.length > 0) {
      res.status(400).json({ error: `Unsupported language(s): ${unknown.join(", ")}` });
      return;
    }
    const uniqueLangs = [...new Set(languages)];

    /* CA-6 replay protection (charge audit B6, Pattern B): server-derived
       key over the uploaded video's bytes (streamed hash — the upload
       is disk-backed) + the language/voice/duration ask (which fixes
       the estimate price); the job id is DETERMINISTIC from the key,
       so a replayed create finds the existing job instead of minting
       (and charging for) a second one. A failed job's full refund
       voids the key in the runner. Fresh responses are byte-identical. */
    const fileHash = await new Promise<string>((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(req.file!.path);
      stream.on("data", (chunk) => hash.update(chunk as Buffer));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
    const idempotencyKey = buildChargeIdempotencyKey("video-translator", req.userId!, null, {
      languages: uniqueLangs,
      voiceId: voiceId ?? null,
      durationSec: durationSec ?? null,
      attribution: attribution ?? null,
      fileHash,
    });
    const replay = await findJobCreateReplay("video-translator", idempotencyKey, req.userId!, jobs, (j) => ({
      jobId: j.id,
      status: j.status,
      languages: j.languages,
      attribution: j.attribution,
      creditsCharged: j.creditsCharged,
      creditsRemaining: j.creditsRemaining,
    }));
    if (replay) {
      res.status(202).json({ ...replay, replayed: true });
      return;
    }

    // Estimate from client-reported duration when available, else assume 1 min
    // floor and true-up is impossible pre-probe — the charge uses the estimate;
    // over-estimates are the honest direction (no surprise mid-job charges).
    const estimate = estimateTranslateCost(durationSec ?? 60, uniqueLangs.length);

    const balance = req.userCredits ?? 0;
    if (balance < estimate.credits) {
      res.status(402).json({
        error: "out_of_credits",
        message: `This translation needs ${estimate.credits} credits — top up to keep creating.`,
        creditsRequired: estimate.credits,
      });
      return;
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, estimate.credits, {
        action: `AI Video Translator (${uniqueLangs.map(languageLabel).join(", ")})`,
      }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `This translation needs ${estimate.credits} credits — top up to keep creating.`,
          creditsRequired: estimate.credits,
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "Could not record the Visual Buc charge. Please try again." });
        return;
      }
      throw err;
    }

    /* Concurrent twin: the ledger deduped this charge — answer with
       the twin's job instead of starting a second run. */
    const twin = await jobStore.find(deterministicJobId(idempotencyKey)); // Map first, durable store on a miss (0335)
    if (twin && twin.userId === req.userId! && twin.status !== "failed") {
      res.status(202).json({
        jobId: twin.id,
        status: twin.status,
        languages: twin.languages,
        attribution: twin.attribution,
        creditsCharged: twin.creditsCharged,
        creditsRemaining: twin.creditsRemaining,
        replayed: true,
      });
      return;
    }

    const job: TranslateJob = {
      id: deterministicJobId(idempotencyKey),
      userId: req.userId!,
      status: "queued",
      languages: uniqueLangs,
      sourceName: req.file.originalname,
      durationSec: null,
      outputs: uniqueLangs.map((language) => ({
        language,
        label: languageLabel(language),
        videoUrl: null,
        videoRef: null,
        srtUrl: null,
        srtRef: null,
        error: null,
      })),
      error: null,
      creditsCharged: estimate.credits,
      createdAt: Date.now(),
      attribution,
      idempotencyKey,
      creditsRemaining,
      creditsRefunded: false,
      workerInput: { uploadedPath: req.file.path, originalName: req.file.originalname, voiceId },
    };
    jobs.set(job.id, job);
    await jobStore.persist(job); // durable (0335): the row lands before the worker fires

    // Server-owned: runs detached from the request/tab lifecycle.
    void runTranslateJob(job, req.file.path, req.file.originalname, voiceId);

    res.status(202).json({
      jobId: job.id,
      status: job.status,
      languages: uniqueLangs,
      attribution,
      creditsCharged: estimate.credits,
      creditsRemaining,
    });
  },
);

/**
 * GET /api/video-translator/jobs/:jobId
 *
 * Poll job status. When done, outputs carry per-language videoUrl + srtUrl
 * (signed, reviewable URLs retained in Supabase storage).
 */
router.get("/video-translator/jobs/:jobId", requireAuth, async (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    languages: job.languages,
    sourceName: job.sourceName,
    durationSec: job.durationSec,
    outputs: job.outputs,
    error: job.error,
    createdAt: job.createdAt,
  });
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This video exceeds the 80 MB upload limit. Please use a smaller file.",
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
