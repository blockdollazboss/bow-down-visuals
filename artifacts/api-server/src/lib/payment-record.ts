import { db } from "@workspace/db";
import { stripePaymentsTable, creditUsageTable } from "@workspace/db";
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
 * Fetch all credit usage records for a user, newest first.
 */
export async function getCreditUsage(userId: string) {
  return db
    .select()
    .from(creditUsageTable)
    .where(eq(creditUsageTable.userId, userId))
    .orderBy(desc(creditUsageTable.createdAt));
}
