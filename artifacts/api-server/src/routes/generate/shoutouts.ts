import { Router } from "express";
import { z } from "zod";
import Stripe from "stripe";
import OpenAI from "openai";
import { eq, and, desc } from "drizzle-orm";
import { db, shoutoutSettingsTable, shoutoutRequestsTable } from "@workspace/db";
import type { ShoutoutRequestStatus } from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
/* Delivery videos reuse the self-healing generated-clips bucket. Write-time:
   normalizeToStorageRef persists the stable ref; read-time:
   refreshSupabaseStorageUrl mints a fresh 1-day signed URL. */
import { normalizeToStorageRef, refreshSupabaseStorageUrl } from "../../lib/objectStorage";
import { mirrorExternalMediaUrl } from "../../lib/mirrorMedia";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient, fingerprintStripeRequestParams } from "../../lib/stripe-client";
import { refundCheckoutSessionPayment, retrieveCheckoutSession } from "../../lib/stripe-checkout";
import { isEmbeddedCheckoutEnabled } from "../../lib/embedded-checkout";
import { notifyUserEvent, type UserEventInput } from "../../lib/push-events";
import { sendEmail, emailShell, emailButton, escapeHtml } from "../../lib/email";

/* ── Shoutout fan-out (fan-out truth, stack1100 Y3) ────────────────────
   Nobody was told anything: the creator never learned a request was
   paid (or that a free request landed), and the fan — a guest with no
   account, reachable ONLY by email — never learned their shoutout was
   delivered or declined. Creator tells ride the one event door
   (money category); fan tells are email, the only channel a guest
   has. Both fire on the landed transition only.
   DECLINE REFUND (owner ruling, stack1400 #15): declining a PAID
   request refunds the fan in full, automatically, as part of the
   decline — the request lands in 'refunded' and only then does the
   decline email go out, its copy stating the full refund. An UNPAID
   request declines exactly as before and its copy promises nothing
   about money. If the refund fails, the decline does not land: the
   request keeps its pre-decline state so the creator can retry,
   and no email claims a refund that didn't happen. */
type ShoutoutEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _shoutoutEventNotifier: ShoutoutEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setShoutoutEventNotifier(fn: ShoutoutEventNotifier | null): void {
  _shoutoutEventNotifier = fn ?? notifyUserEvent;
}

async function tellShoutoutCreator(input: { userId: string; kind: string; title: string; body: string }): Promise<void> {
  try {
    await _shoutoutEventNotifier({
      userId: input.userId,
      category: "money",
      kind: input.kind,
      title: input.title,
      body: input.body,
      link: "/shoutouts",
    });
  } catch (err) {
    logger.warn({ err, userId: input.userId, kind: input.kind }, "[shoutouts] creator tell failed (request stands)");
  }
}

export interface ShoutoutFanEmail {
  to: string;
  subject: string;
  html: string;
}

type ShoutoutFanMailer = (email: ShoutoutFanEmail) => Promise<unknown>;
let _shoutoutFanMailer: ShoutoutFanMailer = async (email) => {
  await sendEmail(email);
};
/** Test seam — never used outside tests. */
export function __setShoutoutFanMailer(fn: ShoutoutFanMailer | null): void {
  _shoutoutFanMailer = fn ?? (async (email) => {
    await sendEmail(email);
  });
}

async function mailShoutoutFan(email: ShoutoutFanEmail): Promise<void> {
  try {
    await _shoutoutFanMailer(email);
  } catch (err) {
    logger.warn({ err, subject: email.subject }, "[shoutouts] fan email failed (request stands)");
  }
}

function buildShoutoutDeliveredEmail(input: {
  fanName: string;
  fanEmail: string;
  creatorName: string;
  occasion: string;
  deliveryUrl: string;
}): ShoutoutFanEmail {
  const html = emailShell(
    "Your shoutout is ready",
    `<p style="margin:0 0 12px;">Hi ${escapeHtml(input.fanName)} — your shoutout from <strong>${escapeHtml(input.creatorName)}</strong> (${escapeHtml(input.occasion)}) is recorded and ready to watch.</p>
${emailButton(input.deliveryUrl, "Watch your shoutout")}
<p style="margin:0 0 16px;font-size:14px;">Save that link — it's your copy of the video.</p>`,
  );
  return { to: input.fanEmail, subject: "Your shoutout video is ready", html };
}

