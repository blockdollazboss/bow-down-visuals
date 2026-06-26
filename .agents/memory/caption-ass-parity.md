---
name: Caption ASS render parity
description: Why the real video export and the Export Doctor must share one ASS caption builder.
---

# Caption ASS render parity

The ASS subtitle builder (`buildAssContent` + `CaptionBurnConfig` + internal `secToAss`/`hexToAssColor`/`resolveAssStyle`) lives in ONE shared lib: `artifacts/api-server/src/lib/caption-ass.ts`. Both the real export (`export-video.ts`) and the Export Doctor caption test (`export-doctor.ts`) import it.

**Why:** The Export Doctor's whole purpose is to prove a tier works *exactly* like the real export. If the doctor used a copied/divergent ASS builder, a caption bug could pass the doctor yet break the real export (or vice-versa). Duplicating the builder silently breaks that guarantee.

**How to apply:** Never re-implement or fork the ASS builder. Any change to caption style presets, timing conversion, or the subtitles filter/path-escaping must be made in `caption-ass.ts` (builder) and applied identically wherever the `subtitles=` filter is wired. The known style presets accepted by `resolveAssStyle` are: clean-white, gold-hiphop, karaoke, boxed, viral-shorts, minimal, drill, luxury, rnb, kids.

**Doctor failure-reporting rule:** Export Doctor handlers must persist the parsed JSON response body into state *before* branching on `res.ok`, otherwise the backend's real FFmpeg `stderrTail` is discarded on 500s and the UI can't show the actual subtitle error.
