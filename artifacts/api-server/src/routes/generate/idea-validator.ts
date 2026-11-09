import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError,
  buildChargeIdempotencyKey, voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI content idea validator ───
   Scores a raw content idea before the creator invests time filming it:
   virality potential, competition level, and audience fit, then delivers a
   go / pivot / no-go verdict with concrete pivot angles for weak ideas.
   75 Visual Bucs. */

const IDEA_VALIDATOR_COST = Number(process.env["IDEA_VALIDATOR_CREDITS"]) || 75;

const PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_DIRECTION: Record<Platform, string> = {
  tiktok: "TikTok (fast scroll, trending sounds, comment-bait, 7-21s sweet spot)",
  instagram: "Instagram Reels (polished aesthetic, share/save driven, SEO captions)",
  youtube: "YouTube Shorts & long-form (title-led discovery, watch-time, subscribe CTA)",
  x: "X / Twitter (quote-post amplification, concise copy, thread potential)",
};

const ideaValidatorSchema = z.object({
  /** The raw content idea to validate, e.g. "ranking my beats from worst to best". */
  idea: z.string().trim().min(5, "Idea must be at least 5 characters.").max(500),
  /** Creator's niche, e.g. "music production", "fitness", "comedy". */
  niche: z.string().trim().min(2, "Niche must be at least 2 characters.").max(100),
  /** Target platform. */
  platform: z.enum(PLATFORMS),
  /** Optional: who the creator is trying to reach. Sharpens audience-fit scoring. */
  targetAudience: z.string().trim().max(200).optional().default(""),
});

interface ScoreBreakdown {
  label: string;
  score: number;
  reasoning: string;
}

interface IdeaPivot {
  angle: string;
  whyItWorks: string;
}

interface IdeaVerdict {
  verdict: "go" | "pivot" | "no-go";
  overallScore: number;
  scores: {
    virality: ScoreBreakdown;
    competition: ScoreBreakdown;
    audienceFit: ScoreBreakdown;
  };
  strengths: string[];
  risks: string[];
  pivots: IdeaPivot[];
  /** One-line verdict summary the creator can act on immediately. */
  summary: string;
}

/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request re-charged 75 and re-ran the model. Now the
   server derives the key from the request intent on EVERY call, a
   stored-result pre-check (durable table, migration 0333, then the
   in-process cache) answers a replay with no charge and no provider
   call, and a failed attempt refunds AND voids its key so a genuine
   retry charges fresh. An identical ask serves the stored verdict
   with replayed: true instead of charging again (C-36 ruling). */
