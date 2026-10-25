# Item 186 — Load speed: measurement + fixes (Stack-200 editor lane)

Method: production `vite build` of artifacts/bow-down-visuals on this
worktree, before (log: load-build-baseline.log) and after
(load-build-after.log) the fixes. Chunk sizes are the build's own
reporter output (minified / gzip).

## Baseline @ 9940beae
- Editor entry chunk `video-editor-*.js`: **336.75 kB (gzip 91.24)**
- App shell `index-*.js`: 1,418.32 kB (gzip 449.95) — shared by every
  route, cached across the site; out of this lane's scope.
- Editor desks were already split per tab (Stack-28 #51): ExportSection
  272.95, MusicStudio 172.36, LipSyncSection 116.21, ProToolsSection
  101.01 kB — none of these load at first paint.

## What the measurement indicted in the entry chunk
1. `openThyChat` — a 5-line `window.dispatchEvent` helper — was imported
   from `components/ThyCheatCodeChat.tsx` (680 lines + voice/promo
   deps), dragging that module graph into the editor entry for one
   button.
2. `TemplatePicker` (on-demand modal) was a static import.
3. `ChromaKeyPreview` (renders only while a chroma key is active) was
   a static import.

## Fixes (function underneath; rendered output identical)
- `openThyChat` moved to `lib/open-thy-chat.ts`; ThyCheatCodeChat
  re-exports it (legacy import sites untouched in behavior);
  video-editor + ThyCheatCodeHost import the tiny module.
- TemplatePicker → React.lazy (Suspense fallback null; it is a modal).
- ChromaKeyPreview → React.lazy (fallback null; while it loads the
  underlying plain video shows — the pre-key frame).

## After
- Editor entry chunk: **332.06 kB (gzip 89.75)** — −4.69 kB / −1.49 kB gzip.
- Split out and now on-demand only: TemplatePicker 3.99 kB,
  ChromaKeyPreview 1.65 kB.
- The chat module graph no longer ships inside the editor entry chunk
  (it loads with the app shell's chat host, as before).

## Honest remainder
The rest of the entry chunk is the always-on-screen studio itself
(page + TimelineDock 1,681 lines + preview players + editor-settings)
— it IS the first paint, so deferring it would change what the user
sees on open (look constraint). Caption fonts were already deferred
to surface mount (Stack-28 #50). No further underneath win was found
that does not touch the look; the item closes on the measured splits
above rather than a fabricated larger number.
