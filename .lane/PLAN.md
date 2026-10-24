# Stack-100 #3 — #21 Dunning (membership payment recovery)

## Gap verification (2026-10-23, source-grepped on stack28/integration @ f96d7b72)
- `past_due` exists only as a status: fan_members status enum; memberships dashboard
  counts it; routes/command.ts counts it; creator-tier-sync flags creator_subscriptions
  + creator_hosting past_due on invoice.payment_failed. NOTHING works the list:
  no recovery emails, no card-update door for a fan membership, no recovery view.
- Email rail: lib/email-automations.ts has 3 kinds (post_purchase, abandoned_checkout,
  membership_winback = canceled/expired fan_members). NO failed-payment kind.
- email_automations.kind is plain TEXT (migration 0198, no CHECK) → a 4th kind
  needs NO migration. fan_members has no stripe_customer_id/subscription: joins are
  one-period Stripe-hosted checkouts (lib/stripe-checkout, mode "payment"), renewed
  by a fresh checkout + /memberships/verify. So the fan card-update door is a
  Stripe-hosted renewal checkout (fan enters the new card there) — never raw cards.
  The billing-portal pattern (routes/creator-tiers.ts POST /creator-tiers/portal)
  exists for creator-tier subscriptions, which fan memberships are not.

## Design
- Grace: DUNNING_GRACE_DAYS = 7 (mirrors the house 7-day trial length). past_due
  since = fan_members.updated_at (the row's last status change). After grace, a paid
  past_due row (fan_user_id set) reads "expired" via effectiveMemberStatus — access
  ends exactly at the date the fan was told, never before, never silently.
  Manual rows (fan_user_id null) never auto-expire: no payment rail exists for them.
- Sequence (kind `membership_payment_recovery`, riding email-automations):
  step 1 payment_failed_notice @ +0h, step 2 payment_reminder @ +72h,
  step 3 card_update_nudge @ +120h, step 4 final_warning @ +144h (access ends +168h).
  Each step is its own trigger ref `member:<id>:past_due:<episode>:<step>` where
  episode = pastDueSince ISO — a NEW failure episode re-arms the sequence, the
  claim ledger still dedupes within an episode. Step eventAt = due time, so the
  runner's enabled-at + delay gates work unchanged (seeded delayHours = 0).
  Per-step subject/body ride a trigger override into the carrier campaign.
- Fan door: POST /memberships/mine/:memberId/update-payment — fan-scoped (404 for
  anyone else's seat), only from effective past_due; creates the SAME checkout
  shape as POST /memberships/checkout (metadata + amount lock + idempotency scope)
  so /verify reactivates the seat only when Stripe confirms paid. Free tier
  reactivates directly with a fresh period (no payment to take).
- Creator Recovery view: GET /memberships/recovery + a section in the Memberships
  desk: past-due members (since, access-ends date, steps sent n/4, last step,
  state in_grace / recovered / access_ended) joined from email_automation_sends.
- i18n: new kind label/note/defaults in all 10 server locales (delayHours 0).

## Farm (hazard-corrected)
node_modules farmed from MAIN checkout ~/workspace/bow-down-visuals (NOT
bdv-wt-integration — its frontend node_modules is ELOOP-corrupt).
@workspace/db + @workspace/api-zod in artifacts/api-server/node_modules resolve
(readlink -f) into THIS worktree's lib/. TMPDIR=.lane/tmp for all runs.
