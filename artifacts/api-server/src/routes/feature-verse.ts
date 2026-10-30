import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  db,
  featureVerseListingsTable,
  featureVerseOrdersTable,
  featureVerseEscrowLedgerTable,
  type FeatureVerseSplit,
} from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../lib/credits";
import { isUniqueViolation, pgErrorText } from "../lib/pg-errors";

function isUnique(err: unknown): boolean {
  return isUniqueViolation(err) || /duplicate key|unique constraint/i.test(pgErrorText(err));
}
import {
  FeatureVerseError,
  FEATURE_VERSE_NOT_READY,
  FEATURE_VERSE_TERMS_NOTICE,
  bothSigned,
  canConfirmRelease,
  canDeliver,
  canDispute,
  canFund,
  escrowLedgerKey,
  featureVerseEscrowLabel,
  featureVerseStatusLabel,
  holdChargeKey,
  isExpired,
  isMissingFeatureVerseTable,
  refundOwed,
  signByFrom,
  termsFrozen,
  validateFeatureSplits,
  validateListingPrice,
} from "../lib/feature-verse";

const router = Router();

/* ─── Feature Verse Market (Stack-200 N7) ────────────────────────────────
   Buy a FEATURE (a verse / appearance) from a creator:
     listing (creator-set VB price) → order with WRITTEN track splits
     (publishing-splits validator) → BOTH parties sign → buyer funds
     the escrow hold (sponsors-escrow state machine on the credits
     rail) → creator delivers (gated on both signatures + held escrow)
     → buyer confirms → escrow releases to the creator.
   Exits: dispute (fee stays held) → full refund; decline / expiry
   before signing (no fee was ever taken); refund of a held fee is
   ALWAYS in full. Visual Bucs only, test mode — never real money. */

type ListingRow = typeof featureVerseListingsTable.$inferSelect;
type OrderRow = typeof featureVerseOrdersTable.$inferSelect;

