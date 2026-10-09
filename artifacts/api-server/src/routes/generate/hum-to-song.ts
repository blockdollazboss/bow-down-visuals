import { randomUUID } from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requireAuth } from "../../middlewares/require-auth";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { r2Upload, r2PublicUrl, r2Download } from "../../lib/r2-client";
import { analyzeMelody, type MelodyAnalysis } from "../../lib/melody-analysis";
import { db, humRecordingsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const execFileAsync = promisify(execFile);

const router = Router();

/* ─── Hum-to-Song (Suno parity) ──────────────────────────────────────────
   Upload a hummed/sung melody (up to ~60 s) and get a full arrangement
   built around it.

   Two-step flow (keeps the expensive step separate from the free one):
   1. analyzeOnly=true  → decode + melody analysis, store the hum, return
      { humRef, humUrl, analysis }. FREE.
   2. generate           → 500 Visual Bucs, arrangement via ElevenLabs Music.

   Audio-influence path: the hum is uploaded to ElevenLabs
   (POST /v1/music/upload) and attached as a `conditioning_ref` on the
   composition plan — Music v2/v2.5 supports reference-audio conditioning
   (up to 30 s, strength low/medium/high/xhigh). Per ElevenLabs docs the
   upload endpoint is gated to enterprise/inpainting-enabled accounts, so
   when it fails (or compose-with-plan 422s) we degrade to a text-prompt
   compose whose prompt embeds the extracted melody description
   (estimated tempo/key, duration, phrasing). The response always reports
   `influence: "audio-conditioning" | "text-reference"` so the client can
   be honest about which path ran. */

const HUM_CREDIT_COST = 500;
const HUM_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const BUCKET = "audio-stems";
const RESULT_LENGTH_MS = 60_000;
const ELEVENLABS_API = "https://api.elevenlabs.io";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HUM_MAX_BYTES, files: 1 },
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

const truthy = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1" || v === "on");

const fieldsSchema = z.object({
  analyzeOnly: truthy.optional(),
  humRef: z.string().uuid().optional(),
  mode: z.enum(["simple", "custom"]).optional().default("simple"),
  stylePrompt: z.string().max(2000).optional(),
  vocalGender: z.enum(["male", "female"]).optional(),
  instrumental: truthy.optional(),
  lyrics: z.string().max(5000).optional(),
  songTitle: z.string().max(300).optional(),
  artistName: z.string().max(200).optional(),
});

type Influence = "audio-conditioning" | "text-reference";

/** Transcode the raw upload to a canonical 128k MP3 hum reference. */
async function transcodeToMp3(raw: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}-humin.bin`);
  const outPath = join(tmpdir(), `${id}-hum.mp3`);
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

/** Upload the hum to ElevenLabs for conditioning. Returns song_id or null
 *  (null = enterprise-gated or failed → caller degrades to text reference). */
export async function uploadHumForConditioning(apiKey: string, mp3: Buffer): Promise<string | null> {
  try {
    const form = new FormData();
    // Uint8Array.from copies into a fresh ArrayBuffer — satisfies BlobPart typing.
    form.append("file", new Blob([Uint8Array.from(mp3)], { type: "audio/mpeg" }), "hum.mp3");
    form.append("extract_composition_plan", "music_v2_5");
    const res = await fetch(`${ELEVENLABS_API}/v1/music/upload`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { song_id?: unknown } | null;
    return typeof data?.song_id === "string" && data.song_id ? data.song_id : null;
  } catch {
    return null;
  }
}

/** Compose via a composition plan with the hum as a conditioning reference. */
export async function composeWithConditioning(
  apiKey: string,
  musicModel: string,
  songId: string,
  humMs: number,
  chunkText: string,
  positiveStyles: string[],
): Promise<Buffer | null> {
  try {
    const plan = {
      chunks: [
        {
          text: chunkText,
          duration_ms: RESULT_LENGTH_MS,
          positive_styles: positiveStyles,
          negative_styles: ["off-key singing", "out of tune", "muddy mix"],
          context_adherence: "high",
          conditioning_ref: {
            song_id: songId,
            range: { start_ms: 0, end_ms: Math.min(Math.max(humMs, 3000), 30000) },
          },
          condition_strength: "high",
        },
      ],
    };
    const res = await fetch(`${ELEVENLABS_API}/v1/music`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        composition_plan: plan,
        model_id: musicModel,
        /* force_instrumental is prompt-mode only; in plan mode the chunk
           text carries the instrumental direction instead. */
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** Plain text-prompt compose — the documented fallback when audio
 *  conditioning is unavailable on this ElevenLabs account. */
export async function composeTextPrompt(
  apiKey: string,
  musicModel: string,
  prompt: string,
  forceInstrumental: boolean,
): Promise<Buffer> {
  const res = await fetch(`${ELEVENLABS_API}/v1/music`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      music_length_ms: RESULT_LENGTH_MS,
      model_id: musicModel,
      force_instrumental: forceInstrumental,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Music generation returned no audio.");
  return buf;
}

/** Build the arrangement brief from the melody analysis + user options. */
function buildArrangementBrief(
  analysis: MelodyAnalysis,
  opts: { mode: "simple" | "custom"; stylePrompt?: string; vocalGender?: "male" | "female"; instrumental?: boolean; lyrics?: string },
): { chunkText: string; prompt: string; positiveStyles: string[] } {
  const { mode, stylePrompt, vocalGender, instrumental, lyrics } = opts;
  const tempoLine = analysis.tempoBpm
    ? `estimated tempo ${analysis.tempoBpm} BPM`
    : "tempo estimated from the hum's phrasing";
  const keyLine = analysis.keyEstimate
    ? `estimated key ${analysis.keyEstimate}`
    : "key estimated from the hum";
  const melodyLine =
    `The attached hummed vocal melody is the lead line — follow its phrasing, ` +
    `contour and rhythm (${tempoLine}, ${keyLine}, ${analysis.durationSec}s of melody, ` +
    `${analysis.noteCount} notes). Build a full, radio-ready arrangement around it; ` +
    `the hum's melody must be recognizable in the final song.`;

  const styleLine =
    mode === "custom" && stylePrompt?.trim()
      ? stylePrompt.trim().slice(0, 1200)
      : "Catchy, radio-ready full arrangement with modern production";
  const vocalLine = instrumental
    ? "Instrumental — no vocals; the melody carried by a lead instrument."
    : vocalGender
      ? `${vocalGender} lead vocals singing the hummed melody.`
      : "Lead vocals singing the hummed melody.";
  const lyricsLine =
    !instrumental && lyrics?.trim()
      ? `\n\nLyrics:\n${lyrics.trim().slice(0, 5000)}`
      : "";

  const prompt = `${melodyLine}\n\nStyle: ${styleLine}\n${vocalLine}${lyricsLine}`.slice(0, 2000);
  const chunkText =
    `[Intro]\nSet the mood, tease the melody\n[Hook]\n${styleLine} — lead carries the hummed melody\n[Verse]\nFull groove under the melody\n[Outro]\nResolve on the melody's home note`.slice(0, 2000);
  const positiveStyles = [
    styleLine.slice(0, 120),
    "follows the reference vocal melody",
    analysis.tempoBpm ? `${analysis.tempoBpm} bpm` : "steady groove",
    vocalLine.split(".")[0] ?? "",
  ].filter(Boolean);

  return { chunkText, prompt, positiveStyles };
}

