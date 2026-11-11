/**
 * CatalogExportDesk (the in-World catalog export builder)
 * — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * - LOCAL VALIDATION SPEAKS FIRST: a problem with the
 *   export request sets the error AND clears any previous
 *   result (`setResult(null)`) before any call — a stale
 *   export link can never sit beside a new, invalid request
 *   as if it were its output.
 * - THE BUILD call branches on non-ok with the server's
 *   message read from the body; the download/result renders
 *   only from the proven build response.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CatalogExportDesk.tsx");

describe("validation clears the old result before any call", () => {
  it("the problem branch and the build gate are pinned", () => {
    expect(src).toContain("if (problem) { setError(problem); setResult(null); return; }");
    expect(src).toContain('setError(plainErrorText(e, t("worldCatalogLibrary.exportBuildError")));');
  });
});
