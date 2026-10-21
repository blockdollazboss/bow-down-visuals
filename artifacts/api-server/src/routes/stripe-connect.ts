import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { publicApiLimiter } from "../lib/rate-limit";
import {
  getConnectStripe,
  isTestMode,
  getProfileConnectFields,
  createConnectAccount,
  createOnboardingLink,
  getConnectStatus,
  createPayoutTransfer,
  getUserEmail,
} from "../lib/stripe-connect";

const router = Router();

/* ── Stripe Connect (Express) money-out — TEST MODE ───────────────────────
 * Creators connect a bank via Stripe-hosted onboarding; payouts move their
 * pending earnings to their connected account via stripe.transfers.create.
 * Payable ledgers: digital_sales + store_orders creator cuts (bulk), plus
 * the 0142 per-row-settled ledgers — released sponsor deals, paid
 * memberships, and shop sales (see pendingPayoutCents).
 * TEST MODE: with sk_test_* keys these are test transfers — no real money
 * moves. Real payouts require a later explicit user approval + live keys.
 * Every route is auth-required and fails closed without STRIPE_SECRET_KEY. */

const MIN_PAYOUT_CENTS = 100; // $1.00 — Stripe's transfer minimum

function stripeOr503(res: import("express").Response): boolean {
  try {
    getConnectStripe();
    return true;
  } catch (err) {
    res.status(503).json({ error: "Payouts are not configured yet." });
    logger.warn({ err }, "[connect] STRIPE_SECRET_KEY missing");
    return false;
  }
}

async function callerProfileId(userId: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT id FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row ? String(row["id"]) : null;
}

/* "Unsettled" for the 0142 extension ledgers: a row counts as payable
 * until a payout in an active state claims it. settled_payout_id is
 * stamped when a payout is created (see markExtensionRowsSettled); if
 * that payout later FAILS, the row becomes payable again on its own —
 * no bookkeeping cleanup can strand or double-pay it. `alias` is one
 * of this file's own static table aliases (never user input). */
function unsettledSql(alias: string) {
  return sql`
    (${sql.raw(alias)}.settled_payout_id IS NULL
     OR ${sql.raw(alias)}.settled_payout_id NOT IN (
       SELECT id FROM creator_payouts WHERE status IN ('processing', 'pending', 'paid')
     ))
  `;
}

/* Pending (unsettled) earnings for a profile, in cents:
 * gross creator cuts minus amounts already paid out via creator_payouts.
 *
 * The legacy ledgers (digital_sales + store_orders) settle in bulk: the
 * original formula subtracts every active payout, unchanged.
 *
 * The 0142 extension ledgers settle PER ROW (settled_payout_id):
 * released brand deals (sponsor_payouts.net_cents), paid memberships
 * (fan_members.price_cents — stripe_session_id present = actually
 * charged, mirroring routes/earnings.ts), and shop sales
 * (shop_events amount − platform fee, event_type 'sale'). Their keys
 * are the creator's USER id (sponsor_payouts.creator_user_id is the
 * user id as text), resolved here from the profile. */
export async function pendingPayoutCents(profileId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT
      /* Refunded sales never pay out (0182, defect D1): the clawback
         engine marks digital_sales / store_orders 'refunded' and the
         bulk ledgers drop them here; earnings.ts already reads
         store_orders with status = 'completed'. */
      COALESCE((SELECT SUM(creator_amount_cents) FROM digital_sales WHERE profile_id = ${profileId} AND status <> 'refunded'), 0)
      + COALESCE((SELECT SUM(creator_amount_cents) FROM store_orders WHERE profile_id = ${profileId} AND status = 'completed'), 0)
      + COALESCE((
          SELECT SUM(sp.net_cents) FROM sponsor_payouts sp
          WHERE sp.creator_user_id = (SELECT user_id::text FROM creator_profiles WHERE id = ${profileId})
            AND sp.status = 'released'
            AND ${unsettledSql("sp")}
        ), 0)
      + COALESCE((
          SELECT SUM(fm.price_cents) FROM fan_members fm
          WHERE fm.user_id = (SELECT user_id FROM creator_profiles WHERE id = ${profileId})
            AND fm.stripe_session_id IS NOT NULL
            AND fm.status <> 'refunded'
            AND ${unsettledSql("fm")}
        ), 0)
      + COALESCE((
          SELECT SUM(se.amount_cents - se.platform_fee_cents) FROM shop_events se
          WHERE se.user_id = (SELECT user_id FROM creator_profiles WHERE id = ${profileId})
            AND se.event_type = 'sale'
            AND ${unsettledSql("se")}
        ), 0)
      - COALESCE((SELECT SUM(amount_cents) FROM creator_payouts
                  WHERE profile_id = ${profileId} AND status IN ('processing', 'pending', 'paid')), 0)
      AS available
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return Math.max(0, Number(row?.["available"] ?? 0));
}

