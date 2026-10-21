/**
 * songs.ts — the user's song library.
 *
 *  POST   /api/songs/upload        upload a song file into the library
 *  GET    /api/songs               list the user's songs
 *  POST   /api/songs/:id/remix     regenerate the song's vocals in an artist
 *                                  vault's locked voice and remix it
 *
 * Remix pipeline: download song -> Demucs isolate vocals -> ElevenLabs
 * speech-to-speech to the vault's locked voice -> FFmpeg remix over the
 * original instrumental. Same engine as the song-generation voice swap
 * (lib/voice-swap.ts), applied to uploaded songs.
 */
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { db, songsTable, artistVaultsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRefBucketed,
  downloadStorageObjectBuffer,
} from "../lib/objectStorage";
import { swapSongVocalsToVoice } from "../lib/voice-swap";
import { buildMelodyMidi, midiFilenameBase, NoMelodyError } from "../lib/midi-file";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      /\.(mp3|wav|m4a|ogg|flac)$/i.test(file.originalname);
    cb(null, ok);
  },
});

/** Site credits for a vocal-remix (Demucs + ElevenLabs STS, no music gen). */
const REMIX_CREDIT_COST = 300;

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1]!.toLowerCase() : "mp3";
}

/* ── POST /api/songs/upload ─────────────────────────────────────────────── */
router.post("/songs/upload", requireAuth, upload.single("song"), async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    res.status(400).json({ error: "Upload an audio file.", code: "no_file" });
    return;
  }
  const title =
    (typeof req.body?.["title"] === "string" && req.body["title"].trim()) ||
    file.originalname.replace(/\.[a-z0-9]+$/i, "") ||
    "Untitled song";

  try {
    const objectName = `songs/${req.userId}/${randomUUID()}.${extOf(file.originalname)}`;
    const storageRef = await uploadMediaToSupabaseStorage(
      objectName,
      file.buffer,
      file.mimetype || "audio/mpeg",
    );
    const url = await refreshSupabaseStorageUrl(storageRef);

    const [song] = await db
      .insert(songsTable)
      .values({
        user_id: req.userId!,
        title: title.slice(0, 200),
        audio_url: url,
        audio_path: storageRef,
        source: "upload",
      })
      .returning();

    res.json({ song });
  } catch (err) {
    req.log.error({ err }, "songs: upload failed");
    res.status(500).json({ error: "Song upload failed. Please try again." });
  }
});

/* ── GET /api/songs ─────────────────────────────────────────────────────── */
router.get("/songs", requireAuth, async (req, res) => {
  const songs = await db
    .select()
    .from(songsTable)
    .where(eq(songsTable.user_id, req.userId!))
    .orderBy(desc(songsTable.created_at))
    .limit(100);
  // Refresh signed URLs so the library always plays.
  const withUrls = await Promise.all(
    songs.map(async (s) => {
      if (!s.audio_path) return s;
      try {
        return { ...s, audio_url: await refreshSupabaseStorageUrl(s.audio_path) };
      } catch {
        return s;
      }
    }),
  );
  res.json({ songs: withUrls });
});

/* ── GET /api/songs/:id/midi ──────────────────────────────────────────────
   Export the song's melody as a real Standard MIDI File, built by the
   house melody analysis (lib/melody-analysis — the same extraction the
   hum-to-song flow exports) over the song's own audio. FREE: the song
   file itself downloads free from this library and the hum flow's MIDI
   export is free ("yours to keep") — this is the creator's own data,
   not generation work. No melody heard → an honest 422, never an
   empty file. Analysis window is the analysis module's first-60s cap,
   stated in the UI copy. */
router.get("/songs/:id/midi", requireAuth, async (req, res) => {
  const [song] = await db
    .select()
    .from(songsTable)
    .where(and(eq(songsTable.id, String(req.params["id"])), eq(songsTable.user_id, req.userId!)))
    .limit(1);
  if (!song) {
    res.status(404).json({ error: "Song not found." });
    return;
  }

  let audio: Buffer;
  try {
    audio = await downloadSongAudio(song);
  } catch (err) {
    req.log.error({ err, songId: song.id }, "songs: midi export could not load audio");
    res.status(502).json({
      error: "Couldn't load that song's audio — please try again.",
      code: "audio_unavailable",
    });
    return;
  }

  try {
    const { midi } = await buildMelodyMidi(audio, song.title);
    res.setHeader("Content-Type", "audio/midi");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${midiFilenameBase(song.title)}-melody.mid"`,
    );
    res.send(midi);
  } catch (err) {
    if (err instanceof NoMelodyError) {
      res.status(422).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof Error && /too short/i.test(err.message)) {
      res.status(400).json({ error: err.message, code: "too_short" });
      return;
    }
    req.log.error({ err, songId: song.id }, "songs: midi export analysis failed");
    res.status(422).json({
      error: "We couldn't read a melody in that song's audio.",
      code: "analysis_failed",
    });
  }
});