function iso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function listingDTO(row: ListingRow, viewerId?: string) {
  return {
    id: row.id,
    creatorUserId: row.creatorUserId,
    creatorName: row.creatorName,
    priceVb: row.priceVb,
    title: row.title,
    description: row.description,
    turnaroundDays: row.turnaroundDays ?? null,
    active: row.active,
    isMine: viewerId ? row.creatorUserId === viewerId : false,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function orderDTO(row: OrderRow, viewerId: string) {
  const like = {
    status: row.status,
    escrowStatus: row.escrowStatus,
    buyerSignedAt: row.buyerSignedAt,
    creatorSignedAt: row.creatorSignedAt,
    signBy: row.signBy,
  };
  return {
    id: row.id,
    listingId: row.listingId,
    buyerUserId: row.buyerUserId,
    creatorUserId: row.creatorUserId,
    isBuyer: row.buyerUserId === viewerId,
    isCreator: row.creatorUserId === viewerId,
    priceVb: row.priceVb,
    trackContext: row.trackContext,
    usageTerms: row.usageTerms,
    deadlineAsk: row.deadlineAsk ?? null,
    splits: (row.splits as FeatureVerseSplit[]) ?? [],
    status: row.status,
    statusLabel: featureVerseStatusLabel(row.status),
    escrowStatus: row.escrowStatus,
    escrowLabel: featureVerseEscrowLabel(row.escrowStatus),
    buyerSignedAt: iso(row.buyerSignedAt),
    creatorSignedAt: iso(row.creatorSignedAt),
    bothSigned: bothSigned(like),
    termsFrozen: termsFrozen(like),
    canDeliver: canDeliver(like),
    signBy: iso(row.signBy),
    escrowHeldAt: iso(row.escrowHeldAt),
    deliveryNote: row.deliveryNote ?? null,
    deliveryUrl: row.deliveryUrl ?? null,
    deliveredAt: iso(row.deliveredAt),
    disputeReason: row.disputeReason ?? null,
    disputedAt: iso(row.disputedAt),
    releasedAt: iso(row.releasedAt),
    refundedAt: iso(row.refundedAt),
    termsNotice: FEATURE_VERSE_TERMS_NOTICE,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function fail(res: any, err: unknown, logTag: string) {
  if (err instanceof FeatureVerseError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (isMissingFeatureVerseTable(err)) {
    res.status(503).json(FEATURE_VERSE_NOT_READY);
    return;
  }
  logger.error({ err }, logTag);
  res.status(500).json({ error: "Something went wrong — try again." });
}

async function loadOrder(id: string): Promise<OrderRow | null> {
  const [row] = await db.select().from(featureVerseOrdersTable).where(eq(featureVerseOrdersTable.id, id)).limit(1);
  return row ?? null;
}

async function saveOrder(id: string, patch: Partial<typeof featureVerseOrdersTable.$inferInsert>): Promise<OrderRow> {
  const [row] = await db
    .update(featureVerseOrdersTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(featureVerseOrdersTable.id, id))
    .returning();
  return row!;
}

/** Ledger-first exactly-once: returns true when THIS call wrote the
 *  row (and so owns the money move), false when the move already
 *  happened (UNIQUE idempotency key — a retry never double-moves). */
async function writeLedger(orderId: string, kind: "hold" | "release" | "refund", amountVb: number): Promise<boolean> {
  try {
    await db.insert(featureVerseEscrowLedgerTable).values({
      orderId,
      kind,
      amountVb,
      idempotencyKey: escrowLedgerKey(orderId, kind),
    });
    return true;
  } catch (err) {
    if (isUnique(err)) return false;
    throw err;
  }
}

async function deleteLedger(orderId: string, kind: "hold" | "release" | "refund"): Promise<void> {
  await db
    .delete(featureVerseEscrowLedgerTable)
    .where(eq(featureVerseEscrowLedgerTable.idempotencyKey, escrowLedgerKey(orderId, kind)));
}

/** Full refund of a held fee to the buyer — the ONLY refund amount
 *  this lane ever pays. Ledger-first, exactly once. */
async function refundHeldFee(row: OrderRow, nextStatus: string): Promise<OrderRow> {
  if (!refundOwed(row)) {
    return saveOrder(row.id, { status: nextStatus, refundedAt: row.refundedAt ?? new Date() });
  }
  const fresh = await writeLedger(row.id, "refund", row.priceVb);
  if (fresh) {
    await refundCredits(row.buyerUserId, row.priceVb, { action: "Feature Verse — escrow refund (full)" });
  }
  return saveOrder(row.id, {
    status: nextStatus,
    escrowStatus: "refunded",
    refundedAt: new Date(),
  });
}

/** Lazy expiry: an unsigned order past its signing window closes
 *  honestly as expired_unaccepted. Funding requires both signatures,
 *  so an expiring order never holds a fee — refundHeldFee still runs
 *  so the "held fee ⇒ full refund" rule holds even if that changes. */
async function settleExpiry(row: OrderRow): Promise<OrderRow> {
  if (!isExpired(row)) return row;
  if (refundOwed(row)) return refundHeldFee(row, "expired_unaccepted");
  return saveOrder(row.id, { status: "expired_unaccepted" });
}

function participantOr404(row: OrderRow | null, userId: string): row is OrderRow {
  return !!row && (row.buyerUserId === userId || row.creatorUserId === userId);
}

/* ── Listings ─────────────────────────────────────────────────────────── */

const upsertListingSchema = z.object({
  priceVb: z.number(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  turnaroundDays: z.number().int().positive().max(365).nullable().optional(),
  active: z.boolean().optional(),
  creatorName: z.string().trim().min(1).max(80).optional(),
});

/* PUT /api/feature-verse/listings/mine — the creator sets their OWN
   price. No platform default exists to fall back to. */
router.put("/feature-verse/listings/mine", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = upsertListingSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid listing.", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  try {
    const priceVb = validateListingPrice(parsed.data.priceVb);
    const userId = req.userId!;
    const [existing] = await db
      .select()
      .from(featureVerseListingsTable)
      .where(eq(featureVerseListingsTable.creatorUserId, userId))
      .limit(1);
    const patch = {
      priceVb,
      title: parsed.data.title ?? existing?.title ?? "Feature verse",
      description: parsed.data.description ?? existing?.description ?? "",
      turnaroundDays: parsed.data.turnaroundDays !== undefined ? parsed.data.turnaroundDays : (existing?.turnaroundDays ?? null),
      active: parsed.data.active ?? existing?.active ?? true,
      creatorName: parsed.data.creatorName ?? existing?.creatorName ?? "Creator",
    };
    let row: ListingRow;
    if (existing) {
      const [updated] = await db
        .update(featureVerseListingsTable)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(featureVerseListingsTable.id, existing.id))
        .returning();
      row = updated!;
    } else {
      const [inserted] = await db
        .insert(featureVerseListingsTable)
        .values({ creatorUserId: userId, ...patch })
        .returning();
      row = inserted!;
    }
    res.json({ listing: listingDTO(row, userId) });
  } catch (err) {
    fail(res, err, "[feature-verse] listing upsert failed");
  }
});

router.get("/feature-verse/listings/mine", requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(featureVerseListingsTable)
      .where(eq(featureVerseListingsTable.creatorUserId, req.userId!))
      .limit(1);
    res.json({ listing: row ? listingDTO(row, req.userId!) : null });
  } catch (err) {
    fail(res, err, "[feature-verse] my listing failed");
  }
});

/* GET /api/feature-verse/listings — the market: ACTIVE listings only.
   A creator with no listing is simply not here, and not buyable. */
router.get("/feature-verse/listings", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(featureVerseListingsTable)
      .where(eq(featureVerseListingsTable.active, true))
      .orderBy(desc(featureVerseListingsTable.updatedAt))
      .limit(100);
    res.json({ listings: rows.map((r) => listingDTO(r, req.userId!)) });
  } catch (err) {
    fail(res, err, "[feature-verse] listings failed");
  }
});

