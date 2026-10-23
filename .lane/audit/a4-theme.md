# A4 — Theme Defects, Light + Dark (read-only audit)

Tree: `bdv-wt-stack28` @ `0bdfcefa` (branch `stack28/site`). No code edited.
Method: extracted every distinct color/gradient/border class used under
`artifacts/bow-down-visuals/src` and diffed against the `.light` remap tables in
`artifacts/bow-down-visuals/src/index.css` (§§2–19 + dashboard/dark-floor sections),
then vetted every candidate in context. Candidates that turned out to be
`isLight`-branched, inside `data-dark-lock`, deliberate design presets
(carousel/bio-theme/cover-art swatches), the deliberate Stream Controller deck,
the documented dark share strip (`pages/templates/videos.tsx:264`), or covered by
stop-level remaps (`from-[#171208]`, `via-black`, `to-black`) were **cleared and
are not listed**. Plain `bg-black` / `bg-zinc-900` wrappers were not flagged, per
the 2026-10-13 triage.

**Counts:** (a) gradient escapes **3** · (b) inline-styled **1** · (c) bg-black/90-95
white-repaint **0 (verified, see note)** · (d) colors outside tables **6** ·
(e) white/10-family border structure loss **2** · (f) dark-theme **2**. **Total 14.**

---

## (a) Dark GRADIENT slabs — background-image escapes the remaps

Root cause shared by A1–A3: the tables remap `bg-[#0d0a04]` (§18) and the
`from-[#…]` dark hexes (§18, index.css:971–979) and `to-[#0b0603]` (index.css:981),
but there is **no `.light` rule for `to-[#0d0a04]` or `to-[#0d0d0d]`**. The 620 uses
of `to-[#0d0a04]` are mostly safe today because they sit in `isLight` dark
branches; the three below are unconditional.

### A1 — Series Studio section, stream playlist — MEDIUM
- `pages/stream/playlist.tsx:546` — `bg-gradient-to-b from-[#171208] to-[#0d0a04]`
  on the owner-only Series Studio `<section>` (unconditional; renders for series owners).
- Escape: `from-[#171208]` remaps to ivory, `to-[#0d0a04]` does not → in light the
  panel grades ivory at the top into a near-black slab at the bottom.
- User sees (light): price/builder form labels (`text-white/40`, `text-white/50`,
  remapped to warm grays) sink into the dark bottom half of the panel — dark ink
  on near-black, effectively unreadable where the form sits.

### A2 — Gamers page unselected content-type chips — MEDIUM-LOW
- `pages/gamers.tsx:372` — `bg-gradient-to-b from-[#14100a] to-[#0d0a04]`
  (unselected branch of the chip ternary, inside the `isLight`-branched card at :323).
- Escape: same missing `to-[#0d0a04]` rule; chip text inherits the page ink, which
  remaps to espresso in light.
- User sees (light): every unselected chip is an ivory-to-near-black gradient bar
  with dark text that disappears into its lower half.

### A3 — Product attachment card in social feed — LOW
- `components/social/AttachmentView.tsx:52` — `bg-gradient-to-r from-[#1a1408] to-[#0d0d0d]`
  (unconditional, renders in posts in both themes).
- Escape: `from-[#1a1408]` remaps (index.css:972), `to-[#0d0d0d]` has no rule.
- User sees (light): product cards grade cream → black left-to-right; the title
  (`text-white`, remapped to espresso) is readable at the left edge and lost at
  the right; the gold BUY pill carries the card.

---

## (b) INLINE-STYLED dark surfaces

### B1 — Active artist identity card — MEDIUM-LOW
- `components/ActiveArtistBanner.tsx:36` — `style={{ background: "#0a0800", … }}`
  plus :44–46 `linear-gradient(135deg, #1a1200 0%, #0d0800 60%, #000 100%)`.
  Zero `isLight` handling in the file. Used at `pages/make-video.tsx:1144` and
  `pages/song-and-video.tsx:1356`.
