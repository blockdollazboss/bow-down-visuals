/**
 * CanvasGeneratorSection (the Spotify Canvas generator) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE GENERATE separates its outcomes: a declined credit
 *   confirmation clears the generating flag and claims
 *   nothing; a 402 lands on OutOfCredits; any other non-ok
 *   lands on the error line carrying the refund truth
 *   ("Your Visual Bucs were refunded."); the result url is
 *   set only from an ok response, and the add-to-assets /
 *   share actions exist only once a real resultUrl is in
 *   hand — nothing in the panel claims a canvas exists
 *   before one does.
 * - THE STYLES LOAD is a designed fallback, pinned as-is:
 *   the picker ships built-in offline styles and the server
 *   list replaces them ONLY when it is ok AND non-empty —
 *   a failed or empty read keeps real, pickable styles, so
 *   the picker never renders a fake empty.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CanvasGeneratorSection.tsx");

describe("the generate separates cancel, credits, failure, success", () => {
  it("each outcome lands on its own truthful state", () => {
    expect(src).toContain("/* User cancelled the credit confirmation. */");
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain("setOutOfCredits(true);");
    expect(src).toContain('setError(apiErrorMessage(data, "Canvas generation failed. Your Visual Bucs were refunded."));');
    expect(src).toContain("setResultUrl(data.url as string);");
    expect(src).toContain("setGenerating(false);");
  });

  it("asset and share actions exist only behind a real result", () => {
    expect(src).toContain("if (!resultUrl) return;");
  });
});

describe("the styles load is a designed fallback", () => {
  it("only an ok, non-empty server list replaces the built-in styles", () => {
    expect(src).toContain("if (Array.isArray(data.styles) && data.styles.length > 0) {");
    expect(src).toContain("/* offline fallback styles stay */");
  });
});
