import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { z } from "zod";
import OpenAI, { toFile } from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { getSupabaseAdmin } from "../../lib/supabase-admin";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing ─────────────────────────────────────────────────────────────
   5 credits for the full repurpose pack: Whisper transcription + GPT-6
   master analysis (3 clip moments, 5 caption+hashtag sets, 4 platform
   descriptions, 3 thumbnail prompts) + server-side ffmpeg auto-cutting of
   3 vertical clips + 3 AI thumbnail images. 1 credit per individual
   re-roll (text block or thumbnail image). Both env-overridable. */
export const REPURPOSE_PACK_CREDITS =
  Number(process.env["REPURPOSE_PACK_CREDITS"]) || 5;
export const REPURPOSE_REROLL_CREDITS =
  Number(process.env["REPURPOSE_REROLL_CREDITS"]) || 1;

/** Cap uploads at 80 MB — same guard as the clip upload route. */
const VIDEO_MAX_BYTES = 80 * 1024 * 1024;
/** Whisper's hard per-request file limit. Larger audio is chunked. */
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 240_000;

const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";
const REPURPOSE_BUCKET = "artist-references";
const CLIP_LENGTH_SEC = 30;

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface RepurposeMoment {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
}

export interface CaptionSet {
  caption: string;
  hashtags: string[];
}

export interface PlatformDescriptions {
  tiktok: string;
  reels: string;
  shorts: string;
  x: string;
}

export interface RepurposeAnalysis {
  videoTitle: string;
  summary: string;
  moments: RepurposeMoment[];
  captions: CaptionSet[];
  descriptions: PlatformDescriptions;
  thumbnailPrompts: string[];
}

const REROLL_KINDS = ["captions", "descriptions", "moments", "thumbnailPrompts"] as const;
type RerollKind = (typeof REROLL_KINDS)[number];

const analyzeBodySchema = z.object({
  videoUrl: z.string().url().max(2000).optional(),
});

const rerollBodySchema = z.object({
  transcript: z.string().min(1).max(15000),
  kind: z.enum(REROLL_KINDS),
});

