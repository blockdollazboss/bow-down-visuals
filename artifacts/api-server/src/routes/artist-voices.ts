/**
 * artist-voices.ts — lock an ElevenLabs voice into an artist vault.
 *
 *  GET    /api/voices                            list account voices (picker)
 *  POST   /api/artist-vaults/:id/voice/clone      clone from uploaded sample(s)
 *  POST   /api/artist-vaults/:id/voice/from-song  strip a song to its vocals,
 *                                                 clone them, lock as the voice
 *  PATCH  /api/artist-vaults/:id/voice            set voice from library pick
 *  DELETE /api/artist-vaults/:id/voice            remove the locked voice
 *
 * When a vault has a locked voice, every song generated for that artist is
 * automatically vocal-swapped to it (see lib/voice-swap.ts). The swap cost is
 * baked into the song price — no extra charge to the user.
 */
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "crypto";
import { promises as fs } from "node:fs";
import { db, artistVaultsTable, songsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { recordCreditUsage } from "../lib/payment-record";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRefBucketed,
} from "../lib/objectStorage";
import { separateVocalStems, cleanupWorkdir } from "../lib/stem-separation";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 3 },
});

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

async function getOwnedVault(vaultId: string, userId: string) {
  const [vault] = await db
    .select()
    .from(artistVaultsTable)
    .where(and(eq(artistVaultsTable.id, vaultId), eq(artistVaultsTable.user_id, userId)))
    .limit(1);
  return vault ?? null;
}

/* ── GET /api/voices — voices available for the picker ─────────────── */
router.get("/voices", requireAuth, async (req, res) => {
  const apiKey = elevenKey();
  if (!apiKey) {
    res.status(503).json({ error: "Voice service is not configured on this server." });
    return;
  }
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (!r.ok) {
      req.log.error({ status: r.status }, "artist-voices: voices list failed");
      res.status(502).json({ error: "Could not load voices. Please try again." });
      return;
    }
    const data = (await r.json()) as {
      voices?: Array<{
        voice_id: string;
        name: string;
        preview_url?: string | null;
        category?: string | null;
      }>;
    };
    res.json({
      voices: (data.voices ?? []).map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        preview_url: v.preview_url ?? null,
        category: v.category ?? null,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "artist-voices: voices list error");
    res.status(502).json({ error: "Could not load voices. Please try again." });
  }
});

/* ── POST /api/artist-vaults/:id/voice/clone — instant voice clone ──── */
router.post(
  "/artist-vaults/:id/voice/clone",
  requireAuth,
  upload.array("files", 3),
  async (req, res) => {
    const apiKey = elevenKey();
    if (!apiKey) {
      res.status(503).json({ error: "Voice service is not configured on this server." });
      return;
    }
    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one voice sample.", code: "no_files" });
      return;
    }
    const vault = await getOwnedVault(req.params.id as string, req.userId!);
    if (!vault) {
      res.status(404).json({ error: "Artist not found." });
      return;
    }
    try {
      const form = new FormData();
      const voiceName = `${vault.artist_name} — Locked Voice`;
      form.append("name", voiceName);
      for (const f of files) {
        // Copy into a fresh Uint8Array<ArrayBuffer> so TS accepts it as a BlobPart.
        const bytes = new Uint8Array(f.buffer.byteLength);
        bytes.set(f.buffer);
        form.append(
          "files",
          new Blob([bytes], { type: f.mimetype || "audio/mpeg" }),
          f.originalname || "sample.mp3",
        );
      }
      form.append("remove_background_noise", "true");
      form.append(
        "description",
        `Locked voice for ${vault.artist_name} (Bow Down Visuals artist vault)`,
      );

      const r = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        req.log.error({ status: r.status, errText }, "artist-voices: IVC failed");
        res.status(502).json({
          error: "Voice cloning failed. Try a clearer sample, at least 30 seconds.",
          code: "clone_failed",
        });
        return;
      }
      const data = (await r.json()) as {
        voice_id: string;
        requires_verification?: boolean;
      };

      // Best-effort: fetch the voice's preview URL for the vault UI.
      let previewUrl: string | null = null;
      try {
        const vr = await fetch(`https://api.elevenlabs.io/v1/voices/${data.voice_id}`, {
          headers: { "xi-api-key": apiKey },
        });
        if (vr.ok) {
          const vd = (await vr.json()) as { preview_url?: string | null };
          previewUrl = vd.preview_url ?? null;
        }
      } catch {
        /* non-fatal */
      }

      await db
        .update(artistVaultsTable)
        .set({
          voice_id: data.voice_id,
          voice_name: voiceName,
          voice_preview_url: previewUrl,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(artistVaultsTable.id, vault.id),
            eq(artistVaultsTable.user_id, req.userId!),
          ),
        );

      res.json({
        voice_id: data.voice_id,
        voice_name: voiceName,
        voice_preview_url: previewUrl,
        requires_verification: data.requires_verification ?? false,
      });
    } catch (err) {
      req.log.error({ err }, "artist-voices: clone error");
      res.status(502).json({ error: "Voice cloning failed. Please try again." });
    }
  },
);

