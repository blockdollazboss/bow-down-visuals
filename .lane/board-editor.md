# Stack-100 #3 — Lane D: Video Editor Deep Audit Board

Editor: Visual Vibes (/video-editor). LOOK is do-not-touch; scope = function, completeness, reliability.
Base: stack28/integration @ f96d7b72 (live). Lane branch: stack29/editor.
(Board at board-editor.md because .lane/board.md is the committed Stack-28 world board.)

Severity: P0 = creator flow broken / price or claim falsehood. P1 = feature dead, half-wired, or lying control. P2 = minor.

## AUDIT INTEGRITY NOTE
Two sub-audits were commissioned (API/KB; FE panels). Audit A (API/KB)
fabricated evidence wholesale: nonexistent files (routes/export/final-video.ts,
lib/final-export-payload.ts, components/video-studio/HomeStudioSection.tsx,
lib/export-jobs.ts, music/FileDropzone.tsx), nonexistent schema fields
(captions.text2, fontStyle.canvasFontDataUrl), nonexistent KB quotes
("MP4, WAV, etc.", "captions in every language"), and false verdicts on
working features (stems polling, SpeedSegmentsPanel, AiCopilotPanel apply,
AutoAiEditSection apply, MemeMachine download, ColorCurves histogram,
TimelineDock ruler, SongWorkflow transcription) — do not cite it.
Audit B (FE panels): its early draft contained false items (same list
above), BUT its full report's panel-by-panel claims — including a fresh
P0/P1 set (N-01…N-07 below) — were re-verified line-by-line in this lane
and proved TRUE. Lesson recorded: verify per-claim, never per-source.
CORRECTION (third pass): the same applies to Audit A. The verdict above
was formed from its early draft; Audit A's FINAL report (server rail +
KB) cites real files at line numbers matching this lane's own readings,
and every claim re-checked in the third pass (A-01…A-10 below) proved
TRUE. The fabricated-draft items (nonexistent files/KB quotes) stand as
recorded, but "do not cite Audit A" is rescinded for its final report.
EVERY finding below was verified by the parent lane's own reading of the code.
The real KB editor entry is truthful (description modest; prices machine-scraped
from credit-costs.ts; endpoints scraped from real fetch calls). The export rail is
sound: POST /api/export-final-video → 202 {jobId} → GET /api/export-video-job/:jobId,
zod top-level schema with nested configs passed as z.any() (nothing stripped),
charge-on-success 400 VB standard / 150 VB quality via chargeCreditsForJob.

## VERIFIED FINDINGS

### D-01 (P0) Lip-sync run-all confirm understates the real charge 80×
- FE: LipSyncStudio.tsx:409 confirm dialog says "5 site Visual Bucs for the final
  export (charged only if the export succeeds)".
- Rail truth: run-all export rides the standard export job
  (lip-sync.ts:1551-1565 → runExportJobInBackground → export-video.ts:3018-3021):
  exportCost = EXPORT_CREDIT_COST = 400 VB, charged on success.
- The API route's own comment (lip-sync.ts:~1603) repeats the stale "5 credits"
  (pre-×100-rescale remnant). Display must move to rail truth; charge unchanged.

### D-02 (P1) LipSyncStudio single-clip button disabled although the rail exists
- LipSyncStudio.tsx:540-590: two buttons disabled "Coming soon" (Stack-28 #43
  decision: no per-clip rail existed then, component had no clip input).
- Reality now: POST /api/lip-sync/scene-test {clipUrl, audioUrl, sceneStartSec,
  sceneEndSec, videoOffsetSec} + GET /api/lip-sync/scene-test/:jobId is a working
  single-clip rail — already wired in the editor's LipSyncSection
  (LipSyncSection.tsx:1435-1520, confirmedFetch + poll + download).
- LipSyncStudio has projectId + audioUrl + getAccessToken: it can load the
  project's scenes (GET /api/projects/:id → output_data.scenes, demoClipUrl) and
  compute windows with the editor's own computeSceneTimings (lib/scene-timing.ts:71).
- The single-IMAGE button stays honestly disabled: no still→clip rail exists.