/* GET /api/feature-verse/listings/by-creator/:userId — public: the
   profile surface asks "is this creator buyable?" Absent = no. */
router.get("/feature-verse/listings/by-creator/:userId", async (req, res) => {
  const { userId } = req.params as { userId: string };
  try {
    const [row] = await db
      .select()
      .from(featureVerseListingsTable)
      .where(and(eq(featureVerseListingsTable.creatorUserId, userId), eq(featureVerseListingsTable.active, true)))
      .limit(1);
    res.json({ listing: row ? listingDTO(row) : null });
  } catch (err) {
    fail(res, err, "[feature-verse] listing by creator failed");
  }
});

/* ── Orders ───────────────────────────────────────────────────────────── */

const splitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  userId: z.string().uuid().nullable().optional(),
  sharePct: z.number(),
});

const createOrderSchema = z.object({
  listingId: z.string().uuid(),
  trackContext: z.string().trim().min(1, "Describe the track this feature is for.").max(2000),
  usageTerms: z.string().trim().min(1, "Write the usage terms both sides will sign.").max(2000),
  deadlineAsk: z.string().trim().max(120).optional(),
  splits: z.array(splitSchema).min(1),
  idempotencyKey: z.string().trim().min(8).max(200),
});

router.post("/feature-verse/orders", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid feature order.", details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  const d = parsed.data;
  try {
    /* Idempotent create: a retried request returns the original order. */
    const [existing] = await db
      .select()
      .from(featureVerseOrdersTable)
      .where(eq(featureVerseOrdersTable.idempotencyKey, d.idempotencyKey))
      .limit(1);
    if (existing) {
      if (existing.buyerUserId !== req.userId) {
        res.status(409).json({ error: "That request key belongs to another order." });
        return;
      }
      res.status(200).json({ order: orderDTO(existing, req.userId!) });
      return;
    }
    const [listing] = await db
      .select()
      .from(featureVerseListingsTable)
      .where(eq(featureVerseListingsTable.id, d.listingId))
      .limit(1);
    if (!listing || !listing.active) {
      res.status(404).json({ error: "That creator has no active feature listing — they aren't buyable right now." });
      return;
    }
    if (listing.creatorUserId === req.userId) {
      res.status(400).json({ error: "You can't buy a feature from yourself." });
      return;
    }
    const splits = validateFeatureSplits(d.splits as FeatureVerseSplit[]);
    const [row] = await db
      .insert(featureVerseOrdersTable)
      .values({
        listingId: listing.id,
        buyerUserId: req.userId!,
        creatorUserId: listing.creatorUserId,
        priceVb: listing.priceVb,
        trackContext: d.trackContext,
        usageTerms: d.usageTerms,
        deadlineAsk: d.deadlineAsk ?? null,
        splits,
        status: "terms_proposed",
        escrowStatus: "none",
        signBy: signByFrom(),
        idempotencyKey: d.idempotencyKey,
      })
      .returning();
    res.status(201).json({ order: orderDTO(row!, req.userId!) });
  } catch (err) {
    if (isUnique(err)) {
      /* Lost a create race — the original order is the answer. */
      try {
        const [existing] = await db
          .select()
          .from(featureVerseOrdersTable)
          .where(eq(featureVerseOrdersTable.idempotencyKey, d.idempotencyKey))
          .limit(1);
        if (existing && existing.buyerUserId === req.userId) {
          res.status(200).json({ order: orderDTO(existing, req.userId!) });
          return;
        }
      } catch { /* fall through to the standard failure */ }
    }
    fail(res, err, "[feature-verse] order create failed");
  }
});

