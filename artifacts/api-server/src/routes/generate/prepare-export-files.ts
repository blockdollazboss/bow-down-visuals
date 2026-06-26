import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { registerPreparedExport, type PreparedClipEntry } from "../../lib/prepared-exports";

const execFileAsync = promisify(execFile);
const router = Router();

const SIDECAR = "http://127.0.0.1:1106";

const SUPABASE_HOST = (() => {
  const url = process.env["SUPABASE_URL"] ?? "";
  try { return new URL(url).host; } catch { return ""; }
})();

/** Priority order for URL field discovery — first non-empty http URL wins */
const URL_FIELD_PRIORITY = [
  "scene.demoClipUrl",
  "scene.clipUrl",
  "scene.clip_url",
  "scene.videoUrl",
  "scene.video_url",
  "scene.runwayOutputUrl",
  "scene.runway_output_url",
  "scene.generatedClipUrl",
  "scene.generated_clip_url",
  "clip.url",
  "clip.videoUrl",
  "clip.video_url",
  "clip.outputUrl",
  "clip.output_url",
  "clip.assetUrl",
  "clip.asset_url",
  "clip.runwayUrl",
  "clip.runway_url",
  "clip.storageUrl",
  "clip.storage_url",
];

function findSourceUrl(urlFields: Record<string, string>): { fieldName: string; url: string } | null {
  for (const field of URL_FIELD_PRIORITY) {
    const val = urlFields[field];
    if (val && val.startsWith("http")) {
      return { fieldName: field, url: val };
    }
  }
  // Fallback: try any remaining field not in the priority list
  for (const [field, val] of Object.entries(urlFields)) {
    if (val && val.startsWith("http")) {
      return { fieldName: field, url: val };
    }
  }
  return null;
}

function detectSourceType(url: string): string {
  if (SUPABASE_HOST && url.includes(SUPABASE_HOST)) return "supabase-storage";
  if (url.includes("dnznrvs05pmza.cloudfront.net")) return "runway-cloudfront";
  if (url.toLowerCase().includes("runway")) return "runway";
  return "http";
}

async function headCheck(url: string): Promise<{ status: number; ok: boolean }> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000) });
    return { status: r.status, ok: r.ok };
  } catch {
    return { status: 0, ok: false };
  }
}

interface DownloadResult {
  status: number;
  contentType: string;
  bytesWritten: number;
}

async function downloadToFile(url: string, dest: string): Promise<DownloadResult> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  const contentType = res.headers.get("content-type") ?? "";
  const status = res.status;

  if (!res.ok) {
    throw new Error(
      `Download failed (HTTP ${status}): ${url.slice(0, 100)}` +
      (contentType ? ` — Content-Type: ${contentType.split(";")[0]}` : ""),
    );
  }

  // Reject if the server returned HTML/JSON instead of video data
  const ctLower = contentType.toLowerCase();
  const isBadContent =
    ctLower.startsWith("text/") ||
    ctLower.startsWith("application/json") ||
    ctLower.startsWith("application/xml");
  if (isBadContent) {
    throw new Error(
      `URL returned non-video content (${contentType.split(";")[0] || "unknown"}). ` +
      `The clip URL may be expired or invalid. Re-generate this clip.`,
    );
  }

  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);

  const bytesWritten = existsSync(dest) ? statSync(dest).size : 0;
  return { status, contentType, bytesWritten };
}

interface ProbeResult {
  valid: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  error: string | null;
}

async function probeClip(filePath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath],
      { timeout: 30_000 },
    );
    const info = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        duration?: string;
      }>;
      format?: { duration?: string };
    };
    const vs = info.streams?.find((s) => s.codec_type === "video");
    if (!vs) return { valid: false, duration: 0, width: 0, height: 0, fps: 0, codec: "", error: "no video stream" };
    const dur = parseFloat(info.format?.duration ?? vs.duration ?? "0");
    if (isNaN(dur) || dur <= 0) return { valid: false, duration: 0, width: 0, height: 0, fps: 0, codec: "", error: "zero or invalid duration" };
    let fps = 0;
    if (vs.r_frame_rate) {
      const [num, den] = vs.r_frame_rate.split("/").map(Number);
      if (num && den) fps = Math.round((num / den) * 100) / 100;
    }
    return { valid: true, duration: dur, width: vs.width ?? 0, height: vs.height ?? 0, fps, codec: vs.codec_name ?? "", error: null };
  } catch (e) {
    return { valid: false, duration: 0, width: 0, height: 0, fps: 0, codec: "", error: e instanceof Error ? e.message.slice(0, 120) : "ffprobe failed" };
  }
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

