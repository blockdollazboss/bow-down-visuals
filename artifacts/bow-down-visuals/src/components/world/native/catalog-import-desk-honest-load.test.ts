/**
 * CatalogImportDesk (World native) — honest load standard
 * (deep-pins tranche 5). Early-return render law shared
 * with its TipJarDesk sibling: the loadFailed card (error
 * line + Try again re-running the load) returns BEFORE the
 * loading card, and the loading card shows only while the
 * catalog state is null — a failed first load can therefore
 * never paint the desk's empty import state. The load
 * throws on !ok and on an unparseable body; only a parsed
 * state clears the flag. Row actions follow the same law
 * (each throws on !ok before any state moves), and per the
 * file's own header, blocked and failed rows stay visible
 * with their notes and their retry — never silently
 * dropped.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CatalogImportDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the catalog load — failed, loading, loaded in that order", () => {
  it("throws on !ok and on an unparseable body; only a parsed state clears loadFailed", () => {
    const body = slice(src, "const load = useCallback(async () => {", "useEffect(() => {\n    void load();");
    expect(body).toContain('if (!res.ok) throw new Error("load failed");');
    expect(body).toContain("const parsed = catalogStateOf(await res.json().catch(() => ({})));");
    expect(body).toContain('if (!parsed) throw new Error("load failed");');
    expect(body).toContain("setState(parsed);");
    expect(body).toContain("setLoadFailed(false);");
    expect(body.indexOf('if (!parsed) throw new Error("load failed");')).toBeLessThan(body.indexOf("setState(parsed);"));
    const catchPart = slice(body, "} catch {", "}, [deskHeaders]);");
    expect(catchPart).toContain("setLoadFailed(true);");
    expect(catchPart).not.toContain("setState");
  });

  it("render: the failed card returns before the loading card, which requires a null state", () => {
    expect(src).toContain("if (loadFailed) {");
    expect(src).toContain('data-testid="world-catalog-desk-failed"');
    expect(src).toContain('{t("worldCatalogLibrary.importLoadError")}');
    expect(src).toContain("onClick={() => void load()}");
    expect(src).toContain('{t("worldCatalogLibrary.sharedTryAgain")}');
    expect(src).toContain("if (!state) {");
    expect(src).toContain('{t("worldCatalogLibrary.importLoading")}');
    expect(src.indexOf("if (loadFailed) {")).toBeLessThan(src.indexOf("if (!state) {"));
  });
});

describe("row actions — the same gate", () => {
  it("the shared action rail throws on !ok before any row state can move", () => {
    const body = slice(src, "const res = await fetch(path, {", "const uploadOne = async");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCatalogLibrary.importActionError")));');
  });
});
