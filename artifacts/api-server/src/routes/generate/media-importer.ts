import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { logger } from "../../lib/logger";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Pricing ───────────────────────────────────────────────────────────
   2 credits per import — covers server bandwidth, yt-dlp/ffmpeg CPU time,
   and Supabase storage. Env-overridable without a deploy. */
export const MEDIA_IMPORT_CREDIT_COST = Number(process.env["MEDIA_IMPORT_CREDIT_COST"]) || 2;

/** Hard cap on the downloaded file — protects disk and the Supabase upload. */
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024; // 500 MB

/** Per-stage timeouts so a hung download can't wedge a worker forever. */
const YTDLP_TIMEOUT_MS = 8 * 60_000;   // 8 min for the download itself
const FFMPEG_TIMEOUT_MS = 5 * 60_000;  // 5 min for audio extraction

/* ─── URL validation ────────────────────────────────────────────────────
   Two accepted classes:
   1. Platform URLs (YouTube, SoundCloud, TikTok, Instagram, X, Vimeo)
      → downloaded with yt-dlp.
   2. Direct media links (.mp3/.mp4/.wav/.m4a/.webm/.mov/.ogg/.flac)
      → fetched directly with a content-type sanity check.

   Everything else is rejected. This keeps the importer pointed at
   creators' own uploads, backups, and royalty-free material — not a
   general-purpose piracy pipe. */

const PLATFORM_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "music.youtube.com",
  "soundcloud.com", "www.soundcloud.com", "on.soundcloud.com",
  "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
  "instagram.com", "www.instagram.com",
  "twitter.com", "www.twitter.com", "x.com", "www.x.com",
  "vimeo.com", "www.vimeo.com", "player.vimeo.com",
]);

const DIRECT_MEDIA_EXTENSIONS = new Set([
  "mp3", "mp4", "m4a", "wav", "webm", "mov", "ogg", "oga", "flac", "aac", "opus",
]);

export type ImportSource = "platform" | "direct";

export interface ValidatedUrl {
  source: ImportSource;
  /** Canonical URL string safe to pass to the downloader. */
  url: string;
  /** Lowercase host, for logging. */
  host: string;
}

/**
 * Validate an import URL. Returns the classified URL, or null with a
 * human-readable reason when the URL isn't acceptable.
 */
export function validateImportUrl(raw: string): { ok: true; value: ValidatedUrl } | { ok: false; reason: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, reason: "Paste a link to import." };
  if (trimmed.length > 2048) return { ok: false, reason: "That link is too long to be a media URL." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That doesn't look like a valid URL — include the https:// part." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Only http(s) links can be imported." };
  }
  // Block localhost / private-network targets — no SSRF through the importer.
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" || host.endsWith(".localhost") ||
    host === "127.0.0.1" || host === "0.0.0.0" ||
    host.startsWith("10.") || host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]"
  ) {
    return { ok: false, reason: "That address can't be imported." };
  }

  if (PLATFORM_HOSTS.has(host)) {
    return { ok: true, value: { source: "platform", url: parsed.toString(), host } };
  }

  const ext = (parsed.pathname.split(".").pop() ?? "").toLowerCase().split("?")[0];
  if (DIRECT_MEDIA_EXTENSIONS.has(ext)) {
    return { ok: true, value: { source: "direct", url: parsed.toString(), host } };
  }

  return {
    ok: false,
    reason:
      "This link isn't from a supported source. Import from YouTube, SoundCloud, TikTok, Instagram, X, Vimeo, " +
      "or paste a direct link to an audio/video file (MP3, MP4, WAV, …).",
  };
}

export type ImportFormat = "video" | "audio";

export function resolveImportFormat(raw: unknown): ImportFormat | null {
  if (raw === "video" || raw === "audio") return raw;
  return null;
}

/* ─── yt-dlp ────────────────────────────────────────────────────────────
   Prefer the standalone binary; fall back to `python3 -m yt_dlp` (the
   Docker image pip-installs yt-dlp into the system python). */

