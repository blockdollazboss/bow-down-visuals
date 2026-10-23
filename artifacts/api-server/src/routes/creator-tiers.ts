import { Router, type Request, type Response } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { randomBytes } from "crypto";
import { db, creatorProfilesTable, creatorSubscriptionsTable, digitalSalesTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { resolveCreatorTier } from "../middlewares/require-tier";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { ensureKingsWelcome } from "../lib/kings-welcome";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../lib/stripe-client";
import {
  TIER_PLANS,
  TIER_FEE_BPS,
  bpsToPct,
  breakEvenSalesUsd,
  monthlySavingsUsd,
  formatUsd,
  feeSplitForTier,
  TIER_AI_BOOSTS,
  type CreatorTier,
} from "../lib/platform-fees";

/* ── Creator tiers — Worker 12 ─────────────────────────────────────────────
   Subscription tiers for the creator streaming platform (real USD via
   Stripe, TEST mode only). Mounted by the parent in routes/index.ts:

     import creatorTiersRouter from "./creator-tiers";
     router.use(creatorTiersRouter);

   GET  /creator-tiers/plans      tier catalog (public) — the money story
   GET  /creator-tiers/me         caller's tier + fee rate (auth)
   POST /creator-tiers/checkout   Stripe subscription checkout (auth)
   POST /creator-tiers/portal     Stripe billing portal — manage/cancel (auth)
   GET  /creator-tiers/earnings   gross/fee/net widgets + payout balance (auth)

   Money is NEVER gated: /earnings and every sale receipt show gross → fee →
   net at every tier. Only pro controls (custom domain, premium themes,
   AI boosts, 4–6★ controls) are tier-gated, via requireTier("pro"|"elite"). */

const router = Router();

function getBaseUrl(req?: Request): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["host"];
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost";
}

/** TEST MODE ONLY: the shared guard refuses live keys outright. */
function getTestStripe(): Stripe {
  return createGuardedStripeClient();
}

/** The durable subscription state a tier purchase intent carries. */
export interface CreatorTierSubscriptionState {
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
}

/**
 * Deterministic Stripe idempotency key for a creator-tier checkout.
 * Same member + tier + price + pre-purchase subscription state ⇒ the
 * same key (a retry reuses the session); once the webhook sync has
 * recorded/advanced the subscription, the state differs ⇒ fresh key.
 */
export function buildCreatorTierCheckoutKey(args: {
  userId: string;
  tier: string;
  priceId: string;
  current: CreatorTierSubscriptionState | null;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.userId,
    rail: "creator-tier",
    purchaseIntent: {
      tier: args.tier,
      priceId: args.priceId,
      currentSubscription: args.current,
    },
  });
}

const returnToSchema = z
  .string()
  .max(200)
  .refine((s) => s.startsWith("/") && !s.startsWith("//"), {
    message: "returnTo must be a same-site path",
  })
  .optional();

/* ── GET /creator-tiers/plans ── public ── */
router.get("/creator-tiers/plans", publicApiLimiter, (_req, res) => {
  res.json({
    plans: TIER_PLANS.map((p) => ({
      tier: p.tier,
      name: p.name,
      tagline: p.tagline,
      priceUsdPerMonth: p.priceUsdPerMonth,
      priceConfigured: p.priceIdEnv ? !!process.env[p.priceIdEnv] : true,
      feeBps: p.feeBps,
      feePct: bpsToPct(p.feeBps),
      aiBoostsPerMonth: p.aiBoostsPerMonth,
      features: p.features,
      // The money math: fee-savings break-even vs Free — null since the
      // 2026-10-23 flat-5% ruling (no tier fee savings exist anymore).
      breakEvenSalesUsd: p.tier === "free" ? null : breakEvenSalesUsd(p.tier),
      savingsAt1kUsd: p.tier === "free" ? 0 : monthlySavingsUsd(p.tier, 1000),
    })),
    note: "Prices approved 2026-10-07; the platform fee is a flat 5% on every tier (owner ruling 2026-10-23). Stripe TEST mode only.",
  });
});

/* ── GET /creator-tiers/me ── auth ── */
router.get("/creator-tiers/me", requireAuth, async (req, res) => {
  const { tier, profileId } = await resolveCreatorTier(req.userId, req.userPlan);
  let row: { status: string; currentPeriodEnd: Date | null } | null = null;
  if (profileId) {
    const [r] = await db
      .select({ status: creatorSubscriptionsTable.status, currentPeriodEnd: creatorSubscriptionsTable.currentPeriodEnd })
      .from(creatorSubscriptionsTable)
      .where(eq(creatorSubscriptionsTable.profileId, profileId))
      .limit(1);
    row = r ?? null;
  }
  res.json({
    tier,
    status: row?.status ?? "active",
    feeBps: TIER_FEE_BPS[tier],
    feePct: bpsToPct(TIER_FEE_BPS[tier]),
    aiBoostsPerMonth: TIER_AI_BOOSTS[tier],
    currentPeriodEnd: row?.currentPeriodEnd ?? null,
    profileId,
  });
});

