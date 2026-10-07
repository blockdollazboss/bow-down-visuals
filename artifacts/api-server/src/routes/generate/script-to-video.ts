import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Script to video (CapCut parity) ───
   User provides a script. AI splits it into scenes, generates voiceover
   (TTS), visuals (AI images with Ken Burns), captions, and assembles
   a complete video. 2000 Visual Bucs. */

const SCRIPT_VIDEO_COST = Number(process.env["SCRIPT_VIDEO_CREDITS"]) || 2000;

const scriptVideoSchema = z.object({
  script: z.string().trim().min(20).max(5000),
  /** Visual style for generated images */
  visualStyle: z.string().trim().max(100).optional().default("cinematic"),
  /** Aspect ratio */
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
  /** Voice for narration */
  voice: z.string().trim().max(100).optional().default("alloy"),
});

interface Scene {
  narration: string;
  visualPrompt: string;
  duration: number; // estimated from narration length
}

async function splitScriptIntoScenes(script: string, visualStyle: string): Promise<Scene[]> {
  const model = getTextModel();
  const prompt = `Split this video script into 3-6 scenes. For each scene, provide:
1. "narration": the exact text to be spoken (keep original wording)
2. "visualPrompt": a detailed image generation prompt in ${visualStyle} style describing the visual for this scene

Script:
${script}

Return ONLY valid JSON: {"scenes": [{"narration": "...", "visualPrompt": "..."}]}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) throw new Error("Could not analyze the script.");
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty scene analysis.");

  const parsed = JSON.parse(content) as { scenes?: Array<{ narration?: string; visualPrompt?: string }> };
  if (!parsed.scenes?.length) throw new Error("No scenes found in script.");

  // Estimate duration: ~150 words per minute = 2.5 words/sec
  return parsed.scenes.map((s) => {
    const narration = s.narration || "";
    const wordCount = narration.split(/\s+/).length;
    const duration = Math.max(3, Math.ceil((wordCount / 2.5) * 10) / 10);
    return {
      narration,
      visualPrompt: s.visualPrompt || "cinematic scene",
      duration,
    };
  });
}

async function generateTTS(text: string, voice: string, outputPath: string): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("TTS generation failed.");
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function generateImage(prompt: string, outputPath: string): Promise<void> {
  const model = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1792x1024",
      quality: "standard",
      n: 1,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error("Image generation failed.");
  const data = await response.json() as { data?: Array<{ url?: string }> };
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL returned.");

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
  if (!imgRes.ok) throw new Error("Could not download generated image.");
  await writeFile(outputPath, Buffer.from(await imgRes.arrayBuffer()));
}

router.post("/script-to-video", requireAuth, async (req, res) => {
  const parsed = scriptVideoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SCRIPT_VIDEO_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SCRIPT_VIDEO_COST, {
      action: "Script to Video",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "script-video-"));

  try {
    // Step 1: Split script into scenes
    req.log.info("[script-to-video] analyzing script");
    const scenes = await splitScriptIntoScenes(parsed.data.script, parsed.data.visualStyle);
    req.log.info({ sceneCount: scenes.length }, "[script-to-video] scenes created");

    // Step 2: Generate TTS and images for each scene (in parallel)
    const sceneFiles: Array<{ image: string; audio: string; duration: number }> = [];
    await Promise.all(scenes.map(async (scene, i) => {
      const imagePath = join(workDir, `scene-${i}.png`);
      const audioPath = join(workDir, `scene-${i}.mp3`);
      await Promise.all([
        generateImage(scene.visualPrompt, imagePath),
        generateTTS(scene.narration, parsed.data.voice, audioPath),
      ]);
      sceneFiles[i] = { image: imagePath, audio: audioPath, duration: scene.duration };
    }));

    // Step 3: Create video segments (Ken Burns effect + audio)
    const segmentPaths: string[] = [];
    for (let i = 0; i < sceneFiles.length; i++) {
      const sf = sceneFiles[i]!;
      const segmentPath = join(workDir, `segment-${i}.mp4`);

      // Get actual audio duration
      const { stdout: durOut } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", sf.audio,
      ], { timeout: 30_000 });
      const audioDur = parseFloat(durOut.trim()) || sf.duration;

      // Ken Burns: slow zoom in
      const { width, height } = parsed.data.aspectRatio === "9:16"
        ? { width: 1080, height: 1920 }
        : parsed.data.aspectRatio === "1:1"
        ? { width: 1080, height: 1080 }
        : { width: 1920, height: 1080 };

      await execFileAsync("ffmpeg", [
        "-y", "-loop", "1", "-i", sf.image,
        "-i", sf.audio,
        "-filter_complex",
        `[0:v]scale=${width * 2}:${height * 2},zoompan=z='min(zoom+0.0015,1.5)':d=${Math.ceil(audioDur * 30)}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}[v]`,
        "-map", "[v]", "-map", "1:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        segmentPath,
      ], { timeout: 300_000 });

      segmentPaths.push(segmentPath);
    }

    // Step 4: Concatenate segments
    const concatList = join(workDir, "concat.txt");
    await writeFile(concatList, segmentPaths.map((p) => `file '${p}'`).join("\n"));
    const outputPath = join(workDir, "final.mp4");

    await execFileAsync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatList,
      "-c", "copy", outputPath,
    ], { timeout: 120_000 });

    // Step 5: Upload
    const buffer = await readFile(outputPath);
    const objectName = `script-video/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      sceneCount: scenes.length,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Script to video failed.";
    req.log.error({ err: message }, "[script-to-video] failed");
    await refundCredits(req.userId!, SCRIPT_VIDEO_COST, {
      action: "Script to Video — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
