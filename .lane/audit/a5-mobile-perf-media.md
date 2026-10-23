# AUDIT LANE A5 — Mobile 390px · First-Load Weight · Media 404s

- **Tree:** `~/workspace/bdv-wt-stack28`, branch `stack28/site` @ `0bdfcefa` (verified `git rev-parse HEAD` = `0bdfcefaba9801611632c9f599aa5f9c4489fd3c`)
- **Date:** 2026-10-23 · **Mode:** READ-ONLY. No code edited, nothing deleted. One production build was run for measurement (`vite build`, 20.13s, succeeded); the `dist/` output was removed afterward — `git status` is clean except this file.
- **Method:** static sweeps (fixed widths, tables, tap targets, text sizes), full import-graph reading of `src/App.tsx` / `src/main.tsx` / `vite.config.ts`, a real production build for chunk weights, and a two-pass media-reference extraction (literal + broad filename sweep) cross-checked against `~/workspace/r2-migration/site-media-manifest.json` (64 files / 171,937,013 B), `engines-manifest.json` (37 files / 106,306,917 B) and the 161 files in `public/` (293 MB).

## Counts at a glance

| Section | Findings | Breakdown |
|---|---|---|
| 1 · Mobile 390px | **8 findings** (1 critical, 3 high, 4 medium/low) + 3 verified non-findings | Editor panels unreachable <768px ×1; zoom disabled ×1; tables that clip/squeeze ×3; sub-40px tap-target systems ×3; sub-11px text at scale (3,646 hits); floating-chrome cluster ×1 |
| 2 · First-load weight | **7 findings** | Home first load ≈ **10.9 MB dark / 5.8 MB light** (measured) vs the ~2.5 MB gzip Oct 22 baseline; entry JS+CSS alone ≈ 665 KB gzip; heavy libs correctly lazy ×5 (verified non-findings) |
| 3 · Media / 404s | **6 findings** | Hard 404s for literal FE references: **0**. R2-first 404-then-fallback: **9 world textures (~6.06 MB)**. Origin-only media never moved to R2: **6 wallpaper files (~19.9 MB) + 24 emoji stickers (~0.6 MB)**. Manifest files still duplicated in `public/`: **100 of 101 keys, 277,538,808 B**. Dead file: 1 (784 KB) |

---

## 1 · MOBILE (390px)

### M1 — CRITICAL: Video Editor section panels are `hidden` below 768px with no mobile alternative
- `src/pages/video-editor.tsx:2216` — left panel `<aside … className="… hidden md:block">`; **all 19 section renders live inside it** (`leftTab === …` at :2273, :2312, :2337, :2537, :2557, :2596, :2661, :2696, :2723, :2741, :2762, :2783, :2808, :2830, :2840, :2851, :2894, :2904).
- `src/pages/video-editor.tsx:3249` — right panel `<aside … hidden md:block">`; all `rightTab === …` renders inside it (:3268–:3353+).
- The icon rail (`:2158`, `w-[68px]`) **does** render on mobile and its buttons still call `setTab(...)` — so at 390px a user can tap Media / Captions / Export etc. and *nothing appears*: the panel that would show is `display:none`. No `md:hidden` mobile sheet/drawer/panel exists anywhere in `video-editor.tsx` (grep for `md:hidden|Sheet|drawer` = 0 hits). The editor at 390px is preview + rail + transport only; every tool section is unreachable.

### M2 — HIGH: Pinch zoom disabled site-wide
- `index.html:5` — `<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />`. `maximum-scale=1` blocks pinch-to-zoom on iOS/Android browsers — users who need to zoom small UI text (see M5) cannot. Also flagged by Lighthouse accessibility (user-scalable).

