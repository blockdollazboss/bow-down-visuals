/**
 * TourDesk — honest load standard (deep-pins tranche 3, batch 9).
 * The dates load: non-ok throws, and an unparsed answer throws too
 * — failure lands in the failed flag, never in an empty tour. The
 * optimizer (300 Bucs, TOUR_OPTIMIZE_COST single-sourced): decline
 * returns; 402 (status OR the out_of_credits body) is the named
 * ending; non-ok throws the server's words; an unusable plan
 * (planOfResponse null) throws the unusable line; the plan is built
 * and saved only from a usable answer. Date writes (save/delete)
 * throw into the action note on non-ok before anything local moves.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TourDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the dates load — failure is never an empty tour", () => {
  it("non-ok and unparsed both throw into the failed flag", () => {
    const body = slice(src, "const load = useCallback(async () => {", "useEffect(() => {\n    void load();");
    expect(body).toContain('if (!res.ok) throw new Error("load failed");');
    expect(body).toContain('if (!parsed) throw new Error("load failed");');
    expect(body).toContain("setFailed(true);");
    expect(body.indexOf("setDates(sortDatesChronologically(parsed));")).toBeGreaterThan(body.indexOf("if (!parsed) throw"));
  });
});

describe("optimize — an unusable plan is never a plan", () => {
  it("decline / 402 / non-ok / unusable are four endings; the plan builds only from a usable answer", () => {
    const body = slice(src, "async function optimize() {", "async function applyPlan() {");
    expect(body).toContain("if (!res) return;");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(body).toContain("if (!built) throw new Error(t(\"worldDeskRemainder.tourPlanUnusable\"));");
    expect(body.indexOf("const newPlan: TourPlan = {")).toBeGreaterThan(body.indexOf("if (!built) throw"));
  });

  it("date writes throw on non-ok before local state moves", () => {
    expect(src).toContain('throw new Error(apiErrorMessage(data, t("worldDeskRemainder.tourSaveFailed")));');
    const save = slice(src, "async function saveDate() {", "async function deleteDate(d: TourDate) {");
    expect(save.indexOf("await load();")).toBeGreaterThan(save.indexOf("throw new Error(apiErrorMessage(data"));
  });
});
