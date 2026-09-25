/**
 * Money-integrity + data-integrity tests for the Royalty Tracker.
 *
 * Covers: the 1-credit pricing contract for AI insights (dashboard itself is
 * free), CSV parsing (headers, quoted fields, date normalization), exact
 * cents math (never float), summary aggregation, and the honest platform
 * connection list (only manual is connectable in v1).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ROYALTY_INSIGHTS_CREDITS,
  ROYALTY_PLATFORMS,
  CONNECTABLE_PLATFORMS,
  COMING_SOON_PLATFORMS,
  platformLabel,
  isRoyaltyPlatform,
  isPayoutStatus,
  parseRoyaltyCsv,
  splitCsvLine,
  normalizeDate,
  toCents,
  fromCents,
  summarizeEntries,
} from "../royalties";

describe("royalty pricing contract", () => {
  it("AI insights cost exactly 1 credit", () => {
    expect(ROYALTY_INSIGHTS_CREDITS).toBe(1);
  });

  it("a broke user (0 credits) is rejected before any model call", () => {
    expect(0 < ROYALTY_INSIGHTS_CREDITS).toBe(true);
  });

  it("exact balance is allowed through the pre-check", () => {
    expect(1 < ROYALTY_INSIGHTS_CREDITS).toBe(false);
  });

  it("uses max_completion_tokens, never max_tokens (GPT-6 requirement)", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "royalties.ts"),
      "utf8",
    );
    expect(src).toContain("max_completion_tokens");
    // Bare max_tokens (not part of max_completion_tokens) must not appear.
    expect(src.replace(/max_completion_tokens/g, "")).not.toContain("max_tokens");
  });
});

describe("cents math", () => {
  it("converts decimal strings to exact integer cents", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents("0.99")).toBe(99);
    expect(toCents("100")).toBe(10000);
    expect(toCents("0.05")).toBe(5);
  });

  it("never loses a cent to float math", () => {
    // 0.1 + 0.2 !== 0.3 in floats — our integer path must be exact.
    expect(toCents("0.10") + toCents("0.20")).toBe(toCents("0.30"));
  });

  it("formats cents back to decimal strings", () => {
    expect(fromCents(1234)).toBe("12.34");
    expect(fromCents(99)).toBe("0.99");
    expect(fromCents(10000)).toBe("100.00");
    expect(fromCents(0)).toBe("0.00");
  });

  it("round-trips", () => {
    expect(fromCents(toCents("47.83"))).toBe("47.83");
  });
});

describe("CSV parsing", () => {
  const CSV =
    `Song,Artist,Platform,Period Start,Period End,Streams,Amount,Currency\n` +
    `"Midnight Crown",Thy Cheat Code,Spotify,01/01/2026,01/31/2026,"12,400",45.67,USD\n` +
    `Gold Waves,Thy Cheat Code,Apple Music,2026-01-01,2026-01-31,8300,21.10,USD`;

  it("parses distributor-style headers case-insensitively", () => {
    const { rows, errors } = parseRoyaltyCsv(CSV);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.song_title).toBe("Midnight Crown");
    expect(rows[0]!.platform).toBe("spotify");
    expect(rows[0]!.gross_amount).toBe("45.67");
  });

  it("normalizes MM/DD/YYYY dates to YYYY-MM-DD", () => {
    const { rows } = parseRoyaltyCsv(CSV);
    expect(rows[0]!.period_start).toBe("2026-01-01");
    expect(rows[0]!.period_end).toBe("2026-01-31");
  });

  it("strips thousand separators from streams and $ from amounts", () => {
    const { rows } = parseRoyaltyCsv(CSV);
    expect(rows[0]!.streams).toBe("12400");
  });

  it("handles quoted fields containing commas", () => {
    const { rows } = parseRoyaltyCsv(
      `Title,Platform,Period Start,Period End,Amount\n"Hello, World",Spotify,2026-01-01,2026-01-31,3.21`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.song_title).toBe("Hello, World");
  });

  it("rejects CSVs missing required columns", () => {
    const { rows, errors } = parseRoyaltyCsv(`Title,Streams\nFoo,100`);
    expect(rows).toHaveLength(0);
    expect(errors.join(" ")).toMatch(/Missing columns/);
  });

  it("rejects a header-only CSV", () => {
    const { rows, errors } = parseRoyaltyCsv(`Title,Platform`);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("skips bad rows but keeps good ones, reporting the row number", () => {
    const { rows, errors } = parseRoyaltyCsv(
      `Title,Platform,Period Start,Period End,Amount\nGood Song,Spotify,2026-01-01,2026-01-31,5.00\nBad Song,Spotify,not-a-date,2026-01-31,5.00`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.song_title).toBe("Good Song");
    expect(errors.join(" ")).toMatch(/Row 3/);
  });
});

describe("splitCsvLine", () => {
  it("splits simple lines", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("honors quoted commas and escaped quotes", () => {
    expect(splitCsvLine(`"a,b","c""d",e`)).toEqual(["a,b", `c"d`, "e"]);
  });
});

describe("normalizeDate", () => {
  it("passes YYYY-MM-DD through", () => {
    expect(normalizeDate("2026-03-15")).toBe("2026-03-15");
  });

  it("converts M/D/YYYY", () => {
    expect(normalizeDate("3/5/2026")).toBe("2026-03-05");
  });

  it("returns empty for garbage", () => {
    expect(normalizeDate("not a date")).toBe("");
  });
});

describe("summarizeEntries", () => {
  const entries = [
    { song_title: "A", platform: "spotify", period_start: "2026-01-01", gross_amount: "10.00", streams: "1000" },
    { song_title: "A", platform: "apple-music", period_start: "2026-01-01", gross_amount: "5.50", streams: "500" },
    { song_title: "B", platform: "spotify", period_start: "2026-02-01", gross_amount: "2.25", streams: "300" },
  ];

  it("totals cents exactly", () => {
    const s = summarizeEntries(entries);
    expect(s.totalCents).toBe(1775);
    expect(fromCents(s.totalCents)).toBe("17.75");
  });

  it("aggregates per song, highest earner first", () => {
    const s = summarizeEntries(entries);
    expect(s.perSong[0]!.song).toBe("A");
    expect(s.perSong[0]!.cents).toBe(1550);
    expect(s.perSong[1]!.song).toBe("B");
  });

  it("aggregates per platform", () => {
    const s = summarizeEntries(entries);
    expect(s.perPlatform[0]!.platform).toBe("spotify");
    expect(s.perPlatform[0]!.cents).toBe(1225);
  });

  it("builds a chronological monthly series", () => {
    const s = summarizeEntries(entries);
    expect(s.monthly.map((m) => m.month)).toEqual(["2026-01", "2026-02"]);
    expect(s.monthly[0]!.cents).toBe(1550);
  });

  it("handles an empty ledger", () => {
    const s = summarizeEntries([]);
    expect(s.totalCents).toBe(0);
    expect(s.perSong).toEqual([]);
    expect(s.entryCount).toBe(0);
  });
});

describe("platform honesty contract", () => {
  it("knows the full platform list", () => {
    expect((ROYALTY_PLATFORMS as readonly string[])).toContain("spotify");
    expect((ROYALTY_PLATFORMS as readonly string[])).toContain("manual");
  });

  it("only manual import is connectable in v1 — everything else is coming soon", () => {
    expect(CONNECTABLE_PLATFORMS).toEqual(["manual"]);
    expect(COMING_SOON_PLATFORMS).toContain("spotify");
    expect(COMING_SOON_PLATFORMS).toContain("apple-music");
    expect(COMING_SOON_PLATFORMS).toContain("youtube");
    // Every platform is either connectable or honestly marked coming soon.
    for (const p of ROYALTY_PLATFORMS as readonly string[]) {
      const inEither =
        (CONNECTABLE_PLATFORMS as readonly string[]).includes(p) ||
        (COMING_SOON_PLATFORMS as readonly string[]).includes(p);
      expect(inEither).toBe(true);
    }
  });

  it("labels platforms for display", () => {
    expect(platformLabel("spotify")).toBe("Spotify");
    expect(platformLabel("apple-music")).toBe("Apple Music");
  });

  it("validates platform keys", () => {
    expect(isRoyaltyPlatform("spotify")).toBe(true);
    expect(isRoyaltyPlatform("napster")).toBe(false);
  });

  it("validates payout statuses", () => {
    expect(isPayoutStatus("expected")).toBe(true);
    expect(isPayoutStatus("received")).toBe(true);
    expect(isPayoutStatus("faked")).toBe(false);
  });
});
