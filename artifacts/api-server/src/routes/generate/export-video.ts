import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, readFileSync, unlinkSync, existsSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";

const execFileAsync = promisify(execFile);
const router = Router();

const SIDECAR = "http://127.0.0.1:1106";

/* ── helpers ─────────────────────────────────────────── */

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url.slice(0, 80)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);
}

async function signGetUrl(bucketName: string, objectName: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "GET",
      expires_at: expiresAt,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to sign URL: ${res.status}`);
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

function cleanup(...files: string[]) {
  for (const f of files) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch { /* best-effort */ }
  }
}

/* ── POST /api/export-final-video ────────────────────── */

router.post("/export-final-video", requireAuth, async (req, res) => {
  const { projectId, clipUrls, audioUrl, timelineOrder } = req.body as {
    projectId: string;
    clipUrls: string[];
    audioUrl?: string | null;
    timelineOrder?: string[];
  };

  if (!projectId?.trim()) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!Array.isArray(clipUrls) || clipUrls.length === 0) {
    res.status(400).json({ error: "clipUrls must be a non-empty array" });
    return;
  }

  const exportId = randomUUID();
  const tmpDir = os.tmpdir();
  const tmpFiles: string[] = [];

  try {
    /* 1 — Download clips */
    const clipPaths: string[] = [];
    for (let i = 0; i < clipUrls.length; i++) {
      const dest = path.join(tmpDir, `bdv-clip-${exportId}-${i}.mp4`);
      tmpFiles.push(dest);
      await downloadToFile(clipUrls[i]!, dest);
      clipPaths.push(dest);
    }

    /* 2 — Write concat list */
    const concatList = path.join(tmpDir, `bdv-concat-${exportId}.txt`);
    tmpFiles.push(concatList);
    writeFileSync(concatList, clipPaths.map((p) => `file '${p}'`).join("\n"));

    /* 3 — Download audio (optional) */
    let audioPath: string | null = null;
    if (audioUrl?.trim()) {
      const ext = audioUrl.includes(".mp3") ? ".mp3"
        : audioUrl.includes(".ogg") ? ".ogg"
        : ".aac";
      audioPath = path.join(tmpDir, `bdv-audio-${exportId}${ext}`);
      tmpFiles.push(audioPath);
      await downloadToFile(audioUrl, audioPath);
    }

    /* 4 — FFmpeg: concat + optional audio */
    const outputPath = path.join(tmpDir, `bdv-export-${exportId}.mp4`);
    tmpFiles.push(outputPath);

    const ffmpegArgs: string[] = [
      "-f", "concat", "-safe", "0", "-i", concatList,
    ];

    if (audioPath) {
      ffmpegArgs.push(
        "-i", audioPath,
        "-map", "0:v",
        "-map", "1:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        "-y", outputPath,
      );
    } else {
      ffmpegArgs.push(
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-an",
        "-movflags", "+faststart",
        "-y", outputPath,
      );
    }

    await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 5 * 60 * 1000 });

    /* 5 — Upload to GCS */
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

    const objectName = `exports/${exportId}.mp4`;
    const fileBuffer = readFileSync(outputPath);
    const bucket = objectStorageClient.bucket(bucketId);
    const gcsFile = bucket.file(objectName);
    await gcsFile.save(fileBuffer, { contentType: "video/mp4" });

    /* 6 — Sign a long-lived GET URL (1 year) */
    const signedUrl = await signGetUrl(bucketId, objectName);
    const objectPath = `/objects/exports/${exportId}.mp4`;

    /* 7 — Merge export metadata into project output_data */
    const { data: existing } = await req.userSupabase!
      .from("projects")
      .select("output_data")
      .eq("id", projectId)
      .eq("user_id", req.userId!)
      .single();

    const current = (existing?.output_data as Record<string, unknown>) ?? {};
    await req.userSupabase!
      .from("projects")
      .update({
        output_data: {
          ...current,
          final_video_url: signedUrl,
          export_object_path: objectPath,
          export_status: "completed",
          export_created_at: new Date().toISOString(),
          timeline_order: timelineOrder ?? null,
          clips_used: clipUrls.length,
          audio_used: !!audioPath,
        },
      })
      .eq("id", projectId)
      .eq("user_id", req.userId!);

    res.json({ url: signedUrl, objectPath, exportId });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Export failed";
    res.status(500).json({ error: msg });
  } finally {
    cleanup(...tmpFiles);
  }
});

export default router;
