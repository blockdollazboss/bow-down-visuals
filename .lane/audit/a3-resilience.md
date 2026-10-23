# AUDIT A3 — Dashboard Law & Data Resilience (read-only)

- **Tree:** `~/workspace/bdv-wt-stack28`, branch `stack28/site` @ `0bdfcefa` (verified before sweep)
- **Law (owner):** "one bad section should never take the whole dashboard down" — any page pulling several sources degrades per-section; a full-page failure state only when *everything* fails.
- **Scope swept:** `artifacts/bow-down-visuals/src/pages/**` + `src/components/**`, with deep reads of dashboard, analytics hub, artist pages, earnings, my-shop, hub/home feeds, coach. **Excluded per brief:** `src/lib/world/*` and `components/world/**` (world-adjacent panels).
- **Method:** pattern sweep (`Promise.all` without per-source catch, page-level `loadError`/`if (loading)` gates, catch-blocks that set `[]`/`0`/`null`/not-found, sequential `await` chains in loaders, missing `AbortController` timeouts), then in-context verification of every candidate. Loaders that internally catch and return a boolean were checked and are **not** flagged.
- **Result: 16 findings** (3 high, 1 systemic medium that amplifies several others, rest medium/low). The core named surfaces — dashboard, earnings, my-shop, credit-history, explore, store-dashboard, coach panels — are already compliant; the remaining violations cluster in (a) older reach/broadcast/referrals code, (b) a family of public slug pages that conflate server failure with "not found", and (c) summary headers that render `$0.00`/counts before (and despite) a failed load.

---

## The good pattern already in the codebase (cite for every fix below)

1. **`lib/dashboard-sections.ts`** (whole file) + **`pages/dashboard.tsx:286-309`** — the canonical seam: each section carries its own `loading | ok | failed` state, settles via `Promise.allSettled`, retries individually (`dashboardSectionsToRefetch`), and `allSectionsFailed()` is the *only* state allowed to render the full-page error card. Sibling pages already driving the same core: beats, store-dashboard (`pages/store-dashboard.tsx:1646,1685`).
2. **`pages/credit-history.tsx:78-125`** — two ledgers settle independently via boolean-returning loaders + `Promise.all`; full-page error only when both fail; per-ledger error card with its own retry.
3. **`lib/earnings-data.ts:114-155`** (used by `pages/earnings.tsx`) — per-source `status:"error"` cards (never a fake zero), plus the codebase's best load hygiene: `AbortController` attempt timeout (`:130-131`), retries with backoff — the model for Finding F6.
4. **`pages/artist-public.tsx:146-170`** and **`pages/showcase/item.tsx:27-51`** — the correct public-page discipline: `notFound` is set **only** on a genuine HTTP 404; 500s/network failures get a distinct load-error state with retry. This is the exact pattern Finding F7's pages violate.
5. **`components/artist/ProfileStoreSection.tsx:32-71`** / **`ProfileTutorialsSection.tsx:23-68`** — self-fetching profile sections with `loading | ready | error` + scoped retry; an error is never rendered as an empty store/shelf.
6. **`pages/explore.tsx:58-77`** + `lib/explore-data.ts` — server-settled per-section payload; full-page error reserved for total failure.

---

## Findings

### F1 — HIGH — Analytics "Connected Accounts": one failed overview fetch re-labels every connected platform "not connected", and does so during loading too
- **Where:** `pages/analytics-hub.tsx:398` (`overview` starts `null`), `:427-444` (`loadOverview`), `:567-573` (error banner), `:582` (card render branch).
- **What fails → what the user sees:** `GET /api/analytics/overview` is the tab's *only* source for all three platform cards. If it fails (or is still in flight — `loading` is never consulted by the card grid), `platformMap` is empty, so every platform falls into the `if (!p || p.status === "not_connected")` branch and renders the **"Connect <platform>"** card linking to /settings. A creator with live Instagram/TikTok/Facebook connections is told, under a small red banner, that nothing is connected. The error-vs-empty discipline the rest of the page's family follows is inverted here: failure is presented as a definitive empty state.
- **Severity:** High — money-adjacent trust surface (the AI insights layer keys off these same `status:"ok"` platforms), and the false state is the *default* paint on every visit until the fetch lands.
- **Fix sketch:** Give the tab a section state like `lib/dashboard-sections.ts`: render skeleton cards while `overview === null && loading`; on failure with `overview === null`, render one scoped error card with Retry (`loadOverview` already exists) *instead of* the platform grid; keep the per-platform `status:"error"` branch (already correct at `:624`) for partial failures inside a successful payload.

