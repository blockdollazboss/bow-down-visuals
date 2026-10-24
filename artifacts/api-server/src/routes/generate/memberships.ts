import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, fanTiersTable, fanMembersTable, fanMembershipGiftsTable } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import {
  createPaymentCheckout,
  retrieveCheckoutSession,
  refundCheckoutSessionPayment,
  checkoutBaseUrl,
  isCheckoutTestMode,
} from "../../lib/stripe-checkout";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { emitNewMemberWebhook } from "../../lib/api-webhooks";

const router = Router();

/* ─── Fan Memberships ────────────────────────────────────────────────────
   /memberships — creators launch fan clubs with paid tiers.
   Payments (0132): fans join through a TEST-mode checkout; a membership
   turns active only after POST /memberships/verify confirms the session
   was paid. Displayed price = charged price (the amount is computed from
   the tier row in exactly one place — checkoutChargeCents — and verify
   re-checks the session total against it). Manual member tracking from
   v1 still exists for imported subscribers (fan_user_id null).
   Trials: tiers can offer a 7-day free trial — no charge during the
   trial; it converts only via a real paid checkout, otherwise the
   membership reads as expired (effectiveMemberStatus).
   Renewal: memberships are one paid period at a time (monthly/annual) —
   there is no silent auto-charge; when a period ends the membership
   reads expired and the fan renews with a fresh checkout.
   Pricing: free to set up. The site's 10% platform fee comes out of the
   creator's cut. Only the AI perk suggester costs credits (1 credit,
   charge-before-generate, refund on provider failure). */

/* 1 credit per AI perk suggestion — env-overridable without a deploy. */
export const MEMBERSHIPS_AI_CREDITS = Number(process.env["MEMBERSHIPS_AI_CREDIT_COST"]) || 100;

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
  /* Creator toggles (0132): 7-day free trial + annual discount %. */
  trialEnabled: z.boolean().optional().default(false),
  annualDiscountPct: z.number().int().min(0).max(90).optional().default(0),
});

const tierUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  priceDollars: z.number().min(0).max(999.99).optional(),
  description: z.string().trim().max(500).optional(),
  perks: z.array(perkSchema).max(20).optional(),
  is_active: z.enum(["true", "false"]).optional(),
  trialEnabled: z.boolean().optional(),
  annualDiscountPct: z.number().int().min(0).max(90).optional(),
});

const memberAddSchema = z.object({
  tierId: z.string().uuid("tierId must be a UUID."),
  fanLabel: z.string().trim().min(1, "Fan label is required.").max(120),
  status: z.enum(["active", "past_due", "canceled"]).optional().default("active"),
});

const memberStatusSchema = z.object({
  status: z.enum(["trialing", "active", "past_due", "canceled", "expired"]),
});

const billingPeriodSchema = z.enum(["monthly", "annual"]);

const checkoutSchema = z.object({
  tierId: z.string().uuid("tierId must be a UUID."),
  billingPeriod: billingPeriodSchema.optional().default("monthly"),
  /* Gifted membership: the caller pays, this user becomes the member. */
  recipientUserId: z.string().uuid("recipientUserId must be a UUID.").optional(),
});

const verifySchema = z.object({
  sessionId: z.string().min(1).max(200),
});