/* ── ensure a creator profile exists (checkout needs a profile_id FK target) ── */
async function ensureProfile(userId: string, email: string | undefined): Promise<string> {
  const [existing] = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  if (existing) return existing.id;

  const local = (email ?? "creator").split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "creator";
  let slug = "";
  for (let i = 0; i < 5; i++) {
    const candidate = `${local.slice(0, 24)}-${randomBytes(3).toString("hex")}`;
    const [taken] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.slug, candidate))
      .limit(1);
    if (!taken) {
      slug = candidate;
      break;
    }
  }
  if (!slug) throw new Error("Could not mint a unique profile slug");
  const [created] = await db
    .insert(creatorProfilesTable)
    .values({
      userId,
      slug,
      displayName: local.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Creator",
    })
    .returning({ id: creatorProfilesTable.id });
  logger.info({ userId, profileId: created.id }, "creator-tiers: auto-created minimal profile for checkout");
  // The Tom move: profile created → Thy Cheat Code first-friend hook
  // (idempotent, never throws).
  await ensureKingsWelcome(userId);
  return created.id;
}

/* ── POST /creator-tiers/checkout ── auth ── */
const checkoutSchema = z.object({
  tier: z.enum(["pro", "elite"]),
  returnTo: returnToSchema,
});

router.post("/creator-tiers/checkout", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Pick a tier: pro or elite.", details: parsed.error.issues });
    return;
  }
  const { tier, returnTo } = parsed.data;

  let stripe: Stripe;
  try {
    stripe = getTestStripe();
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ err }, "creator-tiers checkout: Stripe unavailable");
    res.status(500).json({ error: msg });
    return;
  }

  const plan = TIER_PLANS.find((p) => p.tier === tier)!;
  const priceId = plan.priceIdEnv ? process.env[plan.priceIdEnv] : null;
  if (!priceId) {
    res.status(500).json({
      error: `Stripe price for the ${plan.name} tier isn't configured yet (${plan.priceIdEnv}). The owner adds it in Replit Secrets.`,
    });
    return;
  }

  let profileId: string;
  try {
    profileId = await ensureProfile(req.userId!, req.userEmail);
  } catch (err) {
    logger.error({ err }, "creator-tiers checkout: profile ensure failed");
    res.status(500).json({ error: "Couldn't set up your creator profile. Try again in a minute." });
    return;
  }

  /* Purchase intent for the session idempotency key: the profile's
     durable subscription state (the creator_subscriptions row the
     webhook sync maintains). A double-submit before the webhook lands
     still sees this same state, so Stripe reuses the original session
     instead of minting a second subscribable one; once the sync
     records the subscription, the state has advanced and a later
     purchase gets a fresh key. If the state can't be read, fail
     closed rather than mint a session whose duplicate cannot be
     recognized. */
  let currentSub: CreatorTierSubscriptionState | null;
  try {
    const [row] = await db
      .select({
        tier: creatorSubscriptionsTable.tier,
        status: creatorSubscriptionsTable.status,
        currentPeriodEnd: creatorSubscriptionsTable.currentPeriodEnd,
        stripeSubscriptionId: creatorSubscriptionsTable.stripeSubscriptionId,
      })
      .from(creatorSubscriptionsTable)
      .where(eq(creatorSubscriptionsTable.profileId, profileId))
      .limit(1);
    currentSub = row ?? null;
  } catch (err) {
    logger.error({ err, userId: req.userId }, "creator-tiers checkout: subscription state read failed");
    res.status(500).json({ error: "Couldn't start checkout safely. Try again in a minute." });
    return;
  }
  const idempotencyKey = buildCreatorTierCheckoutKey({
    userId: req.userId!,
    tier,
    priceId,
    current: currentSub,
  });

  const back = returnTo ?? "/dashboard";
  const baseUrl = getBaseUrl(req);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/creator-pricing?upgrade=success&tier=${tier}&returnTo=${encodeURIComponent(back)}`,
      cancel_url: `${baseUrl}/creator-pricing?upgrade=cancelled&returnTo=${encodeURIComponent(back)}`,
      metadata: { kind: "creator_tier", tier, user_id: req.userId!, profile_id: profileId },
      subscription_data: { metadata: { kind: "creator_tier", tier, user_id: req.userId!, profile_id: profileId } },
    }, { idempotencyKey });
    logger.info({ userId: req.userId, tier, sessionId: session.id }, "creator tier checkout session created");
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg }, "creator-tiers checkout: Stripe session failed");
    res.status(502).json({ error: `Stripe couldn't start checkout: ${msg}` });
  }
});

