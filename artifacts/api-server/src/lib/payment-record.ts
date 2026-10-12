import { db } from "@workspace/db";
import { stripePaymentsTable, creditUsageTable, generationHistoryTable } from "@workspace/db";
import { eq, desc, and, or, lt } from "drizzle-orm";
import { logger } from "./logger";

export interface PaymentRecord {
  stripeSessionId: string;
  stripePaymentIntentId?: string | null;
  userId: string;
  creditPack?: string;
  creditsAmount: number;
  amountTotal?: number | null;
  currency?: string | null;
}

export interface CreditUsageRecord {
  userId: string;
  action: string;
  creditsUsed: number;
  projectId?: string | null;
  /** When the spend came from a team pool, the team that was charged. */
  teamId?: string | null;
  /** Idempotency key for duplicate-suppression (P0-23). */
  idempotencyKey?: string | null;
}

/**
 * Check if a Stripe session has already been processed.
 * Returns true if the session ID already exists in stripe_payments.
 *
 * @deprecated Prefer claimStripePayment() for new code — check-then-act
 * has a race. This remains for read-only status checks.
 */
export async function isPaymentAlreadyRecorded(stripeSessionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: stripePaymentsTable.id })
    .from(stripePaymentsTable)
    .where(eq(stripePaymentsTable.stripeSessionId, stripeSessionId))
    .limit(1);

  return rows.length > 0;
}

/* ── Insert-first payment claiming (money-integrity) ─────────────────────
   Eliminates the check-then-insert double-grant race: the UNIQUE constraint
   on stripe_session_id is the arbiter, not a preceding SELECT.

   Outcomes:
   - "claimed"   — this call won the insert (or reclaimed a stale/failed row);
                   the caller MUST now grant credits, then markPaymentCompleted().
   - "duplicate" — a completed payment already exists; skip granting.
   - "inflight"  — another worker is actively processing; do NOT grant.
                   Webhooks should 500 (Stripe retries); sync endpoints 409.

   A "processing" row older than STALE_MS is treated as crashed and is
   atomically reclaimed via UPDATE ... WHERE status IN ('failed') OR
   (status='processing' AND created_at < cutoff). The UPDATE is atomic —
   only one concurrent claimant wins. */

export type PaymentClaimOutcome = "claimed" | "duplicate" | "inflight";

const CLAIM_STALE_MS = 5 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "23505";
}

export async function claimStripePayment(payment: PaymentRecord): Promise<PaymentClaimOutcome> {
  // Insert-first: try to become the owner of this payment.
  try {
    await db.insert(stripePaymentsTable).values({
      stripeSessionId:      payment.stripeSessionId,
      stripePaymentIntentId: payment.stripePaymentIntentId ?? null,
      userId:               payment.userId,
      creditPack:           payment.creditPack ?? null,
      creditsAmount:        payment.creditsAmount,
      amountTotal:          payment.amountTotal ?? null,
      currency:             payment.currency ?? null,
      status:               "processing",
    });
    logger.info({ stripeSessionId: payment.stripeSessionId }, "claimStripePayment: claimed (inserted as processing)");
    return "claimed";
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    logger.info({ stripeSessionId: payment.stripeSessionId }, "claimStripePayment: row exists, checking status");
  }

  const [row] = await db
    .select({ status: stripePaymentsTable.status, createdAt: stripePaymentsTable.createdAt })
    .from(stripePaymentsTable)
    .where(eq(stripePaymentsTable.stripeSessionId, payment.stripeSessionId))
    .limit(1);
  if (!row) {
    // Vanished between unique-violation and select — extremely unlikely;
    // treat as inflight so the caller retries rather than double-granting.
    logger.warn({ stripeSessionId: payment.stripeSessionId }, "claimStripePayment: row vanished after conflict — treating as inflight");
    return "inflight";
  }
  if (row.status === "completed") {
    logger.info({ stripeSessionId: payment.stripeSessionId }, "claimStripePayment: duplicate — already completed");
    return "duplicate";
  }

  // processing or failed: atomically reclaim if failed or stale.
  const cutoff = new Date(Date.now() - CLAIM_STALE_MS);
  const reclaimed = await db
    .update(stripePaymentsTable)
    .set({ status: "processing" })
    .where(
      and(
        eq(stripePaymentsTable.stripeSessionId, payment.stripeSessionId),
        or(
          eq(stripePaymentsTable.status, "failed"),
          and(eq(stripePaymentsTable.status, "processing"), lt(stripePaymentsTable.createdAt, cutoff)),
        ),
      ),
    )
    .returning({ id: stripePaymentsTable.id });

  if (reclaimed.length > 0) {
    logger.info({ stripeSessionId: payment.stripeSessionId, prevStatus: row.status }, "claimStripePayment: reclaimed stale/failed row");
    return "claimed";
  }
  logger.info({ stripeSessionId: payment.stripeSessionId }, "claimStripePayment: another worker is actively processing");
  return "inflight";
}

