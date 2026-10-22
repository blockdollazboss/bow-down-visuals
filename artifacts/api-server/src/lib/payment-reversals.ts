/**
 * payment-reversals.ts — refund / chargeback clawback engine (defect D1).
 *
 * Before this module the central webhook had no charge.refunded /
 * charge.dispute.closed handler: a pack refunded from the Stripe
 * dashboard kept its Visual Bucs, a refunded membership kept its
 * entitlement, refunded beats/digital/shop purchases kept access —
 * the platform ate the loss and the goods stayed.
 *
 * The engine reverses WHAT THE ORIGINAL PAYMENT GRANTED, keyed off
 * the existing payment/grant records — never guessed:
 *   1. stripe_payments, looked up by the charge's payment intent
 *      (credit packs + express packs live there; branding orders too,
 *      claimed with credit_pack 'branding_order:<id>').
 *   2. The checkout session for the payment intent (Stripe API list),
 *      then the per-rail grant rows keyed on the session id —
 *      fan_members, beat_licenses, digital_sales, shop_events,
 *      store_orders, live_shop_sales, tip_jar_tips, shoutout_requests,
 *      sponsor_deals — the same id every rail's verify path keys on.
 *
 * Discipline, mirroring the grant side (payment-record.ts):
 *   - Insert-first claiming on payment_reversals (UNIQUE charge id)
 *     BEFORE any money moves; a completed row with no new work is a
 *     duplicate; a failed/stale row is reclaimed atomically; a fresh
 *     in-flight row answers 'inflight' so the webhook 500s and Stripe
 *     retries after it settles. "No new work" is checked per leg —
 *     pack credits, entitlement, dispute flag, AND the referral
 *     share (referral_credits_clawed vs the award's target): a row
 *     whose pack leg finished but whose referral leg did not is
 *     reclaimed, never answered 'duplicate' (defect D7's live state).
 *     A webhook replay can never double-claw: credits_clawed and
 *     referral_credits_clawed are cumulative and every step computes
 *     only its delta.
 *   - VB claws back pro-rata on partial refunds (the divisible rail);
 *     entitlements and seller ledgers reverse only on a FULL refund
 *     or a lost dispute (a partial refund leaves the buyer partially
 *     paid-up; the audit row records that the entitlement was kept).
 *   - A balance that can't cover the claw is debited down to zero —
 *     NEVER negative — and the unrecoverable remainder lands in
 *     shortfall_credits on the audit row.
 *   - Charges that identify to a rail a machine must not reverse on
 *     its own (branding orders already at the printer, subscription
 *     charges, released sponsor escrow) — and charges no record
 *     identifies at all — write a 'needs_manual_review' audit row and
 *     log loudly. The webhook answers 200 for those: a Stripe retry
 *     cannot fix what a human must decide.
 *   - Failures mid-reversal mark the row 'failed' and throw, so the
 *     webhook 500s and Stripe retries into the reclaim path.
 */
import type Stripe from "stripe";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-admin";

/* ── Shapes ──────────────────────────────────────────────────────────── */

export interface ReversalCharge {
  id: string;
  paymentIntentId: string | null;
  /** Total captured on the charge, cents. */
  amountCents: number;
  /** Cumulative refunded on the charge, cents (event snapshot). */
  refundedCents: number;
  currency: string | null;
}

export type ReversalOutcome =
  | { outcome: "reversed"; rail: string; creditsClawed: number; shortfallCredits: number }
  | { outcome: "duplicate" }
  | { outcome: "inflight" }
  | { outcome: "manual_review"; rail: string };

interface IdentifiedRail {
  rail: string;
  /** The member the reversal acts on (buyer; seller where a rail has no buyer id). */
  userId: string | null;
  sessionId: string | null;
  grantedCredits: number;
  /** Identified, but a human must reverse it — never auto-clawed. */
  manual?: string;
  details: Record<string, unknown>;
}

const CLAIM_STALE_MS = 5 * 60 * 1000;

