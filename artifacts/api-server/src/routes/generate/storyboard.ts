import { Router } from "express";
import { z } from "zod";
import { writeFile, readFile, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();

/* ─── AI storyboard generator ───
   Takes a video script and turns it into a shot-by-shot storyboard:
   each shot gets a script line, an AI-generated 16:9 preview image,
   camera angle, shot type, timing, and transition. 350 Visual Bucs. */

const STORYBOARD_COST = Number(process.env["STORYBOARD_CREDITS"]) || 350;
const MAX_SHOTS = 10;

const STYLES = [
  {
    id: "cinematic",
    label: "Cinematic",
    blurb: "Film-quality lighting and composition for narrative videos",
    styleSuffix:
      "cinematic film still, dramatic lighting, professional cinematography, rich detail",
  },
  {
    id: "vlog",
    label: "Vlog",
    blurb: "Bright, casual, handheld feel for creator vlogs",
    styleSuffix:
      "bright casual vlog frame, natural light, handheld feel, authentic and relatable",
  },
  {
    id: "gaming",
    label: "Gaming",
    blurb: "High-energy neon aesthetic for gaming content",
    styleSuffix:
      "high-energy neon gaming aesthetic, electric colors, dynamic and bold",
  },
  {
    id: "documentary",
    label: "Documentary",
    blurb: "Grounded, realistic frames for educational content",
    styleSuffix:
      "realistic documentary frame, natural colors, grounded and authentic",
  },
] as const;

const storyboardSchema = z.object({
  /** Full video script — dialogue, narration, scene descriptions. */
  script: z.string().trim().min(50).max(20000),
  /** Max number of shots to generate (3-10). Defaults to auto (AI decides). */
  shotCount: z.number().int().min(3).max(MAX_SHOTS).optional(),
  /** Visual style of the preview frames. */
  style: z.enum(["cinematic", "vlog", "gaming", "documentary"]).optional().default("cinematic"),
  /** Optional title for context. */
  title: z.string().trim().max(160).optional(),
});

interface ShotPlan {
  shotNumber: number;
  scriptLine: string;
  visualDescription: string;
  cameraAngle: string;
  shotType: string;
  durationSec: number;
  transition: string;
}

function str(v: unknown, maxLen = 500): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function parseShotPlan(raw: unknown, index: number): ShotPlan {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const durationRaw = Number(r["durationSec"]);
  return {
    shotNumber: index + 1,
    scriptLine: str(r["scriptLine"], 400),
    visualDescription: str(r["visualDescription"], 600),
    cameraAngle: str(r["cameraAngle"], 120),
    shotType: str(r["shotType"], 120),
    durationSec: Math.max(1, Math.min(60, Math.round(Number.isFinite(durationRaw) ? durationRaw : 5))),
    transition: str(r["transition"], 120) || "cut",
  };
}

async function generateShotImage(prompt: string, outputPath: string): Promise<void> {
  const model = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1792x1024",
      quality: "standard",
      n: 1,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error("Storyboard frame generation failed.");
  const data = (await response.json()) as { data?: Array<{ url?: string }> };
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL returned.");

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
  if (!imgRes.ok) throw new Error("Could not download generated frame.");
  await writeFile(outputPath, Buffer.from(await imgRes.arrayBuffer()));
}

router.get("/storyboard/styles", requireAuth, (_req, res) => {
  res.json({
    styles: STYLES.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb })),
    maxShots: MAX_SHOTS,
    price: STORYBOARD_COST,
  });
});

router.post("/storyboard", requireAuth, async (req, res) => {
  const parsed = storyboardSchema.safeParse(req.body ?? {});
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
  if (currentCredits < STORYBOARD_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, STORYBOARD_COST, {
      action: "Storyboard",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "storyboard-"));

  try {
    const { script, style, title } = parsed.data;
    const chosen = STYLES.find((s) => s.id === style) ?? STYLES[0];
    const shotHint = parsed.data.shotCount
      ? `Generate exactly ${parsed.data.shotCount} shots.`
      : "Decide the right number of shots yourself (between 4 and 10) based on the script's length and scene changes.";

    const model = getTextModel();
    const planPrompt =
      `You are a professional storyboard artist and video director. Break this video script into a shot-by-shot storyboard.\n\n` +
      `${title ? `Video title: ${title}\n` : ""}` +
      `Script:\n${script}\n\n` +
      `${shotHint}\n\n` +
      `For each shot return:\n` +
      `- scriptLine: the exact script line or narration beat this shot covers\n` +
      `- visualDescription: a vivid 1-2 sentence visual description of what is on screen (no camera jargon, pure visual content)\n` +
      `- cameraAngle: e.g. "low angle", "over-the-shoulder", "aerial", "eye-level"\n` +
      `- shotType: e.g. "wide shot", "close-up", "medium shot", "extreme close-up", "establishing shot"\n` +
      `- durationSec: estimated seconds on screen (integer 2-15)\n` +
      `- transition: how this shot transitions to the next — one of "cut", "fade", "dissolve", "wipe", "zoom"\n\n` +
      `Return ONLY valid JSON: {"shots": [{"scriptLine": "...", "visualDescription": "...", "cameraAngle": "...", "shotType": "...", "durationSec": 5, "transition": "cut"}]}`;

    const planRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: planPrompt }],
        response_format: { type: "json_object" },
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!planRes.ok) throw new Error("Storyboard planning failed.");
    const planData = (await planRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const planText = planData.choices?.[0]?.message?.content ?? "{}";
    let planJson: unknown = {};
    try {
      planJson = JSON.parse(planText);
    } catch {
      throw new Error("Storyboard planning returned invalid data.");
    }
    const rawShots = Array.isArray((planJson as Record<string, unknown>)["shots"])
      ? ((planJson as Record<string, unknown>)["shots"] as unknown[])
      : [];
    if (rawShots.length === 0) throw new Error("No shots were planned for this script.");

    const shots = rawShots.slice(0, MAX_SHOTS).map(parseShotPlan);

    // Generate a 16:9 preview frame for every shot.
    const results = [];
    let elapsedSec = 0;
    for (const shot of shots) {
      const imagePrompt =
        `Wide 16:9 film storyboard frame, ${chosen.styleSuffix}. ` +
        `Scene: ${shot.visualDescription}. ` +
        `${shot.shotType}, ${shot.cameraAngle}. ` +
        `No text, no captions, no watermarks — pure cinematic imagery.`;
      const imagePath = join(workDir, `shot-${shot.shotNumber}.png`);
      await generateShotImage(imagePrompt, imagePath);

      const buffer = await readFile(imagePath);
      const objectName = `storyboard/${req.userId}/${randomUUID()}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
      const url = await refreshSupabaseStorageUrl(storageRef);

      const startSec = elapsedSec;
      elapsedSec += shot.durationSec;
      results.push({
        shotNumber: shot.shotNumber,
        scriptLine: shot.scriptLine,
        visualDescription: shot.visualDescription,
        cameraAngle: shot.cameraAngle,
        shotType: shot.shotType,
        durationSec: shot.durationSec,
        startSec,
        endSec: elapsedSec,
        transition: shot.transition,
        imageUrl: url,
        storageRef,
      });
    }

    res.json({
      title: title ?? null,
      style: chosen.id,
      shots: results,
      totalDurationSec: elapsedSec,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storyboard generation failed.";
    req.log.error({ err: message }, "[storyboard] failed");
    await refundCredits(req.userId!, STORYBOARD_COST, {
      action: "Storyboard — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
