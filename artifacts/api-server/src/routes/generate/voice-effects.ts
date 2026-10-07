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

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Voice effects (CapCut parity) ───
   Applies fun voice transformations: chipmunk, deep, robot, echo, etc.
   Uses ffmpeg audio filters. 100 Visual Bucs per transformation. */

const VOICE_FX_COST = Number(process.env["VOICE_FX_CREDITS"]) || 100;

const VOICE_EFFECTS = {
  chipmunk: {
    label: "Chipmunk",
    blurb: "High-pitched and squeaky",
    filter: "asetrate=44100*1.5,aresample=44100,atempo=0.6667",
  },
  deep: {
    label: "Deep Voice",
    blurb: "Low and commanding",
    filter: "asetrate=44100*0.7,aresample=44100,atempo=1.4286",
  },
  robot: {
    label: "Robot",
    blurb: "Metallic and mechanical",
    filter: "afftdn=nf=-20,aresample=44100,aecho=0.8:0.88:60:0.4",
  },
  echo: {
    label: "Echo",
    blurb: "Spacious cavern echo",
    filter: "aecho=0.8:0.9:1000:0.3",
  },
  radio: {
    label: "Radio",
    blurb: "Vintage radio effect",
    filter: "highpass=f=500,lowpass=f=3000,acompressor",
  },
  underwater: {
    label: "Underwater",
    blurb: "Muffled and submerged",
    filter: "lowpass=f=800,aresample=44100,aecho=0.8:0.9:200:0.5",
  },
  monster: {
    label: "Monster",
    blurb: "Deep growling beast",
    filter: "asetrate=44100*0.5,aresample=44100,atempo=2.0,acompressor,rubberband=pitch=0.5",
  },
  alien: {
    label: "Alien",
    blurb: "Otherworldly warble",
    filter: "vibrato=f=8:d=0.5,asetrate=44100*1.2,aresample=44100",
  },
  telephone: {
    label: "Telephone",
    blurb: "Classic phone call",
    filter: "highpass=f=300,lowpass=f=3400",
  },
  cathedral: {
    label: "Cathedral",
    blurb: "Massive reverb hall",
    filter: "aecho=0.8:0.9:500:0.5,aecho=0.8:0.9:1000:0.3",
  },
  whisper: {
    label: "Whisper",
    blurb: "Soft and intimate",
    filter: "volume=0.6,highpass=f=1000,acompressor",
  },
} as const;

type VoiceEffectKey = keyof typeof VOICE_EFFECTS;

const voiceFxSchema = z.object({
  audioUrl: z.string().trim().min(1).max(2048),
  effect: z.string().refine((v): v is VoiceEffectKey => v in VOICE_EFFECTS, {
    message: `Effect must be one of: ${Object.keys(VOICE_EFFECTS).join(", ")}`,
  }),
});

router.get("/voice-effects", requireAuth, (_req, res) => {
  res.json({
    effects: Object.entries(VOICE_EFFECTS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

router.post("/voice-effect", requireAuth, async (req, res) => {
  const parsed = voiceFxSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < VOICE_FX_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, VOICE_FX_COST, {
      action: `Voice Effect (${parsed.data.effect})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "voice-fx-"));
  const inputPath = join(workDir, "input.mp3");
  const outputPath = join(workDir, "output.mp3");

  try {
    const audioRes = await fetch(parsed.data.audioUrl, { signal: AbortSignal.timeout(60_000) });
    if (!audioRes.ok) throw new Error("Could not download the audio.");
    await writeFile(inputPath, Buffer.from(await audioRes.arrayBuffer()));

    const effect = VOICE_EFFECTS[parsed.data.effect];
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-af", effect.filter,
      "-c:a", "libmp3lame", "-b:a", "192k",
      outputPath,
    ], { timeout: 120_000 });

    const buffer = await readFile(outputPath);
    const objectName = `voice-fx/${req.userId}/${randomUUID()}.mp3`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      effect: parsed.data.effect,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Voice effect failed.";
    req.log.error({ err: message }, "[voice-effect] failed");
    await refundCredits(req.userId!, VOICE_FX_COST, {
      action: "Voice Effect — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