/* Stamp the extension-ledger rows a new payout covers (0142). Runs
 * when the payout row is created, inside the payout's own try: if the
 * transfer then fails, the payout flips to 'failed' and every stamped
 * row becomes payable again via the UNSETTLED predicate above.
 * Rows created AFTER the payout was computed are not stamped — the
 * created_at bound keeps the stamped set inside the paid amount. */
export async function markExtensionRowsSettled(
  userId: string,
  payoutId: string,
  payoutCreatedAt: string,
): Promise<void> {
  const stamp = sql`settled_payout_id = ${payoutId}::uuid, settled_at = NOW()`;
  const bound = sql`created_at <= ${payoutCreatedAt}::timestamptz`;
  await db.execute(sql`
    UPDATE sponsor_payouts SET ${stamp}
    WHERE creator_user_id = ${userId} AND status = 'released'
      AND ${unsettledSql("sponsor_payouts")} AND ${bound}
  `);
  await db.execute(sql`
    UPDATE fan_members SET ${stamp}
    WHERE user_id = ${userId}::uuid AND stripe_session_id IS NOT NULL
      AND status <> 'refunded'
      AND ${unsettledSql("fan_members")} AND ${bound}
  `);
  await db.execute(sql`
    UPDATE shop_events SET ${stamp}
    WHERE user_id = ${userId}::uuid AND event_type = 'sale'
      AND ${unsettledSql("shop_events")} AND ${bound}
  `);
}

/* ── POST /api/connect/onboard — create account (if needed) + onboarding URL */
router.post("/connect/onboard", requireAuth, publicApiLimiter, async (req, res) => {
  if (!stripeOr503(res)) return;
  try {
    const profileId = await callerProfileId(req.userId!);
    if (!profileId) {
      res.status(404).json({ error: "NO_PROFILE", message: "Create your creator profile first." });
      return;
    }
    const fields = await getProfileConnectFields(profileId);
    let accountId = fields.accountId;
    if (!accountId) {
      const email = await getUserEmail(req.userId!);
      const account = await createConnectAccount(profileId, email);
      accountId = account.id;
    }
    const link = await createOnboardingLink(accountId, req);
    res.json({ url: link.url, accountId, testMode: isTestMode() });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[connect] onboard failed");
    res.status(500).json({ error: "Could not start bank setup. Try again." });
  }
});

/* ── POST /api/connect/refresh — fresh onboarding link for an existing account */
router.post("/connect/refresh", requireAuth, publicApiLimiter, async (req, res) => {
  if (!stripeOr503(res)) return;
  try {
    const profileId = await callerProfileId(req.userId!);
    if (!profileId) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const fields = await getProfileConnectFields(profileId);
    if (!fields.accountId) {
      res.status(400).json({ error: "NO_ACCOUNT", message: "Start onboarding first." });
      return;
    }
    const link = await createOnboardingLink(fields.accountId, req);
    res.json({ url: link.url, accountId: fields.accountId, testMode: isTestMode() });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[connect] refresh failed");
    res.status(500).json({ error: "Could not create a setup link. Try again." });
  }
});

