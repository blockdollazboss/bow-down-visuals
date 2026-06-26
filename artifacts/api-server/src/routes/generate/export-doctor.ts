import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync, rmSync } from "fs";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";
import { isAllowedStemUrl } from "../../lib/audioExport";

const execFileAsync = promisify(execFile);
const router = Router();

const SIDECAR = "http://127.0.0.1:1106";
const SUPABASE_HOST = (() => {
  const url = process.env["SUPABASE_URL"] ?? "";
  try { return new URL(url).host; } catch { return ""; }
})();

const MAX_CLIP_BYTES = 500 * 1024 * 1024;  // 500 MB
const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100 MB

/** Replit object storage (GCS) — the master player and our own exports use this. */
function isReplitObjectStorageUrl(u: URL): boolean {
  return u.host === "storage.googleapis.com" && u.pathname.startsWith("/replit-objstore-");
}

/** SSRF guard for Scene 1 video clips: https only, from Supabase storage, the
 *  Runway CDN, or Replit object storage (the host the master player plays from).
 *  Blocks internal/metadata/private hosts that don't match. */
function isAllowedClipUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (SUPABASE_HOST && u.host === SUPABASE_HOST) return true;
  if (isReplitObjectStorageUrl(u)) return true;
  return u.hostname.endsWith(".cloudfront.net") || u.hostname.endsWith(".runwayml.com");
}

/** SSRF guard for audio: Supabase storage (shared stem guard) or Replit object
 *  storage. Does not modify the shared isAllowedStemUrl used by the real export. */
function isAllowedAudioUrl(url: string): boolean {
  if (isAllowedStemUrl(url)) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === "https:" && isReplitObjectStorageUrl(u);
}

/** Stream transform that aborts once `max` bytes have flowed through. */
function byteCap(max: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > max) { cb(new Error(`Download exceeded ${max} bytes`)); return; }
      cb(null, chunk);
    },
  });
}

/* ── Tiny in-memory registry: one downloaded Scene 1 file per doctor session ── */
interface DoctorSession {
  doctorId: string;
  projectId: string;
  folder: string;
  videoPath: string;
  audioPath: string | null;
  createdAt: number;
}
const sessions = new Map<string, DoctorSession>();

// Clean up sessions older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of sessions.entries()) {
    if (s.createdAt < cutoff) {
      try { rmSync(s.folder, { recursive: true, force: true }); } catch { /* best-effort */ }
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

async function tryFreshSignedUrl(url: string): Promise<{ url: string; changed: boolean }> {
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/?]+)\/(.+?)(?:\?|$)/);
  if (!match) return { url, changed: false };
  const bucket = match[1]!;
  const objectPath = decodeURIComponent(match[2]!);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket_name: bucket, object_name: objectPath, method: "GET", expires_at: expiresAt }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { url, changed: false };
    const { signed_url } = (await res.json()) as { signed_url: string };
    return { url: signed_url, changed: true };
  } catch {
    return { url, changed: false };
  }
}

