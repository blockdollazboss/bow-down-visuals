import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* Sponsor marketplace — brands post paid deals, creators apply with a pitch.
 * Money rules (standing pricing rule: AI/compute burns credits, pure UI is free):
 *  - posting a deal: 5 credits (brands pay for the listing)
 *  - applying to a deal: free (pure UI — just stores the pitch)
 *  - browsing deals: free (pure UI — just reads)
 *  - AI pitch writer / AI deal matcher: 1 credit each, charged BEFORE the
 *    model call, auto-refunded on provider failure.
 *
 * GPT-6 note: use `max_completion_tokens` — gpt-6-sol rejects `max_tokens`.
 *
 * Queries use raw SQL via db.execute(sql``) rather than the drizzle query
 * builder (same pattern as the locations route — pg-mem and the node-postgres
 * shim don't speak the query builder's rowMode). */

/* 5 credits per deal posting — a business listing that can close real money,
   so it prices above impulse AI tools. Env-overridable without a deploy. */
export const SPONSOR_POST_CREDIT_COST =
  Number(process.env["SPONSOR_POST_CREDIT_COST"]) || 5;
/* 1 credit per AI assist — same impulse price as the coach/hooks tools. */
export const SPONSOR_AI_CREDIT_COST =
  Number(process.env["SPONSOR_AI_CREDIT_COST"]) || 1;

const MAX_ACTIVE_DEALS_FOR_MATCH = 20;

export const dealSchema = z.object({
  brandName:    z.string().min(1, "Brand name is required.").max(120),
  budgetMin:    z.number().int().min(0).max(100000000),
  budgetMax:    z.number().int().min(0).max(100000000),
  niche:        z.string().min(1, "Niche is required.").max(120),
  deliverables: z.string().min(1, "Deliverables are required.").max(500),
  description:  z.string().min(1, "Description is required.").max(2000),
  deadline:     z.string().datetime({ message: "Deadline must be an ISO date." }),
}).refine((d) => d.budgetMax >= d.budgetMin, {
  message: "Max budget must be at least the min budget.",
  path: ["budgetMax"],
});

export const applySchema = z.object({
  pitch: z.string().min(1, "Write a pitch first.").max(2000, "Pitch is too long (max 2000 characters)."),
});

export const pitchWriterSchema = z.object({
  dealId: z.string().uuid("Pick a deal to pitch for."),
  creatorName: z.string().max(120).optional().default(""),
  niche: z.string().min(1, "Niche is required.").max(120),
  followers: z.number().int().min(0).max(1000000000).optional().default(0),
  platforms: z.array(z.string().max(40)).max(5).optional().default([]),
  achievements: z.string().max(500).optional().default(""),
  tone: z.enum(["professional", "bold", "friendly"]).optional().default("professional"),
});

export const matcherSchema = z.object({
  niche: z.string().min(1, "Niche is required.").max(120),
  followers: z.number().int().min(0).max(1000000000).optional().default(0),
  platforms: z.array(z.string().max(40)).max(5).optional().default([]),
});

/* Raw DB row (snake_case) → API DTO (camelCase). */
interface DealRow {
  id: string;
  brand_name: string;
  budget_min: number;
  budget_max: number;
  niche: string;
  deliverables: string;
  description: string;
  deadline: string;
  posted_by: string;
  status: string;
  created_at: string;
}

export interface DealDto {
  id: string;
  brandName: string;
  budgetMin: number;
  budgetMax: number;
  niche: string;
  deliverables: string;
  description: string;
  deadline: string;
  status: string;
  createdAt: string;
}

export function toDealDto(r: DealRow): DealDto {
  return {
    id: r.id,
    brandName: r.brand_name,
    budgetMin: r.budget_min,
    budgetMax: r.budget_max,
    niche: r.niche,
    deliverables: r.deliverables,
    description: r.description,
    deadline: r.deadline,
    status: r.status,
    createdAt: r.created_at,
  };
}

const router = Router();

