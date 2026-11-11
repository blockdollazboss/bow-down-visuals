/**
 * PressReleaseWriter — honest load standard (deep-pins tranche 3,
 * batch 9). The writer has no collection load — its standard lands
 * on the paid generate and the kit save. Generate: the form gate
 * (pressReleaseReady) refuses before any call; a decline returns
 * with nothing charged (its own comment); 402 is the named
 * out-of-credits ending; non-ok lands the server's words in the
 * error line and RETURNS — the release is set only from a parsed
 * answer (parseGeneratedRelease null is its own "shape" error, so
 * an ok-but-unreadable answer never becomes a release on screen).
 * The kit save throws on non-ok before its saved note, and the note
 * clears the moment a new generate starts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./PressReleaseWriter.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("generate — the release lands only from a parsed answer", () => {
  it("decline / 402 / non-ok / unparseable are four endings", () => {
    const body = slice(src, "async function generate() {", "function copyRelease() {");
    expect(body).toContain("if (!pressReleaseReady(form) || generating) return;");
    expect(body).toContain("if (!res) return; // the member declined the credit confirmation — nothing charged");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain('setError(apiErrorMessage(data, t("worldSponsorPress.prErrorWrite")));');
    expect(body).toContain("if (!parsed) {");
    expect(body).toContain('setError(t("worldSponsorPress.prErrorShape"));');
    expect(body.indexOf("setRelease(parsed);")).toBeGreaterThan(body.indexOf("if (!parsed) {"));
  });

  it("the kit save throws on non-ok before its saved note", () => {
    const body = src.slice(src.indexOf("async function saveToKit() {"));
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSponsorPress.prErrorSave")));');
  });
});
