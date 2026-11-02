/**
 * GiftCardsDesk i18n pins (stack1200 world-gift-desks).
 *
 * The desk's two new sections (the seller's sold/liability mirror
 * and the buyer refund control) render their own labels through
 * useTranslation under worldGiftCardsDesk.*, following the
 * PlansDesk extraction discipline:
 *
 *  - extraction: every key in the namespace is referenced by the
 *    desk (no orphan keys, no unextracted remainder);
 *  - parity: all 10 locales carry the full extracted key set, so
 *    the sections can never silently fall back to one language.
 *
 * Deliberately NOT translated (the PlansDesk / money-copy law):
 * the money lines — heldLine (when held value becomes a sale),
 * refundArm and refundDoneFallback (both state a refund amount) —
 * carry the English source in EVERY catalog pending human
 * translation; money copy is never agent-drafted. The liability
 * note and every refund outcome ride the rail's own words
 * verbatim and live in no catalog at all.
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs' label
 * values are AGENT-DRAFTED and UNREVIEWED (standing stack600
 * practice).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const MONEY_LINES = ["heldLine", "refundArm", "refundDoneFallback"];
const desk = read("../../components/world/native/GiftCardsDesk.tsx");
const en = readJson("../../locales/en.json");
const enNs = (en.worldGiftCardsDesk ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();

describe("GiftCardsDesk extraction", () => {
  it("the desk renders the new sections through useTranslation", () => {
    expect(desk).toContain('import { useTranslation } from "react-i18next"');
    expect(desk).toContain('t("worldGiftCardsDesk.soldTitle")');
    expect(desk).toContain('t("worldGiftCardsDesk.refundUnspent")');
  });

  it("every extracted key is referenced by the desk (no orphans, no remainder)", () => {
    expect(enKeys.length).toBe(16);
    for (const key of enKeys) {
      expect(desk, `worldGiftCardsDesk.${key}`).toContain(`worldGiftCardsDesk.${key}`);
    }
  });
});

describe("GiftCardsDesk locale parity", () => {
  it("all 10 locales carry the full extracted key set", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(Object.keys(cat.worldGiftCardsDesk ?? {}).sort(), loc).toEqual(enKeys);
    }
  });

  it("the money lines stay English in every catalog — never agent-drafted", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of MONEY_LINES) {
        expect(cat.worldGiftCardsDesk?.[key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