const rerollThumbnailSchema = z.object({
  prompt: z.string().min(1).max(1000),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VIDEO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

/* ── Pure helpers (exported for tests) ─────────────────────────────────── */

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Build ffmpeg args that cut [startSec, endSec) and reframe to 720x1280 vertical. */
export function buildClipCutArgs(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
): string[] {
  const dur = Math.max(1, endSec - startSec);
  return [
    "-ss", String(startSec),
    "-t", String(dur),
    "-i", inputPath,
    "-vf", "crop=ih*9/16:ih,scale=720:1280:flags=lanczos",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ];
}

/** Render segments as a timestamped transcript for the analysis model. */
export function buildTimestampedTranscript(
  segments: Array<{ start: number; end: number; text: string }>,
  maxChars = 12000,
): string {
  const lines = segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`);
  let out = lines.join("\n");
  if (out.length > maxChars) {
    out = out.slice(0, maxChars) + "\n…(transcript truncated)";
  }
  return out;
}

function clampStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function parseMoments(raw: unknown, durationSec: number): RepurposeMoment[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: RepurposeMoment[] = [];
  for (const h of arr) {
    if (!h || typeof h !== "object") continue;
    const o = h as Record<string, unknown>;
    const startSec = typeof o["startSec"] === "number" ? o["startSec"] : NaN;
    let endSec = typeof o["endSec"] === "number" ? o["endSec"] : NaN;
    const title = clampStr(o["title"], 120);
    const reason = clampStr(o["reason"], 300);
    const quote = clampStr(o["quote"], 200);
    if (!Number.isFinite(startSec) || startSec < 0 || !title) continue;
    if (!Number.isFinite(endSec) || endSec <= startSec) {
      endSec = startSec + CLIP_LENGTH_SEC;
    }
    if (Math.abs(endSec - startSec - CLIP_LENGTH_SEC) > 12) {
      endSec = startSec + CLIP_LENGTH_SEC;
    }
    if (durationSec > 0 && endSec > durationSec) {
      endSec = durationSec;
      if (endSec - startSec < 5) continue;
    }
    if (out.some((e) => Math.abs(e.startSec - startSec) < 5)) continue;
    out.push({
      id: randomUUID(),
      startSec: Math.round(startSec * 10) / 10,
      endSec: Math.round(endSec * 10) / 10,
      title,
      reason,
      quote,
    });
    if (out.length >= 3) break;
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

function parseCaptions(raw: unknown): CaptionSet[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: CaptionSet[] = [];
  for (const c of arr) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const caption = clampStr(o["caption"], 500);
    const tags = Array.isArray(o["hashtags"])
      ? o["hashtags"]
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.replace(/^#+/, "").trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    if (!caption) continue;
    out.push({ caption, hashtags: tags });
    if (out.length >= 5) break;
  }
  return out;
}

function parseDescriptions(raw: unknown): PlatformDescriptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    tiktok: clampStr(o["tiktok"], 1500),
    reels: clampStr(o["reels"], 1500),
    shorts: clampStr(o["shorts"], 1500),
    x: clampStr(o["x"], 400),
  };
}

function parseThumbnailPrompts(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim().slice(0, 1000))
    .slice(0, 3);
}

/**
 * Parse the GPT-6 master analysis JSON into a RepurposeAnalysis.
 * Never throws on malformed model output — returns null so the caller
 * can refund instead of charging for garbage.
 */
export function parseAnalysis(raw: string, durationSec: number): RepurposeAnalysis | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const moments = parseMoments(j["moments"], durationSec);
  const captions = parseCaptions(j["captions"]);
  const thumbnailPrompts = parseThumbnailPrompts(j["thumbnailPrompts"]);
  if (moments.length === 0 || captions.length === 0 || thumbnailPrompts.length === 0) {
    return null;
  }
  return {
    videoTitle: clampStr(j["videoTitle"], 120) || "Untitled video",
    summary: clampStr(j["summary"], 600),
    moments,
    captions,
    descriptions: parseDescriptions(j["descriptions"]),
    thumbnailPrompts,
  };
}

/** Parse a single re-rolled text block. Never throws — null on garbage. */
export function parseReroll(raw: string, kind: RerollKind, durationSec: number): unknown {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (kind) {
    case "moments": {
      const m = parseMoments(j["moments"], durationSec);
      return m.length > 0 ? m : null;
    }
    case "captions": {
      const c = parseCaptions(j["captions"]);
      return c.length > 0 ? c : null;
    }
    case "descriptions":
      return parseDescriptions(j["descriptions"]);
    case "thumbnailPrompts": {
      const t = parseThumbnailPrompts(j["thumbnailPrompts"]);
      return t.length > 0 ? t : null;
    }
  }
}

/* ── GPT-6 prompts ─────────────────────────────────────────────────────── */

const MASTER_SYSTEM_PROMPT = `You are an expert short-form content strategist for creators. Given a timestamped transcript of a video ([mm:ss] markers), produce a complete repurposing pack: the 3 best clip-worthy moments, 5 ready-to-post caption+hashtag sets, platform-optimized descriptions for TikTok / Instagram Reels / YouTube Shorts / X, and 3 thumbnail image prompts.

Rules:
- Clip moments: self-contained ~${CLIP_LENGTH_SEC}s windows (set endSec ≈ startSec + ${CLIP_LENGTH_SEC}), each with a clear payoff inside the window. Base startSec on the [mm:ss] markers — never invent moments not in the transcript.
- Captions: 1-3 punchy lines each, written in the creator's voice, zero corporate speak. Hashtags WITHOUT the # symbol, no duplicates across the set.
- Descriptions: TikTok = punchy with inline hashtags + CTA; Reels = IG-flavored with hashtags; Shorts = title line + description with hashtags; X = under 280 characters, no hashtag stuffing.
- Thumbnail prompts: vivid, high-contrast, click-worthy image prompts for a 9:16 vertical thumbnail. No text in the image unless it's 1-3 bold words.

Return ONLY JSON:
{"videoTitle": "<suggested title, under 60 chars>",
 "summary": "<2-3 sentence summary of the video>",
 "moments": [{"startSec": <number>, "endSec": <number>, "title": "<punchy clip title>", "reason": "<why this slaps>", "quote": "<memorable line>"}],
 "captions": [{"caption": "<caption text>", "hashtags": ["tag1", "tag2"]}],
 "descriptions": {"tiktok": "...", "reels": "...", "shorts": "...", "x": "..."},
 "thumbnailPrompts": ["<prompt 1>", "<prompt 2>", "<prompt 3>"]}`;

const REROLL_PROMPTS: Record<RerollKind, string> = {
  moments: `Find 3 FRESH clip-worthy moments DIFFERENT from any previous picks. Same rules: self-contained ~${CLIP_LENGTH_SEC}s windows, payoff inside the window, startSec from [mm:ss] markers. Return ONLY JSON: {"moments": [{"startSec": <number>, "endSec": <number>, "title": "...", "reason": "...", "quote": "..."}]}`,
  captions: `Write 5 FRESH caption+hashtag sets DIFFERENT from any previous ones. 1-3 punchy lines each, creator's voice, zero corporate speak. Hashtags without # symbol. Return ONLY JSON: {"captions": [{"caption": "...", "hashtags": ["..."]}]}`,
  descriptions: `Write FRESH platform descriptions DIFFERENT from any previous ones. TikTok = punchy + inline hashtags + CTA; Reels = IG-flavored + hashtags; Shorts = title line + description + hashtags; X = under 280 chars. Return ONLY JSON: {"descriptions": {"tiktok": "...", "reels": "...", "shorts": "...", "x": "..."}}`,
  thumbnailPrompts: `Write 3 FRESH thumbnail image prompts DIFFERENT from any previous ones. Vivid, high-contrast, click-worthy, 9:16 vertical. No text unless 1-3 bold words. Return ONLY JSON: {"thumbnailPrompts": ["...", "...", "..."]}`,
};

async function callTextModel(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Promise<string> {
  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: messages as Array<{ role: "system" | "user"; content: string }>,
    response_format: { type: "json_object" },
    max_completion_tokens: maxTokens,
    temperature: 0.7,
  });
  return completion.choices[0]?.message?.content ?? "{}";
}

/* ── Transcription (ffmpeg + Whisper, chunked past 24MB) ───────────────── */

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

async function probeDurationSec(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      inputPath,
    ], { timeout: 30_000 });
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