router.get("/feature-verse/orders", requireAuth, async (req, res) => {
  const scope = typeof req.query["scope"] === "string" ? req.query["scope"] : "all";
  if (scope !== "all" && scope !== "bought" && scope !== "sold") {
    res.status(400).json({ error: "scope must be all, bought, or sold." });
    return;
  }
  try {
    /* 'all' = both sides of MY orders only — the filter is in the
       query itself, never everyone's rows fetched and trimmed. */
    const where =
      scope === "bought"
        ? eq(featureVerseOrdersTable.buyerUserId, req.userId!)
        : scope === "sold"
          ? eq(featureVerseOrdersTable.creatorUserId, req.userId!)
          : or(
              eq(featureVerseOrdersTable.buyerUserId, req.userId!),
              eq(featureVerseOrdersTable.creatorUserId, req.userId!),
            );
    const rows = await db
      .select()
      .from(featureVerseOrdersTable)
      .where(where)
      .orderBy(desc(featureVerseOrdersTable.createdAt))
      .limit(100);
    const settled: OrderRow[] = [];
    for (const r of rows) settled.push(await settleExpiry(r));
    res.json({ orders: settled.map((r) => orderDTO(r, req.userId!)) });
  } catch (err) {
    fail(res, err, "[feature-verse] orders list failed");
  }
});

router.get("/feature-verse/orders/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    let row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    row = await settleExpiry(row!);
    res.json({ order: orderDTO(row, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] order get failed");
  }
});

/* ── Terms: amend (buyer, only before ANY signature) ──────────────────── */

const amendSchema = z.object({
  trackContext: z.string().trim().min(1).max(2000).optional(),
  usageTerms: z.string().trim().min(1).max(2000).optional(),
  deadlineAsk: z.string().trim().max(120).nullable().optional(),
  splits: z.array(splitSchema).min(1).optional(),
});