### M3 — HIGH: Tables with no horizontal escape — 3 files (2 clip outright, 1 squeezed)
The global guard `src/index.css:56-58` (`html, body { overflow-x: clip }`) means an over-wide table **never produces a scrollbar symptom — it silently clips**. Verified instances:
- `src/pages/live-shopping.tsx:786` — revenue-per-stream `<table className="w-full text-sm">` (4 cols, `px-5` cells) inside a parent with `overflow-hidden` at `:782`. No `overflow-x-auto` anywhere in the file. At 390px the Fees column clips.
- `src/components/wave8/SplitCalculator.tsx:623` — collaborators `<table className="w-full text-sm">` inside `overflow-hidden` wrapper at `:622`. Same clip risk with long collaborator names/roles (cells have no `truncate`/`break-*`).
- `src/pages/llc-guide.tsx:668` — state-fee table inside `max-h-96 overflow-y-auto` (:667, vertical only). Mitigated: cols 3–4 are `hidden sm:table-cell`/`md:table-cell` (:673–:674), so 390px shows 2 cols — usable, but any long state name + fee still cannot scroll sideways.
- **Verified OK (not findings):** `src/pages/store-dashboard.tsx:628` (`min-w-[720px]`) and `:783` (`min-w-[820px]`) both sit inside `overflow-x-auto` wrappers (:627, :782); `src/pages/ai-audio.tsx:926` and `:1021` (`min-w-[640px]` drum grid / piano roll) are wrapped at :925/:1020; `src/pages/scheduler.tsx:1772` (`min-w-[680px]` heatmap) wrapped at :1771. All other `<table>` files (admin, credit-history, creator-domains, Jewelry/NfcOrdersAdmin, TeamSeats, ExportDoctor) have an `overflow-x-auto` in-file.

### M4 — HIGH: Primary tap targets under ~40px
- **Design system:** `src/components/ui/button-variants.ts` — `size: sm` = `min-h-8` (**32px**), `size: icon` = `h-9 w-9` (**36px**), default = `min-h-9` (**36px**). Every `size="sm"` button site-wide is a 32px target; WCAG/Apple guidance is 44px, the lane threshold ~40px.
- **Editor transport (worst cluster):** `src/pages/video-editor.tsx:4950` — `tBtnSm = "… h-7 w-7 …"` (**28×28px**) reused for ~13 transport buttons (:5493–:5592: restart, prev/next scene, ±10s, frame-step, loop, speed, aspect, fit, PiP, mute). Play/pause hero is `h-8 w-8` (32px).
- **Editor top bar:** `:2073–:2149` — Undo/Redo/Auto-Captions/Ask Thy/Save/Export all `h-8` (32px); Turbo/Advanced mode toggle `:2102`/`:2113` and next-step `:2121` are `h-7` (**28px**) — these are primary actions (Save, Export).
- Rail tab buttons (:2206 area) are `w-14` with `py-2.5` + 9px label — ≈44px tall, acceptable; the 68px rail itself is fine at 390px.

### M5 — MEDIUM: Text below readable size at scale
Site-wide counts (`.tsx`, tests excluded): `text-[8px]` **53 hits / 9 files**, `text-[9px]` **285 / 54**, `text-[10px]` **1,140 / 225**, `text-[11px]` **2,168 / 361**. Sampled key surfaces:
- `src/pages/video-editor.tsx` — **57 hits in one file** (30× 10px, 10× 11px, 10× 9px, 7× 8px), incl. transport labels at 9px (`:5503`, `:5516`, `:5534`) and a 7px fit-mode badge (in the `:5546` button, `text-[7px]` span).
- `src/pages/store-dashboard.tsx` — 33 hits (23× 11px, 9× 10px, 1× 9px) incl. table headers at 11px (`:630`).
- `src/pages/dashboard.tsx` — 11 hits incl. one 8px; `src/pages/home.tsx` — 9 hits, all 11px (badges/labels, acceptable); `create.tsx` 1× 10px; `shop.tsx` 4× 11px; `artist-public.tsx`, `store-buy.tsx`, `storefront-product.tsx` — **0** sub-12px hits (clean).
- Most 10–11px usage is uppercase tracking-wide labels/badges (legible pattern); the genuine readability risk is the editor's 7–9px functional labels combined with M2 (zoom disabled).