/** Mark a claimed payment completed after credits were granted. */
export async function markPaymentCompleted(stripeSessionId: string): Promise<void> {
  await db
    .update(stripePaymentsTable)
    .set({ status: "completed" })
    .where(eq(stripePaymentsTable.stripeSessionId, stripeSessionId));
}

/** Mark a claimed payment failed after the grant failed. A later retry may reclaim it. */
export async function markPaymentFailed(stripeSessionId: string): Promise<void> {
  await db
    .update(stripePaymentsTable)
    .set({ status: "failed" })
    .where(eq(stripePaymentsTable.stripeSessionId, stripeSessionId));
}

/**
 * Insert a new row into stripe_payments to mark a session as processed.
 * Throws if the insert fails.
 */
export async function recordStripePayment(payment: PaymentRecord): Promise<void> {
  logger.info(
    { stripeSessionId: payment.stripeSessionId, userId: payment.userId, creditsAmount: payment.creditsAmount },
    "recordStripePayment: inserting payment record"
  );

  await db.insert(stripePaymentsTable).values({
    stripeSessionId:      payment.stripeSessionId,
    stripePaymentIntentId: payment.stripePaymentIntentId ?? null,
    userId:               payment.userId,
    creditPack:           payment.creditPack ?? null,
    creditsAmount:        payment.creditsAmount,
    amountTotal:          payment.amountTotal ?? null,
    currency:             payment.currency ?? null,
    status:               "completed",
  });

  logger.info({ stripeSessionId: payment.stripeSessionId }, "recordStripePayment: new payment recorded");
}

/**
 * Fetch all payment records for a user, newest first.
 *
 * Selects explicit columns (not `select()`) on purpose: the drizzle schema
 * is the NEWEST schema, but a deployed database can lag behind it (e.g. a
 * `drizzle-kit push` that hasn't run yet). Selecting every column makes the
 * whole endpoint 500 if any single newer column is missing; the explicit
 * list below contains only long-stable columns, so history keeps loading
 * while migrations catch up.
 */
export async function getPaymentHistory(userId: string) {
  return db
    .select({
      id: stripePaymentsTable.id,
      createdAt: stripePaymentsTable.createdAt,
      creditPack: stripePaymentsTable.creditPack,
      creditsAmount: stripePaymentsTable.creditsAmount,
      amountTotal: stripePaymentsTable.amountTotal,
      currency: stripePaymentsTable.currency,
      status: stripePaymentsTable.status,
    })
    .from(stripePaymentsTable)
    .where(eq(stripePaymentsTable.userId, userId))
    .orderBy(desc(stripePaymentsTable.createdAt));
}

/**
 * Record a credit spend event. Fire-and-forget safe — never throws.
 */
export async function recordCreditUsage(record: CreditUsageRecord): Promise<void> {
  try {
    await db.insert(creditUsageTable).values({
      userId:      record.userId,
      action:      record.action,
      creditsUsed: record.creditsUsed,
      projectId:   record.projectId ?? null,
    });
  } catch (err) {
    logger.warn({ err, ...record }, "recordCreditUsage: failed to insert (non-fatal)");
  }
}

/**
 * Record a credit ledger event, THROWING on failure.
 *
 * This is the money-integrity path: charge sites must use this (via
 * chargeCredits() in lib/credits.ts) so a failed ledger insert can never
 * silently leave a balance deduction without a ledger trace. Retries
 * transient failures 3 times with brief backoff before giving up.
 */