export function buildShoutoutDeclinedEmail(input: {
  fanName: string;
  fanEmail: string;
  creatorName: string;
  occasion: string;
  /* Set ONLY when a full refund actually landed as part of this
     decline (paid decline, stack1400 #15) — the copy then states the
     refund plainly. Absent = the request was never paid, and the
     copy says nothing about money. */
  refundCents?: number;
}): ShoutoutFanEmail {
  const refundLine =
    input.refundCents != null && input.refundCents > 0
      ? `<p style="margin:0 0 12px;">Since you'd already paid, we've refunded your payment in full — <strong>${usd(input.refundCents)}</strong> is on its way back to your original payment method.</p>\n`
      : "";
  const html = emailShell(
    "About your shoutout request",
    `<p style="margin:0 0 12px;">Hi ${escapeHtml(input.fanName)} — ${escapeHtml(input.creatorName)} couldn't take your shoutout request (${escapeHtml(input.occasion)}) this time, so it was declined.</p>
${refundLine}<p style="margin:0 0 16px;font-size:14px;">Thanks for thinking of them. Plenty of other creators on Bow Down Visuals would love to record one for you.</p>`,
  );
  return { to: input.fanEmail, subject: "About your shoutout request", html };
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const router = Router();

/* ─── Fan Shoutouts ──────────────────────────────────────────────────────
   /shoutouts — creators sell personalized video shoutouts to fans.
   Setup + request tracking are real. Payment (0142, DE-14): a priced
   request gets a real Stripe Checkout session (test mode, like every
   money path on the site) via POST /shoutouts/requests/:id/checkout;
   the verify endpoint flips it pending_payment → accepted exactly
   once when the session reports paid. Free requests (price 0) keep
   the manual accept flow. The platform fee is the flat 5% law (owner
   ruling 2026-10-27, by delegation: the shoutouts route's own 10%
   constant aligns to flat 5% everywhere, retiring the 10%). Only the
   AI message helper costs credits (1 credit, charge-before-generate,
   refund on provider failure). */

/* 1 credit per AI message draft — env-overridable without a deploy. */
export const SHOUTOUT_AI_CREDITS = Number(process.env["SHOUTOUT_AI_CREDIT_COST"]) || 100;

/* Platform fee — flat 5%, the site-wide law (owner ruling 2026-10-27).
   Env-overridable without a deploy; the default is the ruled 5. */
export const SHOUTOUT_PLATFORM_FEE_PCT = Number(process.env["SHOUTOUT_PLATFORM_FEE_PCT"]) || 5;

export const REQUEST_STATUSES = [
  "pending_payment",
  "accepted",
  "in_progress",
  "delivered",
  "declined",
] as const;

/* Allowed status transitions. Terminal states (delivered/declined) can't move.
   'refunded' is terminal and never a user target: the clawback engine
   (0183, D1) writes it when the paying charge is reversed, and the
   decline rail lands a PAID request there after its automatic full
   refund (stack1400 #15) — it appears in no target list either way. */
const TRANSITIONS: Record<ShoutoutRequestStatus, ShoutoutRequestStatus[]> = {
  pending_payment: ["accepted", "declined"],
  accepted: ["in_progress", "declined"],
  in_progress: ["delivered", "declined"],
  delivered: [],
  declined: [],
  refunded: [],
};

export function canTransition(from: ShoutoutRequestStatus, to: ShoutoutRequestStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const settingsSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required.").max(60),
  /* Price per shoutout in dollars for the UI; stored as integer cents. */
  priceDollars: z.number().min(0).max(999.99),
  turnaroundDays: z.number().int().min(1).max(90),
  guidelines: z.string().trim().max(1000).optional().default(""),
  accepting: z.boolean(),
});

const requestSchema = z.object({
  /* Public creator identifier = shoutout_settings.id (never a user UUID). */
  creatorId: z.string().uuid("creatorId must be a UUID."),
  fanName: z.string().trim().min(1, "Your name is required.").max(80),
  fanEmail: z.string().trim().email("Enter a valid email.").max(160).optional().or(z.literal("")),
  occasion: z.string().trim().min(1, "Occasion is required.").max(120),
  message: z.string().trim().min(1, "Message is required.").max(1000),
});

const statusSchema = z.object({
  status: z.enum(REQUEST_STATUSES),
  deliveryUrl: z.string().trim().url("Delivery URL must be a valid URL.").max(2048).optional().or(z.literal("")),
});

const aiMessageSchema = z.object({
  occasion: z.string().trim().min(1, "Occasion is required.").max(120),
  notes: z.string().trim().max(600).optional().default(""),
  creatorName: z.string().trim().max(60).optional().default(""),
});