const joinTrialSchema = z.object({
  tierId: z.string().uuid("tierId must be a UUID."),
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

/* ── Billing math (single source of truth for displayed = charged) ────── */

/** Free-trial length on tiers that enable it. No charge during the trial. */
export const MEMBERSHIP_TRIAL_DAYS = 7;

/** Annual charge for a tier: 12 monthly payments minus the creator's
    discount %. Used for BOTH the fan-facing display and the checkout
    amount, so the two can never drift apart. */
export function annualPriceCents(monthlyCents: number, discountPct: number): number {
  const pct = Math.max(0, Math.min(90, Math.round(discountPct)));
  return Math.round((monthlyCents * 12 * (100 - pct)) / 100);
}

/** The exact amount a join charges, from the tier row alone. */
export function checkoutChargeCents(
  tier: { price_cents: number; annual_discount_pct: number },
  billingPeriod: "monthly" | "annual",
): number {
  return billingPeriod === "annual"
    ? annualPriceCents(tier.price_cents, tier.annual_discount_pct)
    : tier.price_cents;
}

export function membershipPeriodEnd(billingPeriod: "monthly" | "annual", from: Date): Date {
  const d = new Date(from);
  if (billingPeriod === "annual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export function trialEndDate(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + MEMBERSHIP_TRIAL_DAYS);
  return d;
}

type MemberLike = {
  status: string;
  fan_user_id: string | null;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
};

/** The status a member is REALLY in right now: an unconverted trial past
    its end is expired, and a paid period that ran out without a renewal
    checkout is expired too. Stored rows are never silently rewritten —
    this is computed at read time so every surface agrees. */
export function effectiveMemberStatus(m: MemberLike, now: Date = new Date()): string {
  if (m.status === "trialing" && m.trial_ends_at && new Date(m.trial_ends_at) <= now) {
    return "expired";
  }
  if (
    m.status === "active" &&
    m.fan_user_id &&
    m.current_period_end &&
    new Date(m.current_period_end) <= now
  ) {
    return "expired";
  }
  return m.status;
}

function toTierJson(t: typeof fanTiersTable.$inferSelect) {
  return {
    id: t.id,
    creatorUserId: t.user_id,
    name: t.name,
    priceDollars: centsToDollars(t.price_cents),
    priceCents: t.price_cents,
    description: t.description ?? "",
    perks: t.perks ?? [],
    isActive: t.is_active === "true",
    trialEnabled: t.trial_enabled,
    annualDiscountPct: t.annual_discount_pct,
    annualPriceCents: annualPriceCents(t.price_cents, t.annual_discount_pct),
    annualPriceDollars: centsToDollars(annualPriceCents(t.price_cents, t.annual_discount_pct)),
    createdAt: t.created_at,
  };
}

function toMemberJson(m: typeof fanMembersTable.$inferSelect, tierName?: string) {
  return {
    id: m.id,
    tierId: m.tier_id,
    tierName: tierName ?? null,
    creatorUserId: m.user_id,
    fanLabel: m.fan_label,
    fanUserId: m.fan_user_id,
    status: effectiveMemberStatus(m),
    storedStatus: m.status,
    priceCents: m.price_cents,
    priceDollars: centsToDollars(m.price_cents),
    billingPeriod: m.billing_period,
    currentPeriodStart: m.current_period_start,
    currentPeriodEnd: m.current_period_end,
    trialEndsAt: m.trial_ends_at,
    isGift: m.is_gift,
    giftedByUserId: m.gifted_by_user_id,
    joinedAt: m.joined_at,
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
  const { name, priceDollars, description, perks, trialEnabled, annualDiscountPct } = parsed.data;
  const [tier] = await db
    .insert(fanTiersTable)
    .values({
      user_id: req.userId!,
      name,
      price_cents: dollarsToCents(priceDollars),
      description,
      perks,
      trial_enabled: trialEnabled,
      annual_discount_pct: annualDiscountPct,
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
  const { name, priceDollars, description, perks, is_active, trialEnabled, annualDiscountPct } = parsed.data;
  const updates: Partial<typeof fanTiersTable.$inferInsert> = { updated_at: new Date() };
  if (name !== undefined) updates.name = name;
  if (priceDollars !== undefined) updates.price_cents = dollarsToCents(priceDollars);
  if (description !== undefined) updates.description = description;
  if (perks !== undefined) updates.perks = perks;
  if (is_active !== undefined) updates.is_active = is_active;
  if (trialEnabled !== undefined) updates.trial_enabled = trialEnabled;
  if (annualDiscountPct !== undefined) updates.annual_discount_pct = annualDiscountPct;
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
  const active = members.filter((m) => effectiveMemberStatus(m) === "active");
  const canceled = members.filter((m) => effectiveMemberStatus(m) === "canceled");
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
    const tm = members.filter((m) => m.tier_id === t.id && effectiveMemberStatus(m) === "active");
    return {
      tierId: t.id,
      name: t.name,
      activeMembers: tm.length,
      mrrCents: tm.reduce((s, m) => s + m.price_cents, 0),
    };
  });

  res.json({
    activeMembers: active.length,
    pastDueMembers: members.filter((m) => effectiveMemberStatus(m) === "past_due").length,
    trialingMembers: members.filter((m) => effectiveMemberStatus(m) === "trialing").length,
    expiredMembers: members.filter((m) => effectiveMemberStatus(m) === "expired").length,
    canceledMembers: canceled.length,
    mrrCents,
    mrrDollars: centsToDollars(mrrCents),
    netMrrCents: netAfterFee(mrrCents),
    churnPct,
    byTier,
    paymentsLive: true, /* 0132: TEST-mode checkout — joins verify as paid before activating */
    testMode: isCheckoutTestMode(),
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
    members: members.map((m) => toMemberJson(m, tierNames.get(m.tier_id) ?? "Unknown tier")),
  });
});

/* POST /api/memberships/members — add a member manually (free).
   Manual tracking for imported/off-platform subscribers; the UI labels
   these honestly (no payment was taken here). */
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

/* ── Payments: join / gift / trial / verify (TEST-mode checkout) ──────── */

async function findTierById(tierId: string) {
  const rows = await db.select().from(fanTiersTable).where(eq(fanTiersTable.id, tierId)).limit(1);
  return rows[0] ?? null;
}

async function findMemberForFan(tierId: string, fanUserId: string) {
  const rows = await db
    .select()
    .from(fanMembersTable)
    .where(and(eq(fanMembersTable.tier_id, tierId), eq(fanMembersTable.fan_user_id, fanUserId)))
    .limit(1);
  return rows[0] ?? null;
}

/* GET /api/memberships/public/:creatorUserId — a creator's joinable tiers
   (public: fans land here from the creator's shared join link). */
router.get("/memberships/public/:creatorUserId", publicApiLimiter, async (req, res) => {
  const creatorUserId = param(req.params.creatorUserId);
  if (!/^[0-9a-f-]{36}$/i.test(creatorUserId)) {
    res.status(400).json({ error: "Invalid creator." });
    return;
  }
  try {
    const tiers = await db
      .select()
      .from(fanTiersTable)
      .where(and(eq(fanTiersTable.user_id, creatorUserId), eq(fanTiersTable.is_active, "true")))
      .orderBy(fanTiersTable.sort_order, fanTiersTable.created_at);
    res.json({ creatorUserId, tiers: tiers.map(toTierJson), testMode: isCheckoutTestMode() });
  } catch (err) {
    logger.error({ err, creatorUserId }, "[memberships] public tiers load failed");
    res.status(500).json({ error: "Couldn't load memberships. Try again." });
  }
});

/* POST /api/memberships/checkout — start a join (or gift) checkout.
   The charged amount comes from checkoutChargeCents(tier, period) — the
   same number the tier DTO displays as the price. Free tiers skip
   checkout entirely and activate immediately (no payment to verify). */
router.post("/memberships/checkout", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid checkout.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { tierId, billingPeriod } = parsed.data;
  const recipientUserId = parsed.data.recipientUserId ?? req.userId!;
  const isGift = recipientUserId !== req.userId;

  const tier = await findTierById(tierId);
  if (!tier || tier.is_active !== "true") {
    res.status(404).json({ error: "Tier not found." });
    return;
  }
  if (recipientUserId === tier.user_id) {
    res.status(400).json({ error: "A creator can't join their own fan club." });
    return;
  }
  const existing = await findMemberForFan(tierId, recipientUserId);
  if (existing && effectiveMemberStatus(existing) === "active") {
    res.status(409).json({
      error: "ALREADY_MEMBER",
      message: isGift ? "That fan is already an active member of this tier." : "You're already an active member of this tier.",
    });
    return;
  }

  const amountCents = checkoutChargeCents(tier, billingPeriod);
  const now = new Date();

  /* Free tier: nothing to charge — activate honestly with a real period. */
  if (amountCents <= 0) {
    const values = {
      user_id: tier.user_id,
      tier_id: tierId,
      fan_label: req.userEmail ?? `fan:${recipientUserId}`,
      fan_user_id: recipientUserId,
      status: "active" as const,
      price_cents: 0,
      billing_period: billingPeriod,
      current_period_start: now,
      current_period_end: membershipPeriodEnd(billingPeriod, now),
      trial_ends_at: null,
      is_gift: isGift,
      gifted_by_user_id: isGift ? req.userId! : null,
      updated_at: now,
    };
    let member: typeof fanMembersTable.$inferSelect;
    if (existing) {
      const [updated] = await db.update(fanMembersTable).set(values).where(eq(fanMembersTable.id, existing.id)).returning();
      member = updated!;
    } else {
      const [inserted] = await db.insert(fanMembersTable).values(values).returning();
      member = inserted!;
      // Public-API webhook (lane 20): brand-new member row only (an
      // existing-row refresh above is a renewal, not a join).
      // Fire-and-forget — never fails or rolls back the join.
      emitNewMemberWebhook(tier.user_id, {
        memberId: member.id,
        tierId,
        fanUserId: recipientUserId,
        status: member.status,
        priceCents: member.price_cents,
        billingPeriod: member.billing_period,
      });
    }
    res.status(201).json({ free: true, membership: toMemberJson(member, tier.name) });
    return;
  }

  try {
    const baseUrl = checkoutBaseUrl(req);
    const session = await createPaymentCheckout({
      amountCents,
      productName: `${tier.name} membership — ${billingPeriod}`,
      description: isGift ? "Gifted fan membership" : "Fan membership",
      successUrl: `${baseUrl}/memberships?creator=${tier.user_id}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/memberships?creator=${tier.user_id}`,
      metadata: {
        purchase_kind: "membership",
        tier_id: tierId,
        creator_user_id: tier.user_id,
        fan_user_id: recipientUserId,
        purchaser_user_id: req.userId!,
        billing_period: billingPeriod,
        amount_cents: String(amountCents),
        is_gift: isGift ? "true" : "false",
      },
      /* The intent carries the recipient member row's current state.
         A retry before verify changes nothing and reuses the session;
         once verify activates/renews the row, its period + updated_at
         advance, so the next legitimate purchase gets a fresh key. */
      idempotency: {
        memberId: req.userId!,
        rail: "membership",
        purchaseIntent: {
          tierId,
          creatorUserId: tier.user_id,
          recipientUserId,
          billingPeriod,
          amountCents,
          isGift,
          existingMember: existing
            ? {
                id: existing.id,
                status: existing.status,
                billingPeriod: existing.billing_period,
                currentPeriodStart: existing.current_period_start,
                currentPeriodEnd: existing.current_period_end,
                updatedAt: existing.updated_at,
              }
            : null,
        },
      },
    });
    if (isGift) {
      await db.insert(fanMembershipGiftsTable).values({
        tier_id: tierId,
        creator_user_id: tier.user_id,
        purchaser_user_id: req.userId!,
        recipient_user_id: recipientUserId,
        stripe_session_id: session.sessionId,
        amount_cents: amountCents,
        billing_period: billingPeriod,
        status: "pending_payment",
      });
    }
    logger.info(
      { tierId, fanUserId: recipientUserId, amountCents, billingPeriod, isGift, sessionId: session.sessionId },
      "[memberships] checkout session created",
    );
    res.json({
      url: session.url,
      sessionId: session.sessionId,
      amountCents,
      amountDollars: centsToDollars(amountCents),
      billingPeriod,
      isGift,
      testMode: isCheckoutTestMode(),
    });
  } catch (err) {
    logger.error({ err, tierId }, "[memberships] checkout failed");
    res.status(500).json({ error: "Could not start checkout. Try again in a moment." });
  }
});

/* POST /api/memberships/verify — the ONLY path from paid checkout to an
   active membership. Idempotent on the session id (unique index +
   read-back), and the session total must match the tier's computed
   charge for the period — a tampered or stale session never activates. */
router.post("/memberships/verify", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const { sessionId } = parsed.data;

  let session: Awaited<ReturnType<typeof retrieveCheckoutSession>>;
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch {
    res.status(400).json({ error: "Could not retrieve this checkout session." });
    return;
  }
  if (session.payment_status !== "paid") {
    res.status(400).json({ error: "Payment has not been completed." });
    return;
  }
  const meta = session.metadata ?? {};
  if (meta["purchase_kind"] !== "membership" || !meta["tier_id"] || !meta["fan_user_id"]) {
    res.status(400).json({ error: "This session isn't a membership purchase." });
    return;
  }
  if (meta["purchaser_user_id"] !== req.userId) {
    res.status(403).json({ error: "This purchase doesn't belong to you." });
    return;
  }
  const tierId = meta["tier_id"];
  const fanUserId = meta["fan_user_id"];
  const billingPeriod = meta["billing_period"] === "annual" ? "annual" : "monthly";
  const isGift = meta["is_gift"] === "true";

  const tier = await findTierById(tierId);
  if (!tier) {
    /* Paid, but the tier was deleted after payment — the membership
       can NEVER be recorded (Lane V3 F3). Refund automatically and
       say exactly what happened; the refund is claimed only when it
       landed. */
    const refunded = await refundCheckoutSessionPayment(session);
    logger.error({ sessionId, refunded }, "[memberships] verify: tier deleted after payment");
    res.status(400).json({
      error: refunded
        ? "The tier for this purchase no longer exists — your payment has been refunded in full."
        : "The tier for this purchase no longer exists. Your payment couldn't be refunded automatically — contact support and we'll make it right.",
      refunded,
    });
    return;
  }
  const amountCents = session.amount_total ?? 0;
  /* Verify against the CHECKOUT-LOCKED amount (Lane V3 F4): the
     checkout wrote the charged amount into the session metadata, so
     a tier price change after purchase no longer rejects a correctly
     paid session. Sessions predating the lock fall back to the
     current price (the old behavior). */
  const lockedCents = Number(meta["amount_cents"]);
  const expectedCents =
    Number.isFinite(lockedCents) && lockedCents > 0 ? lockedCents : checkoutChargeCents(tier, billingPeriod);
  if (amountCents !== expectedCents) {
    logger.error({ sessionId, amountCents, expectedCents }, "[memberships] verify: amount mismatch");
    res.status(400).json({ error: "The paid amount doesn't match this tier's price." });
    return;
  }

  try {
    /* Idempotency: this session already produced a membership. */
    const bySession = await db
      .select()
      .from(fanMembersTable)
      .where(eq(fanMembersTable.stripe_session_id, sessionId))
      .limit(1);
    if (bySession[0]) {
      res.json({ success: true, duplicate: true, membership: toMemberJson(bySession[0], tier.name) });
      return;
    }

    const now = new Date();
    const values = {
      user_id: tier.user_id,
      tier_id: tierId,
      /* The label must identify the FAN, never the payer: for gifts the
         checkout email is the purchaser's, and reusing it would collide
         on the (tier_id, fan_label) unique index when the same person
         gifts the same tier to two different fans. */
      fan_label: isGift
        ? `fan:${fanUserId}`
        : (session.customer_details?.email ?? req.userEmail ?? `fan:${fanUserId}`),
      fan_user_id: fanUserId,
      status: "active" as const,
      price_cents: amountCents,
      billing_period: billingPeriod,
      current_period_start: now,
      current_period_end: membershipPeriodEnd(billingPeriod, now),
      trial_ends_at: null,
      stripe_session_id: sessionId,
      external_ref: sessionId,
      is_gift: isGift,
      gifted_by_user_id: isGift ? req.userId! : null,
      canceled_at: null,
      updated_at: now,
    };
    /* Trial conversion (or renewal of an expired/canceled seat) reuses
       the fan's existing row for the tier instead of duplicating it. */
    const existing = await findMemberForFan(tierId, fanUserId);
    let member: typeof fanMembersTable.$inferSelect;
    if (existing) {
      const [updated] = await db.update(fanMembersTable).set(values).where(eq(fanMembersTable.id, existing.id)).returning();
      member = updated!;
    } else {
      const [inserted] = await db.insert(fanMembersTable).values(values).returning();
      member = inserted!;
      // Public-API webhook (lane 20): brand-new paid member only (the
      // existing-row branch above is a conversion/renewal, not a join).
      // Fire-and-forget — never fails or rolls back the membership.
      emitNewMemberWebhook(tier.user_id, {
        memberId: member.id,
        tierId,
        fanUserId,
        status: member.status,
        priceCents: member.price_cents,
        billingPeriod: member.billing_period,
      });
    }
    if (isGift) {
      await db
        .update(fanMembershipGiftsTable)
        .set({ status: "active", member_id: member.id, amount_cents: amountCents, updated_at: now })
        .where(eq(fanMembershipGiftsTable.stripe_session_id, sessionId));
    }
    logger.info({ sessionId, memberId: member.id, amountCents }, "[memberships] membership activated");
    res.json({ success: true, duplicate: false, membership: toMemberJson(member, tier.name) });
  } catch (err) {
    logger.error({ err, sessionId }, "[memberships] verify failed");
    res.status(500).json({ error: "Payment confirmed but the membership couldn't be recorded. Contact support." });
  }
});

/* POST /api/memberships/join-trial — start the 7-day free trial.
   No charge, no checkout: the membership is 'trialing' until trial end.
   It converts ONLY through a paid checkout + verify; otherwise it reads
   as expired. One trial per fan per tier, ever. */
router.post("/memberships/join-trial", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = joinTrialSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "tierId is required" });
    return;
  }
  const tier = await findTierById(parsed.data.tierId);
  if (!tier || tier.is_active !== "true") {
    res.status(404).json({ error: "Tier not found." });
    return;
  }
  if (!tier.trial_enabled || tier.price_cents <= 0) {
    res.status(400).json({ error: "TRIAL_NOT_AVAILABLE", message: "This tier doesn't offer a free trial." });
    return;
  }
  if (tier.user_id === req.userId) {
    res.status(400).json({ error: "A creator can't trial their own fan club." });
    return;
  }
  const existing = await findMemberForFan(tier.id, req.userId!);
  if (existing) {
    res.status(409).json({
      error: "TRIAL_ALREADY_USED",
      message: "You've already had a trial or membership on this tier — join with a paid plan to continue.",
    });
    return;
  }
  const now = new Date();
  const ends = trialEndDate(now);
  const [member] = await db
    .insert(fanMembersTable)
    .values({
      user_id: tier.user_id,
      tier_id: tier.id,
      fan_label: req.userEmail ?? `fan:${req.userId!}`,
      fan_user_id: req.userId!,
      status: "trialing",
      price_cents: tier.price_cents,
      billing_period: "monthly",
      current_period_start: now,
      current_period_end: ends,
      trial_ends_at: ends,
    })
    .returning();
  // Public-API webhook (lane 20): a trial start is a new member joining
  // (status "trialing", price as recorded). Fire-and-forget.
  emitNewMemberWebhook(tier.user_id, {
    memberId: member!.id,
    tierId: tier.id,
    fanUserId: req.userId!,
    status: "trialing",
    priceCents: tier.price_cents,
    billingPeriod: "monthly",
  });
  res.status(201).json({
    membership: toMemberJson(member!, tier.name),
    trialDays: MEMBERSHIP_TRIAL_DAYS,
    chargedCents: 0,
  });
});

