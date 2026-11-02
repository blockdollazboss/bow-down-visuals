import Stripe from "stripe";
import type { Request, Response } from "express";
import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  claimStripePayment,
  markPaymentCompleted,
  markPaymentFailed,
  fulfillCreditPurchase,
  type PaymentClaimOutcome,
} from "./payment-record";
import { awardReferralPayout } from "../routes/referrals";
import { createGuardedStripeClient } from "./stripe-client";
import type { ConnectAccountLike } from "./stripe-connect";
import { sessionAmountExcludingTaxCents } from "./stripe-tax";

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

  if (!secretKey) {
    logger.warn("Stripe webhook: STRIPE_SECRET_KEY not configured");
    res.status(200).json({ received: true, warning: "STRIPE_SECRET_KEY not configured" });
    return;
  }

  if (!webhookSecret) {
    logger.warn("Stripe webhook: STRIPE_WEBHOOK_SECRET not configured — cannot verify signature");
    res.status(200).json({ received: true, warning: "STRIPE_WEBHOOK_SECRET not configured" });
    return;
  }

  // Verify service role key is available before doing any work
  try {
    getSupabaseAdmin();
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ msg }, "Stripe webhook: Supabase admin client unavailable");
    res.status(200).json({ received: true, warning: msg });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const sigStr = Array.isArray(sig) ? sig[0] : sig;
  let stripe: Stripe;
  try {
    stripe = createGuardedStripeClient(secretKey);
  } catch (err: unknown) {
    /* Fail closed without a 500 loop: a non-test key is a configuration
       refusal in this stack, so acknowledge and process nothing. */
    const msg = (err as { message?: string })?.message ?? "Stripe is not configured";
    logger.warn({ msg }, "Stripe webhook: Stripe client refused");
    res.status(200).json({ received: true, warning: msg });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sigStr, webhookSecret);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: `Webhook signature verification failed: ${msg}` });
    return;
  }

  logger.info({ type: event.type }, "Stripe webhook: event received");

  /* ── Creator tier subscription events (Worker 12) ──────────────────────
     checkout.session.completed with metadata.kind === "creator_tier" activates
     the tier; customer.subscription.* keep status/period in sync;
     invoice.payment_failed flags past_due. All other kinds flow through the
     existing Visual Bucs logic below untouched. */
  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      /* Marketplace shop purchases (0144): the order already exists as
         pending_sale rows keyed on the session id; a paid session flips
         them to sales via the same guarded flip the verify endpoint
         runs, so webhook replays and verify+webhook races land once.
         The amount must match the order's server-computed gross — a
         mismatched session never fulfils. */
      if (s.metadata?.type === "marketplace_shop_purchase") {
        if (s.payment_status === "paid") {
          const { fetchMarketSaleBySession, markMarketSalePaid } = await import("./market-sale");
          const rows = await fetchMarketSaleBySession(s.id);
          const expected = rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);
          /* Stripe Tax (lib/stripe-tax.ts): compare NET of any tax
             Stripe collected on top — amount_tax is 0/absent while
             tax is off, so the guard is exactly as strict as today.
             The exactly-once flip itself is unchanged. */
          if (rows.length > 0 && sessionAmountExcludingTaxCents(s) === expected) {
            await markMarketSalePaid(s.id);
          } else {
            logger.warn({ sessionId: s.id, rows: rows.length, amountTotal: s.amount_total, expected }, "Stripe webhook: marketplace sale not applied (no pending order or amount mismatch)");
          }
        }
        res.status(200).json({ received: true, kind: "marketplace_shop_purchase" });
        return;
      }
      if (s.metadata?.type === "tip_jar") {
        /* Tip jar (TIP-TRUTH, stack1200): before this branch existed a
           paid tip session fell through the whole dispatch to the
           credit-grant tail — which logged "missing user_id in
           metadata" and answered 200 — so a tip settled ONLY if the
           fan's browser returned and the page called verify. A fan
           who closed the tab left the tip pending forever: never in
           the creator's totals, never a notification. The settle runs
           the same guarded flip as verify (exactly-once under
           webhook replays and verify races) and fires the creator's
           money tell on the landed transition. A settle failure 500s
           so Stripe retries; it must NOT fall through to the credit
           logic. */
        if (s.payment_status !== "paid") {
          res.status(200).json({ received: true, kind: "tip_jar", warning: "session not paid" });
          return;
        }
        try {
          const { settleTipBySessionId } = await import("../routes/generate/tip-jar");
          const settled = await settleTipBySessionId(s.id);
          if (!settled.found) {
            logger.warn({ sessionId: s.id }, "Stripe webhook: tip_jar session has no tip row (checkout row missing or already cleaned up)");
          }
          res.status(200).json({ received: true, kind: "tip_jar" });
        } catch (tipErr) {
          logger.error({ err: tipErr, sessionId: s.id }, "Stripe webhook: tip settle failed");
          res.status(500).json({ error: "Tip settle failed, retry later" });
        }
        return;
      }
      if (s.metadata?.type === "shoutout_request") {
        /* Shoutouts (WEBHOOK-SETTLE, stack1200): before this branch
           existed a paid shoutout session fell through the whole
           dispatch to the credit-grant tail — which logged "missing
           user_id in metadata" and answered 200 — so a paid request
           settled ONLY if the fan's browser returned and the page
           called verify. A fan who closed the tab left the request
           in pending_payment forever: the fan paid, the creator was
           never told, the shoutout was never owed. The settle runs
           the same guarded flip as verify (exactly-once under
           webhook replays and verify races) and fires the creator's
           paid tell on the landed transition. A settle failure 500s
           so Stripe retries; it must NOT fall through to the credit
           logic. */
        if (s.payment_status !== "paid") {
          res.status(200).json({ received: true, kind: "shoutout_request", warning: "session not paid" });
          return;
        }
        try {
          const { settleShoutoutBySessionId } = await import("../routes/generate/shoutouts");
          const settled = await settleShoutoutBySessionId(s.id);
          if (!settled.found) {
            logger.warn({ sessionId: s.id }, "Stripe webhook: shoutout_request session has no request row (checkout row missing or already cleaned up)");
          }
          res.status(200).json({ received: true, kind: "shoutout_request" });
        } catch (shoutoutErr) {
          logger.error({ err: shoutoutErr, sessionId: s.id }, "Stripe webhook: shoutout settle failed");
          res.status(500).json({ error: "Shoutout settle failed, retry later" });
        }
        return;
      }
      if (s.metadata?.type === "gift_card_purchase") {
        /* Gift cards (WEBHOOK-SETTLE, stack1200): before this branch
           existed a paid gift-card session fell through the whole
           dispatch to the credit-grant tail — which logged "missing
           user_id in metadata" and answered 200 — so the card issued
           ONLY if the buyer's browser returned and the page called
           verify. A buyer who closed the tab after paying left the
           recipient with nothing: no card, no code, no delivery
           email, against money already taken. The settle runs the
           same issuance claim as verify (exactly-once under webhook
           replays and verify races) and sends the recipient's
           delivery email on the landed issuance. A settle failure
           500s so Stripe retries; it must NOT fall through to the
           credit logic. */
        if (s.payment_status !== "paid") {
          res.status(200).json({ received: true, kind: "gift_card_purchase", warning: "session not paid" });
          return;
        }
        try {
          const { settleGiftCardBySession } = await import("../routes/gift-cards");
          const settled = await settleGiftCardBySession(s, {
            buyerUserId: s.metadata?.["buyer_user_id"] ?? "",
          });
          if (settled.outcome === "unavailable") {
            logger.warn({ sessionId: s.id }, "Stripe webhook: gift-card settle deferred — gift card tables unavailable");
          } else if (settled.outcome !== "issued" && settled.outcome !== "duplicate") {
            logger.warn({ sessionId: s.id, outcome: settled.outcome }, "Stripe webhook: gift-card session did not settle");
          }
          res.status(200).json({ received: true, kind: "gift_card_purchase" });
        } catch (giftCardErr) {
          logger.error({ err: giftCardErr, sessionId: s.id }, "Stripe webhook: gift card settle failed");
          res.status(500).json({ error: "Gift card settle failed, retry later" });
        }
        return;
      }
      if (s.metadata?.purchase_kind === "membership") {
        /* Fan memberships (WEBHOOK-SETTLE, stack1200): before this
           branch existed a paid membership session (join, gift join,
           past-due renewal — all stamp purchase_kind "membership")
           fell through the whole dispatch to the credit-grant tail,
           which logged "missing user_id in metadata" and answered
           200 — so a join settled ONLY if the fan's browser returned
           and the page called verify. A fan who closed the tab after
           paying never became a member: money taken, no seat, no
           creator tell. The settle is verify's own core
           (settleMembershipSession), exactly-once via the session
           read-back + stripe_session_id unique index. Business
           rejections (tier deleted — already auto-refunded by the
           settle; amount mismatch) are terminal: warned 200, never
           retried into a different outcome. A 500-shaped settle
           (recording failure) 500s so Stripe retries; nothing here
           falls through to the credit logic. */
        if (s.payment_status !== "paid") {
          res.status(200).json({ received: true, kind: "membership", warning: "session not paid" });
          return;
        }
        try {
          const { settleMembershipSession } = await import("../routes/generate/memberships");
          const settled = await settleMembershipSession(s, {
            actingUserId: s.metadata?.["purchaser_user_id"] ?? "",
            fanEmailFallback: null,
          });
          if (settled.httpStatus === 500) {
            logger.error({ sessionId: s.id }, "Stripe webhook: membership settle failed");
            res.status(500).json({ error: "Membership settle failed, retry later" });
            return;
          }
          if (settled.httpStatus !== 200) {
            logger.warn({ sessionId: s.id, httpStatus: settled.httpStatus }, "Stripe webhook: membership session did not settle");
          }
          res.status(200).json({ received: true, kind: "membership" });
        } catch (membershipErr) {
          logger.error({ err: membershipErr, sessionId: s.id }, "Stripe webhook: membership settle failed");
          res.status(500).json({ error: "Membership settle failed, retry later" });
        }
        return;
      }
      if (s.metadata?.purchase_kind === "beat_license") {
        /* Beat licenses (WEBHOOK-SETTLE, stack1200): before this
           branch existed a paid beat-license session fell through
           the whole dispatch to the credit-grant tail, which logged
           "missing user_id in metadata" and answered 200 — so the
           license completed ONLY if the buyer's browser returned
           and the page called /beats/licenses/verify. A producer
           who closed the tab after paying kept a pending_payment
           license forever: money taken, no download, no stems. The
           settle is verify's own core (settleBeatLicenseSession),
           exactly-once via the exclusive beat-row claim and the
           status-guarded completion flip. Business rejections
           (beat deleted — already auto-refunded by the settle;
           amount mismatch; exclusive lost) are terminal: warned
           200. A 500-shaped settle (recording failure) 500s so
           Stripe retries; nothing here falls through to the credit
           logic. */
        if (s.payment_status !== "paid") {
          res.status(200).json({ received: true, kind: "beat_license", warning: "session not paid" });
          return;
        }
        try {
          const { settleBeatLicenseSession } = await import("../routes/generate/beats");
          const settled = await settleBeatLicenseSession(s, {
            buyerUserId: s.metadata?.["buyer_user_id"] ?? "",
          });
          if (settled.httpStatus === 500) {
            logger.error({ sessionId: s.id }, "Stripe webhook: beat license settle failed");
            res.status(500).json({ error: "Beat license settle failed, retry later" });
            return;
          }
          if (settled.httpStatus !== 200) {
            logger.warn({ sessionId: s.id, httpStatus: settled.httpStatus }, "Stripe webhook: beat license session did not settle");
          }
          res.status(200).json({ received: true, kind: "beat_license" });
        } catch (beatErr) {
          logger.error({ err: beatErr, sessionId: s.id }, "Stripe webhook: beat license settle failed");
          res.status(500).json({ error: "Beat license settle failed, retry later" });
        }
        return;
      }
      if (s.metadata?.purchase_kind === "live_shop") {
        /* Live shopping (WEBHOOK-SETTLE, stack1200): before this
           branch existed a paid live-shop session fell through the
           whole dispatch to the credit-grant tail, which logged
           "missing user_id in metadata" and answered 200 — so the
           sale recorded ONLY if the buyer's browser returned and
           the page called /live-shopping/verify. A viewer who
           closed the tab after paying was charged with no sale
           recorded: no delivery record, no overlay alert. The
           settle is verify's own core (settleLiveShopSession),
           exactly-once via the stripe_session_id unique index +
           read-back. Business rejections (product deleted —
           already auto-refunded by the settle; amount mismatch;
           Q150 stream ended, which auto-refunds an UNRECORDED
           session) are terminal: warned 200. A 500-shaped settle
           (recording failure) 500s so Stripe retries; nothing here
           falls through to the credit logic. */
        if (s.payment_status !== "paid") {
          res.status(200).json({ received: true, kind: "live_shop", warning: "session not paid" });
          return;
        }
        try {
          const { settleLiveShopSession } = await import("../routes/live-shopping");
          const settled = await settleLiveShopSession(s, {
            buyerUserId: s.metadata?.["buyer_user_id"] ?? "",
          });
          if (settled.httpStatus === 500) {
            logger.error({ sessionId: s.id }, "Stripe webhook: live shop settle failed");
            res.status(500).json({ error: "Live shop settle failed, retry later" });
            return;
          }
          if (settled.httpStatus !== 200) {
            logger.warn({ sessionId: s.id, httpStatus: settled.httpStatus }, "Stripe webhook: live shop session did not settle");
          }
          res.status(200).json({ received: true, kind: "live_shop" });
        } catch (liveShopErr) {
          logger.error({ err: liveShopErr, sessionId: s.id }, "Stripe webhook: live shop settle failed");
          res.status(500).json({ error: "Live shop settle failed, retry later" });
        }
        return;
      }
      if (s.metadata?.kind === "membership_gift") {
        /* Gift membership (payfix lane 9): a one-time payment granting
           the recipient a Pro/Elite window. Fulfillment claims on
           UNIQUE(stripe_session_id) inside lib/membership-gifts, so a
           webhook replay — or the buyer's verify landing first — grants
           exactly once and notifies the recipient exactly once. A
           fulfillment failure 500s so Stripe retries (the claim is
           retry-safe); it must NOT fall through to the credit logic. */
        if (s.payment_status !== "paid") {
          res.status(200).json({ received: true, kind: "membership_gift", warning: "session not paid" });
          return;
        }
        try {
          const { fulfillGiftMembership, isGiftTier } = await import("./membership-gifts");
          const meta = s.metadata ?? {};
          const tier = meta["tier"];
          const months = Number(meta["months"] ?? 0);
          if (!isGiftTier(tier) || !meta["sender_user_id"] || !meta["recipient_user_id"] || !meta["recipient_profile_id"] || !Number.isInteger(months) || months < 1 || months > 12) {
            logger.error({ sessionId: s.id }, "Stripe webhook: membership_gift session missing gift metadata");
            res.status(200).json({ received: true, kind: "membership_gift", warning: "Invalid gift metadata" });
            return;
          }
          const { duplicate } = await fulfillGiftMembership({
            sessionId: s.id,
            paymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : null,
            amountCents: s.amount_total,
            currency: s.currency,
            senderUserId: meta["sender_user_id"],
            recipientUserId: meta["recipient_user_id"],
            recipientProfileId: meta["recipient_profile_id"],
            tier,
            months,
          });
          res.status(200).json({ received: true, kind: "membership_gift", duplicate });
        } catch (giftErr) {
          logger.error({ err: giftErr, sessionId: s.id }, "Stripe webhook: membership gift fulfillment failed");
          res.status(500).json({ error: "Membership gift fulfillment failed, retry later" });
        }
        return;
      }
      if (s.metadata?.kind === "creator_tier") {
        const { handleTierCheckoutCompleted } = await import("./creator-tier-sync");
        await handleTierCheckoutCompleted(s);
        res.status(200).json({ received: true, kind: "creator_tier" });
        return;
      }
      if (s.metadata?.kind === "creator_hosting") {
        const { handleHostingCheckoutCompleted } = await import("./creator-tier-sync");
        await handleHostingCheckoutCompleted(s);
        res.status(200).json({ received: true, kind: "creator_hosting" });
        return;
      }
    } else if (event.type === "checkout.session.expired") {
      const s = event.data.object as Stripe.Checkout.Session;
      /* Escrow funding sessions (stack1400 item 5): an abandoned /
         expired funding Checkout used to leave the deal / booking in
         'funding' forever — re-fund refused, nothing freed it. Free
         the row back to 'unfunded' through the rail's guarded flip
         (it only lands while the row is still 'funding' AND still
         carries THIS session id, so replays and stale expiries for a
         superseded session change nothing, and a funded row can
         never be freed). A release failure 500s so Stripe retries —
         silently dropping it would strand the item again. */
      if (s.metadata?.sponsor_deal_id) {
        try {
          const { freeSponsorEscrowFundingForSession } = await import("../routes/generate/sponsors");
          const freed = await freeSponsorEscrowFundingForSession(s.metadata.sponsor_deal_id, s.id);
          res.status(200).json({ received: true, kind: "sponsor_escrow", expired: true, freed });
        } catch (expiredErr) {
          logger.error({ err: expiredErr, sessionId: s.id }, "Stripe webhook: sponsor escrow expiry release failed");
          res.status(500).json({ error: "Sponsor escrow expiry release failed, retry later" });
        }
        return;
      }
      if (s.metadata?.performance_booking_id) {
        try {
          const { freePerformanceEscrowFundingForSession } = await import("../routes/performance-bookings");
          const freed = await freePerformanceEscrowFundingForSession(s.metadata.performance_booking_id, s.id);
          res.status(200).json({ received: true, kind: "performance_escrow", expired: true, freed });
        } catch (expiredErr) {
          logger.error({ err: expiredErr, sessionId: s.id }, "Stripe webhook: performance escrow expiry release failed");
          res.status(500).json({ error: "Performance escrow expiry release failed, retry later" });
        }
        return;
      }
      /* An abandoned Marketplace checkout: label its pending lines
         expired — they never become sales (0144). */
      if (s.metadata?.type === "marketplace_shop_purchase") {
        const { markMarketSaleExpired } = await import("./market-sale");
        await markMarketSaleExpired(s.id);
        res.status(200).json({ received: true, kind: "marketplace_shop_purchase", expired: true });
        return;
      }
      /* An abandoned store / storefront checkout: those rails write
         nothing when a checkout starts, so this event is the only
         trace. File it for the abandoned-checkout email automation
         (migration 0204) — the recorder classifies from the session
         metadata the checkout routes stamped (buyer_user_id +
         profile_id) and dedupes per session, so webhook replays land
         exactly once. Sessions it doesn't recognize fall through
         unrecorded, exactly as before. */
      const { recordAbandonedStripeCheckout } = await import("./email-automations");
      if (await recordAbandonedStripeCheckout(s)) {
        res.status(200).json({ received: true, kind: "abandoned_checkout", expired: true });
        return;
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.kind === "creator_tier") {
        const { handleTierSubscriptionEvent } = await import("./creator-tier-sync");
        await handleTierSubscriptionEvent(sub, event.id);
        res.status(200).json({ received: true, kind: "creator_tier" });
        return;
      }
      if (sub.metadata?.kind === "creator_hosting") {
        const { handleHostingSubscriptionEvent } = await import("./creator-tier-sync");
        await handleHostingSubscriptionEvent(sub);
        res.status(200).json({ received: true, kind: "creator_hosting" });
        return;
      }
    } else if (event.type === "invoice.paid") {
      /* Renewal receipt row for the tier subscription (payfix
         upgrade-path) — exactly once per invoice id. */
      const inv = event.data.object as Stripe.Invoice;
      const { handleTierInvoicePaid } = await import("./creator-tier-sync");
      await handleTierInvoicePaid(inv);
      res.status(200).json({ received: true, kind: "creator_tier" });
      return;
    } else if (event.type === "invoice.payment_failed") {
      const inv = event.data.object as Stripe.Invoice;
      const { handleTierInvoiceFailed } = await import("./creator-tier-sync");
      await handleTierInvoiceFailed(inv);
      res.status(200).json({ received: true, kind: "creator_tier" });
      return;
    } else if (event.type === "account.updated" || (event.type as string).startsWith("v2.core.account")) {
      /* Stripe Connect: keep the creator profile's onboarding flags in sync
         with the Express account's capability state. The classic endpoint
         delivers v1-shaped account.updated payloads; v2 accounts emit
         v2.core.account.updated (plus v2.core.account[requirements].updated
         and friends, whose payloads may be thin — id only). The sync
         helper is shape-tolerant: it parses either full shape and
         re-fetches live when a payload carries no capability signal,
         so a verified seller flips automatically whichever door the
         event came through (payfix payout-build). */
      const acct = event.data.object as unknown as ConnectAccountLike;
      const { syncConnectAccountStatus } = await import("./stripe-connect");
      await syncConnectAccountStatus(acct);
      res.status(200).json({ received: true, kind: "connect_account" });
      return;
    }
  } catch (err) {
    logger.error({ err, type: event.type }, "Stripe webhook: creator tier sync failed");
    // Fall through to the standard flow rather than 500ing Stripe's retry.
  }

  /* ── Refunds + chargebacks: claw back what the payment granted (D1) ────
     charge.refunded (a refund, possibly partial, possibly one of
     several) and charge.dispute.closed with status 'lost' (the bank
     took the full amount back) both reverse the original grant via
     lib/payment-reversals, keyed off the payment/grant records.
     Idempotency lives in the engine's insert-first claim on
     payment_reversals — a replayed event is a duplicate, never a
     double clawback. Outcomes: reversed/duplicate/manual-review →
     200 (a manual-review charge cannot be fixed by a retry);
     in-flight or a thrown failure → 500 so Stripe retries into the
     engine's reclaim path. Disputes closed any other way (won,
     warning_closed) reverse nothing. */
  if (event.type === "charge.refunded" || event.type === "charge.dispute.closed") {
    try {
      const { processStripeChargeReversal } = await import("./payment-reversals");
      let result;
      if (event.type === "charge.refunded") {
        const charge = event.data.object as Stripe.Charge;
        result = await processStripeChargeReversal({
          stripe,
          eventId: event.id,
          trigger: "charge.refunded",
          charge,
        });
      } else {
        const dispute = event.data.object as Stripe.Dispute;
        if (dispute.status !== "lost") {
          res.status(200).json({ received: true, dispute: dispute.status });
          return;
        }
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        if (!chargeId) {
          logger.error({ disputeId: dispute.id }, "Stripe webhook: lost dispute carries no charge id — cannot reverse");
          res.status(200).json({ received: true, warning: "Lost dispute without a charge id" });
          return;
        }
        const charge = await stripe.charges.retrieve(chargeId);
        result = await processStripeChargeReversal({
          stripe,
          eventId: event.id,
          trigger: "charge.dispute.closed",
          charge,
          disputeLost: true,
        });
      }
      if (result.outcome === "inflight") {
        // Another worker owns this reversal — 500 so Stripe retries after it settles.
        res.status(500).json({ error: "Reversal in flight, retry later" });
        return;
      }
      if (result.outcome === "duplicate") {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      if (result.outcome === "manual_review") {
        res.status(200).json({ received: true, warning: "Reversal needs manual review", rail: result.rail });
        return;
      }
      res.status(200).json({
        received: true,
        reversed: true,
        rail: result.rail,
        creditsClawed: result.creditsClawed,
        shortfallCredits: result.shortfallCredits,
      });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, type: event.type }, "Stripe webhook: charge reversal failed");
      // 500 so Stripe retries (P0-7) — the engine marked its claim failed.
      res.status(500).json({ error: `Charge reversal failed: ${msg}` });
    }
    return;
  }

  if (event.type === "payment_intent.succeeded") {
    /* ── Express Pay (Apple Pay / Google Pay) ─────────────────────────────
       P0-8: previously fulfillment depended solely on the client calling
       /payments/express/verify. If the tab closed after the charge, money
       was taken but no credits were granted. This webhook branch grants
       server-side, sharing idempotency with /verify via the PI id. */
    const pi = event.data.object as Stripe.PaymentIntent;
    /* ── Sponsor escrow (on-site PaymentIntent funding) ──────────────────
       The profile Sponsor flow funds escrow with a PaymentIntent
       (metadata.sponsor_deal_id) confirmed on-site; the client then
       calls POST /api/sponsors/escrow/verify. If the tab closed first,
       this branch settles the same way — markEscrowFunded is idempotent
       and both paths key the funding on the PaymentIntent id, so the
       escrow settles exactly once. */
    if (pi.metadata?.sponsor_deal_id) {
      const dealId = pi.metadata.sponsor_deal_id;
      try {
        const { markEscrowFunded } = await import("../routes/generate/sponsors");
        const result = await markEscrowFunded(dealId, pi.id, pi.id);
        if (!result.ok && result.reason !== "already-funded") {
          logger.warn({ dealId, reason: result.reason }, "Stripe webhook: sponsor PI escrow not applied");
          res.status(200).json({ received: true, warning: `Escrow not applied: ${result.reason}` });
          return;
        }
        res.status(200).json({ received: true, success: true, escrow: "funded" });
      } catch (err: unknown) {
        const msg = (err as { message?: string })?.message ?? "unknown";
        logger.error({ err, msg, dealId }, "Stripe webhook: sponsor PI escrow funding failed");
        // 500 so Stripe retries — silently dropping a paid escrow is worse.
        res.status(500).json({ error: `Sponsor escrow funding failed: ${msg}` });
      }
      return;
    }
    /* Embedded checkout (2026-10-26): credit-pack PaymentIntents from
       the on-site PaymentElement flow carry source="embedded_checkout"
       + kind="credit_pack" and fulfill through this SAME branch —
       identical metadata fields, identical PI-id idempotency key into
       fulfillCreditPurchase, identical referral award below. */
    const isEmbeddedCreditPack =
      pi.metadata?.source === "embedded_checkout" && pi.metadata?.kind === "credit_pack";
    if (pi.metadata?.source !== "express_pay" && !isEmbeddedCreditPack) {
      res.status(200).json({ received: true });
      return;
    }
    const userId = pi.metadata?.user_id;
    const creditsAmount = parseInt(pi.metadata?.credits_amount ?? "0", 10);
    const creditPack = pi.metadata?.credit_pack ?? "express";
    if (!userId || !creditsAmount || creditsAmount <= 0) {
      logger.error({ piId: pi.id }, "Stripe webhook: express_pay PI missing user_id/credits_amount");
      res.status(200).json({ received: true, warning: "Invalid express_pay metadata" });
      return;
    }
    try {
      const result = await fulfillCreditPurchase({
        idempotencyKey: pi.id,
        stripePaymentIntentId: pi.id,
        userId,
        creditPack,
        creditsAmount,
        amountTotal: pi.amount,
        currency: pi.currency,
      });
      if (result.outcome === "duplicate") {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      if (result.outcome === "inflight") {
        // Another worker is granting — 500 so Stripe retries after it settles.
        res.status(500).json({ error: "Grant in flight, retry later" });
        return;
      }
      await awardReferralPayout(userId, creditsAmount, pi.id);
      res.status(200).json({ received: true, success: true, credits: result.newCredits });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, piId: pi.id, userId }, "Stripe webhook: express_pay grant failed");
      // 500 → Stripe retries. fulfillCreditPurchase marked the row failed.
      res.status(500).json({ error: `Express grant failed: ${msg}` });
    }
    return;
  }

  if (event.type !== "checkout.session.completed") {
    res.status(200).json({ received: true });
    return;
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== "paid") {
    logger.info({ sessionId: session.id, status: session.payment_status }, "Stripe webhook: session not paid, skipping");
    res.status(200).json({ received: true });
    return;
  }

  // ── IDEMPOTENCY: insert-first claiming (see claimStripePayment) ──────────
  // The old check-then-insert had a race: webhook + dashboard verify could
  // both pass the check and double-grant. Claiming is now done atomically
  // inside fulfillCreditPurchase() below. No pre-check here.
  // ─────────────────────────────────────────────────────────────────────────

  // ── SPONSOR ESCROW ────────────────────────────────────────────────────
  // Brands fund sponsorship deals through Checkout with
  // metadata.sponsor_deal_id set. This path owns the money; it never
  // touches credits. Idempotency is handled inside markEscrowFunded.
  if (session.metadata?.sponsor_deal_id) {
    const dealId = session.metadata.sponsor_deal_id;
    logger.info({ dealId, sessionId: session.id }, "Stripe webhook: sponsor escrow payment verified");
    try {
      const { markEscrowFunded } = await import("../routes/generate/sponsors");
      const result = await markEscrowFunded(
        dealId,
        session.id,
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      );
      if (!result.ok) {
        logger.warn({ dealId, reason: result.reason }, "Stripe webhook: escrow funding not applied");
        res.status(200).json({ received: true, warning: `Escrow not applied: ${result.reason}` });
        return;
      }
      res.status(200).json({ received: true, success: true, escrow: "funded" });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, dealId }, "Stripe webhook: escrow funding failed");
      // P0-7: 500 so Stripe retries — 200 would silently drop a paid escrow.
      res.status(500).json({ error: `Escrow funding failed: ${msg}` });
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── PERFORMANCE BOOKING ESCROW (#158) ───────────────────────────────
  // Promoters fund Book-the-Artist fees through Checkout with
  // metadata.performance_booking_id set. Same ownership shape as
  // sponsor escrow: this path owns the money; it never touches
  // credits. Idempotency is handled inside markPerformanceEscrowFunded.
  if (session.metadata?.performance_booking_id) {
    const bookingId = session.metadata.performance_booking_id;
    logger.info({ bookingId, sessionId: session.id }, "Stripe webhook: performance escrow payment verified");
    try {
      const { markPerformanceEscrowFunded } = await import("../routes/performance-bookings");
      const result = await markPerformanceEscrowFunded(
        bookingId,
        session.id,
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      );
      if (!result.ok) {
        logger.warn({ bookingId, reason: result.reason }, "Stripe webhook: performance escrow funding not applied");
        res.status(200).json({ received: true, warning: `Performance escrow not applied: ${result.reason}` });
        return;
      }
      res.status(200).json({ received: true, success: true, escrow: "funded" });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, bookingId }, "Stripe webhook: performance escrow funding failed");
      // P0-7 twin: 500 so Stripe retries — 200 would silently drop a paid escrow.
      res.status(500).json({ error: `Performance escrow funding failed: ${msg}` });
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── DIGITAL STORE AUTO-REFUND (stack900) ──────────────────────────
  // Digital-store sessions (routes/store.ts checkout stamps
  // buyer_user_id + profile_id + item_kind + item_id; storefront
  // sessions carry product_id instead and never match this) used to
  // fall through this dispatch untouched: their only refund trigger
  // was the buyer returning to /store/verify, so a buyer who never
  // came back stranded their money when the item turned undeliverable.
  // Now the webhook asks the store's own probe and, when a refund is
  // due, fires the SAME idempotent helper verify's rail uses —
  // refundCheckoutSessionPayment keys the Stripe refund
  // refund:<sessionId>, exactly the key verify's inline refund uses,
  // so webhook-then-verify, verify-then-webhook, and webhook replays
  // can never double-refund. Deliverable items answer "not due" and
  // settle through verify's own core below (WEBHOOK-SETTLE,
  // stack1200 — fulfillment no longer waits for the buyer's return).
  const storeMeta = session.metadata ?? {};
  if (storeMeta["buyer_user_id"] && storeMeta["profile_id"] && storeMeta["item_kind"] && storeMeta["item_id"]) {
    const itemKind = storeMeta["item_kind"];
    const itemId = storeMeta["item_id"];
    try {
      const { isStoreSessionAutoRefundDue } = await import("../routes/store");
      const refundDue = await isStoreSessionAutoRefundDue(session.id, itemKind, itemId);
      if (!refundDue) {
        /* Deliverable purchase (WEBHOOK-SETTLE, stack1200): this
           branch used to answer 200 here and leave fulfillment to
           the buyer's verify return — a buyer who closed the tab
           after paying got no sale recorded: no download link, no
           license keys, no bundle grants, no seller tell. Now the
           webhook settles through verify's own core
           (settleDigitalStoreSession), exactly-once via the
           digital_sales ON CONFLICT claim + read-back. The settle's
           refunded-payment guard needs the charge witness, so the
           session is re-retrieved WITH the
           payment_intent.latest_charge expansion, exactly as
           verify retrieves it; a retrieve failure 500s (Stripe
           retries) rather than settling on a half-witnessed
           session. Business rejections (buyer/amount/add-on
           mismatches; the fully-refunded refusal) are terminal:
           warned 200. A 500-shaped settle 500s for retry. */
        try {
          /* A sale already recorded (verify won the race, or a
             replay) never re-enters the settle: the settle
             re-resolves the item BEFORE its duplicate read-back,
             so a delivered purchase whose item was since deleted
             would be refunded by the settle's undeliverable path —
             the stack900 "never refund a delivered purchase"
             invariant, enforced here the same way the probe
             enforces it on the refund side. */
          const { storeSessionSaleExists } = await import("../routes/store");
          if (await storeSessionSaleExists(session.id)) {
            res.status(200).json({ received: true, kind: "digital_store", duplicate: true });
            return;
          }
          const expanded = await stripe.checkout.sessions.retrieve(session.id, {
            expand: ["payment_intent.latest_charge"],
          });
          if (expanded.payment_status !== "paid") {
            res.status(200).json({ received: true, kind: "digital_store", warning: "session not paid" });
            return;
          }
          const { settleDigitalStoreSession } = await import("../routes/store");
          const settled = await settleDigitalStoreSession(expanded, {
            userId: storeMeta["buyer_user_id"],
            email: null,
          });
          if (settled.httpStatus === 500) {
            logger.error({ sessionId: session.id }, "Stripe webhook: digital store settle failed");
            res.status(500).json({ error: "Digital store settle failed, retry later" });
            return;
          }
          if (settled.httpStatus !== 200) {
            logger.warn({ sessionId: session.id, httpStatus: settled.httpStatus }, "Stripe webhook: digital store session did not settle");
          }
          res.status(200).json({ received: true, kind: "digital_store" });
        } catch (storeSettleErr: unknown) {
          const msg = (storeSettleErr as { message?: string })?.message ?? "unknown";
          logger.error({ err: storeSettleErr, msg, sessionId: session.id }, "Stripe webhook: digital store settle failed");
          res.status(500).json({ error: "Digital store settle failed, retry later" });
        }
        return;
      }
      const { refundCheckoutSessionPayment } = await import("./stripe-checkout");
      const refunded = await refundCheckoutSessionPayment(session);
      if (refunded) {
        logger.error({ sessionId: session.id, itemKind, itemId }, "Stripe webhook: store item undeliverable after payment — auto-refunded without waiting for verify");
        /* The buyer tell (stack900 join — L4 join item J1): this
           refund path exists for the buyer who never came back, so
           without a tell they would simply never learn their money
           moved. Exactly-once rides the job-notifications UNIQUE
           gate with jobId refund:<sessionId> — the same key the
           refund itself carries: that key space is free here (this
           branch only refunds sessions with NO digital_sales row, so
           no sale finale ever claimed it), and the helper returns
           true on idempotent replays too, so the claim — never the
           refund result — is what gates the tell. A replayed webhook
           therefore tells at most once. Best-effort like every money
           finale: a tell failure never fails the webhook. */
        try {
          const { createJobNotification } = await import("./job-notifications");
          const { storeItemTitleForRefundTell, storeItemKindNoun } = await import("../routes/store");
          const itemTitle = await storeItemTitleForRefundTell(itemKind, itemId);
          const itemName = itemTitle ? `“${itemTitle}”` : `Your ${storeItemKindNoun(itemKind)}`;
          const tellTitle = "Your payment was refunded";
          const tellMessage = `${itemName} is no longer for sale, so your payment has been refunded in full.`;
          const claimed = await createJobNotification({
            jobType: "sale",
            jobId: `refund:${session.id}`,
            userId: storeMeta["buyer_user_id"],
            status: "completed",
            title: tellTitle,
            message: tellMessage,
          });
          if (claimed) {
            const { notifyUserEvent } = await import("./push-events");
            await notifyUserEvent({
              userId: storeMeta["buyer_user_id"],
              category: "money",
              kind: "refund",
              title: tellTitle,
              body: tellMessage,
              link: "/library",
            });
          }
        } catch (tellErr: unknown) {
          const tellMsg = (tellErr as { message?: string })?.message ?? "unknown";
          logger.error({ err: tellErr, msg: tellMsg, sessionId: session.id }, "Stripe webhook: store auto-refund buyer tell failed (non-fatal)");
        }
      } else {
        logger.error({ sessionId: session.id, itemKind, itemId }, "Stripe webhook: store item undeliverable after payment but the auto-refund did NOT land — reconcile manually");
      }
      res.status(200).json({ received: true, kind: "digital_store", refunded });
    } catch (err: unknown) {
      /* A probe failure (e.g. the DB hiccuped) is TRANSIENT: refunding
         on a guess could hand back money for a deliverable purchase,
         and a 500 would start a retry storm over a session verify
         still owns. Log loudly, answer 200, and leave the session to
         the buyer's verify — which re-probes and refunds there. */
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, sessionId: session.id }, "Stripe webhook: store auto-refund probe failed — no refund fired");
      res.status(200).json({ received: true, kind: "digital_store", warning: "auto-refund probe failed" });
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── STOREFRONT SETTLE (WEBHOOK-SETTLE, stack1200) ────────────────
  // Storefront sessions (routes/storefront.ts checkout stamps
  // metadata type "storefront_purchase" + product_id; digital-store
  // sessions never match — they were handled by the branch above)
  // used to fall through this dispatch untouched: the order recorded
  // ONLY if the buyer's browser returned and the page called
  // /storefront/verify. A buyer who closed the tab after paying had
  // no order recorded — no delivery, no download token, no seller
  // tell, no co-seller splits. Now the webhook runs verify's own
  // settle (settleStorefrontSession), exactly-once via the
  // stripe_session_id UNIQUE index + the existing-order read-back:
  // a replayed delivery returns the recorded order with no new side
  // effects. Business rejections (buyer/amount/add-on mismatches)
  // are terminal: warned 200. The SOLD_OUT 409 is likewise terminal
  // here — its buyer-facing refund/restock conversation belongs to
  // the buyer's own verify return, and Stripe retries cannot restock
  // an item. A 500-shaped settle (recording failure) 500s so Stripe
  // retries; nothing here falls through to the credit logic.
  if (session.metadata?.["type"] === "storefront_purchase") {
    if (session.payment_status !== "paid") {
      res.status(200).json({ received: true, kind: "storefront_purchase", warning: "session not paid" });
      return;
    }
    try {
      const { settleStorefrontSession } = await import("../routes/storefront");
      const settled = await settleStorefrontSession(session, {
        buyerUserId: session.metadata?.["buyer_user_id"] ?? "",
      });
      if (settled.httpStatus === 500) {
        logger.error({ sessionId: session.id }, "Stripe webhook: storefront settle failed");
        res.status(500).json({ error: "Storefront settle failed, retry later" });
        return;
      }
      if (settled.httpStatus !== 200) {
        logger.warn({ sessionId: session.id, httpStatus: settled.httpStatus }, "Stripe webhook: storefront session did not settle");
      }
      res.status(200).json({ received: true, kind: "storefront_purchase" });
    } catch (storefrontErr: unknown) {
      const msg = (storefrontErr as { message?: string })?.message ?? "unknown";
      logger.error({ err: storefrontErr, msg, sessionId: session.id }, "Stripe webhook: storefront settle failed");
      res.status(500).json({ error: "Storefront settle failed, retry later" });
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  const userId = session.metadata?.user_id;
  const creditPack = session.metadata?.credit_pack ?? "unknown";
  const creditsAmount = parseInt(session.metadata?.credits_amount ?? "0", 10);

  logger.info({ userId, creditPack, creditsAmount, sessionId: session.id }, "Stripe webhook: payment verified");

  if (!userId) {
    logger.error({ sessionId: session.id }, "Stripe webhook: missing user_id in session metadata");
    res.status(200).json({ received: true, warning: "Missing user_id in metadata" });
    return;
  }

  logger.info({ userId }, "Stripe webhook: user_id found");

  /* ── Branding-shop merch orders ─────────────────────────────────────────
     Branding checkout sessions carry metadata.kind = "branding_order" +
     branding_order_id. Mark the order paid and submit it to fulfillment
     (Printful live or mock sandbox).

     Idempotency: insert-first claiming on stripe_payments, the same
     pattern as the credit path below (P0-24 hardening). The payment row
     is claimed BEFORE any fulfillment, keyed on the session id (UNIQUE),
     with the same values the old trailing recordStripePayment() wrote.
     Previously this branch fulfilled FIRST and recorded LAST, and its
     only duplicate guard was fulfillBrandingOrder's check-then-act on
     provider_order_id: concurrent redeliveries could both pass that
     check and submit two real provider orders, and sequential
     redeliveries re-ran confirmBrandingFulfillment (an unconditional
     provider confirm POST) and then threw on the payment insert's
     UNIQUE constraint — a 500 loop, not a no-op. Now: only the claim
     winner fulfills; a completed claim → 200 duplicate; an active claim
     → 500 so Stripe retries after it settles; a fulfillment failure
     marks the claim failed → 500 → the retry reclaims and re-fulfills
     (fulfillBrandingOrder still early-returns once provider_order_id
     is set, so a retry after a partial success resumes, not repeats). */
  if (session.metadata?.kind === "branding_order" && session.metadata?.branding_order_id) {
    const brandingOrderId = session.metadata.branding_order_id;

    let claim: PaymentClaimOutcome;
    try {
      claim = await claimStripePayment({
        stripeSessionId:       session.id,
        stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        userId,
        creditPack:            `branding_order:${brandingOrderId}`,
        creditsAmount:         0,
        amountTotal:           session.amount_total,
        currency:              session.currency,
      });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, brandingOrderId }, "Stripe webhook: branding payment claim failed");
      // Fail closed (P0-7): 500 so Stripe retries — never fulfill unclaimed.
      res.status(500).json({ error: `Branding payment claim failed: ${msg}` });
      return;
    }

    if (claim === "duplicate") {
      logger.info({ brandingOrderId, sessionId: session.id }, "Stripe webhook: duplicate branding payment ignored — already completed");
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (claim === "inflight") {
      logger.warn({ brandingOrderId, sessionId: session.id }, "Stripe webhook: branding fulfillment already in flight elsewhere");
      // Another worker owns the claim — 500 so Stripe retries after it settles.
      res.status(500).json({ error: "Branding fulfillment in flight, retry later" });
      return;
    }

    // We won the claim — fulfill, then mark the payment completed.
    try {
      const { markBrandingOrderPaid, fulfillBrandingOrder, confirmBrandingFulfillment } = await import("./branding-fulfillment");
      await markBrandingOrderPaid(brandingOrderId, session.id);
      const fulfillment = await fulfillBrandingOrder(brandingOrderId);
      await confirmBrandingFulfillment(brandingOrderId);
      await markPaymentCompleted(session.id);
      logger.info(
        { brandingOrderId, sessionId: session.id, fulfillment },
        "Stripe webhook: branding order paid + submitted to fulfillment"
      );
      res.status(200).json({ received: true, success: true, brandingOrderId });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      // We own the claim, so marking it failed is safe: a Stripe retry
      // reclaims the failed row and re-runs fulfillment.
      await markPaymentFailed(session.id).catch(() => {});
      logger.error({ err, msg, brandingOrderId }, "Stripe webhook: branding order fulfillment failed");
      // P0-7: 500 so Stripe retries — 200 would silently drop a paid order.
      res.status(500).json({ error: `Branding fulfillment failed: ${msg}` });
    }
    return;
  }

  if (!creditsAmount || creditsAmount <= 0) {
    logger.error({ sessionId: session.id, creditsAmount }, "Stripe webhook: invalid credits_amount in metadata");
    res.status(200).json({ received: true, warning: "Invalid credits_amount in metadata" });
    return;
  }

  logger.info({ creditsAmount }, "Stripe webhook: credits_amount found");

  /* ── Grant via insert-first claiming (P0-7, P0-9, P0-24) ─────────────────
     fulfillCreditPurchase(): claims the payment row FIRST (insert with
     status='processing'), then grants atomically, then marks completed.
     - Crash between claim and grant → row stays processing/failed → retry
       reclaims it. No double-grant on redelivery (P0-24).
     - Grant failure → row marked failed → we 500 → Stripe retries (P0-7).
     - Concurrent webhook + dashboard verify → only the claim winner grants
       (P0-9). */
  try {
    const result = await fulfillCreditPurchase({
      idempotencyKey: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      userId,
      creditPack,
      creditsAmount,
      amountTotal: session.amount_total,
      currency: session.currency,
    });

    if (result.outcome === "duplicate") {
      logger.info({ sessionId: session.id }, "Stripe webhook: duplicate payment ignored — already completed");
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (result.outcome === "inflight") {
      logger.warn({ sessionId: session.id }, "Stripe webhook: grant already in flight elsewhere");
      res.status(500).json({ error: "Grant in flight, retry later" });
      return;
    }

    // Referral revenue share: 25% of purchased credits to the referrer
    // (idempotent — retried webhooks can't double-pay).
    const referralAwarded = await awardReferralPayout(userId, creditsAmount, session.id);

    res.status(200).json({ received: true, success: true, credits: result.newCredits, referralAwarded });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, userId, creditsAmount }, "Stripe webhook: credit grant failed");
    // P0-7: 500 so Stripe retries. fulfillCreditPurchase marked the row failed.
    res.status(500).json({ error: `Credit grant failed: ${msg}` });
  }
}
