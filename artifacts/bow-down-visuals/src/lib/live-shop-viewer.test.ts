/**
 * live-shop-viewer — the viewer-side Live Shopping seam
 * (components/live/LiveShopPanel on the watch page).
 *
 * Pins the money-truth derivations:
 * - the read normalizer keeps server prices verbatim and drops
 *   malformed rows instead of inventing them;
 * - the panel mode is decided from server truth: the seller NEVER
 *   gets a buy control (manage), a non-live broadcast or session
 *   NEVER gets one either (ended), a guest meets sign-in at the buy
 *   moment, and only a signed-in viewer of a live shop buys;
 * - the Q150 verify outcomes: success is the only "confirmed"; a
 *   409 STREAM_NOT_LIVE with refunded:true says the payment was
 *   refunded in full — never a completed purchase.
 */
import { describe, expect, it } from "vitest";
import {
  LIVE_STREAM_SHOP_PATH,
  normalizeLiveStreamShop,
  otherShopProducts,
  liveShopPanelMode,
  liveShopCheckoutOutcome,
  liveShopVerifyOutcome,
  liveShopVerifyIsTerminal,
} from "./live-shop-viewer";

const product = (id: string, priceCents = 1000) => ({
  id,
  name: `Product ${id}`,
  price_cents: priceCents,
  price: `$${(priceCents / 100).toFixed(2)}`,
  image_url: null,
  external_url: null,
  description: null,
  is_active: true,
});

const shopPayload = (overrides: Record<string, unknown> = {}) => ({
  shop: {
    session: { id: "sess-1", title: "Drop night", status: "live", pinned_product_id: "p1" },
    pinned_product: product("p1", 2500),
    products: [product("p1", 2500), product("p2", 1000)],
    seller: { profile_id: "prof-1", slug: "seller", display_name: "Seller" },
    viewer_is_seller: false,
    fee_bps: 500,
    testMode: true,
    ...overrides,
  },
});

describe("normalizeLiveStreamShop", () => {
  it("carries the server's prices and the session verbatim", () => {
    const shop = normalizeLiveStreamShop(shopPayload());
    expect(shop).not.toBeNull();
    expect(shop!.session).toEqual({
      id: "sess-1",
      title: "Drop night",
      status: "live",
      pinnedProductId: "p1",
    });
    expect(shop!.pinnedProduct?.price).toBe("$25.00");
    expect(shop!.pinnedProduct?.priceCents).toBe(2500);
    expect(shop!.products).toHaveLength(2);
    expect(shop!.feeBps).toBe(500);
    expect(shop!.testMode).toBe(true);
    expect(shop!.viewerIsSeller).toBe(false);
  });

  it("no shop (or a malformed payload) normalizes to null — nothing is attached", () => {
    expect(normalizeLiveStreamShop({ shop: null })).toBeNull();
    expect(normalizeLiveStreamShop(null)).toBeNull();
    expect(normalizeLiveStreamShop({})).toBeNull();
    expect(normalizeLiveStreamShop({ shop: { session: null } })).toBeNull();
    expect(normalizeLiveStreamShop({ shop: { session: { title: "no id" } } })).toBeNull();
  });

  it("drops malformed product rows and keeps the session truth", () => {
    const shop = normalizeLiveStreamShop(
      shopPayload({ products: [product("p1", 2500), { name: "no id" }, null, "junk"], pinned_product: null }),
    );
    expect(shop).not.toBeNull();
    expect(shop!.products.map((p) => p.id)).toEqual(["p1"]);
    expect(shop!.pinnedProduct).toBeNull();
  });

  it("formats a price from price_cents when the server string is absent", () => {
    const bare = product("p9", 999) as Record<string, unknown>;
    delete bare["price"];
    const shop = normalizeLiveStreamShop(shopPayload({ products: [bare], pinned_product: bare }));
    expect(shop!.pinnedProduct?.price).toBe("$9.99");
  });
});

