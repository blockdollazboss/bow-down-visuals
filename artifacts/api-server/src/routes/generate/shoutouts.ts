import { Router } from "express";
import { z } from "zod";
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

const router = Router();

/* ─── Fan Shoutouts ──────────────────────────────────────────────────────
   /shoutouts — creators sell personalized video shoutouts to fans.
   v1 honesty contract: setup + request tracking are real. Actual payment
   processing is "coming soon" — requests are recorded with status
   "pending_payment" and no money moves until payment integration ships.
   The UI and API never report a request as paid or completed in v1.
   Pricing: free to set up and track. The site's 10% platform fee is
   recorded as intent (applies to future payment processing, revenue
   share — not credits). Only the AI message helper costs credits
   (1 credit, charge-before-generate, refund on provider failure). */

/* 1 credit per AI message draft — env-overridable without a deploy. */
export const SHOUTOUT_AI_CREDITS = Number(process.env["SHOUTOUT_AI_CREDIT_COST"]) || 1;

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

/* Allowed status transitions. Terminal states (delivered/declined) can't move. */
const TRANSITIONS: Record<ShoutoutRequestStatus, ShoutoutRequestStatus[]> = {
  pending_payment: ["accepted", "declined"],
  accepted: ["in_progress", "declined"],
  in_progress: ["delivered", "declined"],
  delivered: [],
  declined: [],
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
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
  };
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
   The request lands as "pending_payment": honest in v1 because payment
   processing is coming soon — no charge is made, nothing is marked paid. */
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
    paymentsLive: false, /* v1 honesty */
  });
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
      /* Persist the stable storage ref (re-sign happens on read). */
      delivery_url: deliveryUrl ? normalizeToStorageRef(deliveryUrl) : null,
      delivered_at: status === "delivered" ? new Date() : rows[0]!.delivered_at,
      updated_at: new Date(),
    })
    .where(eq(shoutoutRequestsTable.id, rows[0]!.id))
    .returning();
  res.json({ request: await toRequestJson(updated!) });
});

/* GET /api/shoutouts/revenue — revenue tracking (free, owner only).
   Sums are computed from real tracked requests. paymentsLive: false until
   payment processing ships — nothing here claims money changed hands. */
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
    paymentsLive: false,
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
      message: "You're out of credits — top up to polish your request message.",
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
        message: "You're out of credits — top up to polish your request message.",
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
    res.status(502).json({ error: "Couldn't draft your message — credits refunded, try again." });
  }
});

export default router;
