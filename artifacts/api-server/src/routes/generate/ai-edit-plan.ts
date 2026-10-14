import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";
import { freeAiLimiter } from "../../lib/rate-limit";
import { z } from "zod";
import { getTextModel } from "../../lib/ai-clients";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
} from "../../lib/credits";

const router = Router();

/* Charged server-side at the price the UI has always displayed for this
   tool (frontend registry: "/api/generate/ai-edit-plan" → 100 Visual
   Bucs). Until the owner's 2026-10-14 ruling this route called the paid
   text model for free. The deterministic local fallback plan costs no
   provider spend, so it stays free: the charge rides only the real AI
   call, and any response that ends up being the fallback refunds it —
   the user pays the displayed price only for the AI plan itself. */
const AI_EDIT_PLAN_CREDIT_COST = 100;

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: key });
  return openaiClient;
}

const Schema = z.object({
  idempotencyKey: z.string().max(128).optional(),
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

const SYSTEM_PROMPT = `Edit like an Oscar-winning film editor: every cut earns its place, pacing breathes with the music, and transitions serve the story — never decoration. Think in sequences, not clips; build tension and release like a feature film.

You are an expert music video editor AI. Given a project context, generate a complete AI edit plan as valid JSON.

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

router.post("/generate/ai-edit-plan", requireAuth, freeAiLimiter, async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const input = parsed.data;

  const openai = getOpenAI();
  if (!openai) {
    /* No provider configured → the free local fallback, no charge. */
    req.log.warn("[ai-edit-plan] No OpenAI key — using fallback");
    res.json({ plan: buildFallbackPlan(input), source: "fallback" });
    return;
  }

  /* Balance fast-fail on the middleware balance (skipped in dev, the
     thumbnail-generator pattern); chargeCredits re-reads fresh and is
     authoritative. */
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && (req.userCredits ?? 0) < AI_EDIT_PLAN_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Buy more Visual Bucs to keep creating.",
      required: AI_EDIT_PLAN_CREDIT_COST,
    });
    return;
  }

  /* Charge BEFORE the paid provider call, under a stable idempotency
     key for (user, endpoint, request-intent): a double-tap or retry of
     the same plan request can't double-charge. */
  const idempotencyKey = buildChargeIdempotencyKey(
    "ai-edit-plan",
    req.userId!,
    parsed.data.idempotencyKey,
    input,
  );
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, AI_EDIT_PLAN_CREDIT_COST, {
      action: "AI Edit Plan",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of Visual Bucs. Buy more Visual Bucs to keep creating.",
        required: AI_EDIT_PLAN_CREDIT_COST,
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
      return;
    }
    throw err;
  }
  /* Any outcome that serves the free fallback instead of the AI plan
     refunds the charge with a ledger trace. */
  const refundCharge = () =>
    refundCredits(req.userId!, AI_EDIT_PLAN_CREDIT_COST, {
      action: "AI Edit Plan — Refund (fallback served)",
    }).catch(() => {});

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
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_completion_tokens: 1800,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    let plan: unknown;
    let servedAiPlan = true;
    try {
      plan = JSON.parse(raw);
      (plan as Record<string, unknown>)["generatedAt"] = new Date().toISOString();
    } catch {
      req.log.warn("[ai-edit-plan] JSON parse failed, using fallback");
      plan = buildFallbackPlan(input);
      servedAiPlan = false;
    }
    if (!servedAiPlan) {
      /* The paid call returned nothing usable — the user gets the free
         fallback, so the charge comes back. */
      await refundCharge();
      res.json({ plan, source: "fallback" });
      return;
    }
    res.json({ plan, source: "ai", creditsRemaining: creditsAfter });
  } catch (err) {
    req.log.warn({ err }, "[ai-edit-plan] OpenAI call failed, using fallback");
    await refundCharge();
    res.json({ plan: buildFallbackPlan(input), source: "fallback" });
  }
});

export default router;
