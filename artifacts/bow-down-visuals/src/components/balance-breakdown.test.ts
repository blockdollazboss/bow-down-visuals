/**
 * balance-breakdown.test.ts — Lane V-bucs surface pins.
 *
 * The ruling: temporary Visual Bucs are shown separately, labelled
 * temporary, with how long they last. Pinned here:
 *  (a) the actual rendered English strings (real i18next instance over
 *      the real catalogs) — the history split lines and the dialog's
 *      "includes Y temporary Bucs — expires <date>" sub-line, with
 *      correct day plurals;
 *  (b) the wiring: /credit-history renders the breakdown from the
 *      endpoint's composition (profile-derived fallback), the spend
 *      dialog gains the sub-line only while a temporary part exists,
 *      and the sidebar keeps its single total with the temporary part
 *      named under it;
 *  (c) the locale honesty state: the new keys exist in en only — the
 *      other nine catalogs fall back to English for them until the
 *      translation wave lands (payment copy is never guessed).
 */
import { readFileSync } from "node:fs";
import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

const ALL = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;

function load(locale: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const l of ALL) resources[l] = { translation: load(l) };

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    resources,
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
});

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("rendered strings — the split and the expiry wording", () => {
  it("labels the two parts", () => {
    expect(i18n.t("balance.permanent_label")).toBe("Permanent");
    expect(i18n.t("balance.temporary_label")).toBe("Temporary");
    expect(i18n.t("balance.permanent_amount", { amount: "87,475" })).toBe("Permanent: 87,475");
    expect(i18n.t("balance.temporary_amount", { amount: "100" })).toBe("Temporary: 100");
  });

  it("names the soonest expiry with its amount, date, and days left (plural-aware)", () => {
    expect(
      i18n.t("balance.temporary_expires_days", { amount: "300", date: "Oct 30, 2026", days: 2 }),
    ).toBe("300 expire Oct 30, 2026 (in 2 days)");
    expect(
      i18n.t("balance.temporary_expires_day", { amount: "300", date: "Oct 29, 2026" }),
    ).toBe("300 expire Oct 29, 2026 (in 1 day)");
    expect(
      i18n.t("balance.temporary_expires_today", { amount: "300", date: "Oct 28, 2026" }),
    ).toBe("300 expire today, Oct 28, 2026");
  });

  it("renders the dialog sub-line: includes Y temporary Bucs — expires <date>", () => {
    expect(
      i18n.t("balance.includes_temporary_days", { amount: "100", date: "Oct 30, 2026", days: 2 }),
    ).toBe("Includes 100 temporary Bucs — expires Oct 30, 2026 (in 2 days)");
    expect(
      i18n.t("balance.includes_temporary_day", { amount: "100", date: "Oct 29, 2026" }),
    ).toBe("Includes 100 temporary Bucs — expires Oct 29, 2026 (in 1 day)");
    expect(i18n.t("balance.includes_temporary_no_expiry", { amount: "100" })).toBe(
      "Includes 100 temporary Bucs",
    );
  });

  it("counts later grants behind the soonest one, plural-aware", () => {
    expect(i18n.t("balance.temporary_more_grant", { count: 1, amount: "200" })).toBe(
      "+ 1 more temporary grant (200)",
    );
    expect(i18n.t("balance.temporary_more_grants", { count: 2, amount: "700" })).toBe(
      "+ 2 more temporary grants (700)",
    );
  });

  it("carries the spent-first note and the sidebar summary", () => {
    expect(i18n.t("balance.temporary_spent_first")).toContain("spent first");
    expect(
      i18n.t("balance.breakdown_summary", { permanent: "87,475", temporary: "100" }),
    ).toBe("Permanent: 87,475 · Temporary: 100");
  });
});

describe("locale honesty — new balance keys are English-only for now", () => {
  it("non-English catalogs fall back to English for the new keys", () => {
    for (const lng of ALL.filter((l) => l !== "en")) {
      expect(
        i18n.t("balance.includes_temporary_days", {
          amount: "100",
          date: "Oct 30, 2026",
          days: 2,
          lng,
        }),
        `${lng} should fall back to the English string`,
      ).toBe("Includes 100 temporary Bucs — expires Oct 30, 2026 (in 2 days)");
    }
  });
});

describe("surface wiring", () => {
  it("/credit-history renders the breakdown from the endpoint composition, profile fallback", () => {
    const page = read("../pages/credit-history.tsx");
    expect(page).toContain("BalanceBreakdown");
    expect(page).toContain("if (histData.balance) setServerBalance(histData.balance);");
    expect(page).toContain("profile?.balance_composition");
    expect(page).toContain("balanceComposition(profile)");
  });

  it("the spend dialog gains the temporary sub-line only while a temporary part exists", () => {
    const dialog = read("../contexts/CreditConfirmContext.tsx");
    expect(dialog).toContain("TemporaryBucsNote");
    expect(dialog).toContain('mode="includes"');
    expect(dialog).toContain("composition.temporaryCredits > 0");
    /* The single total and After math are untouched. */
    expect(dialog).toContain("const balance = profile?.credits ?? 0;");
    expect(dialog).toContain("(balance - request.cost).toLocaleString");
  });

  it("the sidebar keeps its total and names the temporary part under it", () => {
    const sidebar = read("./layout/app-sidebar.tsx");
    expect(sidebar).toContain("TemporaryBucsNote");
    expect(sidebar).toContain('mode="label"');
    expect(sidebar).toContain("balanceComp.temporaryCredits > 0");
    expect(sidebar).toContain('t("balance.breakdown_summary"');
    /* The single total still renders in both sidebar spots. */
    expect(sidebar).toContain("{profile.credits.toLocaleString(\"en-US\")} left");
  });

  it("the World's Studio board names the temporary part under its balance strip", () => {
    const board = read("./world/native/boards/StudioBoard.tsx");
    expect(board).toContain("TemporaryBucsNote");
    expect(board).toContain('mode="label"');
    expect(board).toContain("profile.balance_composition ?? balanceComposition(profile)");
  });

  it("AuthContext composes the split before the spendable fold", () => {
    const auth = read("../contexts/AuthContext.tsx");
    const composed = auth.indexOf("data.balance_composition = balanceComposition(data);");
    const folded = auth.indexOf("data.credits = spendableCredits(data);");
    expect(composed).toBeGreaterThan(-1);
    expect(folded).toBeGreaterThan(composed);
  });
});
