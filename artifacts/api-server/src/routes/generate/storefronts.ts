/**
 * Stack 8 #2 — MERGED into the canonical shop surface (generate/shops.ts).
 *
 * The storefronts platform layer (hub, slug storefront, analytics,
 * checkout/sale recording, custom domains) now lives in shops.ts over
 * the same shops / shop_products / shop_events tables. This module is a
 * delegation shim: it re-exports the merged router and the platform
 * helpers (STOREFRONT_PLATFORM_FEE_BPS, PLATFORM_FEE_PCT, meetsProTier,
 * requireProTier, issueDomainToken, txtRecordsMatch) so existing
 * importers — routes/store.ts, routes/generate/shops.ts consumers, the
 * require-auth plan tests — keep resolving unchanged. routes/index.ts
 * no longer mounts this module separately.
 *
 * NOT part of this merge: routes/storefront.ts (/storefront/*) is the
 * per-profile catalog on store_products / store_orders — a different
 * data model with its own Stripe checkout/verify flow (see Stack 8
 * report for the documented divergence).
 */
export {
  STOREFRONT_PLATFORM_FEE_BPS,
  PLATFORM_FEE_PCT,
  meetsProTier,
  requireProTier,
  issueDomainToken,
  txtRecordsMatch,
} from "./shops";
import shopsRouter from "./shops";

export default shopsRouter;