async function findYtDlp(): Promise<{ cmd: string; args: string[] } | null> {
  for (const candidate of [
    { cmd: "yt-dlp", args: [] as string[] },
    { cmd: "python3", args: ["-m", "yt_dlp"] },
  ]) {
    try {
      await execFileAsync(candidate.cmd, [...candidate.args, "--version"], { timeout: 15_000 });
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * Build the yt-dlp argument list for a platform import.
 * - video: best MP4 (or best available) with metadata + thumbnail embedded.
 * - audio: best audio, converted to MP3.
 * Never writes playlists, never exceeds the byte cap, no login cookies.
 */
export function buildYtDlpArgs(
  validatedUrl: string,
  format: ImportFormat,
  outputTemplate: string,
): string[] {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--max-filesize", `${MAX_IMPORT_BYTES}`,
    "--socket-timeout", "30",
    "--retries", "3",
    "--print", "%(title)s",
    "--print", "NA",
    "-o", outputTemplate,
  ];
  if (format === "audio") {
    args.push(
      "-f", "bestaudio/best",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", "0",
    );
  } else {
    // Prefer MP4 for browser playback; fall back to whatever is best.
    args.push("-f", "best[ext=mp4]/best", "--merge-output-format", "mp4");
  }
  args.push(validatedUrl);
  return args;
}

/** Sanitize a filename for the Supabase object name. */
export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^\w\-. ]+/g, "")
    .replace(/^[.\s]+/, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 120) || "import";
}

export type MediaImportJobStatus = "queued" | "processing" | "done" | "failed";

export interface MediaImportJob {
  id: string;
  userId: string;
  status: MediaImportJobStatus;
  source: ImportSource;
  sourceUrl: string;
  sourceHost: string;
  format: ImportFormat;
  title: string | null;
  mediaType: "video" | "audio" | null;
  outputUrl: string | null;
  outputRef: string | null;
  fileSize: number | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, MediaImportJob>();

export function getMediaImportJob(id: string): MediaImportJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearMediaImportJobs(): void {
  jobs.clear();
}

/* ─── Direct media fetch ──────────────────────────────────────────────── */

async function fetchDirectMedia(url: string, workDir: string, jobId: string): Promise<{ path: string; size: number; contentType: string | null }> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "BowDownVisuals-MediaImporter/1.0" },
    signal: AbortSignal.timeout(YTDLP_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Couldn't download that file (HTTP ${res.status}). Check the link and try again.`);
  }
  const contentType = res.headers.get("content-type");
  const lengthHeader = res.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_IMPORT_BYTES) {
    throw new Error("That file is over the 500 MB import limit.");
  }
  const ext = (new URL(url).pathname.split(".").pop() ?? "bin").toLowerCase().split("?")[0] || "bin";
  const outPath = join(workDir, `direct-${jobId}.${ext.replace(/[^a-z0-9]/g, "") || "bin"}`);

  // Stream to disk with a running byte cap — never buffer unboundedly.
  const { createWriteStream } = await import("fs");
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outPath);
    const reader = res.body!.getReader();
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) { stream.end(); resolve(); return; }
        bytes += value.byteLength;
        if (bytes > MAX_IMPORT_BYTES) {
          stream.destroy();
          reject(new Error("That file is over the 500 MB import limit."));
          return;
        }
        stream.write(Buffer.from(value), (err) => {
          if (err) { reject(err); return; }
          pump();
        });
      }).catch(reject);
    };
    pump();
    stream.on("error", reject);
  });

  return { path: outPath, size: bytes, contentType };
}

/* ─── Background worker ───────────────────────────────────────────────── */

async function transcodeToMp3(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y", "-i", inputPath,
    "-vn", "-c:a", "libmp3lame", "-b:a", "192k",
    outputPath,
  ], { timeout: FFMPEG_TIMEOUT_MS });
}

