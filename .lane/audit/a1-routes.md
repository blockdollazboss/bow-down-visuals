# AUDIT LANE A1 — Routes, Doors, Dead Ends (read-only)

Tree: `~/workspace/bdv-wt-stack28` @ `stack28/site` `0bdfcefa` (the build live on bowdownvisuals.com).
Date: 2026-10-23. No code was edited. Methods: full static route/link census of
`artifacts/bow-down-visuals/src`, redirect-target parameter verification, dead-button scan,
and a guest-route rig sweep (site-preview Playwright Firefox rig + font-guard, local Vite
build, 19 guest routes probed for HTTP status, root render length, final URL, console/page
errors).

## Census summary (the good news, verified)

- **225 routes** declared in `src/App.tsx` (two Switches + catch-all 404), **63 redirect
  aliases**. Every redirect target route exists, and **every** `?tab=` / `?panel=` /
  `?sub=` / `?subtab=` / `?mode=` / `?view=` parameter a redirect carries is actually read
  by its target page or a child panel — spot-verified in source for hooks, audio-studio
  (incl. AiAudio `?sub=` at `src/pages/ai-audio.tsx:2216`), video-editor (incl. template
  preselect at `src/pages/video-editor.tsx:931-949`), thumbnail-studio, branding-kit
  (incl. BrandingShop `?subtab=merch` at `src/pages/branding-shop.tsx:143-147`), go-live,
  scheduler, analytics-hub, community, create (`?panel=`), my-projects, coach
  (`?tab=money` + MoneyTrackerPanel `?view=royalties` at
  `src/components/coach/MoneyTrackerPanel.tsx:110`), label-pitch, feed, store/dashboard,
  distribute, brand-deals. **Zero redirect dead-ends.**
- **Zero broken internal link targets** in production (non-test) code: every literal and
  templated href/to/setLocation target across `src` resolves to a declared route or a real
  static asset (e.g. `/bow-down-visuals-extension-v2.zip` exists in `public/` and is linked
  from `src/pages/download.tsx:127`). Apparent misses in raw scans were all API paths,
  test fixtures, or dynamic slugs that resolve (templates hub slugs
  videos/thumbnails/hooks/captions at `src/pages/templates/index.tsx:22-52` → real routes).
- **Zero unreachable routes**: every static route is referenced by at least one non-test
  door (sidebar `src/components/layout/app-sidebar.tsx`, footer
  `src/components/layout/footer.tsx`, in-page links, or the /features registry).
- **Guest gate behaves exactly as the access law prescribes** (rig-verified):
  public routes render (`/`, `/login`, `/signup`, `/charts`, `/shorts`, `/world`,
  `/artist/thy-cheat-code`, `/beats`, `/memberships`, `/contests`, `/winners`,
  `/storefronts`, `/terms` — all HTTP 200, full root render, zero page errors);
  locked routes bounce to `/login?next=<target>`; aliases resolve single-hop through the
  gate first (`/waitlist` → `next=/beta-access`, `/sounds` → `next=/audio-studio?tab=sounds`,
  `/sponsors` → `next=/brand-deals?tab=marketplace`); a nonsense URL as guest lands on the
  sign-in screen per matrix §4.3. The only console noise was local-rig artifact (missing
  `VITE_SUPABASE_*` env in the dev shell, R2 CORS from localhost) — not production defects.
- **World chrome** (`src/pages/world.tsx`, links/buttons only): no handler-less buttons.
  Lock flows are complete — directory chips carry a gold "Locked" pill + aria-label
  (`world.tsx:2639-2645`), clicking a locked room surfaces the refusal, and both the
  locked-out card (`world.tsx:2891`, testid `world-locked-out-card`) and door-locked card
  (`world.tsx:2918`, testid `world-door-locked-card`) offer a working **Try Again**
  (re-attempt) and a **Go Live** door. Guest sign-in doors present (`GUEST_SIGN_IN_HREF`).
- **Templates gallery** (`/templates/videos`): card Remake buttons deep-link to
  `/video-editor?tab=templates&template=<key>` and the editor honors both params
  (preselects the template); prices render on cards (`data-testid=vt-price-<key>`);
  share links point back at the card's own shareable URL. Wired end to end.
- Exactly **one** `href="#"` in the entire app — a deliberate click-test dummy in the
  locked internal `/cursor-lab` page (`src/pages/cursor-lab.tsx:264`, `preventDefault`
  onClick). Not a defect.

## Findings

### A1-01 — Lip-sync creation buttons are permanently disabled with no explanation
- **Route/file:** Video Editor → Lip Sync desk; `src/components/editor/music/LipSyncStudio.tsx:543` and `:553`
- **Evidence:** Both buttons carry a bare `disabled` attribute and `cursor-not-allowed`:
  "Create Lip Sync From Artist Image" (`data-testid="btn-lipsync-from-image"`) and
  "Lip Sync Selected Video Clip" (`data-testid="btn-lipsync-from-clip"`). No "coming
  soon" label, `title`, or explanatory copy exists anywhere in the file (grep for
  "coming soon / not available / unavailable" → no hits). They present as the two primary
  creation actions of the panel but can never be clicked, and nothing tells the user why.
