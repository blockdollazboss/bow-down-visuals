import { Router } from "express";
import OpenAI from "openai";
import { chatCompletion } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { z } from "zod";

const router = Router();

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: key });
  return openaiClient;
}

const Schema = z.object({
  style: z.string().min(1),
  styleName: z.string().optional().default(""),
  sceneCount: z.number().int().min(0),
  sceneDescriptions: z.array(z.string()).optional().default([]),
  audioFound: z.boolean().optional().default(false),
  captionsFound: z.boolean().optional().default(false),
  captionCount: z.number().int().optional().default(0),
  captionStyle: z.string().optional().default(""),
  currentEffects: z.array(z.string()).optional().default([]),
  artistName: z.string().optional().default(""),
  songTitle: z.string().optional().default(""),
  lyricsText: z.string().optional().default(""),
});

type Input = z.infer<typeof Schema>;

const STYLE_DEFAULTS: Record<string, {
  effects: string[];
  colorGrade: string;
  captionStylePreset: string;
  dominantTransition: string;
  beatCutNotes: string;
}> = {
  "viral-tiktok":       { effects: ["Film Grain", "Vignette"],                    colorGrade: "Vibrant Pop",        captionStylePreset: "viral-shorts",  dominantTransition: "Zoom",       beatCutNotes: "Fast cuts on every 2 beats; zoom punches on the hook" },
  "luxury-hiphop":      { effects: ["Film Grain", "Vignette", "Glow"],            colorGrade: "Warm Grade",         captionStylePreset: "gold-hiphop",   dominantTransition: "Crossfade",  beatCutNotes: "Slow-burn cuts every 4–6 beats; crossfades in verse, cuts in hook" },
  "dark-drill":         { effects: ["Film Grain", "Sharpen", "Cinematic Bars"],   colorGrade: "Moody Desaturated",  captionStylePreset: "clean-white",   dominantTransition: "Cut",        beatCutNotes: "Hard cuts on every beat in the hook; glitch transitions on drops" },
  "clean-music-video":  { effects: ["Film Grain"],                                colorGrade: "Teal & Orange",      captionStylePreset: "clean-white",   dominantTransition: "Cut",        beatCutNotes: "Standard cuts every 4 beats; crossfades on slower sections" },
  "high-energy-promo":  { effects: ["Neon Glow", "Camera Shake", "Speed Ramp"],  colorGrade: "Vibrant Pop",        captionStylePreset: "viral-shorts",  dominantTransition: "Flash",      beatCutNotes: "Flash cuts on every beat in the hook; speed ramp into drops" },
  "cinematic-story":    { effects: ["Cinematic Bars", "Vignette"],                colorGrade: "Moody Desaturated",  captionStylePreset: "minimal",       dominantTransition: "Crossfade",  beatCutNotes: "Long holds 6–8 seconds; slow crossfades; let emotion breathe" },
  "street-performance": { effects: ["Film Grain", "Camera Shake", "VHS"],         colorGrade: "Cool Grade",         captionStylePreset: "boxed",         dominantTransition: "Whip Pan",   beatCutNotes: "Whip pans on beat; raw handheld energy; fast verse cuts" },
  "gold-luxury-brand":  { effects: ["Glow", "Vignette", "Film Grain"],            colorGrade: "Warm Grade",         captionStylePreset: "gold-hiphop",   dominantTransition: "Crossfade",  beatCutNotes: "Smooth slow-mo transitions; slow zoom on flex moments" },
};

