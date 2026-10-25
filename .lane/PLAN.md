# STACK-200 — EDITOR PRIORITY LANE — PLAN (items 185–192)

Branch: stack200/editor-priority @ 9940beae (stack200/integration, findability joined)
ABSOLUTE CONSTRAINT: editor LOOK is do-not-touch. Function underneath only.

## 185 — Lane D fold-in verdict (verified in CURRENT code, not Lane D's tree)

Lane D records read: .lane/board-editor.md (382 lines, D/N/A series +
continuation), .lane/a08-migration-spec.md. NOTE: the brief named
GAP.md / EVIDENCE.md / JOIN-LOG.md / REPORT*.md in bdv-wt-editor/.lane —
those files do NOT exist there; the editor lane's records are
board-editor.md + a08-migration-spec.md (the other .lane files in that
worktree belong to the Stack-28 world board). Verdicts below are from
reading the code at 9940beae.

### Already shipped — VERIFIED, do NOT rebuild
- D-01…D-05, N-01…N-08, F-1…F-4: built on stack29/editor, present via
  Stack-100 #3 joins (lip-sync confirm = 400 VB, single-clip wired,
  false banner gone, overlayProtectFace wired, real stem waveforms,
  placeholder fabrication removed, 3-Second Lab overrideCost lie fixed).
- A-10: poll deadline = exportPollDeadlineMs (45-min floor, 12x+15m) in
  lib/export-job-poll.ts; honest timeout copy (no fake "Exports history").
- A-01 (branded FREE): export-video.ts — predicted-branded reserves
  nothing; rendered-branded releases reservation in full, no charge.
- A-02 (quality loophole closed): QUALITY_EXPORT_COST = 400 = standard.
- A-04 FE half: credit-costs.ts translator = "500 VB per minute per
  language"; translate.tsx estimate + overrideCost use per-min/lang math.
- A-05: GENERATIVE_UPSCALE_CREDIT_COST = 1500, PLACEHOLDER label gone.
- A-06: run-all charges 300 VB per scene via chargeCredits, idempotent
  per (user, run, scene), refunded on failure (lip-sync.ts ~1614).
- A-07: reserveCreditsForJob at job start; settle on actual output;
  release in full on render failure / branded output (export-video.ts
  3095+). Verified in the editor's own rail (same executeExport path).
- A-08: SHIPPED — migrations 0217_lip_sync_runs.sql + 0218_multi_ratio_jobs.sql,
  drizzle tables lib/db/src/schema/lip-sync-runs.ts + multi-ratio-jobs.ts,
  DB-backed writes + boot recovery in lip-sync.ts / export-multi-ratio.ts.
  The spec's numbering guess (0215/0216) landed as 0217/0218. NO new
  migration needed from this lane for A-08.
- A-09: the four voided controls are wired — lip-sync.ts consumes
  audioSourceType / strength / preserveFaceIdentity / preserveArtistLook
  (no `void` discards remain; preserveFaceIdentity flows into job params).
- Lock Timeline: made REAL after Lane D (lib/timeline-lock.ts — page-level
  lock consulted by scenes/settings setters). Not a relabel candidate anymore.