- **Severity:** Medium — a headline editor action that silently does nothing.
- **Fix sketch:** Either wire the buttons to the existing lip-sync run flow, or label
  them honestly ("Coming soon" pill + title), matching the pattern already used at
  `src/pages/analytics-hub.tsx:1522`.

### A1-02 — Templates gallery promises "free to browse / no login required" but the guest gate walls it
- **Route/file:** `/templates`, `/templates/videos` (+ thumbnails/hooks/captions);
  `src/pages/templates/videos.tsx:18-19`, `src/pages/templates/index.tsx` hero copy,
  `src/lib/public-routes.ts` ROUTE_MATRIX (`/templates*` = "locked")
- **Evidence:** The gallery page header comment states "Public video-edit template
  library — No login required", and the hub's public copy says "Proven templates, free
  to browse." The site footer — rendered on the public homepage — links guests straight
  to Template Library / Video Templates / etc. (`src/components/layout/footer.tsx:39-43`).
  Rig proof: a guest requesting `/templates/videos` is bounced to
  `/login?next=%2Ftemplates%2Fvideos`. The lock itself follows the owner's D4 law
  (discovery/marketing family locked, public-routes.ts header), so the defect is the
  contradiction: public-facing copy and footer doors promise a free browse that ends at
  a login wall.
- **Severity:** Medium — a public promise that dead-ends; also the exact "door that
  isn't a door" pattern the one-website law targets. Owner call which side wins.
- **Fix sketch:** If the law wins, change the hub copy to "Free to browse with your
  account" and delete the stale "No login required" comment; if free browsing wins,
  add `/templates` + the four gallery routes to `PUBLIC_ROUTES` + ROUTE_MATRIX (the
  Remake action already gates at the editor).

### A1-03 — Sidebar "Quests" door lands on the top of the Dashboard, not on Quests
- **Route/file:** `src/components/layout/app-sidebar.tsx:298` —
  `{ href: "/dashboard", labelKey: "nav.quests", icon: ClipboardCheck }`
- **Evidence:** The nav entry is labeled Quests but links to plain `/dashboard` with no
  anchor or scroll target. The quests UI is `QuestsWidget`, rendered mid-page at
  `src/pages/dashboard.tsx:510`, and it exposes no `id` anchor
  (`src/components/QuestsWidget.tsx` has no `id=`), so the door cannot land on it.
- **Severity:** Low — the destination exists on the page, but the labeled door drops
  the user at the top of a long dashboard to hunt for it. (A standalone Quests page is
  already an open owner call; this finding is only about the door's aim.)
- **Fix sketch:** Add `id="quests"` to the QuestsWidget wrapper and point the sidebar
  entry at `/dashboard#quests` (or scroll-on-hash in Dashboard).

### A1-04 — Pricing "Wanted Meter" star radios always report `aria-checked={false}`
- **Route/file:** `/pricing`; `src/pages/pricing.tsx:156` (WantedMeter, lines 141-180)
- **Evidence:** Each star is a `role="radio"` button with `aria-checked={false}`
  hardcoded. The buttons work — `onClick={() => onSelect(s)}` fires — but the selected
  state is never stored or exposed, so a screen reader announces every star as
  unchecked forever, including after the user picks a plan.
- **Severity:** Low — accessibility-only; visual and pointer behavior are correct.
- **Fix sketch:** Track the selected star in state (the parent already receives
  `onSelect`) and render `aria-checked={selected === s}`.

### A1-05 — World lock cards offer no "choose another room" door of their own (minor)
- **Route/file:** `/world`; `src/pages/world.tsx:2891-2940`
- **Evidence:** Both lock cards (locked-out, door-locked) offer only **Try Again**
  (which will refuse again while the lock stands) and **Go Live**. There is no button
  on the card itself to return to the plaza / pick a different room. Mitigation already
  in place: the palace directory bar renders at z-20 above the card's z-10 overlay and
  stays clickable, so an escape exists — it is just not discoverable from the card.
- **Severity:** Low / polish.
- **Fix sketch:** Add a third button on both cards, "Back to the plaza" (dismiss the
  overlay / re-enter the current room), next to Try Again.

### A1-06 — Info: footer social icons are intentionally inert (do not re-flag)
- **Route/file:** `src/components/layout/footer.tsx:276-291`
- **Evidence:** Instagram/TikTok/YouTube icons render as `<span aria-disabled="true"
  title="… — coming soon">`, with the source comment explaining accounts are being
  created and links go live with real URLs. This matches the owner's standing
  "social starts Jan 1" deferral. Honestly labeled, not a dead button.

### A1-07 — Info: Analytics Hub "Connect" buttons are intentionally disabled placeholders
- **Route/file:** `src/pages/analytics-hub.tsx:1522`
- **Evidence:** Per-platform Connect buttons are hard-`disabled` but labeled via
  `analyticsHub.connectComingSoon` with a `title` explanation and `cursor-not-allowed`
  styling. Honest placeholder — recorded only to contrast with A1-01, where the same
  pattern ships *without* the label.

### A1-08 — Info: rig sweep coverage and limits
- 19 guest routes probed on the local build (list in Census above). All rendered; no
  blank pages, no route error boundaries, no page errors beyond local-env noise.
  Signed-in routes, POST-driven flows, and the World 3D scene internals were out of
  scope for this lane (static analysis only for member pages; scene files untouched
  per instructions). The dev server started for the sweep was shut down afterward.
