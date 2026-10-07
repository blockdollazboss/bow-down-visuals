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

/* ─── AI meme generator ───
   Overlays top/bottom text on classic meme templates (or a custom image)
   using ffmpeg drawtext in the classic white-with-black-outline style.
   100 Visual Bucs per meme. */

const MEME_COST = Number(process.env["MEME_CREDITS"]) || 100;

/** Text box in normalized (0-1) coordinates + font size relative to image width. */
interface MemeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  fontScale: number;
}

interface MemeTemplate {
  label: string;
  blurb: string;
  imageUrl: string;
  /** Box 0 = topText, box 1 = bottomText, further boxes via texts[]. */
  boxes: MemeBox[];
  slotNames: string[];
}

const MEME_TEMPLATES: Record<string, MemeTemplate> = {
  drake: {
    label: "Drake Hotline Bling",
    blurb: "Disapproving Drake vs approving Drake — top text goes up, bottom text goes down",
    imageUrl: "https://i.imgflip.com/30b1gx.jpg",
    boxes: [
      { x: 0.55, y: 0.05, w: 0.42, h: 0.4, fontScale: 0.055 },
      { x: 0.55, y: 0.55, w: 0.42, h: 0.4, fontScale: 0.055 },
    ],
    slotNames: ["Reject (top panel)", "Approve (bottom panel)"],
  },
  "distracted-boyfriend": {
    label: "Distracted Boyfriend",
    blurb: "The wandering eye — label the girlfriend, the distraction, and the guy",
    imageUrl: "https://i.imgflip.com/1ur9b0.jpg",
    boxes: [
      { x: 0.03, y: 0.06, w: 0.24, h: 0.22, fontScale: 0.045 },
      { x: 0.71, y: 0.06, w: 0.26, h: 0.22, fontScale: 0.045 },
      { x: 0.36, y: 0.06, w: 0.26, h: 0.22, fontScale: 0.045 },
    ],
    slotNames: ["Girlfriend (left)", "Distraction (right)", "The guy (center)"],
  },
  "two-buttons": {
    label: "Two Buttons",
    blurb: "The impossible daily choice — label both buttons",
    imageUrl: "https://i.imgflip.com/1g8my4.jpg",
    boxes: [
      { x: 0.09, y: 0.37, w: 0.32, h: 0.13, fontScale: 0.035 },
      { x: 0.59, y: 0.37, w: 0.32, h: 0.13, fontScale: 0.035 },
    ],
    slotNames: ["Left button", "Right button"],
  },
  "change-my-mind": {
    label: "Change My Mind",
    blurb: "Steven Crowder's sign — state your hot take on the sign",
    imageUrl: "https://i.imgflip.com/24y43o.jpg",
    boxes: [
      { x: 0.2, y: 0.18, w: 0.62, h: 0.55, fontScale: 0.06 },
      { x: 0.05, y: 0.82, w: 0.9, h: 0.14, fontScale: 0.045 },
    ],
    slotNames: ["The sign", "Bottom caption"],
  },
  "one-does-not-simply": {
    label: "One Does Not Simply",
    blurb: "Boromir's warning — classic top/bottom text",
    imageUrl: "https://i.imgflip.com/1bij.jpg",
    boxes: [
      { x: 0.05, y: 0.02, w: 0.9, h: 0.25, fontScale: 0.085 },
      { x: 0.05, y: 0.71, w: 0.9, h: 0.26, fontScale: 0.085 },
    ],
    slotNames: ["Top text", "Bottom text"],
  },
  "disaster-girl": {
    label: "Disaster Girl",
    blurb: "Smiling through the chaos — classic top/bottom text",
    imageUrl: "https://i.imgflip.com/23ls.jpg",
    boxes: [
      { x: 0.05, y: 0.02, w: 0.9, h: 0.25, fontScale: 0.085 },
      { x: 0.05, y: 0.71, w: 0.9, h: 0.26, fontScale: 0.085 },
    ],
    slotNames: ["Top text", "Bottom text"],
  },
  "woman-yelling-at-cat": {
    label: "Woman Yelling At Cat",
    blurb: "The argument — label the woman and the unbothered cat",
    imageUrl: "https://i.imgflip.com/345v97.jpg",
    boxes: [
      { x: 0.03, y: 0.03, w: 0.45, h: 0.28, fontScale: 0.05 },
      { x: 0.52, y: 0.03, w: 0.45, h: 0.28, fontScale: 0.05 },
    ],
    slotNames: ["The woman (left)", "The cat (right)"],
  },
  "this-is-fine": {
    label: "This Is Fine",
    blurb: "The dog in the burning room — classic top/bottom text",
    imageUrl: "https://i.imgflip.com/wxica.jpg",
    boxes: [
      { x: 0.05, y: 0.02, w: 0.9, h: 0.28, fontScale: 0.085 },
      { x: 0.05, y: 0.68, w: 0.9, h: 0.28, fontScale: 0.085 },
    ],
    slotNames: ["Top text", "Bottom text"],
  },
} as const;

type MemeTemplateKey = keyof typeof MEME_TEMPLATES;

/** Classic top/bottom boxes for a custom uploaded image. */
const CUSTOM_IMAGE_BOXES: MemeBox[] = [
  { x: 0.05, y: 0.02, w: 0.9, h: 0.25, fontScale: 0.085 },
  { x: 0.05, y: 0.71, w: 0.9, h: 0.26, fontScale: 0.085 },
];

