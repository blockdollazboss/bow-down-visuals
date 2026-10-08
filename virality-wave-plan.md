# VIRALITY WAVE — plan (2026-10-07)

Coordinator: this session. Branch: staging. Migrations: next free 0101+.

Goal: the 10 highest-leverage virality mechanics — every one must create a loop
(user action → shareable artifact → new user). If it doesn't loop, it doesn't ship.

| # | Worker | Mechanic | Loop |
|---|--------|----------|------|
| 1 | 4286092d | Rich link previews (dynamic OG/Twitter cards on every shareable URL) | share → beautiful card → clicks |
| 2 | 642a18e3 | Embeddable players/widgets (/embed/*, oEmbed, copy-paste code) | embed → branding + CTA → signups |
| 3 | 30603241 | Referral leaderboard + monthly viral contests | compete → recruit → signups |
| 4 | fefaab50 | Invite mechanics + queue-jump waitlist | exclusivity → invite to skip line |
| 5 | 2f270761 | "Made with BDV" attribution completeness audit + gap fixes | every export = billboard |
| 6 | 33926854 | Public social-proof stats engine (live counters band) | trust → convert → bigger numbers |
| 7 | 925c85f0 | Challenge engine 2.0 (prizes, voting, winners' circle) | compete → share entry → votes |
| 8 | b9fea6c8 | Milestone brag cards (auto-generated shareable images) | milestone → brag → followers see brand |
| 9 | a5f87d47 | Programmatic SEO expansion (genre/vertical/tool pages) | rank → organic traffic |
| 10 | 5ae7e04b | Lightning onboarding (60-sec signup → live profile) | fast live profile → shared links |

Gap analysis findings (verified in repo before dispatch):
- OG: only static homepage tags in index.html; no per-URL cards on track/artist/showcase/etc.
- No embeddable player widget; X-Frame-Options status unchecked.
- Referral system exists (?ref=CODE, 25% rev share) but no leaderboard/contest layer.
- /api/waitlist + beta-access.tsx exist but no invite/queue-jump mechanics.
- Attribution wired in wave 5 but never audited across all export paths.
- No public live counters on marketing surfaces.
- Challenges exist but competitive engine (prizes/voting/winners) thin.
- MilestoneTracker exists; no shareable brag mechanic.
- /templates/* proved programmatic SEO; genre/vertical/tool pages missing.
- artist-setup + AI Page Designer exist; friction never measured/minimized.

Standing rules given to all: staging only, no new sidebar items, VB ×100,
server-side credit enforcement, no paid spend, tsc 0 errors, idempotent
migrations (check max first), gold/black luxury, explicit-path commits only
(never bare git add -A, never git checkout -- .), batch pushes.

## COMPLETE — 2026-10-07/08, all on origin/staging (HEAD 17cc100c)

| # | Mechanic | Commits |
|---|----------|---------|
| 1 | Rich link previews (bot OG injection, 25 route families, 64/64 tests) | via def6e265/2cac8f09 (broad-add, content verified) |
| 2 | Embeddable players (/embed/*, oEmbed, X-Frame-Options fix) | 5a602c1e, 39942468 |
| 3 | Referral leaderboard + monthly 40k VB contests | 8baa923f, 81f77dc6 (migration 0101_referral_contest) |
| 4 | Invite codes + queue-jump waitlist (/invite/:code bot OG) | 0b385e7c (migration 0103_waitlist_invites) |
| 5 | Attribution audit (23 paths, gaps fixed) | 58dba5c1, a5963458, 0d77147c, 17cc100c |
| 6 | Social-proof stats API + band (5 surfaces) | 25094e78 |
| 7 | Challenge engine 2.0 (prizes, voting, winners' circle) | 06312cec, 0d6de195 (migration 0102_challenge_engine_2) |
| 8 | Milestone brag cards + trophy shelf | 2cac8f09, 9e13103a |
| 9 | Programmatic SEO (22 pages, sitemap 8→39) | def6e265 |
| 10 | Lightning onboarding (3 clicks, ~15-20s) | 444e2ea6 |

Integration: 17cc100c (recommitted worker5's swept attribution files + deduped 0101 collision).
Verification: frontend tsc 0 errors, api tsc 0 errors, no duplicate router registrations, main untouched.
