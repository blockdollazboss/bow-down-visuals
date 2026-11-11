/**
 * SongStructureBuilder — honest load standard (deep-pins
 * tranche 4, batch ACE-fix). THE FIX is loadSaved: it clears
 * savedLoadError at the start, a non-ok answer sets
 * savedLoadError(true) in the else, and the catch sets
 * savedLoadError(true) too — setSaved runs only inside the
 * res.ok branch, so a failed load never reads as "no saved
 * structures". The saved panel renders in that order: the
 * savedLoading spinner, then the savedLoadError branch
 * (loadError copy + a Retry button calling loadSaved), then
 * the saved list, with the noSaved empty copy LAST. The rest
 * of the component was already honest and is pinned briefly:
 * generate splits decline / 402 / empty-arrangement, and
 * save and delete surface their errors under their own keys.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SongStructureBuilder.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("THE FIX — loadSaved never lets a failure read as an empty list", () => {
  it("clears the error at start; non-ok and catch both set it; setSaved runs only on res.ok", () => {
    const body = slice(src, "async function loadSaved() {", "void loadSaved();");
    expect(body).toContain("setSavedLoading(true);");
    expect(body).toContain("setSavedLoadError(false);");
    expect(body.indexOf("setSavedLoading(true);")).toBeLessThan(body.indexOf("setSavedLoadError(false);"));
    expect(body).toContain('const res = await fetch("/api/wave9a/structures", { headers: await authHeaders() });');
    expect(body).toContain("if (res.ok) {");
    expect(body).toContain("setSaved(data.structures ?? []);");
    expect(body).toContain("setSavedLoadError(true);");
    // setSaved( appears exactly once in the loader — inside the ok branch
    expect(body.split("setSaved(").length - 1).toBe(1);
    expect(body.indexOf("if (res.ok) {")).toBeLessThan(body.indexOf("setSaved(data.structures ?? []);"));
    expect(body.indexOf("setSaved(data.structures ?? []);")).toBeLessThan(body.indexOf("} else {"));
    // the else branch and the catch both land on the error flag
    const elsePart = slice(body, "} else {", "} catch {");
    expect(elsePart).toContain("setSavedLoadError(true);");
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain("setSavedLoadError(true);");
    expect(body).toContain("setSavedLoading(false);");
  });

  it("render order: spinner → loadError + Retry → list → the noSaved empty copy LAST", () => {
    const body = slice(src, "{savedLoading ? (", "{/* Handoffs */}");
    expect(body).toContain('{t("wave9.structure.loading")}');
    expect(body).toContain('{t("wave9.structure.loadError")}');
    expect(body).toContain("onClick={() => void loadSaved()}");
    expect(body).toContain('{t("common.retry")}');
    expect(body).toContain('{t("wave9.structure.noSaved")}');
    expect(body.indexOf("{savedLoading ? (")).toBeLessThan(body.indexOf(") : savedLoadError ? ("));
    expect(body.indexOf(") : savedLoadError ? (")).toBeLessThan(body.indexOf(") : saved.length > 0 ? ("));
    expect(body.indexOf(") : saved.length > 0 ? (")).toBeLessThan(body.indexOf('{t("wave9.structure.noSaved")}'));
    expect(body.indexOf('{t("wave9.structure.loadError")}')).toBeLessThan(
      body.indexOf("onClick={() => void loadSaved()}"),
    );
  });
});

describe("the already-honest flows, pinned briefly", () => {
  it("generate splits decline / 402 / empty-arrangement before any result is set", () => {
    const body = slice(src, "async function generate() {", "async function saveStructure() {");
    expect(body).toContain("if (!res) return; // user cancelled the credit confirmation");
    expect(body).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok || !Array.isArray(data.arrangement) || data.arrangement.length === 0) {");
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("wave9.structure.errorGeneric")));');
    expect(body).toContain("setResult(data);");
    expect(body.indexOf("if (!res) return;")).toBeLessThan(body.indexOf("if (res.status === 402"));
    expect(body.indexOf("if (!res.ok || !Array.isArray(data.arrangement)")).toBeLessThan(
      body.indexOf("setResult(data);"),
    );
  });

  it("save throws on non-ok and surfaces its error under the saveError key", () => {
    const body = slice(src, "async function saveStructure() {", "async function deleteSaved");
    expect(body).toContain('if (!res.ok) throw new Error("Save failed");');
    expect(body).toContain('setError(t("wave9.structure.saveError"));');
    expect(body.indexOf('if (!res.ok) throw new Error("Save failed");')).toBeLessThan(
      body.indexOf("await loadSaved();"),
    );
  });

  it("delete throws on non-ok and surfaces its error under the deleteError key", () => {
    const body = slice(src, "async function deleteSaved(id: string) {", "function loadIntoBuilder");
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("wave9.structure.deleteError")));');
    expect(body).toContain("setSaved((s) => s.filter((x) => x.id !== id));");
    expect(body).toContain('setError(plainErrorText(err, t("wave9.structure.deleteError")));');
    expect(body.indexOf('throw new Error(apiErrorMessage(data, t("wave9.structure.deleteError")));')).toBeLessThan(
      body.indexOf("setSaved((s) => s.filter((x) => x.id !== id));"),
    );
  });
});
