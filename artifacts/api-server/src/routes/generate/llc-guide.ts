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
import { getLlcStateFee, LLC_STATE_CODES } from "../../lib/llc-state-fees";

const router = Router();

/* 1 credit per AI answer / plan — env-overridable without a deploy.
   A Q&A answer or filing plan is a short GPT-6 Sol completion (a fraction
   of a cent in provider fees), so 1 credit holds a deep margin while
   honoring the standing rule: every AI feature costs a fee. The static
   checklist, fee table, estimator, and FAQ on the page are pure UI and
   stay free. */
export const LLC_GUIDE_CREDIT_COST =
  Number(process.env["LLC_GUIDE_CREDIT_COST"]) || 1;

export const CREATOR_TYPES = [
  "musician",
  "streamer",
  "youtuber",
  "podcaster",
  "designer",
  "other",
] as const;
export type CreatorType = (typeof CREATOR_TYPES)[number];

const CREATOR_LABEL: Record<CreatorType, string> = {
  musician: "Musician / artist",
  streamer: "Streamer",
  youtuber: "YouTuber",
  podcaster: "Podcaster",
  designer: "Designer / freelancer",
  other: "Creator (other)",
};

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

export const askSchema = z.object({
  question: z
    .string()
    .min(1, "Ask a question first.")
    .max(1000, "Keep questions under 1000 characters."),
  state: z
    .string()
    .length(2)
    .optional()
    .refine((c) => !c || LLC_STATE_CODES.includes(c.toUpperCase()), {
      message: "Unknown state code.",
    }),
  history: z.array(historyItemSchema).max(10).optional().default([]),
});

export const planSchema = z.object({
  state: z
    .string()
    .length(2, "Pick your state (2-letter code).")
    .refine((c) => LLC_STATE_CODES.includes(c.toUpperCase()), {
      message: "Unknown state code.",
    }),
  creatorType: z.enum(CREATOR_TYPES),
  businessName: z.string().max(120).optional().default(""),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. GPT-6 takes max_completion_tokens. */

const NOT_LEGAL_ADVICE =
  "You are not a lawyer and this is not legal advice — for anything " +
  "complex (multi-member ownership, raising money, lawsuits), talk to a " +
  "business attorney.";

export function buildAskSystemPrompt(stateCode?: string): string {
  const fee = stateCode ? getLlcStateFee(stateCode) : undefined;
  const stateLine = fee
    ? ` The creator is considering filing in ${fee.name}: the Articles of Organization filing fee is $${fee.filingFee}, ongoing state cost is "${fee.ongoing}", typical processing ${fee.processing}. Use these exact numbers when relevant — never invent fees.`
    : "";
  return (
    `You are Thy Cheat Code's LLC formation assistant for independent content ` +
    `creators (musicians, streamers, YouTubers, podcasters, designers). ` +
    `Answer practical questions about forming and running an LLC: choosing a ` +
    `state, naming, registered agents, Articles of Organization, EINs, ` +
    `operating agreements, business bank accounts, taxes basics, and ongoing ` +
    `compliance. Be concrete and creator-specific — tie advice to how creators ` +
    `actually earn (brand deals, royalties, ad revenue, merch, tips). ` +
    `Keep answers under 180 words unless the question needs more. ` +
    `If asked about a state's fees you don't have data for, say to verify ` +
    `with that state's Secretary of State rather than guessing.${stateLine} ` +
    NOT_LEGAL_ADVICE
  );
}

export interface PlanStep {
  title: string;
  detail: string;
  estCost: string;
  timeline: string;
}

export interface FilingPlan {
  title: string;
  steps: PlanStep[];
  totalEstimate: string;
  notes: string[];
}

/** Validate + normalize the model's plan JSON. Throws on unusable output. */
export function parsePlanJson(raw: string): FilingPlan {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  if (!j || typeof j !== "object") throw new Error("Model returned no plan");
  const o = j as Record<string, unknown>;
  const steps = Array.isArray(o["steps"]) ? o["steps"] : [];
  const clean: PlanStep[] = steps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      title: String(s["title"] ?? "").trim(),
      detail: String(s["detail"] ?? "").trim(),
      estCost: String(s["estCost"] ?? "").trim(),
      timeline: String(s["timeline"] ?? "").trim(),
    }))
    .filter((s) => s.title && s.detail)
    .slice(0, 8);
  const notes = Array.isArray(o["notes"])
    ? o["notes"]
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        .map((n) => n.trim())
        .slice(0, 5)
    : [];
  if (clean.length === 0) throw new Error("Model returned no usable steps");
  return {
    title: String(o["title"] ?? "Your LLC filing plan").trim() || "Your LLC filing plan",
    steps: clean,
    totalEstimate: String(o["totalEstimate"] ?? "").trim(),
    notes,
  };
}

