/**
 * song-harmony.ts — AI Harmony Generator (Suno parity).
 *
 *  GET  /api/generate-harmony/modes     capability probe: which harmony engines are live (free)
 *  POST /api/generate-harmony           build backing-vocal harmonies for a song
 *  GET  /api/generate-harmony/using/:songId  harmony mixes built from a library song
 *
 * ── TWO ENGINES, HONESTLY LABELLED ─────────────────────────────────────────
 *  "classic" (always available):
 *    Pitch-preserving pitch-shifted vocal doubles via ffmpeg `rubberband` —
 *    a third up, a fifth up, an octave up/down, or a full stack. High quality,
 *    but every part is the SAME voice: classic studio doubles.
 *  "ai" (needs ELEVENLABS_API_KEY + HARMONY_VOICE_IDS):
 *    Each pitch-shifted part is re-voiced through ElevenLabs speech-to-speech
 *    into a distinct backing-singer voice, so the harmonies sound like REAL
 *    backing singers instead of pitched clones of the lead. The melody and
 *    timing are untouched; only the timbre changes.
 *  mode="auto" (default): AI when configured, classic otherwise. mode="ai"
 *  fails cleanly with a 503 NAMING the missing env var when unconfigured.
 *
 *  The ElevenLabs Music API is text-only, so there is no "arrange new
 *  harmonies from a prompt" path — the arrangement is the classic
 *  interval stack above, and the "AI" is the re-voicing. The response
 *  carries `harmonyMode` + `modeNote` so the UI always says which engine
 *  actually ran. Never claim AI harmonies when serving the classic path.
 *
 * Price: 300 Visual Bucs (classic) / 600 Visual Bucs (AI). 402 pre-check →
 * charge → auto-refund on any failure after the charge. No paid provider
 * calls happen in tests — the AI path is only exercised with a real key.
 */
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { db, songsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { parseSupabaseStorageRefBucketed } from "../../lib/objectStorage";
import { r2Upload, r2PublicUrl, r2Download } from "../../lib/r2-client";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);
const router = Router();

/** Flat prices (x100 Visual Bucs scale). The AI path burns real provider dollars. */
export const HARMONY_CREDIT_COST_CLASSIC = 300;
export const HARMONY_CREDIT_COST_AI = 600;
const BUCKET = "audio-stems";
const MAX_LENGTH_MS = 600_000; // 10 minutes — bounds server work per request

/** Env vars the AI engine needs. Named in 503s when unconfigured. */
const ELEVENLABS_API_KEY = "ELEVENLABS_API_KEY";
const HARMONY_VOICE_IDS = "HARMONY_VOICE_IDS";
const STS_MODEL = process.env["ELEVENLABS_STS_MODEL"] ?? "eleven_english_sts_v2";
const STS_TIMEOUT_MS = 300_000;

/** Harmony styles → fixed-interval parts (semitones). */
export const HARMONY_STYLES = {
  "thirds": {
    label: "Thirds up",
    blurb: "A harmony voice a major third above the lead — the classic pop stack.",
    parts: [{ key: "third-up", label: "Third up", semitones: 4 }],
  },
  "fifths": {
    label: "Fifths up",
    blurb: "A harmony voice a perfect fifth above the lead — big, anthemic.",
    parts: [{ key: "fifth-up", label: "Fifth up", semitones: 7 }],
  },
  "octave-up": {
    label: "Octave up",
    blurb: "A shimmering octave-up double of the lead.",
    parts: [{ key: "octave-up", label: "Octave up", semitones: 12 }],
  },
  "octave-down": {
    label: "Octave down",
    blurb: "A low octave double under the lead — weight and body.",
    parts: [{ key: "octave-down", label: "Octave down", semitones: -12 }],
  },
  "stack": {
    label: "Full stack",
    blurb: "Third + fifth + octave up — the full backing-choir wall.",
    parts: [
      { key: "third-up", label: "Third up", semitones: 4 },
      { key: "fifth-up", label: "Fifth up", semitones: 7 },
      { key: "octave-up", label: "Octave up", semitones: 12 },
    ],
  },
} as const;

type HarmonyStyleKey = keyof typeof HARMONY_STYLES;
type HarmonyMode = "auto" | "ai" | "classic";