### F2 — HIGH — Referrals: the main load can hang on the spinner forever, and is a sequential waterfall
- **Where:** `pages/referrals.tsx:490-502` (the page-level `useEffect` IIFE).
- **What fails → what the user sees:** The contest fetch is wrapped in try/catch, but the primary fetch is not: `const { res, data } = await authFetch("/api/referrals/me")` at `:499` sits **outside any try/catch**, and `setLoading(false)` at `:500` only runs after it resolves. A network-level rejection (server waking, connection drop) rejects the IIFE unhandled — `loading` stays `true` forever, the page is a permanent spinner with no error and no retry. (HTTP errors are handled; only transport failures hang, which is exactly the free-tier-wake case this codebase elsewhere defends against.) Additionally the public contest fetch at `:494` is `await`ed *before* `/api/referrals/me` even starts — a slow contest endpoint delays the user's own referral code, link, and stats (category-4 waterfall between two independent sources).
- **Severity:** High — referrals is a growth/money page; an unrecoverable infinite spinner on a common failure mode.
- **Fix sketch:** Wrap the whole IIFE in try/catch/finally (`setLoading(false)` in `finally`, `setError` in `catch`), matching `pages/sponsor-dashboard.tsx:83-107`'s shape; fire contest and `/me` concurrently (`Promise.allSettled`) since neither depends on the other.

### F3 — HIGH — Sponsor Dashboard: header stats render fake `$0.00 / 0 / 0` during loading and after a failed load
- **Where:** `pages/sponsor-dashboard.tsx:79` (`totalEarnedCents` inits `0`), `:96-102` (load), `:137-157` (the three stat cards), `:177-190` (error card, rendered only inside the tab body below).
- **What fails → what the user sees:** The single fetch `GET /api/sponsors/dashboard` does have a proper error state — but it lives *below* an earnings banner that renders unconditionally. While loading, and permanently after a failure (until retry succeeds), the banner confidently displays **"$0.00 earned as creator", 0 deals posted, 0 applications sent**. This is the exact misleading-zero the law and the earnings page's header comment forbid ("a source that failed to load shows an error state, never a fake zero").
- **Severity:** High — a money page stating a false earnings figure as fact.
- **Fix sketch:** Gate the banner on load state: skeleton/`—` placeholders while `loading` (the pattern at `pages/analytics-hub.tsx` overview row: `hasData ? fmt(...) : "—"`), and on `error` replace the three numbers with an em-dash + the existing retry, or move the error card above the banner. Per-section state from `lib/dashboard-sections.ts` with one key also works.

### F4 — MEDIUM-HIGH — Broadcast: `Promise.all` couples channels + inbox; either failure blanks both and hides the create form
- **Where:** `pages/broadcast.tsx:36-45` (`loadData`), error render at `:86-90` (approx., `loadState === "error"` banner).
- **What fails → what the user sees:** `await Promise.all([reachApi.broadcastChannels(...), reachApi.broadcastInbox(...)])` — neither callee catches, so if *either* endpoint rejects, both results are discarded: `channels` and `inbox` stay empty, `loadState` flips to `"error"`, and because the create-channel form is gated on `!mine && loadState === "ready"`, an owner whose inbox endpoint hiccupped also loses their channel list *and* the form. One flaky source takes the whole page.
- **Severity:** Medium-high — textbook violation of the dashboard law on a two-source page.
- **Fix sketch:** `Promise.allSettled` (or boolean-loader
...[truncated 9456 chars]s + `Promise.all`, as in `pages/credit-history.tsx:121`) with per-source state: channels failure shows its own card; inbox failure shows its own card; the create form keys off the channels result only.