export async function recordCreditUsageStrict(record: CreditUsageRecord): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db.insert(creditUsageTable).values({
        userId:      record.userId,
        action:      record.action,
        creditsUsed: record.creditsUsed,
        projectId:   record.projectId ?? null,
        teamId:      record.teamId ?? null,
        idempotencyKey: record.idempotencyKey ?? null,
      });
      return;
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt, ...record }, "recordCreditUsageStrict: insert failed, retrying");
      if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`recordCreditUsageStrict: insert failed: ${String(lastErr)}`);
}

/**
 * Fetch all credit usage records for a user, newest first.
 *
 * Selects explicit columns (not `select()`) on purpose: newer columns such
 * as `team_id` (teams) and `idempotency_key` may not exist yet on a deployed
 * database whose schema push is behind, and a single missing column would
 * 500 the entire history page. The UI only needs the stable columns below.
 */
export async function getCreditUsage(userId: string) {
  return db
    .select({
      id: creditUsageTable.id,
      createdAt: creditUsageTable.createdAt,
      action: creditUsageTable.action,
      creditsUsed: creditUsageTable.creditsUsed,
      projectId: creditUsageTable.projectId,
    })
    .from(creditUsageTable)
    .where(eq(creditUsageTable.userId, userId))
    .orderBy(desc(creditUsageTable.createdAt));
}

/* ── Generation History ── */

export interface GenerationHistoryInput {
  userId: string;
  generationType: string;
  prompt?: string;
  content: string;
  artistName?: string;
  songTitle?: string;
  creditsUsed: number;
}

/**
 * Insert a generation_history row BEFORE credits are charged.
 * Status is "pending" until markGenerationHistoryCharged() is called.
 * THROWS on failure so the caller can abort without charging credits.
 */
export async function recordGenerationHistory(input: GenerationHistoryInput): Promise<string> {
  const rows = await db
    .insert(generationHistoryTable)
    .values({
      userId:         input.userId,
      generationType: input.generationType,
      prompt:         input.prompt ?? null,
      result: {
        content:    input.content,
        artistName: input.artistName,
        songTitle:  input.songTitle,
      },
      creditsUsed: input.creditsUsed,
      saveStatus:  "pending",
      refunded:    false,
    })
    .returning({ id: generationHistoryTable.id });

  const id = rows[0]?.id;
  if (!id) throw new Error("recordGenerationHistory: insert returned no id");
  logger.info({ id, userId: input.userId }, "recordGenerationHistory: saved before credit charge");
  return id;
}

/**
 * Update a generation_history row from "pending" → "charged" after credits are deducted.
 * Fire-and-forget safe — never throws.
 */
export async function markGenerationHistoryCharged(id: string): Promise<void> {
  try {
    await db
      .update(generationHistoryTable)
      .set({ saveStatus: "charged" })
      .where(eq(generationHistoryTable.id, id));
  } catch (err) {
    logger.warn({ err, id }, "markGenerationHistoryCharged: failed (non-fatal)");
  }
}

/**
 * Mark a generation_history row as saved to a project.
 */
export async function markGenerationHistorySaved(id: string, projectId: string): Promise<void> {
  try {
    await db
      .update(generationHistoryTable)
      .set({ saveStatus: "saved", projectId })
      .where(eq(generationHistoryTable.id, id));
  } catch (err) {
    logger.warn({ err, id, projectId }, "markGenerationHistorySaved: failed (non-fatal)");
  }
}

/**
 * Mark a generation_history row as save-failed + refunded.
 * Returns the credits_used amount that was refunded, or 0 if already refunded / not found.
 */
export async function markGenerationHistoryRefunded(id: string): Promise<number> {
  try {
    const rows = await db
      .select({ creditsUsed: generationHistoryTable.creditsUsed, refunded: generationHistoryTable.refunded })
      .from(generationHistoryTable)
      .where(eq(generationHistoryTable.id, id))
      .limit(1);
    const row = rows[0];
    if (!row || row.refunded || !row.creditsUsed) return 0;
    await db
      .update(generationHistoryTable)
      .set({ saveStatus: "save_failed", refunded: true })
      .where(eq(generationHistoryTable.id, id));
    return row.creditsUsed;
  } catch (err) {
    logger.warn({ err, id }, "markGenerationHistoryRefunded: failed (non-fatal)");
    return 0;
  }
}