/* ── GET /generate-harmony/modes (free capability probe) ─────────────────── */
router.get("/generate-harmony/modes", requireAuth, (_req, res) => {
  const elevenKey = Boolean(process.env[ELEVENLABS_API_KEY]);
  const voiceIds = (process.env[HARMONY_VOICE_IDS] ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const aiConfigured = elevenKey && voiceIds.length > 0;
  const missing: string[] = [];
  if (!elevenKey) missing.push(ELEVENLABS_API_KEY);
  if (voiceIds.length === 0) missing.push(HARMONY_VOICE_IDS);
  res.json({
    styles: Object.entries(HARMONY_STYLES).map(([key, s]) => ({
      key,
      label: s.label,
      blurb: s.blurb,
      parts: s.parts.map((p) => ({ key: p.key, label: p.label, semitones: p.semitones })),
    })),
    modes: [
      {
        key: "classic",
        label: "Classic doubles",
        blurb: "Pitch-perfect doubles of the same voice — thirds, fifths, octaves. Always available.",
        cost: HARMONY_CREDIT_COST_CLASSIC,
        available: true,
        missing: [] as string[],
      },
      {
        key: "ai",
        label: "AI harmonies",
        blurb: "Each harmony re-voiced into a distinct backing-singer voice by AI — sounds like real singers.",
        cost: HARMONY_CREDIT_COST_AI,
        available: aiConfigured,
        missing,
      },
    ],
    defaultMode: "auto",
    defaultStyle: "stack",
    defaultMixLevel: 35,
  });
});

const harmonySchema = z.object({
  /** Library song id — becomes the harmony mix's parent_song_id. */
  songId: z.string().uuid().optional(),
  /** Ad-hoc audio URL (signed storage URL or uploaded file URL). */
  audioUrl: z.string().url().max(2000).optional(),
  /** Optional key hint (e.g. "C", "Am") — recorded as context, not DSP. */
  keyHint: z.string().trim().max(16).optional(),
  style: z.enum(["thirds", "fifths", "octave-up", "octave-down", "stack"]).optional().default("stack"),
  /** How loud the harmonies sit under the lead, 0–100. */
  mixLevel: z.number().min(0).max(100).optional().default(35),
  /** "auto" (AI when configured, else classic) | "ai" | "classic". */
  mode: z.enum(["auto", "ai", "classic"]).optional().default("auto"),
});

/** Download the source audio for the harmonies, library song or ad-hoc URL. */
async function downloadSourceAudio(
  songId: string | undefined,
  audioUrl: string | undefined,
  userId: string,
): Promise<{ buffer: Buffer; title: string }> {
  if (songId) {
    const [song] = await db
      .select()
      .from(songsTable)
      .where(and(eq(songsTable.id, songId), eq(songsTable.user_id, userId)))
      .limit(1);
    if (!song) throw new Error("Song not found in your library.");
    if (song.audio_path) {
      // Try R2 first (new storage), then legacy Supabase ref.
      const r2Key = song.audio_path.startsWith("audio-stems/")
        ? song.audio_path
        : `audio-stems/${song.audio_path}`;
      try {
        const buffer = await r2Download(r2Key);
        return { buffer, title: song.title };
      } catch {
        /* fall through to legacy Supabase ref */
      }
      const parsed = parseSupabaseStorageRefBucketed(song.audio_path);
      if (parsed) {
        const { data, error } = await getSupabaseAdmin().storage
          .from(parsed.bucket)
          .download(parsed.objectPath);
        if (!error && data) {
          return { buffer: Buffer.from(await data.arrayBuffer()), title: song.title };
        }
      }
    }
    const r = await fetch(song.audio_url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`Could not download the song audio (${r.status}).`);
    return { buffer: Buffer.from(await r.arrayBuffer()), title: song.title };
  }
  const r = await fetch(audioUrl!, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Could not download the source audio (${r.status}).`);
  return { buffer: Buffer.from(await r.arrayBuffer()), title: "Untitled song" };
}

/** rubberband pitch factor for a semitone shift (time is preserved). */
function pitchFactor(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** Normalize to 44.1kHz stereo wav and return the duration in ms. */
async function normalizeSource(workdir: string, buffer: Buffer): Promise<{ wavPath: string; durationMs: number }> {
  const srcPath = join(workdir, "src-in.bin");
  const wavPath = join(workdir, "src.wav");
  await writeFile(srcPath, buffer);
  await execFileAsync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", srcPath, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", wavPath],
    { timeout: 120_000 },
  );
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", wavPath],
    { timeout: 30_000 },
  );
  const secs = Number(String(stdout).trim());
  if (!Number.isFinite(secs) || secs <= 0) throw new Error("Could not read the audio length.");
  return { wavPath, durationMs: Math.round(secs * 1000) };
}

/** Build one harmony part: pitch-shift the source with rubberband (time preserved). */
async function buildPart(workdir: string, srcWav: string, partKey: string, semitones: number): Promise<string> {
  const outPath = join(workdir, `part-${partKey}.wav`);
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-v", "error", "-i", srcWav,
      "-filter:a", `rubberband=pitch=${pitchFactor(semitones)}:transients=smooth:detector=soft:phase=laminar:window=short`,
      "-c:a", "pcm_s16le", outPath,
    ],
    { timeout: 240_000 },
  );
  return outPath;
}

/**
 * AI re-voicing: run a harmony part through ElevenLabs speech-to-speech so it
 * sounds like a different backing singer (same melody, new timbre). NO paid
 * test runs — this is only called with a real configured key.
 */
async function revoicePart(workdir: string, partWav: string, partKey: string, voiceId: string): Promise<string> {
  const apiKey = process.env[ELEVENLABS_API_KEY]!;
  const audioBytes = await readFile(partWav);
  const bytes = new Uint8Array(audioBytes.byteLength);
  bytes.set(audioBytes);
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type: "audio/wav" }), "part.wav");
  form.append("model_id", STS_MODEL);
  form.append("voice_settings", JSON.stringify({ stability: 0.5, similarity_boost: 0.8 }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STS_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ElevenLabs speech-to-speech failed (${res.status}): ${errText.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("The AI voice came back empty.");
    const mp3Path = join(workdir, `ai-${partKey}.mp3`);
    const wavPath = join(workdir, `ai-${partKey}.wav`);
    await writeFile(mp3Path, buf);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-v", "error", "-i", mp3Path, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", wavPath],
      { timeout: 120_000 },
    );
    return wavPath;
  } finally {
    clearTimeout(timer);
  }
}

/** Mix source + harmony parts into the preview. Each part sits at mixGain under the lead. */
async function mixParts(
  workdir: string,
  srcWav: string,
  partWavs: string[],
  mixLevel: number,
): Promise<string> {
  const mixPath = join(workdir, "harmony-mix.wav");
  const gain = (mixLevel / 100).toFixed(3);
  const inputs = ["-i", srcWav];
  const filterParts: string[] = ["[0:a]volume=1.0[a0]"];
  const labels: string[] = ["[a0]"];
  partWavs.forEach((_, i) => {
    inputs.push("-i", partWavs[i]!);
    filterParts.push(`[${i + 1}:a]volume=${gain}[a${i + 1}]`);
    labels.push(`[a${i + 1}]`);
  });
  const filter = `${filterParts.join(";")};${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first[aout]`;
  await execFileAsync(
    "ffmpeg",
    ["-y", "-v", "error", ...inputs, "-filter_complex", filter, "-map", "[aout]", "-c:a", "pcm_s16le", mixPath],
    { timeout: 240_000 },
  );
  return mixPath;
}

/* ── POST /api/generate-harmony ───────────────────────────────────────────── */
router.post("/generate-harmony", requireAuth, async (req, res) => {
  const parsed = harmonySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { songId, audioUrl, keyHint, style, mixLevel, mode } = parsed.data;
  const styleDef = HARMONY_STYLES[style as HarmonyStyleKey];

  if (!songId && !audioUrl) {
    res.status(400).json({ error: "Give a songId from your library or an audioUrl to harmonize.", code: "no_source" });
    return;
  }

  // ── Resolve which engine runs (fail cleanly, naming the missing env var). ──
  const elevenKey = process.env[ELEVENLABS_API_KEY];
  const voiceIds = (process.env[HARMONY_VOICE_IDS] ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  let harmonyMode: "ai" | "classic";
  let modeNote: string;
  if (mode === "ai") {
    if (!elevenKey) {
      res.status(503).json({
        error: "AI harmonies aren't configured on this server yet (missing ELEVENLABS_API_KEY). Classic doubles work right now.",
        code: "elevenlabs_not_configured",
        missing: [ELEVENLABS_API_KEY],
        fallback: "classic",
      });
      return;
    }
    if (voiceIds.length === 0) {
      res.status(503).json({
        error: "AI harmonies aren't configured on this server yet (missing HARMONY_VOICE_IDS — comma-separated ElevenLabs voice IDs for the backing singers). Classic doubles work right now.",
        code: "harmony_voices_not_configured",
        missing: [HARMONY_VOICE_IDS],
        fallback: "classic",
      });
      return;
    }
    harmonyMode = "ai";
    modeNote = "AI harmonies: each part re-voiced into a distinct backing-singer voice.";
  } else if (mode === "classic") {
    harmonyMode = "classic";
    modeNote = "Classic doubles: pitch-preserving doubles of the same voice.";
  } else {
    // auto — AI when fully configured, classic otherwise (honestly reported).
    if (elevenKey && voiceIds.length > 0) {
      harmonyMode = "ai";
      modeNote = "AI harmonies: each part re-voiced into a distinct backing-singer voice.";
    } else {
      harmonyMode = "classic";
      modeNote = "Classic doubles: pitch-preserving doubles of the same voice (AI voices not configured on this server).";
    }
  }
  const charge = harmonyMode === "ai" ? HARMONY_CREDIT_COST_AI : HARMONY_CREDIT_COST_CLASSIC;

  // ── 402 pre-check (before any heavy work). ──
  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < charge) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Top up to keep creating.",
    });
    return;
  }

  // ── Download + normalize the source. ──
  const workdir = await mkdtemp(join(tmpdir(), "harmony-"));
  try {
    let sourceTitle = "Untitled song";
    let sourceBuffer: Buffer;
    try {
      const dl = await downloadSourceAudio(songId, audioUrl, req.userId!);
      sourceBuffer = dl.buffer;
      sourceTitle = dl.title;
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Could not load the source audio." });
      return;
    }

    let srcWav: string;
    let durationMs: number;
    try {
      const norm = await normalizeSource(workdir, sourceBuffer);
      srcWav = norm.wavPath;
      durationMs = norm.durationMs;
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Could not read the source audio." });
      return;
    }
    if (durationMs > MAX_LENGTH_MS) {
      res.status(400).json({ error: "Harmonies are limited to 10 minutes — split longer audio first.", code: "too_long" });
      return;
    }

    // ── Build each harmony part (classic doubles engine). ──
    let finalPartWavs: string[];
    try {
      const classicParts: string[] = [];
      for (const part of styleDef.parts) {
        classicParts.push(await buildPart(workdir, srcWav, part.key, part.semitones));
      }
      if (harmonyMode === "ai") {
        // Re-voice every part into a distinct backing-singer voice (round-robin).
        finalPartWavs = [];
        for (let i = 0; i < classicParts.length; i++) {
          const voiceId = voiceIds[i % voiceIds.length]!;
          finalPartWavs.push(await revoicePart(workdir, classicParts[i]!, styleDef.parts[i]!.key, voiceId));
        }
      } else {
        finalPartWavs = classicParts;
      }
    } catch (err) {
      req.log.error({ err }, "song-harmony: part generation failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Harmony generation failed." });
      return;
    }

    // ── Mix the preview. ──
    let mixWav: string;
    try {
      mixWav = await mixParts(workdir, srcWav, finalPartWavs, mixLevel);
    } catch (err) {
      req.log.error({ err }, "song-harmony: mix failed");
      res.status(500).json({ error: "Could not mix the harmonies." });
      return;
    }

    // ── Encode stems + mix as mp3 and upload. ──
    const sb = req.userSupabase!;
    const prefix = `${req.userId}/harmony/${randomUUID()}`;
    const uploadedStems: Array<{ key: string; label: string; url: string; storagePath: string }> = [];
    try {
      for (let i = 0; i < finalPartWavs.length; i++) {
        const part = styleDef.parts[i]!;
        const mp3Path = join(workdir, `stem-${part.key}.mp3`);
        await execFileAsync(
          "ffmpeg",
          ["-y", "-v", "error", "-i", finalPartWavs[i]!, "-c:a", "libmp3lame", "-b:a", "192k", mp3Path],
          { timeout: 120_000 },
        );
        const storagePath = `${prefix}/stem-${part.key}.mp3`;
        const buf = await readFile(mp3Path);
        const stemR2Key = `audio-stems/${storagePath}`;
        try {
          await r2Upload(stemR2Key, buf, "audio/mpeg");
        } catch (upErr) {
          throw new Error(`Could not save the "${part.label}" stem.`);
        }
        uploadedStems.push({ key: part.key, label: part.label, url: r2PublicUrl(stemR2Key), storagePath });
      }
      const mixMp3Path = join(workdir, "harmony-mix.mp3");
      await execFileAsync(
        "ffmpeg",
        ["-y", "-v", "error", "-i", mixWav, "-c:a", "libmp3lame", "-b:a", "192k", mixMp3Path],
        { timeout: 120_000 },
      );
      const mixBuf = await readFile(mixMp3Path);
      const mixStoragePath = `${prefix}/harmony-mix.mp3`;
      const mixR2Key = `audio-stems/${mixStoragePath}`;
      try {
        await r2Upload(mixR2Key, mixBuf, "audio/mpeg");
      } catch (mixUpErr) {
        throw new Error("Could not save the harmony mix.");
      }
      const mixUrl = r2PublicUrl(mixR2Key);

      // ── Step 1: history FIRST (throws → 500, nothing charged). ──
      const mixTitle = `${sourceTitle} (Harmony Mix)`;
      const promptSummary = [
        `Harmony Generator (${harmonyMode}):`,
        styleDef.label,
        `mix ${mixLevel}%`,
        keyHint ? `key ${keyHint}` : null,
        `parts: ${styleDef.parts.map((p) => `${p.label} (${p.semitones > 0 ? "+" : ""}${p.semitones} st)`).join(", ")}`,
      ]
        .filter(Boolean)
        .join(" ");
      let genHistoryId: string;
      try {
        genHistoryId = await recordGenerationHistory({
          userId: req.userId!,
          generationType: "Harmony Generator",
          prompt: promptSummary.slice(0, 500),
          content: mixUrl,
          songTitle: mixTitle,
          creditsUsed: charge,
        });
      } catch (err) {
        req.log.error({ err }, "song-harmony: history write failed");
        res.status(500).json({ error: "Could not save the harmony. No Visual Bucs were charged." });
        return;
      }

      // ── Step 2: charge. Every failure from here on refunds. ──
      let creditsAfter: number;
      try {
        creditsAfter = await chargeCredits(req.userId!, charge, { action: "Harmony Generator" });
      } catch (deductErr) {
        if (deductErr instanceof OutOfCreditsError) {
          res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
          return;
        }
        if (deductErr instanceof LedgerWriteError) {
          res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged." });
          return;
        }
        throw deductErr;
      }

      // ── Step 3: persist the harmony mix in the song library. ──
      try {
        const [song] = await db
          .insert(songsTable)
          .values({
            user_id: req.userId!,
            title: mixTitle.slice(0, 200),
            audio_url: mixUrl,
            audio_path: `${BUCKET}/${mixStoragePath}`,
            source: "harmony-mix",
            parent_song_id: songId ?? null,
          })
          .returning();

        markGenerationHistoryCharged(genHistoryId).catch(() => {});

        res.json({
          song: {
            id: song!.id,
            title: song!.title,
            audio_url: song!.audio_url,
            source: song!.source,
            parent_song_id: song!.parent_song_id,
            created_at: song!.created_at,
          },
          mixedPreviewUrl: mixUrl,
          stems: uploadedStems.map((s) => ({ key: s.key, label: s.label, url: s.url })),
          harmonyMode,
          modeNote,
          style,
          keyHint: keyHint ?? null,
          mixLevel,
          durationMs,
          creditsRemaining: creditsAfter,
          genHistoryId,
        });
      } catch (err) {
        // Post-charge failure: auto-refund, then fail loudly.
        req.log.error({ err }, "song-harmony: library save failed, refunding");
        try {
          await refundCredits(req.userId!, charge, { action: "Harmony Generator — Refund" });
        } catch (refundErr) {
          req.log.error({ err: refundErr }, "song-harmony: refund failed");
        }
        res.status(500).json({ error: "Could not save the harmony mix to your library. Your Visual Bucs were refunded." });
      }
    } catch (err) {
      // Pre-charge failure: nothing was charged.
      req.log.error({ err }, "song-harmony: upload/encode failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Could not save the harmonies." });
    }
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
});

/* ── GET /api/generate-harmony/using/:songId ────────────────────────────────
   Reverse lookup: every harmony mix built from a library song. */
router.get("/generate-harmony/using/:songId", requireAuth, async (req, res) => {
  const songId = String(req.params["songId"] ?? "");
  try {
    const [original] = await db
      .select()
      .from(songsTable)
      .where(and(eq(songsTable.id, songId), eq(songsTable.user_id, req.userId!)))
      .limit(1);
    if (!original) {
      res.status(404).json({ error: "Song not found." });
      return;
    }
    const mixes = await db
      .select()
      .from(songsTable)
      .where(
        and(
          eq(songsTable.user_id, req.userId!),
          eq(songsTable.parent_song_id, songId),
          eq(songsTable.source, "harmony-mix"),
        ),
      )
      .orderBy(desc(songsTable.created_at));
    res.json({ mixes });
  } catch (err) {
    req.log.error({ err }, "song-harmony: mixes lookup failed");
    res.status(500).json({ error: "Could not load harmony mixes." });
  }
});

export default router;