function buildFallbackPlan(input: Input): unknown {
  const s = STYLE_DEFAULTS[input.style] ?? STYLE_DEFAULTS["luxury-hiphop"]!;
  const count = Math.max(input.sceneCount, 1);
  const transitionPlan = Array.from({ length: count }, (_, i) => ({
    sceneIndex: i,
    transition: i === 0 ? "Cut" : s.dominantTransition,
    note: i === 0 ? "Opening shot — hard cut in" : `Scene ${i + 1} — ${s.dominantTransition.toLowerCase()}`,
  }));
  const sceneEditNotes = Array.from({ length: count }, (_, i) => ({
    sceneIndex: i,
    note: input.sceneDescriptions[i] ? `Clip: ${input.sceneDescriptions[i]}` : `Scene ${i + 1}`,
    transition: i === 0 ? "Cut" : s.dominantTransition,
    effect: s.effects[0] ?? "None",
  }));
  return {
    style: input.style,
    transitionPlan,
    effectsPlan: s.effects,
    colorGrade: s.colorGrade,
    captionStylePreset: s.captionStylePreset,
    beatCutNotes: s.beatCutNotes,
    introPlan: "Open on the strongest establishing shot with a hard cut in",
    outroPlan: "Fade out on the final bar or freeze-frame on the last clip",
    sceneEditNotes,
    exportSettings: {
      captionStylePreset: s.captionStylePreset,
      effects: s.effects,
      colorGrade: s.colorGrade,
    },
    generatedAt: new Date().toISOString(),
  };
}

const SYSTEM_PROMPT = `You are an expert music video editor AI. Given a project context, generate a complete AI edit plan as valid JSON.

Available effects: Film Grain, Glow, Blur, Sharpen, Vignette, Black & White, Neon Glow, VHS, Cinematic Bars, Camera Shake, Slow Zoom, Speed Ramp
Available color grades: Warm Grade, Cool Grade, Teal & Orange, Moody Desaturated, Vibrant Pop
Available transitions: Cut, Crossfade, Flash, Glitch, Whip Pan, Zoom, Light Leak, Fade to Black, Slide, Spin
Caption presets: clean-white, gold-hiphop, karaoke, boxed, viral-shorts, minimal

Rules:
- Do not overdo effects. Max 3 effects total.
- Match the style to the vibe. Luxury = warm grades, Drill = cold/desaturated.
- Quick cuts on strong lyric moments; smooth on slow sections.
- Return ONLY valid JSON matching the schema, no extra text.

Schema:
{
  "style": string,
  "transitionPlan": [{ "sceneIndex": number, "transition": string, "note": string }],
  "effectsPlan": string[],
  "colorGrade": string,
  "captionStylePreset": string,
  "beatCutNotes": string,
  "introPlan": string,
  "outroPlan": string,
  "sceneEditNotes": [{ "sceneIndex": number, "note": string, "transition": string, "effect": string }],
  "exportSettings": { "captionStylePreset": string, "effects": string[], "colorGrade": string },
  "generatedAt": string
}`;

router.post("/generate/ai-edit-plan", requireAuth, async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  const openai = getOpenAI();
  if (!openai) {
    req.log.warn("[ai-edit-plan] No OpenAI key — using fallback");
    res.json({ plan: buildFallbackPlan(input), source: "fallback" });
    return;
  }

  const sceneList = input.sceneDescriptions.slice(0, 20).map((d, i) => `  ${i}: ${d}`).join("\n") || "  (no scene descriptions)";
  const userPrompt = [
    `Style: ${input.styleName || input.style}`,
    `Scenes: ${input.sceneCount} total`,
    `Scene list:\n${sceneList}`,
    `Audio: ${input.audioFound ? "yes" : "no"}`,
    `Captions: ${input.captionsFound ? `yes (${input.captionCount} lines, preset: ${input.captionStyle})` : "no"}`,
    `Current effects: ${input.currentEffects.join(", ") || "none"}`,
    input.artistName ? `Artist: ${input.artistName}` : "",
    input.songTitle ? `Song: ${input.songTitle}` : "",
    input.lyricsText ? `Lyrics snippet: ${input.lyricsText.slice(0, 300)}` : "",
  ].filter(Boolean).join("\n");

  try {
    const completion = await chatCompletion({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1800,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    let plan: unknown;
    try {
      plan = JSON.parse(raw);
      (plan as Record<string, unknown>)["generatedAt"] = new Date().toISOString();
    } catch {
      req.log.warn("[ai-edit-plan] JSON parse failed, using fallback");
      plan = buildFallbackPlan(input);
    }
    res.json({ plan, source: "ai" });
  } catch (err) {
    req.log.warn({ err }, "[ai-edit-plan] OpenAI call failed, using fallback");
    res.json({ plan: buildFallbackPlan(input), source: "fallback" });
  }
});

export default router;
