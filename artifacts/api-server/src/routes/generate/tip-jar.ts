import { Router } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { db, creatorProfilesTable, tipJarTipsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../../lib/stripe-client";

/* ─── Tip Jar ──────────────────────────────────────────────────────────────
   Creators accept tips/donations from fans at /tips/:handle.

   HONESTY CONTRACT: payment processing is COMING SOON. This v1 tracks tip
   INTENT only — no real charge is ever made and no tip is ever marked
   "completed". The public page says so plainly, and the API enforces it:
   every recorded tip has status "pending_payment" forever.

   Storage: server-owned in-memory maps (same pattern as the caption styler
   and other v1 tools). NOT restart-safe — move to DB-backed storage before
   real payments ship.

   REAL CHECKOUT (0142, DE-14): alongside the intent flow, POST
   /tips/:handle/checkout records a durable tip_jar_tips row and opens a
   Stripe Checkout session (test mode, like every money path here);
   POST /tips/checkout/verify flips the row to "paid" exactly once when
   the session reports paid. The intent endpoints above are unchanged —
   they remain the fallback when payments aren't configured, and the
   earnings view reads them as pending, as before. */

export const TIP_CURRENCY = "USD";
export const TIP_STATUS_PENDING = "pending_payment";
export const TIP_MAX_AMOUNT = 10000;
export const TIP_MIN_AMOUNT = 1;
export const TIP_MAX_SUGGESTED = 6;

const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Handle must be at least 3 characters.")
  .max(30, "Handle must be 30 characters or fewer.")
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Handle may only use letters, numbers, hyphens, and underscores.");

export interface TipPageSettings {
  userId: string;
  handle: string;
  displayName: string;
  message: string;
  suggestedAmounts: number[];
  goalAmount: number | null;
  goalLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface TipIntent {
  id: string;
  pageUserId: string;
  handle: string;
  amount: number;
  currency: string;
  fanName: string;
  message: string;
  status: typeof TIP_STATUS_PENDING;
  createdAt: string;
}

export const tipPageSchema = z.object({
  handle: handleSchema,
  displayName: z.string().trim().min(1, "Give your tip page a display name.").max(60),
  message: z.string().trim().max(500).default(""),
  suggestedAmounts: z
    .array(z.number().positive().max(TIP_MAX_AMOUNT))
    .min(1, "Add at least one suggested amount.")
    .max(TIP_MAX_SUGGESTED, `At most ${TIP_MAX_SUGGESTED} suggested amounts.`)
    .default([5, 10, 25]),
  goalAmount: z.number().positive().max(1_000_000).nullable().default(null),
  goalLabel: z.string().trim().max(80).default(""),
});

export const tipIntentSchema = z.object({
  amount: z
    .number()
    .min(TIP_MIN_AMOUNT, `Minimum tip is $${TIP_MIN_AMOUNT}.`)
    .max(TIP_MAX_AMOUNT, `Maximum tip is $${TIP_MAX_AMOUNT}.`),
  fanName: z.string().trim().max(60).default(""),
  message: z.string().trim().max(280).default(""),
});

/** Normalize suggested amounts: dedupe, sort ascending, round to cents. */
export function normalizeSuggestedAmounts(amounts: number[]): number[] {
  const seen = new Set<number>();
  for (const a of amounts) {
    const rounded = Math.round(a * 100) / 100;
    if (rounded >= TIP_MIN_AMOUNT && rounded <= TIP_MAX_AMOUNT) seen.add(rounded);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Sum tip intents for a dashboard total. */
export function sumTipIntents(intents: TipIntent[]): { total: number; count: number; average: number } {
  const count = intents.length;
  const total = Math.round(intents.reduce((s, t) => s + t.amount, 0) * 100) / 100;
  return { total, count, average: count === 0 ? 0 : Math.round((total / count) * 100) / 100 };
}

/* Server-owned in-memory stores. Keyed by userId (settings) and id (intents). */
const tipPages = new Map<string, TipPageSettings>();
const tipPagesByHandle = new Map<string, string>(); // handle -> userId
const tipIntents = new Map<string, TipIntent>();

/** Pending tip-jar intents for one creator (Stack 8 #5 earnings view).
    Intents are pending_payment by design — no real charge exists — so
    callers must present these as pending, never as received earnings. */
export function tipJarPendingForUser(userId: string): { totalCents: number; count: number } {
  const mine = [...tipIntents.values()].filter((t) => t.pageUserId === userId);
  const { total, count } = sumTipIntents(mine);
  return { totalCents: Math.round(total * 100), count };
}

export function __resetTipJarStores() {
  tipPages.clear();
  tipPagesByHandle.clear();
  tipIntents.clear();
}

// Evict tip intents older than 24h — prevents unbounded memory growth
setInterval(() => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const [id, intent] of tipIntents.entries()) {
    if (intent.createdAt < cutoff) tipIntents.delete(id);
  }
}, 60 * 60 * 1000).unref?.();

const router = Router();

/* GET /api/tips/settings → my tip page settings (or 404 if not set up). Auth. */
router.get("/tips/settings", publicApiLimiter, requireAuth, (req, res) => {
  const settings = tipPages.get(req.userId!);
  if (!settings) {
    res.status(404).json({ error: "Tip page not set up yet." });
    return;
  }
  const intents = [...tipIntents.values()].filter((t) => t.pageUserId === req.userId);
  res.json({ settings, paymentsLive: false, ...sumTipIntents(intents) });
});

/* POST /api/tips/settings → create/update my tip page. Auth. Free. */
router.post("/tips/settings", publicApiLimiter, requireAuth, (req, res) => {
  const parsed = tipPageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid tip page settings.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { handle, displayName, message, suggestedAmounts, goalAmount, goalLabel } = parsed.data;

  const existingOwner = tipPagesByHandle.get(handle);
  if (existingOwner && existingOwner !== req.userId) {
    res.status(409).json({ error: "That handle is already taken — pick another." });
    return;
  }

  const now = new Date().toISOString();
  const prev = tipPages.get(req.userId!);
  if (prev && prev.handle !== handle) tipPagesByHandle.delete(prev.handle);

  const settings: TipPageSettings = {
    userId: req.userId!,
    handle,
    displayName: displayName.trim(),
    message: message.trim(),
    suggestedAmounts: normalizeSuggestedAmounts(suggestedAmounts),
    goalAmount,
    goalLabel: goalLabel.trim(),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  tipPages.set(req.userId!, settings);
  tipPagesByHandle.set(handle, req.userId!);
  logger.info({ userId: req.userId, handle }, "[tip-jar] tip page saved");
  res.json({ settings, paymentsLive: false });
});

/**
 * Resolve a tip page owner from a value that may live in EITHER
 * namespace: the tip handle itself (canonical — /tips/:handle), or a
 * creator-profile slug (the Shorts feed caller, pages/shorts.tsx,
 * which only knows item.creator.slug). Tip handles are freely typed
 * at setup and are NOT the owner's profile slug; without the profile
 * fallback the lookup 404'd whenever they differed and the Tip
 * button in the Shorts feed never rendered. Handle wins on a
 * collision so the canonical namespace is never shadowed.
 * Returns undefined when neither namespace resolves to a tip page.
 */
async function resolveTipPageOwnerId(value: string): Promise<string | undefined> {
  const byHandle = tipPagesByHandle.get(value);
  if (byHandle) return byHandle;
  const profiles = await db
    .select({ userId: creatorProfilesTable.userId })
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.slug, value))
    .limit(1);
  const userId = profiles[0]?.userId;
  if (userId && tipPages.has(userId)) return userId;
  return undefined;
}

/* GET /api/tips/page/:handle → public tip page data. No auth.
   :handle accepts a tip handle OR a creator-profile slug (see
   resolveTipPageOwnerId); the response always carries the page's
   real handle, which slug callers build their /tips/<handle> link
   from. */
router.get("/tips/page/:handle", publicApiLimiter, async (req, res) => {
  const handle = String(req.params.handle ?? "").toLowerCase();
  const ownerId = await resolveTipPageOwnerId(handle);
  if (!ownerId) {
    res.status(404).json({ error: "Tip page not found." });
    return;
  }
  const settings = tipPages.get(ownerId)!;
  const intents = [...tipIntents.values()].filter((t) => t.pageUserId === ownerId);
  const stats = sumTipIntents(intents);
  res.json({
    page: {
      handle: settings.handle,
      displayName: settings.displayName,
      message: settings.message,
      suggestedAmounts: settings.suggestedAmounts,
      goalAmount: settings.goalAmount,
      goalLabel: settings.goalLabel,
    },
    stats: { ...stats, goalProgress: settings.goalAmount ? Math.min(1, stats.total / settings.goalAmount) : null },
    /* Real checkout is live when payments are configured (0142);
       otherwise the page falls back to recording tip intent. */
    paymentsLive: paymentsConfigured(),
    notice: paymentsConfigured()
      ? "Tips are charged securely at checkout."
      : "Payment processing is coming soon — no charge is made today.",
  });
});

/* POST /api/tips/:handle/tip → record a tip INTENT. No auth. NEVER charges.
   :handle resolves through the same two namespaces as the GET above:
   a fan who landed on /tips/<profile-slug> (the artist profile page
   links there directly) can actually send, not just view. The intent
   is always recorded under the page's REAL handle. */
router.post("/tips/:handle/tip", publicApiLimiter, async (req, res) => {
  const handle = String(req.params.handle ?? "").toLowerCase();
  const ownerId = await resolveTipPageOwnerId(handle);
  if (!ownerId) {
    res.status(404).json({ error: "Tip page not found." });
    return;
  }
  const pageHandle = tipPages.get(ownerId)!.handle;
  const parsed = tipIntentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid tip.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { amount, fanName, message } = parsed.data;
  const intent: TipIntent = {
    id: randomUUID(),
    pageUserId: ownerId,
    handle: pageHandle,
    amount: Math.round(amount * 100) / 100,
    currency: TIP_CURRENCY,
    fanName: fanName.trim(),
    message: message.trim(),
    status: TIP_STATUS_PENDING,
    createdAt: new Date().toISOString(),
  };
  tipIntents.set(intent.id, intent);
  logger.info({ handle: pageHandle, amount: intent.amount }, "[tip-jar] tip intent recorded (no charge)");
  res.status(201).json({
    intent,
    paymentsLive: false,
    notice: "Tip recorded. Payment processing is coming soon — no charge was made today.",
  });
});

/* ── Real checkout (0142) — same session shape as the storefront's ── */
function getStripe(): Stripe {
  return createGuardedStripeClient();
}

/**
 * Deterministic Stripe idempotency key for a tip checkout. The intent
 * is the durable tip row inserted just before the session is created:
 * a retry of the same tip's session creation reuses the original
 * session, and every genuinely new tip is a new row with a fresh key.
 */
export function buildTipCheckoutKey(args: { pageOwnerId: string; tipId: string }): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.pageOwnerId,
    rail: "tip-jar",
    purchaseIntent: { tipId: args.tipId },
  });
}

