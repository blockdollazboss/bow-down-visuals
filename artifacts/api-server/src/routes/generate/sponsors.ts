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
  portfolioUrl: z.string().url("Portfolio must be a valid URL.").max(500).optional().or(z.literal("")),
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
      INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, portfolio_url, status)
      VALUES (${randomUUID()}, ${dealId}, ${req.userId!}, ${parsed.data.pitch.trim()}, ${parsed.data.portfolioUrl?.trim() || null}, 'pending')
      ON CONFLICT (deal_id, user_id) DO NOTHING
      RETURNING id, deal_id, user_id, pitch, portfolio_url, status, created_at
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

/* ── v2: deal lifecycle + escrow ─────────────────────────────────────────
   Deal statuses: active → funded → in_progress → completed → paid
   (plus cancelled). Application statuses: pending → accepted | rejected.
   Platform fee: 15% of every released deal (env-overridable). */

/* Platform cut in basis points — 1500 = 15%. Env-overridable without a deploy. */
export const SPONSOR_PLATFORM_FEE_BPS =
  Number(process.env["SPONSOR_PLATFORM_FEE_BPS"]) || 1500;

export function sponsorFeeSplit(grossCents: number): { feeCents: number; netCents: number } {
  const feeCents = Math.round((grossCents * SPONSOR_PLATFORM_FEE_BPS) / 10000);
  return { feeCents, netCents: grossCents - feeCents };
}

export function isStripeConfigured(): boolean {
  return !!process.env["STRIPE_SECRET_KEY"];
}

function uuidParam(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && z.string().uuid().safeParse(v).success ? v : null;
}

interface FullDealRow extends DealRow {
  agreed_amount_cents: number | null;
  escrow_status: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  platform_fee_cents: number | null;
  creator_payout_cents: number | null;
  accepted_application_id: string | null;
  accepted_user_id: string | null;
  paid_at: string | null;
}

const FULL_DEAL_COLS = `
  id, brand_name, budget_min, budget_max, niche, deliverables,
  description, deadline, posted_by, status, created_at,
  agreed_amount_cents, escrow_status, stripe_session_id,
  stripe_payment_intent_id, platform_fee_cents,
  creator_payout_cents, accepted_application_id, accepted_user_id, paid_at
`;

export interface FullDealDto extends DealDto {
  postedBy: string;
  agreedAmountCents: number | null;
  escrowStatus: string;
  platformFeeCents: number | null;
  creatorPayoutCents: number | null;
  acceptedApplicationId: string | null;
  acceptedUserId: string | null;
  paidAt: string | null;
  applicationCount: number;
  myApplicationStatus: string | null;
}

export function toFullDealDto(r: FullDealRow, applicationCount: number, myApplicationStatus: string | null): FullDealDto {
  return {
    ...toDealDto(r),
    postedBy: r.posted_by,
    agreedAmountCents: r.agreed_amount_cents,
    escrowStatus: r.escrow_status,
    platformFeeCents: r.platform_fee_cents,
    creatorPayoutCents: r.creator_payout_cents,
    acceptedApplicationId: r.accepted_application_id,
    acceptedUserId: r.accepted_user_id,
    paidAt: r.paid_at,
    applicationCount,
    myApplicationStatus,
  };
}

async function findDeal(dealId: string): Promise<FullDealRow | null> {
  const result = await db.execute(sql`
    SELECT ${sql.raw(FULL_DEAL_COLS)}
    FROM sponsor_deals
    WHERE id = ${dealId}
    LIMIT 1
  `);
  return (result.rows[0] as unknown as FullDealRow) ?? null;
}

async function countApplications(dealId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM sponsor_applications WHERE deal_id = ${dealId}
  `);
  return Number((result.rows[0] as { n: number }).n ?? 0);
}

async function myApplicationStatus(dealId: string, userId: string): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT status FROM sponsor_applications
    WHERE deal_id = ${dealId} AND user_id = ${userId}
    LIMIT 1
  `);
  const row = result.rows[0] as { status: string } | undefined;
  return row?.status ?? null;
}

/* GET /api/sponsors/deals/:id — deal detail. Free (pure UI read).
   Brand owner sees escrow internals; everyone sees the public fields. */
