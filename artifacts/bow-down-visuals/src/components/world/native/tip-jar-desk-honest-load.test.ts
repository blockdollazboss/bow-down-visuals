/**
 * TipJarDesk (World native) — honest load standard
 * (deep-pins tranche 5). Early-return render law: a failed
 * dashboard load returns the loadFailed card (with a Try
 * again that re-runs the load) BEFORE the loading card, and
 * the loading card shows only while dashboard is null — so
 * "no jar yet" (a loaded dashboard with hasPage false) can
 * never be painted by a failure. The load throws on !ok and
 * on an unparseable body; the settings sub-load is tolerant
 * by design (documented: its failure never swaps the
 * dashboard into the error state — the form stays in create
 * dress). Save claims its note only past the ok gate, then
 * reloads the dashboard.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TipJarDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the dashboard load — failed, loading, loaded are three different cards", () => {
  it("throws on !ok and on an unparseable body; only a parsed dashboard clears loadFailed", () => {
    const body = slice(src, "const load = useCallback(async () => {", "const save = async () => {");
    expect(body).toContain('if (!res.ok) throw new Error("dashboard");');
    expect(body).toContain("const parsed = parseTipJarDashboard(await res.json());");
    expect(body).toContain('if (!parsed) throw new Error("dashboard");');
    expect(body).toContain("setDashboard(parsed);");
    expect(body).toContain("setLoadFailed(false);");
    expect(body.indexOf('if (!parsed) throw new Error("dashboard");')).toBeLessThan(body.indexOf("setDashboard(parsed);"));
    const catchPart = slice(body, "} catch {", "// eslint-disable-next-line react-hooks/exhaustive-deps");
    expect(catchPart).toContain("setLoadFailed(true);");
    expect(catchPart).not.toContain("setDashboard");
  });

  it("render order: the failed card returns before the loading card, which needs dashboard null", () => {
    expect(src).toContain("if (loadFailed) {");
    expect(src).toContain('data-testid="world-tipjar-retry"');
    expect(src).toContain('{t("worldIdentityMisc.jarLoadFailed")}');
    expect(src).toContain("if (dashboard === null) {");
    expect(src).toContain('{t("worldIdentityMisc.jarLoading")}');
    expect(src.indexOf("if (loadFailed) {")).toBeLessThan(src.indexOf("if (dashboard === null) {"));
  });

  it("the settings sub-load is tolerant by comment and by shape: ok-gated, catch writes nothing", () => {
    const body = slice(src, "const load = useCallback(async () => {", "const save = async () => {");
    expect(body).toContain("if (sres.ok) {");
    expect(body).toContain("if (settings) setForm(settings);");
    expect(body).toContain("} catch { /* tolerant — the page treats it the same way */ }");
    const tolerant = slice(body, "if (sres.ok) {", "} catch {");
    expect(tolerant).not.toContain("setLoadFailed");
  });
});

describe("the save — note only past the gate, then a reload", () => {
  it("!ok throws the server's line; the saved note and reload sit past it", () => {
    const body = slice(src, "const save = async () => {", "const muted =");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.jarSaveError")));');
    expect(body).toContain('setSavedNote(t("worldIdentityMisc.jarSavedNote"));');
    expect(body).toContain("await load();");
    expect(body.indexOf('if (!res.ok) throw new Error(')).toBeLessThan(
      body.indexOf('setSavedNote(t("worldIdentityMisc.jarSavedNote"));'),
    );
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain("setSaveError(plainErrorText(e,");
    expect(catchPart).not.toContain("setSavedNote");
  });
});
