import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { db, artistVaultsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Producer Tag Maker ───────────────────────────────────────────────
   Every producer needs a signature tag ("Prod. by Cheat Code", "It's the
   Shark!"). Text -> TTS (OpenAI voices, or the user's cloned Artist Vault
   voice via ElevenLabs) -> ffmpeg effects chain (pitch shift, echo,
   reverse-reverb tail, distortion) -> MP3/WAV download.
   100 Visual Bucs per tag (PRODUCER_TAG_CREDITS override). */

const PRODUCER_TAG_COST = Number(process.env["PRODUCER_TAG_CREDITS"]) || 100;

const OPENAI_VOICES = [
  { id: "alloy", label: "Alloy", blurb: "Neutral and balanced" },
  { id: "echo", label: "Echo", blurb: "Warm and resonant" },
  { id: "fable", label: "Fable", blurb: "Expressive storyteller" },
  { id: "onyx", label: "Onyx", blurb: "Deep and commanding" },
  { id: "nova", label: "Nova", blurb: "Bright and energetic" },
  { id: "shimmer", label: "Shimmer", blurb: "Soft and clear" },
] as const;

const voiceIds = OPENAI_VOICES.map((v) => v.id) as unknown as [string, ...string[]];

const PRESETS = ["dark", "hype", "chipmunk", "radio", "epic"] as const;

const producerTagSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Tag text is required.")
    .max(120, "Tag text must be 120 characters or less."),
  /** OpenAI voice id, or "vault" to use the user's cloned Artist Vault voice. */
  voice: z.union([z.enum(voiceIds), z.literal("vault")]).optional().default("alloy"),
  /** Optional vault id when voice === "vault"; otherwise the first vault with a cloned voice wins. */
  vaultId: z.string().uuid().optional(),
  preset: z.enum(PRESETS).optional().default("dark"),
  format: z.enum(["mp3", "wav"]).optional().default("mp3"),
});

/* ── Voice backends ─────────────────────────────────────────────────── */

async function openAiTts(text: string, voice: string, outPath: string): Promise<void> {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Tag voice generation failed (${response.status}). ${body.slice(0, 200)}`);
  }
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

async function elevenLabsTts(text: string, voiceId: string, outPath: string): Promise<void> {
  const model = process.env["ELEVENLABS_TTS_MODEL"] || "eleven_v4";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY!,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      model_id: model,
      text,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Cloned-voice tag generation failed (${response.status}). ${body.slice(0, 200)}`);
  }
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

/* ── ffmpeg effects chain ─────────────────────────────────────────────
   Pitch shift uses the tempo-preserving resample trick
   (asetrate -> aresample -> atempo), same as voiceover-pro. */

function pitchChain(semitones: number): string {
  if (semitones === 0) return "";
  const factor = Math.pow(2, semitones / 12);
  return `asetrate=44100*${factor.toFixed(6)},aresample=44100,atempo=${(1 / factor).toFixed(6)},`;
}

/** Single-pass filter chain per preset. "epic" is two-pass (see applyEpic). */
function presetFilter(preset: (typeof PRESETS)[number]): string {
  switch (preset) {
    case "dark":
      // Dropped, menacing tag: pitch down, dark echo, gentle glue.
      return (
        pitchChain(-4) +
        "lowpass=f=7000,aecho=0.8:0.9:45:0.35,acompressor=threshold=-20dB:ratio=3,alimiter=limit=0.95"
      );
    case "hype":
      // Loud hype-man energy: pitch up, slapback echo, punchy compression.
      return (
        pitchChain(2) +
        "aecho=0.75:0.6:30:0.3,acompressor=threshold=-16dB:ratio=4:attack=8:release=120,alimiter=limit=0.95"
      );
    case "chipmunk":
      // Squeaky viral tag: heavy pitch-up, no mud.
      return pitchChain(7) + "highpass=f=200,alimiter=limit=0.95";
    case "radio":
      // Megaphone / radio voice: band-limited, crushed, tiny room slap.
      return (
        "highpass=f=400,lowpass=f=3200,acompressor=threshold=-18dB:ratio=6:attack=5:release=80," +
        "acrusher=level_in=6:level_out=6:bits=12:mode=log,aecho=0.6:0.4:15:0.15,alimiter=limit=0.95"
      );
    case "epic":
      // Handled by applyEpic (reverse-reverb tail needs two passes).
      return "";
  }
}

async function encodeOutput(
  inputPath: string,
  filter: string,
  format: "mp3" | "wav",
  outPath: string,
): Promise<void> {
  const codecArgs =
    format === "mp3"
      ? ["-c:a", "libmp3lame", "-b:a", "192k"]
      : ["-c:a", "pcm_s16le"];
  await execFileAsync(
    "ffmpeg",
    ["-y", "-i", inputPath, "-af", filter, "-ar", "44100", "-ac", "2", ...codecArgs, outPath],
    { timeout: 120_000 },
  );
}