async function downloadSongAudio(song: typeof songsTable.$inferSelect): Promise<Buffer> {
  // Prefer the stable storage ref (R2-first dual-stack read); fall back
  // to the stored URL.
  if (song.audio_path) {
    const parsed = parseSupabaseStorageRefBucketed(song.audio_path);
    if (parsed) {
      const buf = await downloadStorageObjectBuffer(parsed);
      if (buf) return buf;
    }
  }
  const r = await fetch(song.audio_url);
  if (!r.ok) throw new Error(`Could not download song audio (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/* ── POST /api/songs/:id/remix ─────────────────────────────────────────────
   Regenerate the song's vocals in the artist vault's locked voice and remix.
   Body: { artistVaultId: string } */
router.post("/songs/:id/remix", requireAuth, async (req, res) => {
  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "Voice service is not configured on this server." });
    return;
  }
  const { artistVaultId } = req.body as { artistVaultId?: string };
  if (!artistVaultId) {
    res.status(400).json({ error: "artistVaultId is required.", code: "no_vault" });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < REMIX_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Upgrade to keep creating.",
      required: REMIX_CREDIT_COST,
    });
    return;
  }

  const [song] = await db
    .select()
    .from(songsTable)
    .where(and(eq(songsTable.id, String(req.params["id"])), eq(songsTable.user_id, req.userId!)))
    .limit(1);
  if (!song) {
    res.status(404).json({ error: "Song not found." });
    return;
  }

  const [vault] = await db
    .select()
    .from(artistVaultsTable)
    .where(and(eq(artistVaultsTable.id, String(artistVaultId)), eq(artistVaultsTable.user_id, req.userId!)))
    .limit(1);
  if (!vault) {
    res.status(404).json({ error: "Artist not found." });
    return;
  }
  if (!vault.voice_id) {
    res.status(409).json({
      error: `${vault.artist_name} has no locked voice yet. Lock a voice first, then remix.`,
      code: "no_locked_voice",
    });
    return;
  }

  // Charge upfront: the Demucs + STS work starts immediately.
  // chargeCredits(): deduct + strict ledger write. A ledger failure rolls the
  // deduction back and throws LedgerWriteError (loud) — no untraceable charge.
  if (!isDev) {
    try {
      await chargeCredits(req.userId!, REMIX_CREDIT_COST, { action: "Song Remix" });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: `Remixing a song costs ${REMIX_CREDIT_COST} credits — top up to remix.` });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
  }

  try {
    req.log.info(
      { songId: song.id, vaultId: vault.id, voice: vault.voice_name },
      "songs: remix started",
    );
    const songBuffer = await downloadSongAudio(song);
    const remixed = await swapSongVocalsToVoice(songBuffer, vault.voice_id, apiKey);

    const objectName = `songs/${req.userId}/${randomUUID()}.mp3`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, remixed, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(storageRef);

    const [remix] = await db
      .insert(songsTable)
      .values({
        user_id: req.userId!,
        title: `${song.title} (${vault.artist_name} remix)`.slice(0, 200),
        audio_url: url,
        audio_path: storageRef,
        source: "remix",
        parent_song_id: song.id,
        artist_vault_id: vault.id,
      })
      .returning();

    // The ledger entry was written atomically by chargeCredits() above.
    res.json({ song: remix, creditsAfter: isDev ? currentCredits : currentCredits - REMIX_CREDIT_COST });
  } catch (err) {
    req.log.error({ err }, "songs: remix failed");
    // Refund with a ledger trace: the remix produced nothing.
    if (!isDev) {
      await refundCredits(req.userId!, REMIX_CREDIT_COST, { action: "Song Remix — Refund (provider failure)" })
        .catch((refundErr) => {
          req.log.error({ userId: req.userId, err: refundErr }, "[songs] failed to refund remix credits");
        });
    }
    res.status(500).json({
      error: "Remix failed — your Visual Bucs were refunded. Please try again.",
      code: "remix_failed",
    });
  }
});

export default router;
