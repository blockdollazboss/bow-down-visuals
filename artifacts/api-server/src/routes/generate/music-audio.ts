import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { db, artistVaultsTable, songsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { swapSongVocalsToVoice } from "../../lib/voice-swap";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { r2Upload, r2PublicUrl } from "../../lib/r2-client";

const execFileAsync = promisify(execFile);

const router = Router();
const BUCKET = "audio-stems";
const MIN_LENGTH_MS = 10_000;
const MAX_LENGTH_MS = 300_000;
const DEFAULT_LENGTH_MS = 60_000;

/**
 * Tiered pricing by song length — provider cost scales with duration,
 * so the credit price does too. Keeps margins at ~4x+ across all tiers.
 * - Up to 1 min:  400 Visual Bucs (~$2.00, ~$0.30 cost)
 * - Up to 3 min:  800 Visual Bucs (~$4.00, ~$0.90 cost)
 * - Up to 5 min: 1200 Visual Bucs (~$6.00, ~$1.50 cost)
 */
function creditCostForLength(lengthMs: number): number {
  if (lengthMs <= 60_000) return 400;
  if (lengthMs <= 180_000) return 800;
  return 1200;
}

function clampLengthMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LENGTH_MS;
  const ms = Math.round(n * 1000);
  return Math.min(MAX_LENGTH_MS, Math.max(MIN_LENGTH_MS, ms));
}

/** Request-body validation for POST /generate-music-audio.
 * `prompt` stays optional here because the route answers a missing prompt
 * with its own 400 (`code: "missing_prompt"`) — kept unchanged below. */
const generateMusicAudioSchema = z.object({
  prompt: z.string().optional(),
  lengthSeconds: z.number().optional(),
  artistName: z.string().optional(),
  songTitle: z.string().optional(),
  artistVaultId: z.string().optional(),
  /** Persona singing voice (an ElevenLabs voice_id from GET /api/voices):
   * when the active artist vault has no locked voice, the generated vocals
   * are converted to this voice via the same STS swap (lib/voice-swap).
   * The Music API itself takes no voice parameter — the voice is applied
   * as a post-generation conversion, never faked into the prompt. */
  personaVoiceId: z.string().optional(),
  /** Custom lyrics (Suno-style custom mode) — embedded into the music prompt. */
  lyrics: z.string().optional(),
  /** Force instrumental, no vocals. */
  instrumental: z.boolean().optional(),
  /** "male" | "female" | undefined — appended to the prompt as vocal direction. */
  vocalGender: z.string().optional(),
  /** 1 or 2 — generate two variants (Suno-style A/B). Costs 2x credits. */
  variants: z.number().optional(),
});

/** Request-body validation for POST /generate-music-audio/extend.
 * `originalAudioUrl`/`extendPrompt` stay optional here because the route
 * answers missing values with its own 400 — kept unchanged below. */
const extendMusicAudioSchema = z.object({
  originalAudioUrl: z.string().optional(),
  originalPrompt: z.string().optional(),
  extendPrompt: z.string().optional(),
  extendSeconds: z.number().optional(),
  /** Extend-from-point: when present, the original is trimmed to this many
   * seconds and the continuation is crossfaded on there (everything after
   * the point is replaced). Absent = the original behavior — the
   * continuation is appended to the full original. */
  startSeconds: z.number().optional(),
  lyrics: z.string().optional(),
  instrumental: z.boolean().optional(),
  vocalGender: z.string().optional(),
  songTitle: z.string().optional(),
  artistName: z.string().optional(),
});