/** Epic: pitch-down dry tag + reverse-reverb swell mixed underneath. */
async function applyEpic(inputPath: string, workDir: string, format: "mp3" | "wav", outPath: string): Promise<void> {
  const dryPath = join(workDir, "epic-dry.mp3");
  const tailPath = join(workDir, "epic-tail.mp3");
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-i", inputPath,
      "-af", `${pitchChain(-2)}aresample=44100,alimiter=limit=0.95`,
      "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", dryPath,
    ],
    { timeout: 120_000 },
  );
  // Reverse the dry tag, wash it in echo, reverse back -> reverb that swells
  // INTO the tag instead of trailing off.
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-i", dryPath,
      "-af", "areverse,aecho=0.8:0.85:150|250:0.5|0.35,areverse,volume=0.55",
      "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "192k", tailPath,
    ],
    { timeout: 120_000 },
  );
  const codecArgs =
    format === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-c:a", "pcm_s16le"];
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-i", dryPath, "-i", tailPath,
      "-filter_complex",
      "[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=0,acompressor=threshold=-18dB:ratio=3,alimiter=limit=0.95[a]",
      "-map", "[a]", "-ar", "44100", "-ac", "2", ...codecArgs, outPath,
    ],
    { timeout: 120_000 },
  );
}

/* ── Vault voice lookup ─────────────────────────────────────────────── */

async function findVaultVoice(userId: string, vaultId?: string) {
  const conditions = [
    eq(artistVaultsTable.user_id, userId),
    isNull(artistVaultsTable.deleted_at),
    isNotNull(artistVaultsTable.voice_id),
    ...(vaultId ? [eq(artistVaultsTable.id, vaultId)] : []),
  ];
  const [vault] = await db
    .select()
    .from(artistVaultsTable)
    .where(and(...conditions))
    .orderBy(desc(artistVaultsTable.created_at))
    .limit(1);
  return vault ?? null;
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/** Which cloned voices this user can pick for their tag. */
router.get("/producer-tag/vault-voice", requireAuth, async (req, res) => {
  try {
    const vault = await findVaultVoice(req.userId!);
    if (!vault) {
      res.json({ available: false });
      return;
    }
    res.json({
      available: true,
      vaultId: vault.id,
      vaultName: vault.artist_name,
      voiceName: vault.voice_name ?? "My cloned voice",
    });
  } catch (err) {
    req.log.error({ err }, "[producer-tag] vault-voice lookup failed");
    res.status(500).json({ error: "Could not check your vault voice." });
  }
});

router.post("/producer-tag", requireAuth, async (req, res) => {
  const parsed = producerTagSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { text, voice, vaultId, preset, format } = parsed.data;
  const useVaultVoice = voice === "vault";

  /* Resolve the voice backend BEFORE charging — config problems fail
     cleanly without touching the user's balance. */
  let vaultVoice: { voiceId: string; voiceName: string } | null = null;
  if (useVaultVoice) {
    if (!process.env.ELEVENLABS_API_KEY) {
      res.status(503).json({
        error: "Cloned-voice tags are not available right now.",
        detail: "Missing ELEVENLABS_API_KEY on the server.",
      });
      return;
    }
    const vault = await findVaultVoice(req.userId!, vaultId).catch(() => null);
    if (!vault?.voice_id) {
      res.status(404).json({
        error: "No cloned voice found in your Artist Vault.",
        detail: "Clone a voice in the Artist Vault first, then pick \"My cloned voice\".",
      });
      return;
    }
    vaultVoice = { voiceId: vault.voice_id, voiceName: vault.voice_name ?? "My cloned voice" };
  } else if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({
      error: "Producer Tag voice service is not configured.",
      detail: "Missing OPENAI_API_KEY on the server.",
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < PRODUCER_TAG_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, PRODUCER_TAG_COST, {
      action: "Producer Tag",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "producer-tag-"));
  const { rm } = await import("fs/promises");

  try {
    req.log.info({ preset, voice: useVaultVoice ? "vault" : voice, format }, "[producer-tag] generating");

    // 1) TTS the raw tag
    const rawPath = join(workDir, "raw.mp3");
    if (vaultVoice) {
      await elevenLabsTts(text, vaultVoice.voiceId, rawPath);
    } else {
      await openAiTts(text, voice, rawPath);
    }

    // 2) Effects chain
    const ext = format === "wav" ? "wav" : "mp3";
    const outputPath = join(workDir, `tag.${ext}`);
    if (preset === "epic") {
      await applyEpic(rawPath, workDir, format, outputPath);
    } else {
      await encodeOutput(rawPath, presetFilter(preset), format, outputPath);
    }

    // 3) Store + serve
    const buffer = await readFile(outputPath);
    const objectName = `producer-tags/${req.userId}/${randomUUID()}.${ext}`;
    const storageRef = await uploadMediaToSupabaseStorage(
      objectName,
      buffer,
      format === "wav" ? "audio/wav" : "audio/mpeg",
    );
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      text,
      voice: useVaultVoice ? "vault" : voice,
      voiceName: vaultVoice?.voiceName ?? OPENAI_VOICES.find((v) => v.id === voice)?.label ?? voice,
      preset,
      format,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Producer tag generation failed.";
    req.log.error({ err: message }, "[producer-tag] failed");
    await refundCredits(req.userId!, PRODUCER_TAG_COST, {
      action: "Producer Tag — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
