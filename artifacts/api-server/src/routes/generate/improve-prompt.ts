import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

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
    res.status(400).json({ error: "prompt is required" });
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

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userParts.join("\n\n") },
    ],
    max_tokens: 500,
    temperature: 0.7,
  });

  const improvedPrompt = completion.choices[0]?.message?.content?.trim() || prompt;
  res.json({ improvedPrompt });
});

export default router;
