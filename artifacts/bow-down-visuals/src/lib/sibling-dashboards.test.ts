import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SECTION_KEYS,
  allDashboardSectionsFailed,
  allSectionsFailed,
  anySectionLoading,
  dashboardSectionsToRefetch,
  initialDashboardSectionStates,
  initialSectionStates,
  markSectionLoading,
  sectionStatusFromSettled,
  sectionsToRefetch,
  settleSection,
  type SectionStates,
} from "./dashboard-sections";

/**
 * Sibling dashboard resilience (STACK-20 R2, item #2).
 *
 * The main dashboard's fix introduced ONE seam (lib/dashboard-sections)
 * with the law: sections settle and retry independently, a failed
 * section is never an empty section, and a full-page error card is
 * reserved for ALL sections failing. The beats marketplace page and
 * the store dashboard shared the old failure shapes — page-wide flags
 * on one side, an all-or-nothing Promise.all (plus silent swallows
 * that rendered as fake-empty sections) on the other. They now drive
 * the SAME seam, generalized over each page's own section keys. These
 * tests pin the generic core, the dashboard wrappers' fidelity to it,
 * and the wiring in both sibling pages.
 */

/* ── The generic core ─────────────────────────────────────────────── */

type BeatsKey = "browse" | "dashboard";
const BEATS_KEYS: readonly BeatsKey[] = ["browse", "dashboard"];

type DigitalKey = "sales" | "checklist" | "products";
const DIGITAL_KEYS: readonly DigitalKey[] = ["sales", "checklist", "products"];

describe("generic section seam", () => {
  it("starts every section of an arbitrary key set in flight", () => {
    expect(initialSectionStates(BEATS_KEYS)).toEqual({ browse: "loading", dashboard: "loading" });
    expect(initialSectionStates(DIGITAL_KEYS)).toEqual({
      sales: "loading",
      checklist: "loading",
      products: "loading",
    });
    expect(anySectionLoading(BEATS_KEYS, initialSectionStates(BEATS_KEYS))).toBe(true);
    expect(allSectionsFailed(BEATS_KEYS, initialSectionStates(BEATS_KEYS))).toBe(false);
  });

  it("(a) one section failing leaves the others settled — only that section is failed", () => {
    let s = initialSectionStates(DIGITAL_KEYS);
    s = settleSection(s, "sales", false);
    s = settleSection(s, "checklist", true);
    s = settleSection(s, "products", true);
    expect(s).toEqual({ sales: "failed", checklist: "ok", products: "ok" });
    expect(allSectionsFailed(DIGITAL_KEYS, s)).toBe(false);
    expect(anySectionLoading(DIGITAL_KEYS, s)).toBe(false);
  });

  it("settling or re-marking one section never rewrites a sibling (immutable folds)", () => {
    const before: SectionStates<DigitalKey> = { sales: "ok", checklist: "failed", products: "ok" };
    const after = settleSection(before, "checklist", true);
    expect(after).toEqual({ sales: "ok", checklist: "ok", products: "ok" });
    expect(before.checklist).toBe("failed");
    const marked = markSectionLoading(before, "sales");
    expect(marked).toEqual({ sales: "loading", checklist: "failed", products: "ok" });
    expect(before.sales).toBe("ok");
  });

  it("(b) the total-failure verdict requires EVERY section failed, for any key set", () => {
    const allFailed: SectionStates<DigitalKey> = { sales: "failed", checklist: "failed", products: "failed" };
    expect(allSectionsFailed(DIGITAL_KEYS, allFailed)).toBe(true);
    expect(allSectionsFailed(DIGITAL_KEYS, { ...allFailed, products: "ok" })).toBe(false);
    expect(allSectionsFailed(DIGITAL_KEYS, { ...allFailed, sales: "loading" })).toBe(false);
    expect(allSectionsFailed(BEATS_KEYS, { browse: "failed", dashboard: "failed" })).toBe(true);
    expect(allSectionsFailed(BEATS_KEYS, { browse: "failed", dashboard: "ok" })).toBe(false);
  });

  it("(c) a named retry refetches ONLY that section; an unnamed one refetches the failed set", () => {
    const s: SectionStates<DigitalKey> = { sales: "failed", checklist: "ok", products: "failed" };
    expect(sectionsToRefetch(DIGITAL_KEYS, s, "sales")).toEqual(["sales"]);
    expect(sectionsToRefetch(DIGITAL_KEYS, s, "checklist")).toEqual(["checklist"]);
    expect(sectionsToRefetch(DIGITAL_KEYS, s)).toEqual(["sales", "products"]);
    expect(sectionsToRefetch(DIGITAL_KEYS, { sales: "ok", checklist: "ok", products: "ok" })).toEqual([]);
  });

  it("the settled-fetch verdict matches the old page-wide check, per section", () => {
    expect(sectionStatusFromSettled({ status: "fulfilled", value: { ok: true } })).toBe("ok");
    expect(sectionStatusFromSettled({ status: "fulfilled", value: { ok: false } })).toBe("failed");
    expect(sectionStatusFromSettled({ status: "rejected", reason: new Error("box waking") })).toBe("failed");
  });

  it("the dashboard wrappers are the generic core over the dashboard keys — same answers", () => {
    expect(initialDashboardSectionStates()).toEqual(initialSectionStates(DASHBOARD_SECTION_KEYS));
    const allFailed = { projects: "failed", deals: "failed", usage: "failed", streak: "failed" } as const;
    expect(allDashboardSectionsFailed(allFailed)).toBe(allSectionsFailed(DASHBOARD_SECTION_KEYS, allFailed));
    expect(allDashboardSectionsFailed({ ...allFailed, deals: "ok" })).toBe(false);
    expect(dashboardSectionsToRefetch(allFailed, "usage")).toEqual(
      sectionsToRefetch(DASHBOARD_SECTION_KEYS, allFailed, "usage"),
    );
    expect(dashboardSectionsToRefetch(allFailed)).toEqual([...DASHBOARD_SECTION_KEYS]);
  });
});

