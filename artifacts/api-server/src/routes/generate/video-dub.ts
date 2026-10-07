import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { toFile } from "openai/uploads";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI video dubbing ───
   Transcribes a video's speech, translates it to a target language,
   synthesizes a dubbed voiceover (voice-cloned from the original speaker
   when ElevenLabs is available), time-fits it to the original segment
   timing, and muxes it back into the video.
   500 Visual Bucs. */

const DUB_COST = Number(process.env["VIDEO_DUB_CREDITS"]) || 500;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 600_000;

const DUB_LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "en", label: "English" },
] as const;

const dubSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  targetLanguage: z.string().trim().min(2).max(8),
  /** Optional override; when omitted whisper auto-detects. */
  sourceLanguage: z.string().trim().min(2).max(8).optional(),
  /** Keep a low mix of the original audio under the dub (0 = replace). */
  keepOriginalMix: z.number().min(0).max(0.5).default(0),
});

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
    { timeout: 30_000 },
  );
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not determine media duration.");
  return d;
}

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

async function transcribeWithSegments(audioPath: string, language?: string): Promise<WhisperSegment[]> {
  const file = await toFile(await readFile(audioPath), "audio.mp3", { type: "audio/mpeg" });
  const out = await getOpenAI().audio.transcriptions.create(
    {
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      ...(language ? { language } : {}),
    },
    { signal: AbortSignal.timeout(300_000) },
  );
  const segs = ((out as unknown as { segments?: Array<{ start: number; end: number; text: string }> }).segments ?? [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").trim() }))
    .filter((s) => s.text.length > 0 && s.end > s.start);
  return segs;
}

async function translateSegments(texts: string[], targetLabel: string): Promise<string[]> {
  const model = getTextModel();
  const prompt =
    `Translate these video speech segments to ${targetLabel}. ` +
    `Keep the same order, keep each translation concise and natural for spoken dubbing. ` +
    `Return ONLY a JSON object shaped like {"translations": ["...", "..."]}.\n\n` +
    JSON.stringify(texts);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error("Translation failed.");
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as { translations?: string[] };
  if (!Array.isArray(parsed.translations) || parsed.translations.length !== texts.length) {
    throw new Error("Translation returned an unexpected shape.");
  }
  return parsed.translations.map((t) => String(t).trim());
}

/** Best-effort instant voice clone from the source audio; returns an
 *  ElevenLabs voice id or null when cloning is unavailable. */
async function cloneSpeakerVoice(samplePath: string, apiKey: string): Promise<string | null> {
  try {
    const { Blob } = await import("buffer");
    const buf = await readFile(samplePath);
    const form = new FormData();
    form.append("name", `dub-speaker-${randomUUID().slice(0, 8)}`);
    form.append("description", "Auto-cloned source speaker for video dubbing");
    form.append("files", new Blob([buf], { type: "audio/mpeg" }), "sample.mp3");
    const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { voice_id?: string };
    return data.voice_id ?? null;
  } catch {
    return null;
  }
}

async function synthesizeSpeech(text: string, voiceId: string | null, apiKey: string | undefined): Promise<Buffer> {
  if (voiceId && apiKey) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env["ELEVENLABS_TTS_MODEL"] || "eleven_multilingual_v2",
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`Dubbed voice synthesis failed (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
  const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", input: text, voice: "alloy" }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!ttsRes.ok) throw new Error("Dubbed voice synthesis failed.");
  return Buffer.from(await ttsRes.arrayBuffer());
}

/** Fit a TTS clip into a target duration: speed up/down within 0.5x-2x,
 *  trim overflow, pad underflow with silence. */
async function fitClipToDuration(ttsPath: string, outPath: string, targetSec: number): Promise<void> {
  const ttsDur = await probeDurationSec(ttsPath);
  const ratio = ttsDur / Math.max(targetSec, 0.1);
  const rate = Math.min(2.0, Math.max(0.5, ratio));
  // After atempo, duration becomes ttsDur / rate; atrim caps overflow, apad fills underflow.
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-i", ttsPath,
      "-filter:a", `atempo=${rate.toFixed(4)},atrim=0:${targetSec.toFixed(3)},apad=whole_dur=${targetSec.toFixed(3)}`,
      "-ar", "44100", "-ac", "2",
      outPath,
    ],
    { timeout: FFMPEG_TIMEOUT_MS },
  );
}

async function makeSilence(outPath: string, durSec: number): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", durSec.toFixed(3), "-q:a", "2", outPath],
    { timeout: 60_000 },
  );
}

router.get("/dub-languages", requireAuth, (_req, res) => {
  res.json({ languages: DUB_LANGUAGES, price: DUB_COST });
});

router.post("/dub-video", requireAuth, async (req, res) => {
  const parsed = dubSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { videoUrl, targetLanguage, sourceLanguage, keepOriginalMix } = parsed.data;
  const lang = DUB_LANGUAGES.find((l) => l.code === targetLanguage.toLowerCase());
  if (!lang) {
    res.status(400).json({ error: `Unsupported target language: ${targetLanguage}.` });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < DUB_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, DUB_COST, { action: `Video Dubbing (${lang.label})` });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const fail = async (status: number, message: string) => {
    await refundCredits(req.userId!, DUB_COST, { action: "Video Dubbing — Refund" }).catch(() => {});
    res.status(status).json({ error: message });
  };

  const workDir = await mkdtemp(join(tmpdir(), "video-dub-"));
  const inputPath = join(workDir, "input.mp4");
  const audioPath = join(workDir, "source-audio.mp3");
  const cloneSamplePath = join(workDir, "clone-sample.mp3");
  let clonedVoiceId: string | null = null;
  const apiKey = elevenKey();

  const cleanup = async () => {
    // Best-effort delete of the temporary cloned voice.
    if (clonedVoiceId && apiKey) {
      await fetch(`https://api.elevenlabs.io/v1/voices/${clonedVoiceId}`, {
        method: "DELETE",
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {});
    }
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    // 1. Download the video.
    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(300_000) });
    if (!vidRes.ok) throw new Error("Could not download video from the provided URL.");
    const vidBuf = Buffer.from(await vidRes.arrayBuffer());
    if (vidBuf.length > MAX_VIDEO_BYTES) throw new Error("Video is too large (200 MB max).");
    await writeFile(inputPath, vidBuf);
    const videoDur = await probeDurationSec(inputPath);

    // 2. Extract audio for transcription + voice cloning.
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inputPath, "-vn", "-ar", "44100", "-ac", "1", "-q:a", "2", audioPath],
      { timeout: FFMPEG_TIMEOUT_MS },
    );

    // 3. Transcribe with word-level segment timing.
    const segments = await transcribeWithSegments(audioPath, sourceLanguage);
    if (segments.length === 0) {
      await fail(400, "No speech detected in this video — nothing to dub.");
      await cleanup();
      return;
    }
    // Cap at 120 segments to bound TTS calls.
    const work = segments.slice(0, 120);

    // 4. Translate each segment.
    const translated = await translateSegments(work.map((s) => s.text), lang.label);

    // 5. Clone the speaker's voice from the first ~60s of audio (best effort).
    if (apiKey) {
      try {
        await execFileAsync(
          "ffmpeg",
          ["-y", "-i", audioPath, "-t", "60", "-q:a", "2", cloneSamplePath],
          { timeout: 60_000 },
        );
        clonedVoiceId = await cloneSpeakerVoice(cloneSamplePath, apiKey);
      } catch {
        clonedVoiceId = null;
      }
    }

    // 6. Synthesize + time-fit each segment.
    const pieces: string[] = [];
    for (let i = 0; i < work.length; i++) {
      const seg = work[i]!;
      const targetDur = Math.max(seg.end - seg.start, 0.3);
      const ttsBuf = await synthesizeSpeech(translated[i]!, clonedVoiceId, apiKey);
      const ttsPath = join(workDir, `tts-${i}.mp3`);
      const fitPath = join(workDir, `fit-${i}.mp3`);
      await writeFile(ttsPath, ttsBuf);
      await fitClipToDuration(ttsPath, fitPath, targetDur);
      pieces.push(fitPath);

      // Silence gap until the next segment starts.
      const nextStart = i + 1 < work.length ? work[i + 1]!.start : videoDur;
      const gap = nextStart - seg.end;
      if (gap > 0.05) {
        const gapPath = join(workDir, `gap-${i}.mp3`);
        await makeSilence(gapPath, Math.min(gap, 600));
        pieces.push(gapPath);
      }
    }

    // 7. Leading silence before the first segment.
    if (work[0]!.start > 0.05) {
      const leadPath = join(workDir, "lead.mp3");
      await makeSilence(leadPath, Math.min(work[0]!.start, 600));
      pieces.unshift(leadPath);
    }

    // 8. Concat dubbed pieces into one track, padded to the video duration.
    const listPath = join(workDir, "concat.txt");
    await writeFile(listPath, pieces.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const dubTrackPath = join(workDir, "dub-track.mp3");
    await execFileAsync(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-q:a", "2", dubTrackPath],
      { timeout: FFMPEG_TIMEOUT_MS },
    );

    // 9. Mux: replace original audio (or mix low underneath).
    const outPath = join(workDir, "dubbed.mp4");
    if (keepOriginalMix > 0) {
      const mixedPath = join(workDir, "mixed.m4a");
      await execFileAsync(
        "ffmpeg",
        [
          "-y", "-i", dubTrackPath, "-i", inputPath,
          "-filter_complex",
          `[1:a]volume=${keepOriginalMix.toFixed(2)}[orig];[0:a]apad=whole_dur=${videoDur.toFixed(2)}[dub];[dub][orig]amix=inputs=2:duration=first:dropout_transition=0`,
          "-c:a", "aac", "-b:a", "192k",
          mixedPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS },
      );
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", inputPath, "-i", mixedPath, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-shortest", "-movflags", "+faststart", outPath],
        { timeout: FFMPEG_TIMEOUT_MS },
      );
    } else {
      await execFileAsync(
        "ffmpeg",
        [
          "-y", "-i", inputPath, "-i", dubTrackPath,
          "-map", "0:v", "-map", "1:a",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
          "-shortest", "-movflags", "+faststart",
          outPath,
        ],
        { timeout: FFMPEG_TIMEOUT_MS },
      );
    }

    const outBuf = await readFile(outPath);
    const objectName = `video-dub/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, outBuf, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    await cleanup();
    res.json({
      url,
      storageRef,
      targetLanguage: lang.code,
      targetLabel: lang.label,
      segmentsDubbed: work.length,
      voiceSource: clonedVoiceId ? "cloned-speaker" : "standard",
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    await cleanup();
    const message = err instanceof Error ? err.message : "Video dubbing failed.";
    const status = /transcri|translat|synthesis/i.test(message) ? 502 : 500;
    await fail(status, message);
  }
});

export default router;