router.patch("/feature-verse/orders/:id/terms", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = amendSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid terms.", details: parsed.error.issues });
    return;
  }
  try {
    let row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    row = await settleExpiry(row!);
    if (row.buyerUserId !== req.userId) {
      res.status(403).json({ error: "Only the buyer who proposed these terms can amend them." });
      return;
    }
    if (row.status !== "terms_proposed" || termsFrozen(row)) {
      res.status(409).json({ error: "These terms are frozen — a signature already exists, and signed terms never change." });
      return;
    }
    const patch: Partial<typeof featureVerseOrdersTable.$inferInsert> = {};
    if (parsed.data.trackContext !== undefined) patch.trackContext = parsed.data.trackContext;
    if (parsed.data.usageTerms !== undefined) patch.usageTerms = parsed.data.usageTerms;
    if (parsed.data.deadlineAsk !== undefined) patch.deadlineAsk = parsed.data.deadlineAsk;
    if (parsed.data.splits !== undefined) patch.splits = validateFeatureSplits(parsed.data.splits as FeatureVerseSplit[]);
    const saved = await saveOrder(id, patch);
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] terms amend failed");
  }
});

/* ── Sign (one action per party, timestamped) ─────────────────────────── */

router.post("/feature-verse/orders/:id/sign", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    let row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    row = await settleExpiry(row!);
    if (row.status === "expired_unaccepted") {
      res.status(409).json({ error: "The signing window closed — this order expired unaccepted and no fee was taken." });
      return;
    }
    if (row.status !== "terms_proposed") {
      res.status(409).json({ error: `This order is ${row.status} — signing happens while terms are proposed.` });
      return;
    }
    const isBuyer = row.buyerUserId === req.userId;
    const already = isBuyer ? row.buyerSignedAt : row.creatorSignedAt;
    if (already) {
      /* Signing twice is a no-op success — your signature stands. */
      res.json({ order: orderDTO(row, req.userId!) });
      return;
    }
    const now = new Date();
    const patch: Partial<typeof featureVerseOrdersTable.$inferInsert> = isBuyer
      ? { buyerSignedAt: now }
      : { creatorSignedAt: now };
    const next = { ...row, ...patch };
    if (bothSigned(next)) patch.status = "signed";
    const saved = await saveOrder(id, patch);
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] sign failed");
  }
});

/* ── Decline (creator, before signing — no fee was ever taken) ────────── */

router.post("/feature-verse/orders/:id/decline", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    let row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    row = await settleExpiry(row!);
    if (row.creatorUserId !== req.userId) {
      res.status(403).json({ error: "Only the creator can decline this feature order." });
      return;
    }
    if (row.status !== "terms_proposed") {
      res.status(409).json({ error: `This order is ${row.status} — decline happens while terms are proposed.` });
      return;
    }
    /* No fee exists to refund: funding is gated on both signatures. */
    const saved = await saveOrder(id, { status: "declined" });
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] decline failed");
  }
});

/* ── Fund escrow (buyer, both signatures required, exactly once) ──────── */

router.post("/feature-verse/orders/:id/fund", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    let row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    row = await settleExpiry(row!);
    if (row.buyerUserId !== req.userId) {
      res.status(403).json({ error: "Only the buyer can fund this escrow." });
      return;
    }
    if (row.status === "escrow_held" && row.escrowStatus === "held") {
      res.json({ order: orderDTO(row, req.userId!) }); /* idempotent replay */
      return;
    }
    if (!canFund(row)) {
      res.status(409).json({
        error: bothSigned(row)
          ? `This order is ${row.status} — escrow can only be funded right after both parties sign.`
          : "Both parties must sign the written terms before any fee is held in escrow.",
      });
      return;
    }
    const wrote = await writeLedger(id, "hold", row.priceVb);
    try {
      await chargeCredits(row.buyerUserId, row.priceVb, { action: "Feature Verse — escrow hold" }, {
        idempotencyKey: holdChargeKey(id),
        personalOnly: true,
      });
    } catch (err) {
      if (wrote) await deleteLedger(id, "hold").catch(() => undefined);
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "Not enough Visual Bucs to hold this fee in escrow." });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "The escrow hold could not be recorded — no fee was kept." });
        return;
      }
      throw err;
    }
    const saved = await saveOrder(id, { status: "escrow_held", escrowStatus: "held", escrowHeldAt: new Date() });
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] fund failed");
  }
});

/* ── Deliver (creator — GATED on both signatures + held escrow) ────────── */

