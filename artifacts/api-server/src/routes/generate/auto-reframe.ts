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
import { centreCropFilter, planTrackedCrop } from "../../lib/reframe-tracking";
import { detectSubjectsInVideo } from "../../lib/subject-detector";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Auto-reframe (CapCut parity) ───
   Crops video to a target aspect ratio. v2: subject tracking — a
   person-matte pass (lib/subject-detector.ts, RVM on the vendored
   ONNX runtime) samples the video and lib/reframe-tracking.ts turns
   the matte boxes into a smoothed crop path that keeps the subject
   in frame, the way Opus/Descript/CapCut speaker framing does.

   Honest fallback: when tracking is off, unavailable, or the samples
   show no trackable subject, the render uses the EXACT v1 centre
   crop and the response says so — `reframe.mode` is
   "subject-tracked" only when a tracked path actually rendered,
   otherwise "centre-crop" with the reason. The 200-Visual-Buc
   charge/refund discipline is unchanged from v1. */

const REFRAME_COST = Number(process.env["REFRAME_CREDITS"]) || 200;

const reframeSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]),
  /* Subject tracking defaults ON (v2); false reproduces the v1
     centre crop byte-for-byte. */
  trackSubject: z.boolean().optional().default(true),
});

const ASPECT_RATIOS: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

/* Output canvas per requested aspect — the old code hardcoded 1080x1920
   for every ratio. Long side is 1920 for landscape, 1080-wide for the rest. */
const OUTPUT_SIZE: Record<string, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};

router.post("/auto-reframe", requireAuth, async (req, res) => {
  const parsed = reframeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < REFRAME_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, REFRAME_COST, {
      action: "Auto Reframe",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "reframe-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const targetRatio = ASPECT_RATIOS[parsed.data.aspect]!;
    const [outW, outH] = OUTPUT_SIZE[parsed.data.aspect]!;

    /* Pick the crop: tracked path when the detector finds a
       trustworthy subject track, else the v1 centre crop — labeled
       either way in the response's `reframe` block. */
    let videoFilter = centreCropFilter(targetRatio, outW, outH);
    let reframe: {
      mode: "subject-tracked" | "centre-crop";
      reason: string | null;
      samples: number;
      trackedSamples: number;
    } = { mode: "centre-crop", reason: "tracking-off", samples: 0, trackedSamples: 0 };

    if (parsed.data.trackSubject) {
      const detection = await detectSubjectsInVideo(inputPath).catch(() => null);
      if (!detection) {
        reframe = {
          mode: "centre-crop",
          reason: "tracker-unavailable",
          samples: 0,
          trackedSamples: 0,
        };
      } else {
        const plan = planTrackedCrop({
          samples: detection.samples,
          srcW: detection.width,
          srcH: detection.height,
          targetRatio,
          outW,
          outH,
          durationSec: detection.durationSec,
        });
        const trackedCount = detection.samples.filter((s) => s.box !== null).length;
        if (plan.ok) {
          videoFilter = plan.filter;
          reframe = {
            mode: "subject-tracked",
            reason: null,
            samples: detection.samples.length,
            trackedSamples: plan.trackedSamples,
          };
        } else {
          reframe = {
            mode: "centre-crop",
            reason: plan.reason,
            samples: detection.samples.length,
            trackedSamples: trackedCount,
          };
        }
      }
    }

    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", videoFilter,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `reframe/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      aspect: parsed.data.aspect,
      creditsRemaining: creditsAfter,
      reframe,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-reframe failed.";
    req.log.error({ err: message }, "[auto-reframe] failed");
    await refundCredits(req.userId!, REFRAME_COST, {
      action: "Auto Reframe — Refund",
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
