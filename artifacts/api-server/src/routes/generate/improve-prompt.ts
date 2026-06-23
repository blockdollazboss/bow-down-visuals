import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

/**
 * POST /api/improve-prompt
 * Takes a Runway video prompt + scene context and returns an enhanced version.
 */
router.post("/improve-prompt", requireAuth, async (req, res) => {
  const { prompt, sceneContext } = req.body as {
    prompt?: string;
    sceneContext?: {
      section?: string;
      lyricLine?: string;
      action?: string;
      location?: string;
      cameraMovement?: string;
      lighting?: string;
      mood?: string;
    };
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  const contextLines: string[] = [];
  if (sceneContext?.section)         contextLines.push(`Section: ${sceneContext.section}`);
  if (sceneContext?.lyricLine)        contextLines.push(`Lyric: "${sceneContext.lyricLine}"`);
  if (sceneContext?.action)           contextLines.push(`Action: ${sceneContext.action}`);
  if (sceneContext?.location)         contextLines.push(`Location: ${sceneContext.location}`);
  if (sceneContext?.cameraMovement)   contextLines.push(`Camera: ${sceneContext.cameraMovement}`);
  if (sceneContext?.lighting)         contextLines.push(`Lighting: ${sceneContext.lighting}`);
  if (sceneContext?.mood)             contextLines.push(`Mood: ${sceneContext.mood}`);

  const systemPrompt =
    "You are an expert AI music video director specializing in Runway Gen-4 text-to-video prompts. " +
    "Improve the given prompt to be more cinematic, vivid, and effective for video generation. " +
    "Keep the artist's original vision but add specific details about camera movement, lighting quality, " +
    "color grading, visual atmosphere, and subject motion. " +
    "Use language like: 'slow dolly push-in', 'golden hour backlight', 'shallow depth of field', " +
    "'cinematic anamorphic lens flare', 'slow motion', 'handheld', 'neon reflections', etc. " +
    "Return ONLY the improved prompt text — no labels, no explanations, no quotes.";

  const userContent =
    `Original prompt:\n${prompt.trim()}` +
    (contextLines.length > 0 ? `\n\nScene context:\n${contextLines.join("\n")}` : "");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 350,
    temperature: 0.7,
  });

  const improvedPrompt = completion.choices[0]?.message?.content?.trim() || prompt;
  res.json({ improvedPrompt });
});

export default router;
