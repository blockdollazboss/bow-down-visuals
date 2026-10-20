import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../lib/credits";
import {
  buildChatSystemPrompt,
  CHAT_MAX_OUTPUT_TOKENS,
  getChatCreditCost,
} from "../lib/ai-chat-assistant";
import { findInventedPrice, PRICE_FALLBACK_REPLY } from "../lib/operator-knowledge";
import { buildReplyDoors, processOperatorPreTurn, processOperatorReply } from "../lib/operator-chat";
import { resolveOptionalSession } from "../lib/optional-auth";

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
    : async (req: Request, _res: Response, next: NextFunction) => {
        /* Free mode stays guest-open (no 401s, contract unchanged) —
           but a signed-in member's session still resolves, so the
           operator's hands (Phase 2) can act as them. */
        await resolveOptionalSession(req);
        next();
      };

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

  /* Tier 1 doors (Phase 2 Lane C): computed once from the member's own
     message by the shared chat implementation — a door rides the reply
     only when the knowledge base matched a feature with a real path. */
  const doors = buildReplyDoors(message.trim());
  const doorPayload = doors.length ? { doors } : {};

  /* Operator Phase 2 — a live pending confirmation gets first claim on
     this message: a clear "yes" consumes it and runs the action, a
     clear "no" cancels it — no model call, and no per-message chat
     charge for the confirmation turn itself (the action's own rail
     charge is the only charge). Needs a session; guests skip it. */
  const preTurn = await processOperatorPreTurn({
    userId: req.userId,
    userEmail: req.userEmail,
    channel: "chat_text",
    message: message.trim(),
  }).catch((err) => {
    logger.error({ err }, "[chat] operator pre-turn failed — falling through to the model");
    return null;
  });
  if (preTurn) {
    res.json({ reply: preTurn.replyText, model: null, creditCost: chatCreditCost, action: preTurn.action, ...doorPayload });
    return;
  }

  /* Optional paid mode: charge first, but refund on any model failure below.
     Charge-then-refund keeps the 402 pre-check simple while guaranteeing
     the user never pays for a failed generation. */
  let chatCharged = false;
  if (chatCreditCost > 0) {
    const balance = req.userCredits ?? 0;
    if (balance < chatCreditCost) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to keep chatting with Thy Cheat Code.",
      });
      return;
    }
    try {
      await chargeCredits(req.userId!, chatCreditCost, { action: "AI Chat Assistant" });
      chatCharged = true;
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of Visual Bucs — top up to keep chatting with Thy Cheat Code.",
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no Visual Bucs were charged. Please try again." });
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
        { role: "system", content: buildChatSystemPrompt(message) },
        ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
        { role: "user", content: message.trim() },
      ],
      max_completion_tokens: CHAT_MAX_OUTPUT_TOKENS,
      temperature: 0.7,
    });

    let reply =
      completion.choices[0]?.message?.content?.trim() ||
      "My fins slipped — could you ask that again? 🦈";

    /* Operator Phase 2 — an action marker in the reply hands the turn
       to the executor: free tools run now and the reply becomes the
       executor's code-composed outcome; charged tools become a
       server-composed proposal awaiting the member's yes. Executor
       replies are code-authored from rail results, so the price guard
       below does not apply to them — it guards model text only. */
    const actionTurn = await processOperatorReply({
      userId: req.userId,
      userEmail: req.userEmail,
      channel: "chat_text",
      modelReply: reply,
    }).catch((err) => {
      logger.error({ err }, "[chat] operator action turn failed — answering without hands");
      return null;
    });
    if (actionTurn) {
      res.json({ reply: actionTurn.replyText, model, creditCost: chatCreditCost, action: actionTurn.action, ...doorPayload });
      return;
    }

    /* No-invention guard (Cloud Operator Phase 1): if the model still
       quoted a VB figure that exists nowhere in the generated knowledge
       base, the reply does not ship — an honest no-number answer does. */
    const invented = findInventedPrice(reply);
    if (invented !== null) {
      logger.warn({ invented }, "[chat] reply quoted a price outside the knowledge base — replaced");
      reply = PRICE_FALLBACK_REPLY;
    }

    res.json({ reply, model, creditCost: chatCreditCost, ...doorPayload });
  } catch (err) {
    /* Refund: the model call failed after we charged — the user must not
       pay for a failed generation. */
    if (chatCharged) {
      await refundCredits(req.userId!, chatCreditCost, {
        action: "AI Chat Assistant — Refund (model failed)",
      }).catch((refundErr) => {
        logger.error({ refundErr }, "[chat] refund failed after model error");
      });
    }
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
