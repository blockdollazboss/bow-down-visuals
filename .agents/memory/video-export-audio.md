---
name: Video Export Audio Integration
description: How Music Studio audio exports connect to final video export; field names and backward-compat.
---

## Rule
`VideoAudioSource` changed from `"uploaded" | "finalMix"` to `"uploaded" | "full-mix" | "instrumental" | "acapella" | "none"`.
`normalizeMusicStudio` converts old `"finalMix"` → `"full-mix"` automatically.
`ManualDAW.tsx` "Use for video" button sets `source: "full-mix"`.

## ExportSection
Resolves the audio URL from `ms.exports` (AudioExportRecord[]) based on the selected source:
- full-mix → latest export where kind === "full" (prefers mp3)
- instrumental → kind === "instrumental"
- acapella → kind === "acapella"

## Backend (export-video.ts)
New request fields: `aspectRatio` ("9:16"|"16:9"|"1:1"), `fadeAudioIn`, `fadeAudioOut`, `loopAudio`, `addWatermark`, `audioSource`.
- Aspect ratio maps to pixel dims: 9:16→1080×1920, 16:9→1920×1080, 1:1→1080×1080.
- Audio loop uses `aloop=loop=-1:size=2147483647` + `atrim=duration=X` in `-af`.
- Watermark uses `drawtext` filter chained after concat.
- Uses `-t totalVideoDuration` instead of `-shortest` to avoid cutting video when audio is shorter.

**Why:** `-shortest` would cut the video to audio duration when audio ends before video. Using `-t` ensures video always runs its full duration.