async function signGetUrl(bucketName: string, objectName: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method: "GET", expires_at: expiresAt }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to sign URL: ${res.status}`);
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

async function probeMedia(filePath: string): Promise<{
  valid: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  duration: number;
  width: number;
  height: number;
  codec: string;
  error: string | null;
}> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath],
      { timeout: 30_000 },
    );
    const info = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>;
      format?: { duration?: string };
    };
    const vs = info.streams?.find((s) => s.codec_type === "video");
    const as_ = info.streams?.find((s) => s.codec_type === "audio");
    const dur = parseFloat(info.format?.duration ?? vs?.duration ?? as_?.duration ?? "0");
    const hasVideo = !!vs;
    return {
      valid: (hasVideo || !!as_) && !isNaN(dur) && dur > 0,
      hasVideo,
      hasAudio: !!as_,
      duration: isNaN(dur) ? 0 : dur,
      width: vs?.width ?? 0,
      height: vs?.height ?? 0,
      codec: vs?.codec_name ?? as_?.codec_name ?? "",
      error: !hasVideo && !as_ ? "no media streams" : (isNaN(dur) || dur <= 0) ? "zero or invalid duration" : null,
    };
  } catch (e) {
    return {
      valid: false, hasVideo: false, hasAudio: false, duration: 0, width: 0, height: 0, codec: "",
      error: e instanceof Error ? e.message.slice(0, 160) : "ffprobe failed",
    };
  }
}

/* ── TEST 1: probe the Scene 1 source URL ─────────────── */
router.post("/export-doctor/test-url", requireAuth, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    const startsWithHttp = !!url && url.startsWith("http");

    if (!url || !startsWithHttp) {
      res.json({
        urlProvided: !!url,
        startsWithHttp,
        status: 0,
        contentType: "",
        contentLength: null,
        isVideo: false,
        isHtml: false,
        snippet: null,
        message: url ? "URL does not start with http." : "No Scene 1 URL was found.",
      });
      return;
    }

    if (!isAllowedClipUrl(url)) {
      res.json({
        urlProvided: true,
        startsWithHttp: true,
        status: 0,
        contentType: "",
        contentLength: null,
        isVideo: false,
        isHtml: false,
        snippet: null,
        message: "URL host is not an allowed media source (Supabase storage, Runway CDN, or Replit object storage over HTTPS).",
      });
      return;
    }

    let target = url;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }

    const r = await fetch(target, {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = r.headers.get("content-type") ?? "";
    const lenHeader = r.headers.get("content-range")?.split("/")[1] ?? r.headers.get("content-length");
    const contentLength = lenHeader ? Number(lenHeader) : null;
    const ctLower = contentType.toLowerCase();
    // Object-storage hosts often serve videos as application/octet-stream (or no
    // content-type). Treat octet-stream / empty as "likely video" — the real
    // proof is the download + ffprobe step.
    const isVideo = ctLower.startsWith("video/") || ctLower.startsWith("application/octet-stream") || ctLower === "";
    const buf = Buffer.from(await r.arrayBuffer());
    const head = buf.subarray(0, 100).toString("utf8");
    const isHtml = head.trimStart().toLowerCase().startsWith("<!doctype") || head.trimStart().toLowerCase().startsWith("<html");

    res.json({
      urlProvided: true,
      startsWithHttp: true,
      resolvedUrl: target.slice(0, 200),
      status: r.status,
      contentType,
      contentLength,
      isVideo: isVideo && !isHtml,
      isHtml,
      snippet: isVideo && !isHtml ? null : head,
      message: isHtml
        ? "This URL is not a video file. It is returning HTML."
        : ctLower.startsWith("video/")
        ? "URL returns a video file."
        : isVideo
        ? `URL returns binary data (${contentType || "no content-type"}) — likely video; confirm with Download + ffprobe.`
        : `URL returned non-video content-type: ${contentType || "unknown"}.`,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 2: download Scene 1 only ────────────────────── */
router.post("/export-doctor/download", requireAuth, async (req, res) => {
  try {
    const { projectId, url } = req.body as { projectId?: string; url?: string };
    if (!url || !url.startsWith("http")) {
      res.status(400).json({ error: "A valid Scene 1 http URL is required." });
      return;
    }
    if (!isAllowedClipUrl(url)) {
      res.status(400).json({ error: "Scene 1 URL host is not an allowed media source (Supabase storage, Runway CDN, or Replit object storage over HTTPS)." });
      return;
    }

    const doctorId = randomUUID();
    const folder = path.join(os.tmpdir(), `export-doctor-${Date.now()}`);
    mkdirSync(folder, { recursive: true });
    const videoPath = path.join(folder, "scene-1.mp4");

    let target = url;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }

    req.log.info({ doctorId, folder, url: target.slice(0, 100) }, "EXPORT DOCTOR download scene 1");

    const r = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    const contentType = r.headers.get("content-type") ?? "";
    if (!r.ok) {
      res.json({
        doctorId, localPath: videoPath, fileExists: false, fileSize: 0,
        responseStatus: r.status, contentType,
        ffprobeValid: false,
        error: `Download failed (HTTP ${r.status}).`,
      });
      return;
    }
    const ctLower = contentType.toLowerCase();
    if (ctLower.startsWith("text/") || ctLower.startsWith("application/json") || ctLower.startsWith("application/xml")) {
      res.json({
        doctorId, localPath: videoPath, fileExists: false, fileSize: 0,
        responseStatus: r.status, contentType,
        ffprobeValid: false,
        error: `URL returned non-video content (${contentType.split(";")[0] || "unknown"}). The clip URL may be expired or invalid.`,
      });
      return;
    }

    const ws = createWriteStream(videoPath);
    await pipeline(r.body as Parameters<typeof pipeline>[0], byteCap(MAX_CLIP_BYTES), ws);

    const fileExists = existsSync(videoPath);
    const fileSize = fileExists ? statSync(videoPath).size : 0;
    if (!fileExists || fileSize < 1024) {
      res.json({
        doctorId, localPath: videoPath, fileExists, fileSize,
        responseStatus: r.status, contentType, ffprobeValid: false,
        error: !fileExists ? "File was not created after write." : `File too small (${fileSize} bytes).`,
      });
      return;
    }

    const probe = await probeMedia(videoPath);

    sessions.set(doctorId, {
      doctorId,
      projectId: projectId ?? "",
      folder,
      videoPath,
      audioPath: null,
      createdAt: Date.now(),
    });

    req.log.info({
      doctorId, fileSize, duration: probe.duration.toFixed(2), valid: probe.valid,
    }, `EXPORT DOCTOR scene 1 downloaded: ${probe.valid ? "VALID" : "INVALID"}`);

    res.json({
      doctorId,
      localPath: videoPath,
      fileExists: true,
      fileSize,
      responseStatus: r.status,
      contentType,
      duration: probe.duration,
      codec: probe.codec,
      width: probe.width,
      height: probe.height,
      ffprobeValid: probe.valid,
      error: probe.error,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 3: export Scene 1 only (3s, no audio, 1080x1920) ── */
router.post("/export-doctor/export", requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.body as { doctorId?: string };
    const session = doctorId ? sessions.get(doctorId) : null;
    if (!session) {
      res.status(400).json({ error: "No downloaded Scene 1 session found. Run 'Download Scene 1 Only' first." });
      return;
    }
    // HARD STOP: never run FFmpeg without the local file
    if (!existsSync(session.videoPath)) {
      res.status(400).json({ error: `Scene 1 local file is missing (${session.videoPath}). Re-download before exporting.` });
      return;
    }

    const outputPath = path.join(session.folder, "scene-1-test.mp4");
    const args = [
      "-i", session.videoPath,
      "-t", "3",
      "-vf", [
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "setsar=1",
        "fps=fps=30",
      ].join(","),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-an",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];

    req.log.info({ doctorId }, "EXPORT DOCTOR scene 1 simple export (3s, no audio)");
    try {
      await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        error: `FFmpeg failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${doctorId}-scene1.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 4: export Scene 1 + audio (3s) ──────────────── */