export function dollarsToCents(d: number): number {
  return Math.round(d * 100);
}

export function centsToDollars(c: number): number {
  return c / 100;
}

/* Net payout after the platform fee, in cents — the dashboard's honest
   "what you'd keep" figure, and the per-row formula the pending-payout
   ledger sync applies to settled shoutouts (lib/seller-earnings.ts). */
export function netAfterFee(cents: number): number {
  return Math.round((cents * (100 - SHOUTOUT_PLATFORM_FEE_PCT)) / 100);
}

/* Express 5 types req.params values as string | string[]. This unwraps to a
   single string for route params (we never use wildcard splats). */
function param(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function toSettingsJson(s: typeof shoutoutSettingsTable.$inferSelect) {
  return {
    id: s.id,
    displayName: s.display_name,
    priceDollars: centsToDollars(s.price_cents),
    priceCents: s.price_cents,
    turnaroundDays: s.turnaround_days,
    guidelines: s.guidelines ?? "",
    accepting: s.accepting === "true",
  };
}

async function toRequestJson(r: typeof shoutoutRequestsTable.$inferSelect) {
  return {
    id: r.id,
    fanName: r.fan_name,
    fanEmail: r.fan_email ?? "",
    occasion: r.occasion,
    message: r.message,
    status: r.status,
    priceDollars: centsToDollars(r.price_cents),
    priceCents: r.price_cents,
    /* Re-sign storage refs so the creator's dashboard always plays. */
    deliveryUrl: r.delivery_url ? await refreshSupabaseStorageUrl(r.delivery_url) : "",
    paidAt: r.paid_at ?? null,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
  };
}

/* ── Checkout helpers (0142) — same shape as the storefront's ── */
function getStripe(): Stripe {
  return createGuardedStripeClient();
}

/* paymentsLive derives from the configured rail — the same truth the
   checkout endpoint enforces (getStripe() throws → 503 when no key is
   set), mirroring the tip jar's paymentsConfigured(). A hardcoded
   false was honest in v1, before payment processing shipped (0142);
   left in place it tells fans and desks that paid shoutouts don't
   exist while priced requests settle through checkout. The flag must
   never dress a dead rail up as live either — hence the derivation,
   not a literal true. */
const paymentsConfigured = () => !!process.env["STRIPE_SECRET_KEY"];

/**
 * Deterministic Stripe idempotency key for a shoutout checkout. The
 * intent is the durable request row awaiting payment: repeat checkout
 * calls for the same pending request (double-click, lost response)
 * reuse the original session instead of minting a second payable
 * one, and once the request leaves pending_payment the checkout
 * endpoint refuses — a new request is a new row with a fresh key.
 */
export function buildShoutoutCheckoutKey(args: {
  creatorUserId: string;
  requestId: string;
  priceCents: number;
  /** The exact session parameters this key guards (presentation mode
   *  included), folded in as a fingerprint: the key identifies the
   *  request, not just the shoutout row — a parameter change under a
   *  reused key is what Stripe refuses. */
  requestParams?: unknown;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.creatorUserId,
    rail: "shoutout-request",
    purchaseIntent: { requestId: args.requestId, priceCents: args.priceCents },
    requestFingerprint:
      args.requestParams === undefined ? undefined : fingerprintStripeRequestParams(args.requestParams),
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

/* GET /api/shoutouts/creators — public list of creators accepting requests (free).
   Exposes the settings id as the public creator identifier, never user UUIDs. */
router.get("/shoutouts/creators", publicApiLimiter, async (_req, res) => {
  const rows = await db
    .select()
    .from(shoutoutSettingsTable)
    .where(eq(shoutoutSettingsTable.accepting, "true"))
    .orderBy(desc(shoutoutSettingsTable.updated_at))
    .limit(100);
  res.json({
    creators: rows.map((s) => ({
      id: s.id,
      displayName: s.display_name,
      priceDollars: centsToDollars(s.price_cents),
      turnaroundDays: s.turnaround_days,
      guidelines: (s.guidelines ?? "").slice(0, 300),
    })),
    paymentsLive: paymentsConfigured(),
  });
});

/* GET /api/shoutouts/settings — the creator's own settings (free). */
router.get("/shoutouts/settings", requireAuth, publicApiLimiter, async (req, res) => {
  const rows = await db
    .select()
    .from(shoutoutSettingsTable)
    .where(eq(shoutoutSettingsTable.user_id, req.userId!));
  res.json({ settings: rows[0] ? toSettingsJson(rows[0]) : null });
});

/* PUT /api/shoutouts/settings — create or update settings (free, owner only). */
router.put("/shoutouts/settings", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid settings.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { displayName, priceDollars, turnaroundDays, guidelines, accepting } = parsed.data;
  const values = {
    display_name: displayName,
    price_cents: dollarsToCents(priceDollars),
    turnaround_days: turnaroundDays,
    guidelines,
    accepting: accepting ? "true" : "false",
    updated_at: new Date(),
  };
  const existing = await db
    .select({ id: shoutoutSettingsTable.id })
    .from(shoutoutSettingsTable)
    .where(eq(shoutoutSettingsTable.user_id, req.userId!));
  let row: typeof shoutoutSettingsTable.$inferSelect | undefined;
  if (existing.length > 0) {
    [row] = await db
      .update(shoutoutSettingsTable)
      .set(values)
      .where(eq(shoutoutSettingsTable.user_id, req.userId!))
      .returning();
  } else {
    [row] = await db
      .insert(shoutoutSettingsTable)
      .values({ user_id: req.userId!, ...values })
      .returning();
  }
  res.json({ settings: toSettingsJson(row!) });
});

/* POST /api/shoutouts/requests — a fan submits a shoutout request (free, public).
   The request lands as "pending_payment"; a priced request is paid via
   the checkout endpoint below, a free one via the manual accept flow. */
router.post("/shoutouts/requests", publicApiLimiter, async (req, res) => {
  const parsed = requestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { creatorId, fanName, fanEmail, occasion, message } = parsed.data;
  const creator = await db
    .select()
    .from(shoutoutSettingsTable)
    .where(and(eq(shoutoutSettingsTable.id, creatorId), eq(shoutoutSettingsTable.accepting, "true")));
  if (creator.length === 0) {
    res.status(404).json({ error: "That creator isn't accepting shoutout requests right now." });
    return;
  }
  const [request] = await db
    .insert(shoutoutRequestsTable)
    .values({
      creator_user_id: creator[0]!.user_id,
      fan_name: fanName,
      fan_email: fanEmail || null,
      occasion,
      message,
      status: "pending_payment",
      price_cents: creator[0]!.price_cents,
    })
    .returning();
  /* A FREE request is actionable the moment it lands — the creator
     hears about it now. A priced request tells at the paid flip
     (checkout verify below), when it's actually a sale. */
  if ((request?.price_cents ?? 0) === 0) {
    await tellShoutoutCreator({
      userId: request!.creator_user_id,
      kind: "shoutout_request",
      title: "New shoutout request",
      body: `${fanName} requested a free shoutout (${occasion}). Accept it from your shoutout requests.`,
    });
  }
  res.status(201).json({
    request: await toRequestJson(request!),
    /* Priced requests can be paid immediately via the checkout
       endpoint; free requests skip payment entirely. */
    paymentsLive: (request?.price_cents ?? 0) > 0,
  });
});

/* Embedded checkout (owner law 2026-10-26: never leave the site):
   "embedded" creates the SAME session in embedded_page ui_mode and
   answers its clientSecret so the fan pays on the page; absent/
   "hosted" keeps the hosted-URL shape. Honored only while the
   EMBEDDED_CHECKOUT kill switch is on. */
const shoutoutCheckoutSchema = z.object({
  uiMode: z.enum(["embedded", "hosted"]).optional(),
});

/* POST /api/shoutouts/requests/:id/checkout — start payment for a
   priced request (public: the request id is the capability, exactly
   like the storefront's session flow). Creates a Checkout session,
   stores its id on the request, and returns the hosted URL — or,
   when the fan's page asks for the embedded presentation, the
   session's clientSecret instead. */
router.post("/shoutouts/requests/:id/checkout", publicApiLimiter, async (req, res) => {
  const parsed = shoutoutCheckoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid checkout." });
    return;
  }
  const [request] = await db
    .select()
    .from(shoutoutRequestsTable)
    .where(eq(shoutoutRequestsTable.id, param(req.params.id)));
  if (!request) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  if (request.status !== "pending_payment") {
    res.status(409).json({ error: "This request isn't waiting for payment." });
    return;
  }
  if (request.price_cents <= 0) {
    res.status(400).json({ error: "This shoutout is free — no checkout needed." });
    return;
  }
  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(503).json({ error: "Payments are not configured yet." });
    return;
  }
  const base = getBaseUrl(req);
  const embeddedRequested =
    parsed.data.uiMode === "embedded" && isEmbeddedCheckoutEnabled();
  const successUrl = `${base}/shoutouts?request=${request.id}&session_id={CHECKOUT_SESSION_ID}`;
  /* The amount and metadata are identical either way; the
     presentation makes it a different Stripe request, so the
     idempotency key fingerprints the exact parameters below. An
     embedded session takes a return_url (the same verify-on-return
     landing) instead of success/cancel URLs. */
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: request.price_cents,
          product_data: { name: "Personalized shoutout video" },
        },
        quantity: 1,
      },
    ],
    metadata: { type: "shoutout_request", requestId: request.id },
    ...(embeddedRequested
      ? { ui_mode: "embedded_page" as const, return_url: successUrl }
      : { success_url: successUrl, cancel_url: `${base}/shoutouts` }),
  };
  const idempotencyKey = buildShoutoutCheckoutKey({
    creatorUserId: request.creator_user_id,
    requestId: request.id,
    priceCents: request.price_cents,
    requestParams: sessionParams,
  });
  const session = await stripe.checkout.sessions.create(sessionParams, { idempotencyKey });
  if (embeddedRequested && !session.client_secret) {
    /* An embedded session without a client secret cannot be mounted
       anywhere — fail like a failed creation (mirrors the house
       helper) instead of stranding the fan. */
    res.status(500).json({ error: "Could not start checkout. Try again in a moment." });
    return;
  }
  await db
    .update(shoutoutRequestsTable)
    .set({ stripe_session_id: session.id, updated_at: new Date() })
    .where(eq(shoutoutRequestsTable.id, request.id));
  if (embeddedRequested) {
    res.json({
      checkoutUrl: null,
      clientSecret: session.client_secret,
      uiMode: "embedded",
      sessionId: session.id,
    });
    return;
  }
  res.json({ checkoutUrl: session.url });
});

