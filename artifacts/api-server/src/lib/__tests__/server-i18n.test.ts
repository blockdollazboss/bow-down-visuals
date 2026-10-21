/**
 * Server locale core (lib/server-i18n) — the primitives every
 * server catalog resolves with. Pins: the ten site locales,
 * base-language normalization, first-resolvable-candidate wins with
 * an English fallback, and single-pass template filling (inserted
 * values are data and are never re-scanned for placeholders).
 */
import { describe, it, expect } from "vitest";
import {
  SERVER_LOCALES,
  normalizeServerLocale,
  resolveServerLocale,
  fillServerTemplate,
} from "../server-i18n";

describe("server locale core", () => {
  it("carries exactly the ten site locales, en first", () => {
    expect([...SERVER_LOCALES]).toEqual([
      "en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko",
    ]);
  });

  it("normalizes base language, case and separators", () => {
    expect(normalizeServerLocale("es")).toBe("es");
    expect(normalizeServerLocale("pt-BR")).toBe("pt");
    expect(normalizeServerLocale("fr_ca")).toBe("fr");
    expect(normalizeServerLocale("EN")).toBe("en");
    expect(normalizeServerLocale(" ja ")).toBe("ja");
  });

  it("unknown and non-string values resolve to null", () => {
    expect(normalizeServerLocale("xx")).toBeNull();
    expect(normalizeServerLocale("")).toBeNull();
    expect(normalizeServerLocale(undefined)).toBeNull();
    expect(normalizeServerLocale(null)).toBeNull();
    expect(normalizeServerLocale(42)).toBeNull();
    expect(normalizeServerLocale({})).toBeNull();
  });

  it("resolve: first resolvable candidate wins; English when none resolve", () => {
    expect(resolveServerLocale("ko", "es")).toBe("ko");
    expect(resolveServerLocale("xx", "de")).toBe("de");
    expect(resolveServerLocale(undefined, null)).toBe("en");
    expect(resolveServerLocale()).toBe("en");
    expect(resolveServerLocale("pt-BR")).toBe("pt");
  });

  it("fill: replaces every placeholder occurrence in a single pass", () => {
    expect(fillServerTemplate("{a} and {a} and {b}", { a: "x", b: "y" })).toBe("x and x and y");
    /* A value that itself looks like a placeholder is data — never re-scanned. */
    expect(fillServerTemplate("{a}", { a: "{b}", b: "y" })).toBe("{b}");
    /* A placeholder with no matching var stays exactly as written. */
    expect(fillServerTemplate("hi {name}", {})).toBe("hi {name}");
    expect(fillServerTemplate("no tokens at all", { a: "x" })).toBe("no tokens at all");
    expect(fillServerTemplate("", { a: "x" })).toBe("");
  });
});