- Escape: inline styles outrank every class remap and the element is not
  `data-dark-lock`, so nothing repaints it.
- User sees (light): a full-width near-black cinematic slab mid-page on the ivory
  Make Video / Song+Video flows. Its own inline gold/white ink keeps it readable —
  this is a theme-ignoring slab, not an unreadable one — but it is the only
  un-branched dark card on those otherwise fully-branched pages.

---

## (c) bg-black/90 or /95 repainting to near-pure white — 0 found (verified)

In this tree §3 (index.css:332–333) maps `/95` → `rgb(252 247 234 / 0.96)` and
`/90` → `rgb(252 247 234 / 0.92)` — warm cream, not near-pure white. The
pure-white-based rungs are `/75`–`/85` (`rgb(255 255 255 / …)`); every use found
sits on a media overlay, badge, or small chip whose ink remaps to bronze/espresso
and stays readable, and full-cover scrims ≥`/60` are force-kept dark by the
§17 `fixed/absolute inset-0` rules (index.css:1550–1567). No standalone (c)
defect is claimed.

---

## (d) Colors outside the remap tables

### D1 — Audio Studio DAW rails stay near-black; their labels remap to dark ink — HIGH
- `components/audio-studio/ArrangementStudio.tsx:899` and `:928` —
  `bg-[#171208]` sticky track-header column; `:948`, `:1067`, `:1069` —
  `bg-[#171208]` on `<option>`s; `:1000` — `bg-[#241b08]` arrangement clip block.
- `components/audio-studio/PianoRoll.tsx:245` — `bg-[#171208]` sticky key rail.
- Escape: neither `#171208` nor `#241b08` appears in the §2/§18 bg hex tables
  (the covered neighbours are `#171106`-family absent too, and `#14110b`/`#1a1408`).
  Both files contain **zero** `isLight` branches and are **not** `data-dark-lock`;
  they render on `/audio-studio` (Arrange tab) and in-world via
  `components/world/native/AudioDesk.tsx:1238`.
- User sees (light): a near-black rail/strip down the DAW while its labels
  (`text-white/35` at :899, remapped §18 → warm gray, later `!important`
  rgba(28,23,18,0.48)) print dark-on-dark — track names and lane headers
  are unreadable in light theme.

### D2 — `text-amber-100` opacity steps have no light deepening — HIGH
- Covered: base `text-amber-100` and `/80` only (index.css:461–463).
  Uncovered in use: `/40`, `/50`, `/60`, `/70`, `/75`, `/90`.
- Instances: `pages/my-music.tsx:104` (`/60`, page subtitle), `:153` (`/50`,
  purchase-row meta), `:163` (`/40`, receipt row) — the rows themselves are
  `isLight`-branched ivory cards (:141), so the pale text sits on cream;
  `components/distribute/DistributionLegacyPanels.tsx:282` (`/70`, unallocated
  royalty lines on `bg-amber-500/10`); `components/editor/music/LipSyncStudio.tsx:406`
  (`/75`); `components/GuideMe.tsx:293` (`/90`).
- User sees (light): #FEF3C7 at 40–70% over ivory ≈ 1.1–1.5:1 — My Music's
  subtitle, purchase metadata and receipt numbers are effectively invisible;
  same for the royalty lines in Distribute.

### D3 — Pale 100/200-step opacity variants across status/banner text — MEDIUM
Base steps are covered for these families; the opacity variants below are not
(same gap pattern §5 fixed for amber/yellow, never extended here):
- `pages/storefront-product.tsx:322` `text-emerald-100/80`, `:332`
  `text-emerald-100/60` — claim-success card body + fine print on
  `bg-emerald-400/10`.
- `pages/live-shopping.tsx:473` `text-red-100/80` — per-section error card text;
  `:549` `text-green-100/85` — purchase-success banner text.
