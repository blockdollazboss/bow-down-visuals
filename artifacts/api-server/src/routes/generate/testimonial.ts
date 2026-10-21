import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Video testimonial generator ───
   Turns a customer quote + name + photo into a polished testimonial video:
   animated gradient background, circular photo with gold ring, fade-in
   quote text, optional background music bed mixed at low volume.
   300 Visual Bucs. */

const TESTIMONIAL_COST = Number(process.env["TESTIMONIAL_CREDITS"]) || 300;

const TESTIMONIAL_STYLES = {
  gold: {
    label: "Luxury Gold",
    blurb: "Dark background, gold accents",
    bg0: "0x0a0a0a",
    bg1: "0x1c1408",
    textColor: "0xFFFFFF",
    accentColor: "0xD4AF37",
  },
  midnight: {
    label: "Midnight",
    blurb: "Deep blue, clean white text",
    bg0: "0x05070f",
    bg1: "0x0d1b33",
    textColor: "0xFFFFFF",
    accentColor: "0x5aa9ff",
  },
  clean: {
    label: "Clean Light",
    blurb: "Bright background, dark text",
    bg0: "0xf5f2ea",
    bg1: "0xe2d9c2",
    textColor: "0x1a1a1a",
    accentColor: "0xb8860b",
  },
} as const;

type TestimonialStyleKey = keyof typeof TESTIMONIAL_STYLES;

const testimonialSchema = z.object({
  quote: z.string().trim().min(10).max(600),
  name: z.string().trim().min(1).max(80),
  photoUrl: z.string().trim().min(1).max(2048),
  company: z.string().trim().max(100).optional().default(""),
  style: z
    .string()
    .refine((v): v is TestimonialStyleKey => v in TESTIMONIAL_STYLES, {
      message: `Style must be one of: ${Object.keys(TESTIMONIAL_STYLES).join(", ")}`,
    })
    .optional()
    .default("gold"),
  /** Optional background music bed URL — mixed in at low volume. */
  musicUrl: z.string().trim().max(2048).optional().default(""),
  /** Video duration in seconds. */
  durationSec: z.number().int().min(5).max(20).optional().default(8),
});

