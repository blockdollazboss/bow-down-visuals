/**
 * CalendarAutofill (wave8 page component) — honest load standard
 * (deep-pins tranche 3, batch 7). The week read: non-ok throws into
 * the error line; a slots-less body becomes an empty array ONLY
 * through the Array.isArray guard on an ok answer. The empty week
 * is LABELED sample content — the ghost week renders under an
 * explicit "Ghost sample week" comment, pointer-events-none and
 * aria-hidden, beneath a Plan My Week call to action — pinned as
 * the documented labeled-sample pattern, never a fake schedule (it
 * renders only when the loaded week is genuinely empty and not
 * loading). The autofill run keeps its four outcomes separate:
 * decline, 402 (OutOfCredits), non-ok (error line), ok (slots from
 * the answer). The drag-move is optimistic WITH a rollback: a
 * failed save sets the error AND reloads the week from the server,
 * so the board never keeps a move the rail refused. Delete asks
 * window.confirm first and removes the slot only after an ok.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CalendarAutofill.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the week read + the labeled ghost week", () => {
  it("loadSlots throws non-ok into the error line; slots settle only through the array guard", () => {
    const loader = slice(src, "const loadSlots = useCallback(", "useEffect(() => {\n    void loadSlots(weekStart);");
    expect(loader).toContain("if (!res.ok) throw new Error(`HTTP ${res.status}`);");
    expect(loader).toContain("setSlots(Array.isArray(data.slots) ? data.slots : []);");
    expect(loader).toContain('setError(t("wave8.calendar.errorLoad"));');
    expect(loader).toContain("setLoading(false);");
  });

  it("the ghost week is labeled sample content, inert and hidden from AT, only on a genuinely empty week", () => {
    expect(src).toContain("/* Ghost sample week shown when the week is truly empty — sells the future. */");
    expect(src).toContain("const isEmptyWeek = slots.length === 0 && !loading;");
    expect(src).toContain('aria-hidden="true"');
    expect(src).toContain("pointer-events-none select-none");
    expect(src).toContain('t("wave8.calendar.ghostCtaSub")');
  });
});

describe("autofill + slot writes — outcomes stay separate", () => {
  it("autofill: decline, 402 and non-ok are three different endings", () => {
    const body = slice(src, "async function handleAutofill() {", "async function handleDropDay(dayIndex: number) {");
    expect(body).toContain("/* User cancelled the credit confirmation. */");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok) throw new Error(`HTTP ${res.status}`);");
    expect(body.indexOf("setSlots(Array.isArray(data.slots) ? data.slots : []);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
  });

  it("the drag-move is optimistic WITH a server-truth rollback on failure", () => {
    const body = slice(src, "async function handleDropDay(dayIndex: number) {", "async function handleDelete(id: string) {");
    expect(body).toContain("/* Optimistic move. */");
    expect(body).toContain('if (!res || !res.ok) throw new Error("save failed");');
    expect(body).toContain('setError(t("wave8.calendar.errorSave"));');
    expect(body).toContain("void loadSlots(weekStart);");
    expect(body.indexOf("void loadSlots(weekStart);")).toBeGreaterThan(body.indexOf("/* Optimistic move. */"));
  });

  it("delete confirms first and removes the slot only after an ok", () => {
    const body = slice(src, "async function handleDelete(id: string) {", "function handleOpenComposer(slot: CalendarSlot) {");
    expect(body).toContain('if (!window.confirm(t("wave8.calendar.deleteConfirm"))) return;');
    expect(body).toContain('if (!res || !res.ok) throw new Error("delete failed");');
    expect(body.indexOf("setSlots((prev) => prev.filter((s) => s.id !== id));")).toBeGreaterThan(body.indexOf('throw new Error("delete failed")'));
  });
});
