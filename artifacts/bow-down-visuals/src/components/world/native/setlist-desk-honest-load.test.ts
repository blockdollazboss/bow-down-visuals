/**
 * SetlistDesk (World native) — honest load standard
 * (deep-pins tranche 5). The setlist itself is local state
 * (built song by song on the desk), so its empty line is an
 * honest local empty. The server surface is the on-demand
 * song library: while library is null the desk shows the
 * load button (busy-labelled while in flight); a failed
 * load leaves library null, sets libraryError, and the
 * button stays for a retry — the "everything's already in
 * the set" line (picks empty) can only render after a
 * successful load put a library in hand. The paid flow
 * suggestion follows the house law: cancel silent, 402 /
 * out_of_credits its own state, an unparseable flow is
 * "unusable" — never applied.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SetlistDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the library load — failure keeps the door, never fakes the shelf", () => {
  it("throws on !ok and on an unparseable body; the catch sets the error and writes no library", () => {
    const body = slice(src, "async function loadLibrary() {", "async function suggestFlow() {");
    expect(body).toContain('if (!res.ok) throw new Error("library failed");');
    expect(body).toContain('if (!parsed) throw new Error("library failed");');
    expect(body).toContain("setLibrary(parsed);");
    expect(body.indexOf('if (!parsed) throw new Error("library failed");')).toBeLessThan(body.indexOf("setLibrary(parsed);"));
    const catchPart = slice(body, "} catch {", "} finally {");
    expect(catchPart).toContain('setLibraryError(t("worldScheduleRelease.setLibraryFailed"));');
    expect(catchPart).not.toContain("setLibrary(");
  });

  it("render: null library is the load button; the all-in line needs a loaded library; the error line sits under both", () => {
    const body = slice(src, "{library === null ? (", "{songs.length === 0 ? (");
    expect(body).toContain('data-testid="world-setlist-desk-library-open"');
    expect(body).toContain('data-testid="world-setlist-desk-library"');
    expect(body).toContain('{t("worldScheduleRelease.setLibraryAllIn")}');
    expect(body).toContain("{libraryError ? <p className={`mt-1 ${errCls}`}>{libraryError}</p> : null}");
    expect(body.indexOf("{library === null ? (")).toBeLessThan(body.indexOf('{t("worldScheduleRelease.setLibraryAllIn")}'));
  });

  it("the setlist empty is a local empty, rendered from the local list alone", () => {
    expect(src).toContain('data-testid="world-setlist-desk-empty"');
    expect(src).toContain('{t("worldScheduleRelease.setEmpty")}');
  });
});

describe("the flow suggestion — applied only from a usable body", () => {
  it("cancel silent; 402/out_of_credits own state; !ok throws; an unusable flow throws before setFlow", () => {
    const body = slice(src, "async function suggestFlow() {", "function applyFlow() {");
    expect(body).toContain("if (!res) return;");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(body).toContain('throw new Error(apiErrorMessage(data, t("worldScheduleRelease.setFlowFailedRefund")));');
    expect(body).toContain("const built = flowOfResponse(data, songs.length);");
    expect(body).toContain('if (!built) throw new Error(t("worldScheduleRelease.setFlowUnusable"));');
    expect(body).toContain("setFlow(built);");
    expect(body.indexOf('if (!built) throw new Error(')).toBeLessThan(body.indexOf("setFlow(built);"));
  });
});