router.get("/sponsors/deals/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const dealId = uuidParam(req.params["id"]);
  if (!dealId) {
    res.status(400).json({ error: "Invalid deal id." });
    return;
  }
  try {
    const deal = await findDeal(dealId);
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    const [applicationCount, myStatus] = await Promise.all([
      countApplications(dealId),
      myApplicationStatus(dealId, req.userId!),
    ]);
    const dto = toFullDealDto(deal, applicationCount, myStatus);
    /* Hide escrow internals from non-participants. */
    if (deal.posted_by !== req.userId && deal.accepted_user_id !== req.userId) {
      dto.platformFeeCents = null;
      dto.creatorPayoutCents = null;
    }
    res.json({ deal: dto });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to load deal detail");
    res.status(500).json({ error: "Could not load the deal — try again." });
  }
});

/* GET /api/sponsors/deals/:id/applications — brand reviews applications.
   Only the deal poster can see the pitch list. Free (pure UI read). */
router.get("/sponsors/deals/:id/applications", publicApiLimiter, requireAuth, async (req, res) => {
  const dealId = uuidParam(req.params["id"]);
  if (!dealId) {
    res.status(400).json({ error: "Invalid deal id." });
    return;
  }
  try {
    const deal = await findDeal(dealId);
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    if (deal.posted_by !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this deal can review applications." });
      return;
    }
    const result = await db.execute(sql`
      SELECT id, deal_id, user_id, pitch, status, portfolio_url, decided_at, created_at
      FROM sponsor_applications
      WHERE deal_id = ${dealId}
      ORDER BY created_at ASC
    `);
    res.json({ applications: result.rows });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to list applications");
    res.status(500).json({ error: "Could not load applications — try again." });
  }
});

export const reviewApplicationSchema = z.object({
  action: z.enum(["accept", "reject"]),
  /* Agreed payout in cents — required when accepting. Must sit inside the
     deal's posted budget range so brands can't bait-and-switch. */
  agreedAmountCents: z.number().int().min(100).max(100000000).optional(),
});

/* PATCH /api/sponsors/applications/:id — brand accepts or rejects.
   Accepting locks the deal to that creator (other pending applications are
   rejected) and arms it for escrow funding. Free (pure UI action). */
router.patch("/sponsors/applications/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const appId = uuidParam(req.params["id"]);
  const parsed = reviewApplicationSchema.safeParse(req.body ?? {});
  if (!appId || !parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: !parsed.success ? parsed.error.issues.map((i) => i.message) : undefined });
    return;
  }
  try {
    const appRows = await db.execute(sql`
      SELECT a.id, a.deal_id, a.user_id, a.status, d.posted_by, d.status AS deal_status,
             d.budget_min, d.budget_max, d.accepted_application_id
      FROM sponsor_applications a
      JOIN sponsor_deals d ON d.id = a.deal_id
      WHERE a.id = ${appId}
      LIMIT 1
    `);
    const app = appRows.rows[0] as unknown as {
      id: string; deal_id: string; user_id: string; status: string;
      posted_by: string; deal_status: string; budget_min: number; budget_max: number;
      accepted_application_id: string | null;
    } | undefined;
    if (!app) {
      res.status(404).json({ error: "Application not found." });
      return;
    }
    if (app.posted_by !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this deal can review applications." });
      return;
    }
    if (app.status !== "pending") {
      res.status(409).json({ error: `This application was already ${app.status}.` });
      return;
    }

    if (parsed.data.action === "reject") {
      await db.execute(sql`
        UPDATE sponsor_applications
        SET status = 'rejected', decided_at = NOW()
        WHERE id = ${appId}
      `);
      res.json({ success: true, status: "rejected" });
      return;
    }

    /* accept */
    if (app.deal_status !== "active") {
      res.status(409).json({ error: "This deal is no longer accepting creators." });
      return;
    }
    if (app.accepted_application_id) {
      res.status(409).json({ error: "This deal already has an accepted creator." });
      return;
    }
    const agreed = parsed.data.agreedAmountCents;
    if (!agreed) {
      res.status(400).json({ error: "Set the agreed payout (in cents) to accept a creator." });
      return;
    }
    const minCents = app.budget_min * 100;
    const maxCents = app.budget_max * 100;
    if (agreed < minCents || agreed > maxCents) {
      res.status(400).json({ error: `Agreed payout must be within the posted budget ($${app.budget_min.toLocaleString()}–$${app.budget_max.toLocaleString()}).` });
      return;
    }
    await db.execute(sql`
      UPDATE sponsor_applications
      SET status = 'accepted', decided_at = NOW()
      WHERE id = ${appId}
    `);
    await db.execute(sql`
      UPDATE sponsor_applications
      SET status = 'rejected', decided_at = NOW()
      WHERE deal_id = ${app.deal_id} AND id <> ${appId} AND status = 'pending'
    `);
    await db.execute(sql`
      UPDATE sponsor_deals
      SET accepted_application_id = ${appId}, accepted_user_id = ${app.user_id},
          agreed_amount_cents = ${agreed}
      WHERE id = ${app.deal_id}
    `);
    res.json({ success: true, status: "accepted", agreedAmountCents: agreed });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to review application");
    res.status(500).json({ error: "Could not review the application — try again." });
  }
});