router.post("/export-doctor/export-audio", requireAuth, async (req, res) => {
  try {
    const { doctorId, audioUrl } = req.body as { doctorId?: string; audioUrl?: string };
    const session = doctorId ? sessions.get(doctorId) : null;
    if (!session) {
      res.status(400).json({ error: "No downloaded Scene 1 session found. Run 'Download Scene 1 Only' first." });
      return;
    }
    if (!existsSync(session.videoPath)) {
      res.status(400).json({ error: `Scene 1 local file is missing (${session.videoPath}). Re-download before exporting.` });
      return;
    }
    if (!audioUrl || !audioUrl.startsWith("http")) {
      res.status(400).json({ error: "No master-player audio URL was provided." });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "Audio URL host is not an allowed media source (Supabase storage or Replit object storage over HTTPS)." });
      return;
    }

    // Download audio (same source the master player uses)
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `audio${ext}`);

    req.log.info({ doctorId, audioUrl: target.slice(0, 100) }, "EXPORT DOCTOR download audio");
    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ audioDownloaded: false, audioValid: false, error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aCt = (ar.headers.get("content-type") ?? "").toLowerCase();
    if (aCt.startsWith("text/") || aCt.startsWith("application/json") || aCt.startsWith("application/xml")) {
      res.json({ audioDownloaded: false, audioValid: false, error: `Audio URL returned non-audio content (${aCt || "unknown"}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    const audioDownloaded = existsSync(audioPath) && statSync(audioPath).size > 1024;
    if (!audioDownloaded) {
      res.json({ audioDownloaded: false, audioValid: false, error: "Audio file was not created or is too small." });
      return;
    }
    const aProbe = await probeMedia(audioPath);
    if (!aProbe.hasAudio) {
      res.json({
        audioDownloaded: true, audioValid: false, audioFileSize: statSync(audioPath).size,
        error: `Audio ffprobe found no audio stream: ${aProbe.error ?? "unknown"}.`,
      });
      return;
    }
    session.audioPath = audioPath;

    const outputPath = path.join(session.folder, "scene-1-audio-test.mp4");
    const args = [
      "-i", session.videoPath,
      "-i", audioPath,
      "-t", "3",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-vf", [
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "setsar=1",
        "fps=fps=30",
      ].join(","),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];

    req.log.info({ doctorId }, "EXPORT DOCTOR scene 1 + audio export (3s)");
    try {
      await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        audioDownloaded: true, audioValid: true,
        error: `FFmpeg failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ audioDownloaded: true, audioValid: true, error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${doctorId}-scene1-audio.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      audioDownloaded: true,
      audioValid: true,
      audioFileSize: statSync(audioPath).size,
      audioDuration: aProbe.duration,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