export async function transcribeVideoBuffer(
  buffer: Buffer,
  originalName: string,
  transcribeFn?: (audio: { buffer: Buffer; name: string }) => Promise<{ segments: TranscriptSegment[] }>,
): Promise<{ segments: TranscriptSegment[]; durationSec: number }> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "repurpose-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);
  try {
    await fs.writeFile(inputPath, buffer);
    const durationSec = (await probeDurationSec(inputPath)) ?? 0;

    const audioPath = join(workDir, "audio.mp3");
    await execFileAsync("ffmpeg", [
      "-v", "error",
      "-i", inputPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
      "-y", audioPath,
    ], { timeout: 300_000 });
    const audioStat = await fs.stat(audioPath);

    const chunkPaths: Array<{ path: string; offsetSec: number }> = [];
    if (audioStat.size <= WHISPER_MAX_BYTES) {
      chunkPaths.push({ path: audioPath, offsetSec: 0 });
    } else {
      const chunkCount = Math.ceil(audioStat.size / WHISPER_MAX_BYTES);
      const chunkDur = durationSec > 0 ? durationSec / chunkCount : 600;
      for (let i = 0; i < chunkCount; i++) {
        const p = join(workDir, `audio-${i}.mp3`);
        await execFileAsync("ffmpeg", [
          "-v", "error",
          "-ss", String(i * chunkDur),
          "-t", String(chunkDur + 1),
          "-i", audioPath,
          "-c", "copy",
          "-y", p,
        ], { timeout: 120_000 });
        chunkPaths.push({ path: p, offsetSec: i * chunkDur });
      }
    }

    const transcribe = transcribeFn ?? (async ({ buffer: b, name }) => {
      const file = await toFile(b, name, { type: "audio/mpeg" });
      const out = await getOpenAI().audio.transcriptions.create(
        { file, model: "whisper-1", response_format: "verbose_json", timestamp_granularities: ["segment"] },
        { signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) },
      );
      const segs = ((out as unknown as { segments?: Array<{ start: number; end: number; text: string }> }).segments ?? [])
        .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").trim() }))
        .filter((s) => s.text.length > 0);
      return { segments: segs };
    });

    const segments: TranscriptSegment[] = [];
    for (const [i, chunk] of chunkPaths.entries()) {
      const buf = await fs.readFile(chunk.path);
      const { segments: segs } = await transcribe({ buffer: buf, name: `chunk-${i}.mp3` });
      for (const s of segs) {
        segments.push({ start: s.start + chunk.offsetSec, end: s.end + chunk.offsetSec, text: s.text });
      }
    }
    segments.sort((a, b) => a.start - b.start);
    return { segments, durationSec };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Background jobs (in-memory, server-owned) ─────────────────────────── */

