# upg-events lane plan (banked Oct 27, run: REPLACEMENT #2)

Base: ecc63098 · Branch: stack200/upg-events · NO pushes/merges. Migrations: provisional 9999-*.sql only.

## Audit scopes (stack200-board.md, DEDUPE AUDIT)

### N8 The Crowns — UPGRADE of World Court Seasons + Winners' Circle + Challenges Hall of Fame
Existing: `lib/world-court-season.ts` (monthly seasons, standings from creator-rank ladder's real
sources, settling ceremony, season marks wall), `lib/world-contests.ts`, Challenges Hall of Fame.
DELTA ONLY: the yearly roll-up —
- published award categories (fixed published list, creators know what they're chasing)
- the year decided by platform records across the site + World (real numbers only, anti-fake)
- winners wear a CROWN on their profiles for a year (profile badge, expiring at year end)
NOT building: new season engine, new contest engine, new rank ladder — roll up the existing ones.

### N19 Cover Fridays — UPGRADE of Challenge Engine weekly ritual
Existing: `routes/challenge-engine.ts` ("WEEKLY RITUAL", GET /api/challenges/weekly, community
voting 1/user/entry, winners + hall of fame).
DELTA ONLY: the cover-specific form —
- house-named weekly cover theme (a Friday with no theme fails it: theme always resolvable)
- the King as the crowning judge (house pick, not community vote)
- winner's cover FEATURED as the crown (featured placement, credited)
NOT building: a new contest engine — a cover-fridays layer over the weekly ritual.

## Method
1. Covered-check: read the cited existing code; if the delta already exists in a joined lane, prove + mark covered, don't rebuild.
2. Build backend lib + routes + tests first; dock minimal FE surfaces into home surfaces (profile crown on profile; Cover Fridays inside challenges), both themes (theme tokens, no hardcoded one-mode colors).
3. Commit-ladder every rung. Suites + typechecks green on lane before done.
