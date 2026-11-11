/**
 * ActionTrackerPanel — honest load standard (deep-pins tranche 3,
 * batch 4). The coach's persistent tracker panel.
 *
 * The load is TWO independent legs (plan numbers + action items)
 * settled with Promise.allSettled — the component's own comment
 * records the standard (S27-34): "one source failing shows its own
 * error in its own section instead of discarding the section that
 * loaded." Each leg throws on a null response and on non-ok BEFORE
 * returning data; each failure lands in its OWN section error
 * (numbersError / itemsError) with a Retry wired to the real load.
 * The honest states never dress up: numbers with no data render the
 * "Not enough data yet" card ("computed from your numbers, never
 * invented"), and the items empty copy renders only inside the
 * itemsError-free arm on a successful empty read.
 *
 * Writes pin as-is: the goal save throws on non-ok before the
 * "Goal saved" message (a failure lands in the same message slot as
 * an error, never as the saved copy); toggle throws on non-ok OR a
 * missing item before the list updates; add throws on non-ok before
 * appending; delete throws on non-ok before filtering — a failed
 * delete never removes the row from the screen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ActionTrackerPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — two legs settle independently, each failure in its own section", () => {
  it("both legs throw on a null response and on non-ok before returning data", () => {
    const load = slice(src, "const load = useCallback(async () => {", "useEffect(() => {");
    expect(load).toContain('confirmedFetch("/api/coach/plan-numbers", { skipConfirm: true })');
    expect(load).toContain('confirmedFetch("/api/coach/action-items", { skipConfirm: true })');
    expect(load).toContain("if (!res) throw new Error(");
    expect(load).toContain("if (!res.ok) throw new Error(apiErrorMessage(data,");
    expect(load).toContain("return Array.isArray(data.items) ? data.items : [];");
  });

  it("settled outcomes route to their own state — one failure never discards the other section", () => {
    const load = slice(src, "const load = useCallback(async () => {", "useEffect(() => {");
    expect(load).toContain("await Promise.allSettled([loadNumbers(), loadItems()])");
    expect(load).toContain('if (numSettled.status === "fulfilled") setNumbers(numSettled.value);');
    expect(load).toContain("else setNumbersError(plainErrorText(numSettled.reason,");
    expect(load).toContain('if (itemSettled.status === "fulfilled") setItems(itemSettled.value);');
    expect(load).toContain("else setItemsError(plainErrorText(itemSettled.reason,");
    expect(load).toContain("setLoading(false)");
  });

  it("the panel-level loading gate renders before any section, and signed-out is its own state", () => {
    expect(src).toContain("if (!user) {");
    expect(src).toContain('t("coachTracker.signInPrompt"');
    expect(src).toContain("if (loading) {");
    expect(src.indexOf("if (loading) {")).toBeGreaterThan(src.indexOf("if (!user) {"));
  });

  it("honest states: numbers-no-data is its own card; the items empty renders only error-free", () => {
    expect(src).toContain("numbers && !numbers.hasData");
    expect(src).toContain("computed from your numbers, never invented.");
    const itemsBlock = slice(src, "{itemsError ? (", "{items.map((item)");
    expect(itemsBlock).toContain("onClick={load}");
    expect(itemsBlock).toContain(") : items.length === 0 ? (");
    expect(itemsBlock).toContain('t("coachTracker.itemsEmpty"');
  });
});

describe("writes — checked before any success state", () => {
  it("goal save: non-ok throws before the saved message; the message slot carries failures as errors", () => {
    const body = slice(src, "async function saveGoal(", "async function toggleItem(");
    expect(body).toContain("if (!res.ok) throw new Error(");
    expect(body).toContain('t("coachTracker.goalCleared"');
    expect(body).toContain('t("coachTracker.goalSaved"');
    expect(body.indexOf('t("coachTracker.goalSaved"')).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain("setGoalMsg(plainErrorText(err,");
    expect(body).toContain("setGoalSaving(false)");
  });

  it("toggle: non-ok or a missing item throws before the row updates", () => {
    const body = slice(src, "async function toggleItem(", "async function addItem()");
    expect(body).toContain("if (!res.ok || !data.item) throw new Error(apiErrorMessage(data, \"Update failed.\"));");
    expect(body.indexOf("setItems((prev) => prev.map(")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.item)"));
  });

  it("add: non-ok throws before appending; the draft clears only on success", () => {
    const body = slice(src, "async function addItem() {", "async function deleteItem(");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Save failed."));');
    expect(body.indexOf("setNewTitle(\"\")")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
  });

  it("delete: non-ok throws before the row leaves the screen", () => {
    const body = slice(src, "async function deleteItem(", "if (!user) {");
    expect(body).toContain('if (!res.ok) throw new Error("Delete failed.");');
    expect(body.indexOf("setItems((prev) => prev.filter(")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
  });
});
