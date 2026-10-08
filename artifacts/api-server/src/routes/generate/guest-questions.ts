import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── Podcast Guest Question Generator ───
   POST /api/guest-questions: takes a guest name, an episode topic, and
   OPTIONAL pasted research (bio / links text). It works ONLY from what the
   user pastes — there is deliberately no web lookup, and the prompt forbids
   the model from inventing biographical facts about the guest. 75 Visual
   Bucs per set (env-overridable via GUEST_QUESTIONS_CREDITS). */

export const GUEST_QUESTIONS_CREDIT_COST =
  Number(process.env["GUEST_QUESTIONS_CREDITS"]) || 75;

const guestQuestionsSchema = z.object({
  guestName: z.string().trim().min(1, "Tell us the guest's name.").max(100),
  topic: z
    .string()
    .trim()
    .min(1, "Tell us what the interview is about.")
    .max(300),
  /** Pasted bio / links / research. The ONLY source material the model may use. */
  bio: z.string().trim().max(5000).optional().default(""),
});

export type GuestQuestion = { question: string; why: string };
export type GuestQuestionsResult = {
  warmup: GuestQuestion[];
  deepDive: GuestQuestion[];
  rapidFire: GuestQuestion[];
  closer: GuestQuestion[];
};

/** Build the system prompt for a guest-question request. Exported for tests. */
export function buildGuestQuestionsPrompt(input: z.infer<typeof guestQuestionsSchema>): string {
  const bioLine = input.bio.trim()
    ? `The ONLY source of facts about the guest is the research below — use it, quote it back where useful, and never invent shows, companies, stats, dates, or quotes that aren't in it.\nRESEARCH:\n"""${input.bio.trim()}"""`
    : `No research was provided, so DO NOT invent any facts about this guest — no show names, companies, stats, or quotes. Write sharp topic-level questions that fit any expert in this space, phrased so the host can adapt them live.`;
  return (
    `You are an elite podcast interview producer. Generate 12-15 interview ` +
    `questions for a podcast interview with guest "${input.guestName.trim()}" ` +
    `about "${input.topic.trim()}". ` +
    `${bioLine} ` +
    `Question quality bar: open-ended, specific, story-driven — never "yes/no" ` +
    `and never generic filler like "tell us about yourself". Every question ` +
    `needs a one-line note on WHY it works (what it draws out of the guest, ` +
    `or the tension it plays with). ` +
    `Structure: ` +
    `(1) WARM-UP — exactly 2 questions: easy, human, gets them talking and relaxed. ` +
    `(2) DEEP DIVE — 6 to 8 questions: the meat of the interview — craft, opinions, ` +
    `failures, craft details, the "only you could answer this" stuff. ` +
    `(3) RAPID-FIRE — exactly 3 questions: fun, quick-hit, high energy. ` +
    `(4) CLOSER — exactly 2 questions: audience-style (the kind a listener would ` +
    `submit) and a final forward-looking question. ` +
    `Return ONLY JSON: {"warmup": [{"question": "...", "why": "..."}, ...], ` +
    `"deepDive": [{"question": "...", "why": "..."}, ...], ` +
    `"rapidFire": [{"question": "...", "why": "..."}, ...], ` +
    `"closer": [{"question": "...", "why": "..."}, ...]}.`
  );
}

function cleanQuestions(raw: unknown, max: number): GuestQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (q): q is { question: string; why: string } =>
        !!q &&
        typeof (q as { question?: unknown }).question === "string" &&
        typeof (q as { why?: unknown }).why === "string"
    )
    .map((q) => ({
      question: String(q.question).trim(),
      why: String(q.why).trim(),
    }))
    .filter((q) => q.question.length > 0)
    .slice(0, max);
}

/* POST /api/guest-questions { guestName, topic, bio? }
   → 200 { guestName, topic, warmup, deepDive, rapidFire, closer,
           total, creditsUsed, creditsRemaining }
   Paid: 75 Visual Bucs. Auth required; credits are deducted BEFORE the
   model call and REFUNDED if the provider fails (money-integrity rule). */
router.post("/guest-questions", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = guestQuestionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid question request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < GUEST_QUESTIONS_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to keep prepping interviews.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, GUEST_QUESTIONS_CREDIT_COST, {
      action: "Podcast Guest Questions",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to keep prepping interviews.",
      });
      return;
    }
    throw err;
  }

  let charged = true;
  try {
    const input = parsed.data;
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: buildGuestQuestionsPrompt(input) },
        {
          role: "user",
          content: `Generate the full interview question set for guest "${input.guestName.trim()}" about "${input.topic.trim()}".`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2500,
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let warmup: GuestQuestion[] = [];
    let deepDive: GuestQuestion[] = [];
    let rapidFire: GuestQuestion[] = [];
    let closer: GuestQuestion[] = [];
    try {
      const parsedJson = JSON.parse(raw) as {
        warmup?: unknown;
        deepDive?: unknown;
        rapidFire?: unknown;
        closer?: unknown;
      };
      warmup = cleanQuestions(parsedJson.warmup, 3);
      deepDive = cleanQuestions(parsedJson.deepDive, 10);
      rapidFire = cleanQuestions(parsedJson.rapidFire, 4);
      closer = cleanQuestions(parsedJson.closer, 3);
    } catch {
      /* fall through to the empty check below */
    }
    const total = warmup.length + deepDive.length + rapidFire.length + closer.length;
    if (total < 10 || warmup.length === 0 || deepDive.length === 0) {
      throw new Error("Model returned no usable question set");
    }

    charged = false; // success — no refund
    res.json({
      guestName: input.guestName.trim(),
      topic: input.topic.trim(),
      warmup,
      deepDive,
      rapidFire,
      closer,
      total,
      creditsUsed: GUEST_QUESTIONS_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, GUEST_QUESTIONS_CREDIT_COST, {
          action: "Podcast Guest Questions — Refund (generation failed)",
        });
        creditsRemaining = balance;
      } catch (refundErr) {
        // Logged inside refundCredits; don't mask the original failure.
        void refundErr;
      }
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[guest-questions] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[guest-questions] generation failed");
    res.status(502).json({ error: "The studio hiccupped — your Visual Bucs were refunded. Try again." });
  }
});

export default router;
