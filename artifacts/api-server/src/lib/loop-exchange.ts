/**
 * loop-exchange.ts — Loop Exchange (Stack-200 Wave 2, idea #168).
 *
 * Loops/hooks posted for other creators to build on. A creator posts a
 * loop with their terms up front (poster_share_pct — their share of
 * every downstream sale's net). Another creator builds on it and
 * proposes the build's splits; the poster accepts or declines; only an
 * agreed build can sell. On EVERY downstream sale the poster is
 * credited and paid per the agreed split.
 *
 * NO SECOND SPLITS MACHINE: the split rules are the existing rail's —
 * validateProductSplits / allocateSplitCents / normalizeSplits from
 * lib/sale-splits.ts (the publishing sum-to-100 machine), and the fee
 * order is the sale-splits order: the flat 5% platform fee
 * (lib/platform-fees feeSplit) comes off the top FIRST, the split
 * divides what remains.
 *
 * THE MONEY: TEST MODE, Visual Bucs only — never cash, never Stripe.
 * A downstream sale is recorded by sale_ref (the selling rail's own
 * reference). Exactly-once is structural, three layers deep:
 *   1. loop_exchange_sales.sale_ref is UNIQUE — one sale row ever.
 *   2. loop_exchange_split_ledger is UNIQUE on (sale_id, recipient) —
 *      one share row per recipient per sale.
 *   3. Each share's balance credit rides a credit_usage row keyed
 *      `loop-exchange:<saleId>:<userId>` (grant convention: negative
 *      creditsUsed), checked before crediting — a retry or replay
 *      completes whatever is missing and never pays twice.
 *
 * Pre-migration posture (provisional migration 9999 not yet applied):
 * loopExchangeReady() probes first; routes answer 503 on writes and
 * degrade reads to empty — nothing is faked.
 */
import { db, loopExchangeLoopsTable, loopExchangeBuildsTable, loopExchangeSalesTable, loopExchangeSplitLedgerTable, creditUsageTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { pgErrorCode, pgErrorText, isUniqueViolation } from "./pg-errors";
import {
  validateProductSplits,
  allocateSplitCents,
  normalizeSplits,
  SaleSplitError,
  type ProductSplit,
} from "./sale-splits";
import { feeSplit } from "./platform-fees";
import { addCreditsAtomic } from "./supabase-admin";
import { recordCreditUsageStrict } from "./payment-record";

export type { ProductSplit };

export class LoopExchangeError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ── Terms — the poster's up-front share ─────────────────────────────── */

export function validatePosterSharePct(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    throw new LoopExchangeError("poster_share_invalid", "Your share must be a number — the percent of each downstream sale's net that goes to you.");
  }
  if (input <= 0 || input >= 100) {
    throw new LoopExchangeError("poster_share_range", "Your share must be more than 0% and less than 100% — the builder keeps a share too.");
  }
  if (Math.abs(input * 100 - Math.round(input * 100)) > 1e-9) {
    throw new LoopExchangeError("poster_share_precision", "Your share can have at most two decimal places.");
  }
  return input;
}

/* ── Build splits — validated by the EXISTING splits rail ────────────── */

/**
 * Validate a build's proposed splits on the sale-splits machine:
 * the builder is the list owner (their share must be in the list, the
 * shares sum to exactly 100), and the loop's poster must appear at
 * AT LEAST the share they posted as their terms. Returns the
 * normalized list (never null — a build with no poster share is not
 * a Loop Exchange build). SaleSplitError propagates as a 400 with the
 * rail's own message.
 */
export function validateBuildSplits(input: {
  builderUserId: string;
  posterUserId: string;
  posterSharePct: number;
  splits: unknown;
}): ProductSplit[] {
  let splits: ProductSplit[] | null;
  try {
    splits = validateProductSplits(input.builderUserId, input.splits);
  } catch (err) {
    if (err instanceof SaleSplitError) throw new LoopExchangeError(err.code, err.message);
    throw err;
  }
  if (!splits) {
    throw new LoopExchangeError(
      "poster_missing",
      "The build's splits must include the loop's original poster — that's the whole deal of the Loop Exchange.",
    );
  }
  const poster = splits.find((s) => s.userId === input.posterUserId);
  if (!poster) {
    throw new LoopExchangeError(
      "poster_missing",
      "The build's splits must include the loop's original poster — that's the whole deal of the Loop Exchange.",
    );
  }
  if (poster.sharePct + 0.01 < input.posterSharePct) {
    throw new LoopExchangeError(
      "poster_share_below_terms",
      `The loop's posted terms give the original poster ${input.posterSharePct}% — your split offers ${poster.sharePct}%. Match the posted terms or pick another loop.`,
    );
  }
  return splits;
}

