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
  refundCreditsGuaranteed,
  OutOfCreditsError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

const router = Router();

/* ─── Pricing (env-overridable) ───────────────────────────────────────────
   1 credit per 50 comments moderated. Sentiment / superfans / reply drafts
   are 1 credit per run — short GPT-6 Sol completions, deep margins, and the
   standing rule that every AI feature costs a fee. */
export const COMMUNITY_MODERATE_CREDITS =
  Number(process.env["COMMUNITY_MODERATE_CREDITS"]) || 100;
export const COMMUNITY_MODERATE_BATCH = 50;
export const COMMUNITY_SENTIMENT_CREDITS =
  Number(process.env["COMMUNITY_SENTIMENT_CREDITS"]) || 100;
export const COMMUNITY_SUPERFAN_CREDITS =
  Number(process.env["COMMUNITY_SUPERFAN_CREDITS"]) || 100;
export const COMMUNITY_REPLY_CREDITS =
  Number(process.env["COMMUNITY_REPLY_CREDITS"]) || 100;

export function moderateCreditCost(commentCount: number): number {
  if (commentCount <= 0) return 0;
  return Math.ceil(commentCount / COMMUNITY_MODERATE_BATCH) * COMMUNITY_MODERATE_CREDITS;
}

/* ─── Schemas ────────────────────────────────────────────────────────────── */
const commentSchema = z.object({
  author: z.string().min(1).max(100),
  text: z.string().min(1).max(1000),
  likes: z.number().int().min(0).optional().default(0),
});

export const moderateSchema = z.object({
  comments: z.array(commentSchema).min(1).max(200),
});

export const replyDraftSchema = z.object({
  comments: z.array(commentSchema).min(1).max(20),
  tone: z.enum(["friendly", "playful", "professional", "hype"]).default("friendly"),
  creatorName: z.string().max(100).optional().default(""),
});

export const sentimentSchema = z.object({
  comments: z.array(commentSchema).min(1).max(200),
  timeframe: z.string().max(50).optional().default("this week"),
});

export const superfanSchema = z.object({
  comments: z.array(commentSchema).min(1).max(200),
});

/* ─── Pure helpers (exported for tests) ──────────────────────────────────── */
type ModerationVerdict = "ok" | "review" | "remove";

export interface FlaggedComment {
  index: number;
  author: string;
  text: string;
  verdict: ModerationVerdict;
  reasons: string[];
  severity: number; // 0-100
}

/** Never auto-deletes: anything the model flags comes back as "review" or
    "remove" SUGGESTIONS for the user to approve. */
export function parseModerationJson(raw: string, count: number): FlaggedComment[] {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : (parsed as { flags?: unknown[] }).flags;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (f): f is Record<string, unknown> =>
        typeof f === "object" && f !== null && typeof (f as { index?: unknown }).index === "number",
    )
    .map((f) => {
      const index = f["index"] as number;
      const verdictRaw = String(f["verdict"] ?? "ok").toLowerCase();
      const verdict: ModerationVerdict =
        verdictRaw === "remove" ? "remove" : verdictRaw === "review" ? "review" : "ok";
      return {
        index: Math.max(0, Math.min(count - 1, index)),
        author: String(f["author"] ?? ""),
        text: String(f["text"] ?? ""),
        verdict,
        reasons: Array.isArray(f["reasons"])
          ? (f["reasons"] as unknown[]).map((r) => String(r)).slice(0, 4)
          : [],
        severity: Math.max(0, Math.min(100, Number(f["severity"] ?? 0) || 0)),
      };
    });
}

export function buildModerateSystemPrompt(): string {
  return (
    `You are a community moderation assistant for an independent music creator. ` +
    `Review each comment and return a JSON array of flags. Only include comments that need attention. ` +
    `For each flagged comment: index (0-based), author, text (first 80 chars), verdict ("review" for borderline / needs human eyes, "remove" for clear spam, hate speech, harassment, or scams), reasons (short tags like "spam", "hate-speech", "scam-link", "harassment", "profanity", "self-promo"), severity (0-100). ` +
    `Be conservative: genuine criticism and playful banter are "ok" and should NOT be flagged. ` +
    `Never recommend auto-deletion — every flag is a suggestion for human review. ` +
    `Return ONLY the JSON array, no markdown fences.`
  );
}

export function buildReplySystemPrompt(tone: string, creatorName: string): string {
  const name = creatorName.trim() ? ` The creator's name/handle is "${creatorName.trim()}".` : "";
  return (
    `You are drafting comment replies for an independent music creator. Tone: ${tone}.${name} ` +
    `Write ONE short reply per comment (under 280 chars each). Be authentic, specific to what the commenter said, ` +
    `and match the creator's voice — never generic ("thanks!"). No hashtags. ` +
    `Return a JSON array of { "index": number, "reply": string }. No markdown fences.`
  );
}

