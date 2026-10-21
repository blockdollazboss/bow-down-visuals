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

/* ─── Video collage maker ───
   Combines 2-4 videos into a single side-by-side / stacked / grid collage
   using ffmpeg xstack. 300 Visual Bucs. */

const COLLAGE_COST = Number(process.env["COLLAGE_CREDITS"]) || 300;

const LAYOUTS = {
  "side-by-side": {
    label: "Side by Side",
    blurb: "Two videos next to each other",
    videos: 2,
    layout: "0_0|w0_0",
  },
  stacked: {
    label: "Stacked",
    blurb: "Two videos on top of each other",
    videos: 2,
    layout: "0_0|0_h0",
  },
  grid: {
    label: "2×2 Grid",
    blurb: "Four videos in a grid",
    videos: 4,
    layout: "0_0|w0_0|0_h0|w0_h0",
  },
} as const;

type LayoutKey = keyof typeof LAYOUTS;

const collageSchema = z.object({
  videoUrls: z.array(z.string().trim().min(1).max(2048)).min(2).max(4),
  layout: z.string().refine((v): v is LayoutKey => v in LAYOUTS, {
    message: `Layout must be one of: ${Object.keys(LAYOUTS).join(", ")}`,
  }),
});

router.get("/collage-layouts", requireAuth, (_req, res) => {
  res.json({
    layouts: Object.entries(LAYOUTS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
      videos: v.videos,
    })),
  });
});

async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0", videoPath,
    ], { timeout: 30_000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

router.post("/collage", requireAuth, async (req, res) => {
  const parsed = collageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const layout = LAYOUTS[parsed.data.layout];
  if (parsed.data.videoUrls.length !== layout.videos) {
    res.status(400).json({
      error: `Layout "${parsed.data.layout}" requires exactly ${layout.videos} videos.`,
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < COLLAGE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, COLLAGE_COST, {
      action: `Video Collage (${parsed.data.layout})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "collage-"));
  const inputPaths: string[] = [];
  const outputPath = join(workDir, "collage.mp4");

  try {
    // Download all inputs
    for (let i = 0; i < parsed.data.videoUrls.length; i++) {
      const inputPath = join(workDir, `input-${i}.mp4`);
      const vidRes = await fetch(parsed.data.videoUrls[i]!, { signal: AbortSignal.timeout(120_000) });
      if (!vidRes.ok) throw new Error(`Could not download video ${i + 1}.`);
      await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));
      inputPaths.push(inputPath);
    }

    // Probe audio presence for each input
    const audioFlags = await Promise.all(inputPaths.map((p) => hasAudioStream(p)));

    // Build filter_complex:
    //  - normalize every video to 640x360, 30fps, yuv420p, common timebase
    //  - xstack into the chosen layout
    //  - mix audio: real audio where present, generated silence otherwise
    const CELL_W = 640;
    const CELL_H = 360;
    const filters: string[] = [];
    const vLabels: string[] = [];
    const aLabels: string[] = [];

    inputPaths.forEach((_p, i) => {
      filters.push(
        `[${i}:v]scale=${CELL_W}:${CELL_H}:force_original_aspect_ratio=decrease,` +
        `pad=${CELL_W}:${CELL_H}:(ow-iw)/2:(oh-ih)/2:black,` +
        `fps=30,format=yuv420p,settb=AVTB,setsar=1[v${i}]`
      );
      vLabels.push(`[v${i}]`);
      if (audioFlags[i]) {
        filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
      } else {
        filters.push(`anullsrc=channel_layout=stereo:sample_rate=44100[a${i}]`);
      }
      aLabels.push(`[a${i}]`);
    });

    filters.push(`${vLabels.join("")}xstack=inputs=${inputPaths.length}:layout=${layout.layout}[vout]`);
    filters.push(`${aLabels.join("")}amix=inputs=${inputPaths.length}:duration=shortest:dropout_transition=0[aout]`);

    const args: string[] = ["-y"];
    for (const p of inputPaths) args.push("-i", p);
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest",
      outputPath,
    );

    await execFileAsync("ffmpeg", args, { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `collage/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      layout: parsed.data.layout,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Collage creation failed.";
    req.log.error({ err: message }, "[collage] failed");
    await refundCredits(req.userId!, COLLAGE_COST, {
      action: "Video Collage — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await Promise.all(inputPaths.map((p) => unlink(p).catch(() => {})));
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
