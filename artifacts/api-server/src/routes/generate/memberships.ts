import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, fanTiersTable, fanMembersTable } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── Fan Memberships ────────────────────────────────────────────────────
   /memberships — creators launch fan clubs with paid tiers.
   v1 honesty contract: tier setup + member tracking are real. Actual payment
   processing is "coming soon" — members are tracked manually (or imported)
   until Stripe billing lands. The UI and API never fake a transaction.
   Pricing: free to set up. The site's 10% platform fee applies to future
   payment processing (revenue share, not credits). Only the AI perk
   suggester costs credits (1 credit, charge-before-generate, refund on
   provider failure). */

/* 1 credit per AI perk suggestion — env-overridable without a deploy. */
export const MEMBERSHIPS_AI_CREDITS = Number(process.env["MEMBERSHIPS_AI_CREDIT_COST"]) || 1;

/* Platform fee intent for v1 — recorded on tiers for transparency; no money
   moves until payment processing ships. */
export const MEMBERSHIPS_PLATFORM_FEE_PCT = 10;

const perkSchema = z.string().trim().min(1).max(140);

const tierCreateSchema = z.object({
  name: z.string().trim().min(1, "Tier name is required.").max(60),
  /* Price in dollars for the UI; stored as integer cents. Max $999.99/mo. */
  priceDollars: z.number().min(0).max(999.99),
  description: z.string().trim().max(500).optional().default(""),
  perks: z.array(perkSchema).max(20).optional().default([]),
});

const tierUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  priceDollars: z.number().min(0).max(999.99).optional(),
  description: z.string().trim().max(500).optional(),
  perks: z.array(perkSchema).max(20).optional(),
  is_active: z.enum(["true", "false"]).optional(),
});

const memberAddSchema = z.object({
  tierId: z.string().uuid("tierId must be a UUID."),
  fanLabel: z.string().trim().min(1, "Fan label is required.").max(120),
  status: z.enum(["active", "past_due", "canceled"]).optional().default("active"),
});

const memberStatusSchema = z.object({
  status: z.enum(["active", "past_due", "canceled"]),
});

const perkSuggestSchema = z.object({
  niche: z.string().trim().min(1, "Niche is required.").max(80),
  audienceSize: z.enum(["starting", "growing", "established"]),
  tierCount: z.number().int().min(1).max(5).optional().default(3),
});

export function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

export function centsToDollars(c: number): number {
  return c / 100;
}

/* Express 5 types req.params values as string | string[]. This unwraps to a
   single string for route params (we never use wildcard splats). */
function param(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/* Net payout after the platform fee, in cents — for the dashboard's honest
   "what you'd keep" figure (applies once payments ship). */
export function netAfterFee(cents: number): number {
  return Math.round(cents * (100 - MEMBERSHIPS_PLATFORM_FEE_PCT) / 100);
}

function toTierJson(t: typeof fanTiersTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    priceDollars: centsToDollars(t.price_cents),
    priceCents: t.price_cents,
    description: t.description ?? "",
    perks: t.perks ?? [],
    isActive: t.is_active === "true",
    createdAt: t.created_at,
  };
}

/* GET /api/memberships/tiers — list the creator's tiers (free). */
router.get("/memberships/tiers", publicApiLimiter, requireAuth, async (req, res) => {
  const tiers = await db
    .select()
    .from(fanTiersTable)
    .where(eq(fanTiersTable.user_id, req.userId!))
    .orderBy(fanTiersTable.sort_order, fanTiersTable.created_at);
  res.json({ tiers: tiers.map(toTierJson), platformFeePct: MEMBERSHIPS_PLATFORM_FEE_PCT });
});

/* POST /api/memberships/tiers — create a tier (free). */
router.post("/memberships/tiers", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = tierCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid tier.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { name, priceDollars, description, perks } = parsed.data;
  const [tier] = await db
    .insert(fanTiersTable)
    .values({
      user_id: req.userId!,
      name,
      price_cents: dollarsToCents(priceDollars),
      description,
      perks,
    })
    .returning();
  res.status(201).json({ tier: toTierJson(tier!) });
});

/* PUT /api/memberships/tiers/:id — update a tier (free, owner only). */
router.put("/memberships/tiers/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = tierUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid tier update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { name, priceDollars, description, perks, is_active } = parsed.data;
  const updates: Partial<typeof fanTiersTable.$inferInsert> = { updated_at: new Date() };
  if (name !== undefined) updates.name = name;
  if (priceDollars !== undefined) updates.price_cents = dollarsToCents(priceDollars);
  if (description !== undefined) updates.description = description;
  if (perks !== undefined) updates.perks = perks;
  if (is_active !== undefined) updates.is_active = is_active;
  const [tier] = await db
    .update(fanTiersTable)
    .set(updates)
    .where(and(eq(fanTiersTable.id, param(req.params.id)), eq(fanTiersTable.user_id, req.userId!)))
    .returning();
  if (!tier) {
    res.status(404).json({ error: "Tier not found." });
    return;
  }
  res.json({ tier: toTierJson(tier) });
});