const memeSchema = z
  .object({
    template: z.string().trim().max(64).optional(),
    customImageUrl: z.string().trim().min(1).max(2048).optional(),
    topText: z.string().trim().max(300).optional().default(""),
    bottomText: z.string().trim().max(300).optional().default(""),
    /** Fills boxes in order; overrides topText/bottomText when provided. */
    texts: z.array(z.string().trim().max(300)).max(6).optional(),
    uppercase: z.boolean().optional().default(true),
    textColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, { message: "textColor must be a #RRGGBB hex color" })
      .optional()
      .default("#FFFFFF"),
  })
  .refine((d) => d.template || d.customImageUrl, {
    message: "Provide either template or customImageUrl.",
  })
  .refine((d) => !d.template || d.template in MEME_TEMPLATES, {
    message: `template must be one of: ${Object.keys(MEME_TEMPLATES).join(", ")}`,
  })
  .refine(
    (d) => d.topText || d.bottomText || (d.texts && d.texts.some((t) => t.length > 0)),
    { message: "Provide at least one text (topText, bottomText, or texts)." }
  );

router.get("/meme-templates", requireAuth, (_req, res) => {
  res.json({
    templates: Object.entries(MEME_TEMPLATES).map(([key, t]) => ({
      key,
      label: t.label,
      blurb: t.blurb,
      slotNames: t.slotNames,
    })),
  });
});

/** Resolve the meme font: vendored TTF in Docker, repo copy in dev, fontconfig last. */
function resolveMemeFontFile(): string | null {
  const candidates = [
    "/usr/share/fonts/bdv/Anton-Regular.ttf",
    join(dirname(fileURLToPath(import.meta.url)), "../../../../../docker/fonts/Anton-Regular.ttf"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

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

/** Greedy word wrap for a max character count per line. */
function wrapText(text: string, maxChars: number): string[] {
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
  return lines.slice(0, 6);
}

router.post("/meme", requireAuth, async (req, res) => {
  const parsed = memeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < MEME_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, MEME_COST, { action: "Meme Generator" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "meme-"));
  const inputPath = join(workDir, "input");
  const outputPath = join(workDir, "meme.jpg");

  try {
    const templateKey = parsed.data.template as MemeTemplateKey | undefined;
    const template = templateKey ? MEME_TEMPLATES[templateKey] : undefined;
    const imageUrl = parsed.data.customImageUrl ?? template!.imageUrl;
    const boxes = template ? template.boxes : CUSTOM_IMAGE_BOXES;

    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
    if (!imgRes.ok) throw new Error("Could not download the meme image.");
    await writeFile(inputPath, Buffer.from(await imgRes.arrayBuffer()));

    // Probe real image dimensions so text scales correctly.
    const { stdout: dimOut } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      inputPath,
    ], { timeout: 30_000 });
    const [wStr, hStr] = dimOut.trim().split(",");
    const imgW = parseInt(wStr ?? "", 10);
    const imgH = parseInt(hStr ?? "", 10);
    if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) {
      throw new Error("Could not read the meme image dimensions.");
    }

    const slotTexts =
      parsed.data.texts && parsed.data.texts.length > 0
        ? parsed.data.texts
        : [parsed.data.topText, parsed.data.bottomText];

    const fontFile = resolveMemeFontFile();
    const fontSpec = fontFile ? `fontfile='${fontFile}'` : "font='Anton'";
    const color = parsed.data.textColor;

    const draws: string[] = [];
    boxes.forEach((box, bi) => {
      const raw = (slotTexts[bi] ?? "").trim();
      if (!raw) return;
      const text = parsed.data.uppercase ? raw.toUpperCase() : raw;
      const fontSize = Math.max(12, Math.round(imgW * box.fontScale));
      const boxWpx = Math.max(40, box.w * imgW);
      const maxChars = Math.max(4, Math.floor(boxWpx / (fontSize * 0.52)));
      const lines = wrapText(text, maxChars);
      const cxPx = Math.round((box.x + box.w / 2) * imgW);
      const lineH = Math.round(fontSize * 1.15);
      const totalH = lines.length * lineH;
      const startY = Math.round(box.y * imgH + Math.max(0, (box.h * imgH - totalH) / 2));
      const border = Math.max(2, Math.round(fontSize / 18));
      lines.forEach((line, li) => {
        draws.push(
          `drawtext=${fontSpec}:text='${escapeDrawtext(line)}':fontsize=${fontSize}` +
            `:fontcolor=${color}:borderw=${border}:bordercolor=black` +
            `:x=${cxPx}-text_w/2:y=${startY + li * lineH}`
        );
      });
    });

    if (draws.length === 0) throw new Error("No text to render.");

    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", draws.join(","),
      "-frames:v", "1",
      "-q:v", "2",
      outputPath,
    ], { timeout: 120_000 });

    const buffer = await readFile(outputPath);
    const objectName = `memes/${req.userId}/${randomUUID()}.jpg`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/jpeg");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      template: templateKey ?? "custom",
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Meme generation failed.";
    req.log.error({ err: message }, "[meme] failed");
    await refundCredits(req.userId!, MEME_COST, { action: "Meme Generator — Refund" }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
