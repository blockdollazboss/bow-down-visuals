import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID, createHash } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";

const execFileAsync = promisify(execFile);
const router = Router();
const SIDECAR = "http://127.0.0.1:1106";

/* ── Caption / ASS subtitle helpers ──────────────────── */

interface CaptionBurnConfig {
  mode: string;
  stylePreset: string;
  position: string;
  fontSize: string;
  textColor: string;
  outline: boolean;
  background: boolean;
  showArtistName: boolean;
  showSongTitle: boolean;
  artistNameText: string;
  songTitleText: string;
  lines: Array<{ startSec: number; endSec: number; text: string }>;
}

/** Convert #RRGGBB → ASS &H00BBGGRR */
function hexToAssColor(hex: string): string {
  const h = hex.replace("#", "").padStart(6, "0");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/** Seconds → ASS H:MM:SS.CC */
function secToAss(sec: number): string {
  const clamped = Math.max(0, sec);
  const totalCs = Math.round(clamped * 100);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const hh = Math.floor(totalM / 60);
  return `${hh}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

interface AssStyle {
  fontname: string;
  fontsize: number;
  primaryColor: string;
  outlineColor: string;
  backColor: string;
  bold: number;
  outline: number;
  shadow: number;
  borderStyle: number;
  alignment: number;
  marginV: number;
}

function resolveAssStyle(
  preset: string,
  position: string,
  fontSize: string,
  textColor: string,
  outlineOn: boolean,
  backgroundOn: boolean,
  targetW: number,
  targetH: number,
): AssStyle {
  const ALIGN: Record<string, number> = { Top: 8, Center: 5, Bottom: 2 };
  const alignment = ALIGN[position] ?? 2;

  const SIZE: Record<string, number> = { Small: 48, Medium: 60, Large: 80, XL: 96 };
  const baseSize = SIZE[fontSize] ?? 60;
  // Scale relative to the shorter dimension (handles both 9:16 and 16:9)
  const scaleFactor = Math.min(targetW, targetH) / 1080;
  const fontsize = Math.max(24, Math.round(baseSize * scaleFactor));

  const marginV = Math.round(Math.min(targetW, targetH) * 0.04);

  const PRESETS: Record<string, Partial<AssStyle>> = {
    "clean-white": {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: -1,
      outline: 3,
      shadow: 2,
    },
    drill: {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H000000FF", // red in ASS BGR
      backColor: "&H80000000",
      bold: -1,
      outline: 4,
      shadow: 1,
    },
    luxury: {
      fontname: "Georgia",
      primaryColor: "&H0000D7FF", // gold (#FFD700 → BGR 00D7FF)
      outlineColor: "&H00000000",
      backColor: "&H90000000",
      bold: 0,
      outline: 2,
      shadow: 3,
    },
    rnb: {
      fontname: "Arial",
      primaryColor: "&H00E8E8E8",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: 0,
      outline: 1,
      shadow: 4,
    },
    kids: {
      fontname: "Arial",
      primaryColor: "&H0000FFFF", // yellow (#FFFF00 → BGR 00FFFF)
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: -1,
      outline: 4,
      shadow: 0,
    },
  };

  const base = PRESETS[preset] ?? PRESETS["clean-white"]!;

  const primaryColor =
    textColor && textColor !== "#ffffff" && textColor !== "#FFFFFF"
      ? hexToAssColor(textColor)
      : (base.primaryColor ?? "&H00FFFFFF");

  return {
    fontname: base.fontname ?? "Arial",
    fontsize,
    primaryColor,
    outlineColor: base.outlineColor ?? "&H00000000",
    backColor: base.backColor ?? "&H80000000",
    bold: base.bold ?? -1,
    outline: outlineOn ? (base.outline ?? 3) : 0,
    shadow: base.shadow ?? 2,
    borderStyle: backgroundOn ? 3 : 1,
    alignment,
    marginV,
  };
}

function buildAssContent(
  config: CaptionBurnConfig,
  targetW: number,
  targetH: number,
  totalDuration: number,
): string {
  const s = resolveAssStyle(
    config.stylePreset,
    config.position,
    config.fontSize,
    config.textColor,
    config.outline,
    config.background,
    targetW,
    targetH,
  );

  const events: Array<{ start: number; end: number; text: string }> = [];

  // Artist / title cards at the very beginning
  let introOffset = 0.5;
  if (config.showArtistName && config.artistNameText) {
    events.push({ start: introOffset, end: introOffset + 3, text: config.artistNameText });
    introOffset += 3.5;
  }
  if (config.showSongTitle && config.songTitleText) {
    events.push({ start: introOffset, end: introOffset + 3, text: config.songTitleText });
  }

  // Caption lines
  for (const line of config.lines) {
    if (!line.text.trim()) continue;
    const start = Math.max(0, line.startSec);
    const end = line.endSec >= 999 ? totalDuration : Math.min(line.endSec, totalDuration);
    if (end <= start) continue;
    const text = config.stylePreset === "drill" ? line.text.toUpperCase() : line.text;
    events.push({ start, end, text });
  }

  if (events.length === 0) return "";

  const styleLine = [
    "Style: Default",
    s.fontname,
    s.fontsize,
    s.primaryColor,
    s.primaryColor,      // secondary
    s.outlineColor,
    s.backColor,
    s.bold,
    0,                   // italic
    0, 0,                // underline, strikeout
    100, 100,            // scaleX, scaleY
    0,                   // spacing
    0,                   // angle
    s.borderStyle,
    s.outline,
    s.shadow,
    s.alignment,
    30, 30,              // marginL, marginR
    s.marginV,
    1,                   // encoding
  ].join(",");

  const dialogueLines = events
    .map((e) => {
      const escaped = e.text.replace(/\n/g, "\\N").replace(/,/g, "{\\,}");
      return `Dialogue: 0,${secToAss(e.start)},${secToAss(e.end)},Default,,0,0,0,,${escaped}`;
    })
    .join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${targetW}
PlayResY: ${targetH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines}
`;
}
const IS_DEV = process.env["NODE_ENV"] !== "production";

/* ── Aspect ratio dimensions ──────────────────────────── */
const ASPECT_DIMS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1":  [1080, 1080],
};
const TARGET_FPS = 24;
const FFMPEG_TIMEOUT_MS = 8 * 60 * 1000;
const FADE_DURATION_S = 1.5;