export function loopRoleFor(userId: string, posterUserId: string, builderUserId: string): "loop_poster" | "builder" | "collaborator" {
  if (userId === posterUserId) return "loop_poster";
  if (userId === builderUserId) return "builder";
  return "collaborator";
}

/* ── Sale planning (pure) ────────────────────────────────────────────── */

export interface LoopSaleAllocation {
  userId: string;
  role: "loop_poster" | "builder" | "collaborator";
  sharePct: number;
  amountVb: number;
}

export interface LoopSalePlan {
  grossVb: number;
  feeVb: number;
  netVb: number;
  allocations: LoopSaleAllocation[];
}

/**
 * Plan one downstream sale: flat 5% fee off the top (platform-fees
 * feeSplit, in whole Visual Bucs), then the agreed splits divide the
 * net by largest remainder (allocateSplitCents) so the shares ALWAYS
 * sum to exactly the net.
 */
export function planLoopSale(input: {
  grossVb: unknown;
  splits: unknown;
  posterUserId: string;
  builderUserId: string;
}): LoopSalePlan {
  if (typeof input.grossVb !== "number" || !Number.isInteger(input.grossVb) || input.grossVb <= 0) {
    throw new LoopExchangeError("gross_invalid", "A downstream sale's price must be a whole number of Visual Bucs, more than zero.");
  }
  const splits = normalizeSplits(input.splits);
  if (!splits) {
    throw new LoopExchangeError("splits_invalid", "This build's agreed splits can't be read — the sale can't be divided safely, so nothing was recorded.");
  }
  if (!splits.some((s) => s.userId === input.posterUserId)) {
    throw new LoopExchangeError("poster_missing", "This build's agreed splits don't include the loop's poster — the sale can't be recorded until the deal includes them.");
  }
  const { fee, net } = feeSplit(input.grossVb);
  const allocations = allocateSplitCents(net, splits).map((a) => ({
    userId: a.userId,
    role: loopRoleFor(a.userId, input.posterUserId, input.builderUserId),
    sharePct: a.sharePct,
    amountVb: a.amountCents,
  }));
  return { grossVb: input.grossVb, feeVb: fee, netVb: net, allocations };
}

export function loopCreditKey(saleId: string, userId: string): string {
  return `loop-exchange:${saleId}:${userId}`;
}

/* ── Recording — exactly-once, deps-injected for tests ───────────────── */

export interface LoopSaleRecord {
  id: string;
  buildId: string;
  loopId: string;
  saleRef: string;
  grossVb: number;
  feeVb: number;
  netVb: number;
}

export interface LoopLedgerRecord {
  saleId: string;
  recipientUserId: string;
  amountVb: number;
}

export interface RecordLoopSaleDeps {
  findSaleByRef: (saleRef: string) => Promise<LoopSaleRecord | null>;
  insertSale: (rec: Omit<LoopSaleRecord, "id"> & { buyerUserId: string | null; recordedByUserId: string }) => Promise<LoopSaleRecord>;
  listLedger: (saleId: string) => Promise<LoopLedgerRecord[]>;
  insertLedgerRow: (row: {
    saleId: string; buildId: string; loopId: string; recipientUserId: string;
    role: LoopSaleAllocation["role"]; sharePct: number; amountVb: number; creditKey: string;
  }) => Promise<void>;
  creditExists: (creditKey: string) => Promise<boolean>;
  creditRecipient: (userId: string, amountVb: number, creditKey: string) => Promise<void>;
}

export type RecordLoopSaleOutcome = "recorded" | "already-recorded";

