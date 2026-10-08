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
import {
  TIER_PLANS,
  TIER_FEE_BPS,
  bpsToPct,
  breakEvenSalesUsd,
  monthlySavingsUsd,
  formatUsd,
  feeSplitForTier,
  maxStarsForTier,
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

/** TEST MODE ONLY: refuse live keys outright — real cards stay out until launch. */
function getTestStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  if (!key.startsWith("sk_test_")) {
    throw new Error(
      "Creator tier checkout runs in Stripe TEST mode only (sk_test_*). Refusing to touch live mode.",
    );
  }
  return new Stripe(key);
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
      maxStars: p.maxStars,
      aiBoostsPerMonth: p.aiBoostsPerMonth,
      features: p.features,
      // The money math: at what monthly sales does the fee drop pay for the sub?
      breakEvenSalesUsd: p.tier === "free" ? null : breakEvenSalesUsd(p.tier),
      savingsAt1kUsd: p.tier === "free" ? 0 : monthlySavingsUsd(p.tier, 1000),
    })),
    note: "Prices and fee rates are proposed and pending owner approval. Stripe TEST mode only.",
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
    maxStars: maxStarsForTier(tier),
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
    });
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
