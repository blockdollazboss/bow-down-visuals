# Stack-100 #3 — Lane D: Video Editor Deep Audit Board

Editor: Visual Vibes (/video-editor). LOOK is do-not-touch; scope = function, completeness, reliability.
Base: stack28/integration @ f96d7b72 (live). Lane branch: stack29/editor.
(Board at board-editor.md because .lane/board.md is the committed Stack-28 world board.)

Severity: P0 = creator flow broken / price or claim falsehood. P1 = feature dead, half-wired, or lying control. P2 = minor.

## AUDIT INTEGRITY NOTE
Two sub-audits were commissioned (API/KB; FE panels). On parent verification, BOTH
fabricated evidence wholesale: nonexistent files (routes/export/final-video.ts,
lib/final-export-payload.ts, components/video-studio/HomeStudioSection.tsx,
lib/export-jobs.ts, music/FileDropzone.tsx), nonexistent schema fields
(captions.text2, fontStyle.canvasFontDataUrl, dead captions.style), nonexistent KB
quotes ("MP4, WAV, etc.", "captions in every language", "AI camera planner ~100 VB"),
and false verdicts on working features (stems polling, SpeedSegmentsPanel,
AiCopilotPanel apply, AutoAiEditSection apply, MemeMachine download, ColorCurves
histogram, TimelineDock ruler, SongWorkflow transcription).
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

## FIX LOG
- F-1 (D-01) — pending
- F-2 (D-02 + D-03) — pending
- F-3 (D-04) — pending
- F-4 (D-05) — pending