export async function recordLoopSale(
  deps: RecordLoopSaleDeps,
  input: {
    build: { id: string; loopId: string; builderUserId: string; status: string; splits: unknown };
    posterUserId: string;
    saleRef: string;
    grossVb: unknown;
    buyerUserId?: string | null;
    recordedByUserId: string;
  },
): Promise<{ outcome: RecordLoopSaleOutcome; sale: LoopSaleRecord; plan: LoopSalePlan }> {
  if (input.build.status !== "agreed") {
    throw new LoopExchangeError(
      "terms_not_agreed",
      "This build's split terms haven't been agreed by the loop's poster yet — no sale can be recorded until they accept.",
      409,
    );
  }
  const saleRef = typeof input.saleRef === "string" ? input.saleRef.trim() : "";
  if (!saleRef) {
    throw new LoopExchangeError("sale_ref_required", "A downstream sale needs its sale reference so it can only ever be paid once.");
  }
  const plan = planLoopSale({
    grossVb: input.grossVb,
    splits: input.build.splits,
    posterUserId: input.posterUserId,
    builderUserId: input.build.builderUserId,
  });

  let sale = await deps.findSaleByRef(saleRef);
  const outcome: RecordLoopSaleOutcome = sale ? "already-recorded" : "recorded";
  if (!sale) {
    try {
      sale = await deps.insertSale({
        buildId: input.build.id,
        loopId: input.build.loopId,
        saleRef,
        buyerUserId: input.buyerUserId ?? null,
        recordedByUserId: input.recordedByUserId,
        grossVb: plan.grossVb,
        feeVb: plan.feeVb,
        netVb: plan.netVb,
      });
    } catch (err) {
      /* The UNIQUE sale_ref fired between check and insert — a racing
         twin recorded the same sale. Re-read and complete against it. */
      if (!isUniqueViolation(err)) throw err;
      sale = await deps.findSaleByRef(saleRef);
      if (!sale) throw err;
    }
  }
  if (sale.buildId !== input.build.id) {
    throw new LoopExchangeError(
      "sale_ref_conflict",
      "That sale reference already belongs to a different build — a sale reference can only ever pay one build's splits.",
      409,
    );
  }

  /* Complete the ledger + credits idempotently: rows/credits that
     already landed are skipped, missing ones are written. A retry
     after a mid-pass crash finishes the sale; a replay changes
     nothing. Zero-VB shares (possible on tiny sales after the fee)
     still get their ledger row — the credit step is skipped because
     there is nothing to credit. */
  const existing = await deps.listLedger(sale.id);
  const have = new Set(existing.map((r) => r.recipientUserId));
  for (const alloc of plan.allocations) {
    const creditKey = loopCreditKey(sale.id, alloc.userId);
    if (!have.has(alloc.userId)) {
      await deps.insertLedgerRow({
        saleId: sale.id,
        buildId: input.build.id,
        loopId: input.build.loopId,
        recipientUserId: alloc.userId,
        role: alloc.role,
        sharePct: alloc.sharePct,
        amountVb: alloc.amountVb,
        creditKey,
      });
    }
    if (alloc.amountVb > 0 && !(await deps.creditExists(creditKey))) {
      await deps.creditRecipient(alloc.userId, alloc.amountVb, creditKey);
    }
  }
  return { outcome, sale, plan };
}

/* ── Default deps (real DB + credits rail) ───────────────────────────── */

async function creditLoopShare(userId: string, amountVb: number, creditKey: string): Promise<void> {
  await addCreditsAtomic(userId, amountVb);
  try {
    await recordCreditUsageStrict({
      userId,
      action: "Loop Exchange Split",
      creditsUsed: -amountVb,
      idempotencyKey: creditKey,
    });
  } catch (err) {
    /* The keyed ledger row already exists = this share was already
       credited by a racing pass: claw the duplicate credit back.
       Any other failure also claws back and surfaces, so a retry can
       complete the share cleanly. */
    try {
      await addCreditsAtomic(userId, -amountVb);
    } catch (clawErr) {
      logger.error({ clawErr, userId, creditKey }, "[loop-exchange] CRITICAL clawback failed — manual reconciliation required");
    }
    if (isUniqueViolation(err)) return;
    throw err;
  }
}