### M6 — MEDIUM: Floating chrome stacks in the same corners at 390px
All of these mount simultaneously (AppShell, `src/App.tsx:461–:477` + AuthedLayout `:414–:427`):
- `src/lib/world-entry.ts:47-48` — Enter the World: `fixed left-4 top-[4.25rem] z-[9998]`, ~44px tall pill.
- `src/components/FloatingThemeToggle.tsx` — fixed, draggable, default top-left area (position persisted in `localStorage` `bdv-toggle-pos`).
- `src/components/layout/floating-language-switcher.tsx:9` — `fixed top-4 left-4 z-[9000]`, rendered on home (`App.tsx:422`) — same corner as the theme toggle's default spot + Enter World directly below it: a 3-deep stack in the top-left ~150px of a 390px screen, over the hero.
- `src/components/LiveBadge.tsx:41` — `fixed right-4 top-4 z-40`.
- `src/components/layout/mobile-sidebar-trigger.tsx:24` — `fixed bottom-24 left-5 z-[9999] h-12 w-12` (48px, good target) + mobile `StreamingPlayerBar` `fixed bottom-0` (`src/components/player/StreamingPlayerBar.tsx:237`) + Thy Cheat Code drawer `fixed right-5` at `bottom: max(7rem, safe-area + 6rem)` (`src/components/ThyCheatCodeChat.tsx:440`). Bottom-left trigger, bottom player bar and the chat drawer coexist without a shared layout budget — overlap depends on runtime state.
- Admin-only extras (owner account): `FloatingStarLevel` + `FloatingAdminPanel` draggable widgets (`z 9999/9998`).

### M7 — LOW: Decorative fixed-width glows are neutralized — but the guard hides real bugs
~45 occurrences of `w-[400px]`–`w-[900px]` blur/glow divs (e.g. `src/pages/home.tsx:387` 900px, `src/pages/dashboard.tsx:432` 800px, `src/pages/create.tsx:132` 600px) plus `src/components/SpotlightRig.tsx:143` (`w-[1440px]`, inside `overflow-hidden` at :140) and the RouteErrorBoundary glow `src/App.tsx:266` (`w-[480px]`). None cause page scroll **only because** of `src/index.css:56-58` `overflow-x: clip`. Downside: that same guard converts every future genuine overflow (M3) into silent clipping instead of a visible scrollbar. `CinematicHero` is correctly fluid (`w-full max-w-[480px]`, `src/components/CinematicHero.tsx:189`), and the historic home-hero 480px mobile blowout is fixed with `grid-cols-[minmax(0,1fr)]` + an explanatory comment (`src/pages/home.tsx:442-446`) — verified.

### M8 — LOW: Long-string handling on sampled commerce surfaces is mostly sound
`shop.tsx` product names use `truncate` (:342, :434); `store-buy.tsx` is a single `max-w-2xl px-4` column with a full-width 60px-tall buy button (`py-4`) — the cleanest sampled page at 390px. Residual risk is user-generated titles in table cells (M3) and `whitespace-nowrap` badges (e.g. `src/components/ui/badge.tsx:9`) inside flex rows on artist/storefront cards — no sampled instance forces overflow because parents use `min-w-0`/`truncate` in the checked files.

---

## 2 · FIRST-LOAD WEIGHT (production build measured)

Build: `./node_modules/.bin/vite build` in `artifacts/bow-down-visuals` — **20.13s, success** (pnpm absent; `node_modules/.bin` fallback used, per AGENTS.md). Vite reporter gzip figures used where available.

### P1 — CRITICAL (regression vs Oct 22 baseline): Home first load ≈ 10.9 MB (dark) / 5.8 MB (light)
Code is not the problem; **eager hero media is**. Everything below is fetched on initial home render:

| Asset | Bytes | Source |
|---|---|---|
| Hero sprite sheets ×3 (dark only) | **5,468,030** (1,776,934 + 2,024,002 + 1,667,094) | `src/components/CinematicHero.tsx` — the mount effect loads **all 3 sheets immediately** (`for s < SHEETS` loop); only sheet 0 is preloaded (`index.html` parse-time script), sheets 1–2 are not interaction-gated |
| Fog smoke textures ×3 (both themes) | **4,450,141** (1,311,155 + 1,766,393 + 1,372,699 PNG) | `src/components/fog-lab/FogCanvas.tsx:14-16`, loaded in the mount effect; rendered in the hero at `src/pages/home.tsx:582`. Uncompressed-format PNGs — no WebP versions |
| Entry JS (see P2) | ~591 KB gzip | build |
| Entry CSS | 657,814 raw / ~74 KB gzip | build |
| Palace banner backdrop | 251,006 dark / 388,096 light | `src/pages/home.tsx:365` |
| Hero poster | 52,722 dark / **311,732 light** | `CinematicHero.tsx` poster `<img fetchPriority="high">`; light poster is 5.9× the dark one |
| **Total** | **≈ 10.9 MB dark / ≈ 5.8 MB light** | vs **~2.5 MB gzip Oct 22 baseline** |

Even excluding code, dark-theme home media alone is ~10.2 MB. The Oct 22 figure is not reproducible under any counting that includes sheets 1–2 + fog. (`official-teaser.mp4`, 3,469,535 B at `home.tsx:1428`, is `preload="metadata"` — not counted.)

