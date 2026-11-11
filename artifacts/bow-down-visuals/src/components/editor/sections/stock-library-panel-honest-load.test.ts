/**
 * StockLibraryPanel — honest load standard (deep-pins tranche 3,
 * batch 8). The search is an explicit action, not a mount load, and
 * its states stay separate: a 503 / stock_not_configured answer is
 * the named not-set-up state (items cleared, no fake results); a
 * non-ok throws the server's words into the error line (items
 * cleared with it); results and the searched flag land only from an
 * ok answer, so the empty-results copy can only follow a real
 * search. The import (50 Bucs): a decline returns before anything;
 * the scene is appended, the hub asset added and the success toast
 * shown ONLY on res.ok AND success AND a returned item — anything
 * else throws into the failure toast, and no scene is ever added
 * for an import the rail didn't confirm.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StockLibraryPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("search — not-configured, error and results stay separate", () => {
  it("503/not_configured is its own state; non-ok throws; results land only from an ok answer", () => {
    const body = slice(src, "const runSearch = useCallback(async (nextPage: number) => {", "const handleImport = useCallback(");
    expect(body).toContain('if (res.status === 503 || data.error === "stock_not_configured") {');
    expect(body).toContain("setNotConfigured(true);");
    expect(body).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, tr(\"errorGeneric\", { status: res.status })));");
    expect(body.indexOf("setSearched(true);")).toBeGreaterThan(body.indexOf("if (!res.ok) throw"));
    expect(body).toContain("setError(plainErrorText(err, tr(\"errorGenericFallback\")));");
  });
});

describe("import — the scene lands only on a confirmed import", () => {
  it("decline returns; ok+success+item all gate the append and the toast", () => {
    const body = slice(src, "const handleImport = useCallback(async (item: StockItem) => {", "const totalPages =");
    expect(body).toContain("if (res === null) return; // user cancelled the spend confirmation");
    expect(body).toContain("if (!res.ok || !data.success || !data.item) {");
    expect(body.indexOf("setScenes((prev) => [...prev, newScene]);")).toBeGreaterThan(body.indexOf("if (!res.ok || !data.success || !data.item) {"));
    expect(body.indexOf('toast({ title: tr("addedTitle"), description: imported.title });')).toBeGreaterThan(
      body.indexOf("setScenes((prev) => [...prev, newScene]);"),
    );
  });
});
