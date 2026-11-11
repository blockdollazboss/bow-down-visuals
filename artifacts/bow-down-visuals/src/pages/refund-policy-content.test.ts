/**
 * refund-policy-content.test.ts — pins the owner-approved Refund
 * Policy (approved Nov 11, 2026; source of truth:
 * goals/company-blind-spots-the-missing-list/files/
 * refund-and-chargeback-playbook-draft.md, part (a) only).
 *
 * The page previously carried the pre-approval copy (48-hour
 * first-subscription window, "all sales generally final", a 7-day
 * request window). These pins hold the approved terms on the page:
 * exact figures from the draft, and — just as load-bearing — the
 * INTERNAL chargeback playbook (part (b): 3-business-day Stripe
 * response deadline, evidence pack, no-retaliation procedure,
 * case logging) must never appear as public page copy.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, any>;
const load = (loc: string): Catalog =>
  JSON.parse(readFileSync(new URL(`../locales/${loc}.json`, import.meta.url), "utf8")) as Catalog;

const EN = load("en");
const RP = EN.refundPolicy as Catalog;
const pageSource = readFileSync(new URL("./refund-policy.tsx", import.meta.url), "utf8");

function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object") flat(v, key, out);
      else out[key] = String(v);
    }
  }
  return out;
}
const rpFlat = flat(RP, "refundPolicy");
const allCopy = Object.values(rpFlat).join("\n");

describe("refund policy page carries the approved part (a) terms", () => {
  it("credit packs: unused pack full refund within 14 days; part-spent unspent share within 30 days", () => {
    expect(RP.creditPacks.unusedDesc).toContain("full refund within 14 days");
    expect(RP.creditPacks.unusedDesc).toContain("no Bucs from that pack were spent");
    expect(RP.creditPacks.partSpentDesc).toContain("refund the unspent share, within 30 days");
  });

  it("credit packs: spent Bucs non-refundable; our-fault failures auto-refunded; earned Bucs never cash", () => {
    expect(RP.creditPacks.spentDesc).toContain("cannot be refunded");
    expect(RP.creditPacks.ourFaultDesc).toContain("go back automatically");
    expect(RP.creditPacks.earned).toContain("never cash and cannot be cashed out");
  });

  it("subscriptions: Pro $12 / Elite $29 named in the section title", () => {
    expect(RP.subscriptions.title).toContain("Creator Pro ($12/mo)");
    expect(RP.subscriptions.title).toContain("Creator Elite ($29/mo)");
  });

  it("subscriptions: one-click cancel, keep the paid month, first payment refunded within 7 days if barely used, error charges always refunded", () => {
    expect(RP.subscriptions.cancel).toContain("in one click");
    expect(RP.subscriptions.keepMonth).toContain("end of the month you already paid for");
    expect(RP.subscriptions.firstMonthDesc).toContain("within 7 days of your first payment");
    expect(RP.subscriptions.firstMonthDesc).toContain("barely used");
    expect(RP.subscriptions.renewals).toContain("always refunded in full");
  });

  it("marketplace: broken/undelivered/wrong items refunded in full within 14 days including the 5% fee; as-described sales final", () => {
    expect(RP.marketplace.intro).toContain("flat 5% fee");
    expect(RP.marketplace.digitalDesc).toContain("report it within 14 days");
    expect(RP.marketplace.digitalDesc).toContain("full refund");
    expect(RP.marketplace.neverDeliversDesc).toContain("full refund automatically");
    expect(RP.marketplace.asDescribedTitle).toContain("sale is final");
    expect(RP.marketplace.originalMethod).toContain("including the 5% site fee");
    expect(RP.marketplace.originalMethod).toContain("everything they paid");
  });

  it("how to ask: email support@bowdownvisuals.com from the account email with order/receipt details", () => {
    expect(RP.howTo.body).toContain("support@bowdownvisuals.com");
    expect(RP.howTo.body).toContain("order or receipt details");
    expect(RP.promise.body).toContain("If we made the mistake, the customer does not pay for it.");
  });

  it("the superseded pre-approval terms are gone", () => {
    expect(allCopy).not.toContain("48 hours");
    expect(allCopy).not.toContain("generally final");
    expect(allCopy).not.toContain("Partial-month refunds are not issued");
  });
});

describe("the internal chargeback playbook (part (b)) is NOT public copy", () => {
  it("no chargeback procedure language in the en refundPolicy copy", () => {
    expect(allCopy.toLowerCase()).not.toContain("chargeback");
    expect(allCopy).not.toContain("3 business days");
    expect(allCopy.toLowerCase()).not.toContain("evidence");
    expect(allCopy.toLowerCase()).not.toContain("retaliation");
  });

  it("no chargeback procedure language in the page component", () => {
    expect(pageSource.toLowerCase()).not.toContain("chargeback");
  });

  it("no chargeback procedure language in any locale's refundPolicy copy", () => {
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const copy = Object.values(flat(load(loc).refundPolicy, "refundPolicy")).join("\n");
      expect(copy.toLowerCase(), loc).not.toContain("chargeback");
      expect(copy, loc).not.toContain("3 business days");
    }
  });
});

describe("the page component renders every approved section from the catalog", () => {
  it("wires the promise, how-to, credit-pack, subscription, marketplace and questions sections", () => {
    for (const key of [
      "refundPolicy.promise.title",
      "refundPolicy.howTo.body",
      "refundPolicy.creditPacks.title",
      "refundPolicy.subscriptions.title",
      "refundPolicy.marketplace.title",
      "refundPolicy.questions.email",
    ]) {
      expect(pageSource, key).toContain(`t("${key}")`);
    }
  });
});