/* GET /api/memberships/mine — the fan's own view: memberships they hold,
   gifts they've sent, and gifts they've received — all honest states. */
router.get("/memberships/mine", publicApiLimiter, requireAuth, async (req, res) => {
  const me = req.userId!;
  const members = await db
    .select()
    .from(fanMembersTable)
    .where(eq(fanMembersTable.fan_user_id, me))
    .orderBy(desc(fanMembersTable.joined_at))
    .limit(200);
  const tierIds = [...new Set(members.map((m) => m.tier_id))];
  const tierNames = new Map<string, string>();
  for (const id of tierIds) {
    const t = await findTierById(id);
    if (t) tierNames.set(id, t.name);
  }
  const giftsSent = await db
    .select()
    .from(fanMembershipGiftsTable)
    .where(eq(fanMembershipGiftsTable.purchaser_user_id, me))
    .orderBy(desc(fanMembershipGiftsTable.created_at))
    .limit(100);
  const giftsReceived = await db
    .select()
    .from(fanMembershipGiftsTable)
    .where(eq(fanMembershipGiftsTable.recipient_user_id, me))
    .orderBy(desc(fanMembershipGiftsTable.created_at))
    .limit(100);
  const giftJson = (g: typeof fanMembershipGiftsTable.$inferSelect) => ({
    id: g.id,
    tierId: g.tier_id,
    creatorUserId: g.creator_user_id,
    purchaserUserId: g.purchaser_user_id,
    recipientUserId: g.recipient_user_id,
    memberId: g.member_id,
    amountCents: g.amount_cents,
    amountDollars: centsToDollars(g.amount_cents),
    billingPeriod: g.billing_period,
    status: g.status,
    createdAt: g.created_at,
  });
  res.json({
    memberships: members.map((m) => toMemberJson(m, tierNames.get(m.tier_id) ?? "Unknown tier")),
    giftsSent: giftsSent.map(giftJson),
    giftsReceived: giftsReceived.map(giftJson),
  });
});

