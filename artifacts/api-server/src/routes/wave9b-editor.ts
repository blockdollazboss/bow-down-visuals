import { Router } from "express";
import { z } from "zod";
import { spawn, spawnSync } from "node:child_process";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../lib/generation-stored-results";

/* ─── Wave 9B — Video Editor assistant routes ──────────────────────────────
   Three features, one router (mounted at /api — coordinator wires routes/index.ts):

     POST /wave9b/beats/detect      150 VB — offline beat/onset detection
     POST /wave9b/templates/apply   100 VB — deterministic edit-recipe op lists
     (POST /wave9b/bg/replace removed 2026-10-08 — now 100% on-device, free)

   Credit discipline (standing): capability check BEFORE charging → charge
   BEFORE the model/heavy call → refund on ANY failure. Never charge without
   delivery.

   ── What the server can HONESTLY do today ──
   • Beat detection: REAL, offline. ffmpeg (in the Dockerfile) decodes the
     audio to mono PCM; the route computes an RMS-energy novelty onset
     envelope in pure TS, peak-picks onsets with an adaptive local threshold,
     and estimates BPM by autocorrelation of the onset envelope over the
     60–200 BPM lag range. No AI model, no external API, no hallucinated
     beats — just signal processing. Limits: it finds percussive energy
     onsets, not true music-theoretic beats; on speech it mostly finds
     syllable onsets. Best on rhythmic music / songs.
   • Edit recipes: deterministic server-side compilation. jumpcut-vlog runs
     real ffmpeg `silencedetect` on the audio URL and returns cut ops for the
     detected pauses. lyric-video / talking-head return pure layout op lists
     (caption preset, effects, overlays, framing) — no audio needed, no
     transcription faked. The ops execute client-side on the timeline model
     after the user previews and confirms them.
   • Background replace: NOT AVAILABLE. There is no subject-segmentation
     provider wired in the api-server (no rembg/u2net service, no Runway
     segmentation call). This route returns 503 and NEVER charges. It must
     not fake results. For green-screen clips, Chroma Key in Pro Tools
     (ChromaKeyPreview + pro-tools-ffmpeg chromakey chain) is the working
     path today. The job-record shape below is reserved for when a
     segmentation provider is connected.

   Timeline-model assumptions (frontend):
   • Clips are scenes; per-scene edits live in settings.clips[sceneId]
     (ClipEdit: trimStart/trimEnd/transition/effect/proTools/...).
   • The settings model has no sub-scene split points, so "apply cuts"
     persists kept beat markers as VideoChapter[] (settings.chapters —
     exported to YouTube as chapters) plus a localStorage beatCutPlan
     consumed by the editor; export-pipeline wiring of split points is a
     documented follow-up.
   • Edit ops from templates are a UI contract, not a DB contract:
       { op, target?, params, label, reversible }
     Client executes them against settings via setSettings. */

const router = Router();

const BEATS_CREDITS = 150;
const TEMPLATES_CREDITS = 100;
/** Background Replace runs 100% on-device (no provider cost) — the 200 VB
 *  charges for the premium AI feature itself, collected on delivery. */
const BGREPLACE_CREDITS = 200;

/* CA-KEY scopes: one per charged site in this file, so keys never
   collide across beats / templates / bg-replace in the shared store. */
const BEATS_SCOPE = "wave9b-beats";
const TEMPLATES_SCOPE = "wave9b-templates";
const BG_REPLACE_SCOPE = "wave9b-bg-replace";

const BEATS_REPLAY_NOTE =
  "These are the beats you already detected for this request — change the audio or window for a fresh pass.";
const TEMPLATES_REPLAY_NOTE =
  "This is the edit recipe you already made for this request — tweak the recipe inputs for a fresh one.";
const BG_REPLACE_REPLAY_NOTE =
  "This background replacement was already charged for this delivery — you have not been charged again.";

interface StoredResult { body: Record<string, unknown>; at: number }
/* ONE in-process store + in-flight map for the whole file; the keys
   are scope-distinct per site, so entries never cross sites. */
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetWave9bReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

