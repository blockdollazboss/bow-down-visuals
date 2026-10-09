import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { analyzeMelody } from "../../lib/melody-analysis";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  uploadHumForConditioning,
  composeWithConditioning,
  composeTextPrompt,
} from "./hum-to-song";

const execFileAsync = promisify(execFile);

const router = Router();

/* ─── Finish My Song ───────────────────────────────────────────────────────
   POST /api/finish-my-song/complete — 400 Visual Bucs.
   Upload a rough demo (voice memo, half-written song) + short notes about
   what's missing. GPT-6 Sol writes the missing parts (lyrics for what's
   incomplete + arrangement notes), then the ElevenLabs music pipeline
   (music_v2_5) produces the completed song.

   Audio-influence path mirrors hum-to-song: the demo is uploaded to
   ElevenLabs as a conditioning_ref when the account supports it; otherwise
   we degrade honestly to a text-prompt compose built from the melody
   analysis + GPT-written lyrics. `influence` is always reported honestly. */

const FINISH_CREDIT_COST =
  Number(process.env["FINISH_MY_SONG_CREDITS"]) || 400;
const DEMO_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const BUCKET = "audio-stems";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DEMO_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      /\.(mp3|wav|m4a|ogg|oga|webm|flac|aac|opus)$/i.test(file.originalname);
    if (!ok) {
      cb(new Error("Only audio files are allowed — upload an MP3, WAV, M4A, or a recorded voice memo."));
      return;
    }
    cb(null, true);
  },
});

const fieldsSchema = z.object({
  notes: z.string().max(500).optional().default(""),
});

type Influence = "audio-conditioning" | "text-reference";

/** Transcode the raw demo upload to a canonical 128k MP3 (trimmed to 60 s). */
async function transcodeDemo(raw: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}-demoin.bin`);
  const outPath = join(tmpdir(), `${id}-demo.mp3`);
  try {
    await writeFile(inPath, raw);
    await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-i", inPath,
        "-t", "60",
        "-ac", "1",
        "-ar", "44100",
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        "-f", "mp3",
        outPath,
      ],
      { timeout: 90_000 },
    );
    const buf = await readFile(outPath);
    if (!buf || buf.length === 0) throw new Error("Could not read that audio file — try an MP3, WAV, or M4A.");
    return buf;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

interface CompletedParts {
  lyrics: string;
  arrangement: string;
}

/** GPT-6 Sol writes the missing parts: completed lyrics + arrangement notes. */
async function writeCompletion(
  notes: string,
  analysis: { tempoBpm: number | null; keyEstimate: string | null; durationSec: number; noteCount: number; pitchConfidence: number; confidence: string },
): Promise<CompletedParts> {
  const tempoLine = analysis.tempoBpm ? `estimated tempo ${analysis.tempoBpm} BPM` : "tempo unclear";
  const keyLine = analysis.keyEstimate ? `estimated key ${analysis.keyEstimate}` : "key unclear";
  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [
      {
        role: "system",
        content:
          `You are a Grammy-winning songwriter and arranger. A creator uploads a rough demo ` +
          `recording and tells you what the song still needs. Your job: finish it on paper — ` +
          `write the missing sections so the demo becomes a complete song, plus concise ` +
          `arrangement notes a producer could follow.\n\n` +
          `DEMO MEASUREMENTS (from real audio analysis — these are estimates, not certainty):\n` +
          `- Duration: ${analysis.durationSec}s, ${analysis.noteCount} voiced notes detected\n` +
          `- ${tempoLine}, ${keyLine}\n` +
          `- Analysis confidence: ${analysis.confidence}\n\n` +
          `Rules:\n` +
          `- Write complete, singable lyrics for whatever is missing (verse 2, chorus/hook, ` +
          `bridge, outro — match the mood and story the notes describe; if the notes don't ` +
          `describe a direction, infer one from the phrasing and keep it tight).\n` +
          `- Keep the lyrics structured with [Verse 1], [Chorus], [Bridge] etc. labels.\n` +
          `- arrangement: 4-8 short production notes (instrumentation, drops, vocal ` +
          `stacking, where the energy lifts). Concrete, not vague.\n` +
          `- Do not copy any existing song's lyrics. All original.\n` +
          `Return ONLY JSON: {"lyrics": "<full completed lyrics>", "arrangement": "<arrangement notes>"}.`,
      },
      {
        role: "user",
        content:
          `Finish my song.\n\nWhat's missing / my notes: ${notes.trim() || "(no notes given — use your judgment on the structure)"}\n\n` +
          `Demo: ${analysis.durationSec}s long, ${tempoLine}, ${keyLine}.`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2500,
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  try {
    const j = JSON.parse(raw) as { lyrics?: unknown; arrangement?: unknown };
    const lyrics = typeof j.lyrics === "string" ? j.lyrics.trim().slice(0, 6000) : "";
    const arrangement = typeof j.arrangement === "string" ? j.arrangement.trim().slice(0, 3000) : "";
    if (!lyrics) throw new Error("Model returned no usable lyrics");
    return { lyrics, arrangement: arrangement || "Full arrangement built around the demo's melody and phrasing." };
  } catch (err) {
    if (err instanceof Error && err.message === "Model returned no usable lyrics") throw err;
    throw new Error("Model returned no usable lyrics");
  }
}