export const defaultRecordLoopSaleDeps: RecordLoopSaleDeps = {
  findSaleByRef: async (saleRef) => {
    const [row] = await db.select().from(loopExchangeSalesTable)
      .where(eq(loopExchangeSalesTable.saleRef, saleRef)).limit(1);
    return row ? { id: row.id, buildId: row.buildId, loopId: row.loopId, saleRef: row.saleRef, grossVb: row.grossVb, feeVb: row.feeVb, netVb: row.netVb } : null;
  },
  insertSale: async (rec) => {
    const [row] = await db.insert(loopExchangeSalesTable).values({
      buildId: rec.buildId, loopId: rec.loopId, saleRef: rec.saleRef,
      buyerUserId: rec.buyerUserId, recordedByUserId: rec.recordedByUserId,
      grossVb: rec.grossVb, feeVb: rec.feeVb, netVb: rec.netVb, testMode: true,
    }).returning();
    if (!row) throw new Error("loop exchange sale insert returned no row");
    return { id: row.id, buildId: row.buildId, loopId: row.loopId, saleRef: row.saleRef, grossVb: row.grossVb, feeVb: row.feeVb, netVb: row.netVb };
  },
  listLedger: async (saleId) => {
    const rows = await db.select().from(loopExchangeSplitLedgerTable)
      .where(eq(loopExchangeSplitLedgerTable.saleId, saleId));
    return rows.map((r) => ({ saleId: r.saleId, recipientUserId: r.recipientUserId, amountVb: r.amountVb }));
  },
  insertLedgerRow: async (row) => {
    await db.insert(loopExchangeSplitLedgerTable).values(row);
  },
  creditExists: async (creditKey) => {
    const [row] = await db.select({ id: creditUsageTable.id }).from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, creditKey)).limit(1);
    return !!row;
  },
  creditRecipient: creditLoopShare,
};

/* ── Pre-migration detection ─────────────────────────────────────────── */

export function isMissingLoopExchangeStorage(err: unknown): boolean {
  const code = pgErrorCode(err);
  if (code === "42P01" || code === "42703") return true;
  const text = pgErrorText(err);
  return /loop_exchange_/.test(text) &&
    /(does not exist|undefined table|undefined column|no such table|no such column)/i.test(text);
}

let readyCache: boolean | null = null;

export async function loopExchangeReady(): Promise<boolean> {
  if (readyCache !== null) return readyCache;
  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'loop_exchange_loops' AND column_name = 'poster_share_pct'
      LIMIT 1
    `);
    readyCache = r.rows.length > 0;
  } catch {
    readyCache = false;
  }
  return readyCache;
}

export function __resetLoopExchangeProbes(): void {
  readyCache = null;
}

/* ── Reads (routes) ──────────────────────────────────────────────────── */

export async function listOpenLoops(limit = 50) {
  return db.select().from(loopExchangeLoopsTable)
    .where(eq(loopExchangeLoopsTable.status, "open"))
    .orderBy(desc(loopExchangeLoopsTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function getLoop(loopId: string) {
  const [row] = await db.select().from(loopExchangeLoopsTable)
    .where(eq(loopExchangeLoopsTable.id, loopId)).limit(1);
  return row ?? null;
}

export async function getBuild(buildId: string) {
  const [row] = await db.select().from(loopExchangeBuildsTable)
    .where(eq(loopExchangeBuildsTable.id, buildId)).limit(1);
  return row ?? null;
}

export async function listBuildsForLoop(loopId: string) {
  return db.select().from(loopExchangeBuildsTable)
    .where(eq(loopExchangeBuildsTable.loopId, loopId))
    .orderBy(desc(loopExchangeBuildsTable.createdAt));
}

export async function listLedgerForUser(userId: string, limit = 100) {
  return db.select().from(loopExchangeSplitLedgerTable)
    .where(eq(loopExchangeSplitLedgerTable.recipientUserId, userId))
    .orderBy(desc(loopExchangeSplitLedgerTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function listLoopsForPoster(userId: string) {
  return db.select().from(loopExchangeLoopsTable)
    .where(eq(loopExchangeLoopsTable.posterUserId, userId))
    .orderBy(desc(loopExchangeLoopsTable.createdAt));
}

export async function listBuildsForBuilder(userId: string) {
  return db.select().from(loopExchangeBuildsTable)
    .where(eq(loopExchangeBuildsTable.builderUserId, userId))
    .orderBy(desc(loopExchangeBuildsTable.createdAt));
}
