# upg-fans lane PLAN (run: replacement worker, Oct 27)
Branch stack200/upg-fans @ base ecc63098. Commit-ladder: bank every rung.

## Audit scopes (stack200-board.md DEDUPE AUDIT)
- #175 Collab Match — UPGRADE of Collabs (/collabs; routes/generate/collabs.ts).
  Delta ONLY: proactive house-suggested pairings (house initiates by niche+size on a cadence)
  + both-sides-opt-in intro brokering as the ONLY contact path. Decline closes quietly, no re-nag.
- N16 Audience Room — UPGRADE of Analytics Hub + Analytics (/analytics-hub, /analytics).
  Delta ONLY: three real-data panels the hubs lack — play sources, best hours,
  fastest-growing fan city — in ONE room. Unsupported metric stays absent, never estimated.
- N17 Fan Links — UPGRADE of Shares + Referrals (routes/shares.ts).
  Delta ONLY: per-fan share links on any creator content + creator-side per-fan
  attribution view (real clicks/arrivals/signups per fan link).

## Rungs
1. PLAN.md banked.
2. Covered-check existing code per delta (grep at base); record findings here.
3. Per delta: schema (provisional 9999-*.sql + lib/db schema) -> lib/API -> FE dock -> tests.
4. Lane suites + typechecks green; manifest updated.

## Covered-check findings
(pending)
