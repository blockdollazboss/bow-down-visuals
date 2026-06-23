import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, readFileSync, unlinkSync, existsSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID, createHash } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";

const execFileAsync = promisify(execFile);
const router = Router();
const SIDECAR = "http://127.0.0.1:1106";
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
    audioSource = "uploaded",
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
    audioSource?: string;
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

    if (useAudio) {
      const ext = audioUrl!.includes(".mp3") ? ".mp3" : audioUrl!.includes(".ogg") ? ".ogg" : audioUrl!.includes(".wav") ? ".wav" : ".aac";
      audioPath = path.join(tmpDir, `bdv-audio-${exportId}${ext}`);
      tmpFiles.push(audioPath);
      req.log.info({ audioUrl: audioUrl!.slice(0, 80), audioSource }, "[export] downloading audio");
      await downloadToFile(audioUrl!, audioPath);
      const audioSize = statSync(audioPath).size;
      req.log.info({ audioSize, audioSource }, "[export] audio downloaded");
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

    if (addWatermark) {
      filterParts.push(`${concatInputs}concat=n=${clipPaths.length}:v=1:a=0[vconcat]`);
      const wm = `drawtext=text='Bow Down Visuals':fontsize=${TARGET_W >= 1920 ? 36 : 28}:fontcolor=white@0.35:x=(w-text_w)/2:y=h-${TARGET_H >= 1920 ? 70 : 55}:shadowcolor=black@0.5:shadowx=1:shadowy=1`;
      filterParts.push(`[vconcat]${wm}[vout]`);
    } else {
      filterParts.push(`${concatInputs}concat=n=${clipPaths.length}:v=1:a=0[vout]`);
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

    ffmpegArgs.push("-filter_complex", filterComplex);
    ffmpegArgs.push("-map", "[vout]");

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
