/**
 * ProductPhotoStudio — honest load standard (deep-pins
 * tranche 5). There is no mount list load to dress up: the
 * recents list is a best-effort picker (its failure simply
 * leaves the picker unpopulated — no fake empty state is
 * rendered from it). The generation rail is the pinned
 * surface: a cancelled credit confirmation (confirmedFetch
 * returns null) ends silently with no error and no result;
 * the result is set only when res.ok AND the job status is
 * "succeeded" AND a url came back — anything else throws the
 * server's words; out_of_credits gets its own line. The
 * upload rail checks both legs (presign, then the PUT) with
 * throws before the product url is set.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ProductPhotoStudio.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("generation — a result exists only after ok + succeeded + url", () => {
  it("cancel is silent; the triple gate stands before setResult; out_of_credits is its own ending", () => {
    const body = slice(src, "async function startGeneration() {", "const chipClass = (active: boolean) =>");
    expect(body).toContain("if (!res) { setGenerating(false); return; } // user cancelled the credit confirmation");
    expect(body).toContain('if (!res.ok || data.status !== "succeeded" || !data.url) {');
    expect(body).toContain("setResult({ url: data.url, path: data.path ?? null });");
    expect(body).toContain("onGenerated?.(data.url, data.path ?? null);");
    expect(body.indexOf("if (!res) { setGenerating(false); return; }")).toBeLessThan(
      body.indexOf('if (!res.ok || data.status !== "succeeded" || !data.url) {'),
    );
    expect(body.indexOf('if (!res.ok || data.status !== "succeeded" || !data.url) {')).toBeLessThan(
      body.indexOf("setResult({ url: data.url, path: data.path ?? null });"),
    );
    const catchPart = slice(body, "} catch (e) {", "} finally {");
    expect(catchPart).toContain('msg === "out_of_credits"');
    expect(catchPart).not.toContain("setResult");
  });
});

describe("upload + recents — checked legs, honest best-effort", () => {
  it("presign and PUT both throw on !ok before the product url lands", () => {
    const body = slice(src, "if (!presign.ok) throw new Error(", "async function loadRecent()");
    expect(body).toContain('if (!presign.ok) throw new Error(tr("errorUpload", "Could not start the upload. Try again."));');
    expect(body).toContain("if (!put.ok) throw new Error(");
    expect(body.indexOf("if (!presign.ok) throw new Error(")).toBeLessThan(body.indexOf("if (!put.ok) throw new Error("));
    const catchPart = slice(body, "} catch (e) {", "async function loadRecent()");
    expect(catchPart).toContain("setError(plainErrorText(e,");
    expect(catchPart).not.toContain("setProductUrl");
  });

  it("recents: a failed list writes nothing and renders no fake state from it", () => {
    const body = slice(src, "async function loadRecent() {", "/* ── Generation (synchronous");
    expect(body).toContain("} catch { /* best-effort */ }");
    const catchPart = slice(body, "} catch { /* best-effort */ }", "/* ── Generation (synchronous");
    expect(catchPart).not.toContain("setRecent([])");
    expect(catchPart).not.toContain("setError");
  });
});
