/**
 * Customer 3D conversion price — RULED Oct 27, 2026; product not built.
 *
 * Owner ruling (by delegation, "do the prices as you recommend"):
 * converting a creator's vault character to 3D costs 1,500 Visual Bucs.
 *
 * Honest state at the ruling's wiring, verified by exhaustive search
 * of this tree (routes, pages, desks, the credit-costs registry, and
 * the operator knowledge base): NO customer-facing 3D conversion
 * surface, route, or rail exists yet. The Artist Vault manages
 * characters (reference photos, voice profiles) but sells no
 * conversion; the 3D conversion pipeline is internal proof tooling
 * (src/world-3d-proof) plus out-of-repo chain scripts. There is
 * therefore no display and no rail to align — and no figure was
 * forced onto any surface, the same treatment this lane gave the
 * wallpaper desk's "pack of 10 = 500" (a ruled price for a product
 * the desk does not sell).
 *
 * This constant is the recorded ruling. When the conversion desk is
 * built, BOTH its display and its server rail must derive from here,
 * and customer-3d-prices.test.ts — which pins the ruling AND the
 * current absence — must be updated in the same commit that wires
 * them, so the gap can never silently become a second price.
 */
export const CUSTOMER_3D_CONVERSION_COST = 1500;