### P2 — HIGH: Single 1.74 MB entry chunk; English catalog is 42% of its gzip
- Entry: `index-*.js` **1,740,302 raw / 523.94 KB gzip**, plus **61 modulepreload chunks totalling 167,635 raw / ~67 KB gzip**, plus CSS above → **first-load code ≈ 665 KB gzip** before any media or fonts.
- `src/locales/en.json` = 715,868 raw / **218,210 gzip** — statically imported in `src/lib/i18n.ts` and bundled into the entry; ≈42% of entry gzip is the English string catalog. (The other 9 locales are correctly lazy — `i18n.ts` loaders; their chunks are 524–910 KB raw each but load on demand only.)
- `vite.config.ts` `manualChunks` splits **only** `vendor-radix` (83,241 raw / 28.38 KB gzip). React, Supabase (`@supabase/supabase-js` via `src/lib/supabase.ts`, eager through `AuthContext`), the shell, and all eager pages share the one entry chunk.

### P3 — HIGH: 21 page modules are eager for every visitor
`src/App.tsx` statically imports Home, Pricing, CreatorPricing, Extension, Download, TemplatesHub, VideoTemplates, ThumbnailTemplates, HookTemplates, CaptionPacks, ToolsIndex, ForIndex, ToolPageBySlug, VerticalHubBySlug, GenreHubBySlug, Showcase, ShowcaseItemPage, PublicAlbumPage, PlanPublic (~280 KB of source: `home.tsx` 77,821; `pricing.tsx` 27,983; `creator-pricing.tsx` 22,784; `download.tsx` 19,485; `extension.tsx` 18,604; `templates/videos.tsx` 18,053) **plus the full shell**: ~15 providers/floating components incl. `BowDownAIGuide.tsx` (35,966), `ThyCheatCodeChat.tsx` (29,591), `CustomCursor.tsx` (27,065), `app-sidebar.tsx` (28,532). Route splitting otherwise exists and works: **127 `lazyWithRetry` routes**. An app user landing on `/dashboard` still downloads every marketing/SEO page's code in the entry.

### P4 — MEDIUM: 33 Google-Font families in 3 render-blocking stylesheets on every route
`index.html` head: three `fonts.googleapis.com/css2` links (Inter + Playfair Display; 12 caption fonts — Anton, Alfa Slab One, Archivo Black, Barlow Condensed, Bebas Neue, Bungee, Cinzel, Luckiest Guy, Permanent Marker, Poppins, Righteous, Titan One; 19 library fonts — Cormorant Garamond … Creepster). Only Inter/Playfair are UI fonts; the other **31 families serve the caption/thumbnail/library features** but their stylesheets block first paint on home, login, checkout, etc. Browsers download only used faces, but the CSS fetch+parse and font-matching cost is paid everywhere. (Self-hosted pixel fonts in `public/fonts` total only 80 KB — not a factor.)

### P5 — MEDIUM: No chunk budget; giant lazy chunks wait downstream
No `chunkSizeWarningLimit`/budget in `vite.config.ts`. Largest lazy chunks (raw/gzip): `video-editor` 1,661.85 KB / 374.17 KB, `world` 1,216.53 / 287.07, `hall-scene` 682.98 / 177.27, `analytics-hub` 593.08 / 147.39 (contains recharts), `hls` 574.74 / 178.98, `jspdf.es.min` 399.04 / 129.61. Correctly lazy, but the editor/world first-visit cost on mobile data is 300+ KB gzip each before WASM/media.

### P6 — Verified NON-findings (heavy libs are NOT in the initial path)
- **three.js**: only via dynamic import — `src/pages/world.tsx:1521` `await import("@/lib/world/hall-scene")`; `hall-scene.ts:66` static THREE import is inside that lazy chunk.
- **hls.js**: dynamic — `src/pages/live-watch.tsx:170`, `hall-scene.ts:6673` (inside lazy chunk).
- **jspdf**: static in `src/lib/export-utils.ts:1`, `MediaKitBuilder.tsx:8`, `SplitCalculator.tsx:9` — all importers (`make-video`, `my-projects`, `song-and-video`, `press-kit`, GenerationResult consumers) are lazy routes; it lands in its own 399 KB chunk.
- **recharts**: only `src/pages/analytics-hub.tsx:22` (lazy). **html2canvas**: own 199 KB lazy chunk. **Stripe**: `@stripe/stripe-js/pure` in `ExpressPayButton.tsx` (lazy surfaces).
- `public/sw.js`: cache-first only for hashed `/assets/*` and `/engines/*`, network-first elsewhere — repeat visits don't re-pay the entry cost. Prerender covers only `/` (`scripts/prerender.mjs`).

