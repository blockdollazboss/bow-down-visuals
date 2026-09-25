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
import { recordCreditUsage } from "../lib/payment-record";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRefBucketed,
} from "../lib/objectStorage";
import { swapSongVocalsToVoice } from "../lib/voice-swap";

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
const REMIX_CREDIT_COST = 3;

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

async function downloadSongAudio(song: typeof songsTable.$inferSelect): Promise<Buffer> {
  // Prefer the stable storage ref; fall back to the stored URL.
  if (song.audio_path) {
    const parsed = parseSupabaseStorageRefBucketed(song.audio_path);
    if (parsed) {
      const { data, error } = await getSupabaseAdmin().storage
        .from(parsed.bucket)
        .download(parsed.objectPath);
      if (!error && data) return Buffer.from(await data.arrayBuffer());
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
      message: "You are out of credits. Upgrade to keep creating.",
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
  if (!isDev) {
    await getSupabaseAdmin()
      .from("profiles")
      .update({ credits: currentCredits - REMIX_CREDIT_COST })
      .eq("id", req.userId!);
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

    recordCreditUsage({
      userId: req.userId!,
      action: "Song Remix",
      creditsUsed: isDev ? 0 : REMIX_CREDIT_COST,
    }).catch(() => {});

    res.json({ song: remix, creditsAfter: isDev ? currentCredits : currentCredits - REMIX_CREDIT_COST });
  } catch (err) {
    req.log.error({ err }, "songs: remix failed");
    // Refund: the remix produced nothing.
    if (!isDev) {
      await getSupabaseAdmin()
        .from("profiles")
        .update({ credits: currentCredits })
        .eq("id", req.userId!)
        .then(
          () => {},
          () => {},
        );
    }
    res.status(500).json({
      error: "Remix failed — your credits were refunded. Please try again.",
      code: "remix_failed",
    });
  }
});

export default router;
