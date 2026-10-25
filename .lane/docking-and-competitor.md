# Items 190 + 192 — Docking audit & competitor-gap census

## 190 — Docking audit (every desk in its CREATE-workflow place)

The editor is ONE page (pages/video-editor.tsx, /video-editor) with one
project (projectId flows into every section) and one library
(AssetLibraryPanel + hub assets via addAsset). 28 tabs, all docked in
the same shell — no standalone pages, no duplicate desks:

CREATE (in-editor): pre-production, studio (StudioEditorSection),
clips (ClipGeneratorSection), timeline, captions (CaptionsSection +
AiCaptionSuite), effects, motion (MotionGraphicsSection), pro-tools
(ProTools + Keyframes + BackgroundReplace + Stabilize + SpeedRamp),
music (MusicStudio incl. LipSyncStudio), lip-sync (LipSyncSection),
beat-sync, edit-recipes (TimelineTemplatesSection), templates,
three-second-lab, voice-edits, copilot (AICopilotPanel).
CREATE-adjacent tools docked as editor tabs (embedded, not separate
sites): lyric-video, promo-clips, repurpose, cartoonize, thumbnails,
upscale (pages/upscale.tsx embedded), translate (pages/translate.tsx
embedded), locations, style-stealer, meme-machine, vibes.
BRAND: branding tab (BrandingSection) inside the editor.
EXPORT → PROMOTE → MONEY handoffs (verified in code):
- FinalVideoExport completion block: scheduler handoff
  (buildSchedulerHref → PROMOTE), ShareMenu share-to-earn (tracked
  shares, referral code, quest credit → MONEY loop), PublishToShowcase.
- ExportSection: PublishToProfileButton (the creator's profile =
  their storefront), scheduler deep-link, MultiRatioExportCard,
  SubjectReframeCard, ExportDoctor, AutoClipSection.
No desk found standalone, duplicated, or outside the flow. The one
duplication the sweep found was a dead duplicate BUTTON (item 188),
not a desk. Verdict: docking law holds; no moves needed (and layout
moves are forbidden in this lane regardless).

## 192 — Competitor-named gaps census

Named sources: repo CAPCUT_RESEARCH.md ("Notes for our build" —
the study's own highest-leverage gap list) + research_notes
best-ai-videography-features report (A1–A5).

| Named gap | Status in Visual Vibes (evidence) |
|---|---|
| Multi-track timeline | PRESENT — lib/timeline-lanes.ts resolveLanes; lanes render in TimelineDock and convert to overlay items at export (lanesToOverlayItems). |
| Auto-captions w/ animated styles | PRESENT — AiCaptionSuite: Whisper word timings → word-sync animated burn (/api/caption-styler) + transcript mode; CaptionsSection styles. |
| Speed curves / ramping | PRESENT — SpeedRampSection: ramp curves + optical-flow slow-mo (minterpolate) at a stated 300 VB. |
| Keyframes | PRESENT — KeyframesSection (position/scale/rotation/opacity in ClipEdit). |
| Auto Cutout (no-green-screen bg removal) | PRESENT, honest-dark — BackgroundReplaceSection (canvas composite; AI plate generation; honest "isn't connected yet" state when the rail is unconfigured). Chroma Key (real green screen) in ProTools → export chromakey pass. |
| Beat sync | PRESENT — BeatSyncSection: beat markers → cuts, handoff via onMarkersChange. |
| Freeze frame (CapCut timeline list) | PRESENT — TimelineDock freeze-frame render via /api/freeze-mask/job. |
| Markers | PRESENT — chapter markers (editor-settings VideoChapter, AutoChaptersCard) + beat markers. |
| Undo/redo | PRESENT — hooks/useUndoRedo wired in the page. |
| Stabilization (report A2) | PRESENT — StabilizeSection (vidstab two-pass) docked in pro-tools. |
| Color grading / LUTs / scopes (A1) | PRESENT — ColorGradeSection, ColorCurvesPanel (histogram/scopes), LutImportSection. |
| Proxy editing (CapCut timeline list) | ABSENT — the one named capability with no editor implementation found. NOT built in this lane: it is a media-pipeline feature (server proxy transcodes + editor source-swap + export relink), not a lane-sized function fix; flagged for its own board slot in the report. It is also absent from the study's "highest-leverage" build list. |

No unnamed features were built. No look changes.