/** Shared handler tail for this file's charged sites: durable +
 *  in-process + in-flight pre-check BEFORE any funding. Returns true
 *  when the request was already answered from a stored result. */
async function serveStoredReplay(
  res: import("express").Response,
  scope: string,
  key: string,
  userId: string,
  replayNote: string,
): Promise<boolean> {
  const durable = await findStoredGenerationResult(scope, key, userId);
  if (durable) {
    res.json({ ...durable, replayed: true, replayNote });
    return true;
  }
  const stored = storedResults.get(key);
  if (stored) {
    res.json({ ...stored.body, replayed: true, replayNote });
    return true;
  }
  const pending = inFlight.get(key);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json({ ...twinBody, replayed: true, replayNote });
      return true;
    }
    /* The twin failed (refunded + key voided where a refund path
       exists) — fall through and run this request fresh. */
  }
  return false;
}

/** Shared success tail: run, store BEFORE answering (in-process +
 *  durable, fail-open), post-charge twin check, then answer. Error
 *  markers are answered with today's exact status/body. */
async function runAndStore(
  res: import("express").Response,
  scope: string,
  key: string,
  userId: string,
  replayNote: string,
  run: Promise<Record<string, unknown>>,
): Promise<void> {
  inFlight.set(key, run);
  let body: Record<string, unknown>;
  try {
    body = await run;
  } finally {
    if (inFlight.get(key) === run) inFlight.delete(key);
  }

  const status = typeof body["__status"] === "number" ? (body["__status"] as number) : 200;
  if (status !== 200) {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(key, { body, at: Date.now() });
    await storeGenerationResult(scope, key, userId, { ...body });
  } catch { /* storing is best-effort */ }

  const postCharge = storedResults.get(key);
  if (postCharge && postCharge.body !== body) {
    res.json({ ...postCharge.body, replayed: true, replayNote });
    return;
  }

  res.json(body);
}

/* ─── Shared helpers ───────────────────────────────────────────────────── */

const urlSchema = z.string().trim().url().max(2048);

