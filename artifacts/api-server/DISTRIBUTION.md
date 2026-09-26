# Music Distribution — Aggregator Integration & Pricing

## Correctional channel: Jails & Prisons

The `correctional` platform delivers releases to inmate tablet music networks
(**JPay, GTL, Securus/ViaPath**) — millions of listeners inside state and
federal facilities, with almost no competition for attention.

Real-world delivery paths (verified 2026-09-26):
- Aggregators that deliver to **Audible Magic Fulfillment** reach GTL and JPay
  (UnitedMasters documents this; TuneCore / The Orchard / Ingrooves are also
  cited as routes into JPay's catalog).
- Niche services like **Secures Distribution** specialize in jail & prison
  delivery ($10 single / $20 EP-album at time of research).

Honest constraints, shown in the UI when the channel is selected:
- These networks are **curated** — delivery is not guaranteed acceptance.
- **No explicit content** is accepted by JPay/GTL — clean versions only.
- Until a live aggregator with correctional delivery is wired up, the channel
  runs in the labeled sandbox simulation like every other platform.

## Aggregator choice: Too Lost

**DistroKid, TuneCore, CD Baby, Amuse, and RouteNote were evaluated and
rejected**: none of them expose a public developer API for third-party apps
to submit releases programmatically. They are dashboard-only products.

**Too Lost** (https://toolost.com) is the integration target:
- Publishes a **Developer API** ("Build applications using Too Lost's
  backend" — https://toolost.com/developers).
- Acquired **GYRO.Group's DistroDirect** white-label distribution
  infrastructure (2026), explicitly built for businesses that distribute on
  behalf of artists.
- Delivers to **450–480+ stores/services**: Spotify, Apple Music, YouTube
  Music, TikTok, Instagram, Amazon Music, Deezer, TIDAL, Roblox, Tencent —
  the same footprint a DistroKid-style product needs.
- $1B-scale backing (GoldState Music + TA Associates strategic investment,
  March 2026); 450,000+ artists/labels on platform.

## Code layout

- `src/lib/distribution-aggregator.ts` — the integration layer:
  - `AggregatorAdapter` interface (`submitRelease`, `fetchPlatformStatuses`,
    `name`, `live`). Everything else in the app depends on this interface,
    not on any vendor's HTTP shape.
  - `MockAggregatorAdapter` — sandbox simulation. Full lifecycle
    (queued → pending → delivered → live) on an accelerated clock
    (20s / 90s / 240s). In-memory job store (same tradeoff as the
    mix-master/audio-cleanup stores — a restart re-registers from the DB).
  - `TooLostAdapter` — real implementation. Endpoint paths/payload fields
    marked **TO-CONFIRM** against the developer docs before enabling.
  - `getAggregator()` — returns Too Lost when `DISTRIBUTION_AGGREGATOR=toolost`
    **and** `TOOLOST_API_KEY` is set; otherwise the mock sandbox.
- `src/routes/generate/distribution.ts` — API routes + delivery poller
  (15s tick until all platforms terminal) + `resumeActiveDeliveries()`
  (called from `src/index.ts` on boot).
- Migration `lib/db/migrations/0034_distribution_v2.sql`.

## Going live — exact checklist

1. **Too Lost account** with Developer/API access provisioned (contact their
   partnerships/developer team — API access is per-account).
2. **Render → Environment** on the `bow-down-visuals` service:
   - `DISTRIBUTION_AGGREGATOR=toolost`
   - `TOOLOST_API_KEY=<secret key>` (never commit; never print)
   - `TOOLOST_API_BASE=https://api.toolost.com/v1` (confirm in docs)
   - `TOOLOST_WEBHOOK_SECRET=<secret>` (for delivery-status webhooks)
   - `APP_PUBLIC_URL=https://bowdownvisuals.com` (for pre-save links)
3. **Confirm the TO-CONFIRM markers** in `TooLostAdapter`
   (`POST /releases`, `GET /releases/{id}/deliveries`, field names) against
   https://toolost.com/developers, then deploy.
4. **Webhook**: point Too Lost's delivery-status webhook at
   `POST /api/distribution/webhooks/toolost`. The handler expects an
   HMAC-SHA256 hex digest of the raw body in `x-toolost-signature`,
   keyed by `TOOLOST_WEBHOOK_SECRET` — update to match the docs if their
   scheme differs.
5. **Run migration 0034** on the production database.
6. Flip the UI automatically shows "live" mode: `GET /api/distribution/pricing`
   returns `aggregatorLive: true`, and the sandbox badges disappear.

Until then the product runs end-to-end in **sandbox mode**, always labeled
as a simulation in the UI and API notices. It never claims a real platform
accepted anything.

## Pricing & margin logic

Site credits ≈ **$0.50** each at current pack pricing.

| Tier   | Credits | ≈ Revenue | Est. aggregator cost | ≈ Gross margin |
|--------|---------|-----------|----------------------|----------------|
| Single | 10      | $5.00     | $0–2                 | $3–5           |
| EP     | 20      | $10.00    | $2–3                 | $7–8           |
| Album  | 30      | $15.00    | $3–5                 | $10–12         |

The fee is not a pure pass-through: it covers package validation, artwork
QA, ISRC/UPC handling, delivery monitoring, pre-save links, and the royalty
split tooling. Tiers are env-overridable
(`DISTRIBUTION_SINGLE_CREDITS` / `_EP_` / `_ALBUM_`) and served live by
`GET /api/distribution/pricing` — no frontend redeploy to reprice.

**Annual unlimited plan** ("Distribute Unlimited", default 399cr/yr ≈
DistroKid's $19.99/yr equivalent at credit value) is the upsell lever —
listed `comingSoon` until billing supports subscriptions.

**AI upsells on the same page**: release metadata (1cr), pre-release
strategy (1cr), cover art via the existing image pipeline (1–2cr). All
charge-before-generate with refund on provider failure.

## Honesty contract (standing)

- `platform_statuses` is the ONLY delivery truth and comes from the
  aggregator adapter. Statuses: `queued → pending → delivered → live`
  (plus `failed`).
- Mock mode is labeled "sandbox simulation" everywhere — UI badge, API
  notice, platform detail strings.
- Royalty splits are informational until payouts are integrated (UI says so).
- Pre-save links are shareable immediately; the landing page notes the
  release date.
