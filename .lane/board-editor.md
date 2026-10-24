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

## LEFT ON THE BOARD
- D-06 dead settings fields (board-only; deletion needs owner word).
- LipSyncStudio single-IMAGE button: still honestly disabled — no still→clip
  rail exists anywhere in the codebase. Building one is a feature decision.
- ExportDoctor (5,623 lines) was not deep-audited in this lane.
- Out-of-lane stale-price flags (lyric-video, video-translator) for parent.
- Clean full FE suite pass owed at join (see Verification).
