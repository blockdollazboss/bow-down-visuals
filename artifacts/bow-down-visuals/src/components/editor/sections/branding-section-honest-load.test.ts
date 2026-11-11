/**
 * BrandingSection (the editor branding panel; watermark /
 * logo upload leg) — honest action states (Stack-400 C-28
 * components residual, deep-pins tranche 6).
 *
 * The ExportSection watermark twin: the upload to
 * /api/upload-watermark branches on non-ok BEFORE the
 * returned URL may enter the branding settings — a failed
 * upload lands on the error surface and leaves the previous
 * logo/watermark setting exactly as it was; the uploading
 * flag clears in finally, and the button's label truthfully
 * reflects the CURRENT proven setting ("Replace logo" only
 * when a logo URL exists).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BrandingSection.tsx");

describe("the logo enters settings only from a proven upload", () => {
  it("the non-ok branch precedes any settings write; the flag clears in finally", () => {
    expect(src).toContain('fetch("/api/upload-watermark", {');
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain("setWmUploading(false);");
    expect(src).toContain('wm.customLogoUrl ? "Replace logo" : "Upload your logo"');
  });
});
