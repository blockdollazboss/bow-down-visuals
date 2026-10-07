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

/* ─── Video transitions pack ───
   Joins two videos with a cinematic transition using ffmpeg xfade.
   200 Visual Bucs per transition. */

const TRANSITION_COST = Number(process.env["TRANSITION_CREDITS"]) || 200;

const TRANSITIONS = {
  fade:        { label: "Crossfade",       blurb: "Smooth dissolve between clips",              xfade: "fade" },
  fadeblack:   { label: "Fade to Black",   blurb: "Dip through black",                          xfade: "fadeblack" },
  fadewhite:   { label: "Fade to White",   blurb: "Flash through white",                        xfade: "fadewhite" },
  dissolve:    { label: "Dissolve",        blurb: "Soft blended dissolve",                      xfade: "dissolve" },
  wipeleft:    { label: "Wipe Left",       blurb: "Hard wipe sweeping left",                   xfade: "wipeleft" },
  wiperight:   { label: "Wipe Right",      blurb: "Hard wipe sweeping right",                  xfade: "wiperight" },
  wipeup:      { label: "Wipe Up",         blurb: "Hard wipe sweeping up",                      xfade: "wipeup" },
  wipedown:    { label: "Wipe Down",       blurb: "Hard wipe sweeping down",                    xfade: "wipedown" },
  slideleft:   { label: "Slide Left",      blurb: "New clip pushes in from the right",          xfade: "slideleft" },
  slideright:  { label: "Slide Right",     blurb: "New clip pushes in from the left",           xfade: "slideright" },
  slideup:     { label: "Slide Up",        blurb: "New clip pushes up from below",              xfade: "slideup" },
  slidedown:   { label: "Slide Down",      blurb: "New clip pushes down from above",            xfade: "slidedown" },
  smoothleft:  { label: "Smooth Left",     blurb: "Buttery smooth slide to the left",           xfade: "smoothleft" },
  smoothright: { label: "Smooth Right",    blurb: "Buttery smooth slide to the right",          xfade: "smoothright" },
  circlecrop:  { label: "Circle Crop",     blurb: "Iris wipe — circle closes in",               xfade: "circlecrop" },
  circleopen:  { label: "Circle Open",     blurb: "Iris wipe — circle opens up",                xfade: "circleopen" },
  circleclose: { label: "Circle Close",    blurb: "Iris wipe — circle closes out",              xfade: "circleclose" },
  radial:      { label: "Radial",          blurb: "Clock-wipe sweep around the center",         xfade: "radial" },
  pixelize:    { label: "Pixelize",        blurb: "Retro blocky pixel transition",              xfade: "pixelize" },
  hblur:       { label: "Blur Sweep",      blurb: "Dreamy horizontal blur blend",               xfade: "hblur" },
} as const;

type TransitionKey = keyof typeof TRANSITIONS;

const applyTransitionSchema = z.object({
  videoUrl1: z.string().trim().min(1).max(2048),
  videoUrl2: z.string().trim().min(1).max(2048),
  transition: z.string().refine((v): v is TransitionKey => v in TRANSITIONS, {
    message: `Transition must be one of: ${Object.keys(TRANSITIONS).join(", ")}`,
  }),
  /** Transition duration in seconds. */
  transitionDuration: z.number().min(0.3).max(3).optional().default(1),
});

router.get("/transitions", requireAuth, (_req, res) => {
  res.json({
    transitions: Object.entries(TRANSITIONS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

async function getDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", path,
  ], { timeout: 30_000 });
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not read video duration.");
  return d;
}

async function hasAudio(path: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
    "-of", "csv=p=0", path,
  ], { timeout: 30_000 });
  return stdout.trim().length > 0;
}

router.post("/apply-transition", requireAuth, async (req, res) => {
  const parsed = applyTransitionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TRANSITION_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TRANSITION_COST, {
      action: `Video Transition (${parsed.data.transition})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "transition-"));
  const input1Path = join(workDir, "input1.mp4");
  const input2Path = join(workDir, "input2.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const [res1, res2] = await Promise.all([
      fetch(parsed.data.videoUrl1, { signal: AbortSignal.timeout(120_000) }),
      fetch(parsed.data.videoUrl2, { signal: AbortSignal.timeout(120_000) }),
    ]);
    if (!res1.ok) throw new Error("Could not download the first video.");
    if (!res2.ok) throw new Error("Could not download the second video.");
    await Promise.all([
      writeFile(input1Path, Buffer.from(await res1.arrayBuffer())),
      writeFile(input2Path, Buffer.from(await res2.arrayBuffer())),
    ]);

    const [dur1, dur2, audio1, audio2] = await Promise.all([
      getDuration(input1Path),
      getDuration(input2Path),
      hasAudio(input1Path),
      hasAudio(input2Path),
    ]);

    // Clamp transition length so it fits inside both clips.
    const D = Math.min(parsed.data.transitionDuration, dur1 / 2, dur2 / 2, 2);
    const offset = Math.max(0.05, dur1 - D);
    const total = dur1 + dur2 - D;
    const t = TRANSITIONS[parsed.data.transition];

    /* Normalize both streams (same res/fps/pixfmt/timebase) — xfade requires it. */
    const norm = (i: number, tag: string) =>
      `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,` +
      `pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,settb=AVTB[${tag}]`;
    let filter =
      `${norm(0, "v0")};${norm(1, "v1")};` +
      `[v0][v1]xfade=transition=${t.xfade}:duration=${D.toFixed(2)}:offset=${offset.toFixed(2)}[v]`;

    const maps = ["-map", "[v]"];
    if (audio1 && audio2) {
      filter +=
        `;[0:a]aresample=44100,aformat=channel_layouts=stereo[a0]` +
        `;[1:a]aresample=44100,aformat=channel_layouts=stereo[a1]` +
        `;[a0][a1]acrossfade=d=${D.toFixed(2)}:curve=tri[a]`;
      maps.push("-map", "[a]");
    } else if (audio1 && !audio2) {
      filter += `;[0:a]apad=whole_dur=${total.toFixed(2)}[a]`;
      maps.push("-map", "[a]");
    } else if (!audio1 && audio2) {
      filter +=
        `;aevalsrc=0:d=${offset.toFixed(2)}:s=44100[s]` +
        `;[s][1:a]aresample=44100,concat=n=2:v=0:a=1[a]`;
      maps.push("-map", "[a]");
    } else {
      maps.push("-an");
    }

    const args = [
      "-y", "-i", input1Path, "-i", input2Path,
      "-filter_complex", filter,
      ...maps,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ];

    await execFileAsync("ffmpeg", args, { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `transitions/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      transition: parsed.data.transition,
      transitionDuration: D,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transition failed.";
    req.log.error({ err: message }, "[apply-transition] failed");
    await refundCredits(req.userId!, TRANSITION_COST, {
      action: "Video Transition — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(input1Path).catch(() => {});
    await unlink(input2Path).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