export function buildSentimentSystemPrompt(timeframe: string): string {
  return (
    `You are an audience sentiment analyst for an independent music creator. ` +
    `Analyze these comments from ${timeframe} and return JSON: ` +
    `{ "overall": "positive"|"mixed"|"negative", "score": 0-100, ` +
    `"themes": [{ "theme": string, "sentiment": "positive"|"neutral"|"negative", "examples": string[] (up to 2 short quotes) }], ` +
    `"risks": string[] (PR risks or brewing negativity, empty if none), ` +
    `"wins": string[] (what fans love most) }. ` +
    `Return ONLY the JSON object, no markdown fences.`
  );
}

export function buildSuperfanSystemPrompt(): string {
  return (
    `You are identifying superfans for an independent music creator from comment activity. ` +
    `Rank the most engaged, positive, genuine supporters. Ignore spam/bot-like repetition. ` +
    `Return JSON: { "superfans": [{ "author": string, "score": 0-100, "why": string (one line), "commentCount": number }] } ` +
    `sorted by score desc, max 10. Return ONLY the JSON object, no markdown fences.`
  );
}

function formatComments(comments: { author: string; text: string; likes: number }[]): string {
  return comments
    .map((c, i) => `[${i}] @${c.author} (${c.likes} likes): ${c.text}`)
    .join("\n");
}

async function refundOnFailure(
  userId: string,
  cost: number,
  action: string,
  idempotencyKey: string,
): Promise<void> {
  /* Refund, then VOID the charge's idempotency key — without the void
     the refunded attempt's key still reads as "already charged", so a
     retry would be suppressed as a replay and run FREE. The void only
     fires when the refund actually landed. */
  await refundCreditsGuaranteed(userId, cost, { action }, { idempotencyKey: idempotencyKey });
}

/* ─── CA-2 replay plumbing ───────────────────────────────────────────────
   One file serves FOUR products at four prices, so each action gets its
   OWN scope/rail and its intent carries the action name plus that
   action's inputs (see the handlers). On top of the durable stored
   result (checked per handler before any funding), an in-flight twin
   map in the bg-generate / bio-generator shape closes the concurrent
   window: two identical simultaneous POSTs share ONE run — one charge,
   one provider call — and the twin is answered with the same body +
   replayed: true. A twin whose run FAILED (refunded + key voided)
   falls through and runs fresh. */
interface CommunityOutcome {
  status: number;
  body: Record<string, unknown>;
}

const communityInFlight = new Map<string, Promise<CommunityOutcome>>();

async function runCommunityOnce(
  idempotencyKey: string,
  work: () => Promise<CommunityOutcome>,
): Promise<CommunityOutcome & { replayed: boolean }> {
  const pending = communityInFlight.get(idempotencyKey);
  if (pending) {
    const twin = await pending.catch(() => null);
    if (twin && twin.status === 200) return { ...twin, replayed: true };
    /* The twin failed (refunded + key voided) — run this request fresh. */
  }
  const run = work();
  communityInFlight.set(idempotencyKey, run);
  try {
    const outcome = await run;
    return { ...outcome, replayed: false };
  } finally {
    if (communityInFlight.get(idempotencyKey) === run) {
      communityInFlight.delete(idempotencyKey);
    }
  }
}

/** Answer a community outcome: a fresh success is stored BEFORE it is
    sent (fail-open inside the helper); a replay serves the stored /
    twin body verbatim + replayed: true and stores nothing again. */
async function answerCommunity(
  res: Response,
  rail: string,
  idempotencyKey: string,
  userId: string,
  outcome: CommunityOutcome & { replayed: boolean },
): Promise<void> {
  const { status, body, replayed } = outcome;
  if (status === 200) {
    if (replayed) {
      res.json({ ...body, replayed: true });
      return;
    }
    await storeGenerationResult(rail, idempotencyKey, userId, body);
    res.json(body);
    return;
  }
  res.status(status).json(body);
}

