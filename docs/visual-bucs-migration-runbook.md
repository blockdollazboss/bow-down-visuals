# Visual Bucs ×100 — Staging Deploy & Data Migration Runbook

**Date:** 2026-10-01
**Branch:** `staging` @ `134da98` (merge of `feature/website-chatbot`)
**Goal:** get the merged code live on the staging URL with balances/prices in hundreds, no double-conversion, no value leak.

## Why this order matters

The code and the data must flip together, in this order:

1. **Code first** (×100 prices), **data second** (×100 balances).
2. Never data-first: old code charging single-digit prices against ×100 balances = free generations (value leak).
3. Code-first without data is temporarily "expensive-looking" (400-price vs 842 balance) — safe direction, no leak. Close the gap fast.

## Step 0 — Pre-flight (record the "before" state)

Supabase SQL Editor:
```sql
SELECT count(*), max(credits) FROM profiles;
SELECT count(*) FROM referrals;
SELECT count(*) FROM referral_payouts;
```

Render Postgres (service Shell tab: `psql "$DATABASE_URL"`):
```sql
SELECT count(*), max(credits_used) FROM credit_usage;
SELECT count(*), max(credits) FROM teams;
```

Save the outputs. Post-migration values must be exactly 100× these.

## Step 1 — Point the staging service back at `staging`

Render Dashboard → `bow-down-visuals-staging` → Settings → change tracked branch
from `feature/website-chatbot` to `staging` → Save.
Auto-deploy is ON, so the merge (`134da98`) deploys automatically.
Wait for the deploy to go Live, then smoke-check the homepage.

> Needs the owner's OK — it's a settings change on their Render account.

## Step 2 — Run the data migrations (immediately after the deploy)

**A. Supabase** — Dashboard → SQL → paste
`supabase/migrations/0054_visual_bucs_hundreds.sql` → Run.
Expected: `NOTICE: 0054_visual_bucs_hundreds applied on Supabase.`

**B. Render Postgres** — web service Shell tab:
```
psql "$DATABASE_URL" -f lib/db/migrations/0054_visual_bucs_hundreds.sql
```
Expected: `NOTICE: 0054_visual_bucs_hundreds applied on Render Postgres.`

Both scripts are idempotent and exactly-once: re-running prints
"already applied — skipping" and changes nothing. A failed run rolls back
fully — safe to retry. Each covers only its own database's tables:

| Supabase script | Render Postgres script |
|---|---|
| profiles.credits, bonus_credits | credit_usage, stripe_payments |
| referrals (both award cols) | distribution_releases, generation_history |
| referral_payouts (both cols) | generations, scheduled_posts |
| | wheel_spins, teams |
| | cheat_code_events, bow_challenge_config |

## Step 3 — Post-flight verification

- Re-run the Step 0 queries: every max/count must be exactly 100× the before-values.
- `SELECT * FROM data_migrations;` on BOTH databases → `0054_visual_bucs_hundreds` present.
- Staging site: sign in, confirm balance shows hundreds (e.g. 842 → 84,200),
  prices show hundreds (song 400), jackpot banner 10,000.

## Step 4 — Dashboard env vars (after staging deploy)

Follow `docs/visual-bucs-env-audit.md`: every `*_CREDITS` / `*_CREDIT_COST`
override still set on the **staging** service must be ×100'd or REMOVED
(removal falls back to the new ×100 code default). Old dashboard values are
in old units and override the code.

## Step 5 — Production (separate approval, not covered here)

Same sequence on production, only after the owner approves from staging.
Production has real user balances — triple-check pre-flight numbers first.

## Emergency rollback

Only valid BEFORE any hundreds-denominated writes happen after the migration:
run the inverse (`SET x = x / 100` per table, integer math is exact here),
then `DELETE FROM data_migrations WHERE name = '0054_visual_bucs_hundreds';`
on that database. After new writes land in hundreds, rollback is no longer
safe — fix forward instead.
