/**
 * PressReleasePanel — honest load standard (deep-pins
 * tranche 5). The saved list is the PARENT's data (kit prop)
 * — this panel owns no list load, so nothing here can dress
 * a failed fetch as an empty kit. Its own rails are pinned:
 * generate lands the release only on a checked ok (402 is
 * the OutOfCredits panel, any other non-ok is the server's
 * error line, and neither touches the release state); save
 * and delete call onKitUpdated only after res.ok, so the
 * parent's kit is never repainted from an unchecked write.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PressReleasePanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("generate — the release exists only past the gate", () => {
  it("402 returns as OutOfCredits; non-ok returns as the error line; setRelease sits past both", () => {
    const body = slice(src, "if (res.status === 402) { setOutOfCredits(true); return; }", "navigator.clipboard.writeText(text).catch(() => {});");
    expect(body).toContain('if (!res.ok) { setError(apiErrorMessage(data, p("errors.generationFailed"))); return; }');
    expect(body).toContain("setRelease(data.release as GeneratedRelease);");
    expect(body.indexOf('if (!res.ok) { setError(apiErrorMessage(data, p("errors.generationFailed"))); return; }')).toBeLessThan(
      body.indexOf("setRelease(data.release as GeneratedRelease);"),
    );
    const s402 = slice(src, "async function handleGenerate() {", "setRelease(data.release as GeneratedRelease);");
    expect(s402).toContain("if (res.status === 402) { setOutOfCredits(true); return; }");
    expect(s402.indexOf("if (res.status === 402) {")).toBeLessThan(
      s402.indexOf('if (!res.ok) { setError(apiErrorMessage(data, p("errors.generationFailed"))); return; }'),
    );
  });
});

describe("save + delete — the parent kit moves only after ok", () => {
  it("save: onKitUpdated sits after the !ok return; failure keeps the release on screen", () => {
    const body = slice(src, "if (!res.ok) { setError(apiErrorMessage(data, p(\"errors.saveFailed\"))); return; }", "} catch {");
    expect(body).toContain("onKitUpdated({ ...kit, press_releases: [...savedReleases, entry] });");
    expect(body).toContain("setRelease(null);");
    expect(body.indexOf("onKitUpdated({ ...kit, press_releases: [...savedReleases, entry] });")).toBeLessThan(
      body.indexOf("setRelease(null);"),
    );
  });

  it("delete: the shortened kit is published only past its ok check", () => {
    const del = slice(src, "async function handleDeleteRelease(id: string) {", "return (");
    expect(del).toContain("onKitUpdated({ ...kit, press_releases: next });");
    expect(del.indexOf("if (!res.ok) {")).toBeLessThan(del.indexOf("onKitUpdated({ ...kit, press_releases: next });"));
    const failPart = slice(del, "if (!res.ok) {", "onKitUpdated({ ...kit, press_releases: next });");
    expect(failPart).not.toContain("onKitUpdated");
  });
});
