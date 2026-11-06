/**
 * spend-confirmation-parity.test.ts — Stack 200 Lane C item 4.
 *
 * The Tour optimizer (300 VB) and the Analytics connected-tab AI calls
 * (insights + suggestions, 100 VB each) fired their priced POSTs with
 * NO spend confirmation, while the same actions in the World desks —
 * and every other priced call on the site — ride the confirmed path
 * (useConfirmedApi → CreditConfirm, price shown from the registry,
 * cancel = no request, no charge). These pins hold the 2D pages to
 * the same path at the same ruled prices:
 *
 *   - tour.tsx routes /api/tour/optimize through confirmedFetch and
 *     returns quietly on cancel (null) before reading the response;
 *   - analytics-hub.tsx's ConnectedAccountsTab routes
 *     /api/analytics/insights and /api/analytics/suggestions through
 *     confirmedFetch (its free /api/analytics/overview read keeps the
 *     plain authedFetch), each with the cancel return;
 *   - the registry prices the confirmation shows are unchanged
 *     (300 / 100 / 100) — this lane moves the path, never the price.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCreditCost } from "./credit-costs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const tour = read("../pages/tour.tsx");
const hub = read("../pages/analytics-hub.tsx");

/** Slice a top-level function body out of a page source. */
function bodyOf(src: string, startNeedle: string, endNeedle: string): string {
  const start = src.indexOf(startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("tour optimizer — confirmed path (stack200 C1)", () => {
  const optimize = bodyOf(tour, "async function optimize()", "function toggleCheck");

  it("routes the priced call through confirmedFetch, never a bare fetch", () => {
    expect(tour).toContain('import { useConfirmedApi } from "@/hooks/use-confirmed-api"');
    expect(optimize).toContain('confirmedFetch("/api/tour/optimize"');
    /* "await fetch(" cannot match inside "await confirmedFetch(" — the
       capital F keeps the two spellings distinct. */
    expect(optimize).not.toContain("await fetch(");
  });

  it("a cancel returns before any response handling — no request, no charge", () => {
    const callAt = optimize.indexOf('confirmedFetch("/api/tour/optimize"');
    const cancelAt = optimize.indexOf("if (!res) return;", callAt);
    const readAt = optimize.indexOf("res.json()", callAt);
    expect(cancelAt).toBeGreaterThan(callAt);
    expect(readAt).toBeGreaterThan(cancelAt);
  });
});

describe("analytics connected tab — confirmed path (stack200 C1)", () => {
  const insights = bodyOf(hub, "async function runInsights()", "async function runSuggestions()");
  const suggestions = bodyOf(hub, "async function runSuggestions()", "export default function AnalyticsHub");

  it("insights rides confirmedFetch with the cancel return", () => {
    expect(insights).toContain('confirmedFetch("/api/analytics/insights"');
    expect(insights).not.toContain("authedFetch(");
    const callAt = insights.indexOf('confirmedFetch("/api/analytics/insights"');
    const cancelAt = insights.indexOf("if (!res) return;", callAt);
    const readAt = insights.indexOf("res.json()", callAt);
    expect(cancelAt).toBeGreaterThan(callAt);
    expect(readAt).toBeGreaterThan(cancelAt);
  });

  it("suggestions rides confirmedFetch with the cancel return", () => {
    expect(suggestions).toContain('confirmedFetch("/api/analytics/suggestions"');
    expect(suggestions).not.toContain("authedFetch(");
    const callAt = suggestions.indexOf('confirmedFetch("/api/analytics/suggestions"');
    const cancelAt = suggestions.indexOf("if (!res) return;", callAt);
    const readAt = suggestions.indexOf("res.json()", callAt);
    expect(cancelAt).toBeGreaterThan(callAt);
    expect(readAt).toBeGreaterThan(cancelAt);
  });

  it("the tab takes the hook, and the free overview read stays unconfirmed", () => {
    const tab = bodyOf(hub, "function ConnectedAccountsTab()", "export default function AnalyticsHub");
    expect(tab).toContain("const { confirmedFetch } = useConfirmedApi();");
    expect(tab).toContain('authedFetch("/api/analytics/overview")');
  });
});

describe("the prices the confirmation shows are the ruled ones (unchanged)", () => {
  it("registry: tour optimize 300, analytics insights 100, suggestions 100", () => {
    expect(getCreditCost("/api/tour/optimize")?.cost).toBe(300);
    expect(getCreditCost("/api/analytics/insights")?.cost).toBe(100);
    expect(getCreditCost("/api/analytics/suggestions")?.cost).toBe(100);
  });
});