/** Escape user text for ffmpeg drawtext=text='...'. */
function escapeDrawtext(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function resolveFontFile(): string | null {
  const candidates = [
    "/usr/share/fonts/bdv/Poppins-Bold.ttf",
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../docker/fonts/Poppins-Bold.ttf"
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

router.get("/testimonial-styles", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(TESTIMONIAL_STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

router.post("/testimonial-video", requireAuth, async (req, res) => {
  const parsed = testimonialSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TESTIMONIAL_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TESTIMONIAL_COST, {
      action: "Testimonial Video",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "testimonial-"));
  const photoPath = join(workDir, "photo.png");
  const musicPath = join(workDir, "music.mp3");
  const outputPath = join(workDir, "testimonial.mp4");

  try {
    const { quote, name, photoUrl, company, style, musicUrl, durationSec } = parsed.data;
    const st = TESTIMONIAL_STYLES[style];
    const D = durationSec;

    // Download photo
    const photoRes = await fetch(photoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!photoRes.ok) throw new Error("Could not download the photo.");
    await writeFile(photoPath, Buffer.from(await photoRes.arrayBuffer()));

    // Optional music bed
    let hasMusic = false;
    if (musicUrl) {
      const musicRes = await fetch(musicUrl, { signal: AbortSignal.timeout(60_000) });
      if (!musicRes.ok) throw new Error("Could not download the music bed.");
      await writeFile(musicPath, Buffer.from(await musicRes.arrayBuffer()));
      hasMusic = true;
    }

    const fontFile = resolveFontFile();
    const fontSpec = fontFile ? `fontfile='${fontFile}'` : "";

    // Layout (1920x1080)
    const quoteLines = wrapText(`"${quote}"`, 42, 5);
    const quoteFontSize = 46;
    const quoteLineH = 64;
    const quoteStartY = 530;
    const nameY = quoteStartY + quoteLines.length * quoteLineH + 36;
    const companyY = nameY + 64;

    const draws: string[] = [];
    // Gold accent bar above the quote
    draws.push(
      `drawbox=x=910:y=${quoteStartY - 46}:w=100:h=6:color=${st.accentColor}:t=fill`
    );
    // Quote lines — fade in
    quoteLines.forEach((line, i) => {
      const t0 = 0.6 + i * 0.35;
      draws.push(
        `drawtext=${fontSpec}:text='${escapeDrawtext(line)}':fontsize=${quoteFontSize}` +
          `:fontcolor=${st.textColor}:x=(w-text_w)/2:y=${quoteStartY + i * quoteLineH}` +
          `:alpha='if(lt(t,${t0.toFixed(2)}),0,min(1,(t-${t0.toFixed(2)})/0.6))'`
      );
    });
    // Name — gold, fades in later
    draws.push(
      `drawtext=${fontSpec}:text='${escapeDrawtext(name)}':fontsize=50` +
        `:fontcolor=${st.accentColor}:x=(w-text_w)/2:y=${nameY}` +
        `:alpha='if(lt(t,2.2),0,min(1,(t-2.2)/0.8))'`
    );
    // Company — smaller, fades in last
    if (company) {
      draws.push(
        `drawtext=${fontSpec}:text='${escapeDrawtext(company)}':fontsize=32` +
          `:fontcolor=${st.textColor}:x=(w-text_w)/2:y=${companyY}` +
          `:alpha='if(lt(t,2.8),0,min(1,(t-2.8)/0.8))'`
      );
    }

    const filterComplex = [
      // Animated gradient background + vignette
      `[0:v]trim=duration=${D},setpts=PTS-STARTPTS,vignette=PI/5,format=yuv420p[bg]`,
      // Circular photo mask (320px) with fade-in
      `[1:v]scale=320:320:force_original_aspect_ratio=increase,crop=320:320,` +
        `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-160,Y-160),158),255,0)',` +
        `fade=t=in:st=0.3:d=0.8[photo]`,
      // Gold ring behind the photo (340px disc)
      `color=c=${st.accentColor}:s=340x340:d=${D},format=rgba,` +
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-170,Y-170),170),255,0)',` +
        `fade=t=in:st=0.3:d=0.8[ring]`,
      `[bg][ring]overlay=(W-340)/2:140:format=yuv420[tmp1]`,
      `[tmp1][photo]overlay=(W-320)/2:150:format=yuv420[base]`,
      `[base]${draws.join(",")}[vout]`,
    ];

    if (hasMusic) {
      filterComplex.push(
        `[2:a]volume=0.18,atrim=0:${D},afade=t=in:st=0:d=1,` +
          `afade=t=out:st=${Math.max(0, D - 1.5)}:d=1.5,asetpts=PTS-STARTPTS[aout]`
      );
    }

    const args = [
      "-y",
      "-f", "lavfi",
      "-i", `gradients=s=1920x1080:c0=${st.bg0}:c1=${st.bg1}:speed=0.08`,
      "-framerate", "30",
      "-loop", "1",
      "-i", photoPath,
    ];
    if (hasMusic) args.push("-i", musicPath);
    args.push(
      "-filter_complex", filterComplex.join(";"),
      "-map", "[vout]",
      "-t", String(D),
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p"
    );
    if (hasMusic) {
      args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k", "-shortest");
    }
    args.push(outputPath);

    await execFileAsync("ffmpeg", args, { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `testimonial/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      style,
      durationSec: D,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Testimonial video failed.";
    req.log.error({ err: message }, "[testimonial-video] failed");
    await refundCredits(req.userId!, TESTIMONIAL_COST, {
      action: "Testimonial Video — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(photoPath).catch(() => {});
    await unlink(musicPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
