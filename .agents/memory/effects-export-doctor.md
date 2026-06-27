---
name: Effects export via CSS→FFmpeg parity
description: How saved Auto AI visual effects are exported and why the real export does not burn them.
---

# Effects export (Export Doctor)

The real video export does NOT burn the saved Auto AI visual effects into the file — they are CSS-only in the master player preview. There is an explicit skip in the real export pipeline noting vignette/film-grain/etc. are "too complex... CSS-only in preview." So there is no shared effect→FFmpeg mapping in the real export to reuse.

The master player applies the GLOBAL `settings.effects: string[]` (not per-clip) by joining each effect's entry from an `EFFECT_CSS_FILTERS` table (in `video-editor.tsx`) into one CSS `filter` string. Per-clip `ClipEdit.effect` exists in the data model but is NOT what the master player renders.

**Rule:** To export effects that match the preview, replicate that exact `EFFECT_CSS_FILTERS` table and translate the combined CSS string to FFmpeg filters (`eq` for brightness/contrast/saturation, `hue` for hue-rotate, `gblur` for blur, `colorchannelmixer` for sepia). CSS `brightness(p%)` is multiplicative; approximate as additive `eq brightness=(mul-1)*0.5`. Only color filters are export-safe — animated overlays (Smoke/Rain/Sparks) are intentionally unsupported and must be skipped + reported, never fatal.

**Why:** Matching the master player ("as visible as possible") is the whole point of the effects tier; forking or guessing the values would drift the export from the preview. Keeping the table identical to `video-editor.tsx` is the parity guarantee.

**How to apply:** If the `EFFECT_CSS_FILTERS` table in `video-editor.tsx` changes, update the backend replica in lockstep. When effects eventually graduate into the real export, reuse this same CSS→FFmpeg translation rather than inventing a new one. Effects must be applied to the concat output BEFORE the subtitles filter so captions stay on top.
