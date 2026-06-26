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

## Prepare-first source identity (export must match master player)
Export gates on a `prepareId`: the prepare route downloads + ffprobes BOTH clips and the master-player audio URL, registers a `PreparedExportEntry` (clips[].resolvedUrl, audio.sourceUrl), and only `allReady` when every clip file AND the audio file physically exist and pass ffprobe.
- Frontend prefers `masterAudioUrl` over `audioUrl` (`effectiveAudioUrl = masterAudioUrl ?? audioUrl`) so export uses the exact URL the player plays — they used to diverge, causing "no audio".
- `export-video.ts` hard-stops (400, JSON) when prepareId is present but: entry missing, not allReady, any clip/audio file gone from disk, OR prepared `resolvedUrl`/`audio.sourceUrl` no longer match the current request (selection changed after prepare).

**Why:** prevents FFmpeg from ever starting against missing/stale files and guarantees export renders the same sources the player shows.
**How to apply:** any new export input that changes which clips/audio are used must also flow through prepare and be re-verified, or the identity check will (correctly) block it.

## JSON-only contract
Prepare and export routes must always return JSON. `parseJsonResponse(res, route)` on the client checks content-type and throws a routing-diagnostic error on HTML. The prepare handler is wrapped in a top-level try/catch returning `{ error }` JSON (guard with `res.headersSent`).