interface JobClip {
  title: string;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
  outputRef: string | null;
}

interface JobThumb {
  prompt: string;
  imageUrl: string | null;
  imageRef: string | null;
}

export interface RepurposeJob {
  id: string;
  userId: string;
  kind: "clips" | "thumbnails";
  status: "queued" | "processing" | "done" | "failed";
  clips: JobClip[];
  thumbnails: JobThumb[];
  error: string | null;
  createdAt: number;
}

const repurposeJobs = new Map<string, RepurposeJob>();
export function __clearRepurposeJobs(): void {
  repurposeJobs.clear();
}
export function getRepurposeJob(id: string): RepurposeJob | undefined {
  return repurposeJobs.get(id);
}

export async function runClipJob(job: RepurposeJob, videoRef: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "repcut-"));
  try {
    job.status = "processing";
    const signedUrl = await refreshSupabaseStorageUrl(videoRef);
    const resp = await fetch(signedUrl, { signal: AbortSignal.timeout(300_000) });
    if (!resp.ok) throw new Error(`Could not download source video (${resp.status})`);
    const inputPath = join(workDir, "source.mp4");
    await fs.writeFile(inputPath, Buffer.from(await resp.arrayBuffer()));

    for (const [i, clip] of job.clips.entries()) {
      const outputPath = join(workDir, `clip-${i}.mp4`);
      await execFileAsync(
        "ffmpeg",
        buildClipCutArgs(inputPath, outputPath, clip.startSec, clip.endSec),
        { timeout: 600_000 },
      );
      const outBuffer = await fs.readFile(outputPath);
      const objectName = `repurpose/${job.userId}/${job.id}-clip-${i}.mp4`;
      const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "video/mp4");
      clip.outputRef = ref;
      clip.outputUrl = await refreshSupabaseStorageUrl(ref);
    }
    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Clip cutting failed";
    logger.error({ err, jobId: job.id }, "[repurpose] clip job failed");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runThumbnailJob(job: RepurposeJob): Promise<void> {
  try {
    job.status = "processing";
    for (const [i, thumb] of job.thumbnails.entries()) {
      const imageResp = await getOpenAI().images.generate({
        model: IMAGE_MODEL,
        prompt: thumb.prompt.slice(0, 4000),
        size: "1024x1536",
        quality: "high",
        n: 1,
      });
      const b64 = imageResp.data?.[0]?.b64_json;
      if (!b64) throw new Error("Image generation returned no image data");
      const filePath = `${job.userId}/repurpose/${job.id}-thumb-${i}.png`;
      const { error: upErr } = await getSupabaseAdmin()
        .storage.from(REPURPOSE_BUCKET)
        .upload(filePath, Buffer.from(b64, "base64"), { contentType: "image/png", upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = getSupabaseAdmin()
        .storage.from(REPURPOSE_BUCKET)
        .getPublicUrl(filePath);
      thumb.imageRef = filePath;
      thumb.imageUrl = publicUrl;
    }
    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Thumbnail generation failed";
    logger.error({ err, jobId: job.id }, "[repurpose] thumbnail job failed");
  }
}

/* ── POST /api/repurpose/analyze — the full 5-credit pack ────────────────
   Upload a video (or pass a Supabase storage videoUrl). Charges 5 credits
   up front, then: transcribes with Whisper, runs the GPT-6 master analysis
   (moments, captions, descriptions, thumbnail prompts), and kicks off two
   server-owned background jobs (clip cutting + thumbnail generation) that
   are INCLUDED in the 5 credits. Refunds on no-speech, bad AI output, or
   any provider failure — the user never pays for a pack they didn't get. */
router.post(
  "/api/repurpose/analyze",
  publicApiLimiter,
  requireAuth,
  upload.single("video"),
  async (req: Request, res: Response) => {
    const parsed = analyzeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid repurpose request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { videoUrl } = parsed.data;

    let videoBuffer: Buffer | null = null;
    let originalName = "video.mp4";
    if (req.file) {
      videoBuffer = req.file.buffer;
      originalName = req.file.originalname || originalName;
    } else if (videoUrl) {
      // SSRF guard — only our own Supabase storage.
      const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
      try {
        const parsedUrl = new URL(videoUrl);
        if (supabaseUrl) {
          const allowed = new URL(supabaseUrl).hostname;
          if (parsedUrl.hostname !== allowed) {
            res.status(400).json({ error: "videoUrl must be from your project storage." });
            return;
          }
        }
      } catch {
        res.status(400).json({ error: "Invalid videoUrl." });
        return;
      }
      try {
        const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
        if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
        const ab = await resp.arrayBuffer();
        if (ab.byteLength > VIDEO_MAX_BYTES) {
          res.status(413).json({ error: "FILE_TOO_LARGE", message: "This video exceeds the 80 MB limit." });
          return;
        }
        videoBuffer = Buffer.from(ab);
      } catch (err) {
        logger.error({ err }, "[repurpose] failed to fetch videoUrl");
        res.status(502).json({ error: "Could not download the video URL." });
        return;
      }
    } else {
      res.status(400).json({ error: "Upload a video file or provide videoUrl." });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < REPURPOSE_PACK_CREDITS) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to repurpose videos.",
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, REPURPOSE_PACK_CREDITS, {
        action: "Content Repurposer — full repurpose pack",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to repurpose videos.",
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "Could not record the credit charge. Please try again." });
        return;
      }
      throw err;
    }

    const refundAndFail = async (status: number, error: string, message?: string) => {
      try {
        await refundCredits(req.userId!, REPURPOSE_PACK_CREDITS, {
          action: "Content Repurposer — Refund (pack failed)",
        });
      } catch {
        /* refund logged inside refundCredits */
      }
      res.status(status).json({ error, ...(message ? { message } : {}) });
    };

    try {
      // Store the source video so the background jobs can fetch it later.
      const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const objectName = `repurpose/${req.userId}/${Date.now()}-${randomUUID()}.${ext}`;
      const videoRef = await uploadMediaToSupabaseStorage(objectName, videoBuffer, "video/mp4");

      const { segments, durationSec } = await transcribeVideoBuffer(videoBuffer, originalName);
      if (segments.length === 0) {
        await refundAndFail(422, "NO_SPEECH", "No speech detected in this video — repurposing needs audio with talking.");
        return;
      }
      const transcript = buildTimestampedTranscript(segments);

      const raw = await callTextModel(
        [
          { role: "system", content: MASTER_SYSTEM_PROMPT },
          { role: "user", content: `Repurpose this video (transcript below):\n\n${transcript}` },
        ],
        4000,
      );
      const analysis = parseAnalysis(raw, durationSec);
      if (!analysis) {
        await refundAndFail(502, "ANALYZE_FAILED", "The AI couldn't build a repurpose pack from this video — you were not charged.");
        return;
      }

      // Kick off the two background jobs included in the 5-credit pack.
      const clipJob: RepurposeJob = {
        id: randomUUID(),
        userId: req.userId!,
        kind: "clips",
        status: "queued",
        clips: analysis.moments.map((m) => ({
          title: m.title,
          startSec: m.startSec,
          endSec: m.endSec,
          outputUrl: null,
          outputRef: null,
        })),
        thumbnails: [],
        error: null,
        createdAt: Date.now(),
      };
      const thumbJob: RepurposeJob = {
        id: randomUUID(),
        userId: req.userId!,
        kind: "thumbnails",
        status: "queued",
        clips: [],
        thumbnails: analysis.thumbnailPrompts.map((p) => ({ prompt: p, imageUrl: null, imageRef: null })),
        error: null,
        createdAt: Date.now(),
      };
      repurposeJobs.set(clipJob.id, clipJob);
      repurposeJobs.set(thumbJob.id, thumbJob);
      // Server-owned: run detached from the request/tab lifecycle.
      void runClipJob(clipJob, videoRef);
      void runThumbnailJob(thumbJob);

      res.json({
        videoRef,
        durationSec: Math.round(durationSec),
        transcript,
        analysis: {
          videoTitle: analysis.videoTitle,
          summary: analysis.summary,
          moments: analysis.moments,
          captions: analysis.captions,
          descriptions: analysis.descriptions,
          thumbnailPrompts: analysis.thumbnailPrompts,
        },
        clipJobId: clipJob.id,
        thumbnailJobId: thumbJob.id,
        creditsUsed: REPURPOSE_PACK_CREDITS,
        creditsRemaining,
      });
    } catch (err) {
      if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
        logger.warn({ err }, "[repurpose] provider rate limit");
        await refundAndFail(503, "PROVIDER_BUSY", "The AI is catching its breath — try again in a moment.");
        return;
      }
      logger.error({ err }, "[repurpose] analysis failed");
      await refundAndFail(502, "ANALYZE_FAILED", "Repurposing failed — you were not charged.");
    }
  },
);

