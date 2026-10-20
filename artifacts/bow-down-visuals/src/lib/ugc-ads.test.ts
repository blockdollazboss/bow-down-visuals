import { describe, it, expect } from "vitest";
import {
  normalizeUgcAd,
  normalizeUgcAds,
  normalizeUgcBrief,
  normalizeUgcBriefs,
  normalizeUgcProducts,
  normalizeScript,
  briefActionsFor,
  briefStatusLabel,
  pinActionFor,
  ugcAdStatusLabel,
  ugcAdShareText,
  UGC_PAYMENT_NOTE,
  type UgcBrief,
} from "./ugc-ads";

const RAW_AD = {
  id: "99999999-9999-4999-8999-000000000001",
  briefId: null,
  productSource: "shop",
  shopProductId: "99999999-9999-4999-8999-0000000000aa",
  productName: "Gold Chain Tee",
  productBlurb: "Heavyweight tee.",
  productPriceCents: 4900,
  productImageUrl: "https://signed.example/products/tee.png",
  style: "honest-review",
  faceImageUrl: "https://r2.test/ugc-personas/u/face.png",
  faceKind: "persona",
  script: { hook: "Okay, I finally tried it.", lines: ["Quality is unreal."], cta: "Link's in my shop." },
  captions: ["Okay, I finally tried it.", "Quality is unreal.", "Link's in my shop."],
  captionsBurned: true,
  brand: { brandName: "Alice Co", logoUrl: null, primaryColor: "#C9A84C", vibe: "luxury" },
  videoUrl: "https://signed.example/ugc-ads/v.mp4",
  status: "ready",
  creditsCharged: 400,
  lastError: null,
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:05:00.000Z",
};

const RAW_BRIEF = {
  id: "99999999-9999-4999-8999-0000000000bb",
  brandUserId: "brand-1",
  productName: "Trail Boots",
  productImageUrl: null,
  productUrl: "https://shop.example/boots",
  details: "Show the boots surviving a rainy festival weekend.",
  style: "problem-fix",
  deadline: "2026-11-01T00:00:00.000Z",
  status: "open",
  claimedByUserId: null,
  deliveredAdId: null,
  paymentNote: UGC_PAYMENT_NOTE,
  createdAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:00:00.000Z",
};

describe("normalizeUgcAd", () => {
  it("shapes a full server ad verbatim", () => {
    const ad = normalizeUgcAd(RAW_AD);
    expect(ad).not.toBeNull();
    expect(ad!.productName).toBe("Gold Chain Tee");
    expect(ad!.videoUrl).toBe("https://signed.example/ugc-ads/v.mp4");
    expect(ad!.captionsBurned).toBe(true);
    expect(ad!.brand?.primaryColor).toBe("#C9A84C");
    expect(ad!.script?.lines).toEqual(["Quality is unreal."]);
  });

  it("drops rows missing id, product, or status — never dresses up a phantom ad", () => {
    expect(normalizeUgcAd({ ...RAW_AD, id: "" })).toBeNull();
    expect(normalizeUgcAd({ ...RAW_AD, productName: "" })).toBeNull();
    expect(normalizeUgcAd({ ...RAW_AD, status: "" })).toBeNull();
    expect(normalizeUgcAd(null)).toBeNull();
    expect(normalizeUgcAd("nope")).toBeNull();
    const list = normalizeUgcAds({ ads: [RAW_AD, { id: "x" }, null] });
    expect(list).toHaveLength(1);
  });

  it("an ad with no video yet reads videoUrl null (not a fake link)", () => {
    const ad = normalizeUgcAd({ ...RAW_AD, videoUrl: null, status: "draft" });
    expect(ad!.videoUrl).toBeNull();
    expect(ad!.status).toBe("draft");
  });
});

describe("normalizeScript", () => {
  it("requires hook, at least one line, and a cta", () => {
    expect(normalizeScript({ hook: "h", lines: ["l"], cta: "c" })).toEqual({ hook: "h", lines: ["l"], cta: "c" });
    expect(normalizeScript({ hook: "", lines: ["l"], cta: "c" })).toBeNull();
    expect(normalizeScript({ hook: "h", lines: [], cta: "c" })).toBeNull();
    expect(normalizeScript({ hook: "h", lines: ["l"] })).toBeNull();
    expect(normalizeScript(null)).toBeNull();
  });
});