export const fundSchema = z.object({
  amountCents: z.number().int().min(100).max(100000000),
});

/* POST /api/sponsors/deals/:id/fund — brand funds the escrow.
   With STRIPE_SECRET_KEY configured: returns a real Stripe Checkout URL.
   Without it: sandbox mode — returns a mock session the frontend can
   "complete" to simulate the funding flow end to end. No credits involved;
   this is real money (or the sandbox stand-in). */
router.post("/sponsors/deals/:id/fund", publicApiLimiter, requireAuth, async (req, res) => {
  const dealId = uuidParam(req.params["id"]);
  const parsed = fundSchema.safeParse(req.body ?? {});
  if (!dealId || !parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  try {
    const deal = await findDeal(dealId);
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    if (deal.posted_by !== req.userId) {
      res.status(403).json({ error: "Only the brand that posted this deal can fund it." });
      return;
    }
    if (!deal.accepted_application_id) {
      res.status(409).json({ error: "Accept a creator's application before funding the deal." });
      return;
    }
    if (deal.escrow_status !== "unfunded") {
      res.status(409).json({ error: `This deal is already ${deal.escrow_status}.` });
      return;
    }
    const amountCents = parsed.data.amountCents;
    if (deal.agreed_amount_cents && amountCents !== deal.agreed_amount_cents) {
      res.status(400).json({ error: `Funding amount must match the agreed payout ($${(deal.agreed_amount_cents / 100).toLocaleString()}).` });
      return;
    }

    await db.execute(sql`
      UPDATE sponsor_deals
      SET agreed_amount_cents = ${amountCents}, escrow_status = 'funding'
      WHERE id = ${dealId}
    `);

    if (!isStripeConfigured()) {
      /* Sandbox mode — no Stripe keys. The frontend "completes" this session
         via /api/sponsors/escrow/confirm to simulate the money movement. */
      const sessionId = `sandbox_${randomUUID()}`;
      await db.execute(sql`
        UPDATE sponsor_deals SET stripe_session_id = ${sessionId} WHERE id = ${dealId}
      `);
      logger.info({ dealId, amountCents }, "[sponsors] escrow funded in SANDBOX mode");
      res.json({
        sandbox: true,
        sessionId,
        amountCents,
        message: "Sandbox mode — no real money moved. Confirm to simulate funding.",
      });
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"]!);
    const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
    const baseUrl = domain ? `https://${domain}` : "http://localhost";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `Sponsorship escrow — ${deal.brand_name}`,
              description: `Deal ${dealId.slice(0, 8)}… — funds held until the brand releases them`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        sponsor_deal_id: dealId,
        sponsor_escrow: "true",
        brand_user_id: req.userId!,
        amount_cents: String(amountCents),
      },
      success_url: `${baseUrl}/sponsors/${dealId}?funded=1`,
      cancel_url: `${baseUrl}/sponsors/${dealId}?funded=0`,
    });
    await db.execute(sql`
      UPDATE sponsor_deals SET stripe_session_id = ${session.id} WHERE id = ${dealId}
    `);
    res.json({ sandbox: false, checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to create escrow funding session");
    await db.execute(sql`
      UPDATE sponsor_deals SET escrow_status = 'unfunded' WHERE id = ${dealId} AND escrow_status = 'funding'
    `).catch(() => undefined);
    res.status(500).json({ error: "Could not start the funding flow — try again." });
  }
});

/* Mark an escrow funded — shared by the Stripe webhook (real money) and the
   sandbox confirm endpoint (test mode). Idempotent on session id. */
export async function markEscrowFunded(dealId: string, sessionId: string, paymentIntentId: string | null): Promise<{ ok: boolean; reason?: string }> {
  const deal = await findDeal(dealId);
  if (!deal) return { ok: false, reason: "deal-not-found" };
  if (deal.escrow_status === "funded" && deal.stripe_session_id === sessionId) {
    return { ok: true, reason: "already-funded" };
  }
  if (deal.escrow_status !== "funding" && deal.escrow_status !== "unfunded") {
    return { ok: false, reason: `bad-state:${deal.escrow_status}` };
  }
  await db.execute(sql`
    UPDATE sponsor_deals
    SET escrow_status = 'funded', status = 'funded',
        stripe_session_id = ${sessionId},
        stripe_payment_intent_id = ${paymentIntentId}
    WHERE id = ${dealId}
  `);
  logger.info({ dealId, sessionId }, "[sponsors] escrow funded");
  return { ok: true };
}

export const escrowConfirmSchema = z.object({
  dealId: z.string().uuid(),
  sessionId: z.string().min(1).max(200),
});

/* POST /api/sponsors/escrow/confirm — SANDBOX ONLY. Simulates a successful
   Stripe payment for a sandbox funding session. Refuses to run when real
   Stripe keys are configured (the webhook owns that path then). */
router.post("/sponsors/escrow/confirm", publicApiLimiter, requireAuth, async (req, res) => {
  if (isStripeConfigured()) {
    res.status(400).json({ error: "Sandbox confirm is disabled — Stripe is configured; fund via Checkout." });
    return;
  }
  const parsed = escrowConfirmSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    invalidBody(res, parsed);
    return;
  }
  try {
    const deal = await findDeal(parsed.data.dealId);
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    if (deal.posted_by !== req.userId) {
      res.status(403).json({ error: "Only the brand can confirm funding." });
      return;
    }
    if (!deal.stripe_session_id || !deal.stripe_session_id.startsWith("sandbox_") || deal.stripe_session_id !== parsed.data.sessionId) {
      res.status(400).json({ error: "Unknown sandbox session." });
      return;
    }
    const result = await markEscrowFunded(deal.id, parsed.data.sessionId, null);
    if (!result.ok) {
      res.status(409).json({ error: `Could not confirm funding (${result.reason}).` });
      return;
    }
    res.json({ success: true, escrowStatus: "funded" });
  } catch (err) {
    logger.error({ err }, "[sponsors] sandbox escrow confirm failed");
    res.status(500).json({ error: "Could not confirm funding — try again." });
  }
});

