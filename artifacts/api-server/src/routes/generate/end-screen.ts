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

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI video end screen generator ───
   Builds a 10-second branded end screen: the last 10s of the source video
   darkened as a backdrop, channel name, a pulsing gold SUBSCRIBE button,
   CTA text, and two "watch next" placeholder cards. 250 Visual Bucs. */

const END_SCREEN_COST = Number(process.env["END_SCREEN_CREDITS"]) || 250;

const W = 1920;
const H = 1080;
const DURATION = 10;
const FPS = 30;
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const GOLD = "0xC9A84C";

/** Escape text for ffmpeg drawtext. */
function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

const endScreenSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  channelName: z.string().trim().min(1).max(80),
  ctaText: z.string().trim().min(1).max(160).default("Subscribe for more!"),
});

/** Fade-in alpha expression for drawtext. drawbox has no alpha option on this
 *  ffmpeg build, so boxes use a pop-in enable window instead. */
const FADE_IN = `alpha='if(lt(t,0.8),t/0.8,1)'`;
const BOX_IN = `enable='gte(t,0.8)'`;

/**
 * Build the overlay filter chain for the end screen.
 * Geometry (1920x1080):
 *  - channel name, centered, y=170
 *  - pulsing gold glow behind the subscribe button, centered (960,500)
 *  - subscribe button: 520x130 gold box centered (960,500), black SUBSCRIBE text
 *  - CTA text, centered, y=650
 *  - "WATCH NEXT" label, centered, y=770
 *  - two placeholder cards: 560x200 at y=840 (x=330 and x=1030), play triangles
 */
function buildFilterChain(channelName: string, ctaText: string): string {
  const name = escapeDrawtext(channelName);
  const cta = escapeDrawtext(ctaText);

  const channelNameText =
    `drawtext=fontfile='${FONT_PATH}':text='${name}':fontsize=110` +
    `:fontcolor=${GOLD}@1:x=(w-text_w)/2:y=170:${FADE_IN}`;

  // Pulsing glow: box size breathes with sin() so it pulses around the button.
  const glow =
    `drawbox=x='960-(560+30*sin(6.28*t))/2':y='500-(170+20*sin(6.28*t))/2'` +
    `:w='560+30*sin(6.28*t)':h='170+20*sin(6.28*t)'` +
    `:color=${GOLD}@0.25:t=fill:enable='gte(t,0.8)'`;

  const buttonBox = `drawbox=x=700:y=435:w=520:h=130:color=${GOLD}:t=fill:${BOX_IN}`;

  const buttonText =
    `drawtext=fontfile='${FONT_PATH}':text='SUBSCRIBE':fontsize=64` +
    `:fontcolor=black:x=(w-text_w)/2:y=500-text_h/2:${FADE_IN}`;

  const ctaDrawtext =
    `drawtext=fontfile='${FONT_PATH}':text='${cta}':fontsize=54` +
    `:fontcolor=white:x=(w-text_w)/2:y=650:${FADE_IN}`;

  const watchNextLabel =
    `drawtext=fontfile='${FONT_PATH}':text='WATCH NEXT':fontsize=44` +
    `:fontcolor=white:x=(w-text_w)/2:y=770:${FADE_IN}`;

  const card = (x: number) =>
    `drawbox=x=${x}:y=840:w=560:h=200:color=${GOLD}@0.9:t=8:${BOX_IN},` +
    `drawbox=x=${x + 8}:y=848:w=544:h=184:color=black@0.75:t=fill:${BOX_IN},` +
    `drawtext=fontfile='${FONT_PATH}':text='▶':fontsize=72` +
    `:fontcolor=${GOLD}:x=${x}+280-text_w/2:y=940-text_h/2:${FADE_IN}`;

  return [
    channelNameText,
    glow,
    buttonBox,
    buttonText,
    ctaDrawtext,
    watchNextLabel,
    card(330),
    card(1030),
  ].join(",");
}

router.get("/end-screen/info", requireAuth, (_req, res) => {
  res.json({
    durationSeconds: DURATION,
    width: W,
    height: H,
    fps: FPS,
    layout: [
      "Channel name (top, gold)",
      "Pulsing gold SUBSCRIBE button (center)",
      "CTA text (below button)",
      "Two 'Watch Next' placeholder cards (bottom)",
    ],
    cost: END_SCREEN_COST,
  });
});

router.post("/end-screen", requireAuth, async (req, res) => {
  const parsed = endScreenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < END_SCREEN_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, END_SCREEN_COST, {
      action: "Video end screen",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "endscreen-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const filterChain = buildFilterChain(parsed.data.channelName, parsed.data.ctaText);

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-sseof", "-10",
        "-i", inputPath,
        "-filter_complex",
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H},eq=brightness=-0.45:saturation=0.7,` +
          `fps=${FPS},${filterChain}[out]`,
        "-map", "[out]",
        "-t", String(DURATION),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-an",
        outputPath,
      ],
      { timeout: 300_000 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `endscreen/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      durationSeconds: DURATION,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "End screen generation failed.";
    req.log.error({ err: message }, "[end-screen] failed");
    await refundCredits(req.userId!, END_SCREEN_COST, {
      action: "Video end screen — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
