# STACK-100 #2 — STUDIO/VOICE/FINISHES lane (stack28/world-studio @ 92740798)

Baseline: symlink forest replicated from bdv-wt-w28-parity (per-entry links
into bdv-wt-integration); readlink -f artifacts/api-server/node_modules/
@workspace/db → ~/workspace/bdv-wt-w28-studio/lib/db and @workspace/api-zod →
~/workspace/bdv-wt-w28-studio/lib/api-zod (IN-WORKTREE ✓). lib/db + lib/api-zod
dists built in-worktree (tsc -b, exit 0). Baseline typechecks: API 0, FE 0
(.lane/baseline-api-typecheck.log, .lane/baseline-fe-typecheck.log).

Facet-verification summary (facets partly stale, as warned):
- C-V3 (item 65): NO `SHAPE_LABELS` exists anywhere in tree or git history
  (`git log --all -S SHAPE_LABELS` hits only the audit commit itself).
  character-voice.ts profiles carry `label` ON the profile object — already
  single-sourced. → PINNED (regression pins), no rebuild.
- C-V4 (item 66): REAL (small) — world.tsx:2261 recomputes
  summarizeVoiceConnections + headline on every render. → DONE (memoized
  summarizer in voice.ts + world.tsx wiring).
- Item 67: NOTE ONLY in the voice-config rails (server + client seam).
  Sibling meshes verified STUN-only (guest-mesh.ts, StageRooms.tsx).
- D-89/D-L2 (item 98): MIXED. D-89b "two getStatus impls" STALE (parity lane
  already pinned: no getStatus in world lib). D-89c "deck polls 2s" STALE —
  LiveControllerDesk + stream-controller page are socket-driven
  (ControllerRemoteClient); the only interval is a 1s LOCAL sweepPending
  ack-expiry sweeper (no network). D-L2 REAL in part: the three broadcast
  start inserts in live-streams.ts (POST own, POST cloudflare, RTMP ingest)
  never write started_at explicitly — they lean on the DB defaultNow(),
  while reach.ts's premiere insert writes `started_at: new Date()`
  explicitly. BroadcastStudio's controller state fabricates
  `liveSince: Date.now() - elapsed*1000` and loadStatus never restores
  liveSince from the server's started_at. → DONE (explicit server write +
  shared status DTO carries startedAt + studio reads the real value).
- D-53 (item 99): MIXED/STALE. The claimed TODO at distribution.ts:14-15
  does not exist; POST /api/distribution/splits/invite (bare) does not
  exist, BUT the real rail exists at POST /api/distribution/releases/:id/
  splits/invite with pending state (invite_status='invited' +
  invite_token on distribution_royalty_splits, no migration) + share-link
  rail, API-tested (distribution.test.ts "splits share links + invites").
  No "faked invite acceptance" client test exists in the tree. REAL defect:
  the in-world editor drops the split `id` (release-desk.ts normalize +
  parseSplitsSave) so it CANNOT invite at all, and has no invite/share
  doors — while its editor already collects email (not raw user ids —
  that facet claim is also stale). → DONE (wire in-world editor to the
  canonical rails; id carried through; tests against the real shapes).
  Building a duplicate bare /splits/invite alias would create two invite
  doors for one action — not built; canonical rail pinned instead.
- C-V1 (item 100): REAL — world-voice-config.ts is static-only. → DONE
  (coturn REST ephemeral creds when WORLD_TURN_SECRET set; unset =
  byte-identical behaviour; tests pin both modes). No env set anywhere,
  no relay stood up.

## Per-item status
- 65 Voice labels single-sourced — PINNED (see above)
- 66 Voice summary cost — DONE
- 67 Sibling-mesh honesty note — DONE (note only; sibling files untouched)
- 98 Controller deck executor — DONE (server started_at + shared status +
  studio liveSince truth; polling claim pinned stale w/ justification)
- 99 Distribution splits invite — DONE (canonical rail pinned as existing;
  in-world editor wired: id carry-through + invite + share-link doors)
- 100 TURN readiness code-side — DONE (ephemeral HMAC creds, both modes pinned)

## Verification (numbers only from finished logs in .lane/)
- FULL FE suite: 311 files / 4,213 tests ALL PASSED — .lane/final-fe-full.log
- FULL API suite: 408 files / 5,141 tests ALL PASSED — .lane/final-api-full.log
  (CORRECTION: an earlier draft of this record quoted 413/5,227 — wrong;
  the finished log's own summary line, re-read after the run completed,
  is 408 files / 5,141 tests, exit 0. The FE figure 311/4,213 was and
  is correct.)
- FE world suite: 101 files / 1,855 tests PASSED — .lane/final-fe-world.log
- API targeted (voice-config, live-streams own/full/ingest, live-control,
  distribution + router-order): 7 files / 140 tests — .lane/final-api-targeted.log
- API world routes (locks + events): 2 files / 25 tests — .lane/final-api-worldroutes.log
- FE live-adjacent (stream-controller, guest-honesty, go-live): 6 files / 62
  tests — .lane/final-fe-live.log
- Item logs: item100-voice-config.log (12/12), item65-66.log (54/54),
  item98-api2.log (11/11), item98-fe.log (40/40), item99-fe2.log (34/34),
  item99-api.log (76/76)
- Typechecks at finished tip: lib build 0, API 0, FE 0 —
  .lane/final-build-libs.log, .lane/final-api-typecheck.log,
  .lane/final-fe-typecheck.log
- Branch tip: 5615434b (record commit; code tip 7595efcf) (stack28/world-studio). No push, no migration,
  no env set anywhere, no relay stood up, no file deletions.
