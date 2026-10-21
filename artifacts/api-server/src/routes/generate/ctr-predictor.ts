import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI thumbnail CTR predictor ───
   Analyzes a thumbnail image + video title and predicts click-through
   performance with specific, actionable improvement suggestions.
   100 Visual Bucs. */

const CTR_PREDICTOR_COST = Number(process.env["CTR_PREDICTOR_CREDITS"]) || 100;

const predictSchema = z.object({
  thumbnailUrl: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(160),
  platform: z.enum(["youtube", "tiktok", "instagram", "facebook"]).default("youtube"),
});

const SYSTEM_PROMPT = `You are a YouTube thumbnail CTR expert who has studied millions of thumbnails and their click-through rates. Analyze the provided thumbnail image and video title, then predict CTR performance.

Score each dimension 1-10 and produce an overall ctrScore 1-100:
- Faces: human faces present, eye contact, exaggerated emotion (shock, curiosity, excitement)
- Text: 3-5 words max, huge readable font, high contrast, curiosity gap — penalize long sentences or tiny text
- Contrast & color: bold saturated colors, subject pops from background, readable at small sizes
- Composition: rule of thirds, clear focal point, not cluttered, no dead space
- Emotion/curiosity: creates an open loop, visual intrigue, something unexpected
- Title-thumbnail synergy: thumbnail and title complement (not duplicate) each other

Return ONLY valid JSON with this exact shape:
{
  "ctrScore": number (1-100),
  "grade": "A+" | "A" | "B" | "C" | "D" | "F",
  "predictedCtrRange": "e.g. 4.5%-6.5%",
  "dimensions": {
    "faces": number (1-10),
    "text": number (1-10),
    "contrast": number (1-10),
    "composition": number (1-10),
    "curiosity": number (1-10),
    "titleSynergy": number (1-10)
  },
  "detected": {
    "faceCount": number,
    "hasEyeContact": boolean,
    "textOnThumbnail": string (the words visible, or ""),
    "dominantColors": string[] (up to 3, e.g. ["red", "black"]),
    "dominantEmotion": string (e.g. "shock", "curiosity", "none")
  },
  "strengths": string[] (2-4 specific things working well),
  "improvements": [
    { "issue": string, "fix": string, "impact": "high" | "medium" | "low" }
  ] (4-6 items, sorted high impact first — be brutally specific: name exact text to change, colors to use, elements to add/remove),
  "rewrittenText": string (your suggested 3-5 word thumbnail text replacement, or "" if none needed),
  "oneLineVerdict": string (one punchy sentence)
}

Calibrate honestly: most thumbnails score 40-65. Reserve 85+ for truly exceptional ones.`;

async function thumbnailToDataUrl(imageUrl: string): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "ctr-predict-"));
  const rawPath = join(workDir, "raw");
  const smallPath = join(workDir, "small.jpg");
  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error("Could not download the thumbnail image.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 15 * 1024 * 1024) throw new Error("Thumbnail image is too large (max 15 MB).");
    await writeFile(rawPath, buf);
    // Downscale to max 1024px wide JPEG so the vision call stays cheap.
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", rawPath, "-vf", "scale=1024:-2", "-q:v", "4", smallPath],
      { timeout: 30_000 },
    );
    const small = await readFile(smallPath);
    return `data:image/jpeg;base64,${small.toString("base64")}`;
  } finally {
    await unlink(rawPath).catch(() => {});
    await unlink(smallPath).catch(() => {});
  }
}

router.post("/predict-ctr", requireAuth, async (req, res) => {
  const parsed = predictSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { thumbnailUrl, title, platform } = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CTR_PREDICTOR_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CTR_PREDICTOR_COST, {
      action: "Thumbnail CTR Predictor",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const dataUrl = await thumbnailToDataUrl(thumbnailUrl);

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Platform: ${platform}\nVideo title: "${title}"\nAnalyze this thumbnail for CTR.` },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("AI did not return an analysis.");

    let result: unknown;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new Error("AI returned an unparsable analysis.");
    }

    res.json({
      ok: true,
      platform,
      title,
      ...(typeof result === "object" && result !== null ? result : { raw }),
      creditsCharged: CTR_PREDICTOR_COST,
      creditsAfter,
    });
  } catch (err) {
    await refundCredits(req.userId!, CTR_PREDICTOR_COST, {
      action: "Thumbnail CTR Predictor (failure refund)",
    }).catch(() => {});
    const status = (err as { status?: number })?.status === 429 ? 503 : 500;
    const message = err instanceof Error ? err.message : "CTR prediction failed.";
    res.status(status).json({ error: status === 503 ? "provider_rate_limited" : "ctr_prediction_failed", message });
  }
});

/* Free: list the CTR dimensions the predictor scores — for a frontend UI. */
router.get("/ctr-factors", (_req, res) => {
  res.json({
    factors: [
      { key: "faces", label: "Faces & Emotion", blurb: "Human faces, eye contact, exaggerated emotion" },
      { key: "text", label: "Thumbnail Text", blurb: "3-5 huge words, curiosity gap, high contrast" },
      { key: "contrast", label: "Contrast & Color", blurb: "Bold colors, subject pops, readable when small" },
      { key: "composition", label: "Composition", blurb: "Clear focal point, rule of thirds, uncluttered" },
      { key: "curiosity", label: "Curiosity Hook", blurb: "Open loops and visual intrigue that demand a click" },
      { key: "titleSynergy", label: "Title Synergy", blurb: "Thumbnail and title complement, never duplicate" },
    ],
    price: CTR_PREDICTOR_COST,
  });
});

export default router;
