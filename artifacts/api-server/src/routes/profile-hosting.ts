import { Router, type Request, type Response } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { db, creatorHostingTable, creatorProfilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { HOSTING_PLAN, hostingPriceUsdPerMonth, hostingPriceConfigured } from "../lib/platform-fees";
import { resolveHostingEntitlement, resolvePaidPlan } from "../lib/profile-website";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../lib/stripe-client";

/* ── Hosting plan (Stack 3, item 8) ──────────────────────────────────────
   ONE plan packaged on the creator-tiers chassis: custom domain + clean
   branding (the paid state of the branding rule) + the profile page as
   the creator's website, hosted by us. Stripe subscription, TEST mode
   only — same rails, same refusal of live keys as creator-tiers.ts.

     GET  /creator-hosting/plan      public catalog (honest availability)
     GET  /creator-hosting/me        caller's entitlement (auth)
     POST /creator-hosting/checkout  Stripe TEST subscription (auth)

   PRICE LAW: the price is a named server config value
   (HOSTING_PRICE_USD_PER_MONTH + STRIPE_PRICE_HOSTING). Until the owner
   sets them the plan shows as not yet available and checkout refuses —
   no invented price is ever displayed or charged. Entitlement lands in
   creator_hosting via the Stripe webhook (kind "creator_hosting").   */

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

/** The durable hosting state a hosting purchase intent carries. */
export interface HostingSubscriptionState {
  status: string;
  currentPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
}

/**
 * Deterministic Stripe idempotency key for a hosting checkout. Same
 * member + price + pre-purchase hosting state ⇒ the same key (a retry
 * reuses the session); once the webhook sync has recorded/advanced
 * the creator_hosting row, the state differs ⇒ fresh key.
 */
export function buildHostingCheckoutKey(args: {
  userId: string;
  priceId: string;
  current: HostingSubscriptionState | null;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.userId,
    rail: "creator-hosting",
    purchaseIntent: {
      priceId: args.priceId,
      currentHosting: args.current,
    },
  });
}

export interface HostingPlanDto {
  name: string;
  tagline: string;
  features: Array<{ label: string; detailsUrl: string }>;
  priceUsdPerMonth: number | null;
  priceConfigured: boolean;
  available: boolean;
}

export function hostingPlanDto(): HostingPlanDto {
  const configured = hostingPriceConfigured();
  return {
    name: HOSTING_PLAN.name,
    tagline: HOSTING_PLAN.tagline,
    features: HOSTING_PLAN.features,
    priceUsdPerMonth: hostingPriceUsdPerMonth(),
    priceConfigured: configured,
    available: configured,
  };
}

/* ── GET /creator-hosting/plan — public ── */
router.get("/creator-hosting/plan", publicApiLimiter, (_req, res) => {
  const plan = hostingPlanDto();
  res.json({
    plan,
    note: plan.available
      ? "Test mode only — no real charge."
      : "The Hosting plan's price hasn't been set yet — it isn't available for purchase until it is.",
  });
});

/* ── GET /creator-hosting/me — auth ── */
router.get("/creator-hosting/me", requireAuth, async (req, res) => {
  try {
    const [profile] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, req.userId!))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "Create your creator profile first — Hosting runs your page." });
      return;
    }
    const hosting = await resolveHostingEntitlement(profile.id);
    const paidPlan = await resolvePaidPlan(profile.id, req.userId!);
    res.json({
      hostingEntitled: hosting.entitled,
      hostingStatus: hosting.status,
      currentPeriodEnd: hosting.currentPeriodEnd,
      /* Clean branding is the paid state from ANY paid source — a Pro or
         Elite creator already has it without buying Hosting. */
      cleanBranding: paidPlan,
      plan: hostingPlanDto(),
    });
  } catch (err) {
    req.log.error({ err }, "creator-hosting GET (me) error");
    res.status(500).json({ error: "Couldn't load your hosting state. Try again." });
  }
});

/* ── POST /creator-hosting/checkout — auth, TEST mode ── */
const checkoutSchema = z.object({
  returnTo: z
    .string()
    .max(200)
    .refine((s) => s.startsWith("/") && !s.startsWith("//"), {
      message: "returnTo must be a same-site path",
    })
    .optional(),
});

router.post("/creator-hosting/checkout", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid checkout request.", details: parsed.error.issues });
    return;
  }

  if (!hostingPriceConfigured()) {
    res.status(503).json({
      error: "HOSTING_NOT_PRICED",
      message: "The Hosting plan isn't available for purchase yet — its price hasn't been set. Nothing was charged.",
    });
    return;
  }

  const [profile] = await db
    .select({ id: creatorProfilesTable.id })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, req.userId!))
    .limit(1);
  if (!profile) {
    res.status(404).json({ error: "NO_PROFILE", message: "Create your creator profile first — Hosting runs your page." });
    return;
  }

  const existing = await resolveHostingEntitlement(profile.id);
  if (existing.entitled) {
    res.status(409).json({
      error: "ALREADY_HOSTED",
      message: "Your page is already on the Hosting plan — no need to buy it twice.",
    });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getTestStripe();
  } catch (err) {
    logger.error({ err }, "creator-hosting checkout: Stripe unavailable");
    /* The raw message is an internal config error (it names the provider
       and key modes) — the client gets house copy instead. */
    res.status(500).json({ error: "Checkout isn't available right now." });
    return;
  }

  const priceId = process.env[HOSTING_PLAN.priceIdEnv]!;

  /* Purchase intent for the session idempotency key: the profile's
     durable hosting state (the creator_hosting row the webhook sync
     maintains), read directly so a read failure fails closed instead
     of minting a session whose duplicate cannot be recognized. A
     double-submit before the sync lands still sees this same state,
     so Stripe reuses the original session; once the row records the
     subscription, the state has advanced and a later purchase gets a
     fresh key. */
  let currentHosting: HostingSubscriptionState | null;
  try {
    const [row] = await db
      .select({
        status: creatorHostingTable.status,
        currentPeriodEnd: creatorHostingTable.currentPeriodEnd,
        stripeSubscriptionId: creatorHostingTable.stripeSubscriptionId,
      })
      .from(creatorHostingTable)
      .where(eq(creatorHostingTable.profileId, profile.id))
      .limit(1);
    currentHosting = row ?? null;
  } catch (err) {
    logger.error({ err, userId: req.userId }, "creator-hosting checkout: hosting state read failed");
    res.status(500).json({ error: "Checkout couldn't start — try again in a moment." });
    return;
  }
  const idempotencyKey = buildHostingCheckoutKey({
    userId: req.userId!,
    priceId,
    current: currentHosting,
  });

  const back = parsed.data.returnTo ?? "/creator-pricing";
  const baseUrl = getBaseUrl(req);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/creator-pricing?hosting=success&returnTo=${encodeURIComponent(back)}`,
      cancel_url: `${baseUrl}/creator-pricing?hosting=cancelled&returnTo=${encodeURIComponent(back)}`,
      metadata: { kind: "creator_hosting", user_id: req.userId!, profile_id: profile.id },
      subscription_data: { metadata: { kind: "creator_hosting", user_id: req.userId!, profile_id: profile.id } },
    }, { idempotencyKey });
    logger.info({ userId: req.userId, sessionId: session.id }, "hosting checkout session created");
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg }, "creator-hosting checkout: Stripe session failed");
    /* House copy law: the client never sees the payment provider's name
       (or its raw error text — that stays in the log line above). */
    res.status(502).json({ error: "Checkout couldn't start — try again in a moment." });
  }
});

export default router;
