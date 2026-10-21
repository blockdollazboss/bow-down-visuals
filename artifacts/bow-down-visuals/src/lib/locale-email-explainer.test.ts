/**
 * locale-email-explainer.test.ts — the "how sending works" explainer,
 * tracked era (migration 0188).
 *
 * History: Stack-30 corrected this explainer in all 10 catalogs when
 * the page falsely claimed pixel open tracking that did not exist.
 * Tracking has now LANDED for real (house pixel + wrapped links on
 * every campaign send, plus the verified provider webhook), so the
 * explainer's closing claim changed again — in every catalog: opens
 * and link clicks ARE tracked, rates shown are recorded engagement,
 * and every email carries a one-click unsubscribe with absolute
 * suppression.
 *
 * Pins that survive from the Stack-30 contract, unchanged: the key
 * exists everywhere; the ESP graduation note survives; and the
 * explainer never uses the word "pixel" in any catalog's script —
 * tracking is disclosed functionally ("opens and link clicks are
 * tracked"), not by mechanism name. The en wording pins below state
 * the new truth exactly.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALL = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

/* "pixel" spelled in each catalog's script — the explainer discloses
   tracking without naming the mechanism, in any language. */
const PIXEL_WORDS: Record<string, RegExp> = {
  en: /pixel/i,
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

function explainer(locale: string): string {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  const catalog = JSON.parse(raw) as { "email-list"?: Record<string, string> };
  const v = catalog["email-list"]?.["campaigns_queue_through_our_simp"];
  if (!v) throw new Error(`${locale}.json is missing email-list.campaigns_queue_through_our_simp`);
  return v;
}

describe("email-list explainer — tracked-era disclosure in every catalog", () => {
  it.each(ALL)("%s carries the explainer, corrected", (locale) => {
    const v = explainer(locale);
    expect(v.trim().length).toBeGreaterThan(0);
    expect(v).not.toMatch(PIXEL_WORDS[locale]!);
    /* The true part of the explainer survives: lists graduate to a
       proper ESP integration past the free tier. */
    expect(v).toMatch(/ESP|ईएसपी/);
  });

  it("en states the tracked truth", () => {
    const v = explainer("en");
    expect(v).toContain("Opens and link clicks are tracked");
    expect(v).toContain("no fake numbers");
    expect(v).toContain("one-click unsubscribe");
    expect(v).not.toContain("isn't wired up yet");
    expect(v).not.toContain("best-effort");
  });
});
