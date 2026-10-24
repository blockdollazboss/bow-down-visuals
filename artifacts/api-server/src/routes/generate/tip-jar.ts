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
   earnings view reads them as pending, as before.

   FUNDING GOALS (Stack-100 #3): a creator may run ONE active funding
   goal on their tip page (target + what it's for). The goal definition
   rides this same settings object — no new table — extended with a
   start instant and an archive of reached goals. Progress is NEVER a
   stored counter and NEVER counts intents: every read derives it live
   from the durable tip_jar_tips rows, counting only rows the rail
   itself flipped to "paid" (see computeFundingProgress). */

export const TIP_CURRENCY = "USD";
export const TIP_STATUS_PENDING = "pending_payment";
/** The rail's one real money state: set exactly once by checkout verify. */
export const TIP_STATUS_PAID = "paid";
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

/** One active funding goal on a tip page. Amounts are USD dollars,
    the unit the whole tip rail speaks (goalAmount mirror included). */
export interface FundingGoal {
  id: string;
  targetAmount: number;
  label: string;
  /** ISO instant the goal started counting. Only tips paid at/after
      this instant count toward it — a goal measures money raised
      toward it, not the creator's lifetime earnings. */
  startedAt: string;
}

/** A reached goal, kept on the record after it is replaced or removed
    so past wins are never silently erased. */
export interface FundingGoalRecord {
  id: string;
  label: string;
  targetAmount: number;
  raisedAmount: number;
  startedAt: string;
  reachedAt: string;
}

export interface TipPageSettings {
  userId: string;
  handle: string;
  displayName: string;
  message: string;
  suggestedAmounts: number[];
  /** Mirror of fundingGoal (targetAmount / label) for existing readers. */
  goalAmount: number | null;
  goalLabel: string;
  fundingGoal: FundingGoal | null;
  goalHistory: FundingGoalRecord[];
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

export const fundingGoalSchema = z.object({
  targetAmount: z.number().positive().max(1_000_000),
  label: z.string().trim().max(80).default(""),
});

/** The slice of a durable tip_jar_tips row that progress math reads. */
export interface PaidTipRowLike {
  amount_cents: number;
  currency: string;
  status: string;
  paid_at: Date | string | null;
  created_at: Date | string | null;
}

export interface FundingProgress {
  /** USD dollars raised toward the goal (paid tips only). */
  raised: number;
  raisedCount: number;
  /** 0..1, capped. */
  progress: number;
  reached: boolean;
  /** ISO instant the running total first crossed the target, if ever. */
  reachedAt: string | null;
}

function rowTimeMs(row: PaidTipRowLike): number {
  const t = row.paid_at ?? row.created_at;
  if (t == null) return NaN;
  return t instanceof Date ? t.getTime() : new Date(t).getTime();
}

/**
 * Derive a funding goal's progress from stored tip records. This is
 * the ONLY way progress is ever produced — nothing stores a counter,
 * so the number can always be reconciled against tip_jar_tips.
 *
 * A row counts only when ALL of these hold (the rail's own money-state
 * conventions):
 *   - status is exactly "paid" — the state checkout verify sets once.
 *     pending_payment / refunded / anything else never counts, and tip
 *     intents never reach this table at all;
 *   - currency matches the rail's USD;
 *   - it was paid at/after the goal's startedAt.
 * Rows may arrive in any order; reachedAt is found by walking the
 * qualifying rows chronologically to the crossing point.
 */
export function computeFundingProgress(
  rows: PaidTipRowLike[],
  goal: Pick<FundingGoal, "targetAmount" | "startedAt">,
): FundingProgress {
  const targetCents = Math.round(goal.targetAmount * 100);
  const startMs = new Date(goal.startedAt).getTime();
  const qualifying = rows
    .filter((r) => r.status === TIP_STATUS_PAID)
    .filter((r) => String(r.currency).toLowerCase() === TIP_CURRENCY.toLowerCase())
    .map((r) => ({ cents: r.amount_cents, atMs: rowTimeMs(r) }))
    .filter((r) => Number.isFinite(r.atMs) && r.atMs >= startMs && r.cents > 0)
    .sort((a, b) => a.atMs - b.atMs);
  let raisedCents = 0;
  let reachedAt: string | null = null;
  for (const r of qualifying) {
    raisedCents += r.cents;
    if (reachedAt === null && targetCents > 0 && raisedCents >= targetCents) {
      reachedAt = new Date(r.atMs).toISOString();
    }
  }
  const raised = Math.round(raisedCents) / 100;
  return {
    raised,
    raisedCount: qualifying.length,
    progress: targetCents > 0 ? Math.min(1, raisedCents / targetCents) : 0,
    reached: reachedAt !== null,
    reachedAt,
  };
}

/**
 * Apply a goal set/edit/remove to a settings-shaped goal state.
 * Pure: the caller supplies the goal's current progress (derived from
 * stored tips) and the id/clock for a fresh goal.
 *
 *   - next.targetAmount null → remove. A reached goal is archived to
 *     history first; an unreached one simply clears.
 *   - no active goal → start a new one at `now`.
 *   - identical target+label → untouched (the settings form resubmits
 *     the goal fields on every save; a routine save must never restart
 *     or archive the creator's goal).
 *   - changed values on an unreached goal → edit in place: same id,
 *     same startedAt, so the progress basis never resets.
 *   - changed values on a reached goal → archive it, start fresh.
 */
export function applyFundingGoalChange(args: {
  prevGoal: FundingGoal | null;
  prevHistory: FundingGoalRecord[];
  prevProgress: FundingProgress | null;
  next: { targetAmount: number | null; label: string };
  now: string;
  newId: string;
}): { fundingGoal: FundingGoal | null; goalHistory: FundingGoalRecord[] } {
  const { prevGoal, prevHistory, prevProgress, next, now, newId } = args;
  const archiveIfReached = (): FundingGoalRecord[] => {
    if (prevGoal && prevProgress?.reached && prevProgress.reachedAt) {
      return [
        ...prevHistory,
        {
          id: prevGoal.id,
          label: prevGoal.label,
          targetAmount: prevGoal.targetAmount,
          raisedAmount: prevProgress.raised,
          startedAt: prevGoal.startedAt,
          reachedAt: prevProgress.reachedAt,
        },
      ];
    }
    return prevHistory;
  };

  if (next.targetAmount == null) {
    return { fundingGoal: null, goalHistory: archiveIfReached() };
  }
  const label = next.label.trim();
  if (!prevGoal) {
    return {
      fundingGoal: { id: newId, targetAmount: next.targetAmount, label, startedAt: now },
      goalHistory: prevHistory,
    };
  }
  if (prevGoal.targetAmount === next.targetAmount && prevGoal.label === label) {
    return { fundingGoal: prevGoal, goalHistory: prevHistory };
  }
  if (prevProgress?.reached) {
    return {
      fundingGoal: { id: newId, targetAmount: next.targetAmount, label, startedAt: now },
      goalHistory: archiveIfReached(),
    };
  }
  return {
    fundingGoal: { ...prevGoal, targetAmount: next.targetAmount, label },
    goalHistory: prevHistory,
  };
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

/** All durable tip rows for one page owner (any status — the progress
    function applies the paid-only rule). Read fresh on every call:
    progress is derived, never cached. */
async function paidTipRowsFor(userId: string): Promise<PaidTipRowLike[]> {
  const rows = await db
    .select({
      amount_cents: tipJarTipsTable.amount_cents,
      currency: tipJarTipsTable.currency,
      status: tipJarTipsTable.status,
      paid_at: tipJarTipsTable.paid_at,
      created_at: tipJarTipsTable.created_at,
    })
    .from(tipJarTipsTable)
    .where(eq(tipJarTipsTable.page_user_id, userId));
  return rows as PaidTipRowLike[];
}

/** Public/dashboard view of a settings goal + its derived progress.
    When the stored tips cannot be read, the goal is reported with
    progressUnavailable and NO numbers — never a fabricated zero. */
export interface FundingGoalView {
  id: string;
  label: string;
  targetAmount: number;
  currency: string;
  startedAt: string;
  raised: number | null;
  raisedCount: number | null;
  progress: number | null;
  reached: boolean;
  reachedAt: string | null;
  progressUnavailable?: boolean;
}

async function fundingGoalView(settings: TipPageSettings): Promise<FundingGoalView | null> {
  const goal = settings.fundingGoal;
  if (!goal) return null;
  const base: FundingGoalView = {
    id: goal.id,
    label: goal.label,
    targetAmount: goal.targetAmount,
    currency: TIP_CURRENCY,
    startedAt: goal.startedAt,
    raised: null,
    raisedCount: null,
    progress: null,
    reached: false,
    reachedAt: null,
  };
  try {
    const p = computeFundingProgress(await paidTipRowsFor(settings.userId), goal);
    return { ...base, raised: p.raised, raisedCount: p.raisedCount, progress: p.progress, reached: p.reached, reachedAt: p.reachedAt };
  } catch (err) {
    logger.warn({ err, userId: settings.userId }, "[tip-jar] funding goal progress unavailable");
    return { ...base, progressUnavailable: true };
  }
}

/** Run the goal lifecycle for a settings save / goal endpoint call. */
async function transitionFundingGoal(
  prev: TipPageSettings | undefined,
  next: { targetAmount: number | null; label: string },
  now: string,
): Promise<{ fundingGoal: FundingGoal | null; goalHistory: FundingGoalRecord[] }> {
  const prevGoal = prev?.fundingGoal ?? null;
  const prevHistory = prev?.goalHistory ?? [];
  let prevProgress: FundingProgress | null = null;
  if (prevGoal) {
    try {
      prevProgress = computeFundingProgress(await paidTipRowsFor(prev!.userId), prevGoal);
    } catch (err) {
      /* Without a trustworthy progress read we cannot prove the goal
         was reached, so nothing is archived on this transition. */
      logger.warn({ err, userId: prev!.userId }, "[tip-jar] goal transition without progress read");
    }
  }
  return applyFundingGoalChange({
    prevGoal,
    prevHistory,
    prevProgress,
    next,
    now,
    newId: randomUUID(),
  });
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
router.post("/tips/settings", publicApiLimiter, requireAuth, async (req, res) => {
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

  /* The goal fields ride the same save: run them through the funding
     goal lifecycle so a save can start / edit / archive / clear the
     goal without resetting its progress basis. */
  const goalState = await transitionFundingGoal(
    prev,
    { targetAmount: goalAmount, label: goalLabel },
    now,
  );

  const settings: TipPageSettings = {
    userId: req.userId!,
    handle,
    displayName: displayName.trim(),
    message: message.trim(),
    suggestedAmounts: normalizeSuggestedAmounts(suggestedAmounts),
    goalAmount: goalState.fundingGoal?.targetAmount ?? null,
    goalLabel: goalState.fundingGoal?.label ?? "",
    fundingGoal: goalState.fundingGoal,
    goalHistory: goalState.goalHistory,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  tipPages.set(req.userId!, settings);
  tipPagesByHandle.set(handle, req.userId!);
  logger.info({ userId: req.userId, handle }, "[tip-jar] tip page saved");
  res.json({ settings, paymentsLive: false });
});

/* POST /api/tips/goal { targetAmount, label } → set or edit MY active
   funding goal. Auth. Owner-scoped by construction: the handler only
   ever touches the caller's own tip page. */
router.post("/tips/goal", publicApiLimiter, requireAuth, async (req, res) => {
  const settings = tipPages.get(req.userId!);
  if (!settings) {
    res.status(404).json({ error: "Set up your tip page first, then add a funding goal." });
    return;
  }
  const parsed = fundingGoalSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid funding goal.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const now = new Date().toISOString();
  const goalState = await transitionFundingGoal(
    settings,
    { targetAmount: parsed.data.targetAmount, label: parsed.data.label },
    now,
  );
  const updated: TipPageSettings = {
    ...settings,
    goalAmount: goalState.fundingGoal?.targetAmount ?? null,
    goalLabel: goalState.fundingGoal?.label ?? "",
    fundingGoal: goalState.fundingGoal,
    goalHistory: goalState.goalHistory,
    updatedAt: now,
  };
  tipPages.set(req.userId!, updated);
  res.json({ goal: await fundingGoalView(updated), goalHistory: updated.goalHistory });
});

/* DELETE /api/tips/goal → remove MY active funding goal. Auth. A
   reached goal is archived to the history, never silently erased. */
router.delete("/tips/goal", publicApiLimiter, requireAuth, async (req, res) => {
  const settings = tipPages.get(req.userId!);
  if (!settings) {
    res.status(404).json({ error: "Tip page not set up yet." });
    return;
  }
  if (!settings.fundingGoal) {
    res.json({ goal: null, goalHistory: settings.goalHistory });
    return;
  }
  const now = new Date().toISOString();
  const goalState = await transitionFundingGoal(settings, { targetAmount: null, label: "" }, now);
  const updated: TipPageSettings = {
    ...settings,
    goalAmount: null,
    goalLabel: "",
    fundingGoal: null,
    goalHistory: goalState.goalHistory,
    updatedAt: now,
  };
  tipPages.set(req.userId!, updated);
  res.json({ goal: null, goalHistory: updated.goalHistory });
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
  /* Goal progress is derived from PAID tips only (0142 rows) — the
     intent totals above stay what they are (recorded intent), but
     they no longer feed the goal bar. */
  const goal = await fundingGoalView(settings);
  res.json({
    page: {
      handle: settings.handle,
      displayName: settings.displayName,
      message: settings.message,
      suggestedAmounts: settings.suggestedAmounts,
      goalAmount: settings.goalAmount,
      goalLabel: settings.goalLabel,
    },
    goal,
    stats: { ...stats, goalProgress: goal?.progress ?? null },
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
router.get("/tips/dashboard", publicApiLimiter, requireAuth, async (req, res) => {
  const settings = tipPages.get(req.userId!);
  const intents = [...tipIntents.values()]
    .filter((t) => t.pageUserId === req.userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const stats = sumTipIntents(intents);
  const goal = settings ? await fundingGoalView(settings) : null;
  res.json({
    hasPage: !!settings,
    handle: settings?.handle ?? null,
    ...stats,
    goalAmount: settings?.goalAmount ?? null,
    goalLabel: settings?.goalLabel ?? "",
    /* Honest goal progress: paid tips only, same derivation as the
       public page. (Was intent-based — intents are not money.) */
    goalProgress: goal?.progress ?? null,
    goal,
    goalHistory: settings?.goalHistory ?? [],
    feed: intents.slice(0, 50),
    paymentsLive: false,
  });
});

export default router;