function isUniqueViolation(err: unknown): boolean {
  /* drizzle wraps driver errors: the pg code rides on .cause. */
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

type Row = Record<string, unknown>;
const firstRow = (r: { rows: unknown[] }): Row | undefined => r.rows[0] as Row | undefined;

/* ── Identification — grant records only, never a guess ─────────────── */

async function identifyRail(
  charge: ReversalCharge,
  stripe: Stripe,
): Promise<IdentifiedRail | null> {
  const pi = charge.paymentIntentId;

  /* 1) stripe_payments by payment intent — packs (checkout + express)
        and branding orders are claimed there at grant time. */
  if (pi) {
    const r = await db.execute(sql`
      SELECT stripe_session_id, user_id, credit_pack, credits_amount
      FROM stripe_payments
      WHERE stripe_payment_intent_id = ${pi}
      LIMIT 1
    `);
    const row = firstRow(r);
    if (row) {
      const creditPack = (row["credit_pack"] as string | null) ?? "";
      const creditsAmount = Number(row["credits_amount"] ?? 0);
      if (creditsAmount > 0) {
        return {
          rail: "credit_pack",
          userId: String(row["user_id"]),
          sessionId: String(row["stripe_session_id"]),
          grantedCredits: creditsAmount,
          details: { creditPack, paymentRecord: "stripe_payments" },
        };
      }
      if (creditPack.startsWith("branding_order:")) {
        return {
          rail: "branding_order",
          userId: String(row["user_id"]),
          sessionId: String(row["stripe_session_id"]),
          grantedCredits: 0,
          manual:
            "Branding-shop order: the payment is identified, but the order may already be printed/shipped — a human decides the goods side.",
          details: { brandingOrderId: creditPack.slice("branding_order:".length) },
        };
      }
      return {
        rail: "unidentified",
        userId: String(row["user_id"]),
        sessionId: String(row["stripe_session_id"]),
        grantedCredits: 0,
        manual: `stripe_payments row exists but carries no reversible grant (credit_pack=${creditPack || "null"}).`,
        details: { creditPack },
      };
    }
  }

  /* 2) The checkout session for this payment intent, then the grant
        rows every rail keys on the session id. */
  if (!pi) return null;
  const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
  const session = sessions.data[0];
  if (!session) return null;
  const sid = session.id;
  const meta = session.metadata ?? {};

  if (meta["kind"] === "creator_tier" || meta["kind"] === "creator_hosting") {
    return {
      rail: "subscription",
      userId: (meta["user_id"] as string | undefined) ?? null,
      sessionId: sid,
      grantedCredits: 0,
      manual:
        "Subscription charge (creator tier / hosting): refunds interact with the subscription lifecycle, which the tier-sync already mirrors from subscription events — a human confirms the entitlement end.",
      details: {
        kind: meta["kind"],
        subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
      },
    };
  }

  if (meta["sponsor_deal_id"]) {
    const deal = await identifySponsorDeal(String(meta["sponsor_deal_id"]), sid);
    if (deal) return deal;
  }

  const probes: Array<() => Promise<IdentifiedRail | null>> = [
    async () => {
      const r = await db.execute(sql`
        SELECT id, user_id, fan_user_id, status, settled_payout_id
        FROM fan_members WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "membership",
        userId: (row["fan_user_id"] as string | null) ?? String(row["user_id"]),
        sessionId: sid,
        grantedCredits: 0,
        details: {
          memberId: String(row["id"]),
          creatorUserId: String(row["user_id"]),
          memberStatus: String(row["status"]),
          settledPayoutId: (row["settled_payout_id"] as string | null) ?? null,
        },
      };
    },
    async () => {
      const r = await db.execute(sql`
        SELECT id, buyer_id, producer_id, tier, status, beat_id
        FROM beat_licenses WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "beat_license",
        userId: String(row["buyer_id"]),
        sessionId: sid,
        grantedCredits: 0,
        details: {
          licenseId: String(row["id"]),
          producerId: String(row["producer_id"]),
          tier: String(row["tier"]),
          licenseStatus: String(row["status"]),
          beatId: String(row["beat_id"]),
        },
      };
    },
    async () => {
      const r = await db.execute(sql`
        SELECT id, buyer_user_id, profile_id, status
        FROM digital_sales WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "digital_sale",
        userId: String(row["buyer_user_id"]),
        sessionId: sid,
        grantedCredits: 0,
        details: { saleId: String(row["id"]), profileId: String(row["profile_id"]), saleStatus: String(row["status"] ?? "completed") },
      };
    },
    async () => {
      const r = await db.execute(sql`
        SELECT id, user_id FROM shop_events
        WHERE stripe_session_id = ${sid} AND event_type IN ('sale', 'pending_sale')
        ORDER BY created_at ASC LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "marketplace_shop",
        userId: String(row["user_id"]),
        sessionId: sid,
        grantedCredits: 0,
        details: { sellerUserId: String(row["user_id"]), firstLineId: String(row["id"]) },
      };
    },
    async () => {
      const r = await db.execute(sql`
        SELECT id, buyer_user_id, profile_id, status
        FROM store_orders WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "storefront_order",
        userId: (row["buyer_user_id"] as string | null) ?? null,
        sessionId: sid,
        grantedCredits: 0,
        details: { orderId: String(row["id"]), profileId: String(row["profile_id"]), orderStatus: String(row["status"]) },
      };
    },
    async () => {
      const r = await db.execute(sql`
        SELECT id, buyer_user_id, user_id, status
        FROM live_shop_sales WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "live_shop_sale",
        userId: (row["buyer_user_id"] as string | null) ?? String(row["user_id"]),
        sessionId: sid,
        grantedCredits: 0,
        details: { saleId: String(row["id"]), sellerUserId: String(row["user_id"]), saleStatus: String(row["status"]) },
      };
    },
    async () => {
      const r = await db.execute(sql`
        SELECT id, page_user_id, status
        FROM tip_jar_tips WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "tip_jar_tip",
        userId: String(row["page_user_id"]),
        sessionId: sid,
        grantedCredits: 0,
        details: { tipId: String(row["id"]), tipStatus: String(row["status"]) },
      };
    },
    async () => {
      const r = await db.execute(sql`
        SELECT id, creator_user_id, status
        FROM shoutout_requests WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(r);
      if (!row) return null;
      return {
        rail: "shoutout_request",
        userId: String(row["creator_user_id"]),
        sessionId: sid,
        grantedCredits: 0,
        details: { requestId: String(row["id"]), requestStatus: String(row["status"]) },
      };
    },
    async () => identifySponsorDeal(null, sid),
  ];

  for (const probe of probes) {
    const hit = await probe();
    if (hit) return hit;
  }
  return null;
}

async function identifySponsorDeal(
  dealId: string | null,
  sessionId: string,
): Promise<IdentifiedRail | null> {
  const r = dealId
    ? await db.execute(sql`SELECT id, escrow_status, status FROM sponsor_deals WHERE id = ${dealId} LIMIT 1`)
    : await db.execute(sql`SELECT id, escrow_status, status FROM sponsor_deals WHERE stripe_session_id = ${sessionId} LIMIT 1`);
  const row = firstRow(r);
  if (!row) return null;
  const id = String(row["id"]);
  const payouts = await db.execute(sql`
    SELECT id, status FROM sponsor_payouts WHERE deal_id = ${id} LIMIT 1
  `);
  const payout = firstRow(payouts);
  if (payout) {
    return {
      rail: "sponsor_deal",
      userId: null,
      sessionId,
      grantedCredits: 0,
      manual:
        "Sponsor escrow already released into a payout ledger row — the creator side may already be settled; a human reconciles.",
      details: { dealId: id, escrowStatus: String(row["escrow_status"]), payoutId: String(payout["id"]), payoutStatus: String(payout["status"]) },
    };
  }
  return {
    rail: "sponsor_deal",
    userId: null,
    sessionId,
    grantedCredits: 0,
    details: { dealId: id, escrowStatus: String(row["escrow_status"]), dealStatus: String(row["status"]) },
  };
}

/* ── Manual review — the loud, recorded dead end ────────────────────── */

async function recordManualReview(
  charge: ReversalCharge,
  eventId: string,
  trigger: string,
  ident: IdentifiedRail | null,
  reason: string,
): Promise<void> {
  logger.error(
    { chargeId: charge.id, paymentIntentId: charge.paymentIntentId, rail: ident?.rail ?? "unidentified", reason },
    "payment reversal: NEEDS MANUAL REVIEW — charge could not be auto-reversed; audit row written",
  );
  await db.execute(sql`
    INSERT INTO payment_reversals (
      stripe_event_id, stripe_charge_id, stripe_payment_intent_id, trigger,
      rail, user_id, session_id, charge_amount_cents, refunded_cents_seen,
      status, details
    ) VALUES (
      ${eventId}, ${charge.id}, ${charge.paymentIntentId}, ${trigger},
      ${ident?.rail ?? "unidentified"}, ${ident?.userId ?? null}, ${ident?.sessionId ?? null},
      ${charge.amountCents}, ${charge.refundedCents},
      'needs_manual_review',
      ${JSON.stringify({ ...(ident?.details ?? {}), manualReason: reason })}::jsonb
    )
    ON CONFLICT (stripe_charge_id) DO NOTHING
  `);
}

/* ── VB debit — what's there, never below zero ──────────────────────── */

interface DebitResult {
  debited: number;
  shortfall: number;
}

/**
 * Debit up to `amount` VB from a member's balance (regular credits
 * first — that's where purchase grants land — then the unexpired
 * bonus pool). Floors at zero: what the balance can't cover comes
 * back as shortfall for the audit row, never a negative balance and
 * never a throw for insufficiency. Throws only on real IO failure,
 * so the caller can mark the reversal failed and let Stripe retry.
 */
export async function debitCreditsUpTo(userId: string, amount: number): Promise<DebitResult> {
  if (!Number.isFinite(amount) || amount <= 0) return { debited: 0, shortfall: 0 };
  const admin = getSupabaseAdmin();
  const { data: profile, error: readErr } = await admin
    .from("profiles")
    .select("credits, bonus_credits, bonus_credits_expires_at")
    .eq("id", userId)
    .single();
  if (readErr || !profile) {
    logger.error(
      { userId, amount, err: readErr?.message },
      "payment reversal: profile unreadable — full amount recorded as shortfall for manual review",
    );
    return { debited: 0, shortfall: amount };
  }
  const typed = profile as { credits?: number; bonus_credits?: number; bonus_credits_expires_at?: string | null };
  const credits = Math.max(0, Math.floor(typed.credits ?? 0));
  const bonusExpired =
    !!typed.bonus_credits_expires_at && new Date(typed.bonus_credits_expires_at).getTime() < Date.now();
  const bonus = bonusExpired ? 0 : Math.max(0, Math.floor(typed.bonus_credits ?? 0));
  const debited = Math.min(amount, credits + bonus);
  if (debited <= 0) return { debited: 0, shortfall: amount };
  const fromCredits = Math.min(credits, debited);
  const fromBonus = debited - fromCredits;
  const bonusAfter = bonus - fromBonus;
  const update: Record<string, unknown> = {
    credits: credits - fromCredits,
    bonus_credits: bonusAfter,
  };
  if (fromBonus > 0 && bonusAfter <= 0) update.bonus_credits_expires_at = null;
  const { error: updateErr } = await admin.from("profiles").update(update).eq("id", userId);
  if (updateErr) throw new Error(`debitCreditsUpTo: profile update failed: ${updateErr.message}`);
  return { debited, shortfall: amount - debited };
}

/**
 * The clawback's credit-ledger row (credit_usage), written with the
 * house strict-retry discipline but conflict-tolerant: the key is the
 * reversal's cumulative progress, so a retry that finds its own row
 * already landed treats it as written. Balance state is persisted on
 * payment_reversals BEFORE this runs, so a ledger gap can never cause
 * a double debit — it is logged CRITICAL for reconciliation instead
 * (the same failure posture as refundCredits' ledger leg).
 */
async function writeClawbackLedgerRow(input: {
  userId: string;
  action: string;
  creditsUsed: number;
  idempotencyKey: string;
}): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db.execute(sql`
        INSERT INTO credit_usage (user_id, action, credits_used, idempotency_key)
        VALUES (${input.userId}, ${input.action}, ${input.creditsUsed}, ${input.idempotencyKey})
      `);
      return;
    } catch (err) {
      /* The key is UNIQUE: a conflict means an earlier attempt of
         THIS step landed (its ack was lost) — the row exists, which
         is all this function promises. */
      if (isUniqueViolation(err)) return;
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  logger.error(
    { err: lastErr, ...input },
    "payment reversal: CRITICAL — VB debited but the credit-ledger row failed; manual reconciliation required",
  );
}

/* ── Per-rail entitlement / seller reversals (full reversal only) ───── */

async function reverseEntitlement(ident: IdentifiedRail): Promise<{ entitlement: boolean; seller: boolean }> {
  const sid = ident.sessionId;
  if (!sid) return { entitlement: false, seller: false };
  switch (ident.rail) {
    case "membership": {
      const m = await db.execute(sql`
        UPDATE fan_members
        SET status = 'refunded', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
        WHERE stripe_session_id = ${sid} AND status <> 'refunded'
        RETURNING id
      `);
      await db.execute(sql`
        UPDATE fan_membership_gifts
        SET status = 'refunded', updated_at = now()
        WHERE stripe_session_id = ${sid} AND status = 'active'
      `);
      /* Payout sums exclude status='refunded' (routes/stripe-connect),
         so the flip IS the seller-side reversal. */
      return { entitlement: m.rows.length > 0, seller: m.rows.length > 0 };
    }
    case "beat_license": {
      const lic = await db.execute(sql`
        SELECT id, beat_id, tier, status FROM beat_licenses
        WHERE stripe_session_id = ${sid} LIMIT 1
      `);
      const row = firstRow(lic);
      if (!row || String(row["status"]) !== "completed") {
        return { entitlement: false, seller: false };
      }
      await db.execute(sql`
        UPDATE beat_licenses SET status = 'refunded' WHERE id = ${String(row["id"])}
      `);
      if (String(row["tier"]) === "exclusive") {
        /* The exclusive claim dies with the license — the beat can be
           sold again (mirrors the atomic claim in beats verify). */
        await db.execute(sql`
          UPDATE beats SET exclusive_sold = false, updated_at = now()
          WHERE id = ${String(row["beat_id"])} AND exclusive_sold = true
        `);
      }
      /* Sales views + producer numbers read status='completed' only. */
      return { entitlement: true, seller: true };
    }
    case "digital_sale": {
      const s = await db.execute(sql`
        UPDATE digital_sales
        SET status = 'refunded', refunded_at = now()
        WHERE stripe_session_id = ${sid} AND status <> 'refunded'
        RETURNING id
      `);
      await db.execute(sql`
        UPDATE download_links SET expires_at = now()
        WHERE sale_id IN (SELECT id FROM digital_sales WHERE stripe_session_id = ${sid})
          AND expires_at > now()
      `);
      return { entitlement: s.rows.length > 0, seller: s.rows.length > 0 };
    }
    case "marketplace_shop": {
      /* Flip BOTH paid lines and any still-pending lines: a pending
         line flipped later by a replayed checkout.session.completed
         must never resurrect a refunded sale (markMarketSalePaid
         guards on event_type='pending_sale'). */
      const s = await db.execute(sql`
        UPDATE shop_events
        SET event_type = 'refunded_sale', payment_status = 'refunded'
        WHERE stripe_session_id = ${sid} AND event_type IN ('sale', 'pending_sale')
        RETURNING id
      `);
      /* Analytics, earnings and payout sums read event_type='sale'. */
      return { entitlement: s.rows.length > 0, seller: s.rows.length > 0 };
    }
    case "storefront_order": {
      const s = await db.execute(sql`
        UPDATE store_orders SET status = 'refunded'
        WHERE stripe_session_id = ${sid} AND status <> 'refunded'
        RETURNING id
      `);
      await db.execute(sql`
        UPDATE store_delivery_tokens SET expires_at = now()
        WHERE order_id IN (SELECT id FROM store_orders WHERE stripe_session_id = ${sid})
          AND expires_at > now()
      `);
      return { entitlement: s.rows.length > 0, seller: s.rows.length > 0 };
    }
    case "live_shop_sale": {
      const s = await db.execute(sql`
        UPDATE live_shop_sales SET status = 'refunded'
        WHERE stripe_session_id = ${sid} AND status = 'paid'
        RETURNING id
      `);
      return { entitlement: s.rows.length > 0, seller: s.rows.length > 0 };
    }
    case "tip_jar_tip": {
      const s = await db.execute(sql`
        UPDATE tip_jar_tips SET status = 'refunded'
        WHERE stripe_session_id = ${sid} AND status = 'paid'
        RETURNING id
      `);
      return { entitlement: s.rows.length > 0, seller: s.rows.length > 0 };
    }
    case "shoutout_request": {
      const s = await db.execute(sql`
        UPDATE shoutout_requests SET status = 'refunded', updated_at = now()
        WHERE stripe_session_id = ${sid} AND status <> 'refunded'
        RETURNING id
      `);
      return { entitlement: s.rows.length > 0, seller: s.rows.length > 0 };
    }
    case "sponsor_deal": {
      /* Funded but never released (released deals are manual-review
         at identification): return the deal to the rail's own
         unfunded state — the same state the fund flow's own rollback
         writes — so it can never be released against refunded money. */
      const dealId = String(ident.details["dealId"] ?? "");
      if (!dealId) return { entitlement: false, seller: false };
      const s = await db.execute(sql`
        UPDATE sponsor_deals SET escrow_status = 'unfunded'
        WHERE id = ${dealId} AND escrow_status = 'funded'
        RETURNING id
      `);
      return { entitlement: s.rows.length > 0, seller: s.rows.length > 0 };
    }
    default:
      return { entitlement: false, seller: false };
  }
}

/* ── The referral award a purchase paid (the reversal's second leg) ── */

interface ReferralAward {
  payoutId: string;
  awarded: number;
  referrerId: string;
}

/**
 * Resolve the referral award a credit-pack purchase paid, from the
 * same grant record the award side wrote. referral_payouts carries
 * NO referrer id of its own: the referrer is
 * referrals.referrer_user_id, reached through the payout's
 * referral_id — the same two-step awardReferralPayout
 * (routes/referrals) walks forward when it pays the award. (Selecting
 * referrer_user_id off referral_payouts directly can never succeed
 * against the real schema — that was defect D7: the pack claw landed,
 * this read threw, and the webhook 500'd on every Stripe retry.)
 *
 * Returns null when the purchase paid no award (no payout row, or a
 * zero award). A FAILED read throws — never a silent null — so the
 * reversal fails, the webhook 500s, and the Stripe retry re-runs the
 * leg; an award whose referral row does not resolve throws too (the
 * payout's FK, referral_id → referrals.id ON DELETE CASCADE, makes a
 * dangling payout impossible on a schema-faithful database, so an
 * unresolvable referrer is data corruption, not "no award").
 */
async function lookupReferralAward(sessionId: string): Promise<ReferralAward | null> {
  const admin = getSupabaseAdmin();
  const { data: payout, error: payoutErr } = await admin
    .from("referral_payouts")
    .select("id, referral_id, referrer_credits_awarded")
    .eq("stripe_session_id", sessionId)
    .single();
  if (payoutErr && payoutErr.code !== "PGRST116") {
    throw new Error(`referral payout lookup failed: ${payoutErr.message}`);
  }
  if (!payout) return null;
  const awarded = Number(
    (payout as { referrer_credits_awarded?: number }).referrer_credits_awarded ?? 0,
  );
  if (awarded <= 0) return null;
  const referralId = String((payout as { referral_id?: string }).referral_id ?? "");
  const { data: referral, error: referralErr } = await admin
    .from("referrals")
    .select("referrer_user_id")
    .eq("id", referralId)
    .single();
  if (referralErr && referralErr.code !== "PGRST116") {
    throw new Error(`referral lookup failed: ${referralErr.message}`);
  }
  const referrerId =
    (referral as { referrer_user_id?: string } | null)?.referrer_user_id ?? null;
  if (!referrerId) {
    throw new Error(
      `referral payout ${String((payout as { id?: string }).id ?? "")} references referral ${referralId}, which does not resolve to a referrer`,
    );
  }
  return {
    payoutId: String((payout as { id?: string }).id ?? ""),
    awarded,
    referrerId,
  };
}

/* ── The engine ─────────────────────────────────────────────────────── */

export async function processChargeReversal(input: {
  stripe: Stripe;
  eventId: string;
  trigger: "charge.refunded" | "charge.dispute.closed";
  charge: ReversalCharge;
  disputeLost?: boolean;
}): Promise<ReversalOutcome> {
  const { stripe, eventId, trigger, charge } = input;
  const disputeLost = input.disputeLost === true;

  const ident = await identifyRail(charge, stripe);

  if (!ident) {
    await recordManualReview(charge, eventId, trigger, null,
      "No grant record identifies this charge (no stripe_payments row for the payment intent, and no rail grant row for its checkout session).");
    return { outcome: "manual_review", rail: "unidentified" };
  }
  if (ident.manual) {
    await recordManualReview(charge, eventId, trigger, ident, ident.manual);
    return { outcome: "manual_review", rail: ident.rail };
  }

  const fullReversal = disputeLost || charge.amountCents <= 0 || charge.refundedCents >= charge.amountCents;
  const fraction = disputeLost
    ? 1
    : charge.amountCents > 0
      ? Math.min(1, charge.refundedCents / charge.amountCents)
      : 1;

  /* ── Claim (insert-first, payment-record.ts discipline) ─────────── */
  let state: Row | null = null;
  try {
    const ins = await db.execute(sql`
      INSERT INTO payment_reversals (
        stripe_event_id, stripe_charge_id, stripe_payment_intent_id, trigger,
        rail, user_id, session_id, granted_credits, charge_amount_cents,
        refunded_cents_seen, dispute_lost, status, details
      ) VALUES (
        ${eventId}, ${charge.id}, ${charge.paymentIntentId}, ${trigger},
        ${ident.rail}, ${ident.userId}, ${ident.sessionId}, ${ident.grantedCredits}, ${charge.amountCents},
        ${charge.refundedCents}, ${disputeLost}, 'processing',
        ${JSON.stringify(ident.details)}::jsonb
      )
      RETURNING *
    `);
    state = firstRow(ins) ?? null;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }

  if (!state) {
    const existing = await db.execute(sql`
      SELECT * FROM payment_reversals WHERE stripe_charge_id = ${charge.id} LIMIT 1
    `);
    const row = firstRow(existing);
    if (!row) return { outcome: "inflight" }; // vanished mid-claim — retry sorts it out
    /* Does this event add work beyond what the row already records?
       (A row parked at needs_manual_review can be upgraded here when a
       later event's identification succeeds — reaching this claim at
       all means the current identification is auto-reversible.) */
    const granted = Number(row["granted_credits"] ?? 0) || ident.grantedCredits;
    const targetCredits = Math.floor(granted * fraction);
    const creditsWork = targetCredits > Number(row["credits_clawed"] ?? 0);
    const entitlementWork =
      fullReversal && ident.grantedCredits === 0 && row["entitlement_revoked"] !== true;
    const disputeWork = disputeLost && row["dispute_lost"] !== true;
    const upgradeWork = String(row["status"]) === "needs_manual_review";
    /* A 'failed' row never finished by definition — always reclaim
       it and let the delta-driven execute converge (every step
       computes only its remaining delta, so re-running is safe). */
    const failedWork = String(row["status"]) === "failed";
    if (!creditsWork && !entitlementWork && !disputeWork && !upgradeWork && !failedWork) {
      /* The referral leg's remaining work is invisible to the checks
         above: a reversal that clawed the pack in full and then
         failed (or shortfell) on the referral share has NO credits
         work left, yet its referral target can still exceed what was
         clawed. Without this check the retry would be answered
         'duplicate' and the referral leg would never run — the D7
         charge sat in exactly that state. A failed read here throws
         (lookupReferralAward's posture), so the webhook 500s and the
         next retry decides with a working read. */
      let referralWork = false;
      if (ident.rail === "credit_pack" && ident.sessionId) {
        const award = await lookupReferralAward(ident.sessionId);
        referralWork =
          award !== null &&
          Math.floor(award.awarded * fraction) > Number(row["referral_credits_clawed"] ?? 0);
      }
      if (!referralWork) return { outcome: "duplicate" };
    }
    const cutoff = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
    const reclaimed = await db.execute(sql`
      UPDATE payment_reversals
      SET status = 'processing', stripe_event_id = ${eventId}, trigger = ${trigger},
          rail = ${ident.rail}, user_id = ${ident.userId}, session_id = ${ident.sessionId},
          granted_credits = ${granted}, updated_at = now()
      WHERE stripe_charge_id = ${charge.id}
        AND (status IN ('failed', 'completed', 'partial_shortfall', 'needs_manual_review')
             OR (status = 'processing' AND updated_at < ${cutoff}::timestamptz))
      RETURNING *
    `);
    state = firstRow(reclaimed) ?? null;
    if (!state) return { outcome: "inflight" };
  }

  /* ── Execute — progress persists after every money step ─────────── */
  try {
    let creditsClawed = Number(state["credits_clawed"] ?? 0);
    let referralClawed = Number(state["referral_credits_clawed"] ?? 0);
    let shortfall = Number(state["shortfall_credits"] ?? 0);
    let entitlementRevoked = state["entitlement_revoked"] === true;
    let sellerReversed = state["seller_reversed"] === true;
    const prevDetails =
      state["details"] && typeof state["details"] === "object"
        ? (state["details"] as Record<string, unknown>)
        : {};
    const details: Record<string, unknown> = { ...prevDetails, ...ident.details };

    if (ident.rail === "credit_pack" && ident.userId) {
      const target = Math.floor(ident.grantedCredits * fraction);
      const delta = target - creditsClawed;
      if (delta > 0) {
        const { debited, shortfall: stepShortfall } = await debitCreditsUpTo(ident.userId, delta);
        creditsClawed += debited;
        shortfall += stepShortfall;
        await db.execute(sql`
          UPDATE payment_reversals
          SET credits_clawed = ${creditsClawed}, shortfall_credits = ${shortfall}, updated_at = now()
          WHERE stripe_charge_id = ${charge.id}
        `);
        if (debited > 0) {
          await writeClawbackLedgerRow({
            userId: ident.userId,
            action: disputeLost ? "Credit Pack Clawback (chargeback)" : "Credit Pack Clawback (refund)",
            creditsUsed: debited,
            idempotencyKey: `clawback:${charge.id}:credits:${creditsClawed}`,
          });
        }
        if (stepShortfall > 0) details["packShortfall"] = stepShortfall;
      }

      /* The purchase also paid a 25% referral share — reverse the
         same fraction of it, from the same grant record the award
         wrote (see lookupReferralAward). */
      if (ident.sessionId) {
        const award = await lookupReferralAward(ident.sessionId);
        if (award) {
          const refTarget = Math.floor(award.awarded * fraction);
          const refDelta = refTarget - referralClawed;
          details["referralPayoutId"] = award.payoutId;
          details["referralAwarded"] = award.awarded;
          if (refDelta > 0) {
            const { debited, shortfall: refShortfall } = await debitCreditsUpTo(award.referrerId, refDelta);
            referralClawed += debited;
            shortfall += refShortfall;
            await db.execute(sql`
              UPDATE payment_reversals
              SET referral_credits_clawed = ${referralClawed}, shortfall_credits = ${shortfall}, updated_at = now()
              WHERE stripe_charge_id = ${charge.id}
            `);
            if (debited > 0) {
              await writeClawbackLedgerRow({
                userId: award.referrerId,
                action: disputeLost ? "Referral Share Clawback (chargeback)" : "Referral Share Clawback (refund)",
                creditsUsed: debited,
                idempotencyKey: `clawback:${charge.id}:referral:${referralClawed}`,
              });
            }
            if (refShortfall > 0) details["referralShortfall"] = refShortfall;
          }
        }
      }
    }

    if (fullReversal && ident.grantedCredits === 0) {
      const rev = await reverseEntitlement(ident);
      entitlementRevoked = entitlementRevoked || rev.entitlement;
      sellerReversed = sellerReversed || rev.seller;
      details["entitlementRevokedNow"] = rev.entitlement;
    } else if (!fullReversal && ident.grantedCredits === 0) {
      /* Partial refund on an entitlement rail: the buyer is still
         partially paid-up, so the entitlement stands — recorded, not
         silent. A later event completing the refund reclaims this
         row and revokes then. */
      details["partialRefundEntitlementKept"] = true;
    }

    const finalStatus = shortfall > 0 ? "partial_shortfall" : "completed";
    await db.execute(sql`
      UPDATE payment_reversals
      SET status = ${finalStatus},
          refunded_cents_seen = GREATEST(refunded_cents_seen, ${charge.refundedCents}),
          dispute_lost = dispute_lost OR ${disputeLost},
          entitlement_revoked = ${entitlementRevoked},
          seller_reversed = ${sellerReversed},
          details = ${JSON.stringify(details)}::jsonb,
          updated_at = now()
      WHERE stripe_charge_id = ${charge.id}
    `);
    logger.info(
      { chargeId: charge.id, rail: ident.rail, creditsClawed, referralClawed, shortfall, status: finalStatus },
      "payment reversal: applied",
    );
    return { outcome: "reversed", rail: ident.rail, creditsClawed, shortfallCredits: shortfall };
  } catch (err) {
    await db
      .execute(sql`
        UPDATE payment_reversals SET status = 'failed', updated_at = now()
        WHERE stripe_charge_id = ${charge.id}
      `)
      .catch(() => {});
    logger.error({ err, chargeId: charge.id, rail: ident.rail }, "payment reversal: failed — marked for Stripe retry");
    throw err;
  }
}

/** Webhook-facing adapter: normalize a Stripe Charge (+ dispute flag). */
export async function processStripeChargeReversal(input: {
  stripe: Stripe;
  eventId: string;
  trigger: "charge.refunded" | "charge.dispute.closed";
  charge: Stripe.Charge;
  disputeLost?: boolean;
}): Promise<ReversalOutcome> {
  const pi = input.charge.payment_intent;
  return processChargeReversal({
    stripe: input.stripe,
    eventId: input.eventId,
    trigger: input.trigger,
    disputeLost: input.disputeLost,
    charge: {
      id: input.charge.id,
      paymentIntentId: typeof pi === "string" ? pi : (pi?.id ?? null),
      amountCents: input.charge.amount ?? 0,
      refundedCents: input.charge.amount_refunded ?? 0,
      currency: input.charge.currency ?? null,
    },
  });
}

/** Admin readback (GET /api/admin/payment-reversals). */
export async function listPaymentReversals(limit = 50): Promise<Record<string, unknown>[]> {
  /* Literal LIMIT (clamped + integer-forced here): some drivers reject
     a bound LIMIT parameter — the same lesson as credits.ts. */
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const r = await db.execute(sql`
    SELECT id, stripe_event_id, stripe_charge_id, stripe_payment_intent_id,
           trigger, rail, user_id, session_id, granted_credits, credits_clawed,
           referral_credits_clawed, refunded_cents_seen, charge_amount_cents,
           dispute_lost, entitlement_revoked, seller_reversed, shortfall_credits,
           status, details, created_at, updated_at
    FROM payment_reversals
    ORDER BY created_at DESC
    LIMIT ${sql.raw(String(n))}
  `);
  return r.rows as Record<string, unknown>[];
}
