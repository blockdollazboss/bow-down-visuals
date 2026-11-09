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
import { randomUUID, createHash } from "crypto";
import { promises as fs } from "node:fs";
import { db, artistVaultsTable, songsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { freeExpensiveAiLimiter } from "../lib/rate-limit";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../lib/generation-stored-results";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
  parseSupabaseStorageRefBucketed,
  downloadStorageObjectBuffer,
} from "../lib/objectStorage";
import { separateVocalStems, cleanupWorkdir } from "../lib/stem-separation";
import { canUseInstantVoiceCloning } from "../lib/elevenlabs";

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

/* ── POST /api/artist-vaults/:id/voice/clone — instant voice clone ────
   Costs 200 Visual Bucs — the same price as its sibling
   .../voice/from-song (owner's 2026-10-14 ruling: the plain clone had
   silently been free while the harder from-song job charged). The
   charge flow mirrors from-song exactly: IVC eligibility before any
   credits move, the same 402 shape, chargeCredits with the same
   LedgerWriteError handling, and a refund closure that is only armed
   after the charge lands and fires on every failure exit. */
const CLONE_CREDIT_COST = 200;

router.post(
  "/artist-vaults/:id/voice/clone",
  requireAuth,
  freeExpensiveAiLimiter,
  upload.array("files", 3),
  async (req, res) => {
    const apiKey = elevenKey();
    if (!apiKey) {
      res.status(503).json({ error: "Voice service is not configured on this server." });
      return;
    }

    // IVC eligibility BEFORE any credits move or any heavy work (same
    // gate as from-song). Fail open: if the check itself errors,
    // proceed as before.
    const ivcAllowed = await canUseInstantVoiceCloning(apiKey).catch(() => true);
    if (!ivcAllowed) {
      res.status(402).json({
        error:
          "Your ElevenLabs plan does not include instant voice cloning. Upgrade your ElevenLabs plan to use voice cloning.",
        code: "ivc_not_included",
      });
      return;
    }

    const files = (req.files ?? []) as Express.Multer.File[];
    if (files.length === 0) {
      res.status(400).json({ error: "Upload at least one voice sample.", code: "no_files" });
      return;
    }

    // Everything below returns JSON: the vault lookup and credit
    // deduction live inside the try so a throw can never escape to
    // Express's default HTML error handler (mirrors from-song).
    let refund: () => PromiseLike<void> = () => Promise.resolve();
    try {
      const vault = await getOwnedVault(req.params.id as string, req.userId!);
      if (!vault) {
        res.status(404).json({ error: "Artist not found." });
        return;
      }

      const currentCredits = req.userCredits ?? 0;
      const isDev = process.env["NODE_ENV"] === "development";
      if (!isDev && currentCredits < CLONE_CREDIT_COST) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of Visual Bucs. Upgrade to keep creating.",
          required: CLONE_CREDIT_COST,
        });
        return;
      }
      // chargeCredits(): deduct + strict ledger write. A ledger failure
      // rolls the deduction back and throws LedgerWriteError (loud).
      // The idempotency key is stable per (user, endpoint, intent) —
      // the intent is the vault plus the sample bytes — so a double-tap
      // or retry of the same clone can't double-charge.
      if (!isDev) {
        try {
          const idempotencyKey = buildChargeIdempotencyKey(
            "vault-voice-clone",
            req.userId!,
            (req.body as { idempotencyKey?: unknown } | undefined)?.idempotencyKey,
            {
              vaultId: vault.id,
              files: files.map((f) => createHash("sha256").update(f.buffer).digest("hex")),
            },
          );
          await chargeCredits(req.userId!, CLONE_CREDIT_COST, { action: "Vault Voice Clone" }, { idempotencyKey });
        } catch (chargeErr) {
          if (chargeErr instanceof LedgerWriteError) {
            res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
            return;
          }
          if (chargeErr instanceof OutOfCreditsError) {
            res.status(402).json({
              error: "out_of_credits",
              message: "You are out of Visual Bucs. Upgrade to keep creating.",
              required: CLONE_CREDIT_COST,
            });
            return;
          }
          throw chargeErr;
        }
      }

      // Refund with a ledger trace if the clone fails (armed only now
      // that the charge has landed — mirroring from-song).
      refund = () =>
        !isDev
          ? refundCredits(req.userId!, CLONE_CREDIT_COST, { action: "Vault Voice Clone — Refund (clone failure)" })
          : Promise.resolve();

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
        await refund();
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
        creditsAfter: isDev ? currentCredits : currentCredits - CLONE_CREDIT_COST,
      });
    } catch (err) {
      req.log.error({ err }, "artist-voices: clone error");
      await refund();
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
   Costs 2 site credits (Demucs isolation + clone); refunded on failure.
   Before any credits move or any heavy work, the handler checks the
   ElevenLabs subscription for instant-voice-cloning eligibility: a plan
   without it can never succeed here, and Demucs on a full song can OOM a
   small container (2026-09-25 incident). The check fails open.
   Isolation uses a lighter Demucs model (FROM_SONG_DEMUCS_MODEL, default
   htdemucs) — the vocals only need to be intelligible IVC input.
   Before Demucs runs, the song is trimmed to its loudest
   FROM_SONG_TRIM_SECONDS-second window (default 90): ElevenLabs IVC only
   needs ~30s of clean vocals, and Demucs on a full-length song timed out
   after 10 min on the 2GB Render box (2026-09-25 incident). */
const FROM_SONG_CREDIT_COST = 200;
const FROM_SONG_DEMUCS_MODEL = process.env["FROM_SONG_DEMUCS_MODEL"] ?? "htdemucs";

/* Replay safety (CA-7): the from-song charge keys on a server-derived
   idempotency key over the request intent (vault + song reference +
   uploaded-file hash), derived BEFORE the charge and before the song
   is even loaded — so a re-ask of the same request (double-tap,
   retry, timeout resend) is answered from the stored result instead
   of re-charging, re-uploading vocals, or re-cloning. Every refund
   path VOIDS the key (see the refund closure in the handler), so a
   refunded request always runs fresh on retry. Dev mode (no charge)
   skips keying entirely. Fresh responses are byte-identical to
   before; stored lookups fail open. The :170 clone charge in this
   file is keyed already and untouched. */
const FROM_SONG_SCOPE = "artist-voice-from-song";
const FROM_SONG_REPLAY_NOTE =
  "This is the voice you already built from this song — pick a different song for a fresh clone.";
const REPLAY_STORE_MAX = 500;
const storedFromSongResults = new Map<string, Record<string, unknown>>();
const inFlightFromSong = new Map<string, Promise<Record<string, unknown>>>();

function storeFromSongInProcess(key: string, body: Record<string, unknown>): void {
  if (storedFromSongResults.size >= REPLAY_STORE_MAX) {
    const first = storedFromSongResults.keys().next().value;
    if (first !== undefined) storedFromSongResults.delete(first);
  }
  storedFromSongResults.set(key, body);
}

export function __resetFromSongReplayCache(): void {
  storedFromSongResults.clear();
  inFlightFromSong.clear();
}

/**
 * Env override for the pre-Demucs window selection strategy: "vocal"
 * (default — picks the 90s with the most vocal activity, best for IVC)
 * or "loudest" (legacy — picks the highest-loudness 90s). Exported for tests.
 */
export function resolveFromSongWindowStrategy(
  env: NodeJS.ProcessEnv = process.env,
): "vocal" | "loudest" {
  return env["FROM_SONG_WINDOW_STRATEGY"] === "loudest" ? "loudest" : "vocal";
}
const FROM_SONG_WINDOW_STRATEGY = resolveFromSongWindowStrategy();

/**
 * Env override for the pre-Demucs trim window (seconds). Exported for tests.
 * Falls back to 90 on missing/invalid values — an invalid trim must never
 * silently disable the protection against full-song Demucs runs.
 */
export function resolveFromSongTrimSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env["FROM_SONG_TRIM_SECONDS"] ?? 90);
  return Number.isFinite(v) && v > 0 ? v : 90;
}
const FROM_SONG_TRIM_SECONDS = resolveFromSongTrimSeconds();

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
        // R2-first dual-stack read — a direct Supabase download bills
        // egress even when the object already lives in R2 (and 404s
        // for R2-only objects). Null = in neither store; the stored
        // URL fetch below stays as the fallback.
        const buf = await downloadStorageObjectBuffer(parsed);
        if (buf) {
          return { buffer: buf, label: song.title };
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

    // IVC eligibility BEFORE any credits move or any heavy work. Fail open:
    // if the check itself errors, proceed as before.
    const ivcAllowed = await canUseInstantVoiceCloning(apiKey).catch(() => true);
    if (!ivcAllowed) {
      res.status(402).json({
        error:
          "Your ElevenLabs plan does not include instant voice cloning. Upgrade your ElevenLabs plan to use song-based voice cloning.",
        code: "ivc_not_included",
      });
      return;
    }

    // Everything below returns JSON: the vault lookup and credit deduction
    // live inside the try so a throw can never escape to Express's default
    // HTML error handler (which is what produced the generic UI message in
    // the 2026-09-25 OOM incident).
    let refund: () => PromiseLike<void> = () => Promise.resolve();
    try {
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
          message: "You are out of Visual Bucs. Upgrade to keep creating.",
          required: FROM_SONG_CREDIT_COST,
        });
        return;
      }

      /* Replay safety (CA-7): derive the key from the request intent
         BEFORE the charge and before the song is loaded, and answer a
         re-ask from the stored result — no second charge, no second
         vocals upload, no second clone. */
      const uploadFile = (req as any).file as Express.Multer.File | undefined;
      const fromSongBody = req.body as { songId?: string; songUrl?: string };
      let fromSongKey: string | null = null;
      if (!isDev) {
        fromSongKey = buildChargeIdempotencyKey(FROM_SONG_SCOPE, req.userId!, undefined, {
          vaultId: vault.id,
          songId: fromSongBody.songId ?? null,
          songUrl: fromSongBody.songUrl ?? null,
          fileHash: uploadFile?.buffer?.length
            ? createHash("sha256").update(uploadFile.buffer).digest("hex")
            : null,
        });
        const durable = await findStoredGenerationResult(FROM_SONG_SCOPE, fromSongKey, req.userId!);
        if (durable) {
          res.json({ ...durable, replayed: true, replayNote: FROM_SONG_REPLAY_NOTE });
          return;
        }
        const local = storedFromSongResults.get(fromSongKey);
        if (local) {
          res.json({ ...local, replayed: true, replayNote: FROM_SONG_REPLAY_NOTE });
          return;
        }
        const pending = inFlightFromSong.get(fromSongKey);
        if (pending) {
          try {
            const twinBody = await pending;
            const stored = storedFromSongResults.get(fromSongKey) ?? twinBody;
            res.json({ ...stored, replayed: true, replayNote: FROM_SONG_REPLAY_NOTE });
            return;
          } catch {
            /* The twin failed and refunded (voiding the key) — run fresh. */
          }
        }
      }

      // chargeCredits(): deduct + strict ledger write. A ledger failure rolls
      // the deduction back and throws LedgerWriteError (loud) — the 2-credit
      // loss this route is known for can never be untraceable again.
      if (!isDev) {
        try {
          await chargeCredits(req.userId!, FROM_SONG_CREDIT_COST, { action: "Voice From Song" }, { idempotencyKey: fromSongKey ?? undefined });
        } catch (chargeErr) {
          if (chargeErr instanceof LedgerWriteError) {
            res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
            return;
          }
          throw chargeErr;
        }
      }

      /* Register the in-flight run so a same-key twin waits for this
         result instead of starting its own isolation + clone. */
      let resolveFromSongFlight: (body: Record<string, unknown>) => void = () => {};
      let rejectFromSongFlight: (err: unknown) => void = () => {};
      let fromSongFlight: Promise<Record<string, unknown>> | null = null;
      if (fromSongKey) {
        fromSongFlight = new Promise<Record<string, unknown>>((resolve, reject) => {
          resolveFromSongFlight = resolve;
          rejectFromSongFlight = reject;
        });
        fromSongFlight.catch(() => {});
        inFlightFromSong.set(fromSongKey, fromSongFlight);
      }
      const failFromSongFlight = (err: unknown) => {
        if (fromSongKey && fromSongFlight) {
          rejectFromSongFlight(err);
          if (inFlightFromSong.get(fromSongKey) === fromSongFlight) inFlightFromSong.delete(fromSongKey);
        }
      };

      // Refund with a ledger trace if isolation fails (the failure mode that
      // lost 2 credits without a trace before this fix). The key is
      // voided whenever the refund runs, so a retry charges fresh.
      refund = () => {
        failFromSongFlight(new Error("voice from song failed"));
        return !isDev
          ? refundCredits(req.userId!, FROM_SONG_CREDIT_COST, { action: "Voice From Song — Refund (isolation failure)" })
              .then(async () => {
                if (fromSongKey) await voidChargeIdempotencyKey(fromSongKey);
              })
          : Promise.resolve();
      };

      const file = uploadFile;
      const { buffer: songBuffer, label } = await loadSongBuffer(
        file,
        req.body as { songId?: string; songUrl?: string },
        req.userId!,
      );
      req.log.info({ vaultId: vault.id, label }, "artist-voices: from-song isolation started");

      /* 1 — Trim to the best window, then strip it down to its vocals
         (lighter model: this runs inside a web request on a small
         container). */
      const { vocalsPath, workdir } = await separateVocalStems(songBuffer, {
        model: FROM_SONG_DEMUCS_MODEL,
        trimSeconds: FROM_SONG_TRIM_SECONDS,
        windowStrategy: FROM_SONG_WINDOW_STRATEGY,
        // Normalize + de-bleed + silence-trim for IVC: ElevenLabs rejects
        // raw htdemucs output with heavy instrumental bleed (2026-09-25).
        postProcessVocals: true,
      });
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

        // The ledger entry was written atomically by chargeCredits() above.
      const successBody: Record<string, unknown> = {
        voice_id: data.voice_id,
        voice_name: voiceName,
        voice_preview_url: previewUrl,
        vocals_preview_url: vocalsPreviewUrl,
        requires_verification: data.requires_verification ?? false,
        creditsAfter: isDev ? currentCredits : currentCredits - FROM_SONG_CREDIT_COST,
      };
      if (fromSongKey && fromSongFlight) {
        storeFromSongInProcess(fromSongKey, successBody);
        await storeGenerationResult(FROM_SONG_SCOPE, fromSongKey, req.userId!, successBody);
        resolveFromSongFlight(successBody);
        if (inFlightFromSong.get(fromSongKey) === fromSongFlight) inFlightFromSong.delete(fromSongKey);
        const storedBody = storedFromSongResults.get(fromSongKey);
        if (storedBody && storedBody !== successBody) {
          res.json({ ...storedBody, replayed: true, replayNote: FROM_SONG_REPLAY_NOTE });
          return;
        }
      }
      res.json(successBody);
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
