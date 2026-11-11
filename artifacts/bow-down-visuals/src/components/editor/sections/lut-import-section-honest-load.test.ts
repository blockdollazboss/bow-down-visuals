/**
 * LutImportSection — honest load standard (deep-pins tranche 3,
 * batch 2). Docks inside the Video Editor Color panel.
 *
 * The load is TWO-legged (house presets + my saved LUTs, via
 * confirmedFetch skipConfirm): a leg fails if it resolves null OR
 * non-ok, and ANY leg failure sets loadFailed — the loader's own
 * comment records the standard: "A failed load is NOT an empty
 * library." The failure banner renders with a Retry wired to the
 * real loadAll. The My LUTs section renders only on a real non-empty
 * read (myLuts.length > 0) — there is no fake-empty copy for a
 * failed read to dress up as. The clips.length === 0 early return is
 * a props state (no clips on the timeline), not a load state.
 *
 * Writes pin as-is, all checked before success:
 * - validate: non-ok or valid=false → the server's error line.
 * - save upload: non-ok → error line; the post-save re-select read is
 *   BEST-EFFORT BY DOCUMENTED DESIGN (its catch comment states the
 *   save stands and the list already refreshed via loadAll) — pinned
 *   as that documented exception, never as the save's failure path.
 * - delete: res.ok updates the list + toasts; anything else gets the
 *   destructive "Couldn't delete" toast — never a silent removal.
 * - preview: non-ok → the server's message; apply (150 VB, cost
 *   single-sourced from the credit registry): decline (null) returns,
 *   non-ok or a missing url → "no Visual Bucs were spent"; the
 *   result is only ever set from a real returned url.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LutImportSection.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("load — any failed leg raises the failure banner, never an empty library", () => {
  it("both legs fail on null or non-ok, and the failure flag is set from the union", () => {
    const loader = slice(src, "const loadAll = useCallback(async () => {", "}, [confirmedFetch]);");
    expect(loader).toContain('confirmedFetch("/api/lut/presets", { skipConfirm: true })');
    expect(loader).toContain('confirmedFetch("/api/lut/my", { skipConfirm: true })');
    expect(loader).toContain("} else failed = true;");
    expect(loader.trimEnd().endsWith("setLoadFailed(failed);")).toBe(true);
    expect(loader).not.toContain("if (pr?.ok) setLoadFailed");
  });

  it("the failure banner renders with a retry wired to the real loader", () => {
    expect(src).toContain("{loadFailed && (");
    expect(src).toContain('data-testid="btn-retry-luts"');
    expect(src).toContain("onClick={() => void loadAll()}");
    expect(src).toContain("Couldn't load the LUT library");
  });

  it("My LUTs renders only on a real non-empty read — no empty-library copy exists", () => {
    expect(src).toContain("{myLuts.length > 0 && (");
    expect(src).not.toContain("No LUTs saved");
    expect(src).not.toContain("No saved LUTs");
  });

  it("the no-clips early return is a props state, not a load state", () => {
    expect(src).toContain("if (clips.length === 0) {");
    expect(src).toContain("No clips on the timeline yet");
  });
});

describe("writes — checked before success", () => {
  it("validate: non-ok or an invalid verdict lands in the error line before any source is set", () => {
    const body = slice(src, "async function handleFilePicked(", "/* ── Save an uploaded LUT");
    expect(body).toContain("if (!res!.ok || !data.valid) {");
    expect(body.indexOf('setSource({ kind: "upload"')).toBeGreaterThan(body.indexOf("if (!res!.ok || !data.valid)"));
  });

  it("save: non-ok → error line; the re-select read is the documented best-effort exception", () => {
    const body = slice(src, "async function handleSaveUpload() {", "async function handleDeleteSaved(");
    expect(body).toContain("if (!res!.ok) {");
    expect(body).toContain('setError(apiErrorMessage(data, "Couldn\'t save that LUT."))');
    expect(body.indexOf('toast({ title: "Saved to My LUTs"')).toBeGreaterThan(body.indexOf("if (!res!.ok) {"));
    expect(body).toContain("the save stands; the list above already refreshed");
  });

  it("delete: the list updates only on res.ok; anything else is the destructive toast", () => {
    const body = slice(src, "async function handleDeleteSaved(", "/* ── Build the multipart payload");
    expect(body).toContain("if (res?.ok) {");
    expect(body).toContain("setMyLuts((prev) => prev.filter((l) => l.id !== id))");
    expect(body).toContain('toast({ title: "Couldn\'t delete that LUT — try again.", variant: "destructive" })');
  });

  it("preview throws the server's message on non-ok before any preview url is minted", () => {
    const body = slice(src, "async function handlePreview() {", "/* ── Paid apply");
    expect(body).toContain("if (!res!.ok) {");
    expect(body).toContain('setError(apiErrorMessage(data, "Preview failed."))');
    expect(body.indexOf("setPreviewUrl(")).toBeGreaterThan(body.indexOf("if (!res!.ok) {"));
  });

  it("apply: decline returns, non-ok or missing url spends nothing, result only from a real url", () => {
    const body = slice(src, "async function handleApply() {", "/* ── Handoff: use the graded clip");
    expect(body).toContain("if (res === null) return; // user cancelled the credit confirm");
    expect(body).toContain("if (!res.ok || !data.url) {");
    expect(body).toContain('"LUT apply failed — no Visual Bucs were spent."');
    expect(body.indexOf("setResult({ url: data.url!")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.url)"));
    expect(body).toContain("overrideCost: APPLY_COST");
  });

  it("the apply cost is single-sourced from the credit registry", () => {
    expect(src).toContain('const APPLY_COST = getCreditCost("/api/apply-lut")?.cost ?? 150;');
  });
});