router.post("/generate-music-audio", requireAuth, async (req, res) => {
  const parsed = generateMusicAudioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { prompt, lengthSeconds, artistName, songTitle, artistVaultId,
    personaVoiceId, lyrics, instrumental, vocalGender, variants } = parsed.data;

  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "A music prompt is required.", code: "missing_prompt" });
    return;
  }

  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    req.log.error("generate-music-audio: missing ELEVENLABS_API_KEY");
    res.status(503).json({
      error: "Real audio generation isn't configured on this server yet.",
      code: "audio_gen_unavailable",
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  const musicLengthMs = clampLengthMs(lengthSeconds);
  const variantCount = variants === 2 ? 2 : 1;
  const baseCost = creditCostForLength(musicLengthMs);
  // Dual-variant costs 2x — two provider calls.
  const creditCost = baseCost * variantCount;
  if (!isDev && currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }


  // Pin the music model explicitly — the API default can lag behind releases.
  // Override with ELEVENLABS_MUSIC_MODEL if a newer model ships.
  const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";

  // Build the full music prompt: style + vocal direction + custom lyrics.
  let fullPrompt = prompt.trim().slice(0, 2000);
  const cleanGender = vocalGender === "male" || vocalGender === "female" ? vocalGender : null;
  if (cleanGender && !instrumental) {
    fullPrompt += ` ${cleanGender} vocals.`;
  }
  const cleanLyrics = typeof lyrics === "string" ? lyrics.trim().slice(0, 5000) : "";
  if (cleanLyrics && !instrumental) {
    fullPrompt += `\n\nLyrics:\n${cleanLyrics}`;
  }
  const forceInstrumental = instrumental === true;

  async function generateOne(): Promise<Buffer> {
    const elevenRes = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        music_length_ms: musicLengthMs,
        model_id: musicModel,
        force_instrumental: forceInstrumental,
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      throw new Error(`ElevenLabs ${elevenRes.status}: ${errText.slice(0, 200)}`);
    }

    const arrayBuffer = await elevenRes.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    if (buf.length === 0) throw new Error("Music generation returned no audio.");
    return buf;
  }

  try {
    // Generate variants sequentially (provider rate limits favor this).
    const buffers: Buffer[] = [];
    for (let v = 0; v < variantCount; v++) {
      buffers.push(await generateOne());
    }

    // Singing-voice conversion: swap each variant's vocals to the target
    // voice. The artist vault's locked voice wins when the active vault has
    // one; otherwise the applied persona's voice (personaVoiceId) is used.
    // Instrumentals have no vocals to convert, so the persona path skips
    // them. Cost is baked into the song price (same precedent as the vault
    // lock — see routes/artist-voices.ts). On any failure, fall back to
    // the original mix — never fail the song.
    let voiceSwapped = false;
    const finalBuffers: Buffer[] = [];
    for (const buffer of buffers) {
      let finalBuffer: Buffer = buffer;
      let targetVoiceId: string | null = null;
      if (artistVaultId) {
        try {
          const [vault] = await db
            .select({ voice_id: artistVaultsTable.voice_id })
            .from(artistVaultsTable)
            .where(
              and(
                eq(artistVaultsTable.id, artistVaultId),
                eq(artistVaultsTable.user_id, req.userId!),
              ),
            )
            .limit(1);
          if (vault?.voice_id) targetVoiceId = vault.voice_id;
        } catch (lookupErr) {
          req.log.error(
            { err: lookupErr },
            "generate-music-audio: vault voice lookup failed, using original mix",
          );
        }
      }
      if (!targetVoiceId && personaVoiceId && !forceInstrumental) {
        targetVoiceId = personaVoiceId;
      }
      if (targetVoiceId && process.env["ARTIST_VOICE_SWAP_ENABLED"] !== "false") {
        try {
          finalBuffer = await swapSongVocalsToVoice(buffer, targetVoiceId, apiKey);
          voiceSwapped = true;
          req.log.info(
            { vaultId: artistVaultId ?? null, voiceId: targetVoiceId },
            "generate-music-audio: vocals swapped to singing voice",
          );
        } catch (swapErr) {
          req.log.error(
            { err: swapErr },
            "generate-music-audio: voice swap failed, using original mix",
          );
          finalBuffer = buffer;
        }
      }
      finalBuffers.push(finalBuffer);
    }

    // Upload each variant.
    const variantsOut: Array<{ url: string; storagePath: string; label: string }> = [];
    for (let v = 0; v < finalBuffers.length; v++) {
      const path = `${req.userId}/generated/${Date.now()}-music-v${v + 1}.mp3`;
      const r2Key = `audio-stems/${path}`;
      try {
        await r2Upload(r2Key, finalBuffers[v], "audio/mpeg");
      } catch (upErr) {
        req.log.error({ err: upErr }, "generate-music-audio: upload failed");
        res.status(500).json({ error: "Could not save the generated audio.", code: "upload_failed" });
        return;
      }
      const variantUrl = r2PublicUrl(r2Key);
      variantsOut.push({
        url: variantUrl,
        storagePath: path,
        label: variantCount > 1 ? (v === 0 ? "A" : "B") : "A",
      });
    }

    // Step 1: Save to history FIRST (throws → outer catch returns 500, no credits charged)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Generate Audio",
      prompt:         fullPrompt.slice(0, 500),
      content:        variantsOut[0].url,
      artistName:     artistName || undefined,
      songTitle:      songTitle || undefined,
      creditsUsed:    creditCost,
    });

    // Step 2: Deduct credits only after history is confirmed saved.
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(req.userId!, creditCost, { action: "Generate Audio" });
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
        });
        return;
      }
      if (deductErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no Visual Bucs were charged. Please try again." });
        return;
      }
      throw deductErr;
    }

    // Step 3: Persist every variant in the song library (source:
    // "generated") — the same post-charge library save covers and
    // harmony mixes make. Before this step existed, a generated song
    // lived ONLY in the 100-item generation-history tray: the song
    // library, the distribution picker, remix-by-id and albums all
    // read the songs table, so a fresh generation was invisible to
    // every downstream feature.
    // Idempotent per generation job: a variant's row is keyed on its
    // storage path (audio_path is unique per generated file), so a
    // retried completion finds the row it already wrote and reuses
    // its id instead of duplicating the song.
    let songIds: string[];
    try {
      // The generating character rides the row only when the vault is
      // the caller's own — the same ownership rule the voice lookup
      // above applies (songs.artist_vault_id is how remixes already
      // carry their character).
      let ownedVaultId: string | null = null;
      if (artistVaultId) {
        const [vault] = await db
          .select({ id: artistVaultsTable.id })
          .from(artistVaultsTable)
          .where(
            and(
              eq(artistVaultsTable.id, artistVaultId),
              eq(artistVaultsTable.user_id, req.userId!),
            ),
          )
          .limit(1);
        if (vault) ownedVaultId = vault.id;
      }
      const libraryTitle = (songTitle ?? "").trim() || "Untitled song";
      songIds = [];
      for (const variant of variantsOut) {
        const audioPath = `${BUCKET}/${variant.storagePath}`;
        const [existing] = await db
          .select({ id: songsTable.id })
          .from(songsTable)
          .where(and(eq(songsTable.user_id, req.userId!), eq(songsTable.audio_path, audioPath)))
          .limit(1);
        if (existing) {
          songIds.push(existing.id);
          continue;
        }
        const [song] = await db
          .insert(songsTable)
          .values({
            user_id: req.userId!,
            title: libraryTitle.slice(0, 200),
            audio_url: variant.url,
            audio_path: audioPath,
            source: "generated",
            artist_vault_id: ownedVaultId,
            duration_sec: String(Math.round(musicLengthMs / 1000)),
          })
          .returning();
        songIds.push(song!.id);
      }
    } catch (libErr) {
      // Post-charge failure (the song-cover contract): refund in full
      // and fail loudly rather than strand a paid generation outside
      // the library it was promised to.
      req.log.error({ err: libErr }, "generate-music-audio: library save failed, refunding");
      try {
        await refundCredits(req.userId!, creditCost, { action: "Generate Audio — Refund" });
      } catch (refundErr) {
        req.log.error({ err: refundErr }, "generate-music-audio: refund failed");
      }
      res.status(500).json({ error: "Could not save the song to your library. Your Visual Bucs were refunded." });
      return;
    }

    // Step 4: Fire-and-forget — mark charged + log usage
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({
      // Back-compat: single-variant shape
      url: variantsOut[0].url,
      storagePath: variantsOut[0].storagePath,
      // Each variant now carries the id of its song-library row, so
      // the studio can hand the song straight to Distribute / Remix /
      // an album without a library round-trip to find it.
      variants: variantsOut.map((v, i) => ({ ...v, songId: songIds[i] })),
      durationMs: musicLengthMs,
      creditsRemaining: creditsAfter,
      genHistoryId,
      voiceSwapped,
      songId: songIds[0],
      songIds,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    req.log.error({ err }, "generate-music-audio: unexpected error");
    res.status(500).json({ error: message });
  }
});

