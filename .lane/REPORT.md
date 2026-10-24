# #21 Dunning — lane report (stack29/dunning, base f96d7b72)

## Gap verification
Confirmed in source: past_due was counted (Memberships desk, command.ts) and
flagged (creator-tier-sync on invoice.payment_failed) but never worked — no
recovery sequence, no fan card-update door, no recovery view. The email rail
had winback for canceled/expired only. Fan memberships hold NO Stripe
customer/subscription (one-period hosted checkouts, lib/stripe-checkout), so
the billing-portal pattern (creator-tiers) does not apply to them; the honest
fan door is a fresh Stripe-hosted checkout where the fan enters the new card.

## Built
1. Recovery sequence on the email-automation rail — new kind
   `membership_payment_recovery` (kind is TEXT per migration 0198: NO
   migration needed, none written). lib/dunning.ts (pure): grace 7 days;
   steps notice +0h / reminder +72h / card nudge +120h / final warning
   +144h (one day BEFORE access ends). Per-episode trigger refs
   (`member:<id>:past_due:<episode>:<step>`), step copy overrides into
   carrier campaigns (step 1 uses the creator-editable automation copy),
   and a gateAt fix so the enabled-at gate measures the FAILURE, not the
   step's due time. i18n label/note/defaults in all 10 locales.
2. Fan card-update door — POST /memberships/mine/:memberId/update-payment
   (fan-scoped 404, 409 when not past due): identical metadata/amount-lock/
   idempotency shape to a join checkout; marks NOTHING paid — /verify alone
   reactivates after Stripe confirms. Free tiers reactivate directly.
   Memberships page: red past-due banner with the exact pause date + days
   left and an "Update card & renew" button.
3. Creator Recovery view — GET /memberships/recovery + "Payment recovery"
   section in the Memberships desk: past-due members joined with the claim
   ledger (steps actually sent, last step, grace end, state
   in_grace/recovered/access_ended/ended_other) and an explicit warning
   when the recovery automation is not switched on.
4. Grace honesty in effectiveMemberStatus: a paid past_due seat reads
   "expired" once the 7-day grace runs out unpaid — the exact date stated
   in advance. Manual rows (fan_user_id null) never auto-expire.

## Tests (all sequential, --maxWorkers=1, TMPDIR=.lane/tmp; logs in .lane/logs/)
Final combined run (final-api-suites.log): 8 files, 187 tests, ALL PASS —
dunning 18, email-automation-i18n 32, email-automations 36 (incl. 3 new
dunning runner tests), memberships-dunning 7 (new), memberships-payments 16,
memberships-management 11, operator-knowledge 62, stripe-webhook-abandoned 5.
Frontend related suites (fe-related.log): 56/56.
Typechecks: api-server exit 0 (tsc-api.log), frontend exit 0 (tsc-web.log).
lib/db + lib/api-zod dists rebuilt in-worktree.

## Parked / notes
- Creator-tier subscriptions (creator_subscriptions / creator_hosting
  past_due from invoice.payment_failed) already have a billing-portal door
  (POST /creator-tiers/portal) and are a different rail (the creator's own
  platform subscription, not fan memberships); out of this item's scope.
- "Past due since" = fan_members.updated_at (the row's last status change);
  documented in lib/dunning.ts. A dedicated failed-at column would need a
  migration and was not required for correctness of the chase/grace.
- No push performed. No deletions. No prices/fees invented or changed.
