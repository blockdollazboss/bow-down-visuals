# Lane: stack29/notifications — notification read bug (Stack-100 #3, Lane B)

Owner report (Oct 23, 20:24 EDT): clicking/opening a notification did NOT
clear its new/unread state; only "Mark all read" cleared it.

## Root cause (proven in code @ f96d7b72)

Surface: `artifacts/bow-down-visuals/src/components/discovery/NotificationsBell.tsx`
(the 2D header bell, mounted in App.tsx's AuthedLayout header).

- A notification row rendered either as a wouter `<Link href={n.link}
  onClick={() => setOpen(false)}>` or as a plain `<div>` with no handler.
  The ONLY click behaviour on open was closing the dropdown + navigating.
- The component's sole call to `POST /api/discovery/notifications/read`
  was inside `markAllRead()`, posting `{}` (no ids) — the mark-all path.
- No local state update on open either: the clicked row kept
  `is_read: false` (gold dot + highlight) and `unread` never decremented,
  and the 60s poll re-fetched the server's still-unread truth.

NOT the cause (verified):
- The rail already supports per-item reads:
  `POST /api/discovery/notifications/read { ids }` in
  `artifacts/api-server/src/routes/discovery.ts` — id-scoped
  `UPDATE ... WHERE user_id = $caller AND id = ANY(...)`; no-ids = all.
- GET already maps the DTO to snake_case `is_read`/`created_at`
  (pinned by discovery-notifications-dto.test.ts).
- The World bell (`components/world/WorldNotificationsBell.tsx`,
  stack-100 item 78) already opens correctly — optimistic flip,
  badge −1, `markRead([item.id])`. The header bell simply never got
  the same wiring. The fix mirrors the World bell's proven pattern.

Other "unread" surfaces (CommandCenter, SocialDesk) are DM/message
counts — a different system, out of scope.

## Fix (FE only; no API change, no migration, no deletions)

- NEW `src/components/discovery/notifications-read-state.ts` — pure
  transitions: `markItemRead` (flip exactly one, reports wasUnread),
  `decrementUnread` (−1, floor 0), `markAllItemsRead`.
- `NotificationsBell.tsx`:
  - `openNotification(n)` — closes the panel; if unread: flips the row
    + decrements the badge immediately via the helpers, then
    fire-and-forget POSTs `{ ids: [n.id] }` (SPA navigation is
    client-side, so the request completes; a failure is healed by the
    next 60s poll, same contract as the World bell).
  - Both row variants (linked + link-less) now call `openNotification`
    on click; link-less rows became clickable.
  - `markAllRead` unchanged in behaviour (POST `{}`, badge → 0); its
    local flip now routes through `markAllItemsRead`.

## Tests (new)

- FE `notifications-read-state.test.ts` — 6 logic pins (single flip,
  already-read no-op, unknown-id no-op, badge −1/floor 0, mark-all).
- FE `notifications-bell.test.ts` — 6 source pins (per-item ids body,
  both rows wired, old navigate-only click gone, guard + transitions,
  mark-all wiring + {} body intact). Discriminating: pins fail on the
  pre-fix source.
- API `discovery-notifications-read.test.ts` — 5 route pins over a
  fake db that emulates the handler's two UPDATE shapes from the
  flattened SQL: per-item flips exactly one + count 2→1; unknown id
  no-op; no-ids = mark-all; empty ids = mark-all; another user's
  rows untouched on both branches.

## Verification (numbers only from finished logs in .lane/logs/)

- Targeted FE: 2 files / 12 tests PASS (the 12 new pins).
- Targeted API: 3 files / 14 tests PASS (5 new read-contract pins +
  existing DTO + social-notification-links).
- FE FULL suite (fe-full2.log): **350 files / 4,692 tests — 4,691
  passed, 1 failed.** The one failure (chat-voice.test.ts "no
  recognizer in the browser…", 9.8s under load) passed standalone
  27/27 (fe-rerun-chatvoice.log) — load flake, unrelated surface.
  Delta vs the join baseline (348 / 4,680) closes exactly:
  +2 files / +12 tests = this lane's new pins.
- Typechecks (typecheck-rc.txt): **FE rc=0, API rc=0.**
- API FULL suite: this lane changes ZERO API source (one added test
  file only); the identical API tree passed in full at the join
  (411 files / 5,172 tests, Oct 23). Two monolithic full runs here
  were both reaped mid-run by environment restarts (api-full.log,
  api-full2.log — no summary lines; environment, not failures). A
  resumable chunked run (4 chunks, .lane/api-chunks.sh, per-chunk
  logs api-chunk-{A,B,C,D}.log + api-chunks-rc.txt) was still in
  progress at commit time — chunk A under way — and its finished
  logs land in .lane/logs/ for the coordinator; the join's own full
  verification re-covers the tree regardless.

## Environment incident (not the change, not the tree)

The first full FE run (fe-full.log) reported 10 failed FILES with
ZERO failed tests (4,565 passed): every failure was
"Cannot find package 'three' / 'lucide-react' / …". Cause: this
lane's node_modules mirror pointed into `bdv-wt-integration`, and at
~00:35 — mid-run — every top-level entry in integration's FE
node_modules was rewritten as an absolute SELF-referential symlink
(e.g. `three -> …/bdv-wt-integration/…/node_modules/three`), breaking
resolution for anything importing those packages. Verified all 45
entries were self-loops. The repair: re-mirrored this worktree's
node_modules from the pristine main checkout
(`~/workspace/bow-down-visuals`, whose relative .pnpm links are
intact) with @workspace/db + @workspace/api-zod still pointing at
this worktree's own lib dirs; resolution re-verified package by
package. The 10 files then passed standalone (fe-rerun10.log:
10 files / 127 tests PASS), and the full FE suite was re-run clean
(fe-full2.log). NOTE for the coordinator: `bdv-wt-integration`'s
node_modules was corrupted by an external rewrite — sibling lanes
mirroring from it after ~00:35 will hit the same wall.