/* ── Source pins: pages/beats.tsx ─────────────────────────────────── */

const beatsSource = readFileSync(new URL("../pages/beats.tsx", import.meta.url), "utf8");

describe("beats.tsx wiring (source pins)", () => {
  it("drives both sections off the shared seam", () => {
    expect(beatsSource).toContain('from "@/lib/dashboard-sections"');
    expect(beatsSource).toContain("initialSectionStates(BEATS_SECTION_KEYS)");
    expect(beatsSource).toContain('settleSection(prev, "browse"');
    expect(beatsSource).toContain('settleSection(prev, "dashboard"');
    expect(beatsSource).toContain('markSectionLoading(prev, "browse")');
  });

  it("the old per-tab error flags are gone — no boolean can blank a section", () => {
    expect(beatsSource).not.toContain("dashLoadError");
    expect(beatsSource).not.toContain("dashLoading");
    expect(beatsSource).not.toContain("const [loadError");
    expect(beatsSource).not.toContain("const [loading, setLoading]");
  });

  it("each section carries its own failure card in its own area", () => {
    expect(beatsSource).toContain('data-testid="beats-browse-failure"');
    expect(beatsSource).toContain('data-testid="beats-dashboard-failure"');
    /* Each card's Retry refetches that section's loader alone. */
    expect(beatsSource).toContain('sectionStates.browse === "failed"');
    expect(beatsSource).toContain('sectionStates.dashboard === "failed"');
  });

  it("(d) failed sections are gated BEFORE their content/empty states — never rendered as empty", () => {
    const browseFailedAt = beatsSource.indexOf('data-testid="beats-browse-failure"');
    const browseEmptyAt = beatsSource.indexOf('t("beats.emptyBrowse")');
    expect(browseFailedAt).toBeGreaterThan(-1);
    expect(browseEmptyAt).toBeGreaterThan(browseFailedAt);
    const dashFailedAt = beatsSource.indexOf('data-testid="beats-dashboard-failure"');
    const dashContentAt = beatsSource.indexOf('"beats.statBeatsListed"');
    expect(dashFailedAt).toBeGreaterThan(-1);
    expect(dashContentAt).toBeGreaterThan(dashFailedAt);
  });

  it("only a failed FIRST load fails a section — a failed reload settles back to ok over shown data", () => {
    expect(beatsSource).toContain('settleSection(prev, "browse", beatsLoadedRef.current)');
    expect(beatsSource).toContain('settleSection(prev, "dashboard", dashLoadedRef.current)');
  });

  it("both section endpoints are still the ones being fetched", () => {
    expect(beatsSource).toContain("fetch(`/api/beats?${q.toString()}`)");
    expect(beatsSource).toContain('fetch("/api/beats/mine/dashboard")');
  });
});

/* ── Source pins: pages/store-dashboard.tsx ───────────────────────── */

const storeSource = readFileSync(new URL("../pages/store-dashboard.tsx", import.meta.url), "utf8");

