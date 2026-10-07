import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { db } from "@workspace/db";
import { voiceClonesTable } from "../../../../../lib/db/src/schema/voice-clones";
import { eq, and } from "drizzle-orm";
import { canUseInstantVoiceCloning } from "../../lib/elevenlabs";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI voice cloning ───
   Create a custom voice profile from a 10s+ audio sample, then speak any
   text in that voice.
   - ElevenLabs instant voice cloning when ELEVENLABS_API_KEY is set and the
     account allows it (POST /v1/voices/add).
   - Fallback: OpenAI TTS with a chosen base voice + stored sample analysis
     (best-effort voice matching, not true cloning).
   500 Visual Bucs to clone, 150 per speak-as generation. */

const CLONE_COST = Number(process.env["VOICE_CLONE_CREDITS"]) || 500;
const SPEAK_COST = Number(process.env["VOICE_CLONE_SPEAK_CREDITS"]) || 150;
const MIN_SAMPLE_SEC = 10;

const BASE_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

const cloneSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().default(""),
  sampleUrl: z.string().trim().min(1).max(2048),
  /** Base voice for the OpenAI fallback path. */
  baseVoice: z.enum(BASE_VOICES).optional().default("alloy"),
});

const speakSchema = z.object({
  voiceId: z.string().uuid(),
  text: z.string().trim().min(1).max(2000),
});

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

async function probeAudioDurationSec(path: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
    { timeout: 30_000 },
  );
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

/** Basic sample analysis stored for voice-matching (rms level). */
async function analyzeSample(path: string): Promise<Record<string, unknown>> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-i", path, "-af", "astats=metadata=1:reset=1", "-f", "null", "-"],
      { timeout: 60_000 },
    );
    const rms = /RMS level dB:\s*(-?\d+(?:\.\d+)?)/.exec(stderr)?.[1];
    return { rmsDb: rms ? parseFloat(rms) : null };
  } catch {
    return {};
  }
}

/** List the user's cloned voices. */
router.get("/cloned-voices", requireAuth, async (req, res) => {
  try {
    const voices = await db
      .select()
      .from(voiceClonesTable)
      .where(eq(voiceClonesTable.userId, req.userId!));
    res.json({
      voices: voices.map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        source: v.source,
        baseVoice: v.baseVoice,
        createdAt: v.createdAt,
      })),
      elevenlabsAvailable: !!elevenKey(),
    });
  } catch (err) {
    req.log.error({ err }, "[voice-clone] list failed");
    res.status(500).json({ error: "Could not load cloned voices." });
  }
});