export interface RunwayClipHistoryInput {
  userId:       string;
  projectId?:   string | null;
  sceneId?:     string | null;
  prompt?:      string | null;
  videoUrl:     string;
  thumbnailUrl?: string | null;
  creditsUsed:  number;
  title?:       string | null;
}

/**
 * Insert a generation_history row for a completed Runway video clip.
 * Status is "saved" immediately — credits were already charged by the time
 * the clip is being saved. Fire-and-forget safe — never throws.
 */
export async function recordRunwayClipHistory(input: RunwayClipHistoryInput): Promise<void> {
  try {
    await db
      .insert(generationHistoryTable)
      .values({
        userId:         input.userId,
        projectId:      input.projectId ?? null,
        generationType: "runway_video_clip",
        prompt:         input.prompt ?? null,
        result: {
          content:      input.videoUrl,
          videoUrl:     input.videoUrl,
          thumbnailUrl: input.thumbnailUrl ?? undefined,
          sceneId:      input.sceneId ?? undefined,
          actionLabel:  input.title ? `Runway Clip — ${input.title}` : "Runway Video Clip",
        },
        creditsUsed: input.creditsUsed,
        saveStatus:  "saved",
        refunded:    false,
      });
    logger.info({ userId: input.userId, projectId: input.projectId }, "recordRunwayClipHistory: saved");
  } catch (err) {
    logger.warn({ err }, "recordRunwayClipHistory: failed (non-fatal)");
  }
}

export interface LipSyncHistoryInput {
  userId:      string;
  projectId?:  string | null;
  sceneId?:    string | null;
  videoUrl:    string;
  creditsUsed: number;
}

/**
 * Insert a generation_history row for a completed lip sync clip.
 * Status is "saved" immediately — lip sync doesn't charge per-generation
 * credits the way songs/thumbnails do, so there's nothing to reconcile later.
 * Fire-and-forget safe — never throws.
 */
export async function recordLipSyncHistory(input: LipSyncHistoryInput): Promise<void> {
  try {
    await db
      .insert(generationHistoryTable)
      .values({
        userId:         input.userId,
        projectId:      input.projectId ?? null,
        generationType: "lip_sync_clip",
        result: {
          content:     input.videoUrl,
          videoUrl:    input.videoUrl,
          sceneId:     input.sceneId ?? undefined,
          actionLabel: "Lip Sync Clip",
        },
        creditsUsed: input.creditsUsed,
        saveStatus:  "saved",
        refunded:    false,
      });
    logger.info({ userId: input.userId, projectId: input.projectId }, "recordLipSyncHistory: saved");
  } catch (err) {
    logger.warn({ err }, "recordLipSyncHistory: failed (non-fatal)");
  }
}

export interface ThumbnailHistoryInput {
  userId:           string;
  prompt?:          string | null;
  content:          string;
  thumbnailUrl:     string;
  artistName?:      string | null;
  songTitle?:       string | null;
  creditsUsed:      number;
}

/**
 * Insert a generation_history row for a completed AI thumbnail image.
 * Status is "saved" immediately — credits were already charged by the time
 * the image finishes generating. Fire-and-forget safe — never throws.
 */
export async function recordThumbnailHistory(input: ThumbnailHistoryInput): Promise<void> {
  try {
    await db
      .insert(generationHistoryTable)
      .values({
        userId:         input.userId,
        generationType: "thumbnail",
        prompt:         input.prompt ?? null,
        result: {
          content:      input.content,
          thumbnailUrl: input.thumbnailUrl,
          artistName:   input.artistName ?? undefined,
          songTitle:    input.songTitle ?? undefined,
          actionLabel:  input.songTitle ? `Thumbnail — ${input.songTitle}` : "Thumbnail Maker",
        },
        creditsUsed: input.creditsUsed,
        saveStatus:  "saved",
        refunded:    false,
      });
    logger.info({ userId: input.userId }, "recordThumbnailHistory: saved");
  } catch (err) {
    logger.warn({ err }, "recordThumbnailHistory: failed (non-fatal)");
  }
}