- `pages/label-pitch.tsx:764` `text-sky-200/90` — Labels-tab disclaimer paragraph
  on `bg-sky-500/[0.06]`.
- `components/sync-pitch/SyncTab.tsx:1096` `text-emerald-200/90` — "placed"
  handoff prompt.
- `components/discovery/cards.tsx:171` `text-emerald-200/80` — earnings suffix on
  creator cards.
- `pages/scheduler.tsx:859` `text-blue-200` — **no rule for blue-200 at all**
  (blue-300/400 are covered, index.css:1062–1073); "publishing" chip on
  `bg-blue-500/20` in the calendar.
- User sees (light): near-white pastel text on ivory/faint-tint grounds —
  disclaimers, error copy, success copy and chip labels wash out to illegibility.

### D4 — Pale-gold hex `text-[#f0d878]` unremapped, on a scrim that itself remaps — LOW-MEDIUM
- `pages/party.tsx:268` (icon) and `:272` (category title) in `CategoryIntro`,
  over `bg-black/45 backdrop-blur-[1px]` (:265).
- Escape: `#f0d878` is absent from the §5 arbitrary-gold table (covered siblings:
  `#f7dd7f`, `#f5e08c`, `#F5D576`, `#E8CE7A`…). Meanwhile `bg-black/45` remaps to
  ivory at 0.52 (index.css:813), so the scrim lightens under the pale text.
- User sees (light): the category intro flash is pale straw on a milky wash —
  the title reads only by its weight/size, ~1.4:1.

### D5 — Editor context menu at 98% black — LOW
- `lib/context-menu-tone.ts:44` — dark tone string
  `bg-[#0a0a0a]/[0.98]`; only `/90` and `/95` variants of `#0a0a0a` are remapped
  (§17), `/[0.98]` is a distinct class.
- User sees (light): the clip context menu stays a near-black slab. Its ink is
  light hexes, so it stays readable — theme-ignoring, not broken.

### D6 — Stream alert overlay at `#14100a/95` — LOW
- `components/live/StreamAlertOverlay.tsx:45` — `bg-[#14100a]/95`; the solid
  `#14100a` is covered (§18) but the `/95` variant is not.
- User sees (light): alert toasts over live video keep a near-black ground
  (arguably correct over video; flagged only as a table gap, lowest severity).

---

## (e) Near-invisible white borders → structure loss

Note: the tables **do** cover `border-white/10`, `/15`, and the bracket form
`border-white/[0.12]` (§6 + §19). The two forms below are distinct Tailwind
classes those rules cannot match.

### E1 — `border-white/12` has no remap — MEDIUM-HIGH (cluster)
26+ uses, concentrated in the editor/DAW cluster whose fills **do** remap
(`bg-white/[0.03]` → marble white, §17/§19):
- `components/audio-studio/ArrangementStudio.tsx:828, 869, 878, 887, 1114`;
  `components/audio-studio/PianoRoll.tsx:215, 226, 334`;
  `components/audio-studio/PodcastTranscriptEditor.tsx:251`;
  `components/editor/music/ManualDAW.tsx:355, 430, 461`;
  `components/editor/music/SongWorkflow.tsx:269, 299, 312, 325, 340, 357`;
  `components/editor/music/AiAutoMix.tsx:270`;
  `components/editor/music/PreviewTransport.tsx:68`;
  `components/artist/RoyalCourtPicker.tsx:260`;
  `components/player/MediaLinkBar.tsx:92`; `pages/seo/genre-hub.tsx:106`.
- User sees (light): transport buttons, workflow steps, export buttons and
  picker chips become borderless white blobs on ivory — edges, grouping and
  hit-areas lose all definition (white 12% on cream ≈ invisible).

