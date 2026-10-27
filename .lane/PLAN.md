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

## Covered-check findings (Oct 27)
- #175: /collabs has profiles + AI match report (paid) + creator-sent requests.
  NO house-initiated suggestions, no opt-in brokering. Delta is REAL, build it.
- N16: play_events(kind, media_id, user_id, played_at) exists; NO source column,
  NO fan city recorded anywhere in the platform (no user/fan location field).
  -> Best hours: real (played_at histogram). Play sources: add nullable
     play_events.source + accept it on both play endpoints; panel shows
     recorded sources, legacy plays labelled untracked. Fan city: UNSUPPORTED
     at base -> panel omitted per audit rule (API reports unavailable+reason,
     never estimated).
- N17: share_events counts share ACTIONS only; referrals attribute platform
  recruits only. No per-fan content links, no click/arrival/signup attribution
  per fan. Delta is REAL, build it: fan_links + fan_link_events, public
  redirect records clicks, play-with-code records arrivals, attribute-signup
  endpoint for signups.
