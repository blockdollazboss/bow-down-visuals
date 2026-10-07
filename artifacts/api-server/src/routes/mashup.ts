/**
 * mashup.ts — Song Mashup (Suno parity). Pure-FFmpeg feature; no provider.
 *
 *  GET  /api/mashup/info         price + blend styles + defaults
 *  POST /api/mashup              blend two songs into one. 400 Visual Bucs.
 *  GET  /api/mashup/using/:songId  mashups by the caller built from a source song
 *
 * A "source" is either a song in the caller's library (songId) or a direct
 * audio URL (audioUrl) — e.g. a freshly signed storage URL.
 *
 * Pipeline: resolve sources -> download -> probe durations -> beat-detect
 * (ebur128 momentary-loudness envelope, same approach as generate/beat-sync)
 * -> tempo-align B to A's BPM via atempo -> blend per style:
 *   crossfade     A plays until blendPoint, then acrossfade into B.
 *   beat-match    B's first detected beat lands on A's beat nearest blendPoint; amix.
 *   interleave    alternating verse/chorus chunks of both inside the shared window.
 *
 * Credits (x100 scale): 402 pre-check -> charge 400 VB -> auto-refund on any
 * failure after the charge. The mashup is saved to the songs library with
 * source="mashup", parent_song_id=first library source, and mashup_sources
 * provenance for the "Mashups using this" links.
 */
import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { db, songsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../lib/credits";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRefBucketed,
} from "../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/** Visual Bucs for one mashup (x100 scale). */
export const MASHUP_CREDIT_COST = 400;

const BLEND_STYLES = {
  "crossfade": {
    label: "Crossfade",
    blurb: "Song A fades out while Song B fades in at the blend point.",
  },
  "beat-match": {
    label: "Beat-matched",
    blurb: "Tempo-aligned and beat-locked — both songs play together, drop synced.",
  },
  "interleave": {
    label: "Verse-Chorus interleave",
    blurb: "Alternating sections — A's verse, B's chorus, back and forth.",
  },
} as const;
type BlendStyle = keyof typeof BLEND_STYLES;

const audioSourceSchema = z
  .object({
    /** Song library id (must belong to the caller). */
    songId: z.string().uuid().optional(),
    /** Direct audio URL (signed storage URL, upload, etc.). */
    audioUrl: z.string().trim().min(1).max(2048).optional(),
    /** Title used when audioUrl has no library title. */
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((s) => s.songId || s.audioUrl, {
    message: "Provide songId or audioUrl.",
  });
type AudioSource = z.infer<typeof audioSourceSchema>;

const mashupSchema = z.object({
  songA: audioSourceSchema,
  songB: audioSourceSchema,
  style: z
    .string()
    .refine((v): v is BlendStyle => v in BLEND_STYLES, {
      message: `style must be one of: ${Object.keys(BLEND_STYLES).join(", ")}`,
    })
    .default("beat-match"),
  /** Where the blend happens (seconds into Song A). Defaults to A's midpoint. */
  blendPointSec: z.number().min(0).max(3600).optional(),
  /** Crossfade length in seconds (crossfade style). 2–15. */
  crossfadeSec: z.number().min(2).max(15).optional().default(6),
  /** 0–100: how much of Song A vs Song B in the mix. Default 50. */
  balance: z.number().min(0).max(100).optional().default(50),
  /** Mashup title. Defaults to "A × B". */
  title: z.string().trim().min(1).max(200).optional(),
});

/* ─── audio analysis helpers ─────────────────────────────────────────────── */

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
    { timeout: 30_000 },
  );
  const d = Number(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/* Beat detection via the ebur128 momentary-loudness envelope — the same
   approach as generate/beat-sync.ts (see that file for the full algorithm
   rationale). Returns beat timestamps in seconds plus an estimated BPM. */
async function detectBeats(
  audioPath: string,
  sensitivity: number,
  maxBeats: number,
  maxDuration: number,
): Promise<{ beats: number[]; bpm: number | null }> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-i", audioPath, "-af", "ebur128=peak=true", "-f", "null", "-"],
    { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const points: Array<{ t: number; m: number }> = [];
  const re = /t:\s*([\d.]+)\s+TARGET:[^\n]*?M:\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const t = parseFloat(m[1]!);
    const v = parseFloat(m[2]!);
    if (Number.isFinite(t) && Number.isFinite(v) && t <= maxDuration) points.push({ t, m: v });
  }
  if (points.length < 3) return { beats: [], bpm: null };
  const values = points.map((p) => p.m);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const maxM = Math.max(...values);
  if (maxM - mean < 3) return { beats: [], bpm: null };
  const threshold = Math.max(maxM - (6 + sensitivity), mean, -60);
  const MIN_GAP = 0.25;
  const EDGE = 0.3;
  const beats: number[] = [];
  for (let i = 1; i < points.length - 1 && beats.length < maxBeats; i++) {
    const p = points[i]!;
    if (p.t < EDGE || p.t > maxDuration - EDGE) continue;
    if (
      p.m > threshold &&
      p.m >= points[i - 1]!.m &&
      p.m >= points[i + 1]!.m &&
      (beats.length === 0 || p.t - beats[beats.length - 1]! >= MIN_GAP)
    ) {
      beats.push(p.t);
    }
  }
  let bpm: number | null = null;
  if (beats.length >= 4) {
    const gaps: number[] = [];
    for (let i = 1; i < beats.length; i++) gaps.push(beats[i]! - beats[i - 1]!);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)]!;
    if (median > 0) bpm = Math.round(60 / median);
  }
  return { beats, bpm };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const f3 = (v: number) => v.toFixed(3);

