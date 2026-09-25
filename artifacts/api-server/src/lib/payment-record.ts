import { db } from "@workspace/db";
import { stripePaymentsTable, creditUsageTable, generationHistoryTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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
}

/**
 * Check if a Stripe session has already been processed.
 * Returns true if the session ID already exists in stripe_payments.
 */
export async function isPaymentAlreadyRecorded(stripeSessionId: string): Promise<boolean> {
  const rows = await db
    .select({ id: stripePaymentsTable.id })
    .from(stripePaymentsTable)
    .where(eq(stripePaymentsTable.stripeSessionId, stripeSessionId))
    .limit(1);

  return rows.length > 0;
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
 */
export async function getPaymentHistory(userId: string) {
  return db
    .select()
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
 */
export async function getCreditUsage(userId: string) {
  return db
    .select()
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
