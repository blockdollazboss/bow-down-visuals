/**
 * failure-copy.test.ts — Stack 300 failure-copy lane (items 71, 74).
 *
 * Item 71: the Books AI assist toasted the RAW server error field as
 * its title — on the 402 the rail's `error` IS the code
 * `out_of_credits`, so a customer saw the code itself. The title now
 * routes through `apiErrorMessage` (the translator every surrounding
 * books.tsx call already used), which renders the code map's plain
 * words ("Not enough Visual Bucs — top up and try again. You weren't
 * charged.") and never a raw code.
 *
 * Item 74: the sponsorship form's three validation strings were
 * hard-coded English on an otherwise-keyed `useTranslation` surface.
 * They are now `sponsors.error*` keys. Per the locale honesty law the
 * values ride English-verbatim in the 9 non-en catalogs (UNREVIEWED —
 * the waves legit-identical allowlists carry them) until real
 * translations land; these pins hold both halves of that contract.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;
const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;
function load(locale: string): Catalog {
  return JSON.parse(
    readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
  ) as Catalog;
}
function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v;
    }
  }
  return out;
}
const CATS = Object.fromEntries(LOCALES.map((l) => [l, flat(load(l))])) as Record<
  string,
  Record<string, unknown>
>;
const EN = CATS.en;
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("S300 · item 71 — Books AI assist failure copy", () => {
  it("the toast title routes through apiErrorMessage, never the raw error field", () => {
    const src = read("../pages/books.tsx");
    expect(src).toContain('apiErrorMessage(data, "AI assist failed")');
    expect(src).not.toContain('data.error ?? "AI assist failed"');
  });
});

describe("S300 · item 74 — sponsorship validation keying", () => {
  const KEYS: Array<[string, string]> = [
    ["sponsors.errorMinAmount", "Sponsorships start at $1."],
    [
      "sponsors.errorBrandNameMissing",
      "Tell the creator who is sponsoring them (your name or brand).",
    ],
    ["sponsors.errorDeliverablesMissing", "Say what this sponsorship covers."],
  ];

  it("the three strings are keyed with the exact English source", () => {
    for (const [key, words] of KEYS) expect(EN[key]).toBe(words);
  });

  it("every catalog carries the keys, English-verbatim UNREVIEWED outside en", () => {
    for (const [key] of KEYS) {
      for (const loc of LOCALES) {
        expect(CATS[loc][key], `${key} must stay English-verbatim in ${loc} (UNREVIEWED)`).toBe(
          EN[key],
        );
      }
    }
  });

  it("the form calls t(...) and none of the hard-coded literals remain", () => {
    const src = read("../components/artist/SponsorCreatorSection.tsx");
    for (const [key] of KEYS) expect(src).toContain(`t("${key}")`);
    expect(src).not.toContain("Sponsorships start at $1.");
    expect(src).not.toContain("Tell the creator who is sponsoring them");
    expect(src).not.toContain("Say what this sponsorship covers.");
  });
});
