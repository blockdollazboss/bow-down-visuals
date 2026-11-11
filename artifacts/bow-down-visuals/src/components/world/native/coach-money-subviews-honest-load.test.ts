/**
 * CoachMoneySubViews (the World Coach Money sub-views: splits
 * overview, publishing splits, royalty imports) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - THE SPLITS OVERVIEW is the full four-state exemplar in
 *   early returns: loading renders first, then the error state
 *   (with a retry wired to the real loader), then the genuine
 *   empty state, then data. Its loader throws on non-ok AND on
 *   an unparseable payload — a shape failure is a load failure,
 *   never "no splits yet". A declined confirmation (null res)
 *   returns without claiming anything.
 * - THE ROYALTIES VIEW loads three sources through the shared
 *   loadRoyaltySources helper and keeps a PER-SOURCE error
 *   state (summaryError / platformsError / payoutsError): one
 *   source's failure is that section's failure line, never the
 *   whole view dressed as empty and never another section's
 *   data.
 * - THE CSV IMPORT narrates from the checked response: non-ok
 *   throws the server's message into the error line; the
 *   imported count is read from the proven payload.
 *
 * NO FIX in this lane — every family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const views = read("./CoachMoneySubViews.tsx");

describe("the splits overview: loading, error, empty, data — in that order", () => {
  it("the loader throws on non-ok and on an unparseable payload before recording", () => {
    expect(views).toContain('if (!res.ok) throw new Error(apiErrorMessage(json as { error?: string }, t("worldCoachMoney.subSplitsLoadError")));');
    expect(views).toContain("const parsed = parseSplitsOverview(json);");
    expect(views).toContain('if (!parsed) throw new Error(t("worldCoachMoney.subSplitsLoadError"));');
    expect(views).toContain("setData(parsed);");
    expect(views).toContain("if (!res) return;");
  });

  it("the render chain is loading → error (with retry) → genuine empty → data", () => {
    const loadingIdx = views.indexOf('if (loading) return <NativeLoadingState');
    const errorIdx = views.indexOf("if (error) {");
    const emptyIdx = views.indexOf("if (!data || data.releases.length === 0) {");
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    expect(emptyIdx).toBeGreaterThan(errorIdx);
    expect(views).toContain("onRetry={() => void load()}");
  });
});

describe("the royalties view: per-source error states", () => {
  it("each source lands its own data + error pair from the shared loader", () => {
    expect(views).toContain("const result = await loadRoyaltySources(");
    expect(views).toContain("setSummaryError(result.summaryError);");
    expect(views).toContain("setPlatformsError(result.platformsError);");
    expect(views).toContain("setPayoutsError(result.payoutsError);");
  });
});

describe("the CSV import narrates from the checked response", () => {
  it("non-ok throws the server's message; the count reads from the proven payload", () => {
    expect(views).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCoachMoney.subImportFailed")));');
    expect(views).toContain('const imported = typeof data.imported === "number" ? data.imported : 0;');
  });
});
