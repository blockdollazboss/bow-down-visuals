import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #56 (A5-M4) — primary tap targets ≥40px:
 * design-system sm/icon sizes, editor transport, editor top-bar Save/Export.
 * Consumer audit: size="sm" has 277 call sites — all are inline-flex
 * buttons whose height grows 32→40px (no fixed-height parent under 40px
 * except the editor's own h-12 top bar, which fits 40px); size="icon"
 * has 3 call sites, all standalone icon buttons.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const variants = read("../components/ui/button-variants.ts");
const editor = read("../pages/video-editor.tsx");

describe("tap targets (Stack-28 #56)", () => {
  it("design-system sm/icon are ≥40px", () => {
    expect(variants).toContain('sm: "min-h-10 rounded-md px-3 text-xs"');
    expect(variants).toContain('icon: "h-10 w-10"');
    expect(variants).not.toContain('sm: "min-h-8');
  });
  it("editor transport buttons are 40px", () => {
    expect(editor).toContain('const tBtnSm = "flex items-center justify-center h-10 w-10');
    expect(editor).not.toContain('const tBtnSm = "flex items-center justify-center h-7 w-7');
  });
  it("top-bar Save/Export are h-10", () => {
    const save = editor.slice(editor.indexOf('data-testid="btn-save-editor"') - 300, editor.indexOf('data-testid="btn-save-editor"'));
    const exp = editor.slice(editor.indexOf('data-testid="btn-export-topbar"') - 300, editor.indexOf('data-testid="btn-export-topbar"'));
    expect(save).toContain("h-10");
    expect(exp).toContain("h-10");
  });
});
