/**
 * RoyaltyTrackerPanel — honest load standard (deep-pins tranche 3,
 * batch 8). The three reads (summary / platforms / payouts) ride
 * the Stack-200 E-2 lib loader (loadRoyaltySources, pinned in the
 * lib suite): each leg fails into its OWN named string from the
 * load-failed table, and the panel keeps each section's error
 * separate. The render is explicit: the summary error card sits
 * where totals would be (its own comment: "a failed summary is an
 * error state, never $0.00"), so a failed totals read can never
 * dress up as zero earnings; the honest empty card renders only
 * when there is no error and no data; the platforms and payouts
 * sections each show their own error line before their empty copy.
 * Writes all throw on non-ok before any success surface: CSV import
 * (success message only from the ok answer), platform connect,
 * insights (402 is its own out-of-credits ending), payout save.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./RoyaltyTrackerPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the loads — per-section failures, never a fake $0.00", () => {
  it("the loader hands each section its own error; the error card replaces the totals", () => {
    const body = slice(src, "async function loadAll() {", "useEffect(() => {\n    if (user) loadAll();");
    expect(body).toContain("setSectionErrors({");
    expect(body).toContain("summary: loaded.summaryError,");
    expect(body).toContain("platforms: loaded.platformsError,");
    expect(body).toContain("payouts: loaded.payoutsError,");
    expect(src).toContain("{/* Totals — a failed summary is an error state, never $0.00 */}");
    expect(src).toContain('t("royalties.empty.title")');
    expect(src).toContain(") : sectionErrors.summary ? null : (");
  });

  it("each section's error line renders before its empty copy", () => {
    expect(src).toContain('{sectionErrors.payouts ? (');
    const payouts = slice(src, "{sectionErrors.payouts ? (", "{payouts.map((p) => (");
    expect(payouts).toContain('payouts.length === 0 && <p className="text-sm text-white/45">{t("royalties.payouts.empty")}</p>');
  });
});

describe("writes — success only from an ok answer", () => {
  it("import, connect, insights and payout each throw (or name 402) before success", () => {
    const imp = slice(src, "async function importCsv() {", "async function connectManual(key: string) {");
    expect(imp).toContain('if (!res.ok) {\n        throw new Error(apiErrorMessage(data, t("royalties.error.importFailed")));');
    const conn = slice(src, "async function connectManual(key: string) {", "async function getInsights() {");
    expect(conn).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("royalties.error.connectFailed")));');
    const ins = slice(src, "async function getInsights() {", "async function savePayout() {");
    expect(ins).toContain("if (res.status === 402) {");
    expect(ins).toContain("setInsightsOutOfCredits(true);");
    expect(ins).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("royalties.error.insightsFailed")));');
    const pay = slice(src, "async function savePayout() {", "const maxSong =");
    expect(pay).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("royalties.error.payoutSaveFailed")));');
    expect(pay.indexOf("setShowPayoutForm(false);")).toBeGreaterThan(pay.indexOf("if (!res.ok) throw"));
  });
});