/* ─── source resolution ──────────────────────────────────────────────────── */

interface ResolvedSource {
  buffer: Buffer;
  title: string;
  songId: string | null;
}

async function downloadSongAudio(song: typeof songsTable.$inferSelect): Promise<Buffer> {
  if (song.audio_path) {
    const parsed = parseSupabaseStorageRefBucketed(song.audio_path);
    if (parsed) {
      const { data, error } = await getSupabaseAdmin().storage.from(parsed.bucket).download(parsed.objectPath);
      if (!error && data) return Buffer.from(await data.arrayBuffer());
    }
  }
  const r = await fetch(song.audio_url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`Could not download song audio (${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

async function resolveSource(userId: string, src: AudioSource, label: string): Promise<ResolvedSource> {
  if (src.songId) {
    const [song] = await db
      .select()
      .from(songsTable)
      .where(and(eq(songsTable.id, src.songId), eq(songsTable.user_id, userId)))
      .limit(1);
    if (!song) throw new Error(`${label}: song not found in your library.`);
    const buffer = await downloadSongAudio(song);
    if (buffer.length > 60 * 1024 * 1024) throw new Error(`${label}: song file exceeds the 60 MB limit.`);
    return { buffer, title: song.title, songId: song.id };
  }
  const r = await fetch(src.audioUrl!, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`${label}: could not download the audio URL (${r.status}).`);
  const buffer = Buffer.from(await r.arrayBuffer());
  if (buffer.length > 60 * 1024 * 1024) throw new Error(`${label}: audio exceeds the 60 MB limit.`);
  const ct = r.headers.get("content-type") ?? "";
  if (buffer.length < 1024 || (!ct.startsWith("audio/") && !ct.includes("octet-stream"))) {
    // Still allow it through ffprobe validation below rather than rejecting on sniffing.
  }
  return { buffer, title: src.title ?? `${label}`, songId: null };
}

/* ─── filter graph builders ──────────────────────────────────────────────── */

const NORM = "aresample=44100,aformat=channel_layouts=stereo";

interface BlendPlan {
  filter: string;
  durationSec: number;
}

/** A -> crossfade into B starting at blendPoint. */
function buildCrossfade(
  dA: number,
  dB: number,
  ratio: number,
  blendPoint: number,
  xfade: number,
  gA: number,
  gB: number,
): BlendPlan {
  const d1 = clamp(blendPoint + xfade, xfade + 1, dA);
  const dBs = dB / ratio;
  // acrossfade requires the overlap to fit inside both inputs.
  const xfadeEff = Math.min(xfade, d1 - 0.5, dBs - 0.5);
  if (xfadeEff < 1) {
    throw new Error("Songs are too short for a crossfade — try Beat-matched instead.");
  }
  const filter =
    `[0:a]atrim=0:${f3(d1)},asetpts=PTS-STARTPTS,${NORM},volume=${f3(gA)}[a];` +
    `[1:a]atempo=${f3(ratio)},${NORM},volume=${f3(gB)}[b];` +
    `[a][b]acrossfade=d=${f3(xfadeEff)}:curve1=tri:curve2=tri,alimiter=limit=0.95[out]`;
  return { filter, durationSec: d1 + dBs - xfadeEff };
}

/** Beat-lock B onto A: B's first beat lands on A's beat nearest blendPoint. */
function buildBeatMatch(
  dA: number,
  dB: number,
  ratio: number,
  beatsA: number[],
  beatsB: number[],
  blendPoint: number,
  gA: number,
  gB: number,
): { plan: BlendPlan; beatA: number | null; offsetSec: number } {
  const dBs = dB / ratio;
  let beatA: number | null = null;
  let beatB0: number | null = null;
  if (beatsA.length > 0) {
    beatA = beatsA.reduce((best, b) => (Math.abs(b - blendPoint) < Math.abs(best - blendPoint) ? b : best), beatsA[0]!);
  }
  if (beatsB.length > 0) beatB0 = beatsB[0]! / ratio;
  const offsetSec = beatA !== null && beatB0 !== null ? Math.max(0, beatA - beatB0) : 0;
  const ms = Math.round(offsetSec * 1000);
  const outA = Math.min(dA, 420);
  const outDur = Math.min(Math.max(outA, offsetSec + dBs), 420);
  const filter =
    `[0:a]atrim=0:${f3(outDur)},asetpts=PTS-STARTPTS,${NORM},volume=${f3(gA)}[a];` +
    `[1:a]atempo=${f3(ratio)},${NORM},volume=${f3(gB)},adelay=${ms}|${ms}[b];` +
    `[a][b]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[out]`;
  return { plan: { filter, durationSec: outDur }, beatA, offsetSec };
}

/** Alternating verse/chorus chunks inside the shared window. */
function buildInterleave(
  dA: number,
  dB: number,
  ratio: number,
  bpmA: number | null,
  gA: number,
  gB: number,
): BlendPlan {
  const window = Math.min(dA, dB / ratio, 180);
  const chunk = bpmA ? clamp((16 * 60) / bpmA, 6, 16) : 8;
  const nSeg = Math.max(1, Math.ceil(window / chunk));
  const parts: string[] = [`[0:a]${NORM}[apre]`, `[1:a]atempo=${f3(ratio)},${NORM}[bpre]`];
  const labels: string[] = [];
  for (let i = 0; i < nSeg; i++) {
    const s = f3(i * chunk);
    const e = f3(Math.min((i + 1) * chunk, window));
    parts.push(`[apre]atrim=${s}:${e},asetpts=PTS-STARTPTS,volume=${f3(gA)}[a${i}]`);
    parts.push(`[bpre]atrim=${s}:${e},asetpts=PTS-STARTPTS,volume=${f3(gB)}[b${i}]`);
    labels.push(`[a${i}]`, `[b${i}]`);
  }
  parts.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1,alimiter=limit=0.95[out]`);
  return { filter: parts.join(";"), durationSec: window };
}

