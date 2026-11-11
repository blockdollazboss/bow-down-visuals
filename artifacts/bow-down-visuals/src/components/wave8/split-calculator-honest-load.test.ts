/**
 * SplitCalculator (wave8 page component) — honest load standard
 * (deep-pins tranche 3, batch 7). One list load with the family
 * shape: signed-out is its own state; loading; error panel with a
 * retry wired to the real loadSheets; the empty line only from a
 * successful zero-read. The create form validates client-side
 * (title, named rows, shares summing to exactly 100 — the save
 * button itself is gated on formValid) and prepends only a parsed
 * sheet. Delete is a two-tap confirm and removes the row only after
 * an ok. The PDF finalize: a decline returns with nothing run, 402
 * is the named out-of-credits card error, non-ok throws — the PDF
 * builds only from an ok audited payload. Post-to-ledger is the
 * family's most honest write: EVERY collaborator row carries its
 * own status (posting / posted / failed), a row flips to posted
 * only on res + ok + entry, and the summary line counts the real
 * split (all-posted vs partial with exact numbers) — a partial
 * failure is never dressed as done.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SplitCalculator.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the sheets load — four states, honestly separated", () => {
  it("signed-out short-circuits; failure is the error panel; empty only from a zero-read", () => {
    const loader = slice(src, "async function loadSheets() {", "useEffect(() => {\n    loadSheets();");
    expect(loader).toContain("if (!user) {");
    expect(loader).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"wave8.splits.errorLoad\")));");
    const loadingAt = src.indexOf("{loading ? (");
    const errorAt = src.indexOf(") : error ? (");
    const emptyAt = src.indexOf(") : sheets.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(src).toContain("onClick={loadSheets}");
  });

  it("the form refuses an invalid split before any call (shares must total exactly 100)", () => {
    expect(src).toContain("return Math.abs(totalPct - 100) < 0.001;");
    expect(src).toContain("disabled={saving || !formValid}");
    const save = slice(src, "async function handleSave() {", "async function handleDelete(id: string) {");
    expect(save).toContain("if (!res.ok || !data.sheet) throw new Error(apiErrorMessage(data, t(\"wave8.splits.errorSave\")));");
    expect(save.indexOf("setSheets((prev) => [data.sheet!, ...prev]);")).toBeGreaterThan(save.indexOf("if (!res.ok || !data.sheet) throw"));
  });
});

describe("delete + PDF — checked before state moves", () => {
  it("delete removes the row only after an ok, behind a two-tap confirm", () => {
    const body = slice(src, "async function handleDelete(id: string) {", "/* Paid: finalize");
    expect(body).toContain("if (!res.ok) {");
    expect(body.indexOf("setSheets((prev) => prev.filter((s) => s.id !== id));")).toBeGreaterThan(body.indexOf("if (!res.ok) {"));
    expect(src).toContain("onClick={() => setConfirmDeleteId(sheet.id)}");
    expect(src).toContain("onClick={() => handleDelete(sheet.id)}");
  });

  it("the PDF builds only from an ok finalize answer; 402 is named; decline runs nothing", () => {
    const body = slice(src, "async function handleGeneratePdf(sheet: SplitSheet) {", "/* Free: post a received royalty payment");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirm");
    expect(body).toContain("if (res.status === 402) throw new Error(t(\"wave8.splits.outOfCredits\"));");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, t(\"wave8.splits.errorPdf\")));");
    expect(body.indexOf("await buildSplitPdf(data);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
  });
});

describe("post-to-ledger — per-row truth, partial never dressed as done", () => {
  it("each row posts or fails on its own; the summary counts the real split", () => {
    const body = slice(src, "async function handlePostToLedger(sheet: SplitSheet) {", "const meterOk =");
    expect(body).toContain("if (!res || !res.ok || !data.entry) {");
    expect(body).toContain('setRowStatus((prev) => ({ ...prev, [key]: "posted" }));');
    expect(body).toContain('setRowStatus((prev) => ({ ...prev, [key]: "failed" }));');
    expect(body).toContain("const failed = sheet.collaborators.length - ok;");
    expect(body).toContain('t("wave8.splits.ledgerDone")');
    expect(body).toContain('t("wave8.splits.ledgerPartial", { ok, total: sheet.collaborators.length, failed })');
    expect(body.indexOf('t("wave8.splits.ledgerPartial"')).toBeGreaterThan(body.indexOf("const failed = sheet.collaborators.length - ok;"));
  });
});
