import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";

/* ─── Style Stealer ───────────────────────────────────────────────────────
   /api/style-stealer/analyze — 2 credits: the creator pastes a URL and
   DESCRIBES what they saw in a viral video; the AI reverse-engineers the
   viral formula from that TEXT description and produces an actionable
   "edit recipe" they can apply to their own timeline.

   HONEST SCOPE — we do NOT download or watch the video. The analysis is
   text analysis of the user's description, and the frontend must show that
   disclaimer next to every result. The model must never claim to have
   seen the video.

   applyHints — alongside formula + editRecipe the AI maps what it found
   to machine-actionable settings for one-click "Apply" in the editor:
   a caption style, up to 3 effects, up to 2 overlays — all from strict
   value lists. Keys the AI can't confidently map are OMITTED (validated
   server-side), never invented. */

const router = Router();

/* 2 credits per analysis — env-overridable without a deploy. A full
   formula + edit-recipe teardown is a long structured GPT-6 Sol completion;
   2 credits holds a deep margin — and honors the standing rule that every
   AI feature costs a fee. */
const ANALYZE_CREDITS = Number(process.env["STYLE_STEALER_ANALYZE_CREDITS"]) || 200;

const analyzeSchema = z.object({
  videoUrl: z.string().url("Give a valid video URL.").max(500),
  description: z.string().min(1, "Describe what you saw in the video.").max(2000),
  niche: z.string().max(120).optional().default(""),
});

interface FormulaJson {
  hook?: unknown;
  pacing?: unknown;
  cutPattern?: unknown;
  captionStyle?: unknown;
  audioCues?: unknown;
  whyItWorks?: unknown;
}

interface AnalyzeJson {
  formula?: unknown;
  editRecipe?: unknown;
  applyHints?: unknown;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function parseSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 12);
}

/* ── applyHints: strict machine-actionable value lists for one-click
   "Apply" in the editor. Any value outside these lists is dropped; a key
   with nothing valid left is omitted, never invented. ── */
const CAPTION_STYLES = [
  "clean-white",
  "gold-hiphop",
  "karaoke",
  "boxed",
  "viral-shorts",
  "minimal",
  "neon-glow",
  "pill-pop",
  "brutalist",
] as const;

const EFFECT_NAMES = [
  "Film Grain",
  "Vignette",
  "Glow",
  "Neon Glow",
  "Vibrant Pop",
  "Cinematic Bars",
  "VHS",
  "Warm Grade",
  "Cool Grade",
] as const;

const OVERLAY_NAMES = [
  "Smoke",
  "Rain",
  "Sparks",
  "Lens Flare",
  "Dust",
  "Light Leaks",
] as const;

interface ApplyHints {
  captionStyle?: string;
  effects?: string[];
  overlays?: string[];
}

function parseApplyHints(raw: unknown): ApplyHints {
  const hints: ApplyHints = {};
  if (!raw || typeof raw !== "object") return hints;
  const h = raw as Record<string, unknown>;

  const captionStyle = str(h["captionStyle"]).toLowerCase();
  if ((CAPTION_STYLES as readonly string[]).includes(captionStyle)) {
    hints.captionStyle = captionStyle;
  }

  if (Array.isArray(h["effects"])) {
    const effects = (h["effects"] as unknown[])
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim())
      .filter((e) => (EFFECT_NAMES as readonly string[]).includes(e))
      .filter((e, i, arr) => arr.indexOf(e) === i)
      .slice(0, 3);
    if (effects.length > 0) hints.effects = effects;
  }

  if (Array.isArray(h["overlays"])) {
    const overlays = (h["overlays"] as unknown[])
      .filter((o): o is string => typeof o === "string")
      .map((o) => o.trim())
      .filter((o) => (OVERLAY_NAMES as readonly string[]).includes(o))
      .filter((o, i, arr) => arr.indexOf(o) === i)
      .slice(0, 2);
    if (overlays.length > 0) hints.overlays = overlays;
  }

  return hints;
}

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[style-stealer] refund failed after generation error");
  }
}

