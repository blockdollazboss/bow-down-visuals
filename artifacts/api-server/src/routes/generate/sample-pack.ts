import { Router } from "express";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { promisify } from "util";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits as chargeCreditsAtomic, refundCredits, LedgerWriteError } from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  generatePackSchema,
  creditCostForPackSize,
  planPackComposition,
  buildSynthArgs,
  buildLoopPrompt,
  fourBarsMs,
  sampleFileName,
  SAMPLE_TYPES,
  SAMPLE_GENRES,
  MUSICAL_KEYS,
  SAMPLE_PACK_SIZES,
  isSamplePackSize,
  type SampleTypeKey,
} from "./sample-pack-pricing";

const router = Router();
const execFileAsync = promisify(execFile);

/** Supabase Storage bucket for generated samples. */
export const SAMPLE_BUCKET = "generated-clips";

const MUSIC_MODEL = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";

export interface GeneratedSample {
  id: string;
  name: string;
  type: SampleTypeKey;
  typeLabel: string;
  origin: "synthesized" | "ai-generated";
  url: string;
  path: string | null;
  durationSec: number;
  bpm: number;
  musicalKey: string;
  genre: string;
}

/* ─────────────────────────────────────────────────────────────────────────────
   GET /api/sample-pack/catalog — free. Genres, keys, sizes, pricing, types.
───────────────────────────────────────────────────────────────────────────── */
router.get("/api/sample-pack/catalog", (_req, res) => {
  res.json({
    genres: SAMPLE_GENRES,
    keys: MUSICAL_KEYS,
    packSizes: SAMPLE_PACK_SIZES.map((s) => ({
      size: s,
      credits: creditCostForPackSize(s),
    })),
    types: Object.values(SAMPLE_TYPES),
    license: "Royalty-free — use in your own productions, no attribution required. Resale of the raw samples as a pack is not permitted.",
  });
});

/* ─── Helpers ───────────────────────────────────────────────────────────── */