/* ─── routes ─────────────────────────────────────────────────────────────── */

router.get("/mashup/info", requireAuth, (_req, res) => {
  res.json({
    price: MASHUP_CREDIT_COST,
    styles: Object.entries(BLEND_STYLES).map(([key, v]) => ({ key, ...v })),
    defaults: { style: "beat-match", balance: 50, crossfadeSec: 6 },
    notes: [
      "Song B is tempo-matched to Song A (0.5x–2x) before blending.",
      "Balance 50/50 keeps both songs at full volume; slide it to feature one side.",
      "Mashups save to your song library and can be chained into lyric videos, cover art, and albums.",
    ],
  });
});

router.post("/mashup", requireAuth, async (req, res) => {
  const parsed = mashupSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid mashup request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { songA, songB, style, blendPointSec, crossfadeSec, balance, title } = parsed.data;
  const isDev = process.env["NODE_ENV"] === "development";

  // 402 pre-check.
  if (!isDev && (req.userCredits ?? 0) < MASHUP_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Mashing up two songs costs ${MASHUP_CREDIT_COST} Visual Bucs. Top up to keep creating.`,
      required: MASHUP_CREDIT_COST,
    });
    return;
  }

  // Charge upfront — chargeCredits() deducts + writes the ledger atomically,
  // throwing OutOfCreditsError (402) or LedgerWriteError (loud 500).
  let creditsAfter = req.userCredits ?? 0;
  if (!isDev) {
    try {
      creditsAfter = await chargeCredits(req.userId!, MASHUP_CREDIT_COST, { action: "Song Mashup" });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs for a mashup." });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), "mashup-"));
  const fail = async (message: string, code = "mashup_failed") => {
    req.log.error({ err: message }, "mashup: failed");
    if (!isDev) {
      await refundCredits(req.userId!, MASHUP_CREDIT_COST, { action: "Song Mashup — Refund (render failure)" }).catch(
        (refundErr) => req.log.error({ userId: req.userId, err: refundErr }, "[mashup] failed to refund credits"),
      );
    }
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    res.status(500).json({ error: `${message} Your Visual Bucs were refunded.`, code });
  };

  try {
    const [srcA, srcB] = await Promise.all([
      resolveSource(req.userId!, songA, "Song A"),
      resolveSource(req.userId!, songB, "Song B"),
    ]);
    const aPath = join(workDir, "a.audio");
    const bPath = join(workDir, "b.audio");
    const outPath = join(workDir, "mashup.mp3");
    await writeFile(aPath, srcA.buffer);
    await writeFile(bPath, srcB.buffer);

    const [dA, dB] = await Promise.all([probeDuration(aPath), probeDuration(bPath)]);
    if (!dA || !dB) {
      await fail("Could not read one of the songs — the audio file may be corrupt or unsupported.", "bad_audio");
      return;
    }

    // Beat-detect both (capped analysis window for long tracks).
    const win = Math.min(Math.max(dA, dB), 300);
    const [{ beats: beatsA, bpm: bpmA }, { beats: beatsB, bpm: bpmB }] = await Promise.all([
      detectBeats(aPath, 5, 200, win),
      detectBeats(bPath, 5, 200, win),
    ]);

    // Tempo-align B to A.
    const ratio = bpmA && bpmB ? clamp(bpmB / bpmA, 0.5, 2) : 1;
    const gA = clamp(balance / 50, 0.05, 2);
    const gB = clamp((100 - balance) / 50, 0.05, 2);
    const blendPoint = clamp(blendPointSec ?? dA / 2, 1, Math.max(1, dA - 1));

    let plan: BlendPlan;
    let beatA: number | null = null;
    if (style === "crossfade") {
      plan = buildCrossfade(dA, dB, ratio, blendPoint, crossfadeSec, gA, gB);
    } else if (style === "beat-match") {
      const r = buildBeatMatch(dA, dB, ratio, beatsA, beatsB, blendPoint, gA, gB);
      plan = r.plan;
      beatA = r.beatA;
    } else {
      plan = buildInterleave(dA, dB, ratio, bpmA, gA, gB);
    }

    req.log.info(
      { style, bpmA, bpmB, ratio, blendPoint, durationSec: plan.durationSec },
      "mashup: rendering",
    );

    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-y",
        "-i", aPath,
        "-i", bPath,
        "-filter_complex", plan.filter,
        "-map", "[out]",
        "-c:a", "libmp3lame",
        "-b:a", "192k",
        "-t", f3(Math.min(plan.durationSec, 420)),
        outPath,
      ],
      { timeout: 300_000, maxBuffer: 128 * 1024 * 1024 },
    );

    const outBuf = await readFile(outPath);
    if (outBuf.length < 1024) throw new Error("The render produced an empty file.");

    const objectName = `mashups/${req.userId}/${randomUUID()}.mp3`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, outBuf, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(storageRef);

    const mashupTitle = (title ?? `${srcA.title.slice(0, 60)} × ${srcB.title.slice(0, 60)}`).slice(0, 200);
    const [mashup] = await db
      .insert(songsTable)
      .values({
        user_id: req.userId!,
        title: mashupTitle,
        audio_url: url,
        audio_path: storageRef,
        source: "mashup",
        parent_song_id: srcA.songId,
        mashup_sources: [
          { songId: srcA.songId ?? "external", title: srcA.title },
          { songId: srcB.songId ?? "external", title: srcB.title },
        ],
        mashup_style: style,
        duration_sec: String(Math.round(plan.durationSec)),
      })
      .returning();

    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    res.json({
      song: mashup,
      analysis: {
        bpmA,
        bpmB,
        tempoRatio: Math.round(ratio * 100) / 100,
        style,
        blendPointSec: Math.round(blendPoint * 10) / 10,
        beatLockSec: beatA === null ? null : Math.round(beatA * 10) / 10,
        durationSec: Math.round(plan.durationSec * 10) / 10,
      },
      creditsAfter: isDev ? creditsAfter : creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mashup render failed.";
    if (/not found in your library|song not found/i.test(message)) {
      if (!isDev) {
        await refundCredits(req.userId!, MASHUP_CREDIT_COST, { action: "Song Mashup — Refund (bad input)" }).catch(() => {});
      }
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      res.status(400).json({ error: message, code: "bad_input" });
      return;
    }
    await fail(message);
  }
});

/* ── GET /api/mashup/using/:songId — "Mashups using this" ────────────────── */
router.get("/mashup/using/:songId", requireAuth, async (req, res) => {
  const songId = String(req.params["songId"] ?? "");
  const [song] = await db
    .select()
    .from(songsTable)
    .where(and(eq(songsTable.id, songId), eq(songsTable.user_id, req.userId!)))
    .limit(1);
  if (!song) {
    res.status(404).json({ error: "Song not found." });
    return;
  }
  const rows = await db
    .select()
    .from(songsTable)
    .where(
      and(
        eq(songsTable.user_id, req.userId!),
        eq(songsTable.source, "mashup"),
        sql`${songsTable.mashup_sources} @> ${JSON.stringify([{ songId: song.id }])}::jsonb`,
      ),
    )
    .orderBy(desc(songsTable.created_at))
    .limit(20);
  const withUrls = await Promise.all(
    rows.map(async (r) => {
      if (!r.audio_path) return r;
      try {
        return { ...r, audio_url: await refreshSupabaseStorageUrl(r.audio_path) };
      } catch {
        return r;
      }
    }),
  );
  res.json({ song: { id: song.id, title: song.title }, mashups: withUrls });
});

export default router;