- Mode gating: lib/editor-mode-gate.ts (Stack-100 #3 Lane 6) — gates are
  visible with reasons; Music modes unlock on mode switch.
- LipSyncStudio single-IMAGE button: still-to-lip-sync built in Wave 3
  (components/editor/music/still-to-lipsync.ts, rides gen4.5 + preview rails).
- Translator/lyric stale comments: corrected in Lane D continuation.

### Still genuinely OPEN — this lane's build list
1. **A-03 remainder (KB)**: operator-knowledge.json video-editor entry
   carries prices for export-final-video/export-quality but its ENDPOINT
   list still omits /api/export-multi-ratio, /api/export-doctor/* (13),
   /api/lip-sync/run-all, /api/export-video-job/:param,
   /api/prepare-export-files. Fix in the generator
   (artifacts/api-server/scripts/generate-operator-knowledge.mjs):
   FEATURE_PRICE_LINKS for the priced rails + a reviewed endpoint-link
   pass for the two unpriced sub-steps; regen + test pins.
   (Also closes board FIX item 69's export-doctor half.)
2. **191 / 0230 surfacing**: lip-sync jobs return resultMeta (provider,
   input/output dims, resolutionReduced) from the server
   (lip-sync.ts toClientLipSyncJob) — NO editor surface reads it.
   Build: pure formatter lib + show final dimensions / reduction plainly
   in LipSyncSection completion. Standard (non-quality) FinalVideoExport
   completion likewise shows only aspect ratio although the job result
   carries width/height (executeExport result) — surface final WxH in
   the completion notice + toast for standard exports too.
3. **Board item 60 (in-lane nit)**: LipSyncSection status shows the raw
   provider string ("Connected · latentsync"). Human label mapping in
   FE (latentsync → LatentSync, sync → Sync). Also the not-connected
   panel still names rival providers + "Replit Secrets" — replace with
   truthful, brand-clean copy (same class as D-03, which fixed the
   Studio banner but not this panel).

### Board-only / owner-gated — NOT built, flagged in report
- D-06 dead settings fields (masterPlayerSnapPosition, autoEdit,
  autoEditPlan): deletion needs owner word.
- ExportSection caption-export `comingSoon` dead branch: no option sets
  it; deletion-class cleanup, owner word.
- ExportDoctor deep audit: board FIX items 62–71, mostly BLOCKED-OWNER;
  item 69's KB half is covered by open item 1 above.
- A-04 remainder (registry/KB per-minute DISPLAY model): the registry
  now labels per-minute/per-language; KB price row is the flat registry
  figure with that label — accepted as the display model unless owner
  rules otherwise. Flagged, not rebuilt.

## 186 — Load speed
Measure first: production vite build, editor entry + first-paint chunk
sizes recorded in .lane/load-baseline.txt. Then fix what measurement
indicts (eager imports in pages/video-editor.tsx that are not needed
for first paint: TemplatePicker modal, chat/collaboration surfaces),
via React.lazy with the SAME rendered output. Re-measure; numbers in
report. No visual change: lazy boundaries render the identical
components; Suspense fallback = existing loader patterns only where a
surface already had one, else null for modal/on-demand surfaces.

## 187 — Stalls + reliability
- A-07 reserve/settle/release: verified in code (above) + existing API
  tests (export-jobs-refund) — rerun targeted suites as proof.
- Poller: A-10 deadline verified. Remaining stall gap to check/build:
  transient poll HTTP failures currently throw immediately
  (pollExportJob: `if (!res.ok) throw`) — one network blip kills the
  FE's view of a healthy durable job. Harden: tolerate transient
  failures (network throw / 5xx) with bounded consecutive-failure
  budget inside the same deadline; 4xx auth errors still surface.
  Pure-function testable via injected fetch? pollExportJob uses global
  fetch — tests stub global fetch (existing export-job-poll tests do).
- Multi-ratio + lip-sync run polls: same transient-tolerance check.

## 188 — Dead-control sweep
Control-by-control pass over editor sections + video-editor.tsx:
grep-driven census (buttons without handlers, disabled-without-reason,
toggles writing unconsumed settings) documented in
.lane/dead-control-census.md; every find either wired, honestly
labeled, or listed as owner-gated deletion. Known starting points:
caption comingSoon dead branch (owner-gated), SongWorkflow large-file
transcription "coming soon" (honestly labeled — verified, stays).

## 189 — Tools end-to-end in the editor
- Green screen: ProTools chroma key — settings flow editor →
  clipProTools → pro-tools-ffmpeg.ts chromakey pass in export (verified
  in code); ChromaKeyPreview in page. BackgroundReplace = AI cutout
  surface with honest not-connected state when segmentation unconfigured.
- Lip sync: LipSyncSection (preview/scene-test/run-all) + LipSyncStudio;
  charges per A-06/D-01; resultMeta surfacing = open item 2.
- Upscale: embedded pages/upscale.tsx in editor tab; rails /api/upscale,
  /api/ai-upscale/status (honest dark state), generative upscale 1500 VB.
- Translate: embedded pages/translate.tsx; per-min/lang quote verified.
Proof = targeted FE+API suites per tool + code-path verification, listed
per tool in the report. No live provider calls (rails dark where
unconfigured — honest states verified, never faked).

## 190 — Docking audit
Desk-by-desk table (in report): every section/tab in video-editor.tsx,
its CREATE-workflow place, and its handoff. Verified anchors:
ExportSection → PublishToProfileButton (BRAND/profile), scheduler
handoff (PROMOTE), ShareMenu share-to-earn + PublishToShowcase,
FinalVideoExport handoffs block; one project (projectId flows to all
sections), one library (AssetLibraryPanel / hub assets). Any desk found
standalone/duplicated gets a function fix or a flag — no layout moves.

## 191 — Export honesty in the editor
Build = open item 2 above. Branded-free / clean-400 rails verified
(A-01/A-02). Multi-ratio disclosure test exists
(routes/__tests__/export-multi-ratio-disclosure.test.ts) — rerun.

## 192 — Competitor-named gaps
From CAPCUT_RESEARCH.md "Notes for our build" + research_notes report
(named only): multi-track timeline, auto-captions w/ animated styles,
speed curves, keyframes, Auto Cutout, beat sync. Census each against
current editor: TimelineDock lanes (lib/timeline-lanes.ts), AiCaptionSuite
word-by-word styles, SpeedRampSection curves, KeyframesSection,
BackgroundReplaceSection (Auto Cutout, honest-dark), BeatSyncSection.
Build only a gap that is BOTH named AND demonstrably absent; document
the rest as present with evidence. Anything not named stays out.

## Verification discipline
TMPDIR=<worktree>/tmp for all runs; suites sequentially, --maxWorkers=1;
numbers only from finished logs in .lane/logs/. Typechecks: FE + API.
Rebuild lib/db + lib/api-zod dists in-worktree before typechecks.
No migration expected (next free 0242 stays untouched unless a build
proves one necessary). NO push, NO join.