function ffmpegAvailable(): boolean {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/** Decode up to maxSec of the URL to mono 22050 Hz f32le PCM via ffmpeg.
 *  ffmpeg reads the URL directly (http input) — no download code needed. */
async function decodePcm(
  mediaUrl: string,
  maxSec: number
): Promise<{ samples: Float32Array; sampleRate: number; durationSec: number }> {
  const SAMPLE_RATE = 22050;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-v", "error",
      "-i", mediaUrl,
      "-t", String(maxSec),
      "-ac", "1",
      "-ar", String(SAMPLE_RATE),
      "-f", "f32le",
      "-",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg decode failed (exit ${code}): ${stderr.slice(0, 200)}`));
    });
  });
  const buf = Buffer.concat(chunks);
  const samples = new Float32Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
  const durationSec = samples.length / SAMPLE_RATE;
  return { samples, sampleRate: SAMPLE_RATE, durationSec };
}

/* ─── Offline beat detection ─────────────────────────────────────────────
   Novelty = half-wave-rectified RMS-energy difference; peak-picked against
   an adaptive local threshold; BPM = argmax autocorrelation of the novelty
   envelope in the 60–200 BPM lag band (octave preference for 90–140 BPM).
   Beats = grid anchored at the strongest onset. */

interface BeatResult {
  beats: number[];
  onsets: number[];
  bpm: number;
  durationSec: number;
  method: string;
}

function detectBeats(samples: Float32Array, sampleRate: number): BeatResult {
  const FRAME = 1024;
  const HOP = 512;
  const fps = sampleRate / HOP; // frames per second ≈ 43.07
  const nFrames = Math.max(1, Math.floor((samples.length - FRAME) / HOP));
  const energy = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    const off = i * HOP;
    let sum = 0;
    for (let j = 0; j < FRAME; j += 4) {
      const s = samples[off + j] ?? 0;
      sum += s * s;
    }
    energy[i] = Math.sqrt(sum / (FRAME / 4));
  }

  // Novelty envelope (energy increase only), normalized + lightly smoothed.
  const novelty = new Float32Array(nFrames);
  let nMax = 1e-9;
  for (let i = 1; i < nFrames; i++) {
    const d = energy[i] - energy[i - 1];
    novelty[i] = d > 0 ? d : 0;
    if (novelty[i] > nMax) nMax = novelty[i];
  }
  for (let i = 1; i < nFrames - 1; i++) {
    novelty[i] = (novelty[i - 1] + 2 * novelty[i] + novelty[i + 1]) / 4;
  }
  for (let i = 0; i < nFrames; i++) novelty[i] /= nMax;

  // Adaptive threshold: local mean over ±0.5 s window.
  const win = Math.max(3, Math.round(fps * 0.5));
  const prefix = new Float64Array(nFrames + 1);
  for (let i = 0; i < nFrames; i++) prefix[i + 1] = prefix[i] + novelty[i];

  // Peak picking: local max, above threshold, min spacing 0.22 s.
  const minDist = Math.max(2, Math.round(fps * 0.22));
  const onsets: number[] = [];
  let lastOnsetFrame = -minDist;
  for (let i = 1; i < nFrames - 1; i++) {
    if (i - lastOnsetFrame < minDist) continue;
    if (novelty[i] <= novelty[i - 1] || novelty[i] < novelty[i + 1]) continue;
    const lo = Math.max(0, i - win), hi = Math.min(nFrames, i + win);
    const localMean = (prefix[hi] - prefix[lo]) / Math.max(1, hi - lo);
    const threshold = localMean * 1.5 + 0.03;
    if (novelty[i] < threshold) continue;
    onsets.push((i * HOP) / sampleRate);
    lastOnsetFrame = i;
  }

  // Tempo: autocorrelation of novelty, lags for 60–200 BPM.
  const minLag = Math.floor(fps / (200 / 60));
  const maxLag = Math.ceil(fps / (60 / 60));
  let bestLag = Math.round(fps / (120 / 60));
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < nFrames; i += 2) s += novelty[i] * novelty[i + lag];
    const lagBpm = (60 * fps) / lag;
    // Octave preference: boost the 90–140 BPM band so 70 BPM doesn't
    // steal energy from its 140 BPM double.
    const octaveBoost = lagBpm >= 85 && lagBpm <= 145 ? 1.15 : 1.0;
    const score = s * octaveBoost;
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  const bpm = Math.round(((60 * fps) / bestLag) * 10) / 10;

  // Beat grid anchored at the strongest onset; keep grid points that sit
  // near a real onset (within 25% of the beat period) OR always keep the
  // anchor — then fill pure grid so cuts land musically.
  const durationSec = samples.length / sampleRate;
  const period = 60 / bpm;
  const anchor = onsets.length > 0 ? onsets[0] : 0;
  const beats: number[] = [];
  for (let t = anchor; t <= durationSec; t += period) beats.push(Math.round(t * 1000) / 1000);

  return {
    beats,
    onsets: onsets.map((o) => Math.round(o * 1000) / 1000),
    bpm,
    durationSec: Math.round(durationSec * 1000) / 1000,
    method: "offline-onset",
  };
}

/* ─── POST /wave9b/beats/detect — 150 VB ─── */
const beatsRequestSchema = z.object({
  /** Direct audio (or audio-bearing video) URL the server can read. */
  mediaUrl: urlSchema,
  /** Optional timeline audio id (for UI round-trip only — detection reads mediaUrl). */
  timelineAudioId: z.string().trim().max(200).optional().default(""),
  /** Analysis window cap, seconds. Longer tracks cost server CPU. */
  maxAnalyzeSec: z.number().int().min(10).max(300).optional().default(180),
});

async function runBeats(
  userId: string,
  data: z.infer<typeof beatsRequestSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  /* Charge BEFORE the heavy call, under the CA-KEY idempotency key. */
  let remaining: number;
  try {
    remaining = await chargeCredits(userId, BEATS_CREDITS, {
      action: "Beat-Sync Cut Detection",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to detect beats.",
      };
    }
    throw err;
  }

  try {
    const { mediaUrl, maxAnalyzeSec } = data;
    const { samples, sampleRate } = await decodePcm(mediaUrl, maxAnalyzeSec);
    if (samples.length < sampleRate) {
      throw new Error("Audio is too short to detect beats (under 1 second).");
    }
    const result = detectBeats(samples, sampleRate);
    return {
      ...result,
      creditsUsed: BEATS_CREDITS,
      creditsRemaining: remaining,
    };
  } catch (err) {
    /* Refund on ANY failure. When the refund lands, VOID the charge's
       idempotency key so the retry charges fresh instead of being
       suppressed as a replay. */
    logger.error({ err, userId }, "[wave9b] beats/detect failed — refunding");
    let refunded = true;
    try {
      await refundCredits(userId, BEATS_CREDITS, { action: "Beat-Sync Cut Detection — Refund" });
    } catch (refundErr) {
      refunded = false;
      logger.error({ userId, refundErr }, "[wave9b] CRITICAL: refund failed after beats failure");
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      __status: 500,
      error: `Beat detection failed (${msg}) — your Visual Bucs were refunded.`,
      refunded: true,
    };
  }
}

router.post("/wave9b/beats/detect", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = beatsRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid beat-detection request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* 1) Capability check BEFORE charging — ffmpeg must exist in the image. */
  if (!ffmpegAvailable()) {
    res.status(503).json({
      error: "beats_unavailable",
      message: "Beat detection needs ffmpeg on the server, which isn't installed here. Your Visual Bucs were not charged.",
    });
    return;
  }

  /* CA-KEY: the server derives the key itself on EVERY call — this
     schema accepts no client idempotencyKey, so the key is the
     {mediaUrl, timelineAudioId, maxAnalyzeSec} intent hash. */
  const idempotencyKey = buildChargeIdempotencyKey(
    BEATS_SCOPE, req.userId!, undefined,
    {
      mediaUrl: parsed.data.mediaUrl,
      timelineAudioId: parsed.data.timelineAudioId,
      maxAnalyzeSec: parsed.data.maxAnalyzeSec,
    },
  );
  if (await serveStoredReplay(res, BEATS_SCOPE, idempotencyKey, req.userId!, BEATS_REPLAY_NOTE)) return;

  /* 2) Charge BEFORE the heavy call (inside the run). */
  await runAndStore(
    res, BEATS_SCOPE, idempotencyKey, req.userId!, BEATS_REPLAY_NOTE,
    runBeats(req.userId!, parsed.data, idempotencyKey),
  );
});

/* ─── Edit-recipe op contract ────────────────────────────────────────────
   Ops execute CLIENT-side against EditorSettings after preview + confirm.
   Known op types (client executor switch):
     cut          { start, end, label }            remove/skip a time range (jump-cut)
     setTransition{ sceneId|"all", transition }
     setCaptions  { preset, position }             caption preset + placement
     addEffect    { effect }                       push onto settings.effects
     addOverlay   { overlay, label }               push overlay name
     setFraming   { value }                        per-clip proTools crop framing
     setFormat    { format }                       16:9 | 9:16 | 1:1
     setAudio     { duckUnder?: boolean }          duck music under voice
   label = plain-language preview line. reversible = undoable in one tap. */

const editOpSchema = z.object({
  op: z.string().min(1).max(40),
  target: z.string().max(200).optional(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  label: z.string().min(1).max(300),
  reversible: z.boolean().default(true),
});

type Wave9bEditOp = z.infer<typeof editOpSchema>;

const RECIPE_IDS = ["jumpcut-vlog", "lyric-video", "talking-head"] as const;

const recipeRequestSchema = z.object({
  recipeId: z.enum(RECIPE_IDS),
  /** Required for jumpcut-vlog (silence detection needs audio). */
  mediaUrl: urlSchema.optional(),
  /** Pause floor in seconds for jump-cut (only silences ≥ this get cut). */
  minPauseSec: z.number().min(0.3).max(3).optional().default(0.8),
  /** Project audio duration (sec) — bounds cut ops when silencedetect can't run. */
  durationSec: z.number().min(0).max(7200).optional().default(0),
  /** Beat grid from /wave9b/beats/detect — jump-cut boundaries snap to the nearest beat. */
  beatGrid: z.array(z.number().min(0).max(7200)).max(600).optional().default([]),
});

/** Real ffmpeg silencedetect — returns pause segments to cut. */
async function detectSilences(mediaUrl: string, minPauseSec: number): Promise<Array<{ start: number; end: number }>> {
  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-v", "info",
      "-i", mediaUrl,
      "-af", `silencedetect=noise=-32dB:d=${minPauseSec}`,
      "-f", "null", "-",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", () => resolve()); // exit code 0 expected; parse regardless
  });
  const pauses: Array<{ start: number; end: number }> = [];
  const startRe = /silence_start:\s*([0-9.]+)/g;
  const endRe = /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(stderr)) !== null) starts.push(parseFloat(m[1]));
  const ends: Array<[number, number]> = [];
  while ((m = endRe.exec(stderr)) !== null) ends.push([parseFloat(m[1]), parseFloat(m[2])]);
  // Pair starts with ends in order; merge overlaps.
  for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
    const start = starts[i];
    const end = ends[i][0];
    if (end - start >= minPauseSec) pauses.push({ start, end });
  }
  pauses.sort((a, b) => a.start - b.start);
  return pauses;
}

function fmtClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Snap a time to the nearest beat in the grid (used for musical cuts). */
function snapToBeat(t: number, beatGrid: number[]): number {
  if (beatGrid.length === 0) return t;
  let best = beatGrid[0];
  let bestDist = Math.abs(t - best);
  for (const b of beatGrid) {
    const d = Math.abs(t - b);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  // Only snap when the beat is close — never drag a cut far from the pause.
  return bestDist <= 0.35 ? best : t;
}

function buildRecipeOps(
  recipeId: (typeof RECIPE_IDS)[number],
  ctx: { mediaUrl?: string; minPauseSec: number; durationSec: number; beatGrid: number[] },
  pauses: Array<{ start: number; end: number }>
): Wave9bEditOp[] {
  const ops: Wave9bEditOp[] = [];
  if (recipeId === "jumpcut-vlog") {
    // Cut dead-air pauses (snapped to the beat grid when provided), snappy
    // cuts everywhere, minimal captions, voice-forward.
    for (const p of pauses.slice(0, 40)) {
      const start = snapToBeat(p.start, ctx.beatGrid);
      const end = snapToBeat(p.end, ctx.beatGrid);
      const snapped = start !== p.start || end !== p.end;
      ops.push({
        op: "cut",
        target: "timeline",
        params: { start, end, snappedToBeat: snapped },
        label: `Cut pause ${fmtClock(start)}–${fmtClock(end)} (dead air${snapped ? ", snapped to beat" : ""})`,
        reversible: true,
      });
    }
    ops.push(
      { op: "setTransition", target: "all", params: { transition: "Cut" }, label: "Set every transition to a hard cut", reversible: true },
      { op: "setCaptions", target: "timeline", params: { preset: "minimal", position: "bottom" }, label: "Captions: minimal style, bottom placement", reversible: true },
      { op: "setAudio", target: "timeline", params: { duckUnder: true }, label: "Duck background music under the voice", reversible: true },
    );
    if (pauses.length === 0) {
      ops.push({
        op: "note", target: "timeline", params: {},
        label: "No pauses found — the take is already tight. Transitions and captions were still tuned.",
        reversible: true,
      });
    }
    return ops;
  }
  if (recipeId === "lyric-video") {
    // Caption-forward: karaoke word-by-word center, cinematic mood, soft crossfades.
    return [
      { op: "setFormat", target: "timeline", params: { format: "16:9" }, label: "Format: 16:9 landscape", reversible: true },
      { op: "setCaptions", target: "timeline", params: { preset: "karaoke-word", position: "center" }, label: "Captions: karaoke word-by-word, centered", reversible: true },
      { op: "addEffect", target: "timeline", params: { effect: "Vignette" }, label: "Add effect: Vignette", reversible: true },
      { op: "addEffect", target: "timeline", params: { effect: "Glow" }, label: "Add effect: Glow", reversible: true },
      { op: "setTransition", target: "all", params: { transition: "Crossfade" }, label: "Set every transition to Crossfade", reversible: true },
    ];
  }
  // talking-head
  return [
    { op: "setFormat", target: "timeline", params: { format: "9:16" }, label: "Format: 9:16 vertical", reversible: true },
    { op: "setFraming", target: "all", params: { value: "center" }, label: "Center every clip on the speaker's face", reversible: true },
    { op: "addOverlay", target: "timeline", params: { overlay: "lower-third" }, label: "Add lower-third name banner", reversible: true },
    { op: "setCaptions", target: "timeline", params: { preset: "clean-white", position: "bottom" }, label: "Captions: clean white, bottom placement", reversible: true },
    { op: "addEffect", target: "timeline", params: { effect: "Sharpen" }, label: "Add effect: Sharpen", reversible: true },
  ];
}

/* ─── POST /wave9b/templates/apply — 100 VB ───
   Returns the recipe's edit-op list for PREVIEW. Nothing is applied
   server-side; the client shows the list and the user confirms before the
   ops execute against the timeline model. */
async function runTemplates(
  userId: string,
  data: z.infer<typeof recipeRequestSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  /* Charge BEFORE the work, under the CA-KEY idempotency key. */
  let remaining: number;
  try {
    remaining = await chargeCredits(userId, TEMPLATES_CREDITS, {
      action: "Timeline Edit Recipe",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to apply an edit recipe.",
      };
    }
    throw err;
  }

  const { recipeId, mediaUrl, minPauseSec, durationSec, beatGrid } = data;
  try {
    let pauses: Array<{ start: number; end: number }> = [];
    if (recipeId === "jumpcut-vlog" && mediaUrl) {
      pauses = await detectSilences(mediaUrl, minPauseSec);
    }
    const ops = buildRecipeOps(recipeId, { mediaUrl, minPauseSec, durationSec, beatGrid }, pauses);
    const parsedOps = ops.map((o) => editOpSchema.parse(o));
    return {
      recipeId,
      ops: parsedOps,
      opCount: parsedOps.length,
      method: recipeId === "jumpcut-vlog" ? "ffmpeg-silencedetect" : "deterministic-layout",
      creditsUsed: TEMPLATES_CREDITS,
      creditsRemaining: remaining,
    };
  } catch (err) {
    /* Refund on ANY failure. When the refund lands, VOID the charge's
       idempotency key so the retry charges fresh instead of being
       suppressed as a replay. */
    logger.error({ err, userId, recipeId }, "[wave9b] templates/apply failed — refunding");
    let refunded = true;
    try {
      await refundCredits(userId, TEMPLATES_CREDITS, { action: "Timeline Edit Recipe — Refund" });
    } catch (refundErr) {
      refunded = false;
      logger.error({ userId, refundErr }, "[wave9b] CRITICAL: refund failed after recipe failure");
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    return {
      __status: 500,
      error: "The edit recipe failed — your Visual Bucs were refunded.",
      refunded: true,
    };
  }
}

router.post("/wave9b/templates/apply", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = recipeRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid recipe request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { recipeId, mediaUrl, minPauseSec, durationSec, beatGrid } = parsed.data;

  if (recipeId === "jumpcut-vlog" && !mediaUrl) {
    res.status(400).json({
      error: "jumpcut-vlog needs the project audio URL to find pauses — pass mediaUrl.",
    });
    return;
  }

  /* 1) Capability check BEFORE charging (only jump-cut needs ffmpeg). */
  if (recipeId === "jumpcut-vlog" && !ffmpegAvailable()) {
    res.status(503).json({
      error: "recipe_unavailable",
      message: "Jump-cut vlog needs ffmpeg on the server, which isn't installed here. Your Visual Bucs were not charged.",
    });
    return;
  }

  /* CA-KEY: the server derives the key itself on EVERY call — this
     schema accepts no client idempotencyKey, so the key is the
     {recipeId, mediaUrl, minPauseSec, durationSec, beatGrid} intent
     hash. */
  const idempotencyKey = buildChargeIdempotencyKey(
    TEMPLATES_SCOPE, req.userId!, undefined,
    {
      recipeId,
      mediaUrl: mediaUrl ?? null,
      minPauseSec,
      durationSec,
      beatGrid,
    },
  );
  if (await serveStoredReplay(res, TEMPLATES_SCOPE, idempotencyKey, req.userId!, TEMPLATES_REPLAY_NOTE)) return;

  /* 2) Charge BEFORE the work (inside the run). */
  await runAndStore(
    res, TEMPLATES_SCOPE, idempotencyKey, req.userId!, TEMPLATES_REPLAY_NOTE,
    runTemplates(req.userId!, parsed.data, idempotencyKey),
  );
});

/* ─── POST /wave9b/bg/replace — REMOVED ───────────────────────────────────
   Background replacement moved 100% on-device (MediaPipe SelfieSegmentation
   in BackgroundReplaceSection.tsx): no provider, no per-clip cost, nothing
   uploaded. This server stub was deleted 2026-10-08 — do not re-add a
   charge here without also restoring a server-side implementation. */

/* ─── POST /wave9b/bg/charge — 200 VB — charge-on-delivery ────────────────
   The heavy work happens on the user's device (free to us). The client
   calls this AFTER a successful on-device replacement to collect the
   feature price. 402 when broke — the client keeps the processed blob and
   lets the user top up and retry the charge without reprocessing. */
async function runBgCharge(
  userId: string,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  /* PATTERN D / charge-on-delivery: the compositing already happened
     on-device; this charge IS the whole act. There is NO refund path
     on this site today and none is added here — a failed charge
     simply answers with today's error and stores nothing. */
  let remaining: number;
  try {
    remaining = await chargeCredits(userId, BGREPLACE_CREDITS, {
      action: "Background Replace",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to keep your replaced background.",
      };
    }
    throw err;
  }
  return { ok: true, remaining };
}

router.post("/wave9b/bg/charge", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = z.object({ sceneId: z.string().trim().max(128).optional().default("") }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid charge request." });
    return;
  }

  /* CA-KEY, derived AT THE CHARGE POINT (this handler does everything
     at the charge point): the key is { sceneId + delivered-asset
     identity }. Today's clients send only sceneId; the delivered
     asset's URL/ref identity is read from whatever URL/ref string
     fields the body carries (deliveredAssetUrl, assetUrl, url, ref,
     storageRef, …), so two DIFFERENT delivered assets under one
     scene charge separately, while a retried charge for the SAME
     delivery is served the stored result instead of charging 200
     again. This schema accepts no client idempotencyKey. */
  const rawBody = (req.body ?? {}) as Record<string, unknown>;
  const deliveredAsset: Record<string, string> = {};
  for (const [field, value] of Object.entries(rawBody)) {
    if (field !== "sceneId" && typeof value === "string" && value.length > 0) {
      deliveredAsset[field] = value;
    }
  }
  const idempotencyKey = buildChargeIdempotencyKey(
    BG_REPLACE_SCOPE, req.userId!, undefined,
    { sceneId: parsed.data.sceneId, deliveredAsset },
  );

  /* Pre-check at the charge point: a retry after a lost response
     serves the stored { ok, remaining } instead of charging again. */
  if (await serveStoredReplay(res, BG_REPLACE_SCOPE, idempotencyKey, req.userId!, BG_REPLACE_REPLAY_NOTE)) return;

  await runAndStore(
    res, BG_REPLACE_SCOPE, idempotencyKey, req.userId!, BG_REPLACE_REPLAY_NOTE,
    runBgCharge(req.userId!, idempotencyKey),
  );
});

export default router;