const SetVoiceSchema = z.object({
  voiceId: z.string().min(1).max(100),
  voiceName: z.string().min(1).max(200),
  voicePreviewUrl: z.string().url().max(2000).optional().nullable(),
});

/* ── PATCH /api/artist-vaults/:id/voice — pick from the library ─────── */
router.patch("/artist-vaults/:id/voice", requireAuth, async (req, res) => {
  const parsed = SetVoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid voice selection." });
    return;
  }
  const vault = await getOwnedVault(req.params.id as string, req.userId!);
  if (!vault) {
    res.status(404).json({ error: "Artist not found." });
    return;
  }
  await db
    .update(artistVaultsTable)
    .set({
      voice_id: parsed.data.voiceId,
      voice_name: parsed.data.voiceName,
      voice_preview_url: parsed.data.voicePreviewUrl ?? null,
      updated_at: new Date(),
    })
    .where(
      and(eq(artistVaultsTable.id, vault.id), eq(artistVaultsTable.user_id, req.userId!)),
    );
  res.json({
    voice_id: parsed.data.voiceId,
    voice_name: parsed.data.voiceName,
    voice_preview_url: parsed.data.voicePreviewUrl ?? null,
  });
});

/* ── DELETE /api/artist-vaults/:id/voice — remove the locked voice ──── */
router.delete("/artist-vaults/:id/voice", requireAuth, async (req, res) => {
  const vault = await getOwnedVault(req.params.id as string, req.userId!);
  if (!vault) {
    res.status(404).json({ error: "Artist not found." });
    return;
  }
  await db
    .update(artistVaultsTable)
    .set({
      voice_id: null,
      voice_name: null,
      voice_preview_url: null,
      updated_at: new Date(),
    })
    .where(
      and(eq(artistVaultsTable.id, vault.id), eq(artistVaultsTable.user_id, req.userId!)),
    );
  res.json({ ok: true });
});

/* ── POST /api/artist-vaults/:id/voice/from-song ────────────────────────────
   Strip a song down to its vocals, clone them with ElevenLabs IVC, and lock
   the result as the artist's voice. The song can be:
     - a multipart "song" file upload, or
     - { "songId": "<songs-library-id>" }, or
     - { "songUrl": "https://..." }.
   Costs 2 site credits (Demucs isolation + clone); refunded on failure. */
const FROM_SONG_CREDIT_COST = 2;