/* ── GET /api/connect/status — onboarding + capability state + pending total */
router.get("/connect/status", requireAuth, publicApiLimiter, async (req, res) => {
  if (!stripeOr503(res)) return;
  try {
    const profileId = await callerProfileId(req.userId!);
    if (!profileId) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const fields = await getProfileConnectFields(profileId);
    let live: { onboarded: boolean; chargesEnabled: boolean; payoutsEnabled: boolean } | null = null;
    if (fields.accountId) {
      try {
        const s = await getConnectStatus(fields.accountId);
        live = { onboarded: s.onboarded, chargesEnabled: s.chargesEnabled, payoutsEnabled: s.payoutsEnabled };
      } catch (err) {
        logger.warn({ err, profileId }, "[connect] live status check failed — using stored flags");
      }
    }
    const pending = await pendingPayoutCents(profileId);
    res.json({
      connected: !!fields.accountId,
      accountId: fields.accountId,
      onboarded: live?.onboarded ?? fields.onboarded,
      chargesEnabled: live?.chargesEnabled ?? fields.chargesEnabled,
      payoutsEnabled: live?.payoutsEnabled ?? fields.payoutsEnabled,
      pendingCents: pending,
      minPayoutCents: MIN_PAYOUT_CENTS,
      testMode: isTestMode(),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[connect] status failed");
    res.status(500).json({ error: "Could not load payout status." });
  }
});

/* REMOVED (0132): POST /api/connect/login-link always returned 501 —
 * connected accounts are created through the v2 API, which has no
 * login-link endpoint (see lib/stripe-connect.ts). A button that can
 * only fail must not survive: creators manage their payout setup through
 * the working onboarding path instead (POST /connect/onboard and
 * /connect/refresh issue fresh hosted setup links for the same account). */

/* ── POST /api/connect/payout — send pending earnings to the connected bank
 * TEST MODE: exercises the real test-mode transfer API; no real money moves.
 * Real (live) payouts require a later explicit user approval. */
router.post("/connect/payout", requireAuth, publicApiLimiter, async (req, res) => {
  if (!stripeOr503(res)) return;
  try {
    const profileId = await callerProfileId(req.userId!);
    if (!profileId) {
      res.status(404).json({ error: "NO_PROFILE" });
      return;
    }
    const fields = await getProfileConnectFields(profileId);
    if (!fields.accountId) {
      res.status(400).json({ error: "NO_ACCOUNT", message: "Connect your bank first." });
      return;
    }
    if (!fields.payoutsEnabled) {
      // Re-check live in case the webhook hasn't landed yet.
      try {
        const live = await getConnectStatus(fields.accountId);
        if (!live.payoutsEnabled) {
          res.status(400).json({ error: "NOT_ONBOARDED", message: "Finish your Stripe setup before your first payout." });
          return;
        }
      } catch {
        res.status(400).json({ error: "NOT_ONBOARDED", message: "Finish your Stripe setup before your first payout." });
        return;
      }
    }

    const available = await pendingPayoutCents(profileId);
    if (available < MIN_PAYOUT_CENTS) {
      res.status(400).json({
        error: "MINIMUM_NOT_MET",
        message: `You need at least $${(MIN_PAYOUT_CENTS / 100).toFixed(2)} pending to cash out.`,
        pendingCents: available,
      });
      return;
    }

    // Atomic double-payout guard (P0-10): the partial unique index
    // creator_payouts_profile_processing_ux makes this INSERT the arbiter.
    // Two concurrent requests → one wins, the other gets 23505 → 409.
    // (The old SELECT-then-INSERT had a TOCTOU race: both could see zero
    // in-flight payouts and both insert.)
    let payoutId: string;
    let payoutCreatedAt: string;
    try {
      const ins = await db.execute(sql`
        INSERT INTO creator_payouts (profile_id, amount_cents, status)
        VALUES (${profileId}, ${available}, 'processing')
        RETURNING id, created_at
      `);
      const payoutRow = ins.rows[0] as Record<string, unknown>;
      payoutId = String(payoutRow["id"]);
      payoutCreatedAt = new Date(payoutRow["created_at"] as string).toISOString();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "23505") {
        res.status(409).json({ error: "PAYOUT_IN_FLIGHT", message: "A payout is already processing." });
        return;
      }
      throw err;
    }

    try {
      /* Claim the extension-ledger rows this payout covers (0142)
         before the transfer: if anything below fails, the payout flips
         to 'failed' and the rows un-claim themselves. */
      await markExtensionRowsSettled(req.userId!, payoutId, payoutCreatedAt);

      const transfer = await createPayoutTransfer(
        fields.accountId,
        available,
        `connect_payout_${payoutId}`,
      );
      await db.execute(sql`
        UPDATE creator_payouts
        SET stripe_transfer_id = ${transfer.id}, status = 'pending', updated_at = NOW()
        WHERE id = ${payoutId}
      `);
      logger.info(
        { profileId, payoutId, transferId: transfer.id, amountCents: available, testMode: isTestMode() },
        "[connect] payout transfer created",
      );
      res.json({
        payout: { id: payoutId, amountCents: available, status: "pending", stripeTransferId: transfer.id },
        testMode: isTestMode(),
        note: isTestMode()
          ? "TEST MODE — this exercised the real Stripe test API. No real money moved."
          : undefined,
      });
    } catch (err) {
      await db.execute(sql`
        UPDATE creator_payouts SET status = 'failed', updated_at = NOW() WHERE id = ${payoutId}
      `);
      throw err;
    }
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, userId: req.userId }, "[connect] payout failed");
    res.status(500).json({ error: `Payout failed: ${msg}` });
  }
});

export default router;
