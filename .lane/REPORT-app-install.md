# /app rebuild — one-click install + download on everything

Branch `stack29/app-install` off origin/main `11eecb49`. Worktree
`~/workspace/bdv-wt-appinstall`. NOT pushed — stacks for the next batch
behind the owner's Gate-1 preview approval.

## Commits

- `b2be7c47` i18n(appPage): +11 install/download keys ×10 locales
- `0f60ada9` test(locale): pin app-install fill — required set 4441 → 4452
- `e361fd4d` feat(app): /app rebuild — one-click install + download on every card

## What changed

Owner's ruling (Oct 25): the page must offer BOTH one-click installs
AND download options, for everything on it, all working the same.
Before: Android + extension cards only handed out raw files;
iPhone + desktop cards only scrolled to steps.

Now:

1. **Headline install panel** under the hero — one device-aware
   one-click Install action for the whole page (see state table).
2. **Every card restructured identically**: a labeled **Install** slot
   first, a labeled **Download** slot second (divider between), same
   order and visual weight on all four cards — Android, Chrome
   extension, iPhone/iPad, Windows & Mac.
3. **One shared install state** for the page: `usePwaInstall()` from
   `lib/extension-promo.ts` — the deferred `beforeinstallprompt` is
   captured at module level there (app-wide, entry bundle), so the
   button works on a cold landing on /app, not just where the floating
   PWAInstallPrompt card mounts. The headline, Android card and
   desktop card all read the same state, so the page tells one truth.
4. **`promptInstall` hardened** (same file): it now consumes the
   deferred event up front and catches a rejected `prompt()` — other
   surfaces hold their own copy of the event, and prompting a consumed
   copy rejects; before, that leaked an unhandled rejection. Returns
   `false` ("not installed") instead.
5. Downloads kept exactly as they were — same files, same
   version/size/SHA-256 lines from `lib/app-downloads.ts` (untouched),
   now sitting in the Download slot as the secondary action. Guide
   anchors added (`apk-install-steps`, `ext-install-steps`,
   `android-card`); iOS/desktop anchors already existed.

## One-click: what is real today vs gated — plainly

| Item | One-click Install | Download |
|---|---|---|
| Web app (headline) | **REAL** on Chromium desktop + Android: fires the browser's own install prompt (Android mints a WebAPK — a real installed app). Shows "Installed on this device" in standalone / after accept. If Chrome hasn't offered a prompt, the button honestly falls back to the steps + a browser-menu hint — never a fake install. | n/a (the install is the delivery) |
| Android card | **REAL** — same prompt machinery (installs the web app in one tap). | **REAL** — native APK file (GitHub Releases asset, v1.0, 73,726,268 B, SHA-256 892c7322…), unchanged. Note the distinction: Install = web app one-tap; Download = the native APK package. Both genuinely put Bow Down Visuals on the phone. |
| Desktop card | **REAL** on Chromium (previously this card only scrolled to steps; now it fires the prompt when offered). | **No file exists** — no .exe/.dmg anywhere (the page's own approved FAQ already says beware anyone offering one). The Download slot stays, labeled, and says exactly that. No fake button. |
| iPhone / iPad card | **GATED BY APPLE, not by us** — no install prompt exists on iOS for anyone. Install slot keeps the honest Share → Add to Home Screen action; the headline panel shows those steps inline at the button on iOS. | **No file exists** — Download slot stays, labeled, with the honest line (Apple installs web apps straight from Safari). No fake button. |
| Chrome extension card | **GATED on the Chrome Web Store listing** — one-tap "Add to Chrome" exists only through the store; that listing isn't live yet (banked for launch). Install slot = honest steps action + the note saying exactly this. No fake install button. | **REAL** — extension zip (same-origin, v2.0.2, 84,903 B, SHA-256 9887f56a…), unchanged, + the /extension learn-more link. |

## Installability verification (end-to-end)

Static + production-build evidence (vite build run on this tree;
output `dist/public`):

- **Manifest** (`public/manifest.json`, byte-identical in dist):
  name + short_name "Thy Cheat Code", `display: standalone`,
  `start_url: /`, `scope: /`, theme/background colors set.
- **Icons**: all four files exist at their exact pixel sizes —
  192 any, 512 any, 192 maskable, 512 maskable (verified with `file`)
  — and all ship in dist.
- **HTML**: built `dist/index.html` carries
  `<link rel="manifest" href="/manifest.json" />`.
- **Service worker**: `main.tsx` registers `/sw.js` in PROD on load;
  the built entry bundle contains `serviceWorker.register(\`/sw.js\`)`;
  dist `sw.js` is byte-identical to source; the SW has install
  (app-shell precache incl. manifest + icons), activate (stale-cache
  cleanup) and fetch handlers.
- **Capture**: the built entry bundle contains the
  `beforeinstallprompt` listener (module-level in extension-promo),
  and the built /app page chunk contains the new install keys
  (`appPage.installNow`, `appPage.extensionStoreNote`, …) — the new
  page and the capture both ship.
- **Serving**: API cache policy gives `/sw.js` and `/manifest.json`
  no immutable caching (revalidate default) — SW updates can't be
  pinned by HTTP cache; SPA fallback answers 200 for `/app`.
- **Not verifiable from here**: a live `beforeinstallprompt` firing —
  Chrome gates it on its own engagement heuristics and a real browser.
  The live tap-test rides with the owner's device at Gate 1, same as
  every visual verdict. No gap found in manifest, icons, SW or
  registration that would block it.

## i18n

11 new `appPage` keys (installLabel, downloadLabel, installTitle,
installBody, installNow, installed, installMenuHint, iosInstallSteps,
extensionStoreNote, iosNoFile, desktopNoFile) added to all 10
catalogs — appPage is now 57 leaves ×10. All values are digit-free
and placeholder-free in every locale, so the numeric-parity suite
judges them clean by construction. The pinned required-set in
`locale-newest-surfaces.test.ts` was extended the established way:
4441 → 4452, with the provenance comment updated.

## Test numbers

- Baseline on this tree before changes: FE typecheck clean;
  locale-newest-surfaces 42/42.
- After locales + pin: locale-newest-surfaces + locale-numeric-parity
  — 136/136 pass.
- Final: **full FE suite 392 files / 5,170 tests — ALL PASS**
  (sequential, --maxWorkers=1); **typecheck clean**; production
  `vite build` succeeds (~51s).
