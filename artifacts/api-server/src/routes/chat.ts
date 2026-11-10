import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../lib/generation-stored-results";
import {
  buildChatSystemPrompt,
  CHAT_MAX_OUTPUT_TOKENS,
  getChatCreditCost,
} from "../lib/ai-chat-assistant";
import { findInventedPrice, PRICE_FALLBACK_REPLY } from "../lib/operator-knowledge";
import { buildReplyDoors, processOperatorIntentTurn, processOperatorPreTurn, processOperatorReply } from "../lib/operator-chat";
import { resolveOptionalSession } from "../lib/optional-auth";

const router = Router();

/* Text model: centralized in getTextModel() (default gpt-6.1-sol, env-overridable
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
   No separate charge by default — getChatCreditCost() in
   lib/ai-chat-assistant.ts defaults CHAT_CREDIT_COST to 0 (owner
   ruling, Oct 27: /api/chat carries no separate charge), so the rail
   is free and guest-open by default. An explicit CHAT_CREDIT_COST > 0
   in the environment re-enables the per-message charge (and auth). */
const chatCreditCost = getChatCreditCost();

/* Chat-key (house Pattern A): the replay note a paid replay carries,
   and the in-flight twin map for the paid chat rail — an identical
   message already being answered shares its run instead of paying
   for a second model call. Both live only inside the paid branch
   below; free mode (the default) never touches either. */
export const CHAT_REPLAY_NOTE =
  "This is the answer you already got for this message — tweak the words for a fresh one.";
const chatInFlight = new Map<string, Promise<Record<string, unknown> | null>>();
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

router.post("/chat", maybeAuth, publicApiLimiter, async (req, res) => {
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

  /* Deterministic intent (payfix operator-hands): a clear charged
     request or the capability question is handled in code BEFORE the
     model and before any per-message chat charge — the proposal turn
     charges nothing; the action's own rail charge on "yes" is the
     only charge. Same shared protocol as /api/free-chat. */
  const intentTurn = await processOperatorIntentTurn({
    userId: req.userId,
    userEmail: req.userEmail,
    channel: "chat_text",
    message: message.trim(),
  }).catch((err) => {
    logger.error({ err }, "[chat] operator intent turn failed — falling through to the model");
    return null;
  });
  if (intentTurn) {
    res.json({ reply: intentTurn.replyText, model: null, creditCost: chatCreditCost, action: intentTurn.action, ...doorPayload });
    return;
  }

  /* Optional paid mode: charge first, but refund on any model failure below.
     Charge-then-refund keeps the 402 pre-check simple while guaranteeing
     the user never pays for a failed generation.

     Chat-key (owner ruling, Nov 10, 2026 — "key it anyway"): the
     conditional charge is keyed + stored-result backed, house
     Pattern A, entirely inside this cost > 0 branch — at the default
     cost 0 none of it runs and the free path is exactly the old one.
     The key derives from the member + the message and history that
     define the generation; a landed key's stored reply is served
     back before any funding (a paid replay never 402s on a
     since-spent balance and never re-charges), and a refunded
     failure voids the key so a genuine retry charges fresh. */
  let chatCharged = false;
  let chatKey: string | null = null;
  let settleChatRun: ((body: Record<string, unknown> | null) => void) | null = null;
  if (chatCreditCost > 0) {
    chatKey = buildChargeIdempotencyKey("chat", req.userId!, null, {
      message: message.trim(),
      history,
    });

    /* Stored-result pre-check BEFORE any funding — including the 402
       balance gate below (thumbnail-generator precedent). A malformed
       stored payload is a miss, never served. Fail-open. */
    const storedChat = await findStoredGenerationResult("chat", chatKey, req.userId!);
    if (storedChat && typeof storedChat["reply"] === "string") {
      res.json({ ...storedChat, replayed: true, replayNote: CHAT_REPLAY_NOTE });
      return;
    }

    /* Twin join: an identical message already in flight shares its
       run — one charge, one model call, both responses honest. */
    const pendingChat = chatInFlight.get(chatKey);
    if (pendingChat) {
      const twinBody = await pendingChat.catch(() => null);
      if (twinBody) {
        res.json({ ...twinBody, replayed: true, replayNote: CHAT_REPLAY_NOTE });
        return;
      }
      /* The twin failed (refunded + key voided) — run this one fresh. */
    }
    let settle!: (body: Record<string, unknown> | null) => void;
    const chatRun = new Promise<Record<string, unknown> | null>((resolve) => { settle = resolve; });
    chatInFlight.set(chatKey, chatRun);
    settleChatRun = settle;

    const balance = req.userCredits ?? 0;
    if (balance < chatCreditCost) {
      chatInFlight.delete(chatKey);
      settle(null);
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to keep chatting with Thy Cheat Code.",
      });
      return;
    }
    try {
      await chargeCredits(req.userId!, chatCreditCost, { action: "AI Chat Assistant" }, { idempotencyKey: chatKey });
      chatCharged = true;
    } catch (err) {
      chatInFlight.delete(chatKey);
      settle(null);
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

  /* Serve a success body. On the paid rail the body is stored under
     the charge key BEFORE it is answered (Pattern A), so a later
     identical request is served as a replay instead of re-charging;
     the in-flight twins settle with the same body. Free mode skips
     straight to the answer, exactly as before. */
  const serveChatBody = async (body: Record<string, unknown>) => {
    if (chatCharged && chatKey) {
      await storeGenerationResult("chat", chatKey, req.userId!, body);
      chatInFlight.delete(chatKey);
      settleChatRun?.(body);
    }
    res.json(body);
  };

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
      await serveChatBody({ reply: actionTurn.replyText, model, creditCost: chatCreditCost, action: actionTurn.action, ...doorPayload });
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

    await serveChatBody({ reply, model, creditCost: chatCreditCost, ...doorPayload });
  } catch (err) {
    /* Refund: the model call failed after we charged — the user must not
       pay for a failed generation. A landed refund also VOIDS the
       charge's idempotency key (Pattern A), so the member's retry
       charges fresh instead of being suppressed as a replay and
       running free; the void lands before the in-flight twins are
       settled, so a waiting twin re-charges rather than free-riding
       the voided key. */
    if (chatCharged) {
      let refunded = true;
      await refundCredits(req.userId!, chatCreditCost, {
        action: "AI Chat Assistant — Refund (model failed)",
      }).catch((refundErr) => {
        refunded = false;
        logger.error({ refundErr }, "[chat] refund failed after model error");
      });
      if (refunded && chatKey) {
        await voidChargeIdempotencyKey(chatKey).catch(() => false);
      }
    }
    if (chatKey) {
      chatInFlight.delete(chatKey);
      settleChatRun?.(null);
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
