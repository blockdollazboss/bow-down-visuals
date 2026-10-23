# PRESENCE lane — Stack-100 #2 items 61–64 (branch stack28/world-pres, base 92740798)

Setup: worktree ~/workspace/bdv-wt-w28-pres; symlink forest cloned from
bdv-wt-w28-parity (per-entry links into bdv-wt-integration);
@workspace/db + @workspace/api-zod verified resolving INTO this worktree
(readlink -f → pres/lib/db, pres/lib/api-zod); lib/db + lib/api-zod dists
built in-worktree (.lane/build-db.log, build-zod.log, both exit 0);
baseline FE + API typechecks exit 0 (.lane/baseline-*-typecheck.log).
TMPDIR in-worktree (.tmp); suites sequential, --maxWorkers=1.

## Facet reliability note (applies to all four items)
Facet C's file:line citations do not exist in the tree at the audit commit
ae4e1863 or now (e.g. world-colliders.ts never existed; world-palace.ts was
1004 lines at audit, 1076 now — C-P1's ":974 setInterval 90s" and C-P2's
":1147-1222" point at nothing). Every claim was therefore verified by
DESCRIPTION against the current code, not by citation.

## Per-item status
- 61 PINNED (stale, evidence): the sweep is NOT coupled to directory traffic
  in the current tree. WorldPalace.startPresenceSweeper() runs a 15 s
  interval (WORLD_PRESENCE_SWEEP_MS=15_000, world-palace.ts) started once
  at WS registration in routes/world.ts (palace.startPresenceSweeper()),
  unref'd, idempotent, dispose-safe. The facet's "90 s" is the stale
  WINDOW (WORLD_PEER_STALE_MS=90_000), not the sweep cadence, and no sweep
  call exists on the GET /world/directory path. Pin: new API test file
  world-presence-lane.test.ts — fake-timer test reaps a ghost on the
  interval with ZERO directory/snapshot calls, + source pin on
  routes/world.ts (registration starts the sweeper; directory handler
  neither starts nor runs a sweep).
- 62 DONE (fix, minimal): the stale counters were real in one place —
  WorldPalace.directory() and totalPopulation() counted raw room.size() /
  memberNames(), i.e. frame-silent ghosts counted until a sweep happened
  to run, while the palace's own truthful counter (presenceSnapshot,
  presentPeers) already excluded them: two counters, two truths, and the
  public one was the stale one. Fix: directory() count+members and
  totalPopulation() now derive from room.presentPeers(now) computed live
  at call time (no cached/captured counter state anywhere); both take an
  optional `now` like presenceSnapshot. Admission/cap semantics still use
  raw size() (a ghost holds its chair until reaped — unchanged).
  Pins: world-presence-lane.test.ts (ghost excluded from directory +
  total before any sweep; fresh peers counted; directory == snapshot).
- 63 DONE (fix, minimal): the honest quiet signal gap was in the voice
  footer. voiceConnectionHeadline() returned "" for the "empty" summary
  (in voice, nobody else in voice), and world.tsx renders no chip at all
  in that state — so in a MIXED room (2+ people present, only you in
  voice) there was no signal the room was voice-quiet; you could talk to
  nobody without knowing. (No literal "exactly 1 member" condition exists
  in the tree — facet description verified by behaviour, not citation.)
  Fix: voiceConnectionHeadline(summary, roomOccupants?) — when the caller
  supplies the room's occupant count, the empty state reads the quiet
  caption ("Quiet in here — you're the only one in voice right now") at
  ANY occupant count, i.e. by room state; world.tsx passes peopleCount.
  The no-context call keeps returning "" (existing pin untouched).
  Pins: voice.test.ts additions in presence-lane test file.
- 64 PINNED (stale, evidence): the world's only display cases are the
  Ateliers vitrines (ATELIER_VITRINES, ateliers.ts — "Glass display
  cases… The case is solid"). The facet's "8 cases, 5 blocked" matches
  no set in the tree at audit time or now: there are 6 vitrines and ALL 6
  already carry rects in ATELIERS_BLOCKED at VITRINE.blockHalf (and
  ateliers.test.ts already pins every vitrine centre unwalkable).
  Pin: FE presence-rewalk.test.ts — every vitrine has a matching blocked
  rect (exact rect equality), blocked-spec count == vitrine count,
  centres + faces unwalkable via isWalkable, and the scene builds its
  cases from the same ATELIER_VITRINES list (source pin on hall-scene).

## Verification (FINAL — numbers from finished logs in this .lane/)
- FE world suites: 102 files / 1,847 tests ALL PASS, exit 0
  (.lane/final-fe-world.log) — includes this lane's new
  presence-rewalk.test.ts (9 tests); voice.test.ts (28) and
  ateliers.test.ts (17) re-run green inside the suite.
- API world suites: 34 files / 442 tests ALL PASS, exit 0
  (.lane/final-api-world.log) — the world-* files in lib/__tests__ +
  routes/__tests__ (incl. new world-presence-lane.test.ts, 6 tests)
  plus operator-tier4.test.ts, the directory()'s operator consumer.
- FE typecheck exit 0 (.lane/final-fe-typecheck.log — full
  --incremental false run); API typecheck exit 0
  (.lane/final-api-typecheck.log — full --incremental false run).
  All runs sequential, --maxWorkers=1, TMPDIR in-worktree.
- No flakes; no A/B needed. No existing test pin was changed,
  weakened, or deleted: item 62's readers all read fresh peers
  (present == raw there), item 63's context-free headline pin
  stands as-is. No migrations, no price/charge changes, no file
  deletions, no push.

## Commits (stack28/world-pres, base 92740798)
- b4e4f0e9 items 61+62 (sweep pin; directory counters go live) + this plan
- 8f2fa92f items 63+64 (quiet caption by room state; vitrine block pin)
- (final) this verification record