function getBaseUrl(req: import("express").Request): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["host"];
  if (host) return `${proto}://${host}`;
  return "http://localhost";
}

const paymentsConfigured = () => !!process.env["STRIPE_SECRET_KEY"];

/* POST /api/tips/:handle/checkout { amount, fanName, message } — record
   a durable tip row and open its Checkout session. Public. */
router.post("/tips/:handle/checkout", publicApiLimiter, async (req, res) => {
  const handle = String(req.params.handle ?? "").toLowerCase();
  const ownerId = await resolveTipPageOwnerId(handle);
  if (!ownerId) {
    res.status(404).json({ error: "Tip page not found." });
    return;
  }
  const page = tipPages.get(ownerId)!;
  const parsed = tipIntentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid tip.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(503).json({ error: "Payments are not configured yet." });
    return;
  }
  const { amount, fanName, message } = parsed.data;
  const amountCents = Math.round(amount * 100);
  const [tip] = await db
    .insert(tipJarTipsTable)
    .values({
      page_user_id: ownerId,
      handle: page.handle,
      fan_name: fanName.trim(),
      message: message.trim(),
      amount_cents: amountCents,
      currency: "usd",
      status: "pending_payment",
    })
    .returning();
  try {
    const base = getBaseUrl(req);
    const idempotencyKey = buildTipCheckoutKey({ pageOwnerId: ownerId, tipId: tip!.id });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: `Tip for ${page.displayName}` },
          },
          quantity: 1,
        },
      ],
      metadata: { type: "tip_jar", tipId: tip!.id },
      success_url: `${base}/tips/${page.handle}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/tips/${page.handle}`,
    }, { idempotencyKey });
    await db
      .update(tipJarTipsTable)
      .set({ stripe_session_id: session.id })
      .where(eq(tipJarTipsTable.id, tip!.id));
    res.json({ checkoutUrl: session.url, tipId: tip!.id });
  } catch (err) {
    /* No session → no charge is possible; drop the orphan row. */
    await db.delete(tipJarTipsTable).where(eq(tipJarTipsTable.id, tip!.id)).catch(() => {});
    logger.error({ err, handle: page.handle }, "[tip-jar] checkout session failed");
    res.status(502).json({ error: "Could not start checkout. Try again." });
  }
});

