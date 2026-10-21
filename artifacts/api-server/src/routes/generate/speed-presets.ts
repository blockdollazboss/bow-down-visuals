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

/* ─── Video speed controller ───
   Applies constant speeds (0.25x–4x) or animated speed ramps (slow-mo in/out,
   ramp up/down, pulse, wave) to video + audio. 150 Visual Bucs. */

const SPEED_COST = Number(process.env["SPEED_PRESETS_CREDITS"]) || 150;

/** Build an atempo chain for a given speed (atempo only accepts 0.5–2.0). */
function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = speed;
  while (s > 2.0) {
    parts.push("atempo=2.0");
    s /= 2.0;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(3)}`);
  return parts.join(",");
}

const SPEED_PRESETS = {
  /* ── constant speeds ── */
  ultra_slow: {
    label: "Ultra Slow-mo",
    blurb: "Quarter speed — dramatic detail",
    kind: "constant" as const,
    speed: 0.25,
  },
  slowmo: {
    label: "Slow Motion",
    blurb: "Half speed — classic slow-mo",
    kind: "constant" as const,
    speed: 0.5,
  },
  gentle_slow: {
    label: "Gentle Slow",
    blurb: "Subtle 0.75x dreamy feel",
    kind: "constant" as const,
    speed: 0.75,
  },
  normal: {
    label: "Normal Speed",
    blurb: "Reset to 1x",
    kind: "constant" as const,
    speed: 1,
  },
  quick: {
    label: "Quick",
    blurb: "1.25x — snappy pace",
    kind: "constant" as const,
    speed: 1.25,
  },
  fast: {
    label: "Fast Forward",
    blurb: "1.5x — skip the boring",
    kind: "constant" as const,
    speed: 1.5,
  },
  double: {
    label: "2x Speed",
    blurb: "Double-time energy",
    kind: "constant" as const,
    speed: 2,
  },
  turbo: {
    label: "Turbo",
    blurb: "3x — timelapse feel",
    kind: "constant" as const,
    speed: 3,
  },
  hyper: {
    label: "Hyper Speed",
    blurb: "4x — maximum velocity",
    kind: "constant" as const,
    speed: 4,
  },
  /* ── animated ramps (8 segments, speed varies over time) ── */
  slowmo_in: {
    label: "Slow-mo In",
    blurb: "Eases into slow motion",
    kind: "ramp" as const,
    speeds: [1, 1, 1, 1, 1, 0.75, 0.5, 0.5],
  },
  slowmo_out: {
    label: "Slow-mo Out",
    blurb: "Slow-mo that lands back to normal",
    kind: "ramp" as const,
    speeds: [0.5, 0.5, 0.75, 1, 1, 1, 1, 1],
  },
  ramp_up: {
    label: "Speed Ramp Up",
    blurb: "Accelerates to 2x",
    kind: "ramp" as const,
    speeds: [0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.75, 2],
  },
  ramp_down: {
    label: "Speed Ramp Down",
    blurb: "Decelerates from 2x",
    kind: "ramp" as const,
    speeds: [2, 1.75, 1.5, 1.25, 1.125, 1, 0.875, 0.75],
  },
  pulse: {
    label: "Pulse",
    blurb: "Slow — fast — slow heartbeat",
    kind: "ramp" as const,
    speeds: [0.5, 0.75, 1, 1.5, 2, 1.5, 1, 0.75],
  },
  wave: {
    label: "Wave",
    blurb: "Fast — slow — fast swell",
    kind: "ramp" as const,
    speeds: [2, 1.5, 1, 0.5, 0.5, 1, 1.5, 2],
  },
} as const;

type SpeedPresetKey = keyof typeof SPEED_PRESETS;

const speedSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  preset: z.string().refine((v): v is SpeedPresetKey => v in SPEED_PRESETS, {
    message: `Preset must be one of: ${Object.keys(SPEED_PRESETS).join(", ")}`,
  }),
});

router.get("/speed-presets", requireAuth, (_req, res) => {
  res.json({
    presets: Object.entries(SPEED_PRESETS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
      kind: v.kind,
      speed: v.kind === "constant" ? v.speed : undefined,
      speeds: v.kind === "ramp" ? v.speeds : undefined,
    })),
  });
});

async function probeDuration(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", inputPath],
    { timeout: 30_000 },
  );
  const dur = parseFloat(stdout.trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error("Could not read video duration.");
  return dur;
}

/** Build a segmented filtergraph for a speed ramp (video + audio stay in sync). */
function buildRampFilter(speeds: readonly number[], duration: number): string {
  const n = speeds.length;
  const parts: string[] = [];
  const vIn: string[] = [];
  const aIn: string[] = [];
  for (let i = 0; i < n; i++) {
    const start = ((duration * i) / n).toFixed(3);
    const end = ((duration * (i + 1)) / n).toFixed(3);
    const s = speeds[i]!;
    parts.push(
      `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,setpts=${(1 / s).toFixed(4)}*PTS[v${i}]`,
      `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,${atempoChain(s)}[a${i}]`,
    );
    vIn.push(`[v${i}]`);
    aIn.push(`[a${i}]`);
  }
  parts.push(`${vIn.join("")}concat=n=${n}:v=1:a=0[v]`);
  parts.push(`${aIn.join("")}concat=n=${n}:v=0:a=1[a]`);
  return parts.join(";");
}

router.post("/apply-speed", requireAuth, async (req, res) => {
  const parsed = speedSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SPEED_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SPEED_COST, {
      action: `Speed (${parsed.data.preset})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "speed-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const preset = SPEED_PRESETS[parsed.data.preset];

    if (preset.kind === "constant") {
      await execFileAsync("ffmpeg", [
        "-y", "-i", inputPath,
        "-filter_complex",
        `[0:v]setpts=${(1 / preset.speed).toFixed(4)}*PTS[v];` +
        `[0:a]${atempoChain(preset.speed)}[a]`,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        outputPath,
      ], { timeout: 300_000 });
    } else {
      const duration = await probeDuration(inputPath);
      await execFileAsync("ffmpeg", [
        "-y", "-i", inputPath,
        "-filter_complex", buildRampFilter(preset.speeds, duration),
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        outputPath,
      ], { timeout: 300_000 });
    }

    const buffer = await readFile(outputPath);
    const objectName = `speed/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      preset: parsed.data.preset,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speed change failed.";
    req.log.error({ err: message }, "[apply-speed] failed");
    await refundCredits(req.userId!, SPEED_COST, {
      action: "Speed — Refund",
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