async function loadSongBuffer(
  file: Express.Multer.File | undefined,
  body: { songId?: string; songUrl?: string },
  userId: string,
): Promise<{ buffer: Buffer; label: string }> {
  if (file?.buffer?.length) {
    return { buffer: file.buffer, label: file.originalname || "upload" };
  }
  if (body.songId) {
    const [song] = await db
      .select()
      .from(songsTable)
      .where(and(eq(songsTable.id, String(body.songId)), eq(songsTable.user_id, userId)))
      .limit(1);
    if (!song) throw Object.assign(new Error("Song not found."), { status: 404 });
    if (song.audio_path) {
      const parsed = parseSupabaseStorageRefBucketed(song.audio_path);
      if (parsed) {
        const { data, error } = await getSupabaseAdmin().storage
          .from(parsed.bucket)
          .download(parsed.objectPath);
        if (!error && data) {
          return { buffer: Buffer.from(await data.arrayBuffer()), label: song.title };
        }
      }
    }
    const r = await fetch(song.audio_url);
    if (!r.ok) throw new Error("Could not download the song audio.");
    return { buffer: Buffer.from(await r.arrayBuffer()), label: song.title };
  }
  if (body.songUrl) {
    const url = String(body.songUrl);
    if (!/^https?:\/\//i.test(url)) throw Object.assign(new Error("Invalid song URL."), { status: 400 });
    const r = await fetch(url);
    if (!r.ok) throw new Error("Could not download the song audio.");
    return { buffer: Buffer.from(await r.arrayBuffer()), label: url };
  }
  throw Object.assign(new Error("Provide a song file, songId, or songUrl."), { status: 400 });
}

router.post(
  "/artist-vaults/:id/voice/from-song",
  requireAuth,
  upload.single("song"),
  async (req, res) => {
    const apiKey = elevenKey();
    if (!apiKey) {
      res.status(503).json({ error: "Voice service is not configured on this server." });
      return;
    }
    const vault = await getOwnedVault(req.params.id as string, req.userId!);
    if (!vault) {
      res.status(404).json({ error: "Artist not found." });
      return;
    }

    const currentCredits = req.userCredits ?? 0;
    const isDev = process.env["NODE_ENV"] === "development";
    if (!isDev && currentCredits < FROM_SONG_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of credits. Upgrade to keep creating.",
        required: FROM_SONG_CREDIT_COST,
      });
      return;
    }
    if (!isDev) {
      await getSupabaseAdmin()
        .from("profiles")
        .update({ credits: currentCredits - FROM_SONG_CREDIT_COST })
        .eq("id", req.userId!);
    }

    const refund = () =>
      !isDev
        ? getSupabaseAdmin()
            .from("profiles")
            .update({ credits: currentCredits })
            .eq("id", req.userId!)
            .then(
              () => {},
              () => {},
            )
        : Promise.resolve();

    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      const { buffer: songBuffer, label } = await loadSongBuffer(
        file,
        req.body as { songId?: string; songUrl?: string },
        req.userId!,
      );
      req.log.info({ vaultId: vault.id, label }, "artist-voices: from-song isolation started");

      /* 1 — Strip the song down to its vocals. */
      const { vocalsPath, workdir } = await separateVocalStems(songBuffer);
      let vocalsBuffer: Buffer;
      try {
        vocalsBuffer = await fs.readFile(vocalsPath);
      } finally {
        await cleanupWorkdir(workdir);
      }
      // Sanity: isolated vocals for a real song are megabytes (wav).
      if (vocalsBuffer.length < 500 * 1024) {
        await refund();
        res.status(422).json({
          error: "Could not isolate usable vocals from this song. Try a song with clearer vocals.",
          code: "no_vocals",
        });
        return;
      }

      /* 2 — Save the stripped vocals so the artist can hear them. */
      const vocalsObject = `vocals-stems/${req.userId}/${randomUUID()}.wav`;
      const vocalsRef = await uploadMediaToSupabaseStorage(vocalsObject, vocalsBuffer, "audio/wav");
      const vocalsPreviewUrl = await refreshSupabaseStorageUrl(vocalsRef);

      /* 3 — Clone the vocals into a locked voice. */
      const voiceName = `${vault.artist_name} — Locked Voice`;
      const form = new FormData();
      form.append("name", voiceName);
      const bytes = new Uint8Array(vocalsBuffer.byteLength);
      bytes.set(vocalsBuffer);
      form.append("files", new Blob([bytes], { type: "audio/wav" }), "vocals.wav");
      form.append("remove_background_noise", "true");
      form.append(
        "description",
        `Locked voice for ${vault.artist_name}, cloned from isolated song vocals (Bow Down Visuals artist vault)`,
      );
      const r = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        req.log.error({ status: r.status, errText }, "artist-voices: from-song IVC failed");
        await refund();
        res.status(502).json({
          error: "Voice cloning failed on the isolated vocals. Try a song with clearer vocals.",
          code: "clone_failed",
        });
        return;
      }
      const data = (await r.json()) as { voice_id: string; requires_verification?: boolean };

      let previewUrl: string | null = null;
      try {
        const vr = await fetch(`https://api.elevenlabs.io/v1/voices/${data.voice_id}`, {
          headers: { "xi-api-key": apiKey },
        });
        if (vr.ok) previewUrl = ((await vr.json()) as { preview_url?: string | null }).preview_url ?? null;
      } catch {
        /* non-fatal */
      }

      await db
        .update(artistVaultsTable)
        .set({
          voice_id: data.voice_id,
          voice_name: voiceName,
          voice_preview_url: previewUrl,
          updated_at: new Date(),
        })
        .where(and(eq(artistVaultsTable.id, vault.id), eq(artistVaultsTable.user_id, req.userId!)));

      recordCreditUsage({
        userId: req.userId!,
        action: "Voice From Song",
        creditsUsed: isDev ? 0 : FROM_SONG_CREDIT_COST,
      }).catch(() => {});

      res.json({
        voice_id: data.voice_id,
        voice_name: voiceName,
        voice_preview_url: previewUrl,
        vocals_preview_url: vocalsPreviewUrl,
        requires_verification: data.requires_verification ?? false,
        creditsAfter: isDev ? currentCredits : currentCredits - FROM_SONG_CREDIT_COST,
      });
    } catch (err: any) {
      req.log.error({ err }, "artist-voices: from-song error");
      await refund();
      res.status(err?.status ?? 500).json({
        error: err?.message ?? "Could not build a voice from this song. Please try again.",
      });
    }
  },
);

export default router;
