import { Router } from "express";
import OpenAI from "openai";
import { chatCompletion } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();

type Target = "video" | "image" | "thumbnail" | "song" | "artist";
type Mode = "generate" | "improve";

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

const TARGETS: Record<Target, { label: string; expert: string; rules: string }> = {
  video: {
    label: "AI video scene",
    expert:
      "You are a world-class AI music video director who writes prompts for Runway Gen-4.5 and Seedance 2.5 text-to-video.",
    rules:
      "Every prompt MUST weave in, as natural cinematic prose (never lists or labels): a visible performer on screen, artist type, wardrobe, camera angle AND movement, location, lighting, the action, mood, and visual style. " +
      "Keep prompts lip-sync friendly: clear frontal or three-quarter face visibility, steady camera on the performer during vocal moments. " +
      "Use cinematic language (slow dolly push-in, golden hour backlight, shallow depth of field, anamorphic flare, slow motion).",
  },
  image: {
    label: "AI image",
    expert:
      "You are a world-class prompt engineer for state-of-the-art AI image models (OpenAI GPT Image 2).",
    rules:
      "Every prompt MUST specify: subject, composition and framing, lighting, color palette, level of detail/photorealism, camera/lens qualities when relevant, and mood. " +
      "For any text in the image, put the exact words in quotes. Be concrete and visual — no vague adjectives without visual meaning.",
  },
  thumbnail: {
    label: "video thumbnail",
    expert:
      "You are a YouTube thumbnail strategist whose thumbnails get clicked.",
    rules:
      "Every prompt MUST produce a bold, high-contrast, instantly readable-at-small-size image: one dominant subject with expressive emotion, minimal background clutter, " +
      "vibrant saturated colors, dramatic lighting. If text is included, keep it to 5 words max in quotes, huge and bold. No fine detail that vanishes at 120px wide.",
  },
  song: {
    label: "AI song",
    expert:
      "You are a hit-making music producer writing generation prompts for ElevenLabs Music.",
    rules:
      "Every prompt MUST specify: genre and subgenre, mood, tempo/energy, key instruments, vocal style (or instrumental), song structure hints, and era/production polish. " +
      "Keep it under 2000 characters. Describe the sound, not the lyrics.",
  },
  artist: {
    label: "artist portrait",
    expert:
      "You are a celebrity portrait photographer and AI image prompt specialist obsessed with identity consistency.",
    rules:
      "Every prompt MUST lock identity: face shape, skin tone, hair, tattoos, jewelry, wardrobe, and signature styling from the Artist Vault when provided. " +
      "Specify portrait framing, lighting (e.g. Rembrandt, beauty dish), background, and photorealistic detail. The same person must be recognizable every time.",
  },
};

function vaultContext(vault?: VaultInput | null): string {
  if (!vault) return "";
  const lines: string[] = [];
  if (vault.artistType) lines.push(`Artist Type: ${vault.artistType}`);
  if (vault.artistDescription) lines.push(`Artist: ${vault.artistDescription}`);
  if (vault.visualStyle) lines.push(`Visual Style: ${vault.visualStyle}`);
  if (vault.hair) lines.push(`Hair: ${vault.hair}`);
  if (vault.tattoos) lines.push(`Tattoos: ${vault.tattoos}`);
  if (vault.jewelry) lines.push(`Jewelry: ${vault.jewelry}`);
  if (vault.clothingStyle) lines.push(`Wardrobe: ${vault.clothingStyle}`);
  if (vault.brandColors) lines.push(`Brand Colors: ${vault.brandColors}`);
  if (vault.consistencyPrompt) lines.push(`Consistency Prompt: ${vault.consistencyPrompt}`);
  const doNotChange = vault.doNotChangeRules
    ? `\n⛔ DO NOT CHANGE RULES — NEVER VIOLATE: ${vault.doNotChangeRules}`
    : "";
  if (lines.length === 0 && !doNotChange) return "";
  return `\n\nARTIST VAULT — bake this identity into every prompt:${doNotChange}\n${lines.join("\n")}`;
}

/**
 * POST /api/prompt-studio/generate
 * The all-in-one prompt generator: creates best-in-class prompts from a rough
 * idea, or improves an existing prompt — for video, image, thumbnails, songs,
 * and artist portraits. Returns 3 variations (plus what was fixed in improve mode).
 * Free to use (single cheap text call, like /api/improve-prompt).
 */
router.post("/prompt-studio/generate", requireAuth, async (req, res) => {
  const { mode, target, idea, prompt, artistVault } = req.body as {
    mode?: Mode;
    target?: Target;
    idea?: string;
    prompt?: string;
    artistVault?: VaultInput | null;
  };

  const useMode: Mode = mode === "improve" ? "improve" : "generate";
  const useTarget: Target = TARGETS[target as Target] ? (target as Target) : "video";
  const spec = TARGETS[useTarget];

  const source = (useMode === "improve" ? prompt : idea)?.trim();
  if (!source) {
    res.status(400).json({
      error: useMode === "improve" ? "prompt is required" : "idea is required",
    });
    return;
  }

  const systemPrompt =
    `${spec.expert} ${spec.rules}` +
    (useMode === "improve"
      ? " First silently diagnose the weaknesses in the user's prompt (vague, missing elements, weak visuals), then fix them."
      : "") +
    `${vaultContext(artistVault)}` +
    "\n\nReturn ONLY valid JSON: " +
    (useMode === "improve"
      ? '{"prompts": ["variation 1", "variation 2", "variation 3"], "fixes": ["what you fixed 1", "what you fixed 2"]}. '
      : '{"prompts": ["variation 1", "variation 2", "variation 3"]}. ') +
    "Each prompt is a single vivid paragraph, ready to paste into the generator. " +
    "Make the three variations meaningfully different creative directions, all excellent. " +
    "No markdown, no commentary outside the JSON.";

  const userPrompt =
    useMode === "improve"
      ? `Improve this ${spec.label} prompt:\n"""${source}"""`
      : `Create a ${spec.label} prompt from this idea:\n"""${source}"""`;

  try {
    const completion = await chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1500,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let parsed: { prompts?: string[]; fixes?: string[] } = {};
    try {
      parsed = JSON.parse(raw) as { prompts?: string[]; fixes?: string[] };
    } catch {
      parsed = { prompts: [raw] };
    }
    const prompts = (parsed.prompts ?? []).filter((p) => typeof p === "string" && p.trim()).slice(0, 3);
    if (prompts.length === 0) {
      res.status(502).json({ error: "The prompt generator returned no usable prompts. Try again." });
      return;
    }
    res.json({
      target: useTarget,
      mode: useMode,
      prompts,
      fixes: useMode === "improve" ? (parsed.fixes ?? []) : undefined,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "prompt-studio: generation failed");
    const status = err instanceof OpenAI.APIError ? (err.status ?? 502) : 502;
    res.status(status).json({ error: "Prompt generation failed. Please try again shortly." });
  }
});

export default router;
