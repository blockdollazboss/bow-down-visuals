import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  EFFECT_RECIPES,
  EFFECT_STARTER_IDS,
  MAX_STACKED_EFFECTS,
  CAMERA_MOVE_KEYWORDS,
  EFFECT_MATCH_DISCLAIMER,
  getEffectRecipe,
  matchEffects,
  type EffectProposal,
  type TrendSignal,
} from "../../lib/scene-effects";

/* ─── Viral Effects rail ──────────────────────────────────────────────────
   GET  /scene-effects/recipes — the generation-time effect library
        (data in lib/scene-effects.ts; recipes are prompt constructions
        woven into the clip prompt by /generate-runway-clip — no charge,
        effects ride the existing generation charge).
   POST /scene-effects/match   — Turbo Effect Match: given the scene and
        the trend predictor's current signals (the trends the creator is
        tracking), propose up to 3 effects most likely to travel, each
        with the trend reason shown. PROPOSALS ONLY — nothing is applied,
        charged, or generated here; the creator approves a pick in Scene
        Studio and it rides their next generation like any manual pick.

   Pricing: no charge. A proposal over the creator's own scene + tracked
   trends is a picker, not a generation; the metered moment stays the
   clip generation itself (same posture as the trend watchlist).

   Matcher honesty: the deterministic core (lib/scene-effects.ts) scores
   recipes against the scene and the supplied trend signals and is the
   always-available engine. When the text model is available it may
   re-rank the shortlist and phrase the reasons — grounded ONLY in the
   supplied signals (it may never invent a trend). Any AI failure falls
   back to the deterministic proposals, labelled source:"library". */

const router = Router();

router.get("/scene-effects/recipes", publicApiLimiter, requireAuth, (_req, res) => {
  res.json({
    recipes: EFFECT_RECIPES,
    maxStack: MAX_STACKED_EFFECTS,
    moveKeywords: CAMERA_MOVE_KEYWORDS,
  });
});

const trendSignalSchema = z.object({
  trend: z.string().trim().min(1).max(200),
  confidence: z.number().finite().min(0).max(100),
  timeframe: z.string().trim().max(60).optional(),
  reasoning: z.string().trim().max(600).optional(),
  earlySignals: z.array(z.string().trim().max(120)).max(4).optional(),
});

const matchSchema = z.object({
  promptText: z.string().trim().max(5000).optional().default(""),
  action: z.string().trim().max(500).optional().default(""),
  mood: z.string().trim().max(200).optional().default(""),
  section: z.string().trim().max(120).optional().default(""),
  cameraMovement: z.string().trim().max(300).optional().default(""),
  trends: z.array(trendSignalSchema).max(5).optional().default([]),
});

interface MatchProposalOut extends EffectProposal {
  bestFor: string;
}

function toOut(p: EffectProposal): MatchProposalOut {
  const recipe = getEffectRecipe(p.effectId);
  return { ...p, bestFor: recipe?.bestFor ?? "" };
}

/* Starter fallback: when neither the scene nor any signal scores a single
   recipe, offer the curated viral starters — labelled as library picks
   with an honest reason, never dressed up as a trend call. */
function starterProposals(): EffectProposal[] {
  return EFFECT_STARTER_IDS.map((id) => {
    const recipe = getEffectRecipe(id)!;
    return {
      effectId: recipe.id,
      name: recipe.name,
      score: 0,
      trendReason: null,
      fitReason: "A proven viral starter — no specific signal matched this scene, so start with the formats that travel most.",
      source: "scene" as const,
    };
  });
}

/* AI polish: re-rank the deterministic shortlist (never widen it) and
   phrase the reasons. Returns null on ANY problem — caller falls back. */
