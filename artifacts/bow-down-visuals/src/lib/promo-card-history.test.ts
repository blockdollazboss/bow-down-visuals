import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  normalizePromoCardHistory,
  removePromoCard,
  promoCardFileName,
  promoCardShareText,
  promoCardSharePayload,
  promoCardScheduleHref,
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
    /* The label renders the stamp on the VIEWER's clock, so the
     * expected date is derived from the stamp's local components —
     * a literal only holds in zones where 12:00Z stays on Jan 3
     * (under UTC+14 it is already Jan 4). */
    const stamp = new Date("2026-01-03T12:00:00.000Z");
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    expect(promoCardDateLabel("2026-01-03T12:00:00.000Z")).toBe(
      `${MONTHS[stamp.getMonth()]} ${stamp.getDate()}, ${stamp.getFullYear()}`,
    );
    expect(promoCardDateLabel("")).toBe("");
    expect(promoCardDateLabel("not-a-date")).toBe("");
  });
});

describe("per-card actions (Ring 4 tail)", () => {
  const card = normalizePromoCardHistory({ cards: [RAW_CARD] }).cards[0]!;

  it("share payload rides the rail as an image with the card's record id", () => {
    expect(promoCardSharePayload(card, "native")).toEqual({
      content_type: "image",
      content_id: RAW_CARD.id,
      channel: "native",
    });
    expect(promoCardSharePayload(card, "copy")).toEqual({
      content_type: "image",
      content_id: RAW_CARD.id,
      channel: "copy",
    });
  });

  it("a card without a record id shares with a null id — never an invented one", () => {
    expect(promoCardSharePayload({ id: null }, "copy").content_id).toBeNull();
    expect(promoCardSharePayload({}, "copy").content_id).toBeNull();
  });

  it("schedule href hands the scheduler the card itself, declared an image", () => {
    const href = promoCardScheduleHref(card);
    expect(href.startsWith("/scheduler?")).toBe(true);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("schedule")).toBe("1");
    expect(q.get("media")).toBe(RAW_CARD.url);
    expect(q.get("mediaType")).toBe("image");
    expect(q.get("caption")).toBe("🔥 OUT NOW 🔥");
    expect(q.get("platform")).toBe("tiktok,instagram");
    /* A promo card records no distribution release — none is claimed. */
    expect(q.get("release")).toBeNull();
  });

  it("schedule caption falls back to the release line when the card carries none", () => {
    const bare = { ...card, caption: null };
    const q = new URLSearchParams(promoCardScheduleHref(bare).split("?")[1]);
    expect(q.get("caption")).toBe("Midnight Gold — Lil Nova");
  });
});

describe("PromoCardsPanel history wiring (source pins)", () => {
  const panel = readFileSync(new URL("../components/hub/PromoCardsPanel.tsx", import.meta.url), "utf8");

  it("history cards get the full action set the fresh grid has", () => {
    expect(panel).toContain("scheduleHistoryCard(card)");
    expect(panel).toContain("promoCardScheduleHref(card)");
    expect(panel).toContain("addHistoryCardToAssets(card)");
    expect(panel).toContain("downloadImage(card.url, promoCardFileName(card))");
  });

  it("both shares ride the rail as images — no 'other' rides remain", () => {
    expect(panel).toContain("promoCardSharePayload(card, channel)");
    expect(panel).not.toContain('content_type: "other"');
  });

  it("the fresh grid's schedule handoff declares the card an image too", () => {
    expect(panel).toContain('mediaType: "image"');
  });
});