/* ─── Shoutout settle (WEBHOOK-SETTLE, stack1200) ─────────────────────
   ONE guarded flip takes a request pending_payment → accepted, and
   only the caller that lands the flip fires the creator's paid tell.
   Both completion paths — the fan's return-verify and the Stripe
   webhook (settleShoutoutBySessionId) — run through it, so a paid
   shoutout counts once, tells once, and still lands when the fan
   closes the tab after paying. Before the webhook door existed, a
   paid session settled ONLY if the fan's browser returned for
   verify: the webhook had no branch for type "shoutout_request", so
   the session fell through to the credit-grant tail's "missing
   user_id" warning and the request sat in pending_payment forever —
   the fan paid, the creator never heard, nothing was owed a record.
   Callers invoke the flip only for sessions already known paid
   (verify asks Stripe; the webhook trusts the signature-verified
   event) — the flip itself never re-checks. */

type ShoutoutRequestRow = typeof shoutoutRequestsTable.$inferSelect;

/** Flip one shoutout request to "accepted" exactly once (guarded
    UPDATE … RETURNING). Only the caller whose UPDATE lands a row —
    the transition's winner — tells the creator. Returns the updated
    row, or null when another path settled the request first. */
async function markShoutoutPaid(request: ShoutoutRequestRow): Promise<ShoutoutRequestRow | null> {
  const [updated] = await db
    .update(shoutoutRequestsTable)
    .set({ status: "accepted", paid_at: new Date(), updated_at: new Date() })
    .where(
      and(
        eq(shoutoutRequestsTable.id, request.id),
        eq(shoutoutRequestsTable.status, "pending_payment"),
      ),
    )
    .returning();
  if (!updated) return null;
  /* The paid flip landed (a racing verify/webhook gets no row back)
     — the creator hears the sale now, naming what the fan paid. */
  await tellShoutoutCreator({
    userId: request.creator_user_id,
    kind: "shoutout_paid",
    title: "New paid shoutout",
    body: `${request.fan_name} paid ${usd(request.price_cents)} for a shoutout (${request.occasion}). It's in your requests — record it when ready.`,
  });
  return updated;
}

