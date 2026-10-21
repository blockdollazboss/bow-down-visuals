import { Router, Request, Response } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── AI Interview ─────────────────────────────────────────────────────────
   Two endpoints that turn a creator's interview (guest, topic, collab) into
   content ammunition:

   POST /api/ai-interview/questions — 100 Visual Bucs.
     GPT-6 Sol writes 5 sharp, angle-driven interview questions on a topic.

   POST /api/ai-interview/package — 200 Visual Bucs.
     Given the 5 answered Q&As, GPT-6 Sol produces 5 clip-worthy moments
     (timestamp-agnostic: quote + why), 3 punchy quote cards, and a 60s
     promo cut outline (ordered beats).

   Both follow the standard pattern: requireAuth + publicApiLimiter, 402
   pre-check, charge BEFORE the model call, refund + 502 on failure. */

const QUESTIONS_CREDITS =
  Number(process.env["AI_INTERVIEW_QUESTIONS_CREDITS"]) || 100;
const PACKAGE_CREDITS =
  Number(process.env["AI_INTERVIEW_PACKAGE_CREDITS"]) || 200;

const questionsSchema = z.object({
  topic: z.string().min(1, "Topic is required.").max(300),
  niche: z.string().max(120).optional().default(""),
});

const qaItemSchema = z.object({
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(2000),
});
const packageSchema = z.object({
  topic: z.string().min(1, "Topic is required.").max(300),
  qa: z.array(qaItemSchema).length(5, "Exactly 5 answered Q&As are required."),
});

interface ClipMoment {
  quote: string;
  why: string;
}

function parseClips(raw: unknown): ClipMoment[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipMoment[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const e = c as Record<string, unknown>;
    const quote = String(e["quote"] ?? "").trim().slice(0, 500);
    const why = String(e["why"] ?? "").trim().slice(0, 400);
    if (!quote || !why) continue;
    out.push({ quote, why });
    if (out.length >= 5) break;
  }
  return out;
}

function parseStringList(raw: unknown, max: number, len: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, len))
    .slice(0, max);
}

/** Shared charge-upfront helper; returns remaining balance or sends the 402. */
async function chargeOr402(
  req: Request,
  res: Response,
  amount: number,
  action: string,
): Promise<number | null> {
  const balance = req.userCredits ?? 0;
  if (balance < amount) {
    res.status(402).json({ error: "out_of_credits", message: `Not enough Visual Bucs — ${action} costs ${amount} Visual Bucs.` });
    return null;
  }
  try {
    return await chargeCredits(req.userId!, amount, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: `Not enough Visual Bucs — ${action} costs ${amount} Visual Bucs.` });
      return null;
    }
    throw err;
  }
}

async function refundOnFailure(reqUserId: string, amount: number, action: string) {
  try {
    await refundCredits(reqUserId, amount, { action: `${action} — Refund` });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId: reqUserId }, "[ai-interview] refund failed");
  }
}

/* POST /api/ai-interview/questions { topic, niche? }
   → 200 { questions[5], creditsUsed, creditsRemaining } */
router.post("/ai-interview/questions", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = questionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid interview request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await chargeOr402(req, res, QUESTIONS_CREDITS, "AI Interview Questions");
  if (creditsRemaining === null) return;

  const { topic, niche } = parsed.data;
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a sharp interview producer for creator-led shows. Write 5 interview ` +
            `questions on the given topic — NOT generic ("what inspires you?"). Each question ` +
            `must have a specific angle: challenge an assumption, dig into a hard decision, ` +
            `ask for the untold story, force a hot take, or unpack a process detail. ` +
            `Questions a guest would actually enjoy answering and viewers would clip. ` +
            `Return ONLY JSON: {"questions": ["<q1>", "<q2>", "<q3>", "<q4>", "<q5>"]}. Exactly 5.`,
        },
        {
          role: "user",
          content:
            `Write 5 interview questions.\nTopic: ${topic.trim()}` +
            (niche.trim() ? `\nNiche: ${niche.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1000,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let questions: string[] = [];
    try {
      const j = JSON.parse(raw) as { questions?: unknown };
      questions = parseStringList(j.questions, 5, 500);
    } catch { /* fall through to the empty check below */ }
    if (questions.length === 0) {
      throw new Error("The interviewer returned no usable questions.");
    }

    res.json({ questions, creditsUsed: QUESTIONS_CREDITS, creditsRemaining });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Interview question generation failed";
    logger.error({ err, userId: req.userId }, "[ai-interview] questions failed");
    await refundOnFailure(req.userId!, QUESTIONS_CREDITS, "AI Interview Questions");
    res.status(502).json({ error: msg, refunded: true });
  }
});

/* POST /api/ai-interview/package { topic, qa[5 × {question, answer}] }
   → 200 { clips[{quote, why}], quoteCards[3], promoOutline[], creditsUsed, creditsRemaining } */
router.post("/ai-interview/package", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = packageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid package request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await chargeOr402(req, res, PACKAGE_CREDITS, "AI Interview Package");
  if (creditsRemaining === null) return;

  const { topic, qa } = parsed.data;
  const transcript = qa
    .map((item, i) => `Q${i + 1}: ${item.question.trim()}\nA${i + 1}: ${item.answer.trim()}`)
    .join("\n\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a viral clip editor for creator interviews. Given a topic and 5 answered ` +
            `Q&As, you extract the content ammunition:\n` +
            `1. clips: the 5 most clip-worthy moments — timestamp-agnostic (no timestamps), each ` +
            `a short quotable quote from the answers (VERBATIM, never invented) plus one line on ` +
            `WHY it will travel (controversy, quotable wisdom, story reveal, laugh, hot take).\n` +
            `2. quoteCards: 3 short punchy quote-card texts (under 25 words each, punchy enough ` +
            `to stop a scroll).\n` +
            `3. promoOutline: ordered beats for a 60-second promo cut — 5-8 beats, each one line ` +
            `("Open on the hottest quote…", "Cut to the story behind it…", "End on the CTA"), ` +
            `building to a climax.\n` +
            `Return ONLY JSON:\n` +
            `{"clips": [{"quote": "...", "why": "..."}], ` +
            `"quoteCards": ["...", "...", "..."], ` +
            `"promoOutline": ["...", ...]}\n` +
            `Exactly 5 clips, exactly 3 quote cards, 5-8 promo beats.`,
        },
        {
          role: "user",
          content: `Package this interview.\nTopic: ${topic.trim()}\n\n${transcript}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let clips: ClipMoment[] = [];
    let quoteCards: string[] = [];
    let promoOutline: string[] = [];
    try {
      const j = JSON.parse(raw) as { clips?: unknown; quoteCards?: unknown; promoOutline?: unknown };
      clips = parseClips(j.clips);
      quoteCards = parseStringList(j.quoteCards, 3, 200);
      promoOutline = parseStringList(j.promoOutline, 8, 300);
    } catch { /* fall through to the empty check below */ }
    if (clips.length === 0) {
      throw new Error("The interviewer returned no usable clip moments.");
    }

    res.json({
      clips,
      quoteCards,
      promoOutline,
      creditsUsed: PACKAGE_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Interview packaging failed";
    logger.error({ err, userId: req.userId }, "[ai-interview] package failed");
    await refundOnFailure(req.userId!, PACKAGE_CREDITS, "AI Interview Package");
    res.status(502).json({ error: msg, refunded: true });
  }
});

export default router;
