# Lane par-studio-board-depth (World Parity P3-E) — plan

Base ecc63098 · branch stack200/par-studio-board-depth · NO pushes/merges.
Scope: ONLY the two gaps named in ~/workspace/parity-p3-audit.md (Boards & management):

## Gap 1 — Studio Board widget family
Standing today: project rows + balance/streak strip + vault portrait row.
Add as native widgets on boards/StudioBoard.tsx, each reading the EXISTING
site rail for its data, each degrading independently (a dead rail never
takes the board down), honest empty states only — never invented data:
- Challenges & contests hub — GET /api/challenges/weekly (parseWeeklyContest,
  games-lobby.ts) + GET /api/world/contests (normalizeContests, contests.ts).
- Digest — GET /api/retention/away-digest (the dashboard's away digest;
  NOT the orphan group-digest). show:false reasons render as honest
  states (off / first visit / all caught up).
- Leaderboard — GET /api/retention/leaderboard (normalizeLeaderboard,
  treasury-quests.ts — reused, not re-derived).
- Sponsor pipeline — GET /api/wave8/sponsors/deals; derivation mirrors
  dashboard.tsx exactly (closed stages paid/lost/rejected/dead; pipeline
  dollars = round(active dealValueCents/100); next = freshest active deal).
- Next moves — the dashboard's rule-based derivation (dashboard.tsx
  nextMoves + money next-move), shaped from real state only: finish the
  latest project (Continue seam), follow up the next sponsor deal,
  claim the daily drop when the strip says it's claimable, see what's
  trending (Charts board). Cap 3.

## Gap 2 — My Projects deeper tabs
The projects board gains real tabs over existing rails:
- Drafts — GET /api/drafts (the /my-projects page's own rail).
- Generated clips — GET /api/generated-clips.
- Generation history — GET /api/generation-history (no World code
  consumed this rail before this lane).
Tabs lazy-load on first open, each with loading / error+retry / honest
empty states. Projects tab keeps Continue; other tabs are display rows
(their verbs live at their own desks; no fake actions).

## Rungs
0. This plan.
1. lib: tab model + drafts/clips/history normalizers (studio-board.ts).
2. lib: digest + sponsor pipeline + contest summary + next-moves shaping.
3. component: widgets + tabs in StudioBoard.tsx (both themes via isLight).
4. tests: studio-board.test.ts extensions (all new shaping + source pins).
5. verify: World suite slice + FE typecheck green; close-out here.

Env note: node_modules are symlinked from bdv-wt-joinnext (pnpm off PATH
on this box) — gitignored, no repo change. @workspace/* resolves to the
join tree's lib dists (superset of base) for typecheck only.