export interface ShoutoutSettleResult {
  found: boolean;
  status: string;
  /** True only for the caller that landed the pending → accepted flip. */
  transitioned: boolean;
  request?: ShoutoutRequestRow;
}

/** Settle a shoutout from its checkout session id — the Stripe
    webhook's door (checkout.session.completed with metadata.type
    "shoutout_request", payment_status "paid"). Exactly-once falls
    out of the guarded flip: webhook retries and a racing
    return-verify land the acceptance — and the creator tell — one
    time. */
export async function settleShoutoutBySessionId(sessionId: string): Promise<ShoutoutSettleResult> {
  const [request] = await db
    .select()
    .from(shoutoutRequestsTable)
    .where(eq(shoutoutRequestsTable.stripe_session_id, sessionId));
  if (!request) return { found: false, status: "not_found", transitioned: false };
  if (request.status !== "pending_payment") {
    return { found: true, status: request.status, transitioned: false, request };
  }
  const row = await markShoutoutPaid(request);
  return {
    found: true,
    status: row ? "accepted" : request.status,
    transitioned: !!row,
    request: row ?? request,
  };
}

/* POST /api/shoutouts/requests/:id/checkout/verify { sessionId } —
   the fan is back from Checkout: if the session is paid, flip the
   request pending_payment → accepted exactly once (the guarded
   UPDATE is the idempotency: retries and double-clicks no-op). */