describe("store-dashboard overview wiring (source pins)", () => {
  it("drives the page-level overview section off the shared seam", () => {
    expect(storeSource).toContain('from "@/lib/dashboard-sections"');
    expect(storeSource).toContain("initialSectionStates(STORE_OVERVIEW_SECTION_KEYS)");
    expect(storeSource).toContain('settleSection(prev, "overview", false)');
    expect(storeSource).toContain("const [overviewStates, setOverviewStates]");
  });

  it("the overview failure is a section card with its own retry — not a page takeover", () => {
    expect(storeSource).toContain('data-testid="store-overview-failure"');
    expect(storeSource).toContain("onClick={retryOverview}");
    expect(storeSource).toContain(
      'sectionsToRefetch(STORE_OVERVIEW_SECTION_KEYS, overviewStates, "overview")',
    );
    /* The old page-wide flag that replaced EVERYTHING (tabs included)
       is gone from the PAGE component — the tab components keep their
       own scoped flags, which is exactly where they belong. */
    const pageComponent = storeSource.slice(
      storeSource.indexOf("export default function StoreDashboard"),
      storeSource.indexOf("DIGITAL SALES — the full"),
    );
    expect(pageComponent).not.toContain("loadError");
    expect(pageComponent).not.toContain("retryNonce");
  });

  it("the tabs render independently of the overview section's fate", () => {
    /* Tab contents are gated on the tab alone, never on checklist data. */
    expect(storeSource).toContain('{tab === "products" && <ProductsTab slug={slug} onChanged={load} />}');
    expect(storeSource).toContain('{tab === "orders" && <OrdersTab />}');
    expect(storeSource).toContain('{tab === "discounts" && <DiscountsTab />}');
    /* The overview tab's cards wait for the overview section itself. */
    expect(storeSource).toContain('overviewStates.overview === "ok" && checklist');
    expect(storeSource).toContain("<EarningsHero data={checklist} />");
  });

  it("NO_PROFILE stays a settled setup state, not a failure", () => {
    expect(storeSource).toContain('e.message === "NO_PROFILE"');
    expect(storeSource).toContain("Set up your creator profile →");
  });

  it("the payout card and the tabs keep their own scoped error states (already compliant)", () => {
    expect(storeSource).toContain("Couldn't load your products.");
    expect(storeSource).toContain("Couldn't load your orders.");
    expect(storeSource).toContain("Couldn't load your discount codes.");
    expect(storeSource).toContain("Couldn't load payout status.");
  });
});

describe("store-dashboard digital surface wiring (source pins)", () => {
  it("drives the three digital sections off the shared seam", () => {
    expect(storeSource).toContain("initialSectionStates(DIGITAL_SECTION_KEYS)");
    expect(storeSource).toContain("fetchDigitalSection");
    expect(storeSource).toContain('loadSection("sales")');
    expect(storeSource).toContain('loadSection("products")');
  });

  it("the all-or-nothing Promise.all over the three endpoints is gone", () => {
    expect(storeSource).not.toContain("[salesRes, checkRes, prodRes]");
    expect(storeSource).not.toContain('if (checkRes.ok)');
    expect(storeSource).not.toContain('if (prodRes.ok)');
  });

  it("(b) the big card renders ONLY when all three sections failed", () => {
    expect(storeSource).toContain("allSectionsFailed(DIGITAL_SECTION_KEYS, sectionStates)");
    expect(storeSource).toContain('data-testid="store-digital-total-failure"');
    expect(storeSource).toContain("Couldn't load your digital sales.");
    expect(storeSource).toContain("onClick={retryFailedDigitalSections}");
    expect(storeSource).toContain("sectionsToRefetch(DIGITAL_SECTION_KEYS, sectionStates)");
  });

  it("each digital section carries its own failure note with its own retry", () => {
    for (const key of ["sales", "checklist", "products"] as const) {
      expect(storeSource).toContain(`testId="store-digital-${key}-failure"`);
      expect(storeSource).toContain(`retryDigitalSection("${key}")`);
    }
    /* The note component stamps the testid it is handed. */
    expect(storeSource).toContain("data-testid={testId}");
  });

  it("(d) a failed products section is gated BEFORE the pricing empty state — never a fake empty", () => {
    const failedAt = storeSource.indexOf('testId="store-digital-products-failure"');
    const emptyAt = storeSource.indexOf("List your first product");
    expect(failedAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(failedAt);
    const salesFailedAt = storeSource.indexOf('testId="store-digital-sales-failure"');
    const salesDataAt = storeSource.indexOf("data && sectionStates.sales");
    expect(salesFailedAt).toBeGreaterThan(-1);
    expect(salesDataAt).toBeGreaterThan(salesFailedAt);
  });

  it("all three section endpoints are still the ones being fetched", () => {
    expect(storeSource).toContain('digitalAuthed("/api/store/sales", token)');
    expect(storeSource).toContain('digitalAuthed("/api/store/checklist", token)');
    expect(storeSource).toContain('digitalAuthed("/api/store/products", token)');
  });

  it("NO_PROFILE keeps its honest setup panel — failures no longer land in it", () => {
    expect(storeSource).toContain('body.error === "NO_PROFILE"');
    expect(storeSource).toContain("No creator profile yet");
    expect(storeSource).toContain("if (noProf) setNoProfile(true);");
  });

  it("action refreshes are scoped: pricing refreshes sales+products, tracker logging refreshes sales alone", () => {
    expect(storeSource).toContain('await Promise.allSettled([loadSection("sales"), loadSection("products")])');
    expect(storeSource).toContain('await loadSection("sales");');
  });
});
