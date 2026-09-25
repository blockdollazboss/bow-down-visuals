/**
 * artist-voices.ts — lock an ElevenLabs voice into an artist vault.
 *
 *  GET    /api/voices                            list account voices (picker)
 *  POST   /api/artist-vaults/:id/voice/clone      clone from uploaded sample(s)
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
import { db, artistVaultsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";

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

export default router;