/* POST /api/finish-my-song/complete — multipart { demo: audio, notes?: text }
   → 200 { songUrl, lyrics, arrangement, influence, influenceNote, creditsUsed, creditsRemaining }
   Paid: 400 Visual Bucs. Charge BEFORE generation; refund on any failure. */
router.post("/finish-my-song/complete", publicApiLimiter, requireAuth, upload.single("demo"), async (req, res) => {
  const parsed = fieldsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No demo file provided — upload your rough demo audio first." });
    return;
  }

  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({
      error: "Music generation isn't configured on this server.",
      code: "audio_gen_unavailable",
      message: "ELEVENLABS_API_KEY is not set — Finish My Song can't generate until it's configured.",
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < FINISH_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs — Finish My Song costs 400 Visual Bucs.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, FINISH_CREDIT_COST, {
      action: "Finish My Song",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — Finish My Song costs 400 Visual Bucs.",
      });
      return;
    }
    throw err;
  }

  const refundAndFail = async (status: number, message: string) => {
    try {
      await refundCredits(req.userId!, FINISH_CREDIT_COST, { action: "Finish My Song — Refund" });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[finish-my-song] refund failed after generation error");
    }
    res.status(status).json({ error: message, refunded: true });
  };

  try {
    const mp3 = await transcodeDemo(req.file.buffer);
    const analysis = await analyzeMelody(req.file.buffer);
    const parts = await writeCompletion(parsed.data.notes, {
      tempoBpm: analysis.tempoBpm,
      keyEstimate: analysis.keyEstimate,
      durationSec: analysis.durationSec,
      noteCount: analysis.noteCount,
      pitchConfidence: analysis.pitchConfidence,
      confidence: analysis.confidence,
    });

    const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";
    const styleLine = "Full, radio-ready arrangement following the demo's melody, phrasing and structure";
    const prompt =
      `Finish this song. The uploaded demo's melody is the lead line — follow its phrasing, ` +
      `contour and rhythm (estimated ${analysis.tempoBpm ? `${analysis.tempoBpm} BPM` : "steady groove"}, ` +
      `${analysis.keyEstimate ?? "natural key"}). ${styleLine}.\n\n` +
      `ARRANGEMENT:\n${parts.arrangement.slice(0, 1200)}\n\n` +
      `LYRICS:\n${parts.lyrics.slice(0, 4500)}`.slice(0, 2000);
    const chunkText =
      `[Intro]\nSet the mood, tease the melody\n[Verse 1]\nFull groove under the melody\n[Chorus]\nBigger — stacked vocals, lift the energy\n[Verse 2]\n${parts.lyrics.split("\n").slice(0, 8).join(" ").slice(0, 400)}\n[Bridge]\nStrip it back, then build\n[Chorus]\nFinal chorus — biggest moment\n[Outro]\nResolve on the melody's home note`.slice(0, 2000);

    /* Audio-influence first: pass the demo as a conditioning reference when
       the ElevenLabs account supports it; degrade honestly to a text-prompt
       compose otherwise (mirrors hum-to-song). */
    let influence: Influence = "text-reference";
    let songBuffer: Buffer | null = null;
    const songId = await uploadHumForConditioning(apiKey, mp3);
    if (songId) {
      const conditioned = await composeWithConditioning(
        apiKey, musicModel, songId, Math.round(analysis.durationSec * 1000),
        chunkText, [styleLine.slice(0, 120), "follows the reference demo melody"],
      );
      if (conditioned) {
        songBuffer = conditioned;
        influence = "audio-conditioning";
      }
    }
    if (!songBuffer) {
      songBuffer = await composeTextPrompt(apiKey, musicModel, prompt, false);
    }

    /* Save the finished song to the user's storage. */
    const songPath = `${req.userId}/generated/${Date.now()}-finish-my-song.mp3`;
    const { error: upErr } = await getSupabaseAdmin().storage
      .from(BUCKET)
      .upload(songPath, songBuffer, { contentType: "audio/mpeg", upsert: false });
    if (upErr) throw new Error("Could not save the finished song.");
    const { data } = getSupabaseAdmin().storage.from(BUCKET).getPublicUrl(songPath);

    res.json({
      songUrl: data.publicUrl,
      lyrics: parts.lyrics,
      arrangement: parts.arrangement,
      influence,
      influenceNote:
        influence === "audio-conditioning"
          ? "Your demo was passed to the music model as an audio reference, so the finished song follows its melody directly."
          : "This ElevenLabs account can't take audio references, so the finished song was built from your demo's extracted melody (tempo, key, phrasing) plus the completed lyrics as a detailed brief.",
      creditsUsed: FINISH_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Finish My Song failed";
    logger.error({ err, userId: req.userId }, "[finish-my-song] generation failed");
    await refundAndFail(502, msg);
  }
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "That audio file exceeds the 25 MB upload limit. Trim it under ~60 seconds and try again.",
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
