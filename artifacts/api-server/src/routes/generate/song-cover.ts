/**
 * song-cover.ts — Cover Song (Suno Cover parity).
 *
 *  POST /api/song-cover                 generate a cover of a song in a new style
 *  GET  /api/song-cover/presets         style presets for the cover UI
 *  GET  /api/song-cover/covers/:songId  covers made from an original song
 *
 * Price: 400 Visual Bucs (402 pre-check → charge → auto-refund on failure).
 *
 * ── HONEST CAPABILITY GAP (documented, not hidden) ─────────────────────────
 * The ElevenLabs Music API (POST /v1/music) is TEXT-CONDITIONED ONLY — it
 * accepts a prompt, a duration, a model id and force_instrumental. There is
 * no audio input, no style-transfer endpoint, and no "cover" mode. So a true
 * style-transfer of the exact recording (same performance, new style) is not
 * possible through this API today.
 *
 * What this route does instead: it generates a NEW ARRANGEMENT guided by the
 * source song — its title, its lyrics (when available), and the cover style
 * you pick — via the ElevenLabs music client. The response carries a
 * `coverApproach` note so the UI can say this plainly to the user. If
 * ElevenLabs ships an audio-conditioned cover/style-transfer endpoint, wire
 * it in here behind an ELEVENLABS_COVER_MODEL env var.
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
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);
const router = Router();

/** Flat price for a cover — 400 Visual Bucs. */
const COVER_CREDIT_COST = 400;
const BUCKET = "audio-stems";
const MIN_LENGTH_MS = 10_000;
const MAX_LENGTH_MS = 300_000;
const DEFAULT_LENGTH_MS = 60_000;

/** Style presets — the single source of truth (GET /song-cover/presets mirrors this). */
export const COVER_STYLE_PRESETS: Array<{ key: string; label: string; stylePrompt: string }> = [
  { key: "pop-hit",    label: "🎵 Pop Hit",    stylePrompt: "catchy modern pop cover with a soaring, memorable chorus" },
  { key: "hip-hop",    label: "🎤 Hip Hop",    stylePrompt: "hard-hitting hip hop cover with heavy 808s and a confident flow" },
  { key: "rock-anthem",label: "🎸 Rock Anthem",stylePrompt: "powerful rock anthem cover with epic guitars and driving drums" },
  { key: "rnb-soul",   label: "🎷 R&B Soul",   stylePrompt: "smooth R&B soul cover with rich harmonies and a silky groove" },
  { key: "acoustic",   label: "🎻 Acoustic",    stylePrompt: "intimate acoustic cover, warm guitar and soft percussion" },
  { key: "edm-dance",  label: "💃 EDM Dance",  stylePrompt: "high-energy EDM cover with euphoric drops and festival-ready synths" },
  { key: "lofi",       label: "🌙 Lo-Fi",       stylePrompt: "chill lo-fi cover reimagining with mellow keys and dusty drums" },
  { key: "country",    label: "🤠 Country",    stylePrompt: "heartfelt country cover with twangy guitars and warm storytelling" },
  { key: "ballad",     label: "😢 Power Ballad", stylePrompt: "emotional stripped-down ballad cover with swelling strings" },
  { key: "afrobeats",  label: "🌍 Afrobeats",  stylePrompt: "vibrant afrobeats cover with an infectious log-drum rhythm and sunny groove" },
];

/* ── GET /song-cover/presets ─────────────────────────────────────────────── */
router.get("/song-cover/presets", requireAuth, (_req, res) => {
  res.json({ presets: COVER_STYLE_PRESETS, cost: COVER_CREDIT_COST });
});

const songCoverSchema = z.object({
  /** Library song to cover. One of songId / audioUrl is required. */
  songId: z.string().uuid().optional(),
  /** Ad-hoc audio (uploaded file URL or generated preview URL). */
  audioUrl: z.string().url().max(2000).optional(),
  /** Preset key from GET /song-cover/presets (simple mode). */
  stylePreset: z.string().max(40).optional(),
  /** Free-form style description (custom mode). */
  stylePrompt: z.string().trim().max(2000).optional(),
  /** "auto" | "male" | "female" — vocal direction, matching Song Maker. */
  vocalGender: z.enum(["auto", "male", "female"]).optional().default("auto"),
  /** Tempo shift vs the original, in percent (-20..+20). */
  tempoShift: z.number().min(-20).max(20).optional().default(0),
  /** Lyrics carried into the cover so the melody/words survive the style change. */
  lyrics: z.string().trim().max(5000).optional(),
  /** Cover title (defaults to "<title> (Cover)"). */
  title: z.string().trim().max(200).optional(),
  /** Artist name carried onto the cover record. */
  artistName: z.string().trim().max(200).optional(),
});

