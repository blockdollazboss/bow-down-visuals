/**
 * Buyer-facing shop splits never carry co-seller account ids
 * (stack1000 R1, public-surface truth).
 *
 * shop_products.splits is [{ userId, sharePct }] — the co-sellers'
 * account ids and their shares. Both PUBLIC storefront reads
 * (GET /shops/handle/:handle and GET /storefronts/slug/:slug) selected
 * the column and spread it verbatim into the guest payload, breaking
 * the shops file's own rule ("never leaks user_id") for every
 * co-seller on a product. The buyer fact is the split itself — the
 * shop page renders only "sold by N sellers together" from the
 * length — so buyerSplits keeps the shares and drops the ids.
 * Owner reads keep the full list via presentShopProductRow.
 */
import { describe, expect, it } from "vitest";
import { buyerSplits } from "../generate/shops";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";

describe("buyerSplits — the public shape of a product split", () => {
  it("keeps the shares, drops every account id", () => {
    const out = buyerSplits([
      { userId: OWNER, sharePct: 60 },
      { userId: PARTNER, sharePct: 40 },
    ]);
    expect(out).toEqual([{ sharePct: 60 }, { sharePct: 40 }]);
    expect(JSON.stringify(out)).not.toContain(OWNER);
    expect(JSON.stringify(out)).not.toContain(PARTNER);
    // The shop page's one read of the field still works.
    expect(out!.length).toBe(2);
  });

  it("no splits in, null out (the page renders no shared line)", () => {
    expect(buyerSplits(null)).toBeNull();
    expect(buyerSplits(undefined)).toBeNull();
    expect(buyerSplits([])).toBeNull();
  });

  it("a malformed stored value degrades to null, never a partial leak", () => {
    expect(buyerSplits([{ userId: "not-a-uuid", sharePct: 50 }])).toBeNull();
    expect(buyerSplits("junk")).toBeNull();
  });
});