describe("normalizeUgcBriefs / products", () => {
  it("shapes the board page with its bound and drops malformed briefs", () => {
    const page = normalizeUgcBriefs({ briefs: [RAW_BRIEF, { id: "x" }], limit: 50, hasMore: true });
    expect(page.briefs).toHaveLength(1);
    expect(page.limit).toBe(50);
    expect(page.hasMore).toBe(true);
    expect(page.briefs[0]!.paymentNote).toBe(UGC_PAYMENT_NOTE);
  });

  it("a brief without a server payment note still carries the plain-language note", () => {
    const brief = normalizeUgcBrief({ ...RAW_BRIEF, paymentNote: "" });
    expect(brief!.paymentNote).toBe(UGC_PAYMENT_NOTE);
    expect(UGC_PAYMENT_NOTE).toContain("arranged between the brand and the creator directly");
  });

  it("products require id + name", () => {
    const products = normalizeUgcProducts({
      products: [
        { id: "p1", name: "Tee", priceCents: 4900, imageUrl: null },
        { id: "", name: "Ghost" },
        { name: "No id" },
      ],
    });
    expect(products).toHaveLength(1);
    expect(products[0]!.priceCents).toBe(4900);
  });

  it("products carry the pinned ad id the server sent (0178)", () => {
    const products = normalizeUgcProducts({
      products: [
        { id: "p1", name: "Tee", priceCents: 4900, imageUrl: null, pinnedAdId: "ad-1" },
        { id: "p2", name: "Cap", priceCents: 100, imageUrl: null },
      ],
    });
    expect(products[0]!.pinnedAdId).toBe("ad-1");
    expect(products[1]!.pinnedAdId).toBeNull();
  });
});

describe("pin state (0178)", () => {
  it("normalizeUgcAd carries pinnedProductId, defaulting to null", () => {
    expect(normalizeUgcAd(RAW_AD)!.pinnedProductId).toBeNull();
    const pinned = normalizeUgcAd({ ...RAW_AD, pinnedProductId: RAW_AD.shopProductId });
    expect(pinned!.pinnedProductId).toBe(RAW_AD.shopProductId);
  });

  it("pinActionFor: only a finished shop-product ad offers an action", () => {
    const ready = normalizeUgcAd(RAW_AD)!;
    expect(pinActionFor(ready)).toBe("pin");
    expect(pinActionFor({ ...ready, pinnedProductId: ready.shopProductId })).toBe("unpin");
    expect(pinActionFor({ ...ready, status: "draft" })).toBeNull();
    expect(pinActionFor({ ...ready, status: "failed" })).toBeNull();
    expect(pinActionFor({ ...ready, shopProductId: null })).toBeNull();
  });
});

describe("briefActionsFor — the board's lifecycle, from the caller's seat", () => {
  const brief = (over: Partial<UgcBrief>): UgcBrief => ({
    ...(normalizeUgcBrief(RAW_BRIEF) as UgcBrief),
    ...over,
  });

  it("an open brief offers claim to everyone but its brand; the brand can close it", () => {
    expect(briefActionsFor(brief({}), "creator-9")).toEqual(["claim"]);
    expect(briefActionsFor(brief({}), "brand-1")).toEqual(["close"]);
    expect(briefActionsFor(brief({}), null)).toEqual([]);
  });

  it("a claimed brief offers release + deliver to the claimer, close to the brand, nothing to others", () => {
    const b = brief({ status: "claimed", claimedByUserId: "creator-9" });
    expect(briefActionsFor(b, "creator-9")).toEqual(["release", "deliver"]);
    expect(briefActionsFor(b, "brand-1")).toEqual(["close"]);
    expect(briefActionsFor(b, "someone-else")).toEqual([]);
  });

  it("a delivered brief offers approve to the brand only; approved/closed offer nothing", () => {
    const d = brief({ status: "delivered", claimedByUserId: "creator-9", deliveredAdId: "ad-1" });
    expect(briefActionsFor(d, "brand-1")).toEqual(["approve"]);
    expect(briefActionsFor(d, "creator-9")).toEqual([]);
    expect(briefActionsFor(brief({ status: "approved" }), "brand-1")).toEqual([]);
    expect(briefActionsFor(brief({ status: "closed" }), "brand-1")).toEqual([]);
  });
});

describe("labels + share text", () => {
  it("status labels are the honest words", () => {
    expect(ugcAdStatusLabel("failed")).toBe("Failed — refunded");
    expect(ugcAdStatusLabel("ready")).toBe("Ready");
    expect(briefStatusLabel("delivered")).toBe("Delivered");
  });

  it("share text leads with the hook and names the product", () => {
    const ad = normalizeUgcAd(RAW_AD)!;
    expect(ugcAdShareText(ad)).toContain("Okay, I finally tried it.");
    expect(ugcAdShareText(ad)).toContain("Gold Chain Tee");
  });
});