/* POST /api/memberships/mine/:memberId/cancel — the fan ends their OWN
   membership. Fan-scoped twin of the creator's PATCH /members/:id: the
   row must belong to the caller as the fan (fan_user_id), so a creator
   can't cancel a member through this door and a fan can't cancel
   anyone else's seat — both read as 404, never a leak. Memberships are
   one paid period at a time with NO auto-charge, so canceling ends the
   membership now: status canceled + canceled_at, the same end state the
   creator-side status rail writes (and what churn counts). A manual
   tracking row (fan_user_id null) has no fan to cancel it — the creator
   manages those from their members list. */
router.post("/memberships/mine/:memberId/cancel", publicApiLimiter, requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(fanMembersTable)
    .where(
      and(
        eq(fanMembersTable.id, param(req.params.memberId)),
        eq(fanMembersTable.fan_user_id, req.userId!),
      ),
    )
    .limit(1);
  const member = rows[0];
  if (!member) {
    res.status(404).json({ error: "Membership not found." });
    return;
  }
  const effective = effectiveMemberStatus(member);
  if (effective === "canceled" || effective === "expired") {
    res.status(409).json({ error: "This membership has already ended." });
    return;
  }
  const [updated] = await db
    .update(fanMembersTable)
    .set({ status: "canceled", canceled_at: new Date(), updated_at: new Date() })
    .where(eq(fanMembersTable.id, member.id))
    .returning();
  const tier = await findTierById(member.tier_id);
  res.json({ membership: toMemberJson(updated!, tier?.name) });
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
      message: "You're out of Visual Bucs — top up to get AI tier suggestions.",
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
        message: "You're out of Visual Bucs — top up to get AI tier suggestions.",
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
    res.status(502).json({ error: "Couldn't generate tier suggestions — Visual Bucs refunded, try again." });
  }
});

export default router;
