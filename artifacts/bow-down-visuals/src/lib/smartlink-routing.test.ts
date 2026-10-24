/**
 * Smartlink territory / language routing — editor helpers.
 *
 * Pins: the form's shape discipline mirrors the server's cleaners —
 * lowercase/regional codes normalize, bent codes and non-http(s) URLs
 * produce an error and no map, blank rows are ignored, an empty URL
 * keeps the code present-but-empty (the server reads that as removal),
 * and map → rows is sorted for a stable editor.
 */
import { describe, it, expect } from "vitest";
import {
  destinationMapFromRows,
  destinationRows,
  isDestinationUrl,
  normalizeCountryCode,
  normalizeLanguageCode,
} from "./smartlink-routing";

describe("routing code shapes", () => {
  it("normalizes country codes and refuses bent ones", () => {
    expect(normalizeCountryCode("de")).toBe("DE");
    expect(normalizeCountryCode(" JP ")).toBe("JP");
    expect(normalizeCountryCode("XX")).toBeNull();
    expect(normalizeCountryCode("USA")).toBeNull();
    expect(normalizeCountryCode("D1")).toBeNull();
  });

  it("normalizes language codes to the primary subtag", () => {
    expect(normalizeLanguageCode("es")).toBe("es");
    expect(normalizeLanguageCode("ES-MX")).toBe("es");
    expect(normalizeLanguageCode("en_US")).toBe("en");
    expect(normalizeLanguageCode("e")).toBeNull();
    expect(normalizeLanguageCode("e1")).toBeNull();
  });

  it("destination URLs must be full http(s)", () => {
    expect(isDestinationUrl("https://music.example.com/x")).toBe(true);
    expect(isDestinationUrl("http://example.com")).toBe(true);
    expect(isDestinationUrl("example.com/x")).toBe(false);
    expect(isDestinationUrl("ftp://example.com/x")).toBe(false);
    expect(isDestinationUrl("javascript:alert(1)")).toBe(false);
    expect(isDestinationUrl("https://")).toBe(false);
    expect(isDestinationUrl("")).toBe(false);
  });
});

describe("destination rows <-> map", () => {
  it("rows are sorted by code for a stable editor", () => {
    expect(destinationRows({ JP: "https://j.example", DE: "https://d.example" })).toEqual([
      { code: "DE", url: "https://d.example" },
      { code: "JP", url: "https://j.example" },
    ]);
    expect(destinationRows(null)).toEqual([]);
    expect(destinationRows(undefined)).toEqual([]);
  });

  it("builds a normalized map and skips blank rows", () => {
    const res = destinationMapFromRows([
      { code: "de", url: " https://d.example " },
      { code: "", url: "" },
      { code: " ", url: " " },
    ], "territory");
    expect(res).toEqual({ ok: true, value: { DE: "https://d.example" } });
  });

  it("language rows collapse regional codes to the primary subtag", () => {
    expect(destinationMapFromRows([{ code: "es-MX", url: "https://e.example" }], "language"))
      .toEqual({ ok: true, value: { es: "https://e.example" } });
  });

  it("a bent code or URL refuses the whole save with an error", () => {
    const badCode = destinationMapFromRows([{ code: "USA", url: "https://d.example" }], "territory");
    expect(badCode.ok).toBe(false);
    const badUrl = destinationMapFromRows([{ code: "DE", url: "notaurl" }], "territory");
    expect(badUrl.ok).toBe(false);
    const badLang = destinationMapFromRows([{ code: "e", url: "https://e.example" }], "language");
    expect(badLang.ok).toBe(false);
  });

  it("conflicting duplicate codes refuse; identical duplicates collapse", () => {
    const conflict = destinationMapFromRows([
      { code: "DE", url: "https://a.example" },
      { code: "de", url: "https://b.example" },
    ], "territory");
    expect(conflict.ok).toBe(false);
    const same = destinationMapFromRows([
      { code: "DE", url: "https://a.example" },
      { code: "de", url: "https://a.example" },
    ], "territory");
    expect(same).toEqual({ ok: true, value: { DE: "https://a.example" } });
  });

  it("an empty URL row keeps the code as an explicit removal marker", () => {
    expect(destinationMapFromRows([{ code: "DE", url: "" }], "territory"))
      .toEqual({ ok: true, value: { DE: "" } });
  });
});
