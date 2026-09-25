import { Router } from "express";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();

interface VaultInput {
  artistType?: string | null;
  artistDescription?: string | null;
  visualStyle?: string | null;
  hair?: string | null;
  tattoos?: string | null;
  jewelry?: string | null;
  clothingStyle?: string | null;
  brandColors?: string | null;
  doNotChangeRules?: string | null;
  consistencyPrompt?: string | null;
  referenceImageUrl?: string | null;
}

/**
 * POST /api/improve-prompt
 * Rewrites a scene's AI Video Prompt into a complete, Runway-ready prompt that
 * always covers the key creative elements. When an Artist Vault is provided, the
 * artist's identity and brand rules are baked into the result.
 */
router.post("/improve-prompt", requireAuth, async (req, res) => {
  const { prompt, sceneContext, artistVault, videoStyle, platform } = req.body as {
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
    artistVault?: VaultInput | null;
    videoStyle?: string;
    platform?: string;
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: "prompt is required", errorType: "invalid_prompt" });
    return;
  }

  /* ── Scene context ── */
  const contextLines: string[] = [];
  if (sceneContext?.section)        contextLines.push(`Section: ${sceneContext.section}`);
  if (sceneContext?.lyricLine)      contextLines.push(`Lyric: "${sceneContext.lyricLine}"`);
  if (sceneContext?.action)         contextLines.push(`Action: ${sceneContext.action}`);
  if (sceneContext?.location)       contextLines.push(`Location: ${sceneContext.location}`);
  if (sceneContext?.cameraMovement) contextLines.push(`Camera: ${sceneContext.cameraMovement}`);
  if (sceneContext?.lighting)       contextLines.push(`Lighting: ${sceneContext.lighting}`);
  if (sceneContext?.mood)           contextLines.push(`Mood: ${sceneContext.mood}`);
  if (videoStyle)                   contextLines.push(`Music Video Style: ${videoStyle}`);
  if (platform)                     contextLines.push(`Platform Format: ${platform}`);

  /* ── Artist Vault context ── */
  const vault = artistVault ?? undefined;
  const vaultLines: string[] = [];
  let doNotChange = "";
  if (vault) {
    if (vault.artistType)        vaultLines.push(`Artist Type: ${vault.artistType}`);
    if (vault.artistDescription) vaultLines.push(`Artist Description / Personality: ${vault.artistDescription}`);
    if (vault.visualStyle)       vaultLines.push(`Visual Style: ${vault.visualStyle}`);
    if (vault.hair)              vaultLines.push(`Hair: ${vault.hair}`);
    if (vault.tattoos)           vaultLines.push(`Tattoos: ${vault.tattoos}`);
    if (vault.jewelry)           vaultLines.push(`Jewelry: ${vault.jewelry}`);
    if (vault.clothingStyle)     vaultLines.push(`Clothing Style / Wardrobe: ${vault.clothingStyle}`);
    if (vault.brandColors)       vaultLines.push(`Brand Colors: ${vault.brandColors}`);
    if (vault.consistencyPrompt) vaultLines.push(`Saved Consistency Prompt: ${vault.consistencyPrompt}`);
    if (vault.referenceImageUrl) vaultLines.push(`Reference Image URL: ${vault.referenceImageUrl} (use as visual identity guide)`);
    if (vault.doNotChangeRules)  doNotChange = vault.doNotChangeRules;
  }

  const systemPrompt =
    "Write with the eye of an Oscar-winning cinematographer: motivated camera movement, emotional lighting, textured atmosphere, compositions built for the cinema screen. " +
    "You are an expert AI music video director specializing in Runway Gen-4 text-to-video prompts. " +
    "Rewrite the artist's prompt into a SINGLE vivid, cinematic paragraph optimized for AI video generation. " +
    "The rewritten prompt MUST clearly include ALL of the following, woven naturally into the prose (never a bulleted list, never labels):\n" +
    "1. A visible artist/performer clearly on screen (the artist must be seen — never an empty scene)\n" +
    "2. Artist type (e.g. rapper, singer, DJ, band)\n" +
    "3. Wardrobe / outfit\n" +
    "4. Camera angle and movement\n" +
    "5. Location / setting\n" +
    "6. Lighting\n" +
    "7. Action (what the artist is doing)\n" +
    "8. Mood / emotional tone\n" +
    "9. Music video style / aesthetic\n" +
    "10. Platform format (aspect ratio / orientation, e.g. vertical 9:16 for TikTok/Reels or widescreen 16:9)\n" +
    "When Artist Vault details are provided, you MUST reflect the artist's description, hair, tattoos, jewelry, " +
    "clothing style, brand colors, and visual style so the artist stays visually consistent and on-brand. " +
    "You MUST strictly obey the DO NOT CHANGE rules and never contradict them. " +
    "Use cinematic language like 'slow dolly push-in', 'golden hour backlight', 'shallow depth of field', " +
    "'anamorphic lens flare', 'slow motion', 'neon reflections'. " +
    "Return ONLY the improved prompt text — no labels, no headings, no explanations, no quotes.";

  const userParts: string[] = [`Original prompt:\n${prompt.trim()}`];
  if (contextLines.length > 0) userParts.push(`Scene details:\n${contextLines.join("\n")}`);
  if (vaultLines.length > 0) {
    userParts.push(
      `ARTIST VAULT — keep the artist visually consistent and on-brand:\n${vaultLines.join("\n")}`,
    );
  }
  if (doNotChange) {
    userParts.push(
      `⛔ DO NOT CHANGE RULES — NEVER VIOLATE THESE:\n${doNotChange}`,
    );
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts.join("\n\n") },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    const improvedPrompt = completion.choices[0]?.message?.content?.trim() || prompt;
    res.json({ improvedPrompt });
  } catch (err) {
    const { status, errorType, message } = classifyImprovePromptError(err);
    req.log.error({ err, errorType }, "improve-prompt: OpenAI request failed");
    res.status(status).json({ error: message, errorType });
  }
});

/**
 * Turns an OpenAI SDK error into a user-facing status/errorType/message triple so the client
 * can distinguish "retrying will help" (rate limit) from "retrying won't help" (content policy,
 * bad request) from "unknown, maybe try again" (server error).
 */
function classifyImprovePromptError(
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
        message: "The prompt was flagged by the AI provider's content policy — try rewording it.",
      };
    }
    if (status >= 400 && status < 500) {
      return {
        status,
        errorType: "invalid_prompt",
        message: err.message || "The AI provider rejected this prompt as invalid.",
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