async function uploadSample(
  userId: string,
  packId: string,
  buffer: Buffer,
  fileName: string,
): Promise<{ url: string; path: string | null }> {
  const filePath = `${userId}/samples/${packId}/${fileName}`;
  const { error: upErr } = await getSupabaseAdmin().storage
    .from(SAMPLE_BUCKET)
    .upload(filePath, buffer, { contentType: "audio/wav", upsert: false });
  if (upErr) throw upErr;
  const { data: { publicUrl } } = getSupabaseAdmin().storage
    .from(SAMPLE_BUCKET)
    .getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

/** Synthesize one drum/FX one-shot with ffmpeg. Returns the WAV buffer. */
async function synthOneShot(
  type: Exclude<SampleTypeKey, "melody" | "bass">,
  variant: number,
  log: (obj: object, msg: string) => void,
): Promise<{ buffer: Buffer; durationSec: number }> {
  const tmpPath = join(tmpdir(), `sample-${randomUUID()}.wav`);
  const { args, durationSec } = buildSynthArgs(type, tmpPath, variant);
  try {
    await execFileAsync("ffmpeg", ["-y", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    const buffer = await fs.readFile(tmpPath);
    if (buffer.length === 0) throw new Error("ffmpeg produced an empty file");
    return { buffer, durationSec };
  } catch (err) {
    log({ err, type }, "[sample-pack] ffmpeg synthesis failed");
    throw err;
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/** Generate one AI melody/bass loop via ElevenLabs Music, trimmed to 4 bars. */
async function aiLoop(
  kind: "melody" | "bass",
  genre: string,
  bpm: number,
  musicalKey: string,
  log: (obj: object, msg: string) => void,
): Promise<{ buffer: Buffer; durationSec: number }> {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

  const prompt = buildLoopPrompt(kind, genre as never, bpm, musicalKey);
  const lengthMs = fourBarsMs(bpm);

  const elevenRes = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      music_length_ms: lengthMs,
      model_id: MUSIC_MODEL,
    }),
  });

  if (!elevenRes.ok) {
    const errText = await elevenRes.text().catch(() => "");
    log({ status: elevenRes.status, errText }, "[sample-pack] ElevenLabs music failed");
    throw new Error(`AI loop generation failed (${elevenRes.status})`);
  }

  const raw = Buffer.from(await elevenRes.arrayBuffer());
  if (raw.length === 0) throw new Error("AI loop generation returned no audio");

  // Normalize to 44.1kHz mono WAV and trim/pad to exactly 4 bars.
  const inPath = join(tmpdir(), `loop-in-${randomUUID()}.mp3`);
  const outPath = join(tmpdir(), `loop-out-${randomUUID()}.wav`);
  const targetSec = lengthMs / 1000;
  try {
    await fs.writeFile(inPath, raw);
    await execFileAsync("ffmpeg", [
      "-y", "-i", inPath,
      "-t", String(targetSec),
      "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le",
      "-af", "alimiter=limit=0.95",
      outPath,
    ], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    const buffer = await fs.readFile(outPath);
    if (buffer.length === 0) throw new Error("Loop trim produced an empty file");
    return { buffer, durationSec: targetSec };
  } finally {
    await fs.unlink(inPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/sample-pack/generate — charge up front, generate, refund on failure.
───────────────────────────────────────────────────────────────────────────── */
router.post("/api/sample-pack/generate", requireAuth, async (req, res) => {
  const parsed = generatePackSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pack options.", code: "bad_request", details: parsed.error.flatten() });
    return;
  }
  const { genre, bpm, musicalKey, packSize, types } = parsed.data;

  const creditCost = creditCostForPackSize(packSize);
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: `This pack costs ${creditCost} credits.`,
      creditCost,
    });
    return;
  }

  // Charge BEFORE generation — refund on any failure below.
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCreditsAtomic(
      req.userId!,
      creditCost,
      { action: `Sample Pack (${packSize})` },
      { rollbackOnLedgerFailure: false },
    );
  } catch (err) {
    if (err instanceof LedgerWriteError) {
      req.log.error({ err }, "[sample-pack] ledger write failed");
    }
    res.status(500).json({ error: "Could not charge credits. Please try again.", code: "charge_failed" });
    return;
  }

  const fail = async (code: string, message: string, status = 502) => {
    try {
      await refundCredits(req.userId!, creditCost, { action: `Sample Pack (${packSize}) — Refund (${code})` });
    } catch (refundErr) {
      req.log.error({ err: refundErr }, "[sample-pack] refund failed after generation failure");
    }
    res.status(status).json({ error: message, code, refunded: true, creditsAfter: currentCredits });
  };

  const packId = randomUUID();
  const composition = planPackComposition(packSize, types as SampleTypeKey[] | undefined);
  const samples: GeneratedSample[] = [];

  try {
    let variant = 0;
    for (const { type, count } of composition) {
      const info = SAMPLE_TYPES[type];
      for (let i = 0; i < count; i++) {
        let buffer: Buffer;
        let durationSec: number;
        if (info.origin === "synthesized") {
          ({ buffer, durationSec } = await synthOneShot(
            type as Exclude<SampleTypeKey, "melody" | "bass">,
            variant++,
            req.log.info.bind(req.log),
          ));
        } else {
          ({ buffer, durationSec } = await aiLoop(
            type as "melody" | "bass",
            genre, bpm, musicalKey,
            req.log.info.bind(req.log),
          ));
        }
        const fileName = sampleFileName(genre as never, type, samples.length);
        const { url, path } = await uploadSample(req.userId!, packId, buffer, fileName);
        samples.push({
          id: randomUUID(),
          name: fileName.replace(/\.wav$/, ""),
          type,
          typeLabel: info.label,
          origin: info.origin,
          url,
          path,
          durationSec: Math.round(durationSec * 100) / 100,
          bpm,
          musicalKey,
          genre,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sample generation failed";
    req.log.error({ err: msg }, "[sample-pack] generation failed — refunding");
    await fail("generation_failed", `Couldn't generate your pack: ${msg}. Credits refunded.`);
    return;
  }

  res.json({
    status: "succeeded",
    packId,
    genre,
    bpm,
    musicalKey,
    packSize,
    creditCost,
    creditsRemaining: creditsAfter,
    license: "Royalty-free — use in your own productions, no attribution required.",
    samples,
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/sample-pack/zip — free. Takes sample URLs, returns a ZIP.
   Stateless: the client already holds the URLs from the generate response.
───────────────────────────────────────────────────────────────────────────── */
router.post("/api/sample-pack/zip", requireAuth, async (req, res) => {
  const { urls, packName } = (req.body ?? {}) as { urls?: unknown; packName?: unknown };
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 50) {
    res.status(400).json({ error: "Provide 1–50 sample URLs.", code: "bad_request" });
    return;
  }
  if (!urls.every((u) => typeof u === "string" && u.startsWith("https://"))) {
    res.status(400).json({ error: "All URLs must be https strings.", code: "bad_request" });
    return;
  }
  // SSRF guard: only our own Supabase storage hosts.
  const supabaseHost = process.env["SUPABASE_URL"] ? new URL(process.env["SUPABASE_URL"]).host : "";
  for (const u of urls as string[]) {
    try {
      const host = new URL(u).host;
      if (supabaseHost && host !== supabaseHost) {
        res.status(400).json({ error: "Only sample-pack URLs can be zipped.", code: "bad_request" });
        return;
      }
    } catch {
      res.status(400).json({ error: "Invalid URL.", code: "bad_request" });
      return;
    }
  }

  const workDir = join(tmpdir(), `packzip-${randomUUID()}`);
  const zipPath = join(tmpdir(), `packzip-${randomUUID()}.zip`);
  try {
    await fs.mkdir(workDir, { recursive: true });
    // Download each sample.
    let idx = 0;
    for (const u of urls as string[]) {
      idx += 1;
      const dl = await fetch(u, { signal: AbortSignal.timeout(60_000) });
      if (!dl.ok) throw new Error(`Download failed for sample ${idx} (${dl.status})`);
      const buf = Buffer.from(await dl.arrayBuffer());
      if (buf.length === 0) throw new Error(`Sample ${idx} downloaded empty`);
      const name = decodeURIComponent(new URL(u).pathname.split("/").pop() || `sample-${idx}.wav`);
      const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || `sample-${idx}.wav`;
      await fs.writeFile(join(workDir, `${String(idx).padStart(2, "0")}-${safe}`), buf);
    }
    // Zip with python3 stdlib (no extra npm dep; python3 ships in the image).
    const zipScript = `
import sys, zipfile, os
work, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(work)):
        z.write(os.path.join(work, f), f)
`;
    await execFileAsync("python3", ["-c", zipScript, workDir, zipPath], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const zipBuf = await fs.readFile(zipPath);
    const safePack = typeof packName === "string" && packName.length > 0
      ? packName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40)
      : "sample-pack";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safePack}.zip"`);
    res.send(zipBuf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "ZIP failed";
    req.log.error({ err: msg }, "[sample-pack] zip failed");
    res.status(502).json({ error: `Couldn't build the ZIP: ${msg}`, code: "zip_failed" });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(zipPath).catch(() => {});
  }
});

export default router;