interface HumRow {
  id: string;
  audioRef: string;
  audioUrl: string | null;
  analysis: unknown;
}

/** Store a hum: transcode → analyze → Supabase storage → DB row. */
async function storeHum(req: Request, raw: Buffer): Promise<{ row: HumRow; mp3: Buffer; analysis: MelodyAnalysis }> {
  const mp3 = await transcodeToMp3(raw);
  const analysis = await analyzeMelody(raw);

  const path = `hum/${req.userId}/${Date.now()}-${randomUUID()}.mp3`;
  const r2Key = `audio-stems/${path}`;
  try {
    await r2Upload(r2Key, mp3, "audio/mpeg");
  } catch (upErr) {
    throw new Error("Could not save the hum recording.");
  }
  const humUrl = r2PublicUrl(r2Key);

  const inserted = await db
    .insert(humRecordingsTable)
    .values({
      userId: req.userId!,
      audioRef: path,
      audioUrl: humUrl,
      analysis: analysis as unknown as Record<string, unknown>,
    })
    .returning({ id: humRecordingsTable.id, audioRef: humRecordingsTable.audioRef, audioUrl: humRecordingsTable.audioUrl, analysis: humRecordingsTable.analysis });
  const row = inserted[0];
  if (!row) throw new Error("Could not save the hum recording.");
  return { row: row as HumRow, mp3, analysis };
}