const IDEA_VALIDATOR_SCOPE = "idea-validator";
const IDEA_VALIDATOR_REPLAY_NOTE =
  "This is the verdict you already got for this idea — tweak the idea, niche or platform for a fresh take.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetIdeaValidatorReplayCache(): void {
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
    ...body, replayed: true, replayNote: IDEA_VALIDATOR_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(IDEA_VALIDATOR_SCOPE, idempotencyKey, userId);
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
    await storeGenerationResult(IDEA_VALIDATOR_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

router.get("/idea-validator-info", requireAuth, (_req, res) => {
  res.json({
    platforms: PLATFORMS.map((p) => ({ id: p, label: PLATFORM_DIRECTION[p] })),
    price: IDEA_VALIDATOR_COST,
    verdicts: ["go", "pivot", "no-go"],
  });
});

async function runIdeaValidation(
  userId: string,
  userCredits: number,
  data: z.infer<typeof ideaValidatorSchema>,
  idempotencyKey: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<Record<string, unknown>> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      __status: 503,
      error: "OPENAI_API_KEY is not configured — this AI feature is unavailable.",
    };
  }
  if (userCredits < IDEA_VALIDATOR_COST) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    };
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(userId, IDEA_VALIDATOR_COST, {
      action: "Idea Validator",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return { __status: 402, error: "out_of_credits", message: "Not enough Visual Bucs." };
    }
    throw err;
  }

  try {
    const model = getTextModel();
    const audienceLine = data.targetAudience
      ? `Target audience: ${data.targetAudience}\n`
      : "";

    const prompt =
      `You are a ruthless content strategist who has studied what goes viral and what flops. ` +
      `Validate this content idea honestly — do not sugarcoat.\n\n` +
      `Content idea: ${data.idea}\n` +
      `Niche: ${data.niche}\n` +
      `Platform: ${PLATFORM_DIRECTION[data.platform]}\n` +
      `${audienceLine}\n` +
      `Score three dimensions, each 1-100:\n` +
      `- virality: how likely this idea is to earn shares, saves, and comments on this platform (hooks, novelty, emotional triggers, trend alignment)\n` +
      `- competition: how SATURATED this angle is (score HIGH = low competition / blue ocean; score LOW = overdone, crowded)\n` +
      `- audienceFit: how well this idea serves the stated niche and target audience\n\n` +
      `Then give a verdict:\n` +
      `- "go" if overall strong (avg of the three scores >= 70)\n` +
      `- "pivot" if the core is workable but the angle needs changing (avg 40-69)\n` +
      `- "no-go" if fundamentally weak (avg < 40)\n\n` +
      `For "pivot" and "no-go" verdicts, provide 3 concrete pivot angles — same idea, sharper packaging. ` +
      `For "go", still provide 2 angles that would make it even stronger.\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{"verdict": "go", "overallScore": 82, ` +
      `"virality": {"label": "Virality Potential", "score": 85, "reasoning": "..."}, ` +
      `"competition": {"label": "Competition", "score": 70, "reasoning": "..."}, ` +
      `"audienceFit": {"label": "Audience Fit", "score": 90, "reasoning": "..."}, ` +
      `"strengths": ["..."], "risks": ["..."], ` +
      `"pivots": [{"angle": "...", "whyItWorks": "..."}], ` +
      `"summary": "One sentence a creator can act on."}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("Idea validation failed.");
    const respData = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = respData.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty idea validation result.");

    const raw = JSON.parse(content) as {
      verdict?: string;
      overallScore?: number;
      virality?: { label?: string; score?: number; reasoning?: string };
      competition?: { label?: string; score?: number; reasoning?: string };
      audienceFit?: { label?: string; score?: number; reasoning?: string };
      strengths?: string[];
      risks?: string[];
      pivots?: Array<{ angle?: string; whyItWorks?: string }>;
      summary?: string;
    };

    const clamp = (n: unknown) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return 50;
      return Math.max(1, Math.min(100, Math.round(v)));
    };
    const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);
    const scoreOf = (s: { label?: string; score?: number; reasoning?: string } | undefined, fallback: string): ScoreBreakdown => ({
      label: clean(s?.label, 60) || fallback,
      score: clamp(s?.score),
      reasoning: clean(s?.reasoning, 500) || "No reasoning provided.",
    });

    const scores = {
      virality: scoreOf(raw.virality, "Virality Potential"),
      competition: scoreOf(raw.competition, "Competition"),
      audienceFit: scoreOf(raw.audienceFit, "Audience Fit"),
    };
    const avg = Math.round((scores.virality.score + scores.competition.score + scores.audienceFit.score) / 3);
    const verdict: IdeaVerdict["verdict"] =
      raw.verdict === "go" || raw.verdict === "pivot" || raw.verdict === "no-go"
        ? raw.verdict
        : avg >= 70 ? "go" : avg >= 40 ? "pivot" : "no-go";

    const strengths = (Array.isArray(raw.strengths) ? raw.strengths : [])
      .map((s) => clean(s, 200))
      .filter((s) => s.length > 0)
      .slice(0, 5);
    const risks = (Array.isArray(raw.risks) ? raw.risks : [])
      .map((s) => clean(s, 200))
      .filter((s) => s.length > 0)
      .slice(0, 5);
    const pivots: IdeaPivot[] = (Array.isArray(raw.pivots) ? raw.pivots : [])
      .filter((p) => p && clean(p.angle, 1).length > 0)
      .slice(0, 4)
      .map((p) => ({
        angle: clean(p.angle, 300),
        whyItWorks: clean(p.whyItWorks, 300) || "Fresh angle on the same idea.",
      }));

    if (!clean(raw.summary, 1)) throw new Error("No verdict was generated.");

    const result: IdeaVerdict = {
      verdict,
      overallScore: clamp(raw.overallScore ?? avg),
      scores,
      strengths,
      risks,
      pivots,
      summary: clean(raw.summary, 300),
    };

    return {
      verdict: result,
      creditsRemaining: creditsAfter,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Idea validation failed.";
    log.error({ err: message }, "[idea-validator] failed");
    /* Refund + VOID so a genuine retry charges fresh instead of
       being suppressed as a replay and running free. */
    let refunded = true;
    try {
      await refundCredits(userId, IDEA_VALIDATOR_COST, {
        action: "Idea Validator — Refund",
      });
    } catch {
      refunded = false;
    }
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey);
    }
    return { __status: 500, error: message };
  }
}

router.post("/validate-idea", requireAuth, async (req, res) => {
  const parsed = ideaValidatorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* Idempotency (CA-3): the server derives the key from the request
     intent on EVERY call — a replay of the same ask is served from
     the stored verdict instead of charging again. */
  const idempotencyKey = buildChargeIdempotencyKey(
    IDEA_VALIDATOR_SCOPE, req.userId!, undefined,
    {
      idea: parsed.data.idea, niche: parsed.data.niche,
      platform: parsed.data.platform, targetAudience: parsed.data.targetAudience,
    },
  );

  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runIdeaValidation(
      req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey, req.log,
    ),
  });
});

export default router;