router.post("/shoutouts/requests/:id/checkout/verify", publicApiLimiter, async (req, res) => {
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  const [request] = await db
    .select()
    .from(shoutoutRequestsTable)
    .where(eq(shoutoutRequestsTable.id, param(req.params.id)));
  if (!request) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  if (!sessionId || request.stripe_session_id !== sessionId) {
    res.status(400).json({ error: "That checkout session doesn't match this request." });
    return;
  }
  if (request.status !== "pending_payment") {
    res.json({ status: request.status, paid: true });
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
  if (session.payment_status !== "paid") {
    res.json({ status: request.status, paid: false });
    return;
  }
  /* The shared settle: guarded flip + the creator's one tell. A
     racing webhook may land the flip first — the request is accepted
     either way and the response is unchanged. */
  const updated = await markShoutoutPaid(request);
  res.json({ status: updated?.status ?? "accepted", paid: true });
});

/* GET /api/shoutouts/requests — the creator's incoming requests (free, owner only). */
router.get("/shoutouts/requests", requireAuth, publicApiLimiter, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const conditions = [eq(shoutoutRequestsTable.creator_user_id, req.userId!)];
  if (status && (REQUEST_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(shoutoutRequestsTable.status, status as ShoutoutRequestStatus));
  }
  const rows = await db
    .select()
    .from(shoutoutRequestsTable)
    .where(and(...conditions))
    .orderBy(desc(shoutoutRequestsTable.created_at))
    .limit(200);
  res.json({ requests: await Promise.all(rows.map(toRequestJson)) });
});

/* ─── Decline refund (owner ruling, stack1400 #15) ───────────────────
   A request is PAID when the settle flip recorded the payment:
   paid_at set by markShoutoutPaid, on the checkout session stored at
   checkout time. A positive price alone is NOT paid — a priced
   request the fan never paid for sits in pending_payment with a
   session id and paid_at null, and declines with no refund attempt,
   exactly like a free request. */
function isPaidShoutoutRequest(r: ShoutoutRequestRow): boolean {
  return r.paid_at != null && r.stripe_session_id != null && r.price_cents > 0;
}

/** Refund a paid shoutout's checkout session in full, via the house
    session-refund rail (the same one beats use). Exactly-once falls
    out of two locks: the claim UPDATE in the decline handler admits
    one caller, and the rail's refund idempotency key
    (`refund:<session id>` — one session pays one request, UNIQUE)
    makes Stripe dedupe any replay of that session's refund. Returns
    whether the refund landed; callers phrase everything from this,
    never claim a refund that didn't happen. */
async function refundPaidShoutout(request: ShoutoutRequestRow): Promise<boolean> {
  if (!request.stripe_session_id) return false;
  try {
    const session = await retrieveCheckoutSession(request.stripe_session_id);
    return await refundCheckoutSessionPayment(session);
  } catch (err) {
    logger.warn({ err, requestId: request.id }, "[shoutouts] decline refund could not start");
    return false;
  }
}

/* PATCH /api/shoutouts/requests/:id — update status / delivery URL (free, owner only).
   Enforces the transition map; terminal states can't be reopened. */
