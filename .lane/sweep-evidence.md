# OW2 sweep — close-on-evidence records (items 13, 14, 15)

Base commit b152852f. All three texture items were delivered by commit
e355cb9f "Open World Overhaul stage 3 (texture floors): use the resolution
already on disk" (an ancestor of the base), which the 100-item board in
the reference worktree still tags "Stage-3 build" — the board is stale,
the code is not. Verified by reading the code at the base commit:

## Item 13 — Guard figure resolution (audit T9) — CLOSED ON EVIDENCE
- `artifacts/bow-down-visuals/src/lib/world/figure.ts:120-125`:
  `defaultFigureCanvasSize()` returns `h = 1536` (width clamped 128–1024).
  The comment records the old 768 cap discarding ~65% of the ~2167px art.
- Consumed by the real render path:
  `artifacts/bow-down-visuals/src/lib/world/hall-scene.ts:1031`
  (`buildDefaultFigure` sizes its canvas from `defaultFigureCanvasSize(aspect)`).
- Pinned by `figure.test.ts:50`: `expect(h).toBe(1536)`.

## Item 14 — Anisotropy at the renderer's real max (audit T12) — CLOSED ON EVIDENCE
- `hall-scene.ts:320` module ceiling `maxTextureAnisotropy`, captured from the
  real renderer at scene construction, `hall-scene.ts:1362`:
  `Math.min(16, this.renderer.capabilities.getMaxAnisotropy() || 8)`.
- Floor/wall diffuse maps all load through `hallTexture` (`hall-scene.ts:357`:
  `tex.anisotropy = maxTextureAnisotropy`) — plaza floor at 1836, room floors
  at ~2720, wall surfaces via the `surface()` helper at ~1488.
- Derived PBR maps (normal/roughness/AO) set to the same max at all three
  build sites: `hall-scene.ts:1482, 1838, 2721`.
- The quality ladder consumes it: `applyTierToRenderer` (`hall-scene.ts:4370`)
  rewrites every cached texture to `Math.min(rung.anisotropy, maxTextureAnisotropy)`
  on a tier change; the rung table itself (16/8/4) is pinned by
  `quality.test.ts` ("every rung differs from its neighbour on multiple axes",
  anisotropy among the axes). The remaining fixed `anisotropy = 4` sites are
  canvas plate/figure textures (door plates, portrait + guard canvases), not
  floor/wall maps — outside this item's scope.

## Item 15 — Texture load fallback (audit T14) — CLOSED ON EVIDENCE
- `hallTexture` (`hall-scene.ts:331-356`): on CDN load error it retries the
  same asset from the site origin via `THREE.ImageLoader` and swaps the image
  in; if that also fails, the material's own colour carries the surface
  instead of a black hole (comment cites audit T14 explicitly).
- Every other world texture path has an honest fallback too:
  creator-room portrait (`hall-scene.ts:3102`) starts on a neutral dark
  material colour and only swaps the map in on success; portrait figure
  loads keep the standing figure on error (`hall-scene.ts:3985` region);
  guard art falls back to the capsule (figure.ts "capsule" kind).
