/**
 * Store Dashboard digital sections — honest load states (Stack 400
 * C-28: the honest-load pin layer completing the "empty lie" audit).
 *
 * The dashboard's digital area loads three list sections — the Get
 * Paid checklist, the pricing list, and the sales totals — through
 * one shared section machine: each section settles ok/failed from
 * its own loader (a failed loader settles "failed", never data),
 * and each section renders its own named failure card (with a retry
 * that refetches ONLY that section) before any loading or empty
 * render; when every section fails, a total-failure card renders
 * instead of a dashboard of fake zeros. The sales block states the
 * law in its own comment ("never fake zero totals"). What was
 * missing is the PIN; this file pins the digital sections' shape in
 * source, like the sibling honest-load pins (the FE suite runs in
 * node, no DOM). The section copy is hardcoded English in the page,
 * so the literals are pinned and there is no catalog block. The
 * page's other panels (payout status, gift cards, licenses, keys,
 * bundles) keep their own loadError states and are classified in
 * the C-28 table.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./store-dashboard.tsx");

describe("the section machine — failure settles as failure, never as data", () => {
  it("a section loader's catch settles that section failed", () => {
    expect(page).toContain("setSectionStates((prev) => settleSection(prev, key, false));");
    expect(page).toContain("setSectionStates((prev) => settleSection(prev, key, true));");
    expect(page).toContain("void Promise.allSettled(DIGITAL_SECTION_KEYS.map((k) => loadSection(k)));");
  });

  it("the section loaders throw honest messages on a non-ok answer", () => {
    expect(page).toContain('throw new Error(apiErrorMessage(body, "Couldn\'t load your sales."));');
    expect(page).toContain('throw new Error("Couldn\'t load your checklist.");');
    expect(page).toContain('throw new Error("Couldn\'t load your products.");');
  });

  it("a section's retry refetches only that section; the total-failure retry refetches the failed set", () => {
    expect(page).toContain('onRetry={() => retryDigitalSection("checklist")}');
    expect(page).toContain('onRetry={() => retryDigitalSection("products")}');
    expect(page).toContain('onRetry={() => retryDigitalSection("sales")}');
    expect(page).toContain("sectionsToRefetch(DIGITAL_SECTION_KEYS, sectionStates)");
  });
});

describe("rendering — every section's failure card precedes its loading and empty renders", () => {
  it("the checklist failure card renders before its loading branch", () => {
    const failAt = page.indexOf('testId="store-digital-checklist-failure"');
    const loadingAt = page.indexOf('sectionStates.checklist === "loading" && !checklist', failAt);
    expect(failAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failAt);
    expect(page).toContain('sectionStates.checklist === "failed"');
  });

  it("the products failure card renders before the pricing list's empty panel", () => {
    const failAt = page.indexOf('testId="store-digital-products-failure"');
    const emptyAt = page.indexOf("products.products.length === 0", failAt);
    expect(failAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failAt);
    expect(page).toContain('sectionStates.products === "failed"');
  });

  it("the sales failure card renders before its loading branch, and totals never render on failure", () => {
    const failAt = page.indexOf('testId="store-digital-sales-failure"');
    const loadingAt = page.indexOf('sectionStates.sales === "loading" && !data', failAt);
    expect(failAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failAt);
    expect(page).toContain('sectionStates.sales === "failed"');
    expect(page).toContain("{data && sectionStates.sales !== \"failed\" && (");
    expect(page).toContain("never fake zero totals in its place");
  });

  it("when every section fails, the total-failure card renders", () => {
    expect(page).toContain('data-testid="store-digital-total-failure"');
  });
});
