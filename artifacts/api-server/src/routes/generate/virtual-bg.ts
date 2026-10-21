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

/* ─── Green screen virtual backgrounds ───
   Composites a green/blue-screen video over a procedural virtual
   background using ffmpeg chromakey + overlay.
   400 Visual Bucs per composite. */

const VIRTUAL_BG_COST = Number(process.env["VIRTUAL_BG_CREDITS"]) || 400;

/* Backgrounds are generated procedurally with ffmpeg lavfi filters,
   so no external assets are needed. Each preset defines a filter chain
   applied to a generated gradient base at the input video's resolution. */
const VIRTUAL_BACKGROUNDS = {
  office: {
    label: "Modern Office",
    blurb: "Sleek charcoal-to-warm-gray professional backdrop",
    emoji: "🏢",
    base: "c0=0x23272e:c1=0x4a4f55",
    extra: "vignette=PI/6",
  },
  beach: {
    label: "Tropical Beach",
    blurb: "Sky blue fading into warm sand",
    emoji: "🏖️",
    base: "c0=0x4fb6e8:c1=0xf2d8a0",
    extra: "",
  },
  studio: {
    label: "Photo Studio",
    blurb: "Classic dark studio sweep",
    emoji: "📸",
    base: "c0=0x0d0d0f:c1=0x2e2e33",
    extra: "vignette=PI/5",
  },
  abstract: {
    label: "Abstract Flow",
    blurb: "Purple-to-magenta creative gradient",
    emoji: "🎨",
    base: "c0=0x3a1c71:c1=0xd76d77",
    extra: "",
  },
  sunset: {
    label: "Golden Sunset",
    blurb: "Deep orange melting into pink",
    emoji: "🌅",
    base: "c0=0xff6a3d:c1=0xff2e88",
    extra: "",
  },
  forest: {
    label: "Forest",
    blurb: "Deep green-to-teal nature tones",
    emoji: "🌲",
    base: "c0=0x0b3d2e:c1=0x1f7a6d",
    extra: "vignette=PI/6",
  },
  citynight: {
    label: "City Night",
    blurb: "Midnight navy skyline mood with film grain",
    emoji: "🌃",
    base: "c0=0x050914:c1=0x1b2a4a",
    extra: "noise=alls=7:allf=t,vignette=PI/5",
  },
  luxurygold: {
    label: "Luxury Gold",
    blurb: "Black-to-gold premium backdrop",
    emoji: "💎",
    base: "c0=0x0a0a0a:c1=0x8a6d1f",
    extra: "vignette=PI/5",
  },
  minimalwhite: {
    label: "Minimal White",
    blurb: "Clean soft-white studio look",
    emoji: "⬜",
    base: "c0=0xffffff:c1=0xdfe3e8",
    extra: "",
  },
  podcastred: {
    label: "Podcast Red",
    blurb: "Deep broadcast red with vignette",
    emoji: "🎙️",
    base: "c0=0x3d0a0a:c1=0x8f1d1d",
    extra: "vignette=PI/5",
  },
  ocean: {
    label: "Deep Ocean",
    blurb: "Navy-to-cyan underwater gradient",
    emoji: "🌊",
    base: "c0=0x062a4a:c1=0x1f9db8",
    extra: "",
  },
  desert: {
    label: "Desert Dunes",
    blurb: "Warm tan-to-burnt-orange gradient",
    emoji: "🏜️",
    base: "c0=0xe8c07a:c1=0xc96a2b",
    extra: "",
  },
  space: {
    label: "Deep Space",
    blurb: "Near-black starfield mood with grain",
    emoji: "🚀",
    base: "c0=0x020208:c1=0x101a33",
    extra: "noise=alls=10:allf=t,vignette=PI/4",
  },
  neon: {
    label: "Neon Nights",
    blurb: "Magenta-to-cyan electric gradient",
    emoji: "💜",
    base: "c0=0xd63384:c1=0x22d3ee",
    extra: "",
  },
  library: {
    label: "Cozy Library",
    blurb: "Warm mahogany study tones",
    emoji: "📚",
    base: "c0=0x2a1a10:c1=0x6b4226",
    extra: "vignette=PI/5",
  },
} as const;

type VirtualBgKey = keyof typeof VIRTUAL_BACKGROUNDS;

const virtualBgSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  background: z.string().refine((v): v is VirtualBgKey => v in VIRTUAL_BACKGROUNDS, {
    message: `Background must be one of: ${Object.keys(VIRTUAL_BACKGROUNDS).join(", ")}`,
  }),
  /** Chroma key color: green (default) or blue screen. */
  keyColor: z.enum(["green", "blue"]).optional().default("green"),
  /** Key similarity 0.01–1.0 — higher removes more of the key color. */
  similarity: z.number().min(0.01).max(1).optional().default(0.3),
});

router.get("/virtual-backgrounds", requireAuth, (_req, res) => {
  res.json({
    backgrounds: Object.entries(VIRTUAL_BACKGROUNDS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
      emoji: v.emoji,
    })),
  });
});

router.post("/virtual-bg", requireAuth, async (req, res) => {
  const parsed = virtualBgSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < VIRTUAL_BG_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, VIRTUAL_BG_COST, {
      action: `Virtual Background (${parsed.data.background})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "virtual-bg-"));
  const inputPath = join(workDir, "input.mp4");
  const bgPath = join(workDir, "bg.png");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    // Probe the input resolution so the background matches it.
    const { stdout: whOut } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0", inputPath,
    ], { timeout: 30_000 });
    const [wRaw, hRaw] = whOut.trim().split(",");
    const width = Math.max(320, Math.min(3840, parseInt(wRaw || "1920", 10) || 1920));
    const height = Math.max(240, Math.min(2160, parseInt(hRaw || "1080", 10) || 1080));

    // Generate the procedural background still at the input resolution.
    const preset = VIRTUAL_BACKGROUNDS[parsed.data.background];
    const bgFilter = `gradients=s=${width}x${height}:${preset.base}` +
      (preset.extra ? `,${preset.extra}` : "") +
      ",format=yuv420p";
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", bgFilter,
      "-frames:v", "1", bgPath,
    ], { timeout: 60_000 });

    // Key out the green/blue screen and overlay onto the background.
    const keyHex = parsed.data.keyColor === "blue" ? "0x0000FF" : "0x00FF00";
    const sim = parsed.data.similarity;
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath, "-loop", "1", "-i", bgPath,
      "-filter_complex",
      `[0:v]scale=${width}:${height},chromakey=${keyHex}:${sim}:0.15,despill=type=green:mix=0.5:expand=0[key];` +
      `[1:v]scale=${width}:${height},format=yuv420p[bg];` +
      `[bg][key]overlay=0:0,format=yuv420p[out]`,
      "-map", "[out]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `virtual-bg/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      background: parsed.data.background,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Virtual background failed.";
    req.log.error({ err: message }, "[virtual-bg] failed");
    await refundCredits(req.userId!, VIRTUAL_BG_COST, {
      action: "Virtual Background — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(bgPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