/* DELETE /api/memberships/tiers/:id — delete a tier + its members (free, owner only). */
router.delete("/memberships/tiers/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const owned = await db
    .select({ id: fanTiersTable.id })
    .from(fanTiersTable)
    .where(and(eq(fanTiersTable.id, param(req.params.id)), eq(fanTiersTable.user_id, req.userId!)));
  if (owned.length === 0) {
    res.status(404).json({ error: "Tier not found." });
    return;
  }
  await db.delete(fanMembersTable).where(eq(fanMembersTable.tier_id, param(req.params.id)));
  await db.delete(fanTiersTable).where(eq(fanTiersTable.id, param(req.params.id)));
  res.json({ deleted: true });
});

/* GET /api/memberships/dashboard — subscriber counts, MRR, churn (free).
   MRR is computed from active members' locked-in price_cents — real tracked
   data, not a projection. Churn = canceled / (active + canceled). */
router.get("/memberships/dashboard", publicApiLimiter, requireAuth, async (req, res) => {
  const members = await db
    .select()
    .from(fanMembersTable)
    .where(eq(fanMembersTable.user_id, req.userId!));
  const active = members.filter((m) => m.status === "active");
  const canceled = members.filter((m) => m.status === "canceled");
  const mrrCents = active.reduce((sum, m) => sum + m.price_cents, 0);
  const total = active.length + canceled.length;
  const churnPct = total === 0 ? 0 : Math.round((canceled.length / total) * 100);

  /* Per-tier breakdown. */
  const tiers = await db
    .select()
    .from(fanTiersTable)
    .where(eq(fanTiersTable.user_id, req.userId!))
    .orderBy(fanTiersTable.sort_order);
  const byTier = tiers.map((t) => {
    const tm = members.filter((m) => m.tier_id === t.id && m.status === "active");
    return {
      tierId: t.id,
      name: t.name,
      activeMembers: tm.length,
      mrrCents: tm.reduce((s, m) => s + m.price_cents, 0),
    };
  });

  res.json({
    activeMembers: active.length,
    pastDueMembers: members.filter((m) => m.status === "past_due").length,
    canceledMembers: canceled.length,
    mrrCents,
    mrrDollars: centsToDollars(mrrCents),
    netMrrCents: netAfterFee(mrrCents),
    churnPct,
    byTier,
    paymentsLive: false, /* v1 honesty: tracking only until Stripe billing ships */
  });
});

/* GET /api/memberships/members — list members (free). */
router.get("/memberships/members", publicApiLimiter, requireAuth, async (req, res) => {
  const members = await db
    .select()
    .from(fanMembersTable)
    .where(eq(fanMembersTable.user_id, req.userId!))
    .orderBy(desc(fanMembersTable.joined_at))
    .limit(200);
  const tiers = await db
    .select({ id: fanTiersTable.id, name: fanTiersTable.name })
    .from(fanTiersTable)
    .where(eq(fanTiersTable.user_id, req.userId!));
  const tierNames = new Map(tiers.map((t) => [t.id, t.name]));
  res.json({
    members: members.map((m) => ({
      id: m.id,
      tierId: m.tier_id,
      tierName: tierNames.get(m.tier_id) ?? "Unknown tier",
      fanLabel: m.fan_label,
      status: m.status,
      priceCents: m.price_cents,
      priceDollars: centsToDollars(m.price_cents),
      joinedAt: m.joined_at,
    })),
  });
});

/* POST /api/memberships/members — add a member manually (free).
   Manual tracking until payment processing ships; the UI labels this
   honestly ("add manually — payments coming soon"). */
router.post("/memberships/members", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = memberAddSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid member.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { tierId, fanLabel, status } = parsed.data;
  const tier = await db
    .select()
    .from(fanTiersTable)
    .where(and(eq(fanTiersTable.id, tierId), eq(fanTiersTable.user_id, req.userId!)));
  if (tier.length === 0) {
    res.status(404).json({ error: "Tier not found." });
    return;
  }
  try {
    const [member] = await db
      .insert(fanMembersTable)
      .values({
        user_id: req.userId!,
        tier_id: tierId,
        fan_label: fanLabel,
        status,
        price_cents: tier[0]!.price_cents,
      })
      .returning();
    res.status(201).json({ member: { id: member!.id, tierId, fanLabel, status } });
  } catch (err) {
    /* Unique (tier_id, fan_label) violation → already tracked. */
    res.status(409).json({ error: "That fan is already on this tier." });
  }
});