### D-03 (P1) Stale "Lip Sync not connected yet" banner contradicts the working studio
- LipSyncStudio.tsx:~578-595 amber banner claims lip sync is not connected and
  tells users to "Connect a lip sync service (Hedra, Sync.so, D-ID, or HeyGen)" —
  false (run-all works; sync-3 is the production model) and names rival companies
  in user-facing copy.

### D-04 (P1) "Protect face / center" toggle does nothing (parent finding)
- EffectsSection.tsx:616-622 toggle writes settings.overlayProtectFace.
- ZERO consumers: ActiveOverlayEffects.tsx consumes overlayProtectCaptions
  (clip-path safe zone, LightLeaksEffect) but never overlayProtectFace;
  FinalVideoExport and the API have no reference. Lying control.

### D-05 (P2) StemList waveform is a static placeholder (parent-confirmed)
- StemList.tsx:347-360: Waveform() renders fixed fake bars ("Static visual
  placeholder… real rendering coming soon") although every stem row has a real
  audio URL and the codebase already decodes peaks from a URL
  (TimelineDock.tsx:1619 RealWaveform).

### D-06 (P2, board-only) Dead settings fields
- lib/editor-settings.ts: masterPlayerSnapPosition, autoEdit, autoEditPlan —
  no UI writes them, nothing reads them (the live AI-edit flow uses aiEdit).
  Harmless dead weight in saved projects; removal NOT attempted (persist-shape
  risk outweighs value). Noted for a future cleanup lane with owner deletion word.

### Out-of-lane flags (for parent; not touched here)
- pages/lyric-video.tsx:33 comment/UI copy "5 credits to render" and
  lib/video-translator.ts:4 "5 credits/min/language" look like the same
  pre-rescale staleness class as D-01 — their rails were not verified in this lane.

## VERIFIED HEALTHY (checked, no defect)
Export rail + payload (FinalVideoExport consumes scenes/captions/branding/
effects/overlays/ducking/adjustmentItems; API honors them), project save/autosave
(ref-mirrored, verify-after-write), stems split + remix polling contract,
SpeedSegmentsPanel → clipProTools → export, AiCopilotPanel applies (transitions,
caption style, real scene split), AutoAiEditSection (plan → effects/captions/
transitions applied, undoable), AutoChaptersCard (generate → edit → copy),
ColorCurves scopes/histogram (real frame data), TimelineDock ruler + beat ticks,
SongWorkflow transcription (/api/transcribe-url), mobile section sheet (pinned,
every section reachable), LipSyncSection single-clip + preview rails, KB editor entry.

## FIX LOG — ALL BUILT + COMMITTED on stack29/editor
- F-1 (D-01) — ec767789: confirm copy 5 → 400 Visual Bucs; API route comment corrected.
- F-2 (D-02 + D-03) — e492cdc6: single-clip lip sync wired (scene-test rail,
  scenes by projectId, computeSceneTimings windows, poll, result + download);
  false "not connected" banner (named rival services) replaced with truthful
  copy; image button stays honestly disabled; Stack-28 #43 pin updated.
- F-3 (D-04) — bda7ad0c: overlayProtectFace wired (center-ellipse mask over the
  visual-effects layer in ActiveOverlayEffects; page passes the setting); pins added.
- F-4 (D-05) — 12dc8246: StemList waveform renders real peaks via getAudioPeaks;
  fake bars only as loading/failure fallback; pins added.

## SECOND-PASS FIX LOG — ALL BUILT + COMMITTED
- N-01 + N-02 + N-03 — 81743689.
- N-04 + N-05 + N-06 + N-07 — 56139a66 (incl. editor-honesty.test.ts, 7 pins).

## VERIFICATION (finished logs only, .lane/logs/)
- FE typecheck: 0 errors (twice — fe-tsc2.log after the N-series). API typecheck: EXIT 0 (api-tsc.log).
- N-series pins: editor-honesty 7/7 PASS (fe-nseries2.log); combined pin run
  16 passed / 1 initial fail (a pin tripped on the fix's own comment quoting
  the old fabricated URL; comment reworded, rerun green).
- Editor area: 6 files / 39 tests PASS (fe-editor-area.log).
- Editor lib: 9 files / 73 tests PASS (fe-editor-lib.log).
- New/updated pins: face-protect 3/3, stem-waveform 3/3, lipsync 4/4.
- Full FE suite: run was KILLED mid-run by a service restart after 292/350
  files (~4,213 tests) — all green except src/lib/world/money-desks.test.ts
  (1 test, 220 s under three-lane contention), proven a load flake by
  standalone rerun: 17/17 PASS in 9 s (money-desks-rerun.log). The remaining
  ~58 files were not reached by that log; the lane's own surface is covered
  by the targeted runs above. A clean full-suite pass is still owed at join.

## SECOND PASS — late FE panel audit (Audit B full report)
The full Audit B report arrived AFTER the first report was filed. Its
earlier draft contained fabrications, so every NEW claim was re-verified
line-by-line in this lane before boarding. This time the claims checked
out — including one P0 worse than anything in pass 1. (Its claims that
contradicted pass-1 verification — TimelineDock, SpeedSegments, AutoAiEdit
apply, MemeMachine — were stated correctly in the full report and agree
with pass 1.) All N-items below are parent-verified in code.

### N-01 (P0) Studio Editor "Use Placeholder" fabricated a video URL — FIXED 81743689
StudioEditorSection.tsx:229 invented
https://storage.bowdownvisuals.com/placeholders/<section>-<dur>s-placeholder.mp4
(no file is ever created), reported placeholderCreated/attachedUrl/
allClipsNowValid = true, and applyUrl wrote it as the scene's real
demoClipUrl via the page's real setScenes — preview/export would chase a
nonexistent file while the panel claimed every clip valid.
Fix: fabrication removed; action honestly disabled with truthful copy.

### N-02 (P1) Studio Editor "Regenerate Clip" was a fake job — FIXED 81743689
Job id was gen_<Math.random>, regenerateStarted = true, no API call,
nothing polled or attached. Fix: honestly disabled ("regenerate from the
Clips tab"); the real Repair action (search scene data for an existing
URL) is unchanged.

### N-03 (P1) Edit Recipes counted un-applied cuts as "applied" — FIXED 81743689
TimelineTemplatesSection cut ops did applied++ while only pushing times
into the localStorage beat-cut plan (wave9b-beatcuts-*, consumed by
nothing — writers re-read it only to merge). The toast's cutNoteSuffix
already disclosed the plan truth; the headline count lied. Fix: cut ops
no longer increment `applied`.

### N-04 (P1) LipSyncSection "face detection" was a mock gating Apply — FIXED 56139a66
faceDetected was literally !!demoClipUrl and confidence rendered as
"high (mock)"; the card was titled Face Detection and Apply's error said
"No clear face found…". No detection exists. Fix: card/rows/error
relabelled to the real requirement (a video clip attached); face check
row honestly reads "not available". The clip-presence gate itself stays
(a clip genuinely is required) — only the false labeling is gone.

### N-05 (P2) AutoAiEdit debug row contradicted the export truth — FIXED 56139a66
Row claimed "Transition export connected — no (preview only)" while
applied transitions are written to settings, collected by
FinalVideoExport, and rendered by the export rail. Row corrected.

### N-06 (P2) Keyframes hardcoded 10s duration + fake playhead — FIXED 56139a66
clipDuration was the constant 10 and currentTime the constant 0, yet the
button said "Add at playhead (0.0s)". Fix: duration now derives from the
active scene's own timestamp via parseRawSceneDuration; copy says "at
start"; the strip line is labelled a start marker. (True playhead
integration would need a playback-position prop this panel doesn't get.)

### N-07 (P2) PreviewTransport stale caption — FIXED 56139a66
"Final studio-quality rendering/export comes in the next phase" — the
ManualDAW Export tab in the same studio already exports. Caption now
points at it.

### Board-only from Audit B (verified, not built)
- Studio Editor "Lock Timeline" locks nothing outside the panel:
  lockedTimeline has zero consumers in the repo; it is a local JSON
  snapshot presented as an export gate. Relabel candidate ("Snapshot"),
  needs a product call on whether a real lock should exist.
- 3-Second Lab: generate/rank works (POST /api/three-second-lab/openings)
  but results have no apply-to-timeline action.
- Mode gating: in Simple mode the Music mode switch is hidden, so
  ManualDAW + LipSyncStudio are unreachable; ExportDoctor is Pro-mode
  only; pre-production renders empty without a project. Design-level.
- SongWorkflow: large-file transcription honestly labelled "coming soon"
  (manual lyric paste fallback works) — a labelled limit, not a lie.
- ExportSection caption-export "coming soon" branch is dead code (no
  option sets comingSoon) — cleanup candidate, deletion-class.
- Effects overlays (Rain/Smoke/…) are preview-only BY DESIGN and are
  labelled as such in the UI — not a defect; noted so nobody re-flags it.
  (Pass-1 D-04's protectCaptions preview/export divergence is the same
  family: preview leads, export doesn't render overlays at all today.)

## THIRD PASS — Audit A FINAL report (server rail + KB), re-verified per-claim
Every item below was verified by this lane's own reading (line numbers are
this lane's). These are money/durability defects: per the owner's
named-yes law for price and charge changes, NONE of the charge-logic items
were built in-lane — they are boarded with exact evidence + the decision
each one needs. The one safe fix (a stale comment) was built: 5726e34d.

### A-01 (P0) Branded exports are charged the clean price — owner law broken
Owner law (MEMORY, ratified): clean export 400 VB, branded exports FREE.
Server reality: POST /export-final-video pre-check demands >= 400 VB for
EVERY call (export-video.ts:3164-3172) and the success charge is
unconditionally EXPORT_CREDIT_COST (export-video.ts:3018-3021) — no
branding/watermark branch exists in the rail. Worst case: free/trial
users are FORCED to carry the watermark (export-video.ts:1176-1182,
effectiveAddWatermark = true) and still pay the full clean price.
DECISION NEEDED (owner): the exact definition of "branded" for the free
branch (watermark on? branding.watermark enabled? creator brand kit?),
then implement: pre-check + charge branch on it, KB variant row added.

### A-02 (P0) Quality export is a 150 VB clean-export loophole
POST /export-quality charges flat QUALITY_EXPORT_COST = 150
(export-video.ts:3211-3226 pre-check; :3018 tier select) on the SAME
schema/pipeline — resolution to 4K, MOV/ProRes/DNxHR, watermark toggle
for subscribers. A clean ProRes 4K export costs 150 VB vs 400 standard.
DECISION NEEDED (owner): raise the quality price, or restrict
watermark-off on this rail, or rule the 150 price intentional.

### A-03 (P1) KB omits the editor's entire export rail (verified programmatically)
operator-knowledge.json, entry id "video-editor": 102 endpoints, and
/api/export-final-video, /api/export-video-job/:id, /api/export-quality,
/api/export-multi-ratio, /api/prepare-export-files, /api/export-doctor/*,
/api/auto-reframe, /api/lip-sync/run-all are ALL absent. The operator's
grounding therefore cannot truthfully describe how the editor exports.
Root cause per Audit A: the generator harvests endpoints from the page
file only, not the editor's components. FIX PATH (parent/operator lane):
widen the harvest in scripts/generate-operator-knowledge.mjs + regen.
Also: KB baseCommit is 6cc14c93, not this tree's f96d7b72 (stale by
construction), and every desk entry duplicates the full editor lists.

### A-04 (P1) KB + FE registry price Video Translator flat 500; real is 500/min/language
Server: credits = billableMinutes * languageCount * 500
(routes/generate/video-translator.ts:62-63, :106-116). A 3-min,
2-language job costs 3,000 VB; the operator and the confirm dialog
(credit-costs.ts, sourced into the KB) both quote 500.
DECISION NEEDED: per-minute pricing display model for registry + KB.

### A-05 (P1) Unapproved PLACEHOLDER price is live and charging
Generative AI Upscale charges 1,500 VB while its own constant reads
"PLACEHOLDER — needs user price approval" (upscale-generative.ts:17,25).
The KB at least labels it "(price TBD)". DECISION NEEDED (owner):
approve 1,500, set a real price, or hide the feature until priced.

### A-06 (P1) Run-all lip-sync charges 0 VB per scene — bundle or leak?
/preview charges 300 VB per clip (lip-sync.ts:404, :545). processRunAll
creates sub-jobs directly (lip-sync.ts:1403) bypassing that charge; the
only VB charged is the final export's 400 (now truthfully disclosed
after D-01). DECISION NEEDED (owner): intended bundle (then the KB's
300/scene row needs a run-all entry) or an undercharge to close.

### A-07 (P1) Finished render is discarded if the balance drops mid-render
Charge happens after the render succeeds; on OutOfCreditsError the job
is failed (code out_of_credits) and execution returns BEFORE completeJob
(export-video.ts:3038-3046) — the completed video is never delivered.
Combined with the up-front 402 gate, spending credits elsewhere during
a long render loses the finished export. FIX PATH (parent): deliver +
flag, or reserve/hold at job start — money-flow call.

### A-08 (P1) Multi-ratio + run-all orchestration are memory-only
export-multi-ratio.ts:109 `const jobs = new Map` (2h TTL); lip-sync.ts
:1207 `lipSyncRuns = new Map` (swept at 2h; server note admits restarts
kill orchestration). A deploy mid-render loses the job the FE told the
user to "come back anytime" to (LipSyncStudio persists runId for
resume). The main export rail was rebuilt durable (Postgres) for
exactly this failure. FIX PATH: persist both stores like export_jobs.

### A-09 (P2) Lip-sync preview accepts then discards four user controls
lip-sync.ts:429-432: `void audioSourceType; void strength;
void preserveFaceIdentity; void preserveArtistLook;` — validated, sent
by the FE, never passed to the provider. DECISION: wire them through
or remove/label them in LipSyncSection.

### A-10 (P2) FE export poller deadline < server's legal worst case
Poller gives up at 20 min (lib/export-job-poll.ts:33); server Pass A
alone allows max(10 min, 10x duration) (export-video.ts:2720) plus
phase-1 steps — long videos finish (and save) after the FE declared
timeout, and no user-facing surface lists export_jobs to check.
Also verified benign: captionExportMode never reaches the server as a
field (the FE nulls captions client-side unless mode is "burn",
FinalVideoExport.tsx:693) — no stripping defect in practice.
And: all 116 editor-called endpoints exist server-side (Audit A's
endpoint sweep, spot-verified in this lane) — zero dead endpoints.

## CONTINUATION PASS (after the original builder died in the night's restarts)

- A-10 FIXED — 75f0f910: pollExportJob's flat 20-min deadline replaced by
  exportPollDeadlineMs (45-min floor; 12x duration + 15 min when the caller
  knows it — the rail budgets each phase-1 step at max(10 min, 10x clip)
  in routes/generate/export-video.ts runFfmpeg, passes at 8 min each);
  FinalVideoExport passes estimateDurationSec; the timeout message no
  longer points at an "Exports history" surface that does not exist
  (verified: no user-facing export-jobs listing anywhere). 5 pins incl. a
  fake-timer run that stays alive past the old cap.
- Out-of-lane flags RESOLVED, and worse than flagged — 85151156:
  * Video Translator FE preview was a LIVE 100x under-quote, not a stale
    comment: TRANSLATOR_CREDITS_PER_MIN_PER_LANG = 5 fed estimateTranslateCost,
    rendered big in pages/translate.tsx and passed as the confirm's
    overrideCost, while the rail charges VIDEO_TRANSLATOR_CREDITS_PER_MINUTE
    = 500 (verified in-tree; API suite pins 500). Constant + comments +
    FE pins corrected to rail truth (90s x 2 langs = 2,000 VB, was 20).
    Charge unchanged. A-04's remaining half (registry/KB flat-500
    presentation model) stays an owner decision.
  * Lyric-video staleness was comment-only (FE lib constants already
    pinned 200/500): page header + API route headers corrected to
    LYRIC_ALIGN_CREDIT_COST 200 / LYRIC_RENDER_CREDIT_COST 500.
- N-08 (new, P0 family of D-01) FIXED — 94f829b8: 3-Second Lab passed
  overrideCost: 2 into confirmedFetch, so the spend confirmation AND the
  post-spend toast claimed 2 VB for the rail's 200 VB OPENINGS_CREDITS
  charge. Override removed — the registry (200, rail-pinned) now speaks.
  Sibling spot-check in editor/music: finish-my-song 400, lyrics/timing
  50, structure/generate 200 all verified == their rails.
- 3-Second Lab APPLY built — bf432f7c: ranked openings previously had no
  apply action (Audit B board-only item). "Use as opening hook" writes
  the hook into the editor's own hook-caption channel via the new pure
  helper withOpeningHook (lib/editor-settings.ts): captions enabled,
  mode "hook", hookText set, timed line seeded at 0–3s under the stable
  OPENING_HOOK_LINE_ID (re-apply replaces, other lines preserved). The
  button renders only when the page wires onApplyOpening — no dead
  controls. 2 keys added to all 10 catalogs (real translations); locale
  guard pin 4284 → 4286. Helper pins 6/6; locale family 196/196.
- A-08 MIGRATION SPECIFIED, not built (lane rule: no migrations) —
  .lane/a08-migration-spec.md carries the exact SQL + drizzle + boot-
  recovery design for both stores: lip_sync_runs (run-all orchestration)
  and multi_ratio_jobs (recommended over an export_jobs.kind column).
  New evidence strengthening A-08: multi-ratio charges costTotal up front
  and every refund lives in the in-process worker's finally — a hard kill
  skips the finally, so the charge stands with no record anywhere.
  Numbering is the join's call (after the 0205–0214 holds).
- ExportDoctor scoped cost-surface audit (continuation): CLEAN. The
  5,208-line rail has zero charge calls; the registry carries all 13
  endpoints at cost 0 "(free)" (Stack-28 item 2's fix, intact); the
  section passes no overrideCost and quotes no prices. The full
  line-by-line deep audit of ExportDoctor remains undone (see below).

## LEFT ON THE BOARD
- D-06 dead settings fields (board-only; deletion needs owner word).
- LipSyncStudio single-IMAGE button: still honestly disabled — no still→clip
  rail exists anywhere in the codebase. Building one is a feature decision.
- ExportDoctor full deep audit (5,208-line rail + its section) still not
  done — only the cost/confirm surface was audited in the continuation.
- A-08 persistence: exact migration specified in .lane/a08-migration-spec.md;
  needs the join (or an owner-approved migration slot) to land.
- A-03 KB export-rail omission: fix path is the operator/KB generator
  (scripts/generate-operator-knowledge.mjs harvest widening + regen) —
  routed to the parent/operator lane per the third-pass board; a regen in
  this lane would collide with sibling lanes' KB registrations at join.
- Owner decisions, untouched by design: A-01 (branded-export free branch
  definition), A-02 (quality-export 150 VB loophole), A-04 remainder
  (registry/KB per-minute display model), A-05 (upscale placeholder price
  1,500 VB), A-06 (run-all per-scene 0 VB — bundle or leak), A-07
  (finished-render discard on mid-render out-of-credits; money-flow call),
  A-09 (lip-sync preview's four voided controls — wire or remove/label).
- Studio Editor "Lock Timeline" relabel ("Snapshot"): verified to lock
  nothing outside the panel; the relabel itself needs the product call on
  whether a real lock should exist.
- Mode gating (Simple mode hides the Music switch; ExportDoctor is
  Pro-mode only): design-level, not built.
- ExportSection dead caption-export "coming soon" branch: deletion-class
  cleanup, needs the deletion word.
- Clean full FE suite pass: DELIVERED in the continuation (below).

## CONTINUATION VERIFICATION (finished logs only, .lane/logs/)
- FULL FE suite: 353 files / 4,708 tests — ALL PASS (fe-full-continuation.log).
  The pass owed since the first run died at 292/350 is now landed in-lane.
- FE typecheck: exit 0 (after A-10, after translator, after N-08 + apply).
- API typecheck: exit 0 (api-tsc-continuation.log).
- A-10 pins: 5/5 (fe-a10-poll.log). Translator: FE 21/21 (incl. corrected
  pins), API 17/17, lyric API 31/31. N-08: honesty 8/8 + rail-truth 21/21.
  Lab apply: helper pins 6/6; locale family 196/196 (guard 4286);
  editor area 26/26.