router.patch("/shoutouts/requests/:id", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid update.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { status, deliveryUrl } = parsed.data;
  const rows = await db
    .select()
    .from(shoutoutRequestsTable)
    .where(
      and(
        eq(shoutoutRequestsTable.id, param(req.params.id)),
        eq(shoutoutRequestsTable.creator_user_id, req.userId!),
      ),
    );
  if (rows.length === 0) {
    res.status(404).json({ error: "Request not found." });
    return;
  }
  const current = rows[0]!.status;
  if (status !== current && !canTransition(current, status)) {
    res.status(409).json({
      error: `Can't move a request from "${current}" to "${status}".`,
    });
    return;
  }
  /* Declining a PAID request (owner ruling, stack1400 #15): the fan
     is refunded in full, automatically, as part of the decline. The
     refund runs under a claim — a guarded UPDATE into the terminal
     'refunded' state admits exactly one caller, so a double-decline
     or racing replay can neither refund twice nor email twice. A
     failed refund rolls the claim back, leaving the request in its
     pre-decline state (recoverable — the creator can retry), and no
     email goes out claiming money that never moved. */
  if (status === "declined" && current !== "declined" && isPaidShoutoutRequest(rows[0]!)) {
    const [claimed] = await db
      .update(shoutoutRequestsTable)
      .set({ status: "refunded", updated_at: new Date() })
      .where(
        and(
          eq(shoutoutRequestsTable.id, rows[0]!.id),
          eq(shoutoutRequestsTable.status, current),
        ),
      )
      .returning();
    if (!claimed) {
      /* Another decline landed the claim first — it owns the refund
         and the fan email. Answer with the request as it now stands. */
      const [fresh] = await db
        .select()
        .from(shoutoutRequestsTable)
        .where(eq(shoutoutRequestsTable.id, rows[0]!.id));
      res.json({ request: await toRequestJson(fresh ?? rows[0]!) });
      return;
    }
    const refunded = await refundPaidShoutout(claimed);
    if (!refunded) {
      /* Roll the claim back — the decline never happened, and the
         fan is told nothing. The Stripe refund idempotency key makes
         the creator's retry safe even if this attempt secretly
         landed on Stripe's side. */
      await db
        .update(shoutoutRequestsTable)
        .set({ status: current, updated_at: new Date() })
        .where(
          and(
            eq(shoutoutRequestsTable.id, rows[0]!.id),
            eq(shoutoutRequestsTable.status, "refunded"),
          ),
        );
      logger.error({ requestId: rows[0]!.id }, "[shoutouts] decline refund failed — decline rolled back");
      res.status(502).json({
        error:
          "We couldn't refund the fan's payment, so this request wasn't declined. Try again in a moment — if it keeps failing, contact support.",
      });
      return;
    }
    /* The refund landed and this caller holds the claim — the fan's
       decline email goes out now, stating the full refund. */
    if (claimed.fan_email) {
      const [settings] = await db
        .select()
        .from(shoutoutSettingsTable)
        .where(eq(shoutoutSettingsTable.user_id, claimed.creator_user_id));
      await mailShoutoutFan(
        buildShoutoutDeclinedEmail({
          fanName: claimed.fan_name,
          fanEmail: claimed.fan_email,
          creatorName: settings?.display_name ?? "Your creator",
          occasion: claimed.occasion,
          refundCents: claimed.price_cents,
        }),
      );
    }
    res.json({ request: await toRequestJson(claimed) });
    return;
  }
  const [updated] = await db
    .update(shoutoutRequestsTable)
    .set({
      status,
      /* Mirror-on-save (2026-10-13 law): a creator-supplied delivery URL
         (provider CDN / expiring link) is re-hosted into permanent storage;
         own-storage values normalize to their stable ref. Re-sign on read. */
      delivery_url: deliveryUrl
        ? ((await mirrorExternalMediaUrl(deliveryUrl, { kind: "video", ownerKey: req.userId! })) ??
          normalizeToStorageRef(deliveryUrl))
        : null,
      delivered_at: status === "delivered" ? new Date() : rows[0]!.delivered_at,
      updated_at: new Date(),
    })
    .where(eq(shoutoutRequestsTable.id, rows[0]!.id))
    .returning();
  /* The fan is a guest — email is their only channel. A status that
     actually CHANGED to delivered/declined tells them, once (a
     same-status PATCH, e.g. just fixing the delivery URL, doesn't
     re-mail). The delivered mail only goes out with a watchable
     link: the refreshed URL from the same read model the dashboard
     plays. */
  if (updated && status !== current && updated.fan_email) {
    const [settings] = await db
      .select()
      .from(shoutoutSettingsTable)
      .where(eq(shoutoutSettingsTable.user_id, rows[0]!.creator_user_id));
    const creatorName = settings?.display_name ?? "Your creator";
    if (status === "delivered") {
      const refreshed = updated.delivery_url ? await refreshSupabaseStorageUrl(updated.delivery_url) : "";
      if (refreshed) {
        await mailShoutoutFan(buildShoutoutDeliveredEmail({
          fanName: updated.fan_name,
          fanEmail: updated.fan_email,
          creatorName,
          occasion: updated.occasion,
          deliveryUrl: refreshed,
        }));
      }
    } else if (status === "declined") {
      await mailShoutoutFan(buildShoutoutDeclinedEmail({
        fanName: updated.fan_name,
        fanEmail: updated.fan_email,
        creatorName,
        occasion: updated.occasion,
      }));
    }
  }
  res.json({ request: await toRequestJson(updated!) });
});

