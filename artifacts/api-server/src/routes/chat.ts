import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { deductCredits, OutOfCreditsError } from "../lib/credits";
import { recordCreditUsage } from "../lib/payment-record";
import {
  CHAT_SYSTEM_PROMPT,
  CHAT_MAX_OUTPUT_TOKENS,
  getChatCreditCost,
} from "../lib/ai-chat-assistant";

const router = Router();

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* Cap client-supplied history so a long conversation can't inflate token cost. */
const MAX_HISTORY_TURNS = 6;

const historyItemSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(2000),
});

const chatSchema = z.object({
  message: z.string().min(1, "Message is required.").max(2000, "Message is too long (max 2000 characters)."),
  history: z.array(historyItemSchema).max(12).optional().default([]),
});

/* POST /api/chat { message, history? } → 200 { reply, model }
   Free by default (CHAT_CREDIT_COST=0): a sales/support tool, rate-limited per IP.
   Set CHAT_CREDIT_COST > 0 to charge credits per message — auth then required. */
const chatCreditCost = getChatCreditCost();
const maybeAuth =
  chatCreditCost > 0
    ? requireAuth
    : (_req: Request, _res: Response, next: NextFunction) => next();

router.post("/chat", publicApiLimiter, maybeAuth, async (req, res) => {
  const parsed = chatSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid chat request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { message } = parsed.data;
  const history = parsed.data.history.slice(-MAX_HISTORY_TURNS);

  /* Optional paid mode: deduct before calling the model. */
  if (chatCreditCost > 0) {
    const balance = req.userCredits ?? 0;
    if (balance < chatCreditCost) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep chatting with Thy Cheat Code.",
      });
      return;
    }
    try {
      await deductCredits(req.userId!, chatCreditCost);
      recordCreditUsage({
        userId: req.userId!,
        action: "AI Chat Assistant",
        creditsUsed: chatCreditCost,
      }).catch(() => {});
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to keep chatting with Thy Cheat Code.",
        });
        return;
      }
      throw err;
    }
  }

  try {
    const model = getTextModel();
    const completion = await getOpenAI().chat.completions.create({
      model,
      messages: [
        { role: "system", content: CHAT_SYSTEM_PROMPT },
        ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
        { role: "user", content: message.trim() },
      ],
      max_tokens: CHAT_MAX_OUTPUT_TOKENS,
      temperature: 0.7,
    });

    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      "My fins slipped — could you ask that again? 🦈";

    res.json({ reply, model, creditCost: chatCreditCost });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[chat] OpenAI rate limit / quota");
      res.status(503).json({
        error: "I'm catching my breath — try again in a moment. 🦈",
      });
      return;
    }
    logger.error({ err }, "[chat] OpenAI request failed");
    res.status(500).json({
      error: "Something went wrong on my end — give me another shot. 🦈",
    });
  }
});

/* GET /api/chat/status → { creditCost } — lets the widget show the
   per-message price upfront instead of hardcoding it. */
router.get("/chat/status", (_req: Request, res: Response) => {
  res.json({ creditCost: chatCreditCost });
});

export default router;