### F5 — MEDIUM-HIGH — Artist Setup: a failed profile load is silently treated as "this creator has no profile yet"
- **Where:** `pages/artist-setup.tsx:214-242` (load effect; catch at `:238-239`).
- **What fails → what the user sees:** If `fetchMyProfile()` throws (500/network), the catch calls `setProfile(emptyProfile())` and `exists` stays `false` — the exact state of a brand-new creator. An existing creator opening their editor during a hiccup sees a blank page-builder for a profile they already published, and the save path branches on `exists`, so saving from this state walks the *create* flow against an existing profile instead of the edit flow. Failure is indistinguishable from genuine absence.
- **Severity:** Medium-high — misleading empty state with a data-integrity tail (wrong save branch), on the "profile IS the website" surface.
- **Fix sketch:** Mirror `pages/artist-public.tsx:158-167`: distinguish "server said no profile" (the lib's null/404 result) from "load threw" — the latter gets a load-error state with retry and never constructs an `emptyProfile`.

### F6 — MEDIUM (systemic) — No timeout on the shared fetch helpers: a stalled (not failed) connection hangs every loading state forever
- **Where:** `lib/social-api.ts:160-186` (`apiFetch`/`apiJson` — no `AbortSignal`); the same bare-`fetch` shape is repeated in most page-level loaders (e.g. `pages/dashboard.tsx:253-278`, `pages/my-shop.tsx:110-118`, `pages/feed.tsx` via `apiJson`).
- **What fails → what the user sees:** Browsers eventually error a *refused* connection, but a connection that opens and then stalls (sleeping proxy, half-open mobile socket — the known Render-wake environment) leaves the promise pending indefinitely. Every consumer's `loading`/`"loading"` section state then never settles: dashboard sections skeleton forever, feed skeleton forever, with no error and no retry ever offered. The per-section architecture (F-good-pattern #1) bounds the blast radius to the stalled section, but cannot end it.
- **Severity:** Medium, systemic — it converts the law's "degrades per-section" into "hangs per-section".
- **Fix sketch:** Adopt the existing in-codebase model, `lib/earnings-data.ts:130-141` (`AbortController` + per-attempt timeout + retry): add a default timeout signal inside `apiFetch` (e.g. `AbortSignal.timeout(15_000)` merged with any caller signal) so one change covers all `apiJson` consumers, then add the same to the dashboard section fetcher.

### F7 — MEDIUM (family, 8 pages) — Public slug pages render "not found / doesn't exist" on server or network failure
All of these conflate *any* load failure with genuine absence. The correct pattern already exists at `pages/artist-public.tsx:158-167` and `pages/showcase/item.tsx:27-51` (404-only → not-found; everything else → error + retry). In every case below, a 500, a non-JSON error body, or a dropped connection tells a fan/buyer that the creator's page is **gone** — on exactly the viral/public surfaces the site shares externally.
- `pages/challenge.tsx:97-112,161-169` — catch sets `data=null` regardless of status (it throws `String(res.status)` then discards it); a 500 renders "No challenge by that name."
- `pages/albums/public.tsx:57-70` — non-404 errors fall through to `setNotFound(true)` when `d.album` is absent; `.catch(() => setNotFound(true))`.
- `pages/bio-public.tsx:30-42` — `res.json()` is parsed without an `res.ok`/status check; any failure or non-OK payload → `setNotFound(true)`.
- `pages/plan-public.tsx:64-74` — 404 handled, but `.catch(() => setNotFound(true))` and any non-404 error payload → not-found.
- `pages/press-public.tsx:50-60,74` — non-404 `!res.ok` silently returns with `kit` still null, which the render at `:74` treats as not-found; the catch comment even says "show loading state" while `finally` ends loading.
- `pages/sync-one-sheet-public.tsx:52-67` — `res.ok && json.oneSheet` else not-found; catch → not-found. A server error tells a sync buyer the pitch sheet doesn't exist.
- `pages/nfc-card-profile.tsx:27-42` — same shape: any failure/non-OK → not-found ("card not active").
- `pages/tip-page.tsx:78-92` — 404 handled, but `.catch(() => setNotFound(true))`: a network hiccup tells a fan the tip page is gone.
- **Fix sketch (one sweep):** in each loader keep the status (`const status = res.status`), set not-found only for 404, and add the `loadError` + retry state copied from `pages/showcase/item.tsx:30,81-100`.

### F8 — MEDIUM — Hashtag page: load failure renders a confident "0 pieces of content"
- **Where:** `pages/hashtag.tsx:41-58` (catch → `setData(null)`), `:63` (`total` computed from null as 0), header render below it.
- **What fails → what the user sees:** Any failure (500/network) leaves `data` null with no error state at all: the page renders `#tag — 0 pieces of content tagged` and empty Shorts/Videos/Tracks sections, i.e. a measured-looking zero for a tag that may be thriving.
- **Severity:** Medium — category-3 misleading empty, no retry.
- **Fix sketch:** Same 404-vs-error split as F7 (this endpoint's failures aren't even 404-shaped): add `loadError` state + retry; only render the count header once data has actually loaded.

### F9 — MEDIUM — Group Detail: the whole page's spinner is gated on the feed fetch, despite the page's own per-section design
- **Where:** `pages/group-detail.tsx:104-118` (`load()`), `:265` (page-level `if (loading)` gate).
- **What fails → what the user sees:** The file's own comment (at `:88-91`) states the feed "settles on its own… it must never replace the group that already loaded" — and `loadFeed()` does set a scoped `feedError`. But `load()` does `await loadFeed()` *before* `setLoading(false)`, so the full-page "Loading the crew" spinner (and the whole group header/members/about, which already arrived in the first fetch) cannot render until the feed settles. A slow or stalled feed blocks the entire page; the per-section design is defeated by one `await`.
- **Severity:** Medium — category-4 waterfall with a full-page gate; trivially triggered by the slower of two endpoints.
- **Fix sketch:** `setLoading(false)` immediately after the group fetch succeeds, and fire `void loadFeed()` un-awaited (its state is already independent).

### F10 — MEDIUM — Email List: engagement panels are one coupled `Promise.all` whose failure silently empties all four
- **Where:** `pages/email-list.tsx:354-380` (`loadEngagement`).
- **What fails → what the user sees:** Tags, segments, campaigns and automations are fetched in a single `Promise.all` of raw `fetch` promises. Responses don't reject on HTTP errors (those are handled per-panel by the `if (res.ok)` guards), but a *network* rejection on any one of the four rejects the whole `Promise.all` before any `setState` runs — panels whose data arrived fine are discarded along with the failed one. The catch is a bare comment ("panels stay empty; dashboard is unaffected"): all four panels render their empty states with no error marker and no retry, so "no campaigns yet / no automations" is indistinguishable from "couldn't load".
- **Severity:** Medium — coupling (category 1, transport-failure path) + misleading empties (category 3).
- **Fix sketch:** Split into four independent loaders with per-panel error flags (the boolean-loader pattern, `pages/live-shopping.tsx:140-205`), or `Promise.allSettled` with a per-panel `failed` state rendered in place of the empty state.
### F11 — MEDIUM — Loyalty Settings panel (reach): the main source has no error or loading state; failure leaves factory defaults posing as saved settings
- **Where:** `components/reach/LoyaltySettingsPanel.tsx:27-48` (`load`), `:49-65` (mount effect), form defaults at `:25`.
- **What fails → what the user sees:** The redemption-queue half is defended (`.catch(() => ({ redemptions: [] }))` at `:32`), but `reachApi.loyalty(...)` is not: if it rejects, `load()` rejects, the mount effect's catch swallows it as "no profile → panel explains itself", and the panel renders the hard-coded form defaults (`enabled: true, watch: 10, chat: 2, tip: 5, customCost: 1000`) as though they were the creator's saved earn rules. There is no loading state either, so on a slow load the same defaults flash as real values. A creator could "adjust" and save over settings they never saw.
- **Severity:** Medium — misleading state on a money/points settings surface; asymmetric with its own sibling panel `DestinationKeysPanel.tsx:40-60`, which does carry `loadError`.
- **Fix sketch:** Add `loading`/`loadError` state like `DestinationKeysPanel`; disable the form until `state` has loaded; on loyalty failure show a scoped error + retry and leave the queue section working.

### F12 — MEDIUM-LOW — Party Lobby: one transport failure discards all three lists
- **Where:** `pages/party.tsx:373-412` (`loadLobby`).
- **What fails → what the user sees:** Rooms, my-record and leaderboard are fetched via one `Promise.all` of raw fetches, with per-response `.ok` handling *after* the await (the leaderboard even has its own `boardFailed` flag). But a network rejection from any single fetch rejects the whole call before any branch runs: rooms and record that would have succeeded are thrown away, `openRooms`/`record` stay `null`, and only `boardFailed` is set — the rooms list degrades to its no-rooms presentation with no error of its own.
- **Severity:** Medium-low — lobby create/join still work (by design), but two healthy sources are collateral damage of one failure.
- **Fix sketch:** `Promise.allSettled` and fold each result through the existing `.ok` logic independently; give rooms its own `roomsFailed` flag mirroring `boardFailed`.

### F13 — LOW — Shorts trending menu: per-source failures silently become empty lists
- **Where:** `pages/shorts.tsx:775-789` (`ShortsMenu` effect).
- **What fails → what the user sees:** Challenges and sounds each get `.catch(() => ({ challenges: [] }))` / `({ sounds: [] })`, so a failed trending fetch renders the menu tab as genuinely empty ("no trending challenges/sounds") with no error or retry. Coupling is avoided (the catches do that much), but error and empty remain indistinguishable.
- **Severity:** Low — a secondary menu, not a dashboard; noted because it's the same anti-pattern in miniature.
- **Fix sketch:** Track a per-tab `failed` flag on catch and render a one-line "couldn't load — reopen to retry" in place of the empty list.

### F14 — LOW — Artist profile decorative sections hide on failure (error ≡ empty by design)
- **Where:** `components/artist/TrophyShelf.tsx:44-94` (three independent fetches: achievements, challenge wins, game stats) + `:97` (`return null` when all three are empty); also `components/artist/profile-sections.tsx:41-43` (stories/highlights `.catch(() => {})`).
- **What fails → what the user sees:** Each fetch converts failure to `[]`/`null`, and the shelf renders nothing when empty — so a creator with real trophies shows a bare profile during an outage, indistinguishable from a creator who never earned any. This is graceful (the profile itself is unaffected — the law's main clause holds), but it silently falsifies the public record while it lasts.
- **Severity:** Low — supplementary sections on an otherwise compliant page (contrast the sibling sections in good-pattern #5, which do carry error states).
- **Fix sketch:** Optional: keep a per-source `failed` flag and, if any source failed while others are empty, render the shelf's small error+retry (the `ProfileTutorialsSection` shape) instead of nothing.

### F15 — LOW — Team page: spending fetch failure hides the spending section entirely
- **Where:** `pages/team.tsx:96-102` (nested spending fetch, `catch { setSpending([]) }`), render gate at `:464` (`spending.length > 0 && …`).
- **What fails → what the user sees:** For an owner/admin, if `/api/teams/:id/spending` fails, spending is set to `[]` and the whole spending section (the only place team credit spend is shown) vanishes — identical to a team that spent nothing. The rest of the page (teams/members/invites) is correctly unaffected, and the outer load has a real error path, so this is scoped to the one section.
- **Severity:** Low — no fake number is printed (the section disappears rather than showing $0), but a money-visibility section silently absent is the mild end of category 3.
- **Fix sketch:** A `spendingFailed` flag; render a one-line section note + retry in place of the section when it fails.

### F16 — LOW — Reach Watch raid poll: `Promise.all` couples outgoing + incoming raid state
- **Where:** `components/reach/ReachWatchPanel.tsx:126-150`.
- **What fails → what the user sees:** The 3-second raid poll awaits both `raidOutgoing` and `raidIncoming` in one `Promise.all` inside a silent catch. One endpoint failing discards the other's fresh state for that cycle (e.g. an incoming-raid alert is missed because the outgoing call hiccupped). Self-healing on the next poll, so impact is a few seconds of stale raid state during a live stream.
- **Severity:** Low — bounded, self-retrying, live-context only.
- **Fix sketch:** `Promise.allSettled` and apply each fulfilled half independently.

---

## Checked and compliant (no finding)

- **Dashboard** (`pages/dashboard.tsx` + `lib/dashboard-sections.ts`) — the reference implementation (see good-pattern #1). Child widgets degrade independently: `QuestsWidget` (per-quest-type error states), `LeaderboardWidget` (`Promise.allSettled`), `ContestHubWidget` / `CreationStreakWidget` / `DailyDropCard` / `StreakWidget` hide on failure (supplementary, acceptable).
- **Earnings** (`pages/earnings.tsx` + `lib/earnings-data.ts`) — per-source error cards, partial-total honesty note, timeout + backoff. Exemplary.
- **My Shop** (`pages/my-shop.tsx`) — shop-list and product-list failures each get a scoped error + retry, explicitly never the fake-empty state (`:70-76,132-180`); `AnalyticsCard` swallows its own failure ("analytics never breaks the page", `:1088-1099`); `DiscountCodesCard` has its own `loadFailed`.
- **Analytics Hub, other tabs** — main dashboard tab is local/manual data (no fetch to fail); `ContentIdMonitor` uses `Promise.allSettled` per source; `MilestoneTracker`, `ChannelAuditPanel`, `FanDecoderSection`, `ViralityCheckPanel` are single-action panels with scoped error states. The intelligence chain's steps are user-driven single calls.
- **Hub / Create** (`pages/hub.tsx`) — project state is local (`useHubProject`); embedded `UgcAdsPanel` carries a `failed` state per list (products/ads/briefs).
- **Coach** (`pages/coach.tsx` + `components/coach/*`) — `ActionTrackerPanel` settles numbers and items independently (`Promise.allSettled`, `:81`); `RoyaltyTrackerPanel` reuses `lib/royalties-load.ts` (`allSettled`, per-source errors, "a failed summary is an error state, never $0.00"); `MoneyTrackerPanel`/`SplitsOverview` have scoped load errors.
- **Home feed** (`pages/feed.tsx`) — single primary source with error + retry; rails (`StoriesRail`, `SocialRetentionRail`, `CloseFriendsPanel`, `DropsWire`) are self-contained; `CloseFriendsPanel` and `DropsWire` carry their own error states. (`StoriesRail`'s load catch leaves the rail silently empty — same shape as F14, supplementary; not separately numbered.)
- **Home (marketing)** (`pages/home.tsx`) — static sections; the one data widget (`ContestHubWidget`) self-hides on failure.
- **Also verified clean:** `credit-history`, `live-shopping` (per-section boolean loaders, full error only on total failure), `shoutouts`, `scheduler` (initial-load gate with loaded-once ref guard), `collabs` (per-tab load errors with loaded-ref guards), `memberships`, `press-kit`, `publish`, `go-live`, `my-projects` (five independent tab loaders), `group-detail` forum lazy-loads, `messages` (single-source + retry), `explore` (see #6), `store-dashboard`, `nfc-cards`, `songs/dj-set-prep`, `discovery/charts` main tabs (null-on-failure → `loadError`, explicitly never coerced to empty).

## Notes / limits

- Read-only audit; no code was edited and nothing was run against a live server. "User-visible outcome" is derived from the render branches in the cited code.
- Render-time exceptions are bounded globally: `App.tsx:246-300` (`RouteErrorBoundary`, keyed by location) catches a throwing component and shows a recovery card instead of a blank app — so a *render* crash in one section still costs the whole route (there are no per-section error boundaries anywhere in `src/` outside `components/world/StationPanel.tsx`, out of scope). No in-scope page was found that *throws* on a failed fetch (failures are all funnelled through state), so this is recorded as context, not a finding; if per-section boundaries are ever wanted, the dashboard-sections state pattern above is the cheaper fix.
- `world.tsx` and everything under `components/world/**` / `lib/world/**` were excluded per the brief and not audited.
