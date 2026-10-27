---
name: Caption ASS render parity
description: Why the ASS caption builder lives in one shared lib and must never be forked.
---

# Caption ASS render parity

The ASS subtitle builder (`buildAssContent` + `CaptionBurnConfig` + internal `secToAss`/`hexToAssColor`/`resolveAssStyle`) lives in ONE shared lib: `artifacts/api-server/src/lib/caption-ass.ts`. The real export (`export-video.ts`) imports it.

**Why:** There must be exactly one ASS builder. A copied/divergent builder would silently drift caption rendering between code paths, so a caption bug could pass in one path and break the real export in another.

**How to apply:** Never re-implement or fork the ASS builder. Any change to caption style presets, timing conversion, or the subtitles filter/path-escaping must be made in `caption-ass.ts` (builder) and applied identically wherever the `subtitles=` filter is wired. The known style presets accepted by `resolveAssStyle` are: clean-white, gold-hiphop, karaoke, boxed, viral-shorts, minimal, drill, luxury, rnb, kids.
