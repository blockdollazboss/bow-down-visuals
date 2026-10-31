/**
 * escrow-held.ts — how much of an escrowed charge does the platform
 * still HOLD right now? (money-hardening round 2, area 1)
 *
 * The defect this answers: the two real-money escrows (sponsor deals,
 * performance bookings) released their FULL agreed amount whenever
 * their state read funded/completed — but a partial refund against
 * the funding charge leaves the escrow state 'funded' BY DESIGN (the
 * reversal engine keeps entitlements on partials; only a FULL
 * reversal un-funds). Release never asked how much of the charge had
 * already gone back, so released + refunded could exceed charged:
 * the payout ledger promised the creator money the platform no
 * longer held.
 *
 * The invariant, checked at the moment of release (the only moment
 * it can be enforced — refunds are asynchronous):
 *
 *     held = charged − refunded        (a lost dispute ⇒ held = 0)
 *     release splits HELD, never the stale agreed figure, so
 *     released + refunded = charged, exactly.
 *
 * Two sources, unioned (a refund counts if EITHER has seen it):
 *   1. Stripe, live — the primary source: the funding charge's
 *      amount_refunded. Catches a refund whose webhook hasn't landed
 *      yet (a dashboard refund seconds before the release click).
 *      A failure to read Stripe THROWS: the caller fails closed —
 *      releasing on a guess is the defect being fixed.
 *   2. Our reversal ledger (payment_reversals, keyed by payment
 *      intent) — carries what Stripe's charge object does not show:
 *      a LOST DISPUTE (the bank debits the full amount without
 *      touching amount_refunded). This leg is guarded the way the
 *      reversal engine guards its own probes: a database the
 *      reversals migration hasn't reached degrades to "no record"
 *      with a loud log, never a throw — the Stripe leg still stands.
 *
 * Sandbox (no Stripe client, or no payment intent — sandbox funding
 * records none): no refund can exist against money that never moved,
 * so the full gross is held.
 */
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export interface EscrowHeld {
  /** Cents the platform still holds and may release (0..gross). */
  heldCents: number;
  /** Cents of the charge already returned to the payer, per the union of both sources. */
  refundedCents: number;
  /** A lost dispute was found on the reversal ledger — the bank took the full amount. */
  disputeLost: boolean;
}

export async function escrowHeldCents(args: {
  stripe: Stripe | null;
  paymentIntentId: string | null;
  grossCents: number;
}): Promise<EscrowHeld> {
  const { stripe, paymentIntentId, grossCents } = args;
  let refunded = 0;
  let disputeLost = false;
  let capturedCap: number | null = null;

  if (paymentIntentId) {
    /* Ledger leg — disputes live here; refunded_cents_seen is the
       charge's cumulative refunded figure at each event, so the MAX
       across the charge's rows is its current refunded total. */
    try {
      const rows = await db.execute(sql`
        SELECT refunded_cents_seen, dispute_lost
        FROM payment_reversals
        WHERE stripe_payment_intent_id = ${paymentIntentId}
      `);
      for (const row of rows.rows as Array<Record<string, unknown>>) {
        refunded = Math.max(refunded, Number(row["refunded_cents_seen"] ?? 0));
        if (row["dispute_lost"] === true) disputeLost = true;
      }
    } catch (err) {
      logger.error(
        { err, paymentIntentId },
        "escrow-held: reversal-ledger read failed — degrading to the Stripe read alone (a lost dispute would be missed; reconcile manually)",
      );
    }

    /* Stripe leg — the primary source for refunds. Throws on failure
       by design: the caller must fail closed, not release blind. */
    if (stripe) {
      const charges = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 10 });
      let best: Stripe.Charge | null = null;
      for (const charge of charges.data) {
        const captured = charge.amount_captured ?? 0;
        if (!best || captured > (best.amount_captured ?? 0)) best = charge;
      }
      if (best) {
        refunded = Math.max(refunded, best.amount_refunded ?? 0);
        capturedCap = Math.max(0, (best.amount_captured ?? best.amount ?? 0) - refunded);
      }
    }
  }

  if (disputeLost) {
    return { heldCents: 0, refundedCents: refunded, disputeLost };
  }
  let held = Math.max(0, Math.min(grossCents, grossCents - refunded));
  if (capturedCap !== null) held = Math.min(held, capturedCap);
  return { heldCents: held, refundedCents: refunded, disputeLost };
}
