# STACK-200 — EDITOR PRIORITY LANE (items 185–192) — REPORT

Branch: `stack200/editor-priority` @ **395dcce9** (worktree
`~/workspace/bdv-wt-s200-editor`). Base: stack200/integration @ 9940beae
(findability join #1). **No push, no join, no migration, NO look changes**
— every change is function underneath the editor's existing surface.

This lane ran twice: the first run banked the plan + three build commits
and died in a daemon restart drain; this continuation inventoried the
banked work from commits + code (never assumptions), finished the one
genuinely open build item, re-verified everything on HEAD, and wrote
this report.

## Inventory outcome (what the prior run had actually banked)

| Commit | Content |
|---|---|
| 7410aafa | Lane plan — Lane D fold-in verdicts verified in current code + build list for 185–192 (`.lane/PLAN.md`) |
| fba41b48 | 186 load splits + 191 export honesty + 189/board-60 lip-sync dark-state honesty |
| c58545a0 | 187 export-poller hardening + 185 A-03 KB closure (generator, regen, pins) |
| c6fe0f3c | 188 dead-control fix + census (`.lane/dead-control-census.md`) |
| 395dcce9 | **This continuation:** 187 completion — lip-sync poll loops hardened via shared `lib/poll-tolerance.ts` |

Setup verified by the continuation: branch correct before every commit;
`node_modules/@workspace/db` resolves into THIS tree
(`/home/hatch/workspace/bdv-wt-s200-editor/lib/db`); working tree clean
at handoff.

## Per-item verdicts

### 185 — Lane D fold-in: DONE
Verified in code at base (not rebuilt, not double-counted): D-01…D-05,
N-01…N-08, F-1…F-4, A-01, A-02, A-04 (FE half), A-05, A-06, A-07, A-09,
A-10 all already shipped via Stack-100 #3. **A-08 needed NO new
migration**: it had already shipped as migrations 0217 (lip_sync_runs)
+ 0218 (multi_ratio_jobs) with drizzle schema in sync — the spec's
guessed numbers (0215/0216) simply landed under later ones. Migration
0242 was never touched. The one genuinely open piece, the **A-03 KB
remainder**, was built: the operator-knowledge generator now links the
video-editor entry to /api/export-multi-ratio, /api/export-doctor/*
(13 routes), /api/lip-sync/run-all, /api/export-video-job/:param and
/api/prepare-export-files; KB regenerated; pins added (also closes the
KB half of board FIX item 69).

### 186 — Load speed: DONE (measured, fixed underneath, look untouched)
Production vite build, before/after (`.lane/load-measurement.md`,
logs `load-build-baseline.log` / `load-build-after.log`):
editor entry chunk **336.75 kB (gzip 91.24) → 332.06 kB (gzip 89.75)**.
Fixes: `openThyChat` extracted to `lib/open-thy-chat.ts` (the 680-line
chat module graph no longer ships inside the editor entry);
TemplatePicker and ChromaKeyPreview → React.lazy (both on-demand
surfaces; rendered output identical). Honest remainder, stated in the
measurement doc: the rest of the entry chunk IS the first-paint studio
(page + TimelineDock + preview players) — deferring it would change
what the user sees on open, so it is **look-bound and left alone**
rather than padded into a fake bigger number.

### 187 — Stalls + reliability: DONE
- A-07 reserve/settle/release verified in the editor's own rail
  (export-video.ts executeExport path) + refund/reserve suites green
  (below).
- Export poller (prior run): transient poll failures (network throw,
  30s abort, 5xx/429) tolerated up to a consecutive budget inside the
  A-10 deadline; 4xx surfaces at once.
- **Continuation completion:** the plan's "same check for the other
  pollers" found the two LipSyncSection loops (scene-test poll, main
  job poll) still threw on the FIRST transient failure — one blip
  killed the client's view of a durable, still-running (and charged)
  job. Both now ride the shared contract in new
  `lib/poll-tolerance.ts` (`PollFailureBudget`,
  `isTransientPollHttpStatus`, `MAX_CONSECUTIVE_POLL_FAILURES = 5`);
  the export poller was refactored onto the same lib (constant
  re-exported, behavior pinned by its existing tests + new
  poll-tolerance pins). Audited and already tolerant, left as-is:
  MultiRatioExport poll (catch → null → interval keeps polling until
  terminal state), LipSyncStudio run-all poll (interval, error shown
  but polling continues and clears on success), upscale status poll
  (interval, catch-swallow).
- Honest note: the MultiRatioExport poll has no overall deadline of its
  own — it polls until the durable job reports done/failed. That is
  stall-safe (never abandons a live job) but a permanently wedged
  server job would poll indefinitely; flagged here, not silently
  "fixed" with an arbitrary cap.

### 188 — Dead-control sweep: DONE
Full census in `.lane/dead-control-census.md`: 569 `<button>` elements
across the editor surface — 562 with handlers; of the 7 without, 6 are
by-design (drag/trim handles, honestly-disabled placeholder rails with
truthful titles). ONE real find: a permanently-disabled duplicate
"Apply to All Clips" in LipSyncSection's Auto Lip Sync card sitting
next to a working Apply-to-All — **wired to the same confirm flow**
(`setConfirmOpen("all")`, same gating, `btn-lip-sync-apply-all-auto`).
Switch census: 0 checked-without-handler. Controlled inputs: 0 without
onChange. Honestly-labeled limits verified and left: SongWorkflow
large-file transcription "coming soon" (manual paste works),
BackgroundReplace AI tab not-connected notice.

### 189 — Tools end-to-end in the editor: DONE (code-path + suite proof; no live provider calls)
- **Green screen:** editor ProTools chroma-key settings →
  clipProTools → `routes/generate/pro-tools-ffmpeg.ts` chromakey pass
  in export; pinned by pro-tools-ffmpeg suite (31 tests, incl. the
  exact `chromakey=0x00FF00:0.300:0.200` chain). ChromaKeyPreview in
  page. (The separate live-camera green-screen engine is the parent
  lane's board item 3 — not this item.)
- **Lip sync:** LipSyncSection (preview / scene-test / run-all) +
  LipSyncStudio single-clip + still-to-lip-sync; charges per rulings
  (confirm = 400 VB, run-all 300 VB/scene idempotent + refunded on
  failure, A-06). Dark state is honest and brand-clean after this
  lane: the not-connected panel no longer names rival providers or
  "Replit Secrets", and status shows human provider labels
  (board item 60 closed: latentsync → LatentSync, sync → Sync).
- **Upscale:** pages/upscale.tsx embedded as an editor tab; classic
  ffmpeg rail live; generative rail (1,500 VB, A-05) shows the honest
  dark state verbatim — "Generative AI upscaling isn't connected yet …
  You won't be charged" — never faked.
- **Translate:** pages/translate.tsx embedded; quote is the ruled
  500 VB per minute per language in the cost table, the page copy and
  the confirm override (A-04).

### 190 — Docking audit: DONE
Full desk-by-desk table in `.lane/docking-and-competitor.md`: one page,
one project (projectId flows to every section), one library
(AssetLibraryPanel + hub assets), 28 tabs all docked in the CREATE
shell; BRAND = in-editor branding tab; EXPORT→PROMOTE→MONEY handoffs
verified in code (FinalVideoExport scheduler handoff + ShareMenu
share-to-earn + PublishToShowcase; ExportSection PublishToProfileButton
+ scheduler deep-link). No standalone or duplicated desk found; the
only duplication anywhere was the dead button closed under 188.
No moves made (layout moves are forbidden in this lane regardless).

### 191 — Export honesty in the editor: DONE
- Lip-sync completion now surfaces the migration-0230 `resultMeta`
  (provider, input/output dimensions, resolutionReduced) via the pure
  formatter `lib/lip-sync-result-meta.ts` — final dimensions and any
  resolution reduction stated plainly where the creator actually is.
- Standard (non-quality) FinalVideoExport completion likewise now
  shows the job result's final WxH, not just the aspect ratio.
- Rails verified as ruled: branded exports FREE / clean 400
  (A-01/A-02) — export-branded-free + export-quality suites green;
  multi-ratio disclosure suite green (partial-failure refunds stated
  in the completion toast, verified in MultiRatioExport).

### 192 — Competitor-named gaps: DONE (census; one named gap honestly open)
Census in `.lane/docking-and-competitor.md` against CAPCUT_RESEARCH.md
+ research_notes named lists only: multi-track timeline, auto-captions
with animated styles, speed curves, keyframes, Auto Cutout, beat sync,
freeze frame, markers, undo/redo, stabilization, color grading/LUTs/
scopes — all PRESENT with code evidence. **One named capability is
genuinely ABSENT: proxy editing.** Not built: it is a media-pipeline
feature (server proxy transcodes + editor source-swap + export
relink), not a lane-sized function fix, and it is absent from the
study's own highest-leverage list. Flagged for its own board slot.
Nothing unnamed was built.

## Verification — exact numbers from finished logs (`.lane/logs/`)

Final runs on HEAD (395dcce9), sequential, `--maxWorkers=1`,
TMPDIR=<worktree>/tmp:

| Run | Log | Result |
|---|---|---|
| FE typecheck (full, non-incremental) | fe-typecheck-full.log | exit 0, zero errors |
| API typecheck (full, non-incremental) | api-typecheck-full.log | exit 0, zero errors |
| FE targeted (poll-tolerance, export-job-poll, lip-sync-result-meta, editor-priority-s200) | fe-targeted-final.log | **4 files / 27 tests passed** |
| API targeted (operator-knowledge, export-jobs-refund, export-reserve, lip-sync-jobs, export-multi-ratio-disclosure, export-branded-free, export-quality, lip-sync-decisions) | api-targeted-final.log | **8 files / 120 tests passed** |
| API pro-tools ffmpeg (green-screen chain, item 189) | api-protools-final.log | **1 file / 31 tests passed** |

Prior-run finished logs (same branch, pre-drain): KB suite after A-03
regen 63 passed (api-kb2.log); FE targeted 8 files / 50 tests
(fe-targeted-1.log); API scope 5 files / 111 tests (api-scope.log);
load builds before/after (load-build-*.log).

Not run in this lane: the FULL FE/API suites — per the stack process
those run on the joined tree at join time. The known wall-clock
false-red (storefront-bookings-cancel after ~15:00 EDT) and the known
load flakes were not encountered because no full-suite run was made;
nothing in the targeted sets failed.

## Left open + why
1. **Proxy editing (192)** — named competitor capability, genuinely
   absent; needs its own board slot (media pipeline, not a lane fix).
2. **Owner-gated deletions (188-adjacent)** — ExportSection
   caption-export `comingSoon` dead branch; D-06 dead settings fields
   (masterPlayerSnapPosition, autoEdit, autoEditPlan). Deletion-class;
   needs the owner's word. Untouched.
3. **ExportDoctor board items 62–68, 70–71** — BLOCKED-OWNER on the
   master board (product/security/design calls). Item 69's KB half is
   closed by 185; its generator-widening half is the same change.
4. **A-04 registry/KB display model** — KB price row carries the flat
   registry figure labeled per-minute/per-language; accepted as the
   display model unless the owner rules otherwise. Flagged, not built.
5. **MultiRatioExport poll deadline** — no overall cap (see 187 note);
   stall-safe by design, wedged-job case flagged honestly.
6. **186 remainder** — entry-chunk bulk is the first-paint studio
   itself; further reduction would change what renders on open
   (look-bound). Stated, not worked around.

No item in 185–192 was blocked by the look constraint from completing
its function scope; the two look-adjacent remainders (186 chunk,
hypothetical layout moves in 190) are named above with their reasons.
