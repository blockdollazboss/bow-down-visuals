/**
 * store-growth — the Store Growth desk's pure logic (stack1400
 * parity wave #1, item 3: lead-magnets / order-bumps /
 * post-purchase-upsell in-World). Pins:
 * (a) the seller's store is found the dashboard's way — the slug
 *     parses out of the money-checklist's storeUrl, and nothing
 *     else yields one;
 * (b) the product list parses tolerantly (junk rows drop, a
 *     payload with no products array is no list at all) and the
 *     raw bumpConfig validates like the rail's reader (UUID +
 *     whole % 0–90, else no designation);
 * (c) lead-magnet truth is the rail's: priceCents 0 IS a magnet,
 *     except Office Hours services ($0 is their unused dollar
 *     field, VB-priced, claim-refused) and gift cards (price is
 *     an amounts list) — and only paid non-gift-card products can
 *     be converted;
 * (d) the write payloads are the dashboard's exact bodies: create
 *     at priceCents 0, convert/restore as a price-only PATCH, and
 *     the bump PUT { bumpProductId, percentOff } with null as the
 *     clear (which clears BOTH the checkout bump and the
 *     after-purchase offer — the one designation);
 * (e) bump candidates follow validateBumpTarget's knowable rules
 *     (never self, never free, never a gift card) and the preview
 *     math mirrors bumpUnitCents (seller % off, floored at 1¢);
 * (f) saves apply ONLY from server-confirmed rows (bump PUT's
 *     { product, offerLive }, create/PATCH's { product });
 * (g) addonSummary never over-claims: no designation / attached
 *     but not live / live are three distinct lines.
 *
 * Source pins: the desk component rides the exact storefront
 * rails (money-checklist, products list, POST/PATCH products,
 * PUT bump), carries its three sections' testids, exits NOWHERE
 * (no window.open, no /store/dashboard link — World law), and
 * ShopStands composes it at the Marketplace stand.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_BUMP_PERCENT_OFF,
  addonSummary, applyGrowthProductSave, buildBumpPayload,
  buildLeadMagnetConvertPayload, buildLeadMagnetCreatePayload,
  buildLeadMagnetRestorePayload, bumpCandidates, bumpPercentProblem,
  bumpUnitCents, emptyLeadMagnetForm, isLeadMagnet, leadMagnetConvertible,
  leadMagnetFormProblem, leadMagnetRestoreProblem, leadMagnets,
  parseBumpPercent, parseBumpSave, parseGrowthProduct, parseGrowthProducts,
  parseSavedGrowthProduct, parseStoreSlug,
  type GrowthProduct,
} from "./store-growth";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: A, title: "Beat Pack Vol. 1", kind: "digital", priceCents: 2500,
    isActive: true, serviceDetails: null, bumpConfig: null, bump: null,
    ...over,
  };
}
function growth(over: Partial<GrowthProduct> = {}): GrowthProduct {
  return {
    id: A, title: "Beat Pack Vol. 1", kind: "digital", priceCents: 2500,
    isActive: true, officeHours: false, bumpConfig: null, bump: null,
    ...over,
  };
}

describe("parseStoreSlug — the dashboard's own source", () => {
  it("reads the slug out of links.storeUrl", () => {
    expect(parseStoreSlug({ links: { storeUrl: "/artist/gold-standard" } })).toBe("gold-standard");
    expect(parseStoreSlug({ links: { storeUrl: "https://example.com/artist/gold-standard?x=1" } })).toBe("gold-standard");
  });
  it("anything else is no slug", () => {
    expect(parseStoreSlug({ links: { storeUrl: "/store/dashboard" } })).toBeNull();
    expect(parseStoreSlug({ links: {} })).toBeNull();
    expect(parseStoreSlug({})).toBeNull();
    expect(parseStoreSlug(null)).toBeNull();
  });
});

describe("parseGrowthProducts — tolerant, never invented", () => {
  it("parses honest rows and drops junk", () => {
    const list = parseGrowthProducts({ products: [row(), row({ id: B, title: "Free Sample", priceCents: 0 }), { id: 7 }, null, "x"] });
    expect(list).toHaveLength(2);
    expect(list![0]).toMatchObject({ id: A, priceCents: 2500, bumpConfig: null });
    expect(list![1]).toMatchObject({ id: B, priceCents: 0 });
  });
  it("a payload with no products array is no list at all", () => {
    expect(parseGrowthProducts({})).toBeNull();
    expect(parseGrowthProducts({ products: "nope" })).toBeNull();
    expect(parseGrowthProducts(null)).toBeNull();
  });
  it("bumpConfig validates like the rail's reader", () => {
    expect(parseGrowthProduct(row({ bumpConfig: { bumpProductId: B, percentOff: 10 } }))?.bumpConfig)
      .toEqual({ bumpProductId: B, percentOff: 10 });
    expect(parseGrowthProduct(row({ bumpConfig: { bumpProductId: "not-a-uuid", percentOff: 10 } }))?.bumpConfig).toBeNull();
    expect(parseGrowthProduct(row({ bumpConfig: { bumpProductId: B, percentOff: 91 } }))?.bumpConfig).toBeNull();
    expect(parseGrowthProduct(row({ bumpConfig: { bumpProductId: B, percentOff: 1.5 } }))?.bumpConfig).toBeNull();
  });
  it("the resolved bump offer rides through; a malformed one is null", () => {
    const p = parseGrowthProduct(row({ bump: { productId: B, title: "Stem Pack", priceCents: 2250, percentOff: 10 } }));
    expect(p?.bump).toEqual({ productId: B, title: "Stem Pack", priceCents: 2250, percentOff: 10 });
    expect(parseGrowthProduct(row({ bump: { productId: B } }))?.bump).toBeNull();
  });
  it("Office Hours services are flagged off their serviceDetails", () => {
    const p = parseGrowthProduct(row({ kind: "service", priceCents: 0, serviceDetails: { office_hours: true, price_vb: 500 } }));
    expect(p?.officeHours).toBe(true);
    expect(parseGrowthProduct(row({ serviceDetails: { duration_min: 30 } }))?.officeHours).toBe(false);
  });
});

describe("lead magnets — the rail's $0 rule, with its two honest exceptions", () => {
  const magnet = growth({ id: B, title: "Free Sample", priceCents: 0 });
  const officeHours = growth({ id: C, title: "Office Hours", kind: "service", priceCents: 0, officeHours: true });
  const giftCard = growth({ id: D, title: "Gift Card", kind: "gift_card", priceCents: 0 });
  const paid = growth();

  it("a $0 product is a lead magnet; Office Hours and gift cards are not", () => {
    expect(isLeadMagnet(magnet)).toBe(true);
    expect(isLeadMagnet(officeHours)).toBe(false);
    expect(isLeadMagnet(giftCard)).toBe(false);
    expect(isLeadMagnet(paid)).toBe(false);
    expect(leadMagnets([paid, magnet, officeHours, giftCard])).toEqual([magnet]);
  });
  it("only paid, non-gift-card, non-Office-Hours products can be converted", () => {
    expect(leadMagnetConvertible([paid, magnet, officeHours, giftCard])).toEqual([paid]);
  });
  it("the create payload is the dashboard's product shape at priceCents 0", () => {
    const form = { title: "  Free Hooks Pack ", description: " five hooks ", kind: "download" as const };
    expect(buildLeadMagnetCreatePayload(form)).toEqual({
      kind: "download", title: "Free Hooks Pack", description: "five hooks",
      priceCents: 0, inventory: -1, mediaUrls: [], isActive: true,
    });
    expect(leadMagnetFormProblem(emptyLeadMagnetForm())).toMatch(/title/i);
    expect(buildLeadMagnetCreatePayload(emptyLeadMagnetForm())).toBeNull();
  });
  it("convert is a price-only PATCH; restore demands a real price above $0", () => {
    expect(buildLeadMagnetConvertPayload()).toEqual({ priceCents: 0 });
    expect(buildLeadMagnetRestorePayload("9.99")).toEqual({ priceCents: 999 });
    expect(buildLeadMagnetRestorePayload("0")).toBeNull();
    expect(buildLeadMagnetRestorePayload("0.00")).toBeNull();
    expect(buildLeadMagnetRestorePayload("abc")).toBeNull();
    expect(leadMagnetRestoreProblem("12")).toBeNull();
    expect(leadMagnetRestoreProblem("0")).toMatch(/above \$0/);
  });
});

describe("order bumps — candidates, percent gate, payload, preview math", () => {
  const main = growth();
  const target = growth({ id: B, title: "Stem Pack", priceCents: 3000 });
  const freebie = growth({ id: C, title: "Free Sample", priceCents: 0 });
  const giftCard = growth({ id: D, title: "Gift Card", kind: "gift_card", priceCents: 2500 });

  it("candidates exclude the product itself, free products and gift cards", () => {
    expect(bumpCandidates([main, target, freebie, giftCard], main.id)).toEqual([target]);
  });
  it("the % off gate is the rail's: whole number 0–90, empty reads as 0", () => {
    expect(MAX_BUMP_PERCENT_OFF).toBe(90);
    expect(bumpPercentProblem("")).toBeNull();
    expect(bumpPercentProblem("0")).toBeNull();
    expect(bumpPercentProblem("90")).toBeNull();
    expect(bumpPercentProblem("91")).toMatch(/0 to 90/);
    expect(bumpPercentProblem("1.5")).toMatch(/0 to 90/);
    expect(bumpPercentProblem("-5")).toMatch(/0 to 90/);
    expect(parseBumpPercent("")).toBe(0);
    expect(parseBumpPercent("25")).toBe(25);
  });
  it("the PUT payload is the dashboard's exact body; null clears the one designation", () => {
    expect(buildBumpPayload(B, "10")).toEqual({ bumpProductId: B, percentOff: 10 });
    expect(buildBumpPayload(B, "")).toEqual({ bumpProductId: B, percentOff: 0 });
    expect(buildBumpPayload(null, "10")).toEqual({ bumpProductId: null, percentOff: 0 });
    expect(buildBumpPayload("not-a-uuid", "0")).toBeNull();
    expect(buildBumpPayload(B, "91")).toBeNull();
  });
  it("preview math mirrors bumpUnitCents — seller % off, floored at 1¢", () => {
    expect(bumpUnitCents(3000, 10)).toBe(2700);
    expect(bumpUnitCents(3000, 0)).toBe(3000);
    expect(bumpUnitCents(10, 90)).toBe(1);
    expect(bumpUnitCents(0, 10)).toBe(0);
  });
});

describe("server-confirmed saves — the list never moves on a local guess", () => {
  it("parseBumpSave narrows the PUT answer ({ product, offerLive })", () => {
    const saved = parseBumpSave({ product: row({ bumpConfig: { bumpProductId: B, percentOff: 10 } }), offerLive: true });
    expect(saved?.offerLive).toBe(true);
    expect(saved?.product.bumpConfig).toEqual({ bumpProductId: B, percentOff: 10 });
    expect(parseBumpSave({ product: row(), offerLive: "yes" })?.offerLive).toBe(false);
    expect(parseBumpSave({ offerLive: true })).toBeNull();
    expect(parseBumpSave(null)).toBeNull();
  });
  it("parseSavedGrowthProduct narrows create/PATCH answers", () => {
    expect(parseSavedGrowthProduct({ product: row({ priceCents: 0 }) })?.priceCents).toBe(0);
    expect(parseSavedGrowthProduct({})).toBeNull();
    expect(parseSavedGrowthProduct({ product: { id: A } })).toBeNull();
  });
  it("applyGrowthProductSave replaces a known row and prepends a new one (newest first)", () => {
    const list = [growth(), growth({ id: B, title: "Stem Pack" })];
    const edited = growth({ priceCents: 0 });
    expect(applyGrowthProductSave(list, edited)[0]).toEqual(edited);
    const created = growth({ id: C, title: "New Freebie", priceCents: 0 });
    expect(applyGrowthProductSave(list, created).map((p) => p.id)).toEqual([C, A, B]);
  });
});

describe("addonSummary — three honest states, never over-claimed", () => {
  const target = growth({ id: B, title: "Stem Pack", priceCents: 3000 });
  it("no designation says so", () => {
    const s = addonSummary([growth(), target], growth());
    expect(s).toMatchObject({ designated: false, live: false });
  });
  it("attached but not live names the target and the hidden state", () => {
    const main = growth({ bumpConfig: { bumpProductId: B, percentOff: 0 }, bump: null });
    const s = addonSummary([main, target], main);
    expect(s.designated).toBe(true);
    expect(s.live).toBe(false);
    expect(s.line).toContain("Stem Pack");
    expect(s.line).toContain("not offered right now");
  });
  it("a live offer names the add-on and its % off", () => {
    const main = growth({
      bumpConfig: { bumpProductId: B, percentOff: 10 },
      bump: { productId: B, title: "Stem Pack", priceCents: 2700, percentOff: 10 },
    });
    const s = addonSummary([main, target], main);
    expect(s).toMatchObject({ designated: true, live: true, targetTitle: "Stem Pack" });
    expect(s.line).toContain("10% off");
  });
});

/* ─── Source pins ───────────────────────────────────────────────── */

const deskSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/native/StoreGrowthDesk.tsx", import.meta.url)),
  "utf8",
);
const standsSrc = readFileSync(
  fileURLToPath(new URL("../../components/world/native/ShopStands.tsx", import.meta.url)),
  "utf8",
);

describe("source pins — the desk rides the storefront rails, in-World only", () => {
  it("the seller's store is read the dashboard's way", () => {
    expect(deskSrc).toContain('fetch("/api/storefront/money-checklist"');
    expect(deskSrc).toContain("/api/storefront/products?slug=");
  });
  it("lead magnets ride POST + PATCH on the products rail", () => {
    expect(deskSrc).toContain('fetch("/api/storefront/products"');
    expect(deskSrc).toContain("fetch(`/api/storefront/products/${p.id}`");
    expect(deskSrc).toContain('method: "PATCH"');
    expect(deskSrc).toContain('method: "POST"');
  });
  it("bumps and the upsell designation ride the one PUT bump rail", () => {
    expect(deskSrc).toContain("fetch(`/api/storefront/products/${p.id}/bump`");
    expect(deskSrc).toContain('method: "PUT"');
  });
  it("all three sections render with their testids and tabs", () => {
    for (const id of [
      "world-store-growth",
      "world-store-growth-tab-lead",
      "world-store-growth-tab-bumps",
      "world-store-growth-tab-upsell",
      "world-store-growth-lead",
      "world-store-growth-lead-row",
      "world-store-growth-lead-create-submit",
    ]) {
      expect(deskSrc).toContain(`data-testid="${id}"`);
    }
    /* The AddonSection testids ride the mode-templated expressions. */
    expect(deskSrc).toContain('mode === "bump" ? "world-store-growth-bumps" : "world-store-growth-upsell"');
    expect(deskSrc).toContain('mode === "bump" ? "world-store-growth-bump-row" : "world-store-growth-upsell-row"');
    expect(deskSrc).toContain('mode === "bump" ? "world-store-growth-bump-save" : "world-store-growth-upsell-save"');
    expect(deskSrc).toContain('mode === "bump" ? "world-store-growth-bump-edit" : "world-store-growth-upsell-edit"');
  });
  it("the desk exits NOWHERE — no tab, no dashboard link, no page pull-up", () => {
    expect(deskSrc).not.toContain("window.open");
    expect(deskSrc).not.toContain("/store/dashboard");
    expect(deskSrc).not.toContain("href=");
  });
  it("ShopStands composes the desk at the Marketplace stand, members only", () => {
    expect(standsSrc).toContain('import { StoreGrowthDesk } from "./StoreGrowthDesk";');
    expect(standsSrc).toContain("{!isGuest && <StoreGrowthDesk isLight={isLight} isGuest={isGuest} />}");
  });
  it("the upsell section states the shared-designation truth in its copy", () => {
    expect(deskSrc).toContain("rides the SAME add-on designation");
  });
});
