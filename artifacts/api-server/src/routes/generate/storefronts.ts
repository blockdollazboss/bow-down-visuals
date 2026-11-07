/**
 * Stack 8 #2 — MERGED into the canonical shop surface (generate/shops.ts).
 *
 * The storefronts platform layer (hub, slug storefront, analytics,
 * checkout/sale recording, custom domains) now lives in shops.ts over
 * the same shops / shop_products / shop_events tables. This module is a
 * delegation shim: it re-exports the merged router and the platform
 * helpers (STOREFRONT_PLATFORM_FEE_BPS, PLATFORM_FEE_PCT, meetsProTier,
 * requireShopDomainHosting, SHOP_DOMAIN_HOSTING_MESSAGE,
 * issueDomainToken, txtRecordsMatch) so existing importers — the
 * require-auth plan tests and other consumers — keep resolving
 * unchanged. routes/index.ts no longer mounts this module separately.
 * (Stack-200 M3b: requireProTier is gone — shop domain attach is gated
 * by the Hosting entitlement, requireShopDomainHosting.)
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
  requireShopDomainHosting,
  SHOP_DOMAIN_HOSTING_MESSAGE,
  issueDomainToken,
  txtRecordsMatch,
} from "./shops";
import shopsRouter from "./shops";

export default shopsRouter;
