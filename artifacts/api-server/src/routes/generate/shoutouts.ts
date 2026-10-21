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
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../../lib/stripe-client";

const router = Router();

/* ─── Fan Shoutouts ──────────────────────────────────────────────────────
   /shoutouts — creators sell personalized video shoutouts to fans.
   Setup + request tracking are real. Payment (0142, DE-14): a priced
   request gets a real Stripe Checkout session (test mode, like every
   money path on the site) via POST /shoutouts/requests/:id/checkout;
   the verify endpoint flips it pending_payment → accepted exactly
   once when the session reports paid. Free requests (price 0) keep
   the manual accept flow. The site's 10% platform fee intent is
   unchanged. Only the AI message helper costs credits (1 credit,
   charge-before-generate, refund on provider failure). */

/* 1 credit per AI message draft — env-overridable without a deploy. */
export const SHOUTOUT_AI_CREDITS = Number(process.env["SHOUTOUT_AI_CREDIT_COST"]) || 100;

/* Platform fee intent for v1 — recorded for transparency; no money moves
   until payment processing ships. */
export const SHOUTOUT_PLATFORM_FEE_PCT = Number(process.env["SHOUTOUT_PLATFORM_FEE_PCT"]) || 10;

export const REQUEST_STATUSES = [
  "pending_payment",
  "accepted",
  "in_progress",
  "delivered",
  "declined",
] as const;

/* Allowed status transitions. Terminal states (delivered/declined) can't move.
   'refunded' is terminal and system-only: the clawback engine (0182, D1)
   writes it directly when the paying charge is reversed — no user
   transition ever targets it, so it appears in no target list. */
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

/* Net payout after the platform fee, in cents — for the dashboard's honest
   "what you'd keep" figure (applies once payments ship). */
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
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.creatorUserId,
    rail: "shoutout-request",
    purchaseIntent: { requestId: args.requestId, priceCents: args.priceCents },
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
    paymentsLive: false, /* v1 honesty: requests only until payment processing ships */
  });
});

/* GET /api/shoutouts/settings — the creator's own settings (free). */
router.get("/shoutouts/settings", publicApiLimiter, requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(shoutoutSettingsTable)
    .where(eq(shoutoutSettingsTable.user_id, req.userId!));
  res.json({ settings: rows[0] ? toSettingsJson(rows[0]) : null });
});

/* PUT /api/shoutouts/settings — create or update settings (free, owner only). */
router.put("/shoutouts/settings", publicApiLimiter, requireAuth, async (req, res) => {
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
  res.status(201).json({
    request: await toRequestJson(request!),
    /* Priced requests can be paid immediately via the checkout
       endpoint; free requests skip payment entirely. */
    paymentsLive: (request?.price_cents ?? 0) > 0,
  });
});

/* POST /api/shoutouts/requests/:id/checkout — start payment for a
   priced request (public: the request id is the capability, exactly
   like the storefront's session flow). Creates a Checkout session,
   stores its id on the request, returns the hosted URL. */
router.post("/shoutouts/requests/:id/checkout", publicApiLimiter, async (req, res) => {
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
  const idempotencyKey = buildShoutoutCheckoutKey({
    creatorUserId: request.creator_user_id,
    requestId: request.id,
    priceCents: request.price_cents,
  });
  const session = await stripe.checkout.sessions.create({
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
    success_url: `${base}/shoutouts?request=${request.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/shoutouts`,
  }, { idempotencyKey });
  await db
    .update(shoutoutRequestsTable)
    .set({ stripe_session_id: session.id, updated_at: new Date() })
    .where(eq(shoutoutRequestsTable.id, request.id));
  res.json({ checkoutUrl: session.url });
});

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
  res.json({ status: updated?.status ?? "accepted", paid: true });
});

/* GET /api/shoutouts/requests — the creator's incoming requests (free, owner only). */
router.get("/shoutouts/requests", publicApiLimiter, requireAuth, async (req, res) => {
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

/* PATCH /api/shoutouts/requests/:id — update status / delivery URL (free, owner only).
   Enforces the transition map; terminal states can't be reopened. */
router.patch("/shoutouts/requests/:id", publicApiLimiter, requireAuth, async (req, res) => {
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
  res.json({ request: await toRequestJson(updated!) });
});

/* GET /api/shoutouts/revenue — revenue tracking (free, owner only).
   Sums are computed from real tracked requests. Priced requests are
   payable via Checkout (0142); "earnable" counts accepted+ requests —
   for priced ones that now means actually paid (or free-accepted). */
router.get("/shoutouts/revenue", publicApiLimiter, requireAuth, async (req, res) => {
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
router.post("/shoutouts/ai-message", publicApiLimiter, requireAuth, async (req, res) => {
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
      temperature: 0.6,
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