### E2 — `border-white/[0.09]` falls between the covered brackets — LOW-MEDIUM
Covered brackets: `[0.04]–[0.08]`, `[0.10]`, `[0.12]`, `[0.15]`, `[0.18]` (§6/§19);
`[0.09]` is missing. Instances: `components/CommandCenter.tsx:430` (platform
pills), `components/audio-studio/ArrangementStudio.tsx:227` and
`components/editor/music/StemFxChainEditor.tsx:82` (FX-step cards, paired with
`bg-white/[0.02]` which does remap).
- User sees (light): card/pill outlines vanish on the remapped marble fill;
  content floats ungrouped.

---

## (f) Dark-theme defects

### F1 — No theme toggle on the custom-domain creator site (SiteMode) — MEDIUM
- `App.tsx:461` renders `<FloatingThemeToggle />` only inside `AppShell`;
  `App.tsx:806–808` + the Lane-2 comment at `App.tsx:483` — `SiteModeGate`
  renders **instead of** `AppShell` on creator custom domains, so the floating
  toggle (owner directive in `components/FloatingThemeToggle.tsx:4–7`: "on
  EVERY single page, no exceptions") never mounts there, and
  `components/site-mode/SiteMode.tsx` renders no toggle of its own.
- The profile itself is theme-aware (`themeVars(profile.theme_config, isLight)`,
  SiteMode.tsx:174–181), but a visitor landing with the opposite saved theme
  has no switch on that surface. Its splash (`SiteMode.tsx:36`) and not-found
  screen (`SiteMode.tsx:131`) are additionally hardcoded `bg-black` + white ink
  in both themes.
- User sees: on a creator's own domain, no sun/moon anywhere; splash/404 are
  black pages even for light-theme visitors.

### F2 — Ghost-glass demo panels over the homepage stage (dark) — LOW-MEDIUM
- `pages/home.tsx:708` and `:725` — `rounded-2xl border border-white/[0.07]
  bg-black/40 p-6` demo panels with no solid ground and no backdrop blur,
  sitting directly on the homepage stage scenery; the "By the numbers" band at
  `:789` (`bg-black/60`) is the same pattern one step heavier.
- Owner law: dark panels over scenic photos carry a solid ground. At 40% black
  with a 7% white hairline, panel content floats on the moving stage photo and
  the panel edge is defined only by the photo's local brightness.
- (The authed shell's `.content-panel`, index.css:2584 — rgba(0,0,0,0.72) +
  blur over the throne backdrop — was checked and is **not** flagged: 72%
  ground is the sanctioned subpage design, and page cards inside it sit on
  that ground, not on the photo.)

---

## Checked and cleared (not defects under the triage)

- `pages/gamers.tsx:263` root `bg-[#050510]`: unremapped hex, but the §1 palace
  rule (`.light [class*="min-h-screen"]`, higher specificity) repaints the page
  ground; its cards are `isLight`-branched. Only its chips are broken (A2).
- `components/ThyCheatCodeHost.tsx:113` gradient: `from-[#171208]`, `via-black`
  and `to-black` stops each have remap rules, so the slab repaints.
- `components/SocialProofBand.tsx:182` black gradient: dedicated `.light`
  overrides (`.social-proof-band`, `.social-proof-box`, index.css:2823+, 2972+).
- `components/player/StreamingPlayerBar.tsx` `bg-[#0d0b08]/95`: covered (§18
  opacity list). Song modals / `TimelineDock` `bg-[#0a0a0a]/95`: covered (§17).
- `pages/login.tsx` / `pages/signup.tsx` footers `bg-[#171208]/65`:
  `.light .auth-footer` `!important` override (index.css:2995).
- Pricing tier gradients (`pages/pricing.tsx:505, 509`), party/go-live/world
  `:` branches, `bio-themes.tsx`, `carousel-maker.tsx` presets, cover-art /
  template gradient strings: `isLight` dark branches or deliberate per-design
  art presets, not page surfaces.
- Inline styles generally: the sweep found swatches, creator-chosen theme
  colors (`artist-setup`, `shop` banner), caption-style art and video surfaces
  only — B1 is the sole page-surface case.
