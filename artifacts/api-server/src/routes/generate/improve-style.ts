import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { freeAiLimiter } from "../../lib/rate-limit";

const router = Router();

const improveStyleSchema = z.object({
  style: z.string().trim().min(1).max(2000),
});

/**
 * POST /api/improve-style
 * Rewrites a rough music style description (the music lane's Custom-mode
 * style field) into one polished style string in the shape the music
 * generator consumes: comma-separated descriptors covering genre, mood,
 * instrumentation, production character and vocal character.
 *
 * The sibling /api/improve-prompt route is hard-wired to video-scene
 * prompts (performer on screen, camera movement, lighting), so music
 * styles get their own endpoint rather than a mode flag over there.
 * Free, like /api/improve-prompt: no credit charge on either side.
 */
router.post("/improve-style", requireAuth, freeAiLimiter, async (req, res) => {
  const parsed = improveStyleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { style } = parsed.data;

  const systemPrompt =
    "You are an expert music producer and A&R consultant with encyclopedic knowledge of genres, " +
    "production techniques and vocal styles. Rewrite the artist's rough music style description into " +
    "ONE polished style string for an AI music generator. Return ONLY the style string — no labels, " +
    "no headings, no explanations, no quotes. Shape it as vivid comma-separated descriptors covering, " +
    "in this order when natural: genre and subgenre, mood and energy, key instrumentation and production " +
    "texture, tempo feel, era or production character, and vocal character (tone and delivery; mention " +
    "gender only if the artist did). PRESERVE every concrete detail the artist gave — a BPM, a named " +
    "instrument, a specific mood: sharpen the wording and fill in the missing dimensions plausibly, but " +
    "never contradict or replace their choices with a different song. Keep it under 400 characters: dense " +
    "and specific, not flowery. Example of the target shape: " +
    "'dark trap, 140 BPM, heavy 808s, moody minor-key piano, cinematic strings, raw hungry male rap vocal'.";

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Rough style description:\n${style}` },
      ],
      max_completion_tokens: 300,
      temperature: 0.7,
    });

    const improvedStyle = completion.choices[0]?.message?.content?.trim() || style;
    res.json({ improvedStyle });
  } catch (err) {
    const { status, errorType, message } = classifyImproveStyleError(err);
    req.log.error({ err, errorType }, "improve-style: OpenAI request failed");
    res.status(status).json({ error: message, errorType });
  }
});

/**
 * Turns an OpenAI SDK error into a user-facing status/errorType/message triple so the client
 * can distinguish "retrying will help" (rate limit) from "retrying won't help" (content policy,
 * bad request) from "unknown, maybe try again" (server error). Mirrors improve-prompt's
 * classifier so both enhance buttons fail the same way.
 */
function classifyImproveStyleError(
  err: unknown,
): { status: number; errorType: "rate_limit" | "content_policy" | "invalid_prompt" | "server_error"; message: string } {
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 500;
    const code = typeof err.code === "string" ? err.code : "";
    const type = typeof err.type === "string" ? err.type : "";

    if (status === 429) {
      return {
        status: 429,
        errorType: "rate_limit",
        message: "Rate limited by the AI provider — please wait a moment and try again.",
      };
    }
    if (
      code === "content_policy_violation" ||
      type === "content_policy_violation" ||
      /content policy|safety system/i.test(err.message)
    ) {
      return {
        status: 400,
        errorType: "content_policy",
        message: "The style was flagged by the AI provider's content policy — try rewording it.",
      };
    }
    if (status >= 400 && status < 500) {
      return {
        status,
        errorType: "invalid_prompt",
        message: err.message || "The AI provider rejected this style as invalid.",
      };
    }
  }
  return {
    status: 502,
    errorType: "server_error",
    message: "The AI provider is temporarily unavailable. Please try again shortly.",
  };
}

export default router;