/* ── POST /api/prepare-export-files ─────────────────── */

interface ClipInput {
  sceneNumber: number;
  sceneTitle: string;
  clipId: string | null;
  provider: string | null;
  approved: boolean;
  selected: boolean;
  /** All candidate URL fields from the scene/clip object */
  urlFields: Record<string, string>;
}

router.post("/prepare-export-files", requireAuth, async (req, res) => {
  const { projectId, clips } = req.body as {
    projectId: string;
    clips: ClipInput[];
  };

  if (!projectId?.trim()) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!Array.isArray(clips) || clips.length === 0) {
    res.status(400).json({ error: "clips must be a non-empty array" });
    return;
  }

  const prepareId = randomUUID();
  const exportDir = path.join(os.tmpdir(), `export-${projectId}-${Date.now()}`);
  mkdirSync(exportDir, { recursive: true });

  req.log.info({
    msg: "EXPORT DEBUG START",
    projectId,
    prepareId,
    totalScenes: clips.length,
    scenes: clips.map((c) => ({
      n: c.sceneNumber,
      title: c.sceneTitle.slice(0, 60),
      urlFieldKeys: Object.keys(c.urlFields),
    })),
  }, "EXPORT DEBUG START");

  const results: PreparedClipEntry[] = [];

  for (const clip of clips) {
    const entry: PreparedClipEntry = {
      sceneNumber: clip.sceneNumber,
      sceneTitle: clip.sceneTitle,
      clipDbId: clip.clipId ?? null,
      provider: clip.provider ?? null,
      approved: clip.approved,
      selected: clip.selected,
      sourceFieldName: "",
      originalUrl: "",
      resolvedUrl: "",
      sourceType: "",
      sourceUrlStartsWithHttp: false,
      sourceUrlDownloadable: false,
      localPath: "",
      fileWritten: false,
      fileExistsAfterWrite: false,
      fileSize: 0,
      duration: 0,
      width: 0,
      height: 0,
      fps: 0,
      codec: "",
      ffprobeValid: false,
      readyForFFmpeg: false,
      error: null,
      responseStatus: 0,
      contentType: "",
    };

    try {
      // ── URL discovery ──────────────────────────────────
      const found = findSourceUrl(clip.urlFields);

      if (!found) {
        const scannedFields = Object.keys(clip.urlFields).join(", ") || "(none)";
        throw new Error(
          `Scene ${clip.sceneNumber}: no downloadable URL found. ` +
          `Scanned fields: ${scannedFields}. ` +
          `All values were empty or did not start with http. ` +
          `Click Sync Missing Clips or regenerate this scene.`,
        );
      }

      entry.sourceFieldName = found.fieldName;
      entry.originalUrl = found.url;
      entry.resolvedUrl = found.url;
      entry.sourceType = detectSourceType(found.url);
      entry.sourceUrlStartsWithHttp = found.url.startsWith("http");

      req.log.info({
        msg: "EXPORT DEBUG SCENE",
        scene: clip.sceneNumber,
        sceneTitle: clip.sceneTitle.slice(0, 60),
        sourceField: found.fieldName,
        sourceUrl: found.url.slice(0, 120),
        sourceType: entry.sourceType,
        urlFieldsScanned: Object.keys(clip.urlFields),
      }, `Scene ${clip.sceneNumber} found source field: ${found.fieldName}`);

      // ── HEAD check ────────────────────────────────────
      const hc = await headCheck(found.url);
      entry.sourceUrlDownloadable = hc.ok;

      req.log.info({
        scene: clip.sceneNumber,
        headStatus: hc.status,
        headOk: hc.ok,
      }, `Scene ${clip.sceneNumber} HEAD check`);

      if (entry.sourceType === "supabase-storage") {
        const { url: freshUrl, changed } = await tryFreshSignedUrl(found.url);
        if (changed) {
          entry.resolvedUrl = freshUrl;
          req.log.info({ scene: clip.sceneNumber }, "[prepare] fresh signed URL generated for Supabase clip");
        } else if (!hc.ok) {
          req.log.warn({ scene: clip.sceneNumber, httpStatus: hc.status }, "[prepare] Supabase HEAD failed, using original URL");
        }
      } else if (!hc.ok) {
        req.log.warn({ scene: clip.sceneNumber, httpStatus: hc.status, type: entry.sourceType }, "[prepare] HEAD check non-200, will attempt download anyway");
      }

      // ── Download ──────────────────────────────────────
      const localPath = path.join(exportDir, `clip-scene-${clip.sceneNumber}.mp4`);

      req.log.info({
        scene: clip.sceneNumber,
        resolvedUrl: entry.resolvedUrl.slice(0, 120),
        localPath,
      }, `Scene ${clip.sceneNumber} source URL: ${entry.resolvedUrl.slice(0, 120)}`);

      let dlResult: DownloadResult;
      try {
        dlResult = await downloadToFile(entry.resolvedUrl, localPath);
        entry.fileWritten = true;
        entry.responseStatus = dlResult.status;
        entry.contentType = dlResult.contentType;
      } catch (dlErr) {
        entry.fileWritten = false;
        throw new Error(
          `Scene ${clip.sceneNumber} clip download failed: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`,
        );
      }

      const fileExists = existsSync(localPath);
      entry.fileExistsAfterWrite = fileExists;

      req.log.info({
        scene: clip.sceneNumber,
        downloadStatus: dlResult.status,
        contentType: dlResult.contentType || "(none)",
        bytesWritten: dlResult.bytesWritten,
        localPath,
        fileWritten: entry.fileWritten,
        fileExistsAfterWrite: fileExists,
      }, `Scene ${clip.sceneNumber} download status: ${dlResult.status} content-type: ${dlResult.contentType || "(none)"} local path: ${localPath} bytes written: ${dlResult.bytesWritten}`);

      if (!fileExists) {
        throw new Error(`Scene ${clip.sceneNumber} local export file was not created after write.`);
      }

      const fileSize = statSync(localPath).size;
      entry.localPath = localPath;
      entry.fileSize = fileSize;

      req.log.info({
        scene: clip.sceneNumber,
        fileSize,
      }, `Scene ${clip.sceneNumber} file exists: true  file size: ${fileSize} bytes`);

      if (fileSize < 2048) {
        throw new Error(
          `Scene ${clip.sceneNumber} clip download appears incomplete — file is only ${fileSize} bytes.`,
        );
      }

      // ── ffprobe ───────────────────────────────────────
      const probe = await probeClip(localPath);
      entry.ffprobeValid = probe.valid;
      entry.duration = probe.duration;
      entry.width = probe.width;
      entry.height = probe.height;
      entry.fps = probe.fps;
      entry.codec = probe.codec;

      req.log.info({
        scene: clip.sceneNumber,
        ffprobeValid: probe.valid,
        duration: probe.valid ? probe.duration.toFixed(2) : "n/a",
        resolution: probe.valid ? `${probe.width}x${probe.height}` : "n/a",
        codec: probe.codec || "n/a",
      }, `Scene ${clip.sceneNumber} ffprobe valid: ${probe.valid}${probe.error ? ` error: ${probe.error}` : ""}`);

      if (!probe.valid) {
        throw new Error(`Scene ${clip.sceneNumber} ffprobe invalid: ${probe.error}`);
      }

      entry.readyForFFmpeg = true;
      req.log.info({
        scene: clip.sceneNumber,
        fileSize,
        duration: probe.duration.toFixed(2),
        resolution: `${probe.width}x${probe.height}`,
      }, `Scene ${clip.sceneNumber} ready for FFmpeg: YES ✓`);

    } catch (e) {
      entry.error = e instanceof Error ? e.message : String(e);
      entry.readyForFFmpeg = false;
      req.log.warn({ scene: clip.sceneNumber, error: entry.error }, `Scene ${clip.sceneNumber} FAILED: ${entry.error}`);
    }

    results.push(entry);
  }

  const allReady = results.length > 0 && results.every((r) => r.readyForFFmpeg);
  const readyCount = results.filter((r) => r.readyForFFmpeg).length;

  req.log.info({
    msg: "EXPORT DEBUG END",
    prepareId,
    allReady,
    readyCount,
    total: results.length,
    failedScenes: results.filter((r) => !r.readyForFFmpeg).map((r) => r.sceneNumber),
  }, `EXPORT DEBUG END — ready: ${readyCount}/${results.length}`);

  registerPreparedExport(prepareId, {
    projectId,
    exportDir,
    clips: results,
    allReady,
    createdAt: Date.now(),
  });

  res.json({
    prepareId,
    exportDir,
    allReady,
    totalClips: results.length,
    readyClips: readyCount,
    clips: results,
  });
});

export default router;
