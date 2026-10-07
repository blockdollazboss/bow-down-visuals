import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI voiceover pro (SSML-like controls) ───
   Professional voiceover generation with fine-grained delivery control:
   - voice: OpenAI voice selection
   - speed: TTS rate (0.25–4.0)
   - pitch: semitone shift, tempo-preserving (-12 to +12)
   - pause markers: [[pause:1.5s]] inserts silence anywhere in the text
   - emphasis markers: **word** gets a subtle pitch lift for stress
   150 Visual Bucs per generation. */

const VOICEOVER_PRO_COST = Number(process.env["VOICEOVER_PRO_CREDITS"]) || 150;

const OPENAI_VOICES = [
  { id: "alloy", label: "Alloy", blurb: "Neutral and balanced" },
  { id: "echo", label: "Echo", blurb: "Warm and resonant" },
  { id: "fable", label: "Fable", blurb: "Expressive storyteller" },
  { id: "onyx", label: "Onyx", blurb: "Deep and commanding" },
  { id: "nova", label: "Nova", blurb: "Bright and energetic" },
  { id: "shimmer", label: "Shimmer", blurb: "Soft and clear" },
] as const;

const voiceIds = OPENAI_VOICES.map((v) => v.id) as unknown as [string, ...string[]];

const voiceoverProSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Text is required.")
    .max(4000, "Text must be 4000 characters or less."),
  voice: z.enum(voiceIds).optional().default("alloy"),
  /** TTS rate multiplier (0.25–4.0). */
  speed: z.number().min(0.25).max(4).optional().default(1),
  /** Pitch shift in semitones, tempo-preserving (-12 to +12). */
  pitch: z.number().min(-12).max(12).optional().default(0),
  /** SSML-like markup: [[pause:1.5s]] inserts silence, **word** adds stress. */
});

router.get("/voiceover-pro/voices", requireAuth, (_req, res) => {
  res.json({ voices: OPENAI_VOICES });
});

interface Segment {
  text: string;
  emphasized: boolean;
  pauseAfterSec: number;
}

/* Parse SSML-like markup into segments.
   - [[pause:1.5s]] (or [[pause:1500ms]]) -> silence between segments
   - **word** -> emphasized segment (gets a subtle +2 semitone lift) */
function parseSegments(text: string): Segment[] {
  // Split on pause tokens, keeping the tokens so durations are known
  const parts = text.split(/(\[\[pause:\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|ms)?\s*\]\])/gi);

  const segs: Segment[] = [];
  let prev: Segment | null = null;
  for (const part of parts) {
    const pauseMatch = /\[\[pause:\s*(\d+(?:\.\d+)?)\s*(ms)?\s*\]\]/i.exec(part);
    if (pauseMatch) {
      const value = parseFloat(pauseMatch[1]!);
      const seconds = Math.min(5, Math.max(0.1, pauseMatch[2] ? value / 1000 : value));
      if (prev) prev.pauseAfterSec = seconds;
      continue;
    }
    // Split out emphasized **...** spans into their own segments
    const spans = part.split(/(\*\*[^*]{1,200}\*\*)/g);
    for (const span of spans) {
      const emphMatch = /^\*\*(.+)\*\*$/.exec(span);
      const trimmed = (emphMatch ? emphMatch[1]! : span).trim();
      if (!trimmed) continue;
      const seg: Segment = { text: trimmed, emphasized: !!emphMatch, pauseAfterSec: 0 };
      segs.push(seg);
      prev = seg;
    }
  }
  if (segs.length === 0) {
    segs.push({
      text: text.replace(/\[\[pause:[^\]]*\]\]|\*\*/gi, "").trim() || "Hello",
      emphasized: false,
      pauseAfterSec: 0,
    });
  }
  return segs;
}

async function ttsChunk(text: string, voice: string, speed: number, outPath: string): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice,
      speed,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TTS generation failed (${response.status}). ${body.slice(0, 200)}`);
  }
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

/** Pitch shift in semitones without changing tempo (resample trick). */
async function applyPitch(inputPath: string, semitones: number, outPath: string): Promise<void> {
  const factor = Math.pow(2, semitones / 12);
  const args =
    semitones === 0
      ? ["-y", "-i", inputPath, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", outPath]
      : [
          "-y", "-i", inputPath,
          "-af", `asetrate=44100*${factor},aresample=44100,atempo=${1 / factor}`,
          "-ar", "44100", "-ac", "2",
          "-c:a", "libmp3lame", "-b:a", "192k",
          outPath,
        ];
  await execFileAsync("ffmpeg", args, { timeout: 120_000 });
}

async function makeSilence(seconds: number, outPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-t", seconds.toFixed(2),
    "-c:a", "libmp3lame", "-b:a", "192k",
    outPath,
  ], { timeout: 60_000 });
}

router.post("/voiceover-pro", requireAuth, async (req, res) => {
  const parsed = voiceoverProSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "Voiceover service is not configured." });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < VOICEOVER_PRO_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, VOICEOVER_PRO_COST, {
      action: "Voiceover Pro",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "voiceover-pro-"));
  const { rm } = await import("fs/promises");

  try {
    const { text, voice, speed, pitch } = parsed.data;
    const segments = parseSegments(text);
    req.log.info({ segments: segments.length, voice, speed, pitch }, "[voiceover-pro] generating");

    // 1) TTS each segment in parallel
    await Promise.all(
      segments.map((seg, i) => ttsChunk(seg.text, voice, speed, join(workDir, `raw-${i}.mp3`))),
    );

    // 2) Normalize + apply per-segment pitch (emphasis lift included)
    const piecePaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const totalSemitones = pitch + (seg.emphasized ? 2 : 0);
      const normPath = join(workDir, `seg-${i}.mp3`);
      await applyPitch(join(workDir, `raw-${i}.mp3`), totalSemitones, normPath);
      piecePaths.push(normPath);

      if (seg.pauseAfterSec > 0) {
        const silencePath = join(workDir, `silence-${i}.mp3`);
        await makeSilence(seg.pauseAfterSec, silencePath);
        piecePaths.push(silencePath);
      }
    }

    // 3) Concat into the final voiceover
    const listPath = join(workDir, "concat.txt");
    await writeFile(listPath, piecePaths.map((p) => `file '${p}'`).join("\n"));
    const outputPath = join(workDir, "voiceover.mp3");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", outputPath,
    ], { timeout: 120_000 });

    const buffer = await readFile(outputPath);
    const objectName = `voiceover-pro/${req.userId}/${randomUUID()}.mp3`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      voice,
      speed,
      pitch,
      segments: segments.length,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voiceover generation failed.";
    req.log.error({ err: message }, "[voiceover-pro] failed");
    await refundCredits(req.userId!, VOICEOVER_PRO_COST, {
      action: "Voiceover Pro — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
