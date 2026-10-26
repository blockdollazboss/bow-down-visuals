import { describe, expect, it } from "vitest";
import {
  FORM_CARD_CLEARANCE_PX,
  collectFormCardRects,
  inflateRect,
  isClearOfProtectedRects,
  pickSafeSnapPoint,
  rectAroundCenter,
  rectsIntersect,
  type RectLike,
} from "./floating-safe-zone";

/* The Oct 25 owner screenshot: the Mystery Crate cube (64×64 button,
   center ≈ viewport point (1858, 918) on a 1980×1258 screen) sat on the
   Report-a-fix card's bottom-right corner, over its submit row. These
   tests pin the geometry that keeps the cluster off form cards. */

const WIDGET = { width: 64, height: 64 };
const REPORT_CARD: RectLike = { left: 995, top: 480, right: 1901, bottom: 1167 };
const SCREENSHOT_SPOT = { x: 1858, y: 918 };

describe("rectsIntersect", () => {
  it("detects overlap and ignores mere edge contact", () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(rectsIntersect(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true);
    expect(rectsIntersect(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
    expect(rectsIntersect(a, { left: 20, top: 20, right: 30, bottom: 30 })).toBe(false);
  });
});

describe("isClearOfProtectedRects", () => {
  it("flags the screenshot position as intruding on the form card", () => {
    expect(isClearOfProtectedRects(SCREENSHOT_SPOT, WIDGET, [REPORT_CARD])).toBe(false);
  });

  it("accepts a position fully outside the card plus clearance", () => {
    const clear = { x: REPORT_CARD.right + FORM_CARD_CLEARANCE_PX + WIDGET.width, y: 918 };
    expect(isClearOfProtectedRects(clear, WIDGET, [REPORT_CARD])).toBe(true);
  });

  it("is clear when there are no protected rects", () => {
    expect(isClearOfProtectedRects(SCREENSHOT_SPOT, WIDGET, [])).toBe(true);
  });
});

describe("pickSafeSnapPoint", () => {
  const grid = [
    { x: 1858, y: 918 }, // the offending bottom-right cell
    { x: 1858, y: 100 }, // top-right cell — clear of the card
    { x: 120, y: 918 }, // bottom-left cell — clear of the card
  ];

  it("skips the intruding snap point for the nearest clear one", () => {
    const picked = pickSafeSnapPoint(grid, SCREENSHOT_SPOT, WIDGET, [REPORT_CARD]);
    expect(picked).not.toEqual(SCREENSHOT_SPOT);
    expect(isClearOfProtectedRects(picked, WIDGET, [REPORT_CARD])).toBe(true);
  });

  it("falls back to the nearest point when every candidate intrudes", () => {
    const wall: RectLike = { left: 0, top: 0, right: 4000, bottom: 4000 };
    expect(pickSafeSnapPoint(grid, SCREENSHOT_SPOT, WIDGET, [wall])).toEqual(SCREENSHOT_SPOT);
  });

  it("keeps the nearest point when nothing is protected", () => {
    expect(pickSafeSnapPoint(grid, SCREENSHOT_SPOT, WIDGET, [])).toEqual(SCREENSHOT_SPOT);
  });
});

describe("rectAroundCenter / inflateRect", () => {
  it("centers the rect and inflates symmetrically", () => {
    expect(rectAroundCenter({ x: 100, y: 100 }, 64, 64)).toEqual({
      left: 68,
      top: 68,
      right: 132,
      bottom: 132,
    });
    expect(inflateRect({ left: 10, top: 10, right: 20, bottom: 20 }, 5)).toEqual({
      left: 5,
      top: 5,
      right: 25,
      bottom: 25,
    });
  });
});

describe("collectFormCardRects", () => {
  it("returns no rects without a document", () => {
    expect(collectFormCardRects(undefined)).toEqual([]);
  });
});