/** Download the source audio for the cover, either from the user's library song or an ad-hoc URL. */
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
    // Prefer the stable storage ref; fall back to the stored URL.
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
    if (!r.ok) throw new Error(`Could not download the original audio (${r.status}).`);
    return { buffer: Buffer.from(await r.arrayBuffer()), title: song.title };
  }
  // Ad-hoc audio URL (not yet in the library).
  const r = await fetch(audioUrl!, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Could not download the source audio (${r.status}).`);
  return { buffer: Buffer.from(await r.arrayBuffer()), title: "Untitled song" };
}

/** Probe source duration with ffprobe; falls back to 60s when probing fails. */
async function probeDurationMs(buffer: Buffer): Promise<number> {
  const id = randomUUID();
  const path = join(tmpdir(), `${id}-cover-src.mp3`);
  try {
    await writeFile(path, buffer);
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
      { timeout: 30_000 },
    );
    const secs = Number(String(stdout).trim());
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(MAX_LENGTH_MS, Math.max(MIN_LENGTH_MS, Math.round(secs * 1000)));
    }
  } catch {
    /* fall through to the default */
  } finally {
    await unlink(path).catch(() => {});
  }
  return DEFAULT_LENGTH_MS;
}

/* ── POST /api/song-cover ─────────────────────────────────────────────────── */
router.post("/song-cover", requireAuth, async (req, res) => {
  const parsed = songCoverSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { songId, audioUrl, stylePreset, stylePrompt, vocalGender, tempoShift, lyrics, title, artistName } =
    parsed.data;

  if (!songId && !audioUrl) {
    res.status(400).json({ error: "Give a songId from your library or an audioUrl to cover.", code: "no_source" });
    return;
  }

  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    req.log.error("song-cover: missing ELEVENLABS_API_KEY");
    res.status(503).json({
      error: "Cover generation isn't configured on this server yet (missing ELEVENLABS_API_KEY).",
      code: "elevenlabs_not_configured",
    });
    return;
  }

  // Resolve the style: custom prompt wins, preset resolves to its prompt, default to pop-hit.
  let styleText: string;
  if (stylePrompt?.trim()) {
    styleText = stylePrompt.trim().slice(0, 2000);
  } else {
    const preset = COVER_STYLE_PRESETS.find((p) => p.key === stylePreset) ?? COVER_STYLE_PRESETS[0]!;
    styleText = preset.stylePrompt;
  }

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < COVER_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Top up to keep creating.",
    });
    return;
  }

  let sourceTitle = "Untitled song";
  let sourceBuffer: Buffer;
  try {
    const dl = await downloadSourceAudio(songId, audioUrl, req.userId!);
    sourceBuffer = dl.buffer;
    sourceTitle = dl.title;
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Could not load the source song." });
    return;
  }

  // Cover length tracks the original; the source file is only used for the
  // duration probe (see the capability-gap note at the top of this file).
  const coverLengthMs = await probeDurationMs(sourceBuffer);

  const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";

  // Build the cover prompt: title + style + vocal direction + tempo + lyrics.
  let fullPrompt = `Cover version of the song "${sourceTitle}". New arrangement in this style: ${styleText}. Keep the same lyrics and melody as the original song.`;
  if (vocalGender === "male") fullPrompt += " Male vocals.";
  else if (vocalGender === "female") fullPrompt += " Female vocals.";
  const shift = Math.round(tempoShift);
  if (shift > 0) fullPrompt += ` Performed about ${shift}% faster than the original.`;
  else if (shift < 0) fullPrompt += ` Performed about ${Math.abs(shift)}% slower than the original.`;
  const cleanLyrics = (lyrics ?? "").trim().slice(0, 5000);
  if (cleanLyrics) fullPrompt += `\n\nLyrics:\n${cleanLyrics}`;
  fullPrompt = fullPrompt.slice(0, 4000);

  let audioBuf: Buffer;
  try {
    const elevenRes = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: fullPrompt,
        music_length_ms: coverLengthMs,
        model_id: musicModel,
        force_instrumental: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      throw new Error(`ElevenLabs ${elevenRes.status}: ${errText.slice(0, 200)}`);
    }
    audioBuf = Buffer.from(await elevenRes.arrayBuffer());
    if (audioBuf.length === 0) throw new Error("The cover came back empty.");
  } catch (err) {
    // Pre-charge failure: nothing was charged.
    req.log.error({ err }, "song-cover: generation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Cover generation failed." });
    return;
  }

  // Upload the cover audio.
  const coverTitle = (title ?? "").trim() || `${sourceTitle} (Cover)`;
  const storagePath = `${req.userId}/generated/${Date.now()}-song-cover.mp3`;
  const r2Key = `audio-stems/${storagePath}`;
  try {
    await r2Upload(r2Key, audioBuf, "audio/mpeg");
  } catch (err) {
    // Pre-charge failure: nothing was charged.
    req.log.error({ err }, "song-cover: upload failed");
    res.status(500).json({ error: "Could not save the cover audio." });
    return;
  }
  const coverUrl = r2PublicUrl(r2Key);

  // Step 1: Save to history FIRST (throws → 500, no credits charged).
  let genHistoryId: string;
  try {
    genHistoryId = await recordGenerationHistory({
      userId: req.userId!,
      generationType: "Song Cover",
      prompt: fullPrompt.slice(0, 500),
      content: coverUrl,
      artistName: artistName || undefined,
      songTitle: coverTitle,
      creditsUsed: COVER_CREDIT_COST,
    });
  } catch (err) {
    req.log.error({ err }, "song-cover: history write failed");
    res.status(500).json({ error: "Could not save the cover. No Visual Bucs were charged." });
    return;
  }

  // Step 2: Charge. Every failure from here on refunds.
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, COVER_CREDIT_COST, { action: "Song Cover" });
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

  // Step 3: Persist the cover in the song library (parent_song_id links it to the original).
  try {
    const [song] = await db
      .insert(songsTable)
      .values({
        user_id: req.userId!,
        title: coverTitle.slice(0, 200),
        audio_url: coverUrl,
        audio_path: `${BUCKET}/${storagePath}`,
        source: "cover",
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
      audioUrl: coverUrl,
      storagePath,
      durationMs: coverLengthMs,
      creditsRemaining: creditsAfter,
      genHistoryId,
      /* Plain-language statement of what a "cover" means through this API. */
      coverApproach:
        "This cover is a new arrangement generated from your song's lyrics and the style you picked — the music API is text-only, so it reimagines rather than style-transfers the original recording.",
    });
  } catch (err) {
    // Post-charge failure: auto-refund, then fail loudly.
    req.log.error({ err }, "song-cover: library save failed, refunding");
    try {
      await refundCredits(req.userId!, COVER_CREDIT_COST, { action: "Song Cover — Refund" });
    } catch (refundErr) {
      req.log.error({ err: refundErr }, "song-cover: refund failed");
    }
    res.status(500).json({ error: "Could not save the cover to your library. Your Visual Bucs were refunded." });
  }
});

/* ── GET /api/song-cover/covers/:songId ─────────────────────────────────────
   Reverse lookup: every cover made from an original song. */
router.get("/song-cover/covers/:songId", requireAuth, async (req, res) => {
  const songId = String(req.params["songId"] ?? "");
  try {
    // Ownership check on the original first.
    const [original] = await db
      .select()
      .from(songsTable)
      .where(and(eq(songsTable.id, songId), eq(songsTable.user_id, req.userId!)))
      .limit(1);
    if (!original) {
      res.status(404).json({ error: "Song not found." });
      return;
    }
    const covers = await db
      .select()
      .from(songsTable)
      .where(and(eq(songsTable.user_id, req.userId!), eq(songsTable.parent_song_id, songId)))
      .orderBy(desc(songsTable.created_at));
    res.json({ covers });
  } catch (err) {
    req.log.error({ err }, "song-cover: covers lookup failed");
    res.status(500).json({ error: "Could not load covers." });
  }
});

export default router;