export default router;

/* ─── Extend a song (Suno parity Phase 2) ───
   Generates a continuation segment and crossfades it onto the original.
   With the optional `startSeconds`, the original is trimmed to that point
   first, so the continuation is joined mid-track instead of at the end.
   POST /generate-music-audio/extend */

const EXTEND_MIN_MS = 10_000;
const EXTEND_MAX_MS = 120_000;
const CROSSFADE_MS = 3000;

async function downloadAudio(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Could not download original audio (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Earliest usable extend-from point: the acrossfade needs the kept prefix
 * to outlast the fade itself, so the trim point is clamped just past it. */
const MIN_START_SECONDS = CROSSFADE_MS / 1000 + 1;

/** Keep only the first `seconds` of an audio buffer (extend-from-point:
 * the continuation replaces everything after the trim point). */
async function trimAudioPrefix(audio: Buffer, seconds: number): Promise<Buffer> {
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}-trim-in.mp3`);
  const outPath = join(tmpdir(), `${id}-trim-out.mp3`);
  try {
    await writeFile(inPath, audio);
    await execFileAsync("ffmpeg", [
      "-y", "-i", inPath,
      "-t", String(seconds),
      "-c:a", "libmp3lame", "-b:a", "192k",
      outPath,
    ], { timeout: 120_000 });
    return await readFile(outPath);
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

async function crossfadeJoin(first: Buffer, second: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const firstPath = join(tmpdir(), `${id}-a.mp3`);
  const secondPath = join(tmpdir(), `${id}-b.mp3`);
  const outPath = join(tmpdir(), `${id}-out.mp3`);
  try {
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    // acrossfade joins with a smooth crossfade instead of a hard cut.
    await execFileAsync("ffmpeg", [
      "-y", "-i", firstPath, "-i", secondPath,
      "-filter_complex", `acrossfade=d=${CROSSFADE_MS / 1000}:c1=tri:c2=tri`,
      "-c:a", "libmp3lame", "-b:a", "192k",
      outPath,
    ], { timeout: 120_000 });
    return await readFile(outPath);
  } finally {
    await unlink(firstPath).catch(() => {});
    await unlink(secondPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

router.post("/generate-music-audio/extend", requireAuth, async (req, res) => {
  const parsed = extendMusicAudioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { originalAudioUrl, originalPrompt, extendPrompt, extendSeconds, startSeconds,
    lyrics, instrumental, vocalGender, songTitle, artistName } = parsed.data;

  if (!originalAudioUrl?.trim() || !extendPrompt?.trim()) {
    res.status(400).json({ error: "originalAudioUrl and extendPrompt are required." });
    return;
  }

  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    res.status(500).json({ error: "Music generation is not configured on this server." });
    return;
  }

  const extendMs = Math.min(EXTEND_MAX_MS, Math.max(EXTEND_MIN_MS,
    Math.round(Number(extendSeconds || 30) * 1000)));
  const creditCost = creditCostForLength(extendMs);

  /* Extend-from-point (optional): null = append to the full original,
   * exactly the pre-existing behavior. The charge above never depends on
   * it — it is keyed to the continuation length only. */
  const startSec =
    typeof startSeconds === "number" && Number.isFinite(startSeconds) && startSeconds > 0
      ? Math.max(MIN_START_SECONDS, startSeconds)
      : null;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";

  // Continuation prompt: carry the original's style into the new section.
  let segPrompt = `Continuation of this song: ${(originalPrompt || "").trim().slice(0, 1000)}. `.slice(0, 1200);
  segPrompt += `New section: ${extendPrompt.trim().slice(0, 500)}. Seamless flow, same key and tempo.`;
  const cleanGender = vocalGender === "male" || vocalGender === "female" ? vocalGender : null;
  if (cleanGender && !instrumental) segPrompt += ` ${cleanGender} vocals.`;
  const cleanLyrics = typeof lyrics === "string" ? lyrics.trim().slice(0, 5000) : "";
  if (cleanLyrics && !instrumental) segPrompt += `\n\nLyrics for this section:\n${cleanLyrics}`;
  segPrompt = segPrompt.slice(0, 2000);

  try {
    // 1. Generate the continuation segment.
    const elevenRes = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: segPrompt,
        music_length_ms: extendMs,
        model_id: musicModel,
        force_instrumental: instrumental === true,
      }),
    });
    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      throw new Error(`ElevenLabs ${elevenRes.status}: ${errText.slice(0, 200)}`);
    }
    const segment = Buffer.from(await elevenRes.arrayBuffer());
    if (segment.length === 0) throw new Error("Extension segment came back empty.");

    // 2. Download the original and crossfade-join. With an extend-from
    // point, the original is first trimmed to that point so the
    // continuation replaces everything after it; without one, the exact
    // pre-existing append path runs (same input, same join call).
    const original = await downloadAudio(originalAudioUrl.trim());
    const base = startSec != null ? await trimAudioPrefix(original, startSec) : original;
    const joined = await crossfadeJoin(base, segment);

    // 3. Upload.
    const path = `${req.userId}/generated/${Date.now()}-music-extended.mp3`;
    const r2Key = `audio-stems/${path}`;
    try {
      await r2Upload(r2Key, joined, "audio/mpeg");
    } catch (upErr) {
      throw new Error("Could not save the extended audio.");
    }
    const extendedUrl = r2PublicUrl(r2Key);

    // 4. History + charge (same pattern as the main endpoint).
    const genHistoryId = await recordGenerationHistory({
      userId: req.userId!,
      generationType: "Extend Audio",
      prompt: segPrompt.slice(0, 500),
      content: extendedUrl,
      artistName: artistName || undefined,
      songTitle: songTitle ? `${songTitle} (Extended)` : undefined,
      creditsUsed: creditCost,
    });

    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(req.userId!, creditCost, { action: "Extend Audio" });
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
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({
      url: extendedUrl,
      storagePath: path,
      creditsRemaining: creditsAfter,
      genHistoryId,
      /* The point the continuation was joined at; null = appended at the end. */
      extendedFromSeconds: startSec,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Extension failed";
    req.log.error({ err }, "generate-music-audio/extend: failed");
    res.status(500).json({ error: message });
  }
});