function invalidBody(res: { status: (c: number) => { json: (b: unknown) => void } }, parsed: { error: z.ZodError }) {
  res.status(400).json({
    error: "Invalid request.",
    details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
  });
}

/* GET /api/sponsors/deals — browse active brand deals. Free (pure UI read). */
router.get("/sponsors/deals", publicApiLimiter, requireAuth, async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT id, brand_name, budget_min, budget_max, niche, deliverables,
             description, deadline, posted_by, status, created_at
      FROM sponsor_deals
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json({ deals: (result.rows as unknown as DealRow[]).map(toDealDto) });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to list deals");
    res.status(500).json({ error: "Could not load deals — try again." });
  }
});

/* POST /api/sponsors/deals — brands post a deal. Paid: 5 credits. */
router.post("/sponsors/deals", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = dealSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    invalidBody(res, parsed);
    return;
  }

  let creditsRemaining: number;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SPONSOR_POST_CREDIT_COST, {
      action: "Sponsor Deal Posting",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to post your deal.",
      });
      return;
    }
    throw err;
  }

  const d = parsed.data;
  try {
    const id = randomUUID();
    const result = await db.execute(sql`
      INSERT INTO sponsor_deals
        (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status)
      VALUES
        (${id}, ${d.brandName.trim()}, ${d.budgetMin}, ${d.budgetMax}, ${d.niche.trim()},
         ${d.deliverables.trim()}, ${d.description.trim()}, ${d.deadline}, ${req.userId!}, 'active')
      RETURNING id, brand_name, budget_min, budget_max, niche, deliverables,
                description, deadline, posted_by, status, created_at
    `);
    const deal = toDealDto(result.rows[0] as unknown as DealRow);
    res.json({ deal, creditsUsed: SPONSOR_POST_CREDIT_COST, creditsRemaining });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to store deal — refunding");
    await refundCredits(req.userId!, SPONSOR_POST_CREDIT_COST, {
      action: "Sponsor Deal Posting — Refund (save failed)",
    });
    res.status(500).json({ error: "Could not post your deal — credits refunded, try again." });
  }
});

async function findActiveDeal(dealId: string): Promise<DealRow | null> {
  const result = await db.execute(sql`
    SELECT id, brand_name, budget_min, budget_max, niche, deliverables,
           description, deadline, posted_by, status, created_at
    FROM sponsor_deals
    WHERE id = ${dealId} AND status = 'active'
    LIMIT 1
  `);
  return (result.rows[0] as unknown as DealRow) ?? null;
}