/* GET /api/shoutouts/revenue — revenue tracking (free, owner only).
   Sums are computed from real tracked requests. Priced requests are
   payable via Checkout (0142); "earnable" counts accepted+ requests —
   for priced ones that now means actually paid (or free-accepted). */
router.get("/shoutouts/revenue", requireAuth, publicApiLimiter, async (req, res) => {
  const rows = await db
    .select()
    .from(shoutoutRequestsTable)
    .where(eq(shoutoutRequestsTable.creator_user_id, req.userId!));
  const countBy = (s: ShoutoutRequestStatus) => rows.filter((r) => r.status === s).length;
  /* "Earnable" = accepted + in progress + delivered at locked-in prices. */
  const earnable = rows.filter((r) =>
    (["accepted", "in_progress", "delivered"] as ShoutoutRequestStatus[]).includes(r.status),
  );
  const grossCents = earnable.reduce((sum, r) => sum + r.price_cents, 0);
  res.json({
    total: rows.length,
    pendingPayment: countBy("pending_payment"),
    accepted: countBy("accepted"),
    inProgress: countBy("in_progress"),
    delivered: countBy("delivered"),
    declined: countBy("declined"),
    grossCents,
    grossDollars: centsToDollars(grossCents),
    netCents: netAfterFee(grossCents),
    netDollars: centsToDollars(netAfterFee(grossCents)),
    platformFeePct: SHOUTOUT_PLATFORM_FEE_PCT,
    paymentsLive: true,
  });
});

/* POST /api/shoutouts/ai-message { occasion, notes, creatorName }
   → 200 { message, creditsUsed, creditsRemaining }
   Paid: 1 credit. Charge-before-generate; refund on provider failure.
   Helps a fan write a warm, specific shoutout request the creator will
   actually enjoy recording. */
router.post("/shoutouts/ai-message", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = aiMessageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid message request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < SHOUTOUT_AI_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to polish your request message.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SHOUTOUT_AI_CREDITS, {
      action: "Fan Shoutouts AI Message",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to polish your request message.",
      });
      return;
    }
    throw err;
  }

  const { occasion, notes, creatorName } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You help a fan write a shoutout request message for a creator to read on video. ` +
            `The message should be warm, specific, and easy to say out loud — ` +
            `1 to 3 short sentences, natural spoken language, no hashtags, no emojis. ` +
            `Use the fan's notes verbatim where they give names, ages, or details; ` +
            `never invent names or facts. Keep it under 60 words. ` +
            `Return ONLY JSON: {"message": "..."}`,
        },
        {
          role: "user",
          content:
            `Occasion: ${occasion.trim()}\n` +
            `Fan's rough notes: ${notes.trim() || "(none — write something heartfelt and generic)"}\n` +
            `Creator name: ${creatorName.trim() || "(unknown)"}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 400,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let message = "";
    try {
      const j = JSON.parse(raw) as { message?: unknown };
      if (typeof j.message === "string") message = j.message.trim().slice(0, 500);
    } catch {
      /* fall through to the empty check below */
    }
    if (!message) {
      throw new Error("Model returned no usable message");
    }

    res.json({ message, creditsUsed: SHOUTOUT_AI_CREDITS, creditsRemaining });
  } catch (err) {
    /* Provider failure after charging → refund, then report. */
    await refundCredits(req.userId!, SHOUTOUT_AI_CREDITS, {
      action: "Fan Shoutouts AI Message — Refund (provider failed)",
    });
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[shoutouts] OpenAI rate limit / quota");
      res.status(503).json({ error: "The writer is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[shoutouts] AI message helper failed");
    res.status(502).json({ error: "Couldn't draft your message — Visual Bucs refunded, try again." });
  }
});

export default router;