/* POST /api/sponsors/deals/:id/start — accepted creator starts work.
   Deal: funded → in_progress. */
router.post("/sponsors/deals/:id/start", publicApiLimiter, requireAuth, async (req, res) => {
  const dealId = uuidParam(req.params["id"]);
  if (!dealId) {
    res.status(400).json({ error: "Invalid deal id." });
    return;
  }
  try {
    const deal = await findDeal(dealId);
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    if (deal.accepted_user_id !== req.userId) {
      res.status(403).json({ error: "Only the accepted creator can start this deal." });
      return;
    }
    if (deal.status !== "funded" || deal.escrow_status !== "funded") {
      res.status(409).json({ error: "The brand must fund the escrow before work starts." });
      return;
    }
    await db.execute(sql`UPDATE sponsor_deals SET status = 'in_progress' WHERE id = ${dealId}`);
    res.json({ success: true, status: "in_progress" });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to start deal");
    res.status(500).json({ error: "Could not start the deal — try again." });
  }
});

/* POST /api/sponsors/deals/:id/complete — accepted creator delivers.
   Deal: in_progress → completed. The brand then releases payment. */
router.post("/sponsors/deals/:id/complete", publicApiLimiter, requireAuth, async (req, res) => {
  const dealId = uuidParam(req.params["id"]);
  if (!dealId) {
    res.status(400).json({ error: "Invalid deal id." });
    return;
  }
  try {
    const deal = await findDeal(dealId);
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    if (deal.accepted_user_id !== req.userId) {
      res.status(403).json({ error: "Only the accepted creator can mark this deal complete." });
      return;
    }
    if (deal.status !== "in_progress") {
      res.status(409).json({ error: "Work must be started before it can be marked complete." });
      return;
    }
    await db.execute(sql`UPDATE sponsor_deals SET status = 'completed' WHERE id = ${dealId}`);
    res.json({ success: true, status: "completed" });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to complete deal");
    res.status(500).json({ error: "Could not mark the deal complete — try again." });
  }
});

/* POST /api/sponsors/deals/:id/release — brand releases the escrow to the
   creator. Bow Down Visuals keeps 15% (platform fee); the creator gets the
   rest. Writes the payout ledger row. Deal: completed → paid. */
