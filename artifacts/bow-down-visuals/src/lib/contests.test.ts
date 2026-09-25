import { describe, it, expect } from "vitest";
import {
  ENTRY_METHOD_CATALOG,
  shortSeed,
  formatDrawnAt,
  statusLabel,
} from "./contests";

describe("ENTRY_METHOD_CATALOG", () => {
  it("mirrors the server's four entry methods", () => {
    expect(ENTRY_METHOD_CATALOG.map((m) => m.key)).toEqual([
      "follow",
      "comment",
      "share",
      "purchase",
    ]);
  });

  it("every method has a label and a blurb", () => {
    for (const m of ENTRY_METHOD_CATALOG) {
      expect(m.label).toBeTruthy();
      expect(m.blurb).toBeTruthy();
    }
  });
});

describe("shortSeed", () => {
  it("shortens a 64-char seed with an ellipsis", () => {
    const seed = "a".repeat(6) + "b".repeat(54) + "c".repeat(4);
    expect(seed).toHaveLength(64);
    expect(shortSeed(seed)).toBe(`aaaaaa…cccc`);
  });

  it("never hides short or missing values", () => {
    expect(shortSeed("abc")).toBe("abc");
    expect(shortSeed("")).toBe("—");
    expect(shortSeed(null)).toBe("—");
    expect(shortSeed(undefined)).toBe("—");
  });
});

describe("formatDrawnAt", () => {
  it("formats a valid ISO timestamp", () => {
    const out = formatDrawnAt("2026-01-15T12:30:00.000Z");
    expect(out).not.toBe("—");
    expect(out).toContain("2026");
  });

  it("falls back gracefully", () => {
    expect(formatDrawnAt("not-a-date")).toBe("not-a-date");
    expect(formatDrawnAt("")).toBe("—");
    expect(formatDrawnAt(null)).toBe("—");
  });
});

describe("statusLabel", () => {
  it("labels known statuses", () => {
    expect(statusLabel("draft")).toBe("Draft");
    expect(statusLabel("active")).toBe("Live");
    expect(statusLabel("ended")).toBe("Ended");
  });

  it("passes unknown statuses through", () => {
    expect(statusLabel("weird")).toBe("weird");
    expect(statusLabel(null)).toBe("—");
  });
});