/* PATCH /api/memberships/members/:id — update member status (free, owner only). */
router.patch("/memberships/members/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = memberStatusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status." });
    return;
  }
  const { status } = parsed.data;
  const [member] = await db
    .update(fanMembersTable)
    .set({
      status,
      canceled_at: status === "canceled" ? new Date() : null,
      updated_at: new Date(),
    })
    .where(and(eq(fanMembersTable.id, param(req.params.id)), eq(fanMembersTable.user_id, req.userId!)))
    .returning();
  if (!member) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  res.json({ member: { id: member.id, status: member.status } });
});

/* DELETE /api/memberships/members/:id — remove a member (free, owner only). */
router.delete("/memberships/members/:id", publicApiLimiter, requireAuth, async (req, res) => {
  const deleted = await db
    .delete(fanMembersTable)
    .where(and(eq(fanMembersTable.id, param(req.params.id)), eq(fanMembersTable.user_id, req.userId!)))
    .returning({ id: fanMembersTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Member not found." });
    return;
  }
  res.json({ deleted: true });
});

/* POST /api/memberships/ai-perks { niche, audienceSize, tierCount }
   → 200 { tiers: [{ name, priceDollars, perks[] }], creditsUsed, creditsRemaining }
   Paid: 1 credit. Charge-before-generate; refund on provider failure. */
router.post("/memberships/ai-perks", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = perkSuggestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid perk request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < MEMBERSHIPS_AI_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to get AI tier suggestions.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, MEMBERSHIPS_AI_CREDITS, {
      action: "Fan Memberships AI Perks",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to get AI tier suggestions.",
      });
      return;
    }
    throw err;
  }

  const { niche, audienceSize, tierCount } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You design fan-club membership tiers for independent creators. ` +
            `A creator gives their niche, audience size (starting = under 10k fans, ` +
            `growing = 10k-100k, established = 100k+), and how many tiers they want. ` +
            `Return tier structures that make sense: prices rise with audience size ` +
            `(starting: $3-$15/mo, growing: $5-$25/mo, established: $10-$50/mo), ` +
            `each tier strictly better than the last, perks concrete and deliverable ` +
            `(early access, behind-the-scenes, Q&As, shout-outs, exclusive drops — ` +
            `never vague "more content"). ` +
            `Return ONLY JSON: {"tiers": [{"name": "...", "priceDollars": <number>, ` +
            `"perks": ["...", "..."]}]}`,
        },
        {
          role: "user",
          content:
            `Design ${tierCount} membership tiers.\n` +
            `Niche: ${niche.trim()}\n` +
            `Audience size: ${audienceSize}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    interface TierJson { name?: unknown; priceDollars?: unknown; perks?: unknown }
    let tiers: { name: string; priceDollars: number; perks: string[] }[] = [];
    try {
      const j = JSON.parse(raw) as { tiers?: unknown };
      if (Array.isArray(j.tiers)) {
        tiers = (j.tiers as TierJson[])
          .filter((t) => t && typeof t === "object")
          .map((t) => ({
            name: String(t.name ?? "").trim().slice(0, 60),
            priceDollars:
              typeof t.priceDollars === "number" && t.priceDollars >= 0 && t.priceDollars <= 999.99
                ? Math.round(t.priceDollars * 100) / 100
                : 5,
            perks: Array.isArray(t.perks)
              ? t.perks.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
                  .map((p) => p.trim().slice(0, 140)).slice(0, 10)
              : [],
          }))
          .filter((t) => t.name && t.perks.length > 0)
          .slice(0, 5);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (tiers.length === 0) {
      throw new Error("Model returned no usable tier suggestions");
    }

    res.json({ tiers, creditsUsed: MEMBERSHIPS_AI_CREDITS, creditsRemaining });
  } catch (err) {
    /* Provider failure after charging → refund, then report. */
    await refundCredits(req.userId!, MEMBERSHIPS_AI_CREDITS, {
      action: "Fan Memberships AI Perks — Refund (provider failed)",
    });
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[memberships] OpenAI rate limit / quota");
      res.status(503).json({ error: "The suggester is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[memberships] AI perk suggester failed");
    res.status(502).json({ error: "Couldn't generate tier suggestions — credits refunded, try again." });
  }
});

export default router;