### P7 — LOW (not first load): a 12.9 MB "loading" video
`src/components/delight/witty-loader.tsx:101` plays `mediaUrl("videos/loading-light-temp.mp4")` = **12,945,039 B** as the generation-wait background (poster `images/loading-bg-light-throne.webp`, :107). A waiting screen heavier than the home page's code+CSS by ~19×.

---

## 3 · MEDIA — references vs R2 manifests vs `public/`

Resolution rule used throughout: `mediaUrl()` (`src/lib/media-cdn.ts`) prefixes `https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev/`; origin-relative literals serve from `public/`. A reference "resolves" if its key is in either manifest **or** in `public/`.

### X1 — HIGH: 9 World textures 404 on R2 first, every World load, then fall back
`src/lib/world/hall-looks.ts:37` sets `TEXTURE_BASE = "/world/textures"` with 14 texture URLs (:119–:158). `hall-scene.ts` `hallTexture()` resolves `/…` paths **through `mediaUrl()` (R2) first** and only on error falls back to the origin copy (the T14 fallback in `hall-scene.ts`, ~:403-424). Only 5 world textures are in the R2 manifest (`brocade-gold.jpg`, `marble-black.jpg`, `marble-cream.jpg`, `velvet-black.jpg` + none of the ground set). These **9 are in neither manifest** (origin copies exist, so the fallback saves the surface — at the cost of a 404 round-trip per texture per cold cache):

| Missing-from-R2 texture | Origin size |
|---|---|
| `world/textures/lawn-light.jpg` | 1,280,107 |
| `world/textures/lawn-dark.jpg` | 1,035,720 |
| `world/textures/stone-light.jpg` | 710,946 |
| `world/textures/paving-light.jpg` | 632,565 |
| `world/textures/stone-dark.jpg` | 547,832 |
| `world/textures/marble-black-goldvein.jpg` | 541,095 |
| `world/textures/paving-dark.jpg` | 533,582 |
| `world/textures/water-dark.jpg` | 414,440 |
| `world/textures/marble-cream-goldvein.jpg` | 367,090 |
| **Total** | **≈ 6.06 MB** |

### X2 — HIGH: King's Set wallpapers never moved to R2 — ~19.9 MB from origin
`src/lib/kings-set.ts:38-67` hardcodes origin-relative `stillUrl`/`loopUrl` for 6 files, none in either manifest: `wallpapers/kings-set-plaza-loop.mp4` 7,942,714; `kings-set-stage-loop.mp4` 6,490,558; `kings-set-throne-loop.mp4` 4,400,569; `kings-set-plaza-phone.webp` 454,468; `kings-set-throne-phone.webp` 451,166; `kings-set-stage-desktop.webp` 444,928. The file's own header comment concedes it: local copies "stay until the set is verified live, and the R2 mirror follows" — it hasn't. Every wallpaper download burns Render bandwidth. (Not 404s — files exist in `public/`.)

### X3 — MEDIUM: R2 migration duplicated, not moved — 277.5 MB still ships in the image
**100 of 101 manifest keys still exist in `public/` = 277,538,808 B** (site-media 64 files ≈ 172 MB + engines 37 files ≈ 106 MB). `public/` totals 293 MB; the build output `dist/public` measured **312 MB**. Consequences: Docker image size, deploy/upload time, and disk on a 512 MB-RAM Starter instance.
- Engines duplication is **deliberate**: stream-kit loaders (`src/lib/stream-kit/avatar-face-engine.ts:30`, `rvm-engine.ts:30-36`, `voice-isolator.ts:42`, `background-changer.ts:78`) try R2 → origin → CDN in order, so `public/engines/**` (106 MB, incl. `ort-wasm-simd-threaded.jsep.wasm` 21.7 MB, `rvm_mobilenetv3_fp32.onnx` 15.0 MB, three face-landmarker WASMs ≈ 39.6 MB) is a designed fallback.
- Site-media duplication is only partly load-bearing: textures/posters have origin fallbacks (X1), but the big videos have **no origin consumer** — e.g. `videos/signin-drone-bg.mp4` 12,201,842 (used via `mediaUrl` at `login.tsx:192`, `signup.tsx:184/228`, `reset-password.tsx:75`), `thy-cheat-code-levelup-8bit*.mp4` ≈ 25.1 MB combined, `videos/loading-light-temp.mp4` 12,945,039 (X/P7), `signin-light-action.mp4` 10,233,495, `signup-light-action.mp4` 7,776,615 — pure duplicate deploy weight.