/* ─── POST /api/hum-to-song ─────────────────────────────────────────── */
router.post("/hum-to-song", requireAuth, upload.single("hum"), async (req, res) => {
  const parsed = fieldsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const fields = parsed.data;
  const analyzeOnly = fields.analyzeOnly === true;

  /* ── Step 1: free melody analysis + hum storage ── */
  if (analyzeOnly) {
    if (!req.file) {
      res.status(400).json({ error: "No audio file provided — upload or record a hum first." });
      return;
    }
    try {
      const { row, analysis } = await storeHum(req, req.file.buffer);
      res.json({
        humRef: row.id,
        humUrl: row.audioUrl,
        analysis,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not analyze that audio.";
      req.log.error({ err }, "[hum-to-song] analysis failed");
      res.status(400).json({ error: msg });
    }
    return;
  }

  /* ── Step 2: paid generation ── */
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({
      error: "Music generation isn't configured on this server.",
      code: "audio_gen_unavailable",
      missingEnv: "ELEVENLABS_API_KEY",
      message: "ELEVENLABS_API_KEY is not set — Hum-to-Song can't generate arrangements until it's configured.",
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < HUM_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs — Hum-to-Song costs 500 Visual Bucs.",
    });
    return;
  }

  try {
    // Resolve the hum: either a previously analyzed humRef, or a fresh upload.
    let humRow: HumRow;
    let mp3: Buffer;
    let analysis: MelodyAnalysis;
    if (fields.humRef) {
      const rows = await db
        .select({
          id: humRecordingsTable.id,
          audioRef: humRecordingsTable.audioRef,
          audioUrl: humRecordingsTable.audioUrl,
          analysis: humRecordingsTable.analysis,
        })
        .from(humRecordingsTable)
        .where(and(eq(humRecordingsTable.id, fields.humRef), eq(humRecordingsTable.userId, req.userId!)))
        .limit(1);
      const found = rows[0];
      if (!found) {
        res.status(404).json({ error: "Hum recording not found — analyze it again." });
        return;
      }
      const r2Key = found.audioRef.startsWith("audio-stems/")
        ? found.audioRef
        : `audio-stems/${found.audioRef}`;
      try {
        mp3 = await r2Download(r2Key);
      } catch {
        // Fall back to legacy Supabase storage
        const sb = req.userSupabase!;
        const { data, error } = await sb.storage.from(BUCKET).download(found.audioRef);
        if (error || !data) throw new Error("Could not load the saved hum recording.");
        mp3 = Buffer.from(await data.arrayBuffer());
      }
      analysis = found.analysis as unknown as MelodyAnalysis;
      humRow = found as HumRow;
    } else {
      if (!req.file) {
        res.status(400).json({ error: "No audio file provided — upload or record a hum first." });
        return;
      }
      const stored = await storeHum(req, req.file.buffer);
      humRow = stored.row;
      mp3 = stored.mp3;
      analysis = stored.analysis;
    }

    // ── Charge before the provider call; refund on any failure below ──
    let charged = false;
    let creditsAfter = currentCredits;
    try {
      creditsAfter = await chargeCredits(req.userId!, HUM_CREDIT_COST, { action: "Hum to Song" });
      charged = true;
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs — Hum-to-Song costs 500 Visual Bucs." });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }

    try {
      const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";
      const forceInstrumental = fields.instrumental === true;
      const { chunkText, prompt, positiveStyles } = buildArrangementBrief(analysis, {
        mode: fields.mode,
        stylePrompt: fields.stylePrompt,
        vocalGender: fields.vocalGender,
        instrumental: forceInstrumental,
        lyrics: fields.lyrics,
      });

      // Audio-influence first: upload the hum, compose with conditioning_ref.
      // Degrades to a text-prompt compose when the account can't do it.
      let influence: Influence = "text-reference";
      let songBuffer: Buffer | null = null;
      const songId = await uploadHumForConditioning(apiKey, mp3);
      if (songId) {
        const conditioned = await composeWithConditioning(
          apiKey, musicModel, songId, Math.round(analysis.durationSec * 1000),
          chunkText, positiveStyles,
        );
        if (conditioned) {
          songBuffer = conditioned;
          influence = "audio-conditioning";
        }
      }
      if (!songBuffer) {
        songBuffer = await composeTextPrompt(apiKey, musicModel, prompt, forceInstrumental);
      }

      // Save the finished song.
      const songPath = `${req.userId}/generated/${Date.now()}-hum-to-song.mp3`;
      const songR2Key = `audio-stems/${songPath}`;
      try {
        await r2Upload(songR2Key, songBuffer, "audio/mpeg");
      } catch (upErr) {
        throw new Error("Could not save the generated song.");
      }
      const songUrl = r2PublicUrl(songR2Key);

      await db
        .update(humRecordingsTable)
        .set({ songUrl, songRef: songPath, influence })
        .where(eq(humRecordingsTable.id, humRow.id));

      const genHistoryId = await recordGenerationHistory({
        userId: req.userId!,
        generationType: "Hum to Song",
        prompt: prompt.slice(0, 500),
        content: songUrl,
        artistName: fields.artistName || undefined,
        songTitle: fields.songTitle || undefined,
        creditsUsed: HUM_CREDIT_COST,
      });
      markGenerationHistoryCharged(genHistoryId).catch(() => {});

      res.json({
        url: songUrl,
        storagePath: songPath,
        humRef: humRow.id,
        humUrl: humRow.audioUrl,
        analysis,
        influence,
        influenceNote:
          influence === "audio-conditioning"
            ? "Your hum was passed to the music model as an audio reference, so the arrangement follows its melody directly."
            : "This ElevenLabs account can't take audio references, so the arrangement was built from your hum's extracted melody (tempo, key, phrasing) as a detailed text brief. The hum is saved to your project and can be re-referenced.",
        creditsRemaining: creditsAfter,
        genHistoryId,
      });
    } catch (genErr) {
      // Auto-refund on failure — credits never burn on a failed generation.
      if (charged) {
        try {
          await refundCredits(req.userId!, HUM_CREDIT_COST, {
            action: "Hum to Song (refund: generation failed)",
          });
        } catch (refundErr) {
          req.log.error({ err: refundErr }, "[hum-to-song] refund failed");
        }
      }
      throw genErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    req.log.error({ err }, "[hum-to-song] generation failed");
    res.status(500).json({ error: message });
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