/* ── GET /api/repurpose/jobs/:jobId — poll a clip or thumbnail job ─────── */
router.get("/api/repurpose/jobs/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = repurposeJobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    clips: job.clips,
    thumbnails: job.thumbnails,
    error: job.error,
    createdAt: job.createdAt,
  });
});

/* ── POST /api/repurpose/reroll — 1 credit per fresh text block ───────────
   The client sends back the transcript from the analyze response (stateless
   — no server-side transcript storage). Refunds when the model returns
   unusable output. */
router.post("/api/repurpose/reroll", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = rerollBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid re-roll request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { transcript, kind } = parsed.data;
  const durationSec = Number(req.body?.durationSec) > 0 ? Number(req.body.durationSec) : 0;

  const balance = req.userCredits ?? 0;
  if (balance < REPURPOSE_REROLL_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to re-roll.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, REPURPOSE_REROLL_CREDITS, {
      action: `Content Repurposer — re-roll ${kind}`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to re-roll.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  try {
    const raw = await callTextModel(
      [
        { role: "system", content: REROLL_PROMPTS[kind] },
        { role: "user", content: `Transcript:\n\n${transcript}` },
      ],
      2500,
    );
    const out = parseReroll(raw, kind, durationSec);
    if (out === null) {
      try {
        await refundCredits(req.userId!, REPURPOSE_REROLL_CREDITS, {
          action: "Content Repurposer — Refund (re-roll failed)",
        });
      } catch { /* logged inside */ }
      res.status(502).json({ error: "REROLL_FAILED", message: "The re-roll came back empty — you were not charged." });
      return;
    }
    res.json({ kind, result: out, creditsUsed: REPURPOSE_REROLL_CREDITS, creditsRemaining });
  } catch (err) {
    logger.error({ err }, "[repurpose] re-roll failed");
    try {
      await refundCredits(req.userId!, REPURPOSE_REROLL_CREDITS, {
        action: "Content Repurposer — Refund (re-roll failed)",
      });
    } catch { /* logged inside */ }
    res.status(502).json({ error: "REROLL_FAILED", message: "Re-roll failed — you were not charged." });
  }
});

/* ── POST /api/repurpose/reroll-thumbnail — 1 credit per fresh image ───── */
router.post("/api/repurpose/reroll-thumbnail", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = rerollThumbnailSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid thumbnail re-roll request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { prompt } = parsed.data;

  const balance = req.userCredits ?? 0;
  if (balance < REPURPOSE_REROLL_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to re-roll.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, REPURPOSE_REROLL_CREDITS, {
      action: "Content Repurposer — re-roll thumbnail",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to re-roll.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  try {
    const imageResp = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt: prompt.slice(0, 4000),
      size: "1024x1536",
      quality: "high",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image generation returned no image data");
    const filePath = `${req.userId}/repurpose/reroll-${randomUUID()}.png`;
    const { error: upErr } = await getSupabaseAdmin()
      .storage.from(REPURPOSE_BUCKET)
      .upload(filePath, Buffer.from(b64, "base64"), { contentType: "image/png", upsert: false });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = getSupabaseAdmin()
      .storage.from(REPURPOSE_BUCKET)
      .getPublicUrl(filePath);
    res.json({
      imageUrl: publicUrl,
      imageRef: filePath,
      creditsUsed: REPURPOSE_REROLL_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    logger.error({ err }, "[repurpose] thumbnail re-roll failed");
    try {
      await refundCredits(req.userId!, REPURPOSE_REROLL_CREDITS, {
        action: "Content Repurposer — Refund (thumbnail re-roll failed)",
      });
    } catch { /* logged inside */ }
    res.status(502).json({ error: "THUMBNAIL_FAILED", message: "Thumbnail re-roll failed — you were not charged." });
  }
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