/* ── helpers ─────────────────────────────────────────── */

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url.slice(0, 100)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);
}

interface VideoInfo {
  hasVideo: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
}

async function probeVideo(filePath: string): Promise<VideoInfo> {
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
    const duration = parseFloat(info.format?.duration ?? vs?.duration ?? "0");
    if (!vs) return { hasVideo: false, duration: 0, width: 0, height: 0, fps: 0, codec: "" };
    let fps = 0;
    if (vs.r_frame_rate) {
      const [num, den] = vs.r_frame_rate.split("/").map(Number);
      if (num && den) fps = Math.round((num / den) * 100) / 100;
    }
    return {
      hasVideo: true,
      duration: isNaN(duration) ? 0 : duration,
      width: vs.width ?? 0,
      height: vs.height ?? 0,
      fps,
      codec: vs.codec_name ?? "",
    };
  } catch {
    return { hasVideo: false, duration: 0, width: 0, height: 0, fps: 0, codec: "" };
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

function cleanup(...files: string[]) {
  for (const f of files) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
  }
}

/* ── POST /api/export-final-video ────────────────────── */

router.post("/export-final-video", requireAuth, async (req, res) => {
  const {
    projectId,
    clipUrls,
    audioUrl,
    timelineOrder,
    testMode,
    aspectRatio = "9:16",
    fadeAudioIn = false,
    fadeAudioOut = false,
    loopAudio = false,
    addWatermark = false,
    customWatermarkUrl,
    audioSource = "uploaded",
    captions,
  } = req.body as {
    projectId: string;
    clipUrls: string[];
    audioUrl?: string | null;
    timelineOrder?: string[];
    testMode?: boolean;
    aspectRatio?: string;
    fadeAudioIn?: boolean;
    fadeAudioOut?: boolean;
    loopAudio?: boolean;
    addWatermark?: boolean;
    customWatermarkUrl?: string | null;
    audioSource?: string;
    captions?: CaptionBurnConfig | null;
  };

  if (!projectId?.trim()) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!Array.isArray(clipUrls) || clipUrls.length === 0) {
    res.status(400).json({ error: "clipUrls must be a non-empty array" });
    return;
  }

  const [TARGET_W, TARGET_H] = ASPECT_DIMS[aspectRatio] ?? ASPECT_DIMS["9:16"]!;

  const exportId = randomUUID();
  const tmpDir = os.tmpdir();
  const tmpFiles: string[] = [];

  try {
    req.log.info({
      clipCount: clipUrls.length,
      aspectRatio,
      resolution: `${TARGET_W}x${TARGET_H}`,
      audioSource,
      hasAudio: !!audioUrl,
      fadeAudioIn,
      fadeAudioOut,
      loopAudio,
      addWatermark,
      testMode: !!testMode,
    }, "[export] starting");

    /* ── 1: Download & verify every clip ── */
    const clipPaths: string[] = [];
    const clipInfos: VideoInfo[] = [];

    for (let i = 0; i < clipUrls.length; i++) {
      const url = clipUrls[i]!;
      if (!url.startsWith("http")) throw new Error(`Clip ${i + 1}: invalid URL — "${url.slice(0, 60)}"`);

      const dest = path.join(tmpDir, `bdv-clip-${exportId}-${i}.mp4`);
      tmpFiles.push(dest);

      req.log.info({ i: i + 1, url: url.slice(0, 80) }, "[export] downloading clip");

      try {
        await downloadToFile(url, dest);
      } catch (dlErr) {
        throw new Error(`Clip ${i + 1} could not be downloaded: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`);
      }

      const fileSize = statSync(dest).size;
      req.log.info({ i: i + 1, fileSize, path: dest }, "[export] clip downloaded");

      if (fileSize < 1024) {
        throw new Error(`Clip ${i + 1} download too small (${fileSize} bytes) — URL may be expired or invalid`);
      }

      const info = await probeVideo(dest);
      req.log.info({ i: i + 1, info }, "[export] clip probed");

      if (!info.hasVideo) throw new Error(`Clip ${i + 1} has no video stream`);
      if (info.duration <= 0) throw new Error(`Clip ${i + 1} has zero duration`);

      clipPaths.push(dest);
      clipInfos.push(info);
    }

    /* ── Compute total video duration ── */
    const totalVideoDuration = clipInfos.reduce((sum, c) => sum + c.duration, 0);

    if (IS_DEV) {
      req.log.info({
        clips: clipInfos.map((c, i) => ({
          index: i + 1,
          url: clipUrls[i]!.slice(0, 80),
          resolution: `${c.width}x${c.height}`,
          fps: c.fps,
          duration: `${c.duration.toFixed(2)}s`,
          codec: c.codec,
        })),
        totalDuration: `${totalVideoDuration.toFixed(2)}s`,
        targetResolution: `${TARGET_W}x${TARGET_H}@${TARGET_FPS}fps`,
        selectedAudioSource: audioSource,
        audioUrl: audioUrl ? audioUrl.slice(0, 80) : null,
      }, "[export][debug] clips included");
    }

    /* ── 1b: Dedup check ── */
    const clipFingerprints: string[] = [];
    for (const cp of clipPaths) {
      const size = statSync(cp).size;
      const head = readFileSync(cp).subarray(0, 65536);
      const fp   = createHash("sha256").update(head).digest("hex").slice(0, 16) + `_${size}`;
      clipFingerprints.push(fp);
    }
    const uniqueFingerprints = new Set(clipFingerprints);
    const identicalClipsDetected = uniqueFingerprints.size < clipPaths.length;
    if (identicalClipsDetected) {
      req.log.warn({ fingerprints: clipFingerprints }, "[export] identical clips detected");
    } else {
      req.log.info({ fingerprints: clipFingerprints }, "[export] all clips are distinct");
    }

    /* ── 2: Download audio ── */
    let audioPath: string | null = null;
    const useAudio = !testMode && !!audioUrl?.trim();
    const DEFAULT_WATERMARK = path.join(process.cwd(), "artifacts/bow-down-visuals/public/bdv-watermark.png");

    if (useAudio) {
      const ext = audioUrl!.includes(".mp3") ? ".mp3" : audioUrl!.includes(".ogg") ? ".ogg" : audioUrl!.includes(".wav") ? ".wav" : ".aac";
      audioPath = path.join(tmpDir, `bdv-audio-${exportId}${ext}`);
      tmpFiles.push(audioPath);
      req.log.info({ audioUrl: audioUrl!.slice(0, 80), audioSource }, "[export] downloading audio");
      await downloadToFile(audioUrl!, audioPath);
      const audioSize = statSync(audioPath).size;
      req.log.info({ audioSize, audioSource }, "[export] audio downloaded");
    }

    /* ── 2b: Resolve watermark image path ── */
    let watermarkPath: string | null = null;
    if (addWatermark) {
      if (customWatermarkUrl?.startsWith("http")) {
        const wmExt = /\.(jpe?g)($|\?)/.test(customWatermarkUrl) ? ".jpg"
          : /\.webp($|\?)/.test(customWatermarkUrl) ? ".webp" : ".png";
        const wmDest = path.join(tmpDir, `bdv-wm-${exportId}${wmExt}`);
        tmpFiles.push(wmDest);
        try {
          await downloadToFile(customWatermarkUrl, wmDest);
          watermarkPath = wmDest;
          req.log.info({ bytes: statSync(wmDest).size }, "[export] custom watermark downloaded");
        } catch (wmErr) {
          req.log.warn({ err: String(wmErr) }, "[export] custom watermark download failed, falling back to default");
          watermarkPath = DEFAULT_WATERMARK;
        }
      } else {
        watermarkPath = DEFAULT_WATERMARK;
      }
      if (IS_DEV) req.log.info({ watermarkPath }, "[export][debug] watermark resolved");
    }

    /* ── 2c: Write ASS caption file if captions are active ── */
    let captionsAssPath: string | null = null;
    const captionsActive =
      captions &&
      captions.mode !== "none" &&
      (captions.lines.length > 0 || captions.showArtistName || captions.showSongTitle);

    if (captionsActive) {
      const assContent = buildAssContent(captions!, TARGET_W, TARGET_H, totalVideoDuration);
      if (assContent.trim()) {
        captionsAssPath = path.join(tmpDir, `bdv-captions-${exportId}.ass`);
        tmpFiles.push(captionsAssPath);
        writeFileSync(captionsAssPath, assContent, "utf8");
        req.log.info(
          { captionsAssPath, lines: captions!.lines.length, mode: captions!.mode },
          "[export] ASS captions file written",
        );
      }
    }

    /* ── 3: Build video filter_complex — normalize + concat + optional watermark ── */
    const scaleFilter = [
      `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease`,
      `pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:black`,
      `setsar=1`,
      `fps=fps=${TARGET_FPS}`,
    ].join(",");

    const filterParts: string[] = [];
    for (let i = 0; i < clipPaths.length; i++) {
      filterParts.push(`[${i}:v]${scaleFilter}[v${i}]`);
    }
    const concatInputs = clipPaths.map((_, i) => `[v${i}]`).join("");

    if (addWatermark && watermarkPath) {
      const wmInputIdx = clipPaths.length + (audioPath ? 1 : 0);
      const wmW = Math.round(TARGET_W * 0.20);
      filterParts.push(`${concatInputs}concat=n=${clipPaths.length}:v=1:a=0[vconcat]`);
      filterParts.push(`[${wmInputIdx}:v]scale=${wmW}:-2[wm]`);
      filterParts.push(`[vconcat][wm]overlay=W-w-24:H-h-24:format=auto[vout]`);
    } else {
      filterParts.push(`${concatInputs}concat=n=${clipPaths.length}:v=1:a=0[vout]`);
    }

    /* ── 3b: Inject ASS subtitle filter if captions were written ── */
    let voutLabel = "vout";
    if (captionsAssPath) {
      // Escape path for filter_complex (escape backslash then colon)
      const escapedPath = captionsAssPath
        .replace(/\\/g, "\\\\")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'");
      filterParts.push(`[vout]subtitles='${escapedPath}'[vfinal]`);
      voutLabel = "vfinal";
      req.log.info({ voutLabel, escapedPath }, "[export] ASS subtitle filter injected");
    }

    const filterComplex = filterParts.join(";");

    /* ── 4: Build audio filter chain ── */
    const audioFilterParts: string[] = [];
    if (audioPath) {
      if (loopAudio) {
        audioFilterParts.push(`aloop=loop=-1:size=2147483647`);
        audioFilterParts.push(`atrim=duration=${totalVideoDuration.toFixed(3)}`);
        audioFilterParts.push(`asetpts=PTS-STARTPTS`);
      }
      if (fadeAudioIn) {
        audioFilterParts.push(`afade=t=in:st=0:d=${FADE_DURATION_S}`);
      }
      if (fadeAudioOut && totalVideoDuration > FADE_DURATION_S * 2) {
        const fadeOutStart = Math.max(0, totalVideoDuration - FADE_DURATION_S);
        audioFilterParts.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION_S}`);
      }
    }

    /* ── 5: Build FFmpeg args ── */
    const outputPath = path.join(tmpDir, `bdv-export-${exportId}.mp4`);
    tmpFiles.push(outputPath);

    const ffmpegArgs: string[] = [];

    for (const cp of clipPaths) {
      ffmpegArgs.push("-i", cp);
    }
    if (audioPath) {
      ffmpegArgs.push("-i", audioPath);
    }
    if (addWatermark && watermarkPath) {
      ffmpegArgs.push("-loop", "1", "-i", watermarkPath);
    }

    ffmpegArgs.push("-filter_complex", filterComplex);
    ffmpegArgs.push("-map", `[${voutLabel}]`);

    if (audioPath) {
      ffmpegArgs.push("-map", `${clipPaths.length}:a`);
    }

    ffmpegArgs.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
    );

    if (audioPath) {
      if (audioFilterParts.length > 0) {
        ffmpegArgs.push("-af", audioFilterParts.join(","));
      }
      ffmpegArgs.push("-c:a", "aac", "-b:a", "192k");
      /* Cap output at video duration — avoids long silent tail when audio loops
         or is longer than video. Also ensures video isn't cut short by -shortest. */
      ffmpegArgs.push("-t", totalVideoDuration.toFixed(3));
    } else {
      ffmpegArgs.push("-an");
    }

    ffmpegArgs.push("-movflags", "+faststart", "-y", outputPath);

    if (IS_DEV) {
      req.log.info({
        filterComplex,
        audioFilter: audioFilterParts.join(",") || "(none)",
        ffmpegCommand: `ffmpeg ${ffmpegArgs.join(" ")}`,
        totalDuration: `${totalVideoDuration.toFixed(2)}s`,
      }, "[export][debug] FFmpeg command");
    }

    /* ── 6: Run FFmpeg ── */
    try {
      const { stderr } = await execFileAsync("ffmpeg", ffmpegArgs, { timeout: FFMPEG_TIMEOUT_MS });
      if (IS_DEV && stderr) req.log.info({ stderr: stderr.slice(-500) }, "[export] FFmpeg stderr (last 500)");
    } catch (ffErr: unknown) {
      const stderr = (ffErr as { stderr?: string }).stderr ?? "";
      if (IS_DEV) req.log.error({ stderr }, "[export] FFmpeg error output");
      const msg = ffErr instanceof Error ? ffErr.message : String(ffErr);
      throw new Error(`FFmpeg failed: ${msg.slice(0, 300)}`);
    }

    /* ── 7: Verify output ── */
    if (!existsSync(outputPath)) throw new Error("FFmpeg produced no output file");

    const outSize = statSync(outputPath).size;
    req.log.info({ outSize, outputPath }, "[export] output file written");

    if (IS_DEV) {
      req.log.info({ finalVideoBytes: outSize, finalVideoMB: (outSize / 1024 / 1024).toFixed(2) }, "[export][debug] final video file size");
    }

    if (outSize < 1024) {
      throw new Error(`Output file too small (${outSize} bytes) — FFmpeg may have failed silently`);
    }

    const outInfo = await probeVideo(outputPath);
    req.log.info({ outInfo }, "[export] output probed");

    if (!outInfo.hasVideo) throw new Error("Output file has no video stream");
    if (outInfo.duration <= 0) throw new Error("Output file has zero duration");

    /* ── 8: Upload to GCS ── */
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

    const objectName = `exports/${exportId}.mp4`;
    const fileBuffer = readFileSync(outputPath);
    const bucket = objectStorageClient.bucket(bucketId);
    const gcsFile = bucket.file(objectName);
    await gcsFile.save(fileBuffer, { contentType: "video/mp4", resumable: false });
    req.log.info({ objectName, bytes: fileBuffer.length }, "[export] uploaded to GCS");

    /* ── 9: Sign URL ── */
    const signedUrl = await signGetUrl(bucketId, objectName);
    const objectPath = `/objects/exports/${exportId}.mp4`;

    /* ── 10: Save to project ── */
    if (!testMode) {
      const { data: fullProject, error: selectErr } = await req.userSupabase!
        .from("projects")
        .select("id, user_id, project_type, title, artist_name, song_title, genre, mood, style, platform, input_data, output_data, credits_used, created_at")
        .eq("id", projectId)
        .eq("user_id", req.userId!)
        .single();

      if (selectErr || !fullProject) {
        req.log.warn({ err: selectErr?.message }, "[export] project not found for save");
      } else {
        const current = (fullProject.output_data as Record<string, unknown>) ?? {};
        const updatedOutputData = {
          ...current,
          final_video_url: signedUrl,
          export_object_path: objectPath,
          export_status: "completed",
          export_created_at: new Date().toISOString(),
          timeline_order: timelineOrder ?? null,
          clips_used: clipUrls.length,
          audio_used: !!audioPath,
          audio_source: audioSource,
          aspect_ratio: aspectRatio,
        };

        const { error: delErr } = await req.userSupabase!
          .from("projects").delete().eq("id", projectId).eq("user_id", req.userId!);

        if (delErr) {
          req.log.warn({ err: delErr.message }, "[export] delete error during save");
        } else {
          const { error: insErr } = await req.userSupabase!
            .from("projects")
            .insert({
              id: fullProject.id,
              user_id: fullProject.user_id,
              project_type: fullProject.project_type,
              title: fullProject.title,
              artist_name: fullProject.artist_name,
              song_title: fullProject.song_title,
              genre: fullProject.genre,
              mood: fullProject.mood,
              style: fullProject.style ?? null,
              platform: fullProject.platform ?? null,
              input_data: fullProject.input_data,
              output_data: updatedOutputData,
              credits_used: fullProject.credits_used,
              created_at: fullProject.created_at,
            });

          if (insErr) {
            req.log.warn({ err: insErr.message }, "[export] re-insert error");
            await req.userSupabase!.from("projects").insert(fullProject);
          } else {
            req.log.info({ projectId, clips: clipUrls.length, audioSource }, "[export] project saved ok");
          }
        }
      }
    }

    res.json({
      url: signedUrl,
      objectPath,
      exportId,
      clipCount: clipPaths.length,
      audioIncluded: !!audioPath,
      audioSource,
      aspectRatio,
      duration: outInfo.duration,
      testMode: !!testMode,
      debug: {
        identicalClipsDetected,
        fingerprints: clipFingerprints,
        ...(IS_DEV ? {
          clips: clipInfos,
          output: outInfo,
          outputBytes: outSize,
          targetResolution: `${TARGET_W}x${TARGET_H}@${TARGET_FPS}fps`,
          totalVideoDuration,
          audioFilters: audioFilterParts.join(",") || null,
          watermark: addWatermark,
        } : {}),
      },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Export failed";
    req.log.error({ err: msg }, "[export] failed");
    res.status(500).json({ error: msg });
  } finally {
    cleanup(...tmpFiles);
  }
});

export default router;
