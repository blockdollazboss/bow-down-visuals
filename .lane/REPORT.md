# REPORT — Stack-100 #3, #27 Creator Comment Controls

Branch: stack29/comment-controls (worktree ~/workspace/bdv-wt-comments)
Base: stack28/integration @ f96d7b72

## What works end-to-end
- PIN: owner pins ONE comment per wall / per media item (pinning clears
  the previous pin in the same request), shown first in list reads,
  badged "Pinned by creator" in CommentThread + Shout Wall.
- HIDE: owner hides a public comment → gone for the public, still
  visible to creator + author badged "Hidden", reversible (unhide).
  No delete exists anywhere in this feature.
- HELD-FOR-REVIEW: per-creator setting (off | first_time | all).
  Matching new comments land status='held' in the creator's held queue
  (GET /creator-profiles/me/held-comments, wall + media in one list),
  approve → public, reject → hidden. UI + API copy states a hold is
  "a delay, not a deletion". A held media comment does not bump the
  public comment_count; approve/hide/unhide move it.
- KEYWORD BLOCKLIST: per-creator words/phrases; matches auto-held
  (never deleted) with held_reason='blocked_word'. Matching semantics
  reuse the live-chat automod rail (case-insensitive substring).
- Defaults OFF: no settings row = hold_mode 'off' + empty blocklist =
  behaviour exactly as before. Free — no prices/fees/credits anywhere.
- Docks (PROMOTE): inline controls on the creator's own surfaces —
  CommentThread (track/video pages) and Shout Wall (profile page);
  settings + held queue panel renders inside the owner's own Shout
  Wall section. No standalone page.

## Ownership (server-side, tested)
- Settings + queue are keyed to the CALLER's own creator profile — no
  client-supplied profile id exists in those routes.
- Action route resolves the owning profile from the comment row and
  403s non-owners (including the comment's author); 409 for
  inapplicable actions; 404 unknown comment; 400 bad action.

## Migration
HELD — exact SQL in .lane/MIGRATION-NEEDED.md (status/pinned/pinned_at/
held_reason on profile_comments + media_comments; creator_comment_settings
table). Number NOT claimed (0205 held by another lane; assigned at join).
Drizzle schema in lib/db/src/schema/creator-social.ts is in sync.
Until it lands: reads default public/unpinned, comment POSTs fall back
to the legacy insert, settings GET returns OFF defaults, control
writes + held queue answer 503 comment_controls_not_ready.

## Suites (numbers from finished logs in .lane/, sequential, --maxWorkers=1)
- Libs build (tsc -b lib/db lib/api-zod): exit 0 (build-libs-2.log);
  @workspace/db + @workspace/api-zod readlink -f resolve INTO this
  worktree (node-modules-verify.txt).
- API typecheck: exit 0 (api-typecheck-1.log).
- FE typecheck: exit 0 (fe-typecheck-1.log).
- API targeted (api-comments-1.log): 3 files / 40 tests passed —
  lib comment-controls 16, routes comment-controls 14, pre-existing
  creator-comments-dto regression 10.
- API holds integration (api-holds-1.log): 1 file / 8 tests passed.
- FE targeted (fe-comments-1.log): 3 files / 36 tests passed —
  comment-controls client 7, lockdown-guest-honesty 14, reports 15.
- API full coverage (all 414 test files): the first full run's process
  was lost mid-run under VM memory pressure from sibling lanes
  (api-full-1.log: 236 files completed, 3,483 tests tallied from the
  log's per-file markers, exactly 1 failure — own-server-live's real
  ffmpeg remux integration test timing out at 60s under contention;
  re-run alone in api-ownserver-rerun.log: 12/12 passed, so that
  failure is environmental, not this feature). The remaining 178
  files were run in two finished chunks: api-full-2a.log 94 files /
  809 tests passed, api-full-2b.log 84 files / 1,055 tests passed —
  414/414 files covered, no other failures.
- FE full (fe-full-1.log): 349 files / 4,687 tests, all passed, exit 0.

## Parked / notes
- Feed thread replies are NOT a comment model: they are full rows in
  `posts` with kind='thread_reply' (reply_to chains), already carrying
  the platform admin-removal state (removed_at, migration 0175) and
  served by routes/social.ts. Creator pin/hide/held for feed replies
  would need a separate posts-column facet in the same held migration
  plus feed-read filtering in social.ts — flagged here for the join
  decision rather than bolted onto the comment models; the two
  dedicated comment models (wall + media) are fully covered.
- Community group posts (group_posts) have no reply/comment model.
  Review-link comments keep their existing client hide flow.
- Shorts have no comment endpoints in routes/shorts.ts today (counts
  only), so there is nothing to control yet; when shorts comments land
  on media_comments they inherit these controls.
- Preview artifact: not built — this lane is a subagent build; visual
  preview belongs to the parent at Gate 1 with the joined stack.
