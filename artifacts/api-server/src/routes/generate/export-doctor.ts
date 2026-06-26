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

/* ── Multi-clip (all scenes) doctor session ── */
interface DoctorClipFile {
  sceneNumber: number;
  sceneTitle: string;
  sourceUrl: string;
  localPath: string;
  fileExists: boolean;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  codec: string;
  ffprobeValid: boolean;
  responseStatus: number;
  contentType: string;
  error: string | null;
}
interface DoctorMultiSession {
  multiId: string;
  projectId: string;
  folder: string;
  clips: DoctorClipFile[];
  audioPath: string | null;
  createdAt: number;
}
const multiSessions = new Map<string, DoctorMultiSession>();

// Clean up sessions older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of sessions.entries()) {
    if (s.createdAt < cutoff) {
      try { rmSync(s.folder, { recursive: true, force: true }); } catch { /* best-effort */ }
      sessions.delete(id);
    }
  }
  for (const [id, s] of multiSessions.entries()) {
    if (s.createdAt < cutoff) {
      try { rmSync(s.folder, { recursive: true, force: true }); } catch { /* best-effort */ }
      multiSessions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

/* ── Multi-clip target format + helpers (all clips normalize to 1080x1920) ── */
const MULTI_TARGET_W = 1080;
const MULTI_TARGET_H = 1920;
const MULTI_TARGET_FPS = 30;

/** Normalize one clip to 1080x1920@30 so every clip is concat-compatible. */
async function normalizeMultiClip(input: string, output: string): Promise<void> {
  const args = [
    "-i", input,
    "-vf", [
      `scale=${MULTI_TARGET_W}:${MULTI_TARGET_H}:force_original_aspect_ratio=decrease`,
      `pad=${MULTI_TARGET_W}:${MULTI_TARGET_H}:(ow-iw)/2:(oh-ih)/2:black`,
      "setsar=1",
      `fps=fps=${MULTI_TARGET_FPS}`,
    ].join(","),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-video_track_timescale", "90000",
    "-an",
    "-movflags", "+faststart",
    "-y", output,
  ];
  await execFileAsync("ffmpeg", args, { timeout: 120_000 });
}

/** HARD STOP gate: every clip must be ffprobe-valid AND physically present. */
function multiClipsBlocker(session: DoctorMultiSession): string | null {
  if (session.clips.length === 0) return "No clips in this session.";
  const invalid = session.clips.filter((c) => !c.ffprobeValid);
  if (invalid.length > 0) {
    return `Cannot export — ${invalid.length} clip(s) not valid: ` +
      invalid.map((c) => `Scene ${c.sceneNumber} (${c.error ?? "invalid"})`).join("; ");
  }
  for (const c of session.clips) {
    if (!existsSync(c.localPath)) {
      return `Scene ${c.sceneNumber} local file is missing (${c.localPath}). Re-download All Clips before exporting.`;
    }
  }
  return null;
}

/** Normalize all clips in scene order; throws with the failing scene number. */
async function normalizeAllClips(session: DoctorMultiSession): Promise<string[]> {
  const normPaths: string[] = [];
  for (const c of session.clips) {
    const np = path.join(session.folder, `norm-scene-${c.sceneNumber}.mp4`);
    await normalizeMultiClip(c.localPath, np);
    if (!existsSync(np) || statSync(np).size < 1024) {
      throw new Error(`Scene ${c.sceneNumber} failed to normalize — output missing or empty.`);
    }
    normPaths.push(np);
  }
  return normPaths;
}

/** Concatenate normalized clips (scene order) with optional audio. Returns output path. */
async function concatMultiClips(
  folder: string,
  normPaths: string[],
  audioPath: string | null,
  outName: string,
): Promise<string> {
  const outputPath = path.join(folder, outName);
  const filterParts: string[] = [];
  for (let i = 0; i < normPaths.length; i++) {
    filterParts.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);
  }
  const segs = normPaths.map((_, i) => `[v${i}]`).join("");
  filterParts.push(`${segs}concat=n=${normPaths.length}:v=1:a=0[vout]`);

  const audioIdx = audioPath ? normPaths.length : -1;
  const args: string[] = [];
  for (const np of normPaths) args.push("-i", np);
  if (audioPath) args.push("-i", audioPath);
  args.push("-filter_complex", filterParts.join(";"), "-map", "[vout]");
  if (audioPath && audioIdx >= 0) args.push("-map", `${audioIdx}:a`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "22", "-pix_fmt", "yuv420p");
  if (audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  else args.push("-an");
  args.push("-movflags", "+faststart", "-y", outputPath);

  await execFileAsync("ffmpeg", args, { timeout: 5 * 60 * 1000 });
  return outputPath;
}

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

/* ── TEST 5: download ALL clips (every scene with a demoClipUrl) ── */
router.post("/export-doctor/download-all", requireAuth, async (req, res) => {
  try {
    const { projectId, clips } = req.body as {
      projectId?: string;
      clips?: Array<{ sceneNumber?: number; title?: string; url?: string | null }>;
    };
    if (!Array.isArray(clips) || clips.length === 0) {
      res.status(400).json({ error: "No scenes were provided. Each scene needs a demoClipUrl / master player source." });
      return;
    }

    // Concatenate in deterministic scene order regardless of request ordering.
    const orderedClips = [...clips].sort((a, b) => (a.sceneNumber ?? 0) - (b.sceneNumber ?? 0));

    const multiId = randomUUID();
    const folder = path.join(os.tmpdir(), `export-doctor-multi-${Date.now()}`);
    mkdirSync(folder, { recursive: true });

    req.log.info({ multiId, folder, sceneCount: clips.length }, "EXPORT DOCTOR download all clips");

    const results: DoctorClipFile[] = [];
    for (let idx = 0; idx < orderedClips.length; idx++) {
      const c = orderedClips[idx]!;
      const sceneNumber = c.sceneNumber ?? idx + 1;
      const entry: DoctorClipFile = {
        sceneNumber,
        sceneTitle: c.title ?? `Scene ${sceneNumber}`,
        sourceUrl: c.url ?? "",
        localPath: path.join(folder, `scene-${sceneNumber}.mp4`),
        fileExists: false,
        fileSize: 0,
        duration: 0,
        width: 0,
        height: 0,
        codec: "",
        ffprobeValid: false,
        responseStatus: 0,
        contentType: "",
        error: null,
      };
      try {
        const url = c.url;
        if (!url || !url.startsWith("http")) throw new Error("no demoClipUrl / master player source found for this scene");
        if (!isAllowedClipUrl(url)) {
          throw new Error("URL host is not an allowed media source (Supabase storage, Runway CDN, or Replit object storage over HTTPS)");
        }

        let target = url;
        if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
          const { url: fresh, changed } = await tryFreshSignedUrl(target);
          if (changed) target = fresh;
        }

        const r = await fetch(target, { signal: AbortSignal.timeout(120_000) });
        entry.responseStatus = r.status;
        const contentType = r.headers.get("content-type") ?? "";
        entry.contentType = contentType;
        if (!r.ok) throw new Error(`download failed (HTTP ${r.status})`);
        const ctLower = contentType.toLowerCase();
        if (ctLower.startsWith("text/") || ctLower.startsWith("application/json") || ctLower.startsWith("application/xml")) {
          throw new Error(`URL returned non-video content (${contentType.split(";")[0] || "unknown"}) — clip URL may be expired`);
        }

        // Write the real local file and AWAIT the write completing.
        const ws = createWriteStream(entry.localPath);
        await pipeline(r.body as Parameters<typeof pipeline>[0], byteCap(MAX_CLIP_BYTES), ws);

        // fs.stat
        const exists = existsSync(entry.localPath);
        entry.fileExists = exists;
        const size = exists ? statSync(entry.localPath).size : 0;
        entry.fileSize = size;
        if (!exists) throw new Error("file was not created after write");
        if (size < 1024) throw new Error(`file too small (${size} bytes)`);

        // ffprobe
        const probe = await probeMedia(entry.localPath);
        entry.duration = probe.duration;
        entry.width = probe.width;
        entry.height = probe.height;
        entry.codec = probe.codec;
        if (!probe.hasVideo) throw new Error(`ffprobe found no video stream: ${probe.error ?? "unknown"}`);
        if (!probe.valid) throw new Error(`ffprobe invalid: ${probe.error ?? "unknown"}`);
        entry.ffprobeValid = true;
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        entry.ffprobeValid = false;
      }
      req.log.info(
        { multiId, scene: entry.sceneNumber, ok: entry.ffprobeValid, size: entry.fileSize },
        `EXPORT DOCTOR clip ${entry.sceneNumber}: ${entry.ffprobeValid ? "VALID" : "FAILED"}`,
      );
      results.push(entry);
    }

    multiSessions.set(multiId, {
      multiId,
      projectId: projectId ?? "",
      folder,
      clips: results,
      audioPath: null,
      createdAt: Date.now(),
    });

    const total = results.length;
    const downloaded = results.filter((r) => r.fileExists).length;
    const valid = results.filter((r) => r.ffprobeValid).length;
    const firstError = results.find((r) => r.error)?.error ?? null;

    res.json({
      multiId,
      total,
      downloaded,
      valid,
      allValid: total > 0 && valid === total,
      lastError: firstError,
      clips: results.map((r) => ({
        sceneNumber: r.sceneNumber,
        sceneTitle: r.sceneTitle,
        fileExists: r.fileExists,
        fileSize: r.fileSize,
        duration: r.duration,
        width: r.width,
        height: r.height,
        codec: r.codec,
        ffprobeValid: r.ffprobeValid,
        responseStatus: r.responseStatus,
        contentType: r.contentType,
        error: r.error,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 6: export ALL clips only (no audio, 1080x1920, concat) ── */
router.post("/export-doctor/export-all", requireAuth, async (req, res) => {
  try {
    const { multiId } = req.body as { multiId?: string };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }

    // HARD STOP: never run FFmpeg unless every clip is valid + present on disk.
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    req.log.info({ multiId, clipCount: normPaths.length }, "EXPORT DOCTOR export all clips (no audio)");
    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, null, "all-clips-test.mp4");
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        error: `FFmpeg concat failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
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
    const objectName = `export-doctor/${multiId}-all-clips.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount: normPaths.length,
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

/* ── TEST 7: export ALL clips + audio (concat + master-player audio) ── */
router.post("/export-doctor/export-all-audio", requireAuth, async (req, res) => {
  try {
    const { multiId, audioUrl } = req.body as { multiId?: string; audioUrl?: string };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }

    // HARD STOP: every clip must be valid + present before mixing audio.
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
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

    // Download the SAME audio source the Scene 1 + Audio test used.
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `all-audio${ext}`);

    req.log.info({ multiId, audioUrl: target.slice(0, 100) }, "EXPORT DOCTOR download audio for all-clips export");
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

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ audioDownloaded: true, audioValid: true, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    req.log.info({ multiId, clipCount: normPaths.length }, "EXPORT DOCTOR export all clips + audio");
    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, audioPath, "all-clips-audio-test.mp4");
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        audioDownloaded: true, audioValid: true,
        error: `FFmpeg concat+audio failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
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
    const objectName = `export-doctor/${multiId}-all-clips-audio.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount: normPaths.length,
      audioDownloaded: true,
      audioValid: true,
      audioFileSize: statSync(audioPath).size,
      audioDuration: aProbe.duration,
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

export default router;