export interface CanvasHistoryInput {
  userId:      string;
  videoUrl:    string;
  creditsUsed: number;
  title?:       string | null;
  style?:       string | null;
}

/**
 * Insert a generation_history row for a completed Spotify Canvas.
 * Status is "saved" immediately — credits were already charged by the time
 * the canvas finishes rendering. Fire-and-forget safe — never throws.
 */
export async function recordCanvasHistory(input: CanvasHistoryInput): Promise<void> {
  try {
    await db
      .insert(generationHistoryTable)
      .values({
        userId:         input.userId,
        generationType: "spotify_canvas",
        result: {
          content:      input.videoUrl,
          videoUrl:     input.videoUrl,
          actionLabel:  input.title
            ? `Canvas — ${input.title}${input.style ? ` [${input.style}]` : ""}`
            : "Spotify Canvas",
        },
        creditsUsed: input.creditsUsed,
        saveStatus:  "saved",
        refunded:    false,
      });
    logger.info({ userId: input.userId }, "recordCanvasHistory: saved");
  } catch (err) {
    logger.warn({ err }, "recordCanvasHistory: failed (non-fatal)");
  }
}

/**
 * Fetch generation history for a user, newest first.
 */
export async function getGenerationHistory(userId: string) {
  return db
    .select()
    .from(generationHistoryTable)
    .where(eq(generationHistoryTable.userId, userId))
    .orderBy(desc(generationHistoryTable.createdAt));
}

/* ── Shared credit-purchase fulfillment (money-integrity) ────────────────
   Single choke point for granting purchased credits, used by the Stripe
   webhook (checkout + express PaymentIntent), /checkout/verify, and
   /payments/express/verify. Guarantees:
   - Insert-first claiming: only the claim winner grants (no double-grant).
   - Atomic credit increment (no lost updates on concurrent grants).
   - Record-before-grant: the payment row exists before credits move, so a
     crash between grant and record cannot double-credit on redelivery.
   - 500-worthy failures throw: callers return 500 so Stripe retries. */

export interface CreditPurchase {
  /** Idempotency key: Stripe checkout session id OR payment intent id. */
  idempotencyKey: string;
  stripePaymentIntentId?: string | null;
  userId: string;
  creditPack: string;
  creditsAmount: number;
  amountTotal?: number | null;
  currency?: string | null;
}

export type FulfillOutcome =
  | { outcome: "granted"; newCredits: number }
  | { outcome: "duplicate" }
  | { outcome: "inflight" };

export async function fulfillCreditPurchase(p: CreditPurchase): Promise<FulfillOutcome> {
  const claim = await claimStripePayment({
    stripeSessionId: p.idempotencyKey,
    stripePaymentIntentId: p.stripePaymentIntentId ?? null,
    userId: p.userId,
    creditPack: p.creditPack,
    creditsAmount: p.creditsAmount,
    amountTotal: p.amountTotal ?? null,
    currency: p.currency ?? null,
  });

  if (claim === "duplicate") return { outcome: "duplicate" };
  if (claim === "inflight") return { outcome: "inflight" };

  // We won the claim — grant atomically, then mark completed.
  // Dynamic import avoids a hard dependency cycle (supabase-admin is leaf).
  const { addCreditsAtomic } = await import("./supabase-admin");
  try {
    const { newCredits } = await addCreditsAtomic(p.userId, p.creditsAmount);
    await markPaymentCompleted(p.idempotencyKey);
    logger.info(
      { idempotencyKey: p.idempotencyKey, userId: p.userId, creditsAmount: p.creditsAmount, newCredits },
      "fulfillCreditPurchase: credits granted",
    );
    return { outcome: "granted", newCredits };
  } catch (err) {
    await markPaymentFailed(p.idempotencyKey);
    logger.error({ err, idempotencyKey: p.idempotencyKey, userId: p.userId }, "fulfillCreditPurchase: grant failed, marked for retry");
    throw err;
  }
}
