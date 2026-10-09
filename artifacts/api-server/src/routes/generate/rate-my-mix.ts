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

const execFileAsync = promisify(execFile);

const router = Router();

/* ─── Rate My Mix ──────────────────────────────────────────────────────────
   POST /api/rate-my-mix/analyze — 100 Visual Bucs.

   HONEST SCOPE: a text model cannot listen to audio. So we do REAL
   measurement with ffmpeg (integrated loudness via EBU R128, true peak,
   near-clipping sample count, stereo correlation, RMS, duration), then feed
   those MEASUREMENTS to GPT-6 Sol, which writes specific fix-it coaching
   notes tied to the numbers. Coaching only — the uploaded audio is never
   modified. If ffmpeg measurement fails, we refund + 502 (never fake
   numbers). */

const MIX_CREDIT_COST =
  Number(process.env["RATE_MY_MIX_CREDITS"]) || 100;
const MIX_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const MEASURE_RATE = 44100;
const CLIP_THRESHOLD = 0.99; // samples within ~0.09 dB of digital full scale

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MIX_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      /\.(mp3|wav|m4a|ogg|oga|webm|flac|aac|opus)$/i.test(file.originalname);
    if (!ok) {
      cb(new Error("Only audio files are allowed — upload an MP3, WAV, M4A, or a bounce of your mix."));
      return;
    }
    cb(null, true);
  },
});

const fieldsSchema = z.object({
  genre: z.string().max(60).optional().default(""),
});

interface MixMeasurements {
  integratedLufs?: number;
  truePeakDb?: number;
  clipCount?: number;
  stereoCorrelation?: number;
  durationSec?: number;
  peakDbfs?: number;
  rmsDbfs?: number;
}

/** Parse the EBU R128 summary ffmpeg prints to stderr. */
function parseEbur128(stderr: string): { integratedLufs?: number; truePeakDb?: number } {
  const out: { integratedLufs?: number; truePeakDb?: number } = {};
  const iMatch = stderr.match(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/);
  const peakMatch = stderr.match(/Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/);
  if (iMatch) out.integratedLufs = Number(iMatch[1]);
  if (peakMatch) out.truePeakDb = Number(peakMatch[1]);
  return out;
}

const pearson = (a: Float64Array, b: Float64Array): number | null => {
  const n = a.length;
  if (n < 2) return null;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  if (va <= 0 || vb <= 0) return null;
  return cov / Math.sqrt(va * vb);
};

/** Measure the mix with ffmpeg. Throws on any measurement failure —
    callers refund and 502 rather than invent numbers. */