### X4 — MEDIUM: Emoji stickers bypass the CDN (inconsistent with GIFs)
`src/lib/king-emoji.ts` — `kingEmojiUrl()` returns an **origin-relative** `/emoji/${theme}/${file}` while `kingGifUrl()` (same file, ~:78) uses `mediaUrl(...)`. All 24 stickers (`public/emoji/{dark,light}/king-*.webp`, ~617 KB total) are in neither manifest; GIFs are on R2. Functional, but stickers are Render-served and the split is invisible until bandwidth is audited.

### X5 — LOW: Dead / misleading media
- `public/images/king-throne-room.webp` (783,688) — **no code reference anywhere** in FE or API source. The used default banner is the `-shark` variant (`src/components/artist/profile-sections.tsx:151`). Dead weight in `public/` and on R2.
- `src/components/SecretChallengePopup.tsx:5` loads `mediaUrl("assets/bow-winner-popup.webp")` (resolves on R2 ✓), but its header comment (:16-19) claims the art "is bundled through Vite (content-hashed URL), never a bare public/ path" — false: no Vite import exists, the build emits no such chunk, and the identical file at `src/assets/bow-winner-popup.webp` (705,122) is **not bundled by anything** (it is only the manifest's upload source). If R2 fails there is no origin copy (`public/assets/` doesn't exist); the component's CSS fallback card is the only net.
- **Verified NOT dead:** `public/logo-email.png` (API email logo via jsDelivr @main — `artifacts/api-server/src/lib/email.ts:58`) and `public/og-fallback.png` (API OG fallback — `artifacts/api-server/src/lib/og-preview.ts:204`). `videos/shark-king-360-loop.mp4` (6,106,972) is referenced server-side as the World featured reel (`artifacts/api-server/src/routes/world.ts:115`).
- `public/world/README.md` (1,865) ships to production as a static file — trivial.

### X6 — Verdict on hard 404s
**Zero literal front-end media references resolve nowhere.** Every `mediaUrl(...)` argument, origin-relative literal, `index.html` asset (`/favicon.gif`, `/apple-touch-icon.png`, `/opengraph.jpg`, `/manifest.json`), `sw.js` shell entry (`/icon-192.png`, `/icon-512.png`), and CSS asset (pixel fonts, R2 subpage backgrounds at `src/index.css:293/1425/1515`) exists in `public/` and/or on R2. The only 404s a user agent actually issues are the X1 texture probes against R2 (recovered by fallback) — plus anything DB-driven (`resolveMedia`, `src/lib/streaming.ts:126` — the `audio/x.mp3` there is a doc-comment example, not a fetch), which static audit cannot cover.

---

## Appendix — sampled-page mobile scorecard

| Page | Verdict at 390px |
|---|---|
| Home (`pages/home.tsx`) | Grids fixed (`minmax(0,1fr)`); weight is the problem (P1), plus M6 corner stack |
| Dashboard (`pages/dashboard.tsx`) | Responsive grids throughout (`grid-cols-1 md:grid-cols-2`, `grid-cols-2 sm:grid-cols-4`); 11 sub-12px labels; OK |
| Create (`pages/create.tsx`) | `grid-cols-2 sm:grid-cols-3` tablist; OK |
| Editor chrome (`pages/video-editor.tsx`) | **M1 critical** + M4/M5 density |
| Shop (`pages/shop.tsx`) | `sm:grid-cols-2 lg:grid-cols-3`, truncated names; OK |
| Checkout (`pages/store-buy.tsx`) | Single column, 60px buy button, 0 tiny text; cleanest sampled page |
| Artist (`pages/artist-public.tsx`) | 0 tiny-text hits; default banner = X5's sibling file; no fixed-width risks found |
| Store dashboard (`pages/store-dashboard.tsx`) | Tables correctly wrapped (M3 non-finding); 33 tiny-text hits |
