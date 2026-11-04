/**
 * AdminDesk family i18n pins (stack100 locale unit 36).
 *
 * The World's Admin desk family — AdminDesk, AdminOpsDesk,
 * AdminProgramDesk and the shared AdminBenchBits — rendered
 * hard-coded English inside a 10-locale product: not one of the
 * four files called useTranslation. Their own copy now lives in
 * the locale catalogs under worldAdminDesk.*. These pins hold
 * both halves:
 *
 *  - extraction: the family renders through useTranslation, and
 *    every catalog key in the namespace is actually referenced by
 *    one of the four files (no orphan keys, no unextracted
 *    remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set, so
 *    a bench can never silently fall back to one language again.
 *
 * Deliberately NOT translated (documented decisions, this unit):
 *  - the five money lines — reversalsConfirmComplete,
 *    usersGrantedTo, usersGrantedSelf, challengesPaidLine,
 *    grantsSettledPaid — state a specific charge, payout or
 *    granted amount, so they carry the English source in EVERY
 *    catalog pending human translation (money copy is never
 *    agent-drafted; the GiftCardsDesk law). Figures inside them
 *    still arrive by interpolation.
 *  - rail status / enum tokens render verbatim as rail
 *    identifiers: StatusPill values, the {{status}} / {{decision}}
 *    / {{phase}} / {{outcome}} interpolations inside translated
 *    prose, filter and lifecycle option values, remix status
 *    targets, split roles and the removal-reason options. The
 *    composed "moderation: {{status}}" and "proof: {{status}}"
 *    prefixes ARE extracted; the token itself is the rail's word.
 *  - the seam's ADMIN_NOT_AUTHORIZED_MESSAGE ("Not authorized.")
 *    is the rail's verbatim refusal sentence — it stays in
 *    lib/world/admin-desk.ts, pinned by admin-desk.test.ts, the
 *    same words as en's admin.notAuthorized. Rail words ride
 *    verbatim outside the catalog (the GiftCardsDesk rule).
 *  - two internal diagnostics stay literal: the "lookup shape"
 *    throw in AdminOpsDesk and apiErrorMessage's "Request failed"
 *    fallbacks — machine-facing strings on malformed-rail paths.
 *
 * TRANSLATION STATUS: en is final (the family's original wording,
 * verbatim). The other nine catalogs' values are AGENT-DRAFTED
 * and UNREVIEWED (standing stack600 practice), except the five
 * money lines above, which are English in every catalog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const COMPONENTS = [
  "../../components/world/native/AdminDesk.tsx",
  "../../components/world/native/AdminOpsDesk.tsx",
  "../../components/world/native/AdminProgramDesk.tsx",
  "../../components/world/native/AdminBenchBits.tsx",
];
const family = COMPONENTS.map(read).join("\n");
const en = readJson("../../locales/en.json");
const enKeys = Object.keys(en.worldAdminDesk ?? {}).sort();

const MONEY_KEYS = [
  "reversalsConfirmComplete",
  "usersGrantedTo",
  "usersGrantedSelf",
  "challengesPaidLine",
  "grantsSettledPaid",
];

const tokensOf = (value: string) =>
  [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe("AdminDesk family extraction (unit 36)", () => {
  it("every family file renders through useTranslation", () => {
    for (const rel of COMPONENTS) {
      const src = read(rel);
      expect(src, rel).toContain('from "react-i18next"');
      expect(src, rel).toContain("useTranslation(");
    }
    expect(family).toContain('title={t("worldAdminDesk.deskTitle")}');
    expect(family).not.toContain('title="Admin Benches"');
  });

  it("every extracted key is referenced by the family (no orphans, no remainder)", () => {
    expect(enKeys.length).toBe(395);
    for (const key of enKeys) {
      expect(family, `worldAdminDesk.${key}`).toContain(`worldAdminDesk.${key}`);
    }
  });

  it("dates and locale-sensitive numbers format in the walker's language", () => {
    expect(family).toContain("toLocaleString(i18n.language)");
    expect(family).not.toContain("toLocaleString()");
  });

  it("the jewelry seam composes a caller-supplied engraving label, defaulting to the rail's word", () => {
    const seam = read("./admin-desk.ts");
    expect(seam).toContain('engravingLabel = "Engraving"');
    expect(seam).toContain("${engravingLabel}: ${engraving}");
    expect(family).toContain('t("worldAdminDesk.ordersEngraving")');
  });

  it("en copy is the family's original wording, verbatim", () => {
    expect(en.worldAdminDesk.deskTitle).toBe("Admin Benches");
    expect(en.worldAdminDesk.reversalsTitle).toBe("Payment Reversals");
    expect(en.worldAdminDesk.usersTitle).toBe("Users, Grants & Plans");
    expect(en.worldAdminDesk.challengesTitle).toBe("Challenges");
    expect(en.worldAdminDesk.dropsBudgetLine).toBe(
      "Drops ride the palace's weekly spectacle budget: {{budget}} Visual Bucs a week across every drop, {{minAmount}}–{{maxAmount}} Bucs a claim, {{minClaims}}–{{maxClaims}} claims a drop. Booking is the house's own job — the rail refuses anyone else.",
    );
    expect(en.worldAdminDesk.prizeErrAmountRange).toBe(
      "Prize amounts run from 100 to 10,000,000 Visual Bucs.",
    );
  });
});

describe("AdminDesk family catalog parity (unit 36)", () => {
  it("all 10 locales carry exactly the extracted key set", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(Object.keys(cat.worldAdminDesk ?? {}).sort(), loc).toEqual(enKeys);
    }
  });

  it("no locale's value is empty or an untranslated copy of the key name", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        const value = cat.worldAdminDesk[key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        expect(value.trim().length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(value, `${loc}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolation tokens match en in every locale", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of enKeys) {
        expect(tokensOf(cat.worldAdminDesk[key]), `${loc}.${key}`).toEqual(
          tokensOf(en.worldAdminDesk[key]),
        );
      }
    }
  });

  it("the money lines stay English in every catalog — never agent-drafted", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      for (const key of MONEY_KEYS) {
        expect(cat.worldAdminDesk[key], `${loc}.${key}`).toBe(en.worldAdminDesk[key]);
      }
    }
  });
});
