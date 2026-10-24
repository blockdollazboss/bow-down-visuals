# Lane 12 (Stack-100 #3, Wave 3) — Pricing Truth Table

Verified from source in this worktree at base f96d7b72. DISPLAYS ONLY were
aligned to these sources; no charged amount, constant, Stripe id, or rail
was changed by this lane.

## 1. Creator subscription tiers — TIER_PLANS (the only subscription rail)

Source: `artifacts/api-server/src/lib/platform-fees.ts:184-243` (TIER_PLANS),
served live by `GET /api/creator-tiers/plans`
(`artifacts/api-server/src/routes/creator-tiers.ts:102-122`) and charged via
`POST /api/creator-tiers/checkout` using the env-held Stripe price id
(`priceIdEnv`). Prices marked "★ APPROVED 2026-10-07" in the source header
(platform-fees.ts:18-22).

| Tier | Name (source) | Price | Stripe price id wiring | Fee | AI boosts/mo |
|---|---|---|---|---|---|
| free | Free | $0 (priceUsdPerMonth: null) | none (priceIdEnv: null) | 500 bps (flat 5%) | 3 |
| pro | Pro | $12/mo | env `STRIPE_PRICE_TIER_PRO` (platform-fees.ts:208) | 500 bps (flat 5%) | 25 |
| elite | Elite | $29/mo | env `STRIPE_PRICE_TIER_ELITE` (platform-fees.ts:226) | 500 bps (flat 5%) | 100 |

Fee truth: PLATFORM_FEE_BPS = 500 and TIER_FEE_BPS = {free:500, pro:500,
elite:500} (platform-fees.ts:52-67) — owner ruling 2026-10-23, flat 5% on
every tier; the old 10%/7%/5% ladder is retired. Paid tiers sell features,
not a fee drop: breakEvenSalesUsd() returns null, monthlySavingsUsd() = 0.

Feature lists (source, platform-fees.ts:191-242):
- Free: subdomain site, livestreaming, sell downloads/products/tickets at
  flat 5%, basic themes, basic analytics, 3 boosts/mo, full earnings dashboard.
- Pro: everything in Free + custom domain, unlimited products, premium
  gold-luxury themes, pro analytics (funnels/sources/cohorts), 25 boosts/mo.
- Elite: everything in Pro + priority placement in discovery, dedicated
  support badge + priority support, 100 boosts/mo.

Stripe TEST price ids: the brief named price_1UTC512NNWa7jVHBSyqmySD8 (Pro)
and price_1UTC5s2NNWa7jVHBixg6sGid (Elite). **Neither id appears anywhere in
this tree** (grep over ts/tsx/md/json/.env.example: no hits). The tree wires
ids only through env (`STRIPE_PRICE_TIER_PRO` / `STRIPE_PRICE_TIER_ELITE`,
read in platform-fees.ts, creator-tiers.ts checkout, and
`artifacts/api-server/src/lib/creator-tier-sync.ts:35-36`). The AMOUNTS
($12 / $29) are verified from TIER_PLANS; the ids themselves can only be
verified on the Render env / Stripe dashboard — see BOARD B2.

## 2. Visual Buc credit packs — PACK_MAP (the only pack rail)

Source: `artifacts/api-server/src/routes/stripe-payments.ts:14-19`,
duplicated identically in `artifacts/api-server/src/routes/express-pay.ts:17-22`.
Dollar amounts live on the Stripe side (env price ids); the rail defines
keys + credits only.

| Pack key | Credits granted | Stripe env | Displayed price (all surfaces) |
|---|---|---|---|
| "10" | 1,000 VB | STRIPE_PRICE_10_CREDITS | $9 |
| "50" | 5,000 VB | STRIPE_PRICE_50_CREDITS | $39 |
| "150" | 15,000 VB | STRIPE_PRICE_150_CREDITS | $99 |
| "500" | 50,000 VB | STRIPE_PRICE_500_CREDITS | $249 |

Displayed prices agree on every surface checked:
- locales: `pricing.creditPacks.packs.*` in ALL 10 catalogs (en, es, fr, de,
  pt, it, ar, hi, ja, ko) — $9/$39/$99/$249, credits 1,000/5,000/15,000/50,000
  (scripted numeric sweep of the whole `pricing.*` section per locale:
  zero numeric diffs vs en).
- `artifacts/bow-down-visuals/src/lib/world/money-desks.ts:56-59` CREDIT_PACKS.
- `artifacts/bow-down-visuals/src/pages/home.tsx:129-132` + home JSON-LD
  AggregateOffer lowPrice 9 / highPrice 249 / offerCount 4.
- Operator KB `operator-knowledge.json` packs[]: credits + labels only
  (sourced from PACK_MAP), no dollar figures.

## 3. Hosting plan — deliberately UNPRICED in source

Source: platform-fees.ts:262-307 (HOSTING_PLAN). Price = env
`HOSTING_PRICE_USD_PER_MONTH` + Stripe id in `STRIPE_PRICE_HOSTING`; until
the owner sets them the price reads null and checkout refuses. No display
in the tree invents a hosting price (verified by sweep). Nothing to align.

## 4. Advertising takeovers

- Spotlight Takeover: $1,000 / 7 days — `lib/db/src/schema/spotlight.ts:28-39`
  (SPOTLIGHT_OFFER). Displays agree: SpotlightModal fallback $1000,
  ThyCheatCodeChat, operator KB grounding tests.
- Loading Screen Takeover: $2,500 / 7 days —
  `lib/db/src/schema/loading-screen.ts:29-31` (LOADING_SCREEN_OFFER).
  Displays agree: witty-loader, ThyCheatCodeChat, operator tests.

## 5. Distribution release pricing (live-served, no hardcoded FE price)

Source: `artifacts/api-server/src/routes/generate/distribution.ts:41-71`:
single 1,000 VB / EP 2,000 VB / album 3,000 VB (env-overridable),
Distribute Unlimited 399 VB/year with `comingSoon: true`. The /distribute
page reads `GET /api/distribution/pricing` live — no contradicting display
found. (Any change to 399 is a PRICE change — owner call only, BOARD B4.)

## 6. Earned rank ladder — NOT a price source

Source: `artifacts/api-server/src/lib/creator-rank.ts`: STAR_TITLES =
Street Punk / Hustler / Gangster / Shot Caller / Crime Boss / Kingpin at
0 / 25 / 100 / 300 / 700 / 1,400 points. Header law: "Rank is NEVER
purchasable. No source counts spending, credit packs, plan tier, or
balances." TIER_PLANS sells no stars (pinned in platform-fees.test.ts).

## 7. Other displays swept and found AGREEING (no edit)

- creator-pricing.tsx: renders plans from the live API DTO (no local price
  table); flat-5% copy throughout; stars section states earned-never-sold
  with the same point thresholds as creator-rank.ts (0/25/100/300/700/1,400
  — its ★5/★6 lines add the business-result gates in prose).
- guides/pricing.ts: Creator Pro $12/mo, Creator Elite $29/mo, flat 5%,
  feature lists match TIER_PLANS.
- World PlansDesk / money-desks-2.ts planPriceLabel: prices ride the API
  DTO ("$12/mo" / "$29/mo" only in comments citing TIER_PLANS).
- World PacksDesk / money-desks.ts CREDIT_PACKS: §2 table exactly.
- home.tsx FAQ per-action costs: song 400 VB (music-audio tier ≤1min),
  video 400 VB, hook 100 VB (hook-studio.ts: HOOK_STUDIO_CREDITS default
  100) — all match rails.
- Signup / beta-access / features / SEO pages: no plan prices displayed.
