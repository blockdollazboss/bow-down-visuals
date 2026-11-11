/**
 * MerchDropPlanner — honest load standard (deep-pins
 * tranche 4, batch ACE-fix). THE FIX is the saved-plans
 * load: it throws on !res.ok, success sets the plans AND
 * clears savedFailed, and the catch sets savedFailed(true)
 * — a failed load never reads as "no saved plans". The
 * effect re-runs on savedTick, and the saved section renders
 * in that order: the loadingSaved spinner, then the
 * savedFailed branch (loadFailed copy + a Retry button
 * bumping savedTick), then the savedEmpty copy for a proven
 * empty list, then the grid. The paid flows were already
 * honest and are pinned briefly: a decline returns
 * uncharged, 402 is out-of-credits, 503 is its own
 * not-set-up line, and any other non-ok lands the server's
 * error before setPlan / setAccepted can run.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MerchDropPlanner.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — the saved-plans load fails honestly", () => {
  it("throws on !res.ok; success clears savedFailed; the catch sets it; the effect re-runs on savedTick", () => {
    const body = slice(src, "useEffect(() => {", "async function handlePlan() {");
    expect(body).toContain("setLoadingSaved(true);");
    expect(body).toContain('const res = await fetch("/api/wave8/merch-drop/plans", { credentials: "include" });');
    expect(body).toContain('if (!res.ok) throw new Error("saved plans failed");');
    expect(body).toContain("setSavedPlans(data.plans ?? []);");
    expect(body).toContain("setSavedFailed(false);");
    expect(body).toContain("setSavedFailed(true);");
    expect(body).toContain("setLoadingSaved(false);");
    expect(body).toContain("}, [savedTick]);");
    expect(body.indexOf('if (!res.ok) throw new Error("saved plans failed");')).toBeLessThan(
      body.indexOf("setSavedPlans(data.plans ?? []);"),
    );
    expect(body.indexOf("setSavedPlans(data.plans ?? []);")).toBeLessThan(
      body.indexOf("setSavedFailed(false);"),
    );
    // the catch sets ONLY the flag — it never writes an empty list over a failure
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setSavedFailed(true);");
    expect(catchPart).not.toContain("setSavedPlans");
  });

  it("render order: spinner → savedFailed + Retry → savedEmpty → the grid", () => {
    const body = src.slice(src.indexOf("{loadingSaved ? ("));
    expect(body).toContain('{t("wave8.merchDrop.errors.loadFailed")}');
    expect(body).toContain("onClick={() => setSavedTick((n) => n + 1)}");
    expect(body).toContain('{t("common.retry")}');
    expect(body).toContain('{t("wave8.merchDrop.savedEmpty")}');
    expect(body).toContain("savedPlans.map((s) =>");
    expect(body.indexOf("{loadingSaved ? (")).toBeLessThan(body.indexOf(") : savedFailed ? ("));
    expect(body.indexOf(") : savedFailed ? (")).toBeLessThan(body.indexOf(") : savedPlans.length === 0 ? ("));
    expect(body.indexOf(") : savedPlans.length === 0 ? (")).toBeLessThan(body.indexOf("savedPlans.map((s) =>"));
    expect(body.indexOf('{t("wave8.merchDrop.errors.loadFailed")}')).toBeLessThan(
      body.indexOf("onClick={() => setSavedTick((n) => n + 1)}"),
    );
  });
});

describe("the already-honest paid flows, pinned briefly", () => {
  it("plan: decline / 402 / 503 / non-ok are four endings before setPlan", () => {
    const body = slice(src, "async function handlePlan() {", "async function handleAccept() {");
    expect(body).toContain('setError(t("wave8.merchDrop.errors.nicheRequired"));');
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body).toContain("if (res.status === 402) { setOutOfCredits(true); return; }");
    expect(body).toContain('if (res.status === 503) { setError(apiErrorMessage(data, "That isn\'t set up yet — try again later.")); return; }');
    expect(body).toContain('if (!res.ok) { setError(apiErrorMessage(data, t("wave8.merchDrop.errors.planFailed"))); return; }');
    expect(body).toContain("setPlan(data.plan as MerchPlan);");
    expect(body.indexOf("if (!res) return;")).toBeLessThan(body.indexOf("if (res.status === 402)"));
    expect(body.indexOf("if (res.status === 402)")).toBeLessThan(body.indexOf("if (res.status === 503)"));
    expect(body.indexOf("if (res.status === 503)")).toBeLessThan(body.indexOf("if (!res.ok) { setError(apiErrorMessage(data, t(\"wave8.merchDrop.errors.planFailed\")))"));
    expect(body.indexOf("if (!res.ok) { setError(apiErrorMessage(data, t(\"wave8.merchDrop.errors.planFailed\")))")).toBeLessThan(
      body.indexOf("setPlan(data.plan as MerchPlan);"),
    );
  });

  it("accept: decline and non-ok return before setAccepted or any saved-plan write", () => {
    const body = slice(src, "async function handleAccept() {", "function startOver() {");
    expect(body).toContain("if (!res) return;");
    expect(body).toContain('if (!res.ok) { setError(apiErrorMessage(data, t("wave8.merchDrop.errors.saveFailed"))); return; }');
    expect(body).toContain("setAccepted(true);");
    expect(body.indexOf('if (!res.ok) { setError(apiErrorMessage(data, t("wave8.merchDrop.errors.saveFailed")))')).toBeLessThan(
      body.indexOf("setAccepted(true);"),
    );
    expect(body.indexOf("setAccepted(true);")).toBeLessThan(body.indexOf("setSavedPlans((prev) => ["));
  });
});
