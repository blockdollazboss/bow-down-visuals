import { Router, type Response } from "express";
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
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import { getLlcStateFee, LLC_STATE_CODES } from "../../lib/llc-state-fees";

const router = Router();

/* 1 credit per AI answer / plan — env-overridable without a deploy.
   A Q&A answer or filing plan is a short GPT-6 Sol completion (a fraction
   of a cent in provider fees), so 1 credit holds a deep margin while
   honoring the standing rule: every AI feature costs a fee. The static
   checklist, fee table, estimator, and FAQ on the page are pure UI and
   stay free. */
export const LLC_GUIDE_CREDIT_COST =
  Number(process.env["LLC_GUIDE_CREDIT_COST"]) || 100;

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

/* Text model: centralized in getTextModel() (default gpt-6.1-sol, env-overridable
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


/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request re-charged and re-ran the work. Now the server
   derives the key from the request intent on EVERY call, a
   stored-result pre-check (durable table, migration 0333, then the
   in-process cache) answers a replay with no charge and no provider
   call, and a failed attempt refunds AND voids its key so a genuine
   retry charges fresh. An identical ask serves the stored result
   with replayed: true instead of charging again (C-36 ruling). */
const LLC_GUIDE_SCOPE = "llc-guide";
const LLC_GUIDE_REPLAY_NOTE =
  "This is the answer you already got for this request — change the question or details for a fresh one.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetLlcGuideReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

/**
 * Serve one replayable run: durable + in-process stored-result
 * pre-checks before any funding, the in-flight twin wait for a
 * concurrent duplicate, then the run itself. A success is stored
 * BEFORE answering (contracts / post-assist pattern); an error body
 * (carrying __status) is answered bare and never stored.
 */
async function serveReplayableRun(args: {
  res: Response;
  userId: string;
  idempotencyKey: string;
  run: () => Promise<Record<string, unknown>>;
}): Promise<void> {
  const { res, userId, idempotencyKey } = args;
  const replayOf = (body: Record<string, unknown>) => ({
    ...body, replayed: true, replayNote: LLC_GUIDE_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(LLC_GUIDE_SCOPE, idempotencyKey, userId);
  if (durable) {
    res.json(replayOf(durable));
    return;
  }
  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json(replayOf(stored.body));
    return;
  }
  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json(replayOf(twinBody));
      return;
    }
    /* The twin failed (refunded + key voided) — fall through fresh. */
  }

  const runPromise = args.run();
  inFlight.set(idempotencyKey, runPromise);
  let body: Record<string, unknown>;
  try {
    body = await runPromise;
  } finally {
    if (inFlight.get(idempotencyKey) === runPromise) inFlight.delete(idempotencyKey);
  }

  const status = typeof body["__status"] === "number" ? (body["__status"] as number) : 200;
  if (status !== 200) {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult(LLC_GUIDE_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

/* Shared charge-then-generate flow: deduct up front, refund on a
   provider failure so creators never pay for an error. CA-3: the
   charge carries the request's idempotency key (the helper is the
   single charge site for BOTH the ask and plan rails — keying it
   here, with the intent threaded from each caller, closes both),
   and every refund VOIDS the key so a genuine retry charges fresh. */
async function chargeForRun(
  userId: string,
  userCredits: number,
  action: string,
  idempotencyKey: string,
): Promise<{ creditsRemaining: number } | { errorBody: Record<string, unknown> }> {
  const balance = userCredits;
  if (balance < LLC_GUIDE_CREDIT_COST) {
    return {
      errorBody: {
        __status: 402,
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to use the AI LLC guide.",
      },
    };
  }
  try {
    return {
      creditsRemaining: await chargeCredits(userId, LLC_GUIDE_CREDIT_COST, { action }, { idempotencyKey }),
    };
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        errorBody: {
          __status: 402,
          error: "out_of_credits",
          message: "You're out of Visual Bucs — top up to use the AI LLC guide.",
        },
      };
    }
    throw err;
  }
}

async function refundAndVoid(
  userId: string,
  action: string,
  idempotencyKey: string,
): Promise<void> {
  let refunded = true;
  try {
    await refundCredits(userId, LLC_GUIDE_CREDIT_COST, { action });
  } catch {
    refunded = false;
  }
  if (refunded) {
    await voidChargeIdempotencyKey(idempotencyKey);
  }
}

async function runLlcGuideAsk(
  userId: string,
  userCredits: number,
  data: z.infer<typeof askSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const charged = await chargeForRun(userId, userCredits, "LLC Guide Q&A", idempotencyKey);
  if ("errorBody" in charged) return charged.errorBody;
  const creditsRemaining = charged.creditsRemaining;

  const { question, state, history } = data;
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
    });
    const answer =
      completion.choices[0]?.message?.content?.trim() ||
      "My fins slipped — ask that again? 🦈";
    return { answer, creditsUsed: LLC_GUIDE_CREDIT_COST, creditsRemaining };
  } catch (err) {
    await refundAndVoid(userId, "LLC Guide Q&A (provider failure refund)", idempotencyKey);
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[llc-guide] OpenAI rate limit / quota");
      return { __status: 503, error: "The guide is catching its breath — try again in a moment. (Visual Buc refunded.)" };
    }
    logger.error({ err }, "[llc-guide] ask failed");
    return { __status: 502, error: "The guide hiccupped — try again. (Visual Buc refunded.)" };
  }
}

/* POST /api/llc-guide/ask { question, state?, history? }
   → 200 { answer, creditsUsed, creditsRemaining }
   Paid: 1 credit per answer. */
router.post("/llc-guide/ask", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = askSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid question.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const idempotencyKey = buildChargeIdempotencyKey(
    LLC_GUIDE_SCOPE, req.userId!, undefined, { product: "ask", ...parsed.data },
  );
  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runLlcGuideAsk(req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey),
  });
});

async function runLlcGuidePlan(
  userId: string,
  userCredits: number,
  data: z.infer<typeof planSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const charged = await chargeForRun(userId, userCredits, "LLC Guide Filing Plan", idempotencyKey);
  if ("errorBody" in charged) return charged.errorBody;
  const creditsRemaining = charged.creditsRemaining;

  const { state, creatorType, businessName } = data;
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
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const plan = parsePlanJson(raw);
    return { plan, creditsUsed: LLC_GUIDE_CREDIT_COST, creditsRemaining };
  } catch (err) {
    await refundAndVoid(userId, "LLC Guide Filing Plan (provider failure refund)", idempotencyKey);
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[llc-guide] OpenAI rate limit / quota");
      return { __status: 503, error: "The guide is catching its breath — try again in a moment. (Visual Buc refunded.)" };
    }
    logger.error({ err }, "[llc-guide] plan failed");
    return { __status: 502, error: "The guide hiccupped — try again. (Visual Buc refunded.)" };
  }
}

/* POST /api/llc-guide/plan { state, creatorType, businessName? }
   → 200 { plan, creditsUsed, creditsRemaining }
   Paid: 1 credit per plan. */
router.post("/llc-guide/plan", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = planSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid plan request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const idempotencyKey = buildChargeIdempotencyKey(
    LLC_GUIDE_SCOPE, req.userId!, undefined, { product: "plan", ...parsed.data },
  );
  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runLlcGuidePlan(req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey),
  });
});

export default router;