/** Clone a voice from a 10s+ sample. */
router.post("/clone-voice", requireAuth, async (req, res) => {
  const parsed = cloneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CLONE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CLONE_COST, { action: "Voice Clone" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const fail = async (status: number, message: string) => {
    await refundCredits(req.userId!, CLONE_COST, { action: "Voice Clone — Refund" }).catch(() => {});
    res.status(status).json({ error: message });
  };

  const workDir = await mkdtemp(join(tmpdir(), "voice-clone-"));
  const samplePath = join(workDir, "sample");
  try {
    const dl = await fetch(parsed.data.sampleUrl, { signal: AbortSignal.timeout(120_000) });
    if (!dl.ok) throw new Error("Could not download the sample audio.");
    await writeFile(samplePath, Buffer.from(await dl.arrayBuffer()));

    const duration = await probeAudioDurationSec(samplePath);
    if (duration < MIN_SAMPLE_SEC) {
      await fail(400, `Sample is too short (${duration.toFixed(1)}s). Please use at least ${MIN_SAMPLE_SEC} seconds of clear speech.`);
      return;
    }
    const analysis = { ...(await analyzeSample(samplePath)), durationSec: Math.round(duration * 10) / 10 };

    // Keep a copy of the sample in storage for re-clone/debug.
    const sampleBuffer = await readFile(samplePath);
    const sampleRef = await uploadMediaToSupabaseStorage(
      `voice-clones/${req.userId}/${randomUUID()}-sample.mp3`,
      sampleBuffer,
      "audio/mpeg",
    );

    const apiKey = elevenKey();
    let elevenlabsVoiceId: string | null = null;
    let source: "elevenlabs" | "openai-match" = "openai-match";

    if (apiKey && (await canUseInstantVoiceCloning(apiKey))) {
      // ElevenLabs instant voice cloning: POST /v1/voices/add (multipart)
      const form = new FormData();
      form.append("name", `bdv-${req.userId!.slice(0, 8)}-${parsed.data.name}`.slice(0, 100));
      if (parsed.data.description) form.append("description", parsed.data.description.slice(0, 500));
      form.append("files", new Blob([sampleBuffer], { type: "audio/mpeg" }), "sample.mp3");
      const elRes = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(180_000),
      });
      if (!elRes.ok) {
        const body = await elRes.text().catch(() => "");
        req.log.warn({ status: elRes.status, body: body.slice(0, 300) }, "[voice-clone] elevenlabs add failed, using fallback");
      } else {
        const data = (await elRes.json()) as { voice_id?: string };
        if (data.voice_id) {
          elevenlabsVoiceId = data.voice_id;
          source = "elevenlabs";
        }
      }
    } else {
      req.log.info("[voice-clone] elevenlabs unavailable, using openai-match fallback");
    }

    const [voice] = await db
      .insert(voiceClonesTable)
      .values({
        userId: req.userId!,
        name: parsed.data.name,
        description: parsed.data.description || null,
        elevenlabsVoiceId,
        sampleRef,
        source,
        baseVoice: parsed.data.baseVoice,
        analysis,
      })
      .returning();

    res.json({
      voice: {
        id: voice!.id,
        name: voice!.name,
        description: voice!.description,
        source,
        baseVoice: voice!.baseVoice,
        createdAt: voice!.createdAt,
      },
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice cloning failed.";
    req.log.error({ err: message }, "[voice-clone] failed");
    await fail(500, message);
  } finally {
    await unlink(samplePath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

/** Speak text in a cloned voice. */
router.post("/speak-as", requireAuth, async (req, res) => {
  const parsed = speakSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const rows = await db
    .select()
    .from(voiceClonesTable)
    .where(and(eq(voiceClonesTable.id, parsed.data.voiceId), eq(voiceClonesTable.userId, req.userId!)));
  const voice = rows[0];
  if (!voice) {
    res.status(404).json({ error: "Voice not found." });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SPEAK_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SPEAK_COST, { action: `Speak As (${voice.name})` });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const fail = async (status: number, message: string) => {
    await refundCredits(req.userId!, SPEAK_COST, { action: "Speak As — Refund" }).catch(() => {});
    res.status(status).json({ error: message });
  };

  try {
    let audioBuffer: Buffer;
    const apiKey = elevenKey();

    if (voice.elevenlabsVoiceId && apiKey) {
      const elRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice.elevenlabsVoiceId}`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: parsed.data.text,
            model_id: process.env["ELEVENLABS_TTS_MODEL"] || "eleven_multilingual_v2",
          }),
          signal: AbortSignal.timeout(180_000),
        },
      );
      if (!elRes.ok) throw new Error(`Voice synthesis failed (${elRes.status}).`);
      audioBuffer = Buffer.from(await elRes.arrayBuffer());
    } else {
      // Fallback: OpenAI TTS with the profile's base voice (best-effort match).
      const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: parsed.data.text,
          voice: voice.baseVoice || "alloy",
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!ttsRes.ok) throw new Error("Voice synthesis failed.");
      audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
    }

    const objectName = `voice-clone-speech/${req.userId}/${randomUUID()}.mp3`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, audioBuffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({ url, storageRef, voiceId: voice.id, source: voice.source, creditsRemaining: creditsAfter });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speech generation failed.";
    req.log.error({ err: message }, "[voice-clone] speak-as failed");
    await fail(500, message);
  }
});

/** Delete a cloned voice (owner only). */
router.delete("/clone-voice/:id", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(voiceClonesTable)
      .where(and(eq(voiceClonesTable.id, req.params.id as string), eq(voiceClonesTable.userId, req.userId!)));
    const voice = rows[0];
    if (!voice) {
      res.status(404).json({ error: "Voice not found." });
      return;
    }

    // Best-effort cleanup of the ElevenLabs voice.
    const apiKey = elevenKey();
    if (voice.elevenlabsVoiceId && apiKey) {
      await fetch(`https://api.elevenlabs.io/v1/voices/${voice.elevenlabsVoiceId}`, {
        method: "DELETE",
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => {});
    }

    await db
      .delete(voiceClonesTable)
      .where(and(eq(voiceClonesTable.id, voice.id), eq(voiceClonesTable.userId, req.userId!)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "[voice-clone] delete failed");
    res.status(500).json({ error: "Could not delete voice." });
  }
});

export default router;
