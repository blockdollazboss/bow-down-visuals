# Site Mode — mount instructions for the coordinator (Worker 10)

Worker 10 built the component; the **coordinator** owns the actual `App.tsx` edit
(multiple workers touch that file — don't merge-conflict it from a worker branch).

## What was built

- `artifacts/bow-down-visuals/src/components/site-mode/SiteMode.tsx`
  - `SiteModeGate` — drop-in replacement for `<AppShell />`. On boot it checks
    `window.location.hostname`: if it's the main app domain (or localhost /
    `*.onrender.com` preview) it renders `children` untouched. Otherwise it calls
    the public `GET /api/domains/resolve?host=`; a returned slug renders
    `<SiteMode slug>` — the creator's full standalone site (their theme, their
    name in `document.title`, full profile → store → content → social link graph
    via the same section renderer as `/artist/:slug`, all relative links).
    Unknown hosts fall back to the normal app — never a dead page.
  - `PoweredByBadge` — the only BDV chrome on a creator's site; links to
    `MAIN_SITE_URL` (`@/lib/domains.ts`, overridable via `VITE_MAIN_SITE_URL`).
- `artifacts/bow-down-visuals/src/lib/domains.ts` — types, authed API helpers
  (`fetchMyDomains`, `claimDomain`, `verifyDomain`, `deleteDomain`), public
  `resolveSite`, `isMainAppHost`, `MAIN_SITE_URL`, `dnsInstructionsFor`.
- `artifacts/bow-down-visuals/src/pages/creator-domains.tsx` — the Domain Setup
  page (default export `CreatorDomainsPage`).

## Exact App.tsx edit

In `artifacts/bow-down-visuals/src/App.tsx`:

1. Add the import (with the other component imports near the top):

```tsx
import { SiteModeGate } from "@/components/site-mode/SiteMode";
```

2. In `function App(...)`, replace the `<AppShell />` line inside the providers:

```tsx
// BEFORE
<StreamingPlayerProvider>
  <CharacterThemeApplier />
  <AppShell />
</StreamingPlayerProvider>

// AFTER
<StreamingPlayerProvider>
  <CharacterThemeApplier />
  <SiteModeGate>
    <AppShell />
  </SiteModeGate>
</StreamingPlayerProvider>
```

That's it — one import, one wrapper. The gate must stay **inside** the providers
(`SiteMode` reuses `ProfileSections`/`ProfileActions`, whose follow/tip/share
actions expect `AuthProvider` etc. to exist).

## Suggested route for the Domain Setup page

```tsx
const CreatorDomains = lazy(() => import("@/pages/creator-domains"));
…
<Route path="/creator/domains">
  <ProtectedRoute><CreatorDomains /></ProtectedRoute>
</Route>
```

And link it from the creator dashboard's "Your Website" area (Worker 1/2/3's
surface — the page itself is self-contained). Lazy-load it like the other
tool pages.

## Suggested server wiring (coordinator — routes/index.ts)

```ts
import domainsRouter from "./domains";
…
router.use(domainsRouter);
```

The router already carries full `/api/…` paths (`/api/domains`, `/api/domains/mine`,
`/api/domains/:id/verify`, `/api/domains/:id`, `/api/domains/resolve`), matching
the convention of the other route files.

## Render-side step (cannot be done from code — needs a human in the dashboard)

1. Render dashboard → the **bow-down-visuals** web service → Settings → Custom Domains.
2. Add `*.bowdownvisuals.com` as a custom domain (this is what makes every
   creator's free `<slug>.bowdownvisuals.com` actually route to the service).
3. Render will show the DNS target for the wildcard (and auto-provision the
   wildcard TLS cert — **SSL is automatic, nothing to install**).
4. Copy that target into the `DOMAINS_CNAME_TARGET` env var on the service
   (today the API + UI show the documented placeholder `cname.bowdownvisuals.com`
   and say so honestly in the instructions).
5. Each paid custom domain a creator connects must ALSO be added as a custom
   domain on the Render service (Render provisions a cert per domain
   automatically). Future automation: the Render API can add custom domains
   programmatically when a domain verifies — parked, manual step for now.

## DNS reality check (what works on staging now vs needs DNS)

- ✅ Works now: schema (migration 0095), all five endpoints, the setup UI flow,
  the resolve logic, site-mode rendering (testable by spoofing the Host header
  or a local `/etc/hosts` entry → the app, then calling
  `/api/domains/resolve?host=thatname`).
- ⏳ Needs real DNS: actual `<slug>.bowdownvisuals.com` subdomains and custom
  domains going live end-to-end (wildcard on Render + `DOMAINS_CNAME_TARGET`
  set + a creator's CNAME/TXT at their provider). The verify endpoint does live
  `node:dns` lookups, so the moment DNS is real, "Check now" flips rows live.