/* ─── POST /api/community/moderate ───────────────────────────────────────── */
router.post("/community/moderate", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = moderateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid moderation request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { comments } = parsed.data;
  const cost = moderateCreditCost(comments.length);

  /* Idempotency (CA-2): server-derived key on EVERY call — this rail's
     schema accepts no client key, so the intent hash IS the key. The
     intent names the ACTION (moderation) plus its inputs: one file
     serves four products, and their keys must never collide. */
  const idempotencyKey = buildChargeIdempotencyKey("community-moderation", req.userId!, undefined, {
    action: "moderation",
    comments,
  });

  /* Stored-result pre-check BEFORE any funding. */
  const storedResult = await findStoredGenerationResult("community-moderation", idempotencyKey, req.userId!);
  if (storedResult) {
    res.json({ ...storedResult, replayed: true });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to moderate comments." });
    return;
  }

  const outcome = await runCommunityOnce(idempotencyKey, async (): Promise<CommunityOutcome> => {
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Moderation" }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        return { status: 402, body: { error: "out_of_credits", message: "You're out of Visual Bucs — top up to moderate comments." } };
      }
      throw err;
    }

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          { role: "system", content: buildModerateSystemPrompt() },
          { role: "user", content: formatComments(comments) },
        ],
        max_completion_tokens: 2000,
      });
      const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
      const flags = parseModerationJson(raw, comments.length);
      /* Ledger row already written by chargeCredits above (Stack400 Lane 4: the duplicate recordCreditUsage write that lived here double-counted every charge in the member's history). */
      return {
        status: 200,
        body: {
          flags,
          reviewed: comments.length,
          flaggedCount: flags.length,
          creditsUsed: cost,
          creditsRemaining,
          note: "Flags are suggestions — nothing was deleted. Review each one before acting.",
        },
      };
    } catch (err) {
      await refundOnFailure(req.userId!, cost, "Community Moderation (provider failure refund)", idempotencyKey);
      logger.error({ err }, "[community] moderate failed");
      return { status: 502, body: { error: "Moderation hiccupped — try again. (Visual Bucs refunded.)" } };
    }
  });

  await answerCommunity(res, "community-moderation", idempotencyKey, req.userId!, outcome);
});

/* ─── POST /api/community/reply-draft ────────────────────────────────────── */
router.post("/community/reply-draft", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = replyDraftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid reply draft request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { comments, tone, creatorName } = parsed.data;
  const cost = COMMUNITY_REPLY_CREDITS;

  /* Idempotency (CA-2): same shape as /community/moderate above — own
     scope/rail, intent = the action name + this action's inputs. */
  const idempotencyKey = buildChargeIdempotencyKey("community-reply-drafts", req.userId!, undefined, {
    action: "reply-drafts",
    comments,
    tone,
    creatorName,
  });

  /* Stored-result pre-check BEFORE any funding. */
  const storedResult = await findStoredGenerationResult("community-reply-drafts", idempotencyKey, req.userId!);
  if (storedResult) {
    res.json({ ...storedResult, replayed: true });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to draft replies." });
    return;
  }

  const outcome = await runCommunityOnce(idempotencyKey, async (): Promise<CommunityOutcome> => {
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Reply Drafts" }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        return { status: 402, body: { error: "out_of_credits", message: "You're out of Visual Bucs — top up to draft replies." } };
      }
      throw err;
    }

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          { role: "system", content: buildReplySystemPrompt(tone, creatorName) },
          { role: "user", content: formatComments(comments) },
        ],
        max_completion_tokens: 1500,
      });
      const raw = (completion.choices[0]?.message?.content ?? "[]").replace(/```json|```/g, "").trim();
      let drafts: { index: number; reply: string }[] = [];
      try {
        const p = JSON.parse(raw);
        const arr = Array.isArray(p) ? p : p.drafts;
        if (Array.isArray(arr)) {
          drafts = arr
            .filter((d) => typeof d === "object" && d !== null && typeof (d as { index?: unknown }).index === "number")
            .map((d) => ({
              index: (d as { index: number }).index,
              reply: String((d as { reply?: unknown }).reply ?? "").slice(0, 280),
            }));
        }
      } catch {
        drafts = [];
      }
      if (drafts.length === 0) {
        await refundOnFailure(req.userId!, cost, "Community Reply Drafts (empty output refund)", idempotencyKey);
        return { status: 502, body: { error: "Couldn't draft replies — try again. (Visual Buc refunded.)" } };
      }
      /* Ledger row already written by chargeCredits above (Stack400 Lane 4 duplicate removed). */
      return { status: 200, body: { drafts, creditsUsed: cost, creditsRemaining } };
    } catch (err) {
      await refundOnFailure(req.userId!, cost, "Community Reply Drafts (provider failure refund)", idempotencyKey);
      logger.error({ err }, "[community] reply-draft failed");
      return { status: 502, body: { error: "Reply drafting hiccupped — try again. (Visual Buc refunded.)" } };
    }
  });

  await answerCommunity(res, "community-reply-drafts", idempotencyKey, req.userId!, outcome);
});

