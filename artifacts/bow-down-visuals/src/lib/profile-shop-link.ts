/* ── Profile Merch shelf link ──────────────────────────────────────────────
   The public profile's Merch shelf must land a VISITOR somewhere public:
   the creator's own shop page (/shop/<handle>) when they run a customer
   shop, otherwise the public storefronts hub. It must never point at
   /my-shop — that's the signed-in owner's shop MANAGER: it ignores any
   ?artist= parameter and shows the visitor their own shop instead. */

export function merchShopHref(profile: { shop_handle?: string | null }): string {
  const handle = profile.shop_handle?.trim();
  return handle ? `/shop/${handle}` : "/storefronts";
}
