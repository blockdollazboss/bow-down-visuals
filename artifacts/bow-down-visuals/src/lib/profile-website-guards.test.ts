import { describe, it, expect } from "vitest";
import { normalizeFanCollection, normalizeStoreCatalog } from "./profile-website";

/* DTO guard batch #2 — partial collection/catalog payloads must land
   on the surfaces' designed error/empty states, never crash render
   (items.length, fan.displayName, catalog.items.map). */

describe("normalizeFanCollection", () => {
  it("passes a complete collection through", () => {
    const c = normalizeFanCollection({
      fan: { slug: "fan1", displayName: "Fan One", avatarUrl: null, profileUrl: "/artist/fan1" },
      visibility: "public",
      items: [{ kind: "track", itemId: "t1", title: "Song", artworkUrl: null, creatorName: "C", creatorSlug: "c", creatorUrl: "/artist/c", amountCents: 500, purchasedAt: "2026-10-01" }],
    });
    expect(c?.fan.displayName).toBe("Fan One");
    expect(c?.items).toHaveLength(1);
  });
  it("missing items is the designed EMPTY collection, not an error", () => {
    const c = normalizeFanCollection({ fan: { slug: "f", displayName: "F" }, visibility: "public" });
    expect(c?.items).toEqual([]);
  });
  it("missing fan identity is malformed → null (the fetcher throws → error state)", () => {
    expect(normalizeFanCollection({ items: [] })).toBeNull();
    expect(normalizeFanCollection({ fan: { slug: "f" }, items: [] })).toBeNull();
    expect(normalizeFanCollection(null)).toBeNull();
  });
  it("drops purchase rows without a real price or a known kind", () => {
    const c = normalizeFanCollection({
      fan: { slug: "f", displayName: "F" },
      items: [
        { kind: "track", amountCents: "free" },
        { kind: "mystery", amountCents: 100 },
        { kind: "video", amountCents: 900 },
      ],
    });
    expect(c?.items).toHaveLength(1);
    expect(c?.items[0]?.kind).toBe("video");
  });
  it("a private payload stays private", () => {
    const c = normalizeFanCollection({ fan: { slug: "f", displayName: "F" }, visibility: "private", items: [] });
    expect(c?.visibility).toBe("private");
  });
});

describe("normalizeStoreCatalog", () => {
  it("passes a complete catalog through with its counts", () => {
    const cat = normalizeStoreCatalog({
      profile: { slug: "c", displayName: "Creator", profileUrl: "/artist/c" },
      items: [{ kind: "track", productKind: null, id: "1", title: "T", artworkUrl: null, priceCents: 300, price: "$3.00", compareAtCents: null, pwyw: null, buyUrl: "/buy/1" }],
      counts: { tracks: 1, videos: 0, products: 0, total: 1 },
    });
    expect(cat?.items).toHaveLength(1);
    expect(cat?.counts.total).toBe(1);
  });
  it("missing items → empty catalog (owner-empty/hidden states), never a crash", () => {
    const cat = normalizeStoreCatalog({ profile: { slug: "c" } });
    expect(cat?.items).toEqual([]);
    expect(cat?.counts.total).toBe(0);
  });
  it("drops items that could only render as a fake or dead buy button", () => {
    const cat = normalizeStoreCatalog({
      items: [
        { kind: "track", priceCents: "?", buyUrl: "/buy/1" },
        { kind: "track", priceCents: 100, buyUrl: "" },
        { kind: "product", priceCents: 100, buyUrl: "/buy/2" },
      ],
    });
    expect(cat?.items).toHaveLength(1);
    expect(cat?.counts).toEqual({ tracks: 0, videos: 0, products: 1, total: 1 });
  });
  it("non-object payload → null", () => {
    expect(normalizeStoreCatalog("nope")).toBeNull();
    expect(normalizeStoreCatalog(null)).toBeNull();
  });
  it("carries a pinned UGC ad only when it has a playable video URL (0178)", () => {
    const cat = normalizeStoreCatalog({
      items: [
        { kind: "product", productKind: "shop", priceCents: 100, buyUrl: "/shop/x", pinnedAd: { id: "ad-1", videoUrl: "https://signed.example/ad.mp4" } },
        { kind: "product", productKind: "shop", priceCents: 100, buyUrl: "/shop/y", pinnedAd: { id: "ad-2", videoUrl: "" } },
        { kind: "product", productKind: "shop", priceCents: 100, buyUrl: "/shop/z" },
      ],
    });
    expect(cat?.items[0]?.pinnedAd).toEqual({ id: "ad-1", videoUrl: "https://signed.example/ad.mp4" });
    expect(cat?.items[1]?.pinnedAd).toBeNull();
    expect(cat?.items[2]?.pinnedAd).toBeNull();
  });
});
