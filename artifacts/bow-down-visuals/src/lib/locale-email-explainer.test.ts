/**
 * locale-email-explainer.test.ts — Stack-30 integrator resolution (item 29).
 *
 * Lane D (D2) proved no open-tracking signal exists anywhere — no
 * tracking-pixel endpoint, no provider webhook, nothing ever writes
 * email_subscribers.opens — and corrected the opens CARD to an honest
 * "Not tracked" state. But the Email List page's "how sending works"
 * explainer (email-list.campaigns_queue_through_our_simp) still closed
 * with "Open tracking uses a best-effort pixel and undercounts
 * privacy-conscious inboxes" in en AND all 9 translated catalogs —
 * the same false claim, one surface over. This resolution corrects
 * the sentence everywhere to match the card's treatment: open
 * tracking isn't wired up yet, so no open rates are reported.
 *
 * These assertions pin the contract so the pixel claim cannot creep
 * back into any catalog: the key exists everywhere, the honest en
 * wording is present, no catalog's explainer mentions a pixel in its
 * own script, and the (true) rest of the explainer — the ESP
 * graduation note — survives.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALL = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

/* "pixel" spelled in each catalog's script — the explainer must never
   claim pixel tracking exists, in any language. */
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

describe("email-list explainer — no catalog claims pixel open tracking", () => {
  it.each(ALL)("%s carries the explainer, corrected", (locale) => {
    const v = explainer(locale);
    expect(v.trim().length).toBeGreaterThan(0);
    expect(v).not.toMatch(PIXEL_WORDS[locale]!);
    /* The true part of the explainer survives: lists graduate to a
       proper ESP integration past the free tier. */
    expect(v).toMatch(/ESP|ईएसपी/);
  });

  it("en states the honest position in Lane D's words", () => {
    const v = explainer("en");
    expect(v).toContain("Open tracking isn't wired up yet");
    expect(v).toContain("no fake numbers");
    expect(v).not.toContain("best-effort");
  });
});
