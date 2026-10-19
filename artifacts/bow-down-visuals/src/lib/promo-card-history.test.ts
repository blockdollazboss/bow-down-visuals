import { describe, it, expect } from "vitest";
import {
  normalizePromoCardHistory,
  removePromoCard,
  promoCardFileName,
  promoCardShareText,
  promoCardDateLabel,
  type PromoCardHistoryItem,
} from "./promo-card-history";

const RAW_CARD = {
  id: "99999999-9999-4999-8999-000000000001",
  style: "out-now",
  size: "9:16",
  url: "https://playable.test/r2://generated-clips/promo-cards/u/job/out-now-9x16.png",
  releaseTitle: "Midnight Gold",
  artistName: "Lil Nova",
  caption: "🔥 OUT NOW 🔥",
  width: 1080,
  height: 1920,
  platforms: ["tiktok", "instagram"],
  createdAt: "2026-01-03T12:00:00.000Z",
};

describe("normalizePromoCardHistory", () => {
  it("shapes a full server page verbatim — fields, bound, hasMore", () => {
    const page = normalizePromoCardHistory({ cards: [RAW_CARD], limit: 50, hasMore: true });
    expect(page.limit).toBe(50);
    expect(page.hasMore).toBe(true);
    expect(page.cards).toHaveLength(1);
    expect(page.cards[0]).toEqual({
      id: RAW_CARD.id,
      style: "out-now",
      size: "9:16",
      url: RAW_CARD.url,
      releaseTitle: "Midnight Gold",
      artistName: "Lil Nova",
      caption: "🔥 OUT NOW 🔥",
      width: 1080,
      height: 1920,
      platforms: ["tiktok", "instagram"],
      createdAt: "2026-01-03T12:00:00.000Z",
    });
  });

  it("drops rows that are not complete recorded cards — no phantom history", () => {
    const page = normalizePromoCardHistory({
      cards: [
        RAW_CARD,
        { ...RAW_CARD, id: "" },
        { ...RAW_CARD, id: "x", url: "" },
        { ...RAW_CARD, id: "y", releaseTitle: "" },
        { style: "out-now" },
        "junk",
        null,
      ],
      limit: 50,
      hasMore: false,
    });
    expect(page.cards.map((c) => c.id)).toEqual([RAW_CARD.id]);
  });

  it("tolerates missing garnish: caption null, platforms filtered to strings, bad numbers zeroed", () => {
    const page = normalizePromoCardHistory({
      cards: [{ ...RAW_CARD, caption: undefined, platforms: ["instagram", 7, null], width: "wide" }],
    });
    expect(page.cards[0]!.caption).toBeNull();
    expect(page.cards[0]!.platforms).toEqual(["instagram"]);
    expect(page.cards[0]!.width).toBe(0);
  });

  it("a malformed payload reads as an empty page, never a crash", () => {
    expect(normalizePromoCardHistory(null)).toEqual({ cards: [], limit: null, hasMore: false });
    expect(normalizePromoCardHistory({})).toEqual({ cards: [], limit: null, hasMore: false });
    expect(normalizePromoCardHistory({ cards: "nope" })).toEqual({ cards: [], limit: null, hasMore: false });
  });
});

describe("removePromoCard", () => {
  const a = { id: "a" } as PromoCardHistoryItem;
  const b = { id: "b" } as PromoCardHistoryItem;

  it("removes exactly the named card and keeps the rest in order", () => {
    expect(removePromoCard([a, b], "a")).toEqual([b]);
    expect(removePromoCard([a, b], "missing")).toEqual([a, b]);
    expect(removePromoCard([], "a")).toEqual([]);
  });
});

describe("card helpers", () => {
  it("file names follow the results grid's habit", () => {
    expect(promoCardFileName({ style: "pre-save", size: "16:9" })).toBe("promo-card-pre-save-16x9.png");
    expect(promoCardFileName({ style: "out-now", size: "1:1" })).toBe("promo-card-out-now-1x1.png");
  });

  it("share text prefers the pack's own caption, else names the release", () => {
    expect(promoCardShareText({ caption: "OUT NOW", releaseTitle: "Gold", artistName: "Nova" })).toBe("OUT NOW");
    expect(promoCardShareText({ caption: "  ", releaseTitle: "Gold", artistName: "Nova" })).toBe("Gold — Nova");
    expect(promoCardShareText({ caption: null, releaseTitle: "Gold", artistName: "" })).toBe("Gold");
  });

  it("date labels come from the server stamp; an unusable stamp labels nothing", () => {
    expect(promoCardDateLabel("2026-01-03T12:00:00.000Z")).toBe("Jan 3, 2026");
    expect(promoCardDateLabel("")).toBe("");
    expect(promoCardDateLabel("not-a-date")).toBe("");
  });
});