describe("otherShopProducts", () => {
  it("excludes the pinned product from the rest of the catalog", () => {
    const shop = normalizeLiveStreamShop(shopPayload())!;
    expect(otherShopProducts(shop).map((p) => p.id)).toEqual(["p2"]);
  });
  it("returns everything when nothing is pinned", () => {
    const shop = normalizeLiveStreamShop(shopPayload({ pinned_product: null }))!;
    expect(otherShopProducts(shop).map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

describe("liveShopPanelMode — who may buy", () => {
  const live = normalizeLiveStreamShop(shopPayload())!;
  const seller = normalizeLiveStreamShop(shopPayload({ viewer_is_seller: true }))!;
  const endedSession = normalizeLiveStreamShop(
    shopPayload({
      session: { id: "sess-1", title: "Drop night", status: "ended", pinned_product_id: "p1" },
    }),
  )!;

  it("the seller watching their own stream manages — never buys", () => {
    expect(liveShopPanelMode(seller, { broadcastLive: true, signedIn: true })).toBe("manage");
    expect(liveShopPanelMode(seller, { broadcastLive: false, signedIn: true })).toBe("manage");
  });

  it("an ended broadcast offers nothing, even with a live session behind it", () => {
    expect(liveShopPanelMode(live, { broadcastLive: false, signedIn: true })).toBe("ended");
  });

  it("an ended selling session offers nothing, even on a live broadcast", () => {
    expect(liveShopPanelMode(endedSession, { broadcastLive: true, signedIn: true })).toBe("ended");
  });

  it("a signed-out viewer of a live shop browses and meets sign-in at the buy moment", () => {
    expect(liveShopPanelMode(live, { broadcastLive: true, signedIn: false })).toBe("signin");
  });

  it("a signed-in viewer of a live shop buys", () => {
    expect(liveShopPanelMode(live, { broadcastLive: true, signedIn: true })).toBe("buy");
  });
});

describe("liveShopCheckoutOutcome", () => {
  it("an embedded answer mounts the payment form and keeps the session id", () => {
    const out = liveShopCheckoutOutcome(true, 200, { clientSecret: "cs_1", sessionId: "sess_1" }, "fb");
    expect(out).toEqual({ kind: "embedded", clientSecret: "cs_1", sessionId: "sess_1" });
  });

  it("a hosted answer opens the payment page", () => {
    const out = liveShopCheckoutOutcome(true, 200, { url: "https://checkout.example/x", sessionId: "s2" }, "fb");
    expect(out.kind).toBe("hosted");
  });

  it("a 409 STREAM_NOT_LIVE is its own branch with the rail's words — never a generic failure", () => {
    const out = liveShopCheckoutOutcome(
      false,
      409,
      { code: "STREAM_NOT_LIVE", error: "This stream has ended — purchases are closed." },
      "fb",
    );
    expect(out).toEqual({ kind: "stream-ended", message: "This stream has ended — purchases are closed." });
  });

  it("the self-buy refusal surfaces the rail's words", () => {
    const out = liveShopCheckoutOutcome(false, 400, { error: "You can't buy your own product." }, "fb");
    expect(out).toEqual({ kind: "failed", message: "You can't buy your own product." });
  });

  it("a 200 with neither secret nor url fails honestly instead of pretending", () => {
    const out = liveShopCheckoutOutcome(true, 200, {}, "Checkout failed.");
    expect(out).toEqual({ kind: "failed", message: "Checkout failed." });
  });
});

describe("liveShopVerifyOutcome — Q150 money truth", () => {
  it("success is the only confirmed outcome (including the duplicate answer)", () => {
    expect(liveShopVerifyOutcome(true, 200, { success: true }).kind).toBe("confirmed");
    expect(liveShopVerifyOutcome(true, 200, { success: true, duplicate: true }).kind).toBe("confirmed");
  });

  it("a paid session whose stream ended is REFUNDED — and says so, never 'complete'", () => {
    const out = liveShopVerifyOutcome(false, 409, {
      code: "STREAM_NOT_LIVE",
      refunded: true,
      error: "This stream has ended — purchases are closed.",
    });
    expect(out.kind).toBe("refunded");
    expect(out.kind === "refunded" && out.message).toContain("refunded in full");
  });

  it("a stream-ended refusal without the refund flag still never claims a purchase", () => {
    const out = liveShopVerifyOutcome(false, 409, { code: "STREAM_NOT_LIVE", refunded: false });
    expect(out.kind).toBe("refunded");
    expect(out.kind === "refunded" && out.message).not.toContain("purchase is complete");
  });

  it("an unfinished checkout stays pending — the marker survives for the next focus", () => {
    const out = liveShopVerifyOutcome(false, 400, { error: "Payment has not been completed." });
    expect(out.kind).toBe("pending");
    expect(liveShopVerifyIsTerminal(out)).toBe(false);
  });

  it("a deleted-product refusal surfaces the server's refund copy as refused", () => {
    const out = liveShopVerifyOutcome(false, 400, {
      error: "The product for this purchase no longer exists — your payment has been refunded in full.",
      refunded: true,
    });
    expect(out.kind).toBe("refused");
    expect(liveShopVerifyIsTerminal(out)).toBe(true);
  });

  it("terminal outcomes clear the marker; pending keeps it", () => {
    expect(liveShopVerifyIsTerminal(liveShopVerifyOutcome(true, 200, { success: true }))).toBe(true);
    expect(
      liveShopVerifyIsTerminal(liveShopVerifyOutcome(false, 409, { code: "STREAM_NOT_LIVE", refunded: true })),
    ).toBe(true);
    expect(liveShopVerifyIsTerminal(liveShopVerifyOutcome(false, 500, { error: "boom" }))).toBe(false);
  });
});

describe("the read path", () => {
  it("is keyed to the broadcast stream the viewer is watching", () => {
    expect(LIVE_STREAM_SHOP_PATH("abc-123")).toBe("/api/live-streams/abc-123/shop");
  });
});
