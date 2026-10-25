# Item 188 — Dead-control census (Stack-200 editor lane)

Method: scripted census over the whole editor surface
(components/editor/sections/*.tsx, components/editor/*.tsx,
components/editor/music/*.tsx, pages/video-editor.tsx,
components/FinalVideoExport.tsx):

- 569 `<button>` elements: 562 carry onClick (or submit). The 7 without:
  - CaptionsSection:1749 — a DRAG handle (draggable + onDragStart);
    pointer-drag is its action. Not a click control. OK.
  - video-editor.tsx:5290/5307/5323 — timeline trim handles driven by
    onPointerDown. OK by design.
  - StudioEditorSection:318/331 — "Use Placeholder" / "Regenerate
    Clip", disabled with truthful titles (Lane D N-01/N-02 fixes:
    the rails do not exist; honest-disabled is the correct state). OK.
  - LipSyncSection:2550 — **REAL FIND**: a permanently-disabled
    duplicate "Apply to All Clips" button in the Auto Lip Sync card,
    carrying the stale rationale "will be enabled once the
    selected-scene automation is fully reliable" — while a WORKING
    Apply to All (applyToAll via confirm flow) sits in the Apply Lip
    Sync card of the same panel. FIXED in this lane: wired to the same
    confirm flow (setConfirmOpen("all")), same gating as the working
    control (no clips / no audio), data-testid
    btn-lip-sync-apply-all-auto.
- `<Switch>` census: 0 checked switches without onCheckedChange.
- Controlled inputs/selects/textareas: 0 without onChange (3 initial
  script hits in CaptionsSection were false positives — onChange sits
  past the scan window; verified by reading the rows: start/end/text
  all call updateLine).
- Honestly-labeled limits verified, left as-is: SongWorkflow
  large-file transcription "coming soon" (manual paste works);
  BackgroundReplace AI tab "isn't connected yet" notice when the
  segmentation/image rail is unconfigured (presets/uploads work);
  LipSyncStudio still-image flow is WIRED (still-to-lipsync), not a
  placeholder.
- Owner-gated, NOT touched: ExportSection caption-export `comingSoon`
  dead branch (no option sets it — deletion-class, needs owner word);
  D-06 dead settings fields (deletion-class, owner word).
