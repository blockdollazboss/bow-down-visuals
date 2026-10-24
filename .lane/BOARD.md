# Lane 12 — BOARD (owner rulings needed; NOT resolved by this lane)

## B1 — The /pricing 6-plan ladder vs TIER_PLANS (the known open question)

Display: `artifacts/bow-down-visuals/src/pages/pricing.tsx:197-335` sells six
plans named Street Punk $19/mo · Hustler $49/mo · Gangster $99/mo ·
Shot Caller $199/mo · Crime Boss $399/mo · Kingpin $799/mo, each with a
monthly Visual Buc allotment (2,500 / 10,000 / 25,000 / 60,000 / 150,000 /
400,000 VB) and feature lists, rendered in all 10 locale catalogs
(`pricing.plans.*`) and in the page's schema.org OfferCatalog JSON-LD.

Evidence it has NO source of truth in the tree:
- No rail charges it: no Stripe price env, no checkout (every CTA links to
  /beta-access; the page itself says "Billing is not live yet. All plan
  buttons join the beta list."), no code grants those monthly allotments.
- The only subscription rail is TIER_PLANS: Free $0 / Pro $12 / Elite $29
  (TRUTH §1) — a completely different ladder.
- The six names are the EARNED RANK titles (creator-rank.ts STAR_TITLES),
  whose source law is "Rank is NEVER purchasable" — and /creator-pricing's
  stars section says the same ("No plan raises your stars"). /pricing
  presents those same titles as purchasable plans ranked by stars.

Why boarded, not fixed: the display contradicts two sources, but the correct
resolution is a product decision only the owner can make — (a) retire the
ladder and let /pricing show packs + the real Creator Plans, (b) keep it as
a future/founding plan set and approve its prices + allotments as real
prices (a PRICE decision), or (c) relabel it as the earned-rank ladder with
no prices. Each option changes what the business offers; this lane may not
choose one, and may not edit the source prices to match either side.

## B2 — Stripe TEST tier price ids are not verifiable from the tree

Brief-named ids price_1UTC512NNWa7jVHBSyqmySD8 (Pro $12) and
price_1UTC5s2NNWa7jVHBixg6sGid (Elite $29) appear nowhere in the repo; the
tree wires them only via env names STRIPE_PRICE_TIER_PRO /
STRIPE_PRICE_TIER_ELITE (and .env.example does not list those two env vars
at all — this lane added placeholder doc lines for the wiring, no values).
Amounts $12/$29 are verified from TIER_PLANS. Owner/operator to confirm on
the Render env + Stripe TEST dashboard that those ids carry $12.00 and
$29.00 USD/month respectively; if an id carries a different amount, the
DISPLAY ($12/$29) and the CHARGE would disagree and the fix is a price/env
decision for the owner, not a display edit this lane may make.

## B3 — "100 bonus Visual Bucs on launch day" promise has no grant source

Display: pricing bottom CTA + FAQ a2 in all locales ("Beta members lock in
the founding rate and get 100 bonus Visual Bucs on launch day",
en.json pricing.bottomCta.text). No rail found that grants a 100 VB
launch-day beta bonus (bonus.ts covers daily login + wheel only). Either a
grant needs building (feature work, not display alignment) or the promise
needs the owner's word to keep/remove. Left untouched.

## B4 — Distribute Unlimited at 399 VB/year (informational)

Rail and live display AGREE at 399 VB/year, comingSoon: true
(distribution.ts ANNUAL_UNLIMITED_PLAN). It is the one priced plan not in
whole-hundred VB like every other price on the site, and memory records it
as an open owner question (confirm or change). Any change is a PRICE
change — forbidden to this lane — so it is boarded for the owner's
confirm/change call; no display edit made or needed today.