const deliverSchema = z.object({
  deliveryNote: z.string().trim().max(2000).optional(),
  deliveryUrl: z.string().trim().max(2048).regex(/^https?:\/\//, "must be an http(s) URL").optional(),
});

router.post("/feature-verse/orders/:id/deliver", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = deliverSchema.safeParse(req.body ?? {});
  if (!parsed.success || (!parsed.data?.deliveryNote && !parsed.data?.deliveryUrl)) {
    res.status(400).json({ error: "Add a delivery note or a link to the delivered feature." });
    return;
  }
  try {
    const row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    if (row!.creatorUserId !== req.userId) {
      res.status(403).json({ error: "Only the creator can deliver this feature." });
      return;
    }
    /* THE GATE: no both-signatures + held escrow, no delivery door. */
    if (!canDeliver(row!)) {
      res.status(409).json({
        error: !bothSigned(row!)
          ? "No delivery before both parties sign the written terms."
          : "No delivery until the fee is held in escrow.",
      });
      return;
    }
    const saved = await saveOrder(id, {
      status: "delivered",
      deliveryNote: parsed.data.deliveryNote ?? null,
      deliveryUrl: parsed.data.deliveryUrl ?? null,
      deliveredAt: new Date(),
    });
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] deliver failed");
  }
});

/* ── Confirm (buyer) → release escrow to the creator, exactly once ────── */

router.post("/feature-verse/orders/:id/confirm", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    if (row!.buyerUserId !== req.userId) {
      res.status(403).json({ error: "Only the buyer can confirm delivery and release the escrow." });
      return;
    }
    if (row!.status === "released" && row!.escrowStatus === "released") {
      res.json({ order: orderDTO(row!, req.userId!) }); /* idempotent replay */
      return;
    }
    if (!canConfirmRelease(row!)) {
      res.status(409).json({ error: `This order is ${row!.status} — escrow releases only after delivery, per the written terms.` });
      return;
    }
    const wrote = await writeLedger(id, "release", row!.priceVb);
    if (wrote) {
      await refundCredits(row!.creatorUserId, row!.priceVb, { action: "Feature Verse — escrow release" });
    }
    const saved = await saveOrder(id, { status: "released", escrowStatus: "released", releasedAt: new Date() });
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] confirm/release failed");
  }
});

/* ── Dispute (buyer, after delivery — fee stays held) ─────────────────── */

const disputeSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

router.post("/feature-verse/orders/:id/dispute", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = disputeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Say what went wrong with the delivery." });
    return;
  }
  try {
    const row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    if (row!.buyerUserId !== req.userId) {
      res.status(403).json({ error: "Only the buyer can dispute a delivery." });
      return;
    }
    if (!canDispute(row!)) {
      res.status(409).json({ error: `This order is ${row!.status} — only a delivered order with the fee still held can be disputed.` });
      return;
    }
    const saved = await saveOrder(id, {
      status: "disputed",
      disputeReason: parsed.data.reason,
      disputedAt: new Date(),
    });
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] dispute failed");
  }
});

/* ── Refund (either party, while a fee is held — ALWAYS in full) ──────── */

router.post("/feature-verse/orders/:id/refund", requireAuth, publicApiLimiter, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await loadOrder(id);
    if (!participantOr404(row, req.userId!)) {
      res.status(404).json({ error: "Feature order not found" });
      return;
    }
    if (row!.status === "refunded" && row!.escrowStatus === "refunded") {
      res.json({ order: orderDTO(row!, req.userId!) }); /* idempotent replay */
      return;
    }
    if (!refundOwed(row!) || !["escrow_held", "delivered", "disputed"].includes(row!.status)) {
      res.status(409).json({ error: `This order is ${row!.status} with escrow ${row!.escrowStatus} — there is no held fee to refund.` });
      return;
    }
    const saved = await refundHeldFee(row!, "refunded");
    res.json({ order: orderDTO(saved, req.userId!) });
  } catch (err) {
    fail(res, err, "[feature-verse] refund failed");
  }
});

export default router;