/* POST /api/tips/checkout/verify { sessionId } — the fan is back from
   Checkout: flip the tip to "paid" exactly once (guarded UPDATE). */
router.post("/tips/checkout/verify", publicApiLimiter, async (req, res) => {
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  if (!sessionId) {
    res.status(400).json({ error: "sessionId is required." });
    return;
  }
  const [tip] = await db
    .select()
    .from(tipJarTipsTable)
    .where(eq(tipJarTipsTable.stripe_session_id, sessionId));
  if (!tip) {
    res.status(404).json({ error: "Tip not found for that session." });
    return;
  }
  if (tip.status === "paid") {
    res.json({ status: "paid", amountCents: tip.amount_cents, handle: tip.handle });
    return;
  }
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(503).json({ error: "Payments are not configured yet." });
    return;
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid" || session.metadata?.["type"] !== "tip_jar") {
    res.json({ status: tip.status, paid: false });
    return;
  }
  await db
    .update(tipJarTipsTable)
    .set({ status: "paid", paid_at: new Date() })
    .where(
      and(
        eq(tipJarTipsTable.id, tip.id),
        eq(tipJarTipsTable.status, "pending_payment"),
      ),
    );
  res.json({ status: "paid", amountCents: tip.amount_cents, handle: tip.handle });
});

/* GET /api/tips/dashboard → my totals + tip feed. Auth. */
router.get("/tips/dashboard", publicApiLimiter, requireAuth, (req, res) => {
  const settings = tipPages.get(req.userId!);
  const intents = [...tipIntents.values()]
    .filter((t) => t.pageUserId === req.userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const stats = sumTipIntents(intents);
  res.json({
    hasPage: !!settings,
    handle: settings?.handle ?? null,
    ...stats,
    goalAmount: settings?.goalAmount ?? null,
    goalLabel: settings?.goalLabel ?? "",
    goalProgress: settings?.goalAmount ? Math.min(1, stats.total / settings.goalAmount) : null,
    feed: intents.slice(0, 50),
    paymentsLive: false,
  });
});

export default router;
