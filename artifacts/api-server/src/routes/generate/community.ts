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
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* ─── Pricing (env-overridable) ───────────────────────────────────────────
   1 credit per 50 comments moderated. Sentiment / superfans / reply drafts
   are 1 credit per run — short GPT-6 Sol completions, deep margins, and the
   standing rule that every AI feature costs a fee. */
export const COMMUNITY_MODERATE_CREDITS =
  Number(process.env["COMMUNITY_MODERATE_CREDITS"]) || 1;
export const COMMUNITY_MODERATE_BATCH = 50;
export const COMMUNITY_SENTIMENT_CREDITS =
  Number(process.env["COMMUNITY_SENTIMENT_CREDITS"]) || 1;
export const COMMUNITY_SUPERFAN_CREDITS =
  Number(process.env["COMMUNITY_SUPERFAN_CREDITS"]) || 1;
export const COMMUNITY_REPLY_CREDITS =
  Number(process.env["COMMUNITY_REPLY_CREDITS"]) || 1;

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
export type ModerationVerdict = "ok" | "review" | "remove";

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

async function refundOnFailure(userId: string, cost: number, action: string): Promise<void> {
  await refundCredits(userId, cost, { action }).catch(() => {});
}

/* ─── POST /api/community/moderate ───────────────────────────────────────── */
router.post("/community/moderate", publicApiLimiter, requireAuth, async (req, res) => {
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

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to moderate comments." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Moderation" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to moderate comments." });
      return;
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
      temperature: 0.2,
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
    const flags = parseModerationJson(raw, comments.length);
    recordCreditUsage({ userId: req.userId!, action: "Community Moderation", creditsUsed: cost }).catch(() => {});
    res.json({
      flags,
      reviewed: comments.length,
      flaggedCount: flags.length,
      creditsUsed: cost,
      creditsRemaining,
      note: "Flags are suggestions — nothing was deleted. Review each one before acting.",
    });
  } catch (err) {
    await refundOnFailure(req.userId!, cost, "Community Moderation (provider failure refund)");
    logger.error({ err }, "[community] moderate failed");
    res.status(502).json({ error: "Moderation hiccupped — try again. (Credits refunded.)" });
  }
});

/* ─── POST /api/community/reply-draft ────────────────────────────────────── */
router.post("/community/reply-draft", publicApiLimiter, requireAuth, async (req, res) => {
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

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to draft replies." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Reply Drafts" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to draft replies." });
      return;
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
      temperature: 0.7,
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
      await refundOnFailure(req.userId!, cost, "Community Reply Drafts (empty output refund)");
      res.status(502).json({ error: "Couldn't draft replies — try again. (Credit refunded.)" });
      return;
    }
    recordCreditUsage({ userId: req.userId!, action: "Community Reply Drafts", creditsUsed: cost }).catch(() => {});
    res.json({ drafts, creditsUsed: cost, creditsRemaining });
  } catch (err) {
    await refundOnFailure(req.userId!, cost, "Community Reply Drafts (provider failure refund)");
    logger.error({ err }, "[community] reply-draft failed");
    res.status(502).json({ error: "Reply drafting hiccupped — try again. (Credit refunded.)" });
  }
});

/* ─── POST /api/community/sentiment ──────────────────────────────────────── */
router.post("/community/sentiment", publicApiLimiter, requireAuth, async (req, res) => {
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

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up for a sentiment report." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Sentiment Report" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up for a sentiment report." });
      return;
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
      temperature: 0.3,
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
      await refundOnFailure(req.userId!, cost, "Community Sentiment (unusable output refund)");
      res.status(502).json({ error: "Couldn't build the sentiment report — try again. (Credit refunded.)" });
      return;
    }
    recordCreditUsage({ userId: req.userId!, action: "Community Sentiment Report", creditsUsed: cost }).catch(() => {});
    res.json({ report, analyzed: comments.length, creditsUsed: cost, creditsRemaining });
  } catch (err) {
    await refundOnFailure(req.userId!, cost, "Community Sentiment (provider failure refund)");
    logger.error({ err }, "[community] sentiment failed");
    res.status(502).json({ error: "Sentiment analysis hiccupped — try again. (Credit refunded.)" });
  }
});

/* ─── POST /api/community/superfans ──────────────────────────────────────── */
router.post("/community/superfans", publicApiLimiter, requireAuth, async (req, res) => {
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

  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up for superfan radar." });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, cost, { action: "Community Superfan Radar" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up for superfan radar." });
      return;
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
      temperature: 0.3,
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
    recordCreditUsage({ userId: req.userId!, action: "Community Superfan Radar", creditsUsed: cost }).catch(() => {});
    res.json({ superfans, analyzed: comments.length, creditsUsed: cost, creditsRemaining });
  } catch (err) {
    await refundOnFailure(req.userId!, cost, "Community Superfan Radar (provider failure refund)");
    logger.error({ err }, "[community] superfans failed");
    res.status(502).json({ error: "Superfan radar hiccupped — try again. (Credit refunded.)" });
  }
});

export default router;
