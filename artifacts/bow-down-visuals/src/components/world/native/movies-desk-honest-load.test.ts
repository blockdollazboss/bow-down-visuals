/**
 * MoviesDesk (World native) — honest load standard
 * (deep-pins tranche 5). No mount list load: the desk's
 * history is session-built. The pinned surface is the paid
 * run in both modes (concept / clip detection), which
 * follows the house law AND a shape-guard on top: cancel is
 * silent; 402 / out_of_credits is its own state; a non-ok
 * answer is the server's message as a note; and an ok
 * answer whose body drifts from the expected shape is a
 * FAILED make (its own empty-result note) — rows are never
 * dressed up from an unparseable win, and the concept is
 * set (and lands in history / the hub) only from a parsed
 * body.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MoviesDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the run — a drifted body is a failed make, never a win", () => {
  it("cancel silent; 402 own state; !ok notes the server's words; the shape-guard stands before setConcept", () => {
    const body = slice(src, "const run = async () => {", "const restoreHistory =");
    expect(body).toContain("if (!res) return; // spend confirmation declined — nothing ran");
    expect(body).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(body).toContain("setOutOfCredits(true);");
    expect(body).toContain("if (!res.ok) {");
    expect(body).toContain('setNote(apiErrorMessage(d, t("worldCatalogLibrary.moviesFailStudio")));');
    expect(body).toContain("const parsed = conceptOfResponse(data);");
    expect(body).toContain('setNote(t("worldCatalogLibrary.moviesFailConceptEmpty"));');
    expect(body).toContain("setConcept(parsed);");
    expect(body.indexOf("const parsed = conceptOfResponse(data);")).toBeLessThan(body.indexOf("setConcept(parsed);"));
    const guard = slice(body, "const parsed = conceptOfResponse(data);", "setConcept(parsed);");
    expect(guard).toContain("if (!parsed) {");
    expect(guard).toContain("return;");
  });

  it("clip mode carries the same guard; the catch notes the studio failure and busy settles", () => {
    const body = slice(src, "const run = async () => {", "const restoreHistory =");
    expect(body).toContain("const parsed = detectionOfResponse(data);");
    expect(body).toContain('setNote(t("worldCatalogLibrary.moviesFailClipsEmpty"));');
    expect(body).toContain("setDetection(parsed.detection);");
    expect(body.indexOf("const parsed = detectionOfResponse(data);")).toBeLessThan(
      body.indexOf("setDetection(parsed.detection);"),
    );
    const catchPart = slice(body, "    } catch {\n      setNote(", "} finally {");
    expect(catchPart).toContain('setNote(t("worldCatalogLibrary.moviesFailStudio"));');
    expect(catchPart).not.toContain("setConcept");
    expect(catchPart).not.toContain("setDetection");
    // the one inner catch is the documented non-fatal hub landing, and it sets nothing
    expect(body).toContain("} catch { /* hub unavailable — non-fatal, as on the page */ }");
  });
});
