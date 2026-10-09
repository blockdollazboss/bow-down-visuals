import { Router } from "express";
import { z } from "zod";
import RunwayML from "@runwayml/sdk";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { uploadPublicMediaToR2 } from "../../lib/objectStorage";

const execFileAsync = promisify(execFile);

const router = Router();

/* ─── Cover in Motion ──────────────────────────────────────────────────────
   POST /api/cover-in-motion/animate — 400 Visual Bucs.

   Animates a piece of cover art into a looping-style visualizer via the
   EXISTING image-to-video pipeline — the same Runway SDK call the codebase
   already uses in runway-clip.ts and intro-outro.ts (gen4.5 image-to-video),
   the same task-polling pattern, and the same "generated-clips" bucket.
   Nothing new invented: prompt tuned for subtle loop-friendly motion
   (slow push-in, gentle drift, light shimmer — no cuts, no morphing).

   gen4.5 image-to-video renders a fixed 5 s; a 3 s request is satisfied by
   trimming the first 3 s with ffmpeg after download (documented in the
   response flow). Charge BEFORE submission; refund on any failure. */

const MOTION_CREDIT_COST =
  Number(process.env["COVER_IN_MOTION_CREDITS"]) || 400;
const BUCKET = "generated-clips";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 240_000; // 4 min server-side wait, then refund + 502

const animateSchema = z.object({
  imageUrl: z.string().url("imageUrl must be a valid URL.").max(2000),
  style: z.string().max(120).optional().default(""),
  durationSec: z.union([z.literal(3), z.literal(5)]).optional().default(5),
});

function buildMotionPrompt(style: string): string {
  const styleLine = style.trim() ? ` Visual style: ${style.trim()}.` : "";
  return (
    `Animate this cover artwork into a seamless looping music visualizer. ` +
    `Motion must be subtle and loop-friendly: an extremely slow gentle push-in ` +
    `zoom with a soft lateral drift, gentle parallax between layers, and a faint ` +
    `ambient light shimmer. Keep every artwork element recognizable and stable — ` +
    `no camera jumps, no cuts, no morphing, no warping, no new objects appearing.${styleLine} ` +
    `The result should read as the same artwork, alive, breathing gently.`
  ).slice(0, 1000);
}

/** Poll a Runway task until it succeeds or fails (timeout throws). */
async function waitForTask(client: RunwayML, taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const task = await client.tasks.retrieve(taskId);
    if (task.status === "SUCCEEDED") {
      const url = (task.output as string[] | undefined)?.[0];
      if (!url) throw new Error("The video render finished but returned no video URL.");
      return url;
    }
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      const reason = (task as { failureReason?: string }).failureReason;
      throw new Error(reason ? `Video render failed: ${reason}` : "The video render failed on the provider.");
    }
    if (Date.now() >= deadline) {
      throw new Error("The video render is taking too long — try again (credits refunded).");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Could not download the rendered video (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("The rendered video came back empty.");
  return buf;
}

/** Trim to the first 3 s when the user asked for a 3 s loop. */
async function trimTo3s(mp4: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}-motion-in.mp4`);
  const outPath = join(tmpdir(), `${id}-motion-out.mp4`);
  try {
    await writeFile(inPath, mp4);
    await execFileAsync("ffmpeg", ["-v", "error", "-i", inPath, "-t", "3", "-c", "copy", outPath], {
      timeout: 60_000,
    });
    const out = await readFile(outPath);
    if (!out || out.length === 0) throw new Error("Could not trim the video to 3 seconds.");
    return out;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

/* POST /api/cover-in-motion/animate { imageUrl, style?, durationSec? }
   → 200 { videoUrl, creditsUsed, creditsRemaining }
   Paid: 400 Visual Bucs. Refund on failure. */
router.post("/cover-in-motion/animate", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = animateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid animate request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(503).json({
      error: "Video generation isn't configured on this server.",
      code: "video_gen_unavailable",
      message: "RUNWAYML_API_SECRET is not set — Cover in Motion can't animate until it's configured.",
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < MOTION_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs — Cover in Motion costs 400 Visual Bucs.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, MOTION_CREDIT_COST, {
      action: "Cover in Motion",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — Cover in Motion costs 400 Visual Bucs.",
      });
      return;
    }
    throw err;
  }

  const refundAndFail = async (status: number, message: string) => {
    try {
      await refundCredits(req.userId!, MOTION_CREDIT_COST, { action: "Cover in Motion — Refund" });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[cover-in-motion] refund failed after render error");
    }
    res.status(status).json({ error: message, refunded: true });
  };

  const { imageUrl, style, durationSec } = parsed.data;

  try {
    const client = new RunwayML({ apiKey });
    /* Same image-to-video call the codebase already uses for scenes/intros. */
    const task = await client.imageToVideo.create({
      model: "gen4.5",
      promptImage: imageUrl,
      promptText: buildMotionPrompt(style),
      duration: 5,
      ratio: "1280:720",
      contentModeration: { publicFigureThreshold: "low" },
    });
    logger.info({ taskId: task.id, userId: req.userId }, "[cover-in-motion] Runway task submitted");

    const runwayUrl = await waitForTask(client, task.id);
    let videoBuffer = await downloadToBuffer(runwayUrl);
    if (durationSec === 3) {
      videoBuffer = await trimTo3s(videoBuffer);
    }

    const videoPath = `${req.userId}/cover-in-motion/${Date.now()}-${randomUUID()}.mp4`;
    // R2 migration: zero-egress public upload (Supabase fallback when R2 unset).
    const publicUrl = await uploadPublicMediaToR2(BUCKET, videoPath, videoBuffer, "video/mp4");

    res.json({
      videoUrl: publicUrl,
      creditsUsed: MOTION_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Cover animation failed";
    logger.error({ err, userId: req.userId }, "[cover-in-motion] render failed");
    await refundAndFail(502, msg);
  }
});

export default router;