async function measureMix(raw: Buffer): Promise<MixMeasurements> {
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}-mixin.bin`);
  const pcmPath = join(tmpdir(), `${id}-mix.raw`);
  const m: MixMeasurements = {};
  try {
    await writeFile(inPath, raw);

    /* Pass 1 — EBU R128 loudness + true peak from the filter summary. */
    let eburStderr = "";
    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-hide_banner",
          "-i", inPath,
          "-map", "0:a",
          "-af", "ebur128=peak=true:framelog=quiet",
          "-f", "null", "-",
        ],
        { timeout: 120_000 },
      );
    } catch (err) {
      /* ffmpeg exits non-zero here by design on some builds; the summary
         still lands on stderr. Only fail if we got no summary at all. */
      const e = err as { stderr?: string };
      eburStderr = typeof e?.stderr === "string" ? e.stderr : "";
    }
    const { integratedLufs, truePeakDb } = parseEbur128(eburStderr);
    if (integratedLufs === undefined || truePeakDb === undefined) {
      /* Retry once with the plain filter to surface the real error. */
      const retry = await execFileAsync(
        "ffmpeg",
        ["-v", "info", "-i", inPath, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"],
        { timeout: 120_000 },
      ).catch((e) => e as { stderr?: string });
      const stderr = typeof retry === "object" && "stderr" in (retry as object)
        ? String((retry as { stderr?: string }).stderr ?? "")
        : "";
      const again = parseEbur128(stderr);
      if (again.integratedLufs === undefined || again.truePeakDb === undefined) {
        throw new Error("Loudness measurement failed — the file may be corrupt or DRM-protected.");
      }
      m.integratedLufs = again.integratedLufs;
      m.truePeakDb = again.truePeakDb;
    } else {
      m.integratedLufs = integratedLufs;
      m.truePeakDb = truePeakDb;
    }

    /* Pass 2 — decode to stereo f32le PCM for sample-level stats. */
    await execFileAsync(
      "ffmpeg",
      [
        "-v", "error",
        "-i", inPath,
        "-t", "600",
        "-ac", "2",
        "-ar", String(MEASURE_RATE),
        "-f", "f32le",
        "-acodec", "pcm_f32le",
        pcmPath,
      ],
      { timeout: 120_000 },
    );
    const bytes = await readFile(pcmPath);
    const frames = Math.floor(bytes.length / 8); // 2ch × 4 bytes
    if (frames < MEASURE_RATE) {
      throw new Error("Could not decode enough audio to measure — the file may be too short or corrupt.");
    }
    const left = new Float64Array(frames);
    const right = new Float64Array(frames);
    let peak = 0;
    let clips = 0;
    let sumSq = 0;
    for (let i = 0; i < frames; i++) {
      const l = bytes.readFloatLE(i * 8);
      const r = bytes.readFloatLE(i * 8 + 4);
      left[i] = l; right[i] = r;
      const la = Math.abs(l), ra = Math.abs(r);
      if (la > peak) peak = la;
      if (ra > peak) peak = ra;
      if (la >= CLIP_THRESHOLD || ra >= CLIP_THRESHOLD) clips++;
      sumSq += l * l + r * r;
    }
    const rms = Math.sqrt(sumSq / (frames * 2));
    m.peakDbfs = 20 * Math.log10(Math.max(peak, 1e-9));
    m.rmsDbfs = 20 * Math.log10(Math.max(rms, 1e-9));
    m.clipCount = clips;
    m.durationSec = Math.round((frames / MEASURE_RATE) * 10) / 10;
    const corr = pearson(left, right);
    if (corr !== null) m.stereoCorrelation = Math.round(corr * 100) / 100;
    return m;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(pcmPath).catch(() => {});
  }
}

function describeMeasurements(m: MixMeasurements, genre: string): string {
  const lines = [
    `- Integrated loudness: ${m.integratedLufs?.toFixed(1) ?? "n/a"} LUFS`,
    `- True peak: ${m.truePeakDb?.toFixed(1) ?? "n/a"} dBTP`,
    `- Sample peak: ${m.peakDbfs?.toFixed(1) ?? "n/a"} dBFS`,
    `- RMS level: ${m.rmsDbfs?.toFixed(1) ?? "n/a"} dBFS`,
    `- Near-clipping samples (within 0.1 dB of 0 dBFS): ${m.clipCount ?? "n/a"}`,
    `- Stereo correlation (L/R): ${m.stereoCorrelation ?? "n/a"}`,
    `- Duration: ${m.durationSec ?? "n/a"}s`,
  ];
  return `Mix measurements (real, measured with ffmpeg — treat them as fact):\n${lines.join("\n")}\nGenre: ${genre || "not specified"}`;
}

/** GPT-6 Sol turns the measurements into specific fix-it coaching notes. */
async function coachMix(genre: string, m: MixMeasurements): Promise<string[]> {
  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [
      {
        role: "system",
        content:
          `You are a veteran mix engineer coaching an independent creator. You were given REAL ` +
          `measurements of their mix (from ffmpeg — loudness, true peak, clipping, stereo ` +
          `correlation, RMS, duration). Write 4-8 specific fix-it coaching notes tied DIRECTLY ` +
          `to the numbers — e.g. "true peak +1.2 dBTP — pull the limiter ceiling to -1.0 dBTP", ` +
          `"stereo correlation 0.35 — your low end is wide; mono everything below ~120 Hz", ` +
          `"integrated -18.4 LUFS is quiet for streaming — raise the body 2-3 dB before the limiter". ` +
          `Reference the exact measured values in each note. Genre-aware where the genre is ` +
          `given (target loudness differs for a podcast vs. a trap banger). No generic advice, ` +
          `no flattery, no inventing measurements you weren't given. You are coaching only — ` +
          `you cannot hear or modify the audio, and you must not claim you did. ` +
          `Return ONLY JSON: {"notes": ["<note 1>", "<note 2>", ...]}.`,
      },
      {
        role: "user",
        content: describeMeasurements(m, genre),
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 1200,
    temperature: 0.5,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const notes: string[] = [];
  try {
    const j = JSON.parse(raw) as { notes?: unknown };
    if (Array.isArray(j.notes)) {
      for (const n of j.notes) {
        if (typeof n === "string" && n.trim()) notes.push(n.trim().slice(0, 400));
        if (notes.length >= 8) break;
      }
    }
  } catch { /* fall through to the empty check below */ }
  if (notes.length === 0) throw new Error("The mix coach returned no usable notes.");
  return notes;
}

/* POST /api/rate-my-mix/analyze — multipart { mix: audio, genre?: text }
   → 200 { measurements, notes, creditsUsed, creditsRemaining }
   Paid: 100 Visual Bucs. Measurement failure → refund + 502. */
router.post("/rate-my-mix/analyze", publicApiLimiter, requireAuth, upload.single("mix"), async (req, res) => {
  const parsed = fieldsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No mix file provided — upload a bounce of your mix first." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < MIX_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs — Rate My Mix costs 100 Visual Bucs.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, MIX_CREDIT_COST, {
      action: "Rate My Mix",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — Rate My Mix costs 100 Visual Bucs.",
      });
      return;
    }
    throw err;
  }

  const refundAndFail = async (status: number, message: string) => {
    try {
      await refundCredits(req.userId!, MIX_CREDIT_COST, { action: "Rate My Mix — Refund" });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[rate-my-mix] refund failed after analysis error");
    }
    res.status(status).json({ error: message, refunded: true });
  };

  try {
    /* Real measurement first — if this fails we refund and never fake numbers. */
    const measurements = await measureMix(req.file.buffer);
    const notes = await coachMix(parsed.data.genre, measurements);
    res.json({ measurements, notes, creditsUsed: MIX_CREDIT_COST, creditsRemaining });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Mix analysis failed";
    logger.error({ err, userId: req.userId }, "[rate-my-mix] analysis failed");
    await refundAndFail(502, msg);
  }
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "That audio file exceeds the 25 MB upload limit. Bounce a shorter section and try again.",
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
