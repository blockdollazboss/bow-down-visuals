/**
 * PlansDesk i18n pins (stack800 lane 3, items 5–6).
 *
 * The World's PlansDesk rendered hard-coded English inside a
 * 10-locale product — it contained no t()/useTranslation calls at
 * all. Its own copy now lives in the locale catalogs under
 * worldPlansDesk.*. These pins hold both halves:
 *
 *  - extraction: the desk renders through useTranslation, and every
 *    catalog key in the namespace is actually referenced by the desk
 *    (no orphan keys, no unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set, so the
 *    desk can never silently fall back to one language again.
 *
 * Deliberately NOT extracted (documented in PlansDesk.tsx): the plan
 * names/taglines/features and the server note ride the rail's DTO
 * verbatim, and the shared money-desks-2 change lines — which state
 * charge amounts — stay English pending human translation (money
 * copy is never agent-drafted).
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs' values
 * are AGENT-DRAFTED and UNREVIEWED (standing stack600 practice).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const desk = read("../../components/world/native/PlansDesk.tsx");
const en = readJson("../../locales/en.json");
const enKeys = Object.keys(en.worldPlansDesk ?? {}).sort();

describe("PlansDesk extraction (item 5)", () => {
  it("the desk renders through useTranslation", () => {
    expect(desk).toContain('import { useTranslation } from "react-i18next"');
    expect(desk).toContain('title={t("worldPlansDesk.title")}');
    expect(desk).not.toContain('title="Your site plan"');
  });

  it("every extracted key is referenced by the desk (no orphans, no remainder)", () => {
    expect(enKeys.length).toBe(40);
    for (const key of enKeys) {
      expect(desk, `worldPlansDesk.${key}`).toContain(`worldPlansDesk.${key}`);
    }
  });

  it("the standing line's raw status token never renders — it goes through the label map", () => {
    expect(desk).toContain("planStatusLabelKey(me.status)");
    expect(desk).not.toMatch(/\(\$\{me\.status\}\)/);
    expect(desk).not.toContain("` (${me.status})`");
  });

  it("the period-end date formats in the walker's language, not hard-coded en-US", () => {
    expect(desk).toContain("toLocaleDateString(i18n.language");
    expect(desk).not.toContain('toLocaleDateString("en-US"');
  });

  it("en copy is the desk's original wording, verbatim", () => {
    expect(en.worldPlansDesk.title).toBe("Your site plan");
    expect(en.worldPlansDesk.confirmPending).toBe(
      "Your payment went through — we're still confirming your plan. It updates here in a moment.",
    );
    expect(en.worldPlansDesk.checkoutNoPage).toBe(
      "Checkout didn't return a payment page — nothing was charged.",
    );
    expect(en.worldPlansDesk.notPurchasable).toBe(
      "This plan's checkout isn't switched on yet — nothing to charge today.",
    );
  });
});

describe("PlansDesk catalog parity (item 6)", () => {
  it("all 10 locales carry exactly the extracted key set", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(Object.keys(cat.worldPlansDesk ?? {}).sort(), loc).toEqual(enKeys);
    }
  });

  it("no locale's value is empty or an untranslated copy of the key name", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        const value = cat.worldPlansDesk[key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        expect(value.trim().length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(value, `${loc}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolations survive in every locale (fee, boosts, names, prices, dates)", () => {
    const withVars: Record<string, string[]> = {
      standingSuffix: ["{{feePct}}", "{{boosts}}"],
      standingStatus: ["{{status}}"],
      standingPeriod: ["{{date}}"],
      feeLine: ["{{feePct}}", "{{boosts}}"],
      switchTo: ["{{name}}", "{{price}}"],
      goPlan: ["{{name}}", "{{price}}"],
      finishUpgrade: ["{{tier}}"],
      switchTitle: ["{{name}}"],
      switchYes: ["{{name}}"],
      confirmSuccess: ["{{tier}}"],
      planChanged: ["{{name}}"],
      checkoutOpenedTab: ["{{name}}"],
    };
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const [key, vars] of Object.entries(withVars)) {
        for (const v of vars) {
          expect(cat.worldPlansDesk[key], `${loc}.${key} missing ${v}`).toContain(v);
        }
      }
    }
  });
});