async function aiPolish(
  shortlist: EffectProposal[],
  scene: z.infer<typeof matchSchema>,
  trends: TrendSignal[],
): Promise<EffectProposal[] | null> {
  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are the Turbo Effect Match for Bow Down Visuals. A creator's scene and their " +
            "shortlist of generation-time video effects are given. Pick up to 3 effects from the " +
            "SHORTLIST ONLY (never invent an effect id) most likely to travel on short-form feeds, " +
            "best first. For each pick write: trendReason — why it can travel, citing ONLY the " +
            "tracked trends provided (name the trend); if no tracked trend supports the pick, " +
            "trendReason must be null and the pick justified by scene fit alone. fitReason — one " +
            "short sentence on why it fits THIS scene. Never promise virality. " +
            'Return ONLY JSON: {"picks": [{"effectId": "...", "trendReason": "..." | null, "fitReason": "..."}]}',
        },
        {
          role: "user",
          content:
            `Scene prompt: ${scene.promptText || "(none)"}\n` +
            `Action: ${scene.action || "(none)"}\nMood: ${scene.mood || "(none)"}\nSection: ${scene.section || "(none)"}\n` +
            `Tracked trends: ${trends.length ? trends.map((t) => `"${t.trend}" (${Math.round(t.confidence)}% confidence)`).join("; ") : "(none)"}\n` +
            `Shortlist: ${shortlist.map((p) => `${p.effectId} — ${p.name}: ${getEffectRecipe(p.effectId)?.bestFor ?? ""}`).join(" | ")}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 700,
      temperature: 0.5,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const j = JSON.parse(raw) as { picks?: unknown };
    if (!Array.isArray(j.picks)) return null;
    const byId = new Map(shortlist.map((p) => [p.effectId, p]));
    const out: EffectProposal[] = [];
    for (const pick of j.picks) {
      if (!pick || typeof pick !== "object") continue;
      const rec = pick as Record<string, unknown>;
      const id = String(rec["effectId"] ?? "");
      const base = byId.get(id);
      if (!base || out.some((p) => p.effectId === id)) continue;
      const aiReason =
        typeof rec["trendReason"] === "string" && rec["trendReason"].trim()
          ? rec["trendReason"].trim().slice(0, 400)
          : null;
      /* Grounding guard: an AI trend reason survives only if it cites a
         trend the creator actually supplied. With no supplied trends —
         or no citation — the deterministic core's reason stands (which
         is null unless the core itself matched a supplied trend). */
      let trendReason = base.trendReason;
      let source = base.source;
      if (aiReason && trends.length > 0) {
        const citesSuppliedTrend = trends.some((t) => {
          const name = t.trend.trim().toLowerCase();
          return name.length >= 4 && aiReason.toLowerCase().includes(name.slice(0, 24));
        });
        if (citesSuppliedTrend) {
          trendReason = aiReason;
          source = "trend";
        }
      }
      out.push({
        ...base,
        trendReason,
        fitReason:
          typeof rec["fitReason"] === "string" && rec["fitReason"].trim()
            ? rec["fitReason"].trim().slice(0, 240)
            : base.fitReason,
        source,
      });
      if (out.length >= 3) break;
    }
    return out.length > 0 ? out : null;
  } catch (err) {
    logger.warn({ err }, "[scene-effects] AI match polish unavailable — using library match");
    return null;
  }
}

router.post("/scene-effects/match", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = matchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid effect match request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const scene = parsed.data;
  const trends = scene.trends as TrendSignal[];

  const shortlist = matchEffects(scene, trends, 5);
  const core = shortlist.length > 0 ? matchEffects(scene, trends, 3) : starterProposals();

  const polished = shortlist.length > 0 ? await aiPolish(shortlist, scene, trends) : null;
  const proposals = polished ?? core;

  res.json({
    proposals: proposals.map(toOut),
    source: polished ? "ai" : "library",
    disclaimer: EFFECT_MATCH_DISCLAIMER,
    /* Approval semantics, explicit for clients: a proposal changes
       nothing until the creator applies it to the scene. */
    applied: false,
  });
});

export default router;
