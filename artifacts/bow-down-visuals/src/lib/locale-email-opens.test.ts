/**
 * locale-email-opens.test.ts — Stack-30 Lane E (E5).
 *
 * Lane D (D2) corrected the Email List opens card in English: opens
 * are NOT tracked anywhere in the system (no pixel endpoint, no
 * provider webhook), so the card renders a "Not tracked" state —
 * en keys email-list.opens_not_tracked ("Not tracked") and
 * email-list.opens_not_tracked_note ("open tracking isn't wired up
 * yet — no fake numbers") — instead of a fabricated 0 footnoted
 * "best-effort pixel tracking". Lane D's own commit notes the other 9
 * catalogs still needed the corrected strings; without them, non-
 * English users would fall back to English for the honest state (and
 * any surface still rendering the old footnote keeps claiming
 * tracking that doesn't exist in their language). These translations
 * close that gap, in the same key positions Lane D used in en.
 *
 * Note: this branch predates Lane D's merge, so en.json here does not
 * carry the keys yet — the assertions pin the 9 catalogs to the
 * corrected contract (both keys present, honest copy, no pixel claim)
 * so the merged tree is consistent the moment D lands.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const NON_EN = ["es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

/* "pixel" spelled in each catalog's script — the corrected copy must
   never claim pixel tracking exists. */
const PIXEL_WORDS: Record<string, RegExp> = {
  es: /píxel|pixel/i,
  fr: /pixel/i,
  de: /pixel/i,
  it: /pixel/i,
  pt: /pixel/i,
  ar: /بكسل/,
  hi: /पिक्सेल/,
  ja: /ピクセル/,
  ko: /픽셀/,
};

function emailList(locale: string): Record<string, string> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  const catalog = JSON.parse(raw) as { "email-list"?: Record<string, string> };
  if (!catalog["email-list"]) throw new Error(`${locale}.json is missing the email-list section`);
  return catalog["email-list"];
}

describe("email-list opens card — the corrected not-tracked strings in every catalog", () => {
  it.each(NON_EN)("%s carries opens_not_tracked + opens_not_tracked_note", (locale) => {
    const el = emailList(locale);
    expect(el["opens_not_tracked"]?.trim().length).toBeGreaterThan(0);
    expect(el["opens_not_tracked_note"]?.trim().length).toBeGreaterThan(0);
    // Not an English copy-paste of Lane D's strings.
    expect(el["opens_not_tracked"]).not.toBe("Not tracked");
    expect(el["opens_not_tracked_note"]).not.toBe("open tracking isn't wired up yet — no fake numbers");
  });

  it.each(NON_EN)("%s corrected copy never claims pixel tracking", (locale) => {
    const el = emailList(locale);
    expect(el["opens_not_tracked"]).not.toMatch(PIXEL_WORDS[locale]!);
    expect(el["opens_not_tracked_note"]).not.toMatch(PIXEL_WORDS[locale]!);
  });
});