/* ── POST /creator-tiers/portal ── auth: manage / cancel subscription ── */
router.post("/creator-tiers/portal", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const { profileId } = await resolveCreatorTier(req.userId, req.userPlan);
  if (!profileId) {
    res.status(404).json({ error: "No creator profile yet — nothing to manage." });
    return;
  }
  const [row] = await db
    .select({ stripeCustomerId: creatorSubscriptionsTable.stripeCustomerId })
    .from(creatorSubscriptionsTable)
    .where(eq(creatorSubscriptionsTable.profileId, profileId))
    .limit(1);
  if (!row?.stripeCustomerId) {
    res.status(404).json({ error: "No billing record yet. Subscribe first, then manage it here." });
    return;
  }
  let stripe: Stripe;
  try {
    stripe = getTestStripe();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }
  const back = (typeof req.body?.returnTo === "string" && req.body.returnTo.startsWith("/")) ? req.body.returnTo : "/creator-pricing";
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${getBaseUrl(req)}${back}`,
  });
  res.json({ url: session.url });
});

/* ── GET /creator-tiers/earnings ── auth ──
   Honest math, every tier: gross → fee → net on every sale, payout balance,
   tier badge data. Money is NEVER gated — free sees the same numbers. */
router.get("/creator-tiers/earnings", requireAuth, async (req: Request, res: Response) => {
  const { tier, profileId } = await resolveCreatorTier(req.userId, req.userPlan);
  if (!profileId) {
    res.json({
      tier, profileId: null, saleCount: 0,
      grossCents: 0, feeCents: 0, netCents: 0,
      payoutBalanceCents: 0, feeBps: TIER_FEE_BPS[tier], feePct: bpsToPct(TIER_FEE_BPS[tier]),
      sales: [],
      note: "No creator profile yet — create one to start earning.",
    });
    return;
  }

  const totals = await db.execute(sql`
    SELECT COUNT(*)::int AS n,
           COALESCE(SUM(amount_cents),0)::int AS gross,
           COALESCE(SUM(platform_fee_cents),0)::int AS fee,
           COALESCE(SUM(creator_amount_cents),0)::int AS net
    FROM digital_sales WHERE profile_id = ${profileId}
  `);
  const t = (totals.rows[0] ?? {}) as Record<string, number>;

  const recent = await db
    .select({
      id: digitalSalesTable.id,
      itemKind: digitalSalesTable.itemKind,
      amountCents: digitalSalesTable.amountCents,
      feeCents: digitalSalesTable.platformFeeCents,
      netCents: digitalSalesTable.creatorAmountCents,
      createdAt: digitalSalesTable.createdAt,
    })
    .from(digitalSalesTable)
    .where(eq(digitalSalesTable.profileId, profileId))
    .orderBy(desc(digitalSalesTable.createdAt))
    .limit(25);

  res.json({
    tier,
    profileId,
    saleCount: t["n"] ?? 0,
    grossCents: t["gross"] ?? 0,
    feeCents: t["fee"] ?? 0,
    netCents: t["net"] ?? 0,
    // Payout rail (Stripe Connect) is not live yet — the balance is real and
    // accrues; payouts ship next. Honest, not hidden.
    payoutBalanceCents: t["net"] ?? 0,
    payoutRailLive: false,
    feeBps: TIER_FEE_BPS[tier],
    feePct: bpsToPct(TIER_FEE_BPS[tier]),
    feeBpsNextTier: tier === "free" ? TIER_FEE_BPS.pro : tier === "pro" ? TIER_FEE_BPS.elite : null,
    sales: recent.map((s) => ({
      id: s.id,
      itemKind: s.itemKind,
      gross: formatUsd(s.amountCents),
      fee: formatUsd(s.feeCents),
      net: formatUsd(s.netCents),
      grossCents: s.amountCents,
      feeCents: s.feeCents,
      netCents: s.netCents,
      feePct: s.amountCents > 0 ? `${((s.feeCents / s.amountCents) * 100).toFixed(1)}%` : "0%",
      createdAt: s.createdAt,
      // Recomputed at the CURRENT tier rate so creators can see what an
      // upgrade would have meant on this exact sale.
      wouldKeepAtNextTierCents:
        tier === "elite" ? null : feeSplitForTier(s.amountCents, tier === "free" ? "pro" : "elite").net,
    })),
  });
});

export default router;
