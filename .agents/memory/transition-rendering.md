---
name: Timeline transition rendering
description: How per-clip transitions render in the Bow Down Visuals master player and how to force-trigger one for preview.
---

# Per-clip transition rendering (master player)

The master player renders transitions purely from data: `handleSceneChange` in
`video-editor.tsx` reads `getClipEdit(settings, scene.id).transition` and drives
`TransitionCompositor`. So to make any transition visibly apply, you only need to
write `settings.clips[sceneId].transition` — no separate render wiring.

**Why:** the AI Transition Plan was previously text-only because the plan was never
written into `clips`. Writing the structured transition into per-clip data is the
whole job; the renderer was already there.

**How to apply:**
- Scene 0 never transitions — `prevSceneIdxRef` starts at `-999` and the first scene
  has no predecessor.
- To force the scene-change effect to re-fire (e.g. a "preview this transition"
  button), set `prevSceneIdxRef.current = -999`, seek to ~1s before the boundary
  (`offsets[idx] - 1`), and play so playback crosses into the target scene.
- `TransitionCompositor` vocab: Cut, Crossfade, Fade to Black, Slide, Whip Pan,
  Zoom, Blur Dissolve, Glitch, Spin, Flash, Light Leak. Normalize free-text AI
  transition names into this set before writing them to clips.
- Transitions are preview-only — they are NOT part of the FFmpeg effects export
  pipeline.