/* POST /api/sponsors/deals/:id/apply — creators apply with a pitch. Free. */
router.post("/sponsors/deals/:id/apply", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = applySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    invalidBody(res, parsed);
    return;
  }
  const rawId = req.params["id"];
  const dealId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!dealId || !z.string().uuid().safeParse(dealId).success) {
    res.status(400).json({ error: "Invalid deal id." });
    return;
  }

  try {
    const deal = await findActiveDeal(dealId);
    if (!deal) {
      res.status(404).json({ error: "That deal is no longer active." });
      return;
    }
    /* Fast-path duplicate check (works everywhere, including pg-mem's
       partial ON CONFLICT support). The ON CONFLICT below is the race guard
       for concurrent double-submits in production. */
    const existing = await db.execute(sql`
      SELECT id FROM sponsor_applications
      WHERE deal_id = ${dealId} AND user_id = ${req.userId!}
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "You've already applied to this deal." });
      return;
    }
    const result = await db.execute(sql`
      INSERT INTO sponsor_applications (id, deal_id, user_id, pitch)
      VALUES (${randomUUID()}, ${dealId}, ${req.userId!}, ${parsed.data.pitch.trim()})
      ON CONFLICT (deal_id, user_id) DO NOTHING
      RETURNING id, deal_id, user_id, pitch, created_at
    `);
    if (result.rows.length === 0) {
      res.status(409).json({ error: "You've already applied to this deal." });
      return;
    }
    res.json({ success: true, application: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to store application");
    res.status(500).json({ error: "Could not send your application — try again." });
  }
});

/* POST /api/sponsors/pitch — AI pitch writer. Paid: 1 credit, charged BEFORE
   the model call, auto-refunded on provider failure. */
router.post("/sponsors/pitch", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = pitchWriterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    invalidBody(res, parsed);
    return;
  }

  let creditsRemaining: number;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SPONSOR_AI_CREDIT_COST, {
      action: "Sponsor AI Pitch Writer",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to write your pitch.",
      });
      return;
    }
    throw err;
  }

  const p = parsed.data;
  try {
    const deal = await findActiveDeal(p.dealId);
    if (!deal) {
      await refundCredits(req.userId!, SPONSOR_AI_CREDIT_COST, {
        action: "Sponsor AI Pitch Writer — Refund (deal inactive)",
      });
      res.status(404).json({ error: "That deal is no longer active — credit refunded." });
      return;
    }

    const toneLine =
      p.tone === "bold"
        ? "Confident and direct — sell the results hard."
        : p.tone === "friendly"
          ? "Warm and personable — like a DM from a friend who happens to be a pro."
          : "Polished and professional — agency-grade but not stiff.";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a sponsorship deal-closer writing a creator's pitch to a brand. ` +
            `Write a short, sharp pitch (120-180 words) the creator can paste into their ` +
            `application. Structure: hook (why THIS brand), proof (stats + niche fit), ` +
            `the offer (what they'll deliver, mapped to the brand's deliverables), ` +
            `close (clear next step). ${toneLine} No fluff, no begging, no fake stats — ` +
            `only use the numbers given. Return ONLY JSON: ` +
            `{"pitch": "...", "subject": "..."}`,
        },
        {
          role: "user",
          content:
            `Write my pitch for this deal.\n` +
            `Brand: ${deal.brand_name}\n` +
            `Budget: $${deal.budget_min.toLocaleString()}–$${deal.budget_max.toLocaleString()}\n` +
            `Niche wanted: ${deal.niche}\n` +
            `Deliverables: ${deal.deliverables}\n` +
            `What they're about: ${deal.description}\n` +
            `Deadline: ${String(deal.deadline).slice(0, 10)}\n\n` +
            `About me:\n` +
            `Name: ${p.creatorName.trim() || "Creator"}\n` +
            `Niche: ${p.niche.trim()}\n` +
            `Followers: ${p.followers.toLocaleString()}` +
            `${p.platforms.length > 0 ? ` across ${p.platforms.join(", ")}` : ""}\n` +
            `${p.achievements.trim() ? `Wins: ${p.achievements.trim()}\n` : ""}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let pitch = "";
    let subject = "";
    try {
      const j = JSON.parse(raw) as { pitch?: unknown; subject?: unknown };
      pitch = typeof j.pitch === "string" ? j.pitch.trim() : "";
      subject = typeof j.subject === "string" ? j.subject.trim() : "";
    } catch {
      /* fall through to the empty check */
    }
    if (!pitch) {
      throw new Error("Model returned no usable pitch");
    }

    res.json({ pitch, subject, creditsUsed: SPONSOR_AI_CREDIT_COST, creditsRemaining });
  } catch (err) {
    logger.error({ err }, "[sponsors] pitch writer failed — refunding");
    await refundCredits(req.userId!, SPONSOR_AI_CREDIT_COST, {
      action: "Sponsor AI Pitch Writer — Refund (provider failed)",
    });
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      res.status(503).json({ error: "The pitch writer is catching its breath — try again in a moment." });
      return;
    }
    res.status(502).json({ error: "The pitch writer hiccupped — credit refunded, try again." });
  }
});

/* POST /api/sponsors/match — AI deal matcher. Paid: 1 credit, charged BEFORE
   the model call, auto-refunded on provider failure. */
router.post("/sponsors/match", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = matcherSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    invalidBody(res, parsed);
    return;
  }

  let creditsRemaining: number;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SPONSOR_AI_CREDIT_COST, {
      action: "Sponsor AI Deal Matcher",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to find your matches.",
      });
      return;
    }
    throw err;
  }

  const m = parsed.data;
  try {
    const result = await db.execute(sql`
      SELECT id, brand_name, budget_min, budget_max, niche, deliverables,
             description, deadline, posted_by, status, created_at
      FROM sponsor_deals
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT ${MAX_ACTIVE_DEALS_FOR_MATCH}
    `);
    const deals = result.rows as unknown as DealRow[];

    if (deals.length === 0) {
      await refundCredits(req.userId!, SPONSOR_AI_CREDIT_COST, {
        action: "Sponsor AI Deal Matcher — Refund (no deals)",
      });
      res.json({
        matches: [],
        note: "No active deals right now — check back soon.",
        creditsUsed: 0,
        creditsRemaining: creditsRemaining + SPONSOR_AI_CREDIT_COST,
      });
      return;
    }

    const dealLines = deals
      .map(
        (d, i) =>
          `[${i}] id=${d.id} | ${d.brand_name} | $${d.budget_min.toLocaleString()}–$${d.budget_max.toLocaleString()} ` +
          `| niche: ${d.niche} | deliverables: ${d.deliverables} | deadline: ${String(d.deadline).slice(0, 10)}`,
      )
      .join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a sponsorship matchmaker for creators. Given a creator's ` +
            `profile and a list of active brand deals, rank the best fits. ` +
            `Weigh niche alignment first, then budget realism for their audience ` +
            `size, then deadline urgency. Return ONLY JSON: ` +
            `{"matches": [{"dealIndex": <number from the list>, "score": <0-100>, ` +
            `"why": "...one sentence..."}], "note": "...one line of advice..."}. ` +
            `Include at most 5 matches, sorted by score desc. Never invent deals — ` +
            `only reference dealIndex values from the list.`,
        },
        {
          role: "user",
          content:
            `Find my best deals.\n` +
            `Niche: ${m.niche.trim()}\n` +
            `Followers: ${m.followers.toLocaleString()}` +
            `${m.platforms.length > 0 ? ` on ${m.platforms.join(", ")}` : ""}\n\n` +
            `Active deals:\n${dealLines}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 800,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    interface MatchJson { dealIndex?: unknown; score?: unknown; why?: unknown }
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    let matches: { dealId: string; brandName: string; score: number; why: string }[] = [];
    let note = "";
    try {
      const j = JSON.parse(raw) as { matches?: unknown; note?: unknown };
      if (Array.isArray(j.matches)) {
        matches = (j.matches as MatchJson[])
          .filter((x) => x && typeof x === "object")
          .map((x) => {
            const idx = typeof x.dealIndex === "number" ? Math.floor(x.dealIndex) : -1;
            const deal = idx >= 0 && idx < deals.length ? deals[idx] : undefined;
            if (!deal) return null;
            return {
              dealId: deal.id,
              brandName: deal.brand_name,
              score: typeof x.score === "number" ? clamp(x.score) : 0,
              why: typeof x.why === "string" ? x.why.trim().slice(0, 300) : "",
            };
          })
          .filter((x): x is { dealId: string; brandName: string; score: number; why: string } => x !== null)
          .slice(0, 5);
      }
      if (typeof j.note === "string" && j.note.trim()) note = j.note.trim().slice(0, 300);
    } catch {
      /* fall through to the empty check */
    }
    if (matches.length === 0) {
      throw new Error("Model returned no usable matches");
    }

    res.json({ matches, note, creditsUsed: SPONSOR_AI_CREDIT_COST, creditsRemaining });
  } catch (err) {
    logger.error({ err }, "[sponsors] deal matcher failed — refunding");
    await refundCredits(req.userId!, SPONSOR_AI_CREDIT_COST, {
      action: "Sponsor AI Deal Matcher — Refund (provider failed)",
    });
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      res.status(503).json({ error: "The matcher is catching its breath — try again in a moment." });
      return;
    }
    res.status(502).json({ error: "The matcher hiccupped — credit refunded, try again." });
  }
});

export default router;
