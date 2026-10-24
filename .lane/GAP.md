# Lane stack29/coposts — #24 Co-Posts & Collab Releases — GAP VERIFICATION

Base: stack28/integration @ f96d7b72. Verified in source 2026-10-23 before building.

## Gap confirmed — co-posting does NOT exist under any other name
- `grep -RniE "co-?post|co-?author|coAuthor|coPost|dual.author"` over
  `artifacts/` + `lib/` (ts/tsx, excluding tests): ZERO product hits. Only
  unrelated matches (collab *routes* themselves, a library template titled
  "Collab Announcement", Dream Collab concept generation).
- Collabs (`artifacts/api-server/src/routes/generate/collabs.ts`,
  `lib/db/src/schema/collab.ts`) is matchmaking only: public collab
  profiles, AI match report (100 VB), free send/respond on
  `collab_requests` (pending/accepted/declined). Nothing after "accepted".
- Feed posts (`posts` table, `lib/db/src/schema/creator-stories-posts.ts`)
  carry exactly ONE `profile_id`. Likes/reactions/replies hang off the
  single post row (`reactions` PK is (user, target_kind, target_id)) —
  which is exactly what a co-post must reuse so engagement can never
  double-count: ONE post row, TWO author sides.
- Releases (`distribution_releases`) likewise carry a single artist; see
  REPORT.md for the parked release half + reason.

## Farm hazard correction (follow-up brief, applied before any suite)
- Brief's farm (bdv-wt-integration) frontend node_modules is ELOOP-corrupt.
  Re-farmed from the healthy MAIN checkout via
  `.lane/setup-node-modules.sh`; `@workspace/db` and `@workspace/api-zod`
  mapped BY NAME into this worktree and verified with `readlink -f`:
  both resolve to `/home/hatch/workspace/bdv-wt-coposts/lib/{db,api-zod}`.
- All lane tooling lives under `.lane/` only (no /tmp scripts).