/** Exported for tests. */
export async function runMediaImportJob(job: MediaImportJob): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "media-import-"));
  try {
    job.status = "processing";

    let localPath: string;
    let fileSize: number;

    if (job.source === "platform") {
      const ytdlp = await findYtDlp();
      if (!ytdlp) {
        throw new Error("The media downloader isn't available on this server right now — try again later.");
      }
      const outTemplate = join(workDir, `dl-${job.id}.%(ext)s`);
      const args = buildYtDlpArgs(job.sourceUrl, job.format, outTemplate);
      let stdout = "";
      try {
        const result = await execFileAsync(ytdlp.cmd, [...ytdlp.args, ...args], {
          timeout: YTDLP_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        });
        stdout = result.stdout ?? "";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/max-filesize|File is too big/i.test(msg)) {
          throw new Error("That media is over the 500 MB import limit.");
        }
        if (/private|login|sign in|age/i.test(msg)) {
          throw new Error("That link needs a login or is age/private — import only content you can access publicly.");
        }
        if (/unsupported url|no video/i.test(msg)) {
          throw new Error("Couldn't find playable media at that link. Check the URL and try again.");
        }
        throw new Error("The download failed — the link may be private, removed, or region-locked.");
      }
      // yt-dlp --print emits the title on the first line.
      const firstLine = stdout.split("\n").map((s) => s.trim()).find((s) => s.length > 0);
      if (firstLine && firstLine !== "NA") job.title = firstLine.slice(0, 200);

      const files = (await fs.readdir(workDir)).filter((f) => f.startsWith(`dl-${job.id}.`));
      if (files.length === 0) {
        throw new Error("The download finished but produced no file — try a different link.");
      }
      localPath = join(workDir, files[0]!);
      const stat = await fs.stat(localPath);
      fileSize = stat.size;
    } else {
      const fetched = await fetchDirectMedia(job.sourceUrl, workDir, job.id);
      localPath = fetched.path;
      fileSize = fetched.size;
      if (job.format === "audio" && !/\.(mp3|m4a|aac|opus)$/i.test(localPath)) {
        // Normalize direct audio downloads to MP3 for the song library.
        const mp3Path = join(workDir, `audio-${job.id}.mp3`);
        await transcodeToMp3(localPath, mp3Path);
        localPath = mp3Path;
        fileSize = (await fs.stat(localPath)).size;
      }
    }

    if (fileSize <= 0) throw new Error("The downloaded file was empty — try a different link.");

    const mediaType: "video" | "audio" = job.format === "audio" ? "audio" : "video";
    job.mediaType = mediaType;
    const outExt = mediaType === "audio" ? "mp3" : "mp4";
    const mime = mediaType === "audio" ? "audio/mpeg" : "video/mp4";
    const title = job.title ?? "import";
    const objectName = `media-imports/${job.userId}/${Date.now()}-${job.id}-${sanitizeFileName(title)}.${outExt}`;
    const buffer = await fs.readFile(localPath);
    const ref = await uploadMediaToSupabaseStorage(objectName, buffer, mime);
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
    job.fileSize = fileSize;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Import failed";
    logger.warn({ err, jobId: job.id }, "[media-importer] job failed");
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Media Import — Refund (job failed)",
      });
    } catch (refundErr) {
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ─── Routes ──────────────────────────────────────────────────────────── */

const importSchema = z.object({
  url: z.string().min(1, "Paste a link to import.").max(2048),
  format: z.enum(["video", "audio"]),
  // The user must actively confirm they have the rights to this content.
  rightsConfirmed: z.boolean().refine((v) => v === true, {
    message: "Please confirm you own this content or have the rights to import it.",
  }),
});

/**
 * POST /api/media-import { url, format, rightsConfirmed }
 *
 * Imports media from a supported platform link (yt-dlp) or a direct
 * media file link into the user's library.
 *
 * Flow: validate URL → charge 2 credits → server-owned background job →
 * poll GET /api/media-import/:jobId → preview/download the imported file.
 * Failed jobs are refunded automatically.
 *
 * Legal framing (also in the UI): this is for the user's OWN content,
 * backups, and royalty-free material — not a piracy tool.
 */
router.post("/api/media-import", requireAuth, async (req, res) => {
  const parsed = importSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_REQUEST",
      message: parsed.error.issues[0]?.message ?? "Invalid import request.",
    });
    return;
  }
  const { url, format } = parsed.data;

  const validated = validateImportUrl(url);
  if (!validated.ok) {
    res.status(400).json({ error: "UNSUPPORTED_URL", message: validated.reason });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < MEDIA_IMPORT_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to import media.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, MEDIA_IMPORT_CREDIT_COST, {
      action: `Media Import (${validated.value.host}, ${format})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to import media.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: MediaImportJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    source: validated.value.source,
    sourceUrl: validated.value.url,
    sourceHost: validated.value.host,
    format,
    title: null,
    mediaType: null,
    outputUrl: null,
    outputRef: null,
    fileSize: null,
    error: null,
    creditsCharged: MEDIA_IMPORT_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Fire-and-forget: the job is server-owned, the tab can close.
  void runMediaImportJob(job);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    creditsUsed: MEDIA_IMPORT_CREDIT_COST,
    creditsRemaining,
    message: "Import started — we'll grab your media and drop it in your library.",
  });
});

/**
 * GET /api/media-import/:jobId → { status, title, mediaType, outputUrl,
 * fileSize, error }
 *
 * Poll this until status is "done" or "failed".
 */
router.get("/api/media-import/:jobId", requireAuth, (req, res) => {
  const rawId = req.params.jobId;
  const jobId = Array.isArray(rawId) ? rawId[0] : rawId;
  const job = getMediaImportJob(jobId ?? "");
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Import job not found." });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    title: job.title,
    mediaType: job.mediaType,
    format: job.format,
    outputUrl: job.outputUrl,
    fileSize: job.fileSize,
    error: job.error,
  });
});

export default router;