/* ─── POST /api/community/sentiment ──────────────────────────────────────── */
router.post("/community/sentiment", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = sentimentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid sentiment request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { comments, timeframe } = parsed.data;
  const cost = COMMUNITY_SENTIMENT_CREDITS;

  /* Idempotency (CA-2): same shape as /community/moderate above — own
     scope/rail, intent = the action name + this action's inputs. */
  const idempotencyKey = buildChargeIdempotencyKey("community-sentiment", req.userId!, undefined, {
    action: "sentiment",
    comments,
    timeframe,
  });

  /* Stored-result pre-check BEFORE any funding. */
  const storedResult = await findStoredGenerationResult("community-sentiment", idempotencyKey, req.userId!);
  if (storedResult) {
    res.json({ ...storedResult, replayed: true });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up for a sentiment report." });
    return;
  }

  const outcome = await runCommunityOnce(idempotencyKey, async (): Promise<CommunityOutcome> => {
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Sentiment Report" }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        return { status: 402, body: { error: "out_of_credits", message: "You're out of Visual Bucs — top up for a sentiment report." } };
      }
      throw err;
    }

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          { role: "system", content: buildSentimentSystemPrompt(timeframe) },
          { role: "user", content: formatComments(comments) },
        ],
        max_completion_tokens: 1500,
      });
      const raw = (completion.choices[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim();
      let report: Record<string, unknown> | null = null;
      try {
        const p = JSON.parse(raw);
        if (typeof p === "object" && p !== null && typeof (p as { score?: unknown }).score === "number") {
          report = p as Record<string, unknown>;
        }
      } catch {
        report = null;
      }
      if (!report) {
        await refundOnFailure(req.userId!, cost, "Community Sentiment (unusable output refund)", idempotencyKey);
        return { status: 502, body: { error: "Couldn't build the sentiment report — try again. (Visual Buc refunded.)" } };
      }
      /* Ledger row already written by chargeCredits above (Stack400 Lane 4 duplicate removed). */
      return { status: 200, body: { report, analyzed: comments.length, creditsUsed: cost, creditsRemaining } };
    } catch (err) {
      await refundOnFailure(req.userId!, cost, "Community Sentiment (provider failure refund)", idempotencyKey);
      logger.error({ err }, "[community] sentiment failed");
      return { status: 502, body: { error: "Sentiment analysis hiccupped — try again. (Visual Buc refunded.)" } };
    }
  });

  await answerCommunity(res, "community-sentiment", idempotencyKey, req.userId!, outcome);
});

/* ─── POST /api/community/superfans ──────────────────────────────────────── */
router.post("/community/superfans", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = superfanSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid superfan request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { comments } = parsed.data;
  const cost = COMMUNITY_SUPERFAN_CREDITS;

  /* Idempotency (CA-2): same shape as /community/moderate above — own
     scope/rail, intent = the action name + this action's inputs. */
  const idempotencyKey = buildChargeIdempotencyKey("community-superfan-radar", req.userId!, undefined, {
    action: "superfan-radar",
    comments,
  });

  /* Stored-result pre-check BEFORE any funding. */
  const storedResult = await findStoredGenerationResult("community-superfan-radar", idempotencyKey, req.userId!);
  if (storedResult) {
    res.json({ ...storedResult, replayed: true });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up for superfan radar." });
    return;
  }

  const outcome = await runCommunityOnce(idempotencyKey, async (): Promise<CommunityOutcome> => {
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Superfan Radar" }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        return { status: 402, body: { error: "out_of_credits", message: "You're out of Visual Bucs — top up for superfan radar." } };
      }
      throw err;
    }

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          { role: "system", content: buildSuperfanSystemPrompt() },
          { role: "user", content: formatComments(comments) },
        ],
        max_completion_tokens: 1200,
      });
      const raw = (completion.choices[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim();
      let superfans: { author: string; score: number; why: string; commentCount: number }[] = [];
      try {
        const p = JSON.parse(raw);
        const arr = Array.isArray(p) ? p : (p as { superfans?: unknown }).superfans;
        if (Array.isArray(arr)) {
          superfans = arr
            .filter((s) => typeof s === "object" && s !== null && typeof (s as { author?: unknown }).author === "string")
            .map((s) => {
              const o = s as { author: string; score?: unknown; why?: unknown; commentCount?: unknown };
              return {
                author: o.author.slice(0, 100),
                score: Math.max(0, Math.min(100, Number(o.score ?? 0) || 0)),
                why: String(o.why ?? "").slice(0, 200),
                commentCount: Math.max(0, Number(o.commentCount ?? 0) || 0),
              };
            })
            .slice(0, 10);
        }
      } catch {
        superfans = [];
      }
      /* Ledger row already written by chargeCredits above (Stack400 Lane 4 duplicate removed). */
      return { status: 200, body: { superfans, analyzed: comments.length, creditsUsed: cost, creditsRemaining } };
    } catch (err) {
      await refundOnFailure(req.userId!, cost, "Community Superfan Radar (provider failure refund)", idempotencyKey);
      logger.error({ err }, "[community] superfans failed");
      return { status: 502, body: { error: "Superfan radar hiccupped — try again. (Visual Buc refunded.)" } };
    }
  });

  await answerCommunity(res, "community-superfan-radar", idempotencyKey, req.userId!, outcome);
});

export default router;
