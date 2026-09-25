import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";

/* ─── Tip Jar ──────────────────────────────────────────────────────────────
   Creators accept tips/donations from fans at /tips/:handle.

   HONESTY CONTRACT: payment processing is COMING SOON. This v1 tracks tip
   INTENT only — no real charge is ever made and no tip is ever marked
   "completed". The public page says so plainly, and the API enforces it:
   every recorded tip has status "pending_payment" forever.

   Storage: server-owned in-memory maps (same pattern as the caption styler
   and other v1 tools). NOT restart-safe — move to DB-backed storage before
   real payments ship. */

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

export function __resetTipJarStores() {
  tipPages.clear();
  tipPagesByHandle.clear();
  tipIntents.clear();
}

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

/* GET /api/tips/page/:handle → public tip page data. No auth. */
router.get("/tips/page/:handle", publicApiLimiter, (req, res) => {
  const handle = String(req.params.handle ?? "").toLowerCase();
  const ownerId = tipPagesByHandle.get(handle);
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
    paymentsLive: false,
    notice: "Payment processing is coming soon — no charge is made today.",
  });
});

/* POST /api/tips/:handle/tip → record a tip INTENT. No auth. NEVER charges. */
router.post("/tips/:handle/tip", publicApiLimiter, (req, res) => {
  const handle = String(req.params.handle ?? "").toLowerCase();
  const ownerId = tipPagesByHandle.get(handle);
  if (!ownerId) {
    res.status(404).json({ error: "Tip page not found." });
    return;
  }
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
    handle,
    amount: Math.round(amount * 100) / 100,
    currency: TIP_CURRENCY,
    fanName: fanName.trim(),
    message: message.trim(),
    status: TIP_STATUS_PENDING,
    createdAt: new Date().toISOString(),
  };
  tipIntents.set(intent.id, intent);
  logger.info({ handle, amount: intent.amount }, "[tip-jar] tip intent recorded (no charge)");
  res.status(201).json({
    intent,
    paymentsLive: false,
    notice: "Tip recorded. Payment processing is coming soon — no charge was made today.",
  });
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