/* POST /api/style-stealer/analyze { videoUrl, description, niche? }
   → 200 { formula{hook,pacing,cutPattern,captionStyle,audioCues,whyItWorks}, editRecipe{name,steps[]}, creditsUsed, creditsRemaining }
   Paid: 2 credits. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/style-stealer/analyze", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid style-stealer request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < ANALYZE_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to steal this style.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, ANALYZE_CREDITS, { action: "Style Stealer — Analyze" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to steal this style.",
      });
      return;
    }
    throw err;
  }

  const { videoUrl, description, niche } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a viral-video analyst for independent content creators. A creator gives you the URL ` +
            `of a viral video plus THEIR OWN WRITTEN DESCRIPTION of what they saw in it. You have NOT ` +
            `seen the video — you analyze ONLY the text description. Never claim you watched it. ` +
            `From the description, reverse-engineer the viral formula and write an actionable edit recipe.\n` +
            `formula (all short strings):\n` +
            `- hook: how the video opens in the first 3 seconds (structure, not praise)\n` +
            `- pacing: the energy rhythm across the video (e.g. "rapid-fire first 10s, breathes at the demo")\n` +
            `- cutPattern: the edit/cut pattern (e.g. "jump cuts every 2-3s, zooms on punchlines")\n` +
            `- captionStyle: how captions/on-screen text look and read\n` +
            `- audioCues: music, sound effects, and audio switches used\n` +
            `- whyItWorks: 2-3 sentences on the psychology — why a viewer keeps watching\n` +
            `editRecipe:\n` +
            `- name: a punchy named recipe like "The 3-Cut Hook Loop"\n` +
            `- steps: 6-10 ORDERED, concrete editing steps the creator can apply to their own timeline ` +
            `(specific: "cut every pause over 0.4s in the first 10 seconds", not "edit tighter")\n` +
            `applyHints (machine-actionable settings for one-click "Apply" in the editor):\n` +
            `- captionStyle: map the captionStyle you described to EXACTLY one of: clean-white, ` +
            `gold-hiphop, karaoke, boxed, viral-shorts, minimal, neon-glow, pill-pop, brutalist\n` +
            `- effects: up to 3 from EXACTLY: Film Grain, Vignette, Glow, Neon Glow, Vibrant Pop, ` +
            `Cinematic Bars, VHS, Warm Grade, Cool Grade\n` +
            `- overlays: up to 2 from EXACTLY: Smoke, Rain, Sparks, Lens Flare, Dust, Light Leaks\n` +
            `IMPORTANT: use only values from those exact lists. If you cannot confidently map the ` +
            `video's look to a value, OMIT that key entirely — never invent a value.\n` +
            `RULES: steal the STRUCTURE, never the content — the recipe must be an original style inspired ` +
            `by the formula, not a copy of the video. Never promise virality. ` +
            `Return ONLY JSON: {"formula": {"hook": "...", "pacing": "...", "cutPattern": "...", ` +
            `"captionStyle": "...", "audioCues": "...", "whyItWorks": "..."}, ` +
            `"editRecipe": {"name": "...", "steps": ["step 1", ...]}, ` +
            `"applyHints": {"captionStyle": "...", "effects": ["..."], "overlays": ["..."]}}.`,
        },
        {
          role: "user",
          content:
            `Reverse-engineer this video's formula from my description.\n` +
            `Video URL (reference only — you have NOT watched it): ${videoUrl.trim()}\n` +
            `What I saw: ${description.trim()}` +
            (niche.trim() ? `\nMy niche: ${niche.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2500,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let formula = { hook: "", pacing: "", cutPattern: "", captionStyle: "", audioCues: "", whyItWorks: "" };
    let recipeName = "";
    let recipeSteps: string[] = [];
    let applyHints: ApplyHints = {};
    try {
      const j = JSON.parse(raw) as AnalyzeJson;
      if (j.formula && typeof j.formula === "object") {
        const f = j.formula as FormulaJson;
        formula = {
          hook: str(f.hook).slice(0, 600),
          pacing: str(f.pacing).slice(0, 600),
          cutPattern: str(f.cutPattern).slice(0, 600),
          captionStyle: str(f.captionStyle).slice(0, 600),
          audioCues: str(f.audioCues).slice(0, 600),
          whyItWorks: str(f.whyItWorks).slice(0, 800),
        };
      }
      if (j.editRecipe && typeof j.editRecipe === "object") {
        const r = j.editRecipe as Record<string, unknown>;
        recipeName = str(r["name"]).slice(0, 120);
        recipeSteps = parseSteps(r["steps"]);
      }
      applyHints = parseApplyHints(j.applyHints);
    } catch {
      /* fall through to the empty check below */
    }
    if (!formula.hook || !formula.whyItWorks || !recipeName || recipeSteps.length === 0) {
      throw new Error("Model returned no usable style analysis");
    }

    res.json({
      formula,
      editRecipe: { name: recipeName, steps: recipeSteps },
      applyHints,
      creditsUsed: ANALYZE_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, ANALYZE_CREDITS, "Style Stealer — Analyze");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[style-stealer] OpenAI rate limit / quota");
      res.status(503).json({ error: "The style stealer is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[style-stealer] analysis failed");
    res.status(502).json({ error: "The style stealer hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