export function buildPlanUserPrompt(
  stateCode: string,
  creatorType: CreatorType,
  businessName: string,
): string {
  const fee = getLlcStateFee(stateCode);
  const feeLine = fee
    ? `State facts (use these exact numbers, do not invent others): ${fee.name} — Articles of Organization filing fee $${fee.filingFee}; ongoing: ${fee.ongoing}; typical processing: ${fee.processing}.`
    : "";
  return (
    `Build a tailored LLC filing plan.\n` +
    `Creator type: ${CREATOR_LABEL[creatorType]}\n` +
    `Filing state: ${stateCode.toUpperCase()}\n` +
    (businessName.trim() ? `Desired business name: ${businessName.trim()}\n` : "") +
    `${feeLine}\n` +
    `Tailor the steps to a ${CREATOR_LABEL[creatorType].toLowerCase()} — call out ` +
    `creator-specific concerns (e.g. royalty splits for musicians, brand-deal ` +
    `contracts for YouTubers/streamers, tip/donation income for streamers). ` +
    `Cover: name check, registered agent, filing the Articles, operating ` +
    `agreement, EIN (free from the IRS — never pay for one), business bank ` +
    `account, and first compliance deadlines. ` +
    `Return ONLY JSON: {"title": "...", "steps": [{"title": "...", "detail": "...", ` +
    `"estCost": "...", "timeline": "..."}], "totalEstimate": "first-year cost range", ` +
    `"notes": ["...", "..."]}. Max 8 steps.`
  );
}

const PLAN_SYSTEM_PROMPT =
  `You are Thy Cheat Code's LLC formation planner for independent content creators. ` +
  `You build concrete, state-accurate filing plans as JSON. Use ONLY the state ` +
  `fee numbers provided in the user message — never invent or round them. ` +
  `Be specific and practical, no generic fluff. ` + NOT_LEGAL_ADVICE;

/* Shared charge-then-generate flow: deduct 1 credit up front, refund it if
   the provider call fails so creators never pay for an error. */
async function chargeOr402(
  req: { userId?: string; userCredits?: number },
  res: { status: (c: number) => { json: (b: unknown) => void } },
  action: string,
): Promise<number | null> {
  const balance = req.userCredits ?? 0;
  if (balance < LLC_GUIDE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to use the AI LLC guide.",
    });
    return null;
  }
  try {
    return await chargeCredits(req.userId!, LLC_GUIDE_CREDIT_COST, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to use the AI LLC guide.",
      });
      return null;
    }
    throw err;
  }
}

/* POST /api/llc-guide/ask { question, state?, history? }
   → 200 { answer, creditsUsed, creditsRemaining }
   Paid: 1 credit per answer. */
router.post("/llc-guide/ask", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = askSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid question.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const creditsRemaining = await chargeOr402(req, res, "LLC Guide Q&A");
  if (creditsRemaining === null) return;

  const { question, state, history } = parsed.data;
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: buildAskSystemPrompt(state) },
        ...history
          .slice(-6)
          .map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
        { role: "user", content: question.trim() },
      ],
      max_completion_tokens: 600,
      temperature: 0.5,
    });
    const answer =
      completion.choices[0]?.message?.content?.trim() ||
      "My fins slipped — ask that again? 🦈";
    res.json({ answer, creditsUsed: LLC_GUIDE_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refundCredits(req.userId!, LLC_GUIDE_CREDIT_COST, {
      action: "LLC Guide Q&A (provider failure refund)",
    }).catch(() => {});
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[llc-guide] OpenAI rate limit / quota");
      res.status(503).json({ error: "The guide is catching its breath — try again in a moment. (Credit refunded.)" });
      return;
    }
    logger.error({ err }, "[llc-guide] ask failed");
    res.status(502).json({ error: "The guide hiccupped — try again. (Credit refunded.)" });
  }
});

/* POST /api/llc-guide/plan { state, creatorType, businessName? }
   → 200 { plan, creditsUsed, creditsRemaining }
   Paid: 1 credit per plan. */
router.post("/llc-guide/plan", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = planSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid plan request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const creditsRemaining = await chargeOr402(req, res, "LLC Guide Filing Plan");
  if (creditsRemaining === null) return;

  const { state, creatorType, businessName } = parsed.data;
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: PLAN_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildPlanUserPrompt(state, creatorType, businessName ?? ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      temperature: 0.4,
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const plan = parsePlanJson(raw);
    res.json({ plan, creditsUsed: LLC_GUIDE_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refundCredits(req.userId!, LLC_GUIDE_CREDIT_COST, {
      action: "LLC Guide Filing Plan (provider failure refund)",
    }).catch(() => {});
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[llc-guide] OpenAI rate limit / quota");
      res.status(503).json({ error: "The guide is catching its breath — try again in a moment. (Credit refunded.)" });
      return;
    }
    logger.error({ err }, "[llc-guide] plan failed");
    res.status(502).json({ error: "The guide hiccupped — try again. (Credit refunded.)" });
  }
});

export default router;
