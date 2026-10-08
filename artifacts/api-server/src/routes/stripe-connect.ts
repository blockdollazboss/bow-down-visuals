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
 * pending earnings (digital_sales + store_orders creator cuts) to their
 * connected account via stripe.transfers.create.
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

/* Pending (unsettled) earnings for a profile, in cents:
 * gross creator cuts minus amounts already paid out via creator_payouts. */
export async function pendingPayoutCents(profileId: string): Promise<number> {
  const r = await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(creator_amount_cents) FROM digital_sales WHERE profile_id = ${profileId}), 0)
      + COALESCE((SELECT SUM(creator_amount_cents) FROM store_orders WHERE profile_id = ${profileId}), 0)
      - COALESCE((SELECT SUM(amount_cents) FROM creator_payouts
                  WHERE profile_id = ${profileId} AND status IN ('processing', 'pending', 'paid')), 0)
      AS available
  `);
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return Math.max(0, Number(row?.["available"] ?? 0));
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

/* ── POST /api/connect/login-link — manage the Express account in Stripe.
 * NOTE: Accounts v2 has no login-link API. Creators sign in at the Stripe
 * Express dashboard directly; this endpoint explains that gracefully. */
router.post("/connect/login-link", requireAuth, publicApiLimiter, async (req, res) => {
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
    res.status(501).json({
      error: "NO_LOGIN_LINK",
      message: "Stripe's v2 API doesn't issue dashboard login links — manage your account in the Stripe Express dashboard directly.",
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[connect] login link failed");
    res.status(500).json({ error: "Could not open your Stripe dashboard. Try again." });
  }
});

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

    // Block concurrent double-payouts: one in-flight payout at a time.
    const inFlight = await db.execute(sql`
      SELECT id FROM creator_payouts
      WHERE profile_id = ${profileId} AND status = 'processing' LIMIT 1
    `);
    if (inFlight.rows.length > 0) {
      res.status(409).json({ error: "PAYOUT_IN_FLIGHT", message: "A payout is already processing." });
      return;
    }

    const ins = await db.execute(sql`
      INSERT INTO creator_payouts (profile_id, amount_cents, status)
      VALUES (${profileId}, ${available}, 'processing')
      RETURNING id
    `);
    const payoutId = String((ins.rows[0] as Record<string, unknown>)["id"]);

    try {
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