router.post("/sponsors/deals/:id/release", publicApiLimiter, requireAuth, async (req, res) => {
  const dealId = uuidParam(req.params["id"]);
  if (!dealId) {
    res.status(400).json({ error: "Invalid deal id." });
    return;
  }
  try {
    const deal = await findDeal(dealId);
    if (!deal) {
      res.status(404).json({ error: "Deal not found." });
      return;
    }
    if (deal.posted_by !== req.userId) {
      res.status(403).json({ error: "Only the brand can release payment." });
      return;
    }
    if (deal.status !== "completed" || deal.escrow_status !== "funded") {
      res.status(409).json({ error: "The creator must deliver the work before payment releases." });
      return;
    }
    const gross = deal.agreed_amount_cents;
    if (!gross || gross <= 0 || !deal.accepted_user_id) {
      res.status(409).json({ error: "This deal has no agreed payout to release." });
      return;
    }
    const { feeCents, netCents } = sponsorFeeSplit(gross);
    /* Fast-path idempotency check (pg-mem can't plan ON CONFLICT against
       the table-level UNIQUE(deal_id); the status guard below is the
       production race guard since release only runs from 'completed'). */
    const existingPayout = await db.execute(sql`
      SELECT id FROM sponsor_payouts WHERE deal_id = ${dealId} LIMIT 1
    `);
    if (existingPayout.rows.length === 0) {
      await db.execute(sql`
        INSERT INTO sponsor_payouts (id, deal_id, creator_user_id, gross_cents, fee_cents, net_cents, status)
        VALUES (${randomUUID()}, ${dealId}, ${deal.accepted_user_id}, ${gross}, ${feeCents}, ${netCents}, 'released')
      `);
    }
    await db.execute(sql`
      UPDATE sponsor_deals
      SET status = 'paid', escrow_status = 'released',
          platform_fee_cents = ${feeCents}, creator_payout_cents = ${netCents},
          paid_at = NOW()
      WHERE id = ${dealId}
    `);
    logger.info({ dealId, gross, feeCents, netCents }, "[sponsors] escrow released — platform fee collected");
    res.json({
      success: true,
      status: "paid",
      grossCents: gross,
      platformFeeCents: feeCents,
      creatorPayoutCents: netCents,
    });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to release escrow");
    res.status(500).json({ error: "Could not release payment — try again." });
  }
});

/* GET /api/sponsors/dashboard — my deals, my applications, my earnings.
   Free (pure UI read). */
router.get("/sponsors/dashboard", publicApiLimiter, requireAuth, async (req, res) => {
  try {
    const posted = await db.execute(sql`
      SELECT ${sql.raw(FULL_DEAL_COLS)}
      FROM sponsor_deals
      WHERE posted_by = ${req.userId!}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    const applied = await db.execute(sql`
      SELECT a.id, a.deal_id, a.status AS application_status, a.pitch, a.created_at,
             d.brand_name, d.budget_min, d.budget_max, d.niche, d.status AS deal_status,
             d.agreed_amount_cents, d.escrow_status
      FROM sponsor_applications a
      JOIN sponsor_deals d ON d.id = a.deal_id
      WHERE a.user_id = ${req.userId!}
      ORDER BY a.created_at DESC
      LIMIT 100
    `);
    const payouts = await db.execute(sql`
      SELECT p.id, p.deal_id, p.gross_cents, p.fee_cents, p.net_cents, p.status, p.created_at,
             d.brand_name
      FROM sponsor_payouts p
      JOIN sponsor_deals d ON d.id = p.deal_id
      WHERE p.creator_user_id = ${req.userId!}
      ORDER BY p.created_at DESC
      LIMIT 100
    `);
    const postedRows = posted.rows as unknown as FullDealRow[];
    const postedDeals = await Promise.all(
      postedRows.map(async (d) => toFullDealDto(d, await countApplications(d.id), null)),
    );
    const totalEarnedCents = (payouts.rows as { net_cents: number }[]).reduce(
      (sum, p) => sum + Number(p.net_cents ?? 0), 0,
    );
    res.json({
      postedDeals,
      applications: applied.rows,
      payouts: payouts.rows,
      totalEarnedCents,
    });
  } catch (err) {
    logger.error({ err }, "[sponsors] failed to load dashboard");
    res.status(500).json({ error: "Could not load your dashboard — try again." });
  }
});

export default router;
