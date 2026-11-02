import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDITOR_SECTION_IDS, EDITOR_LEFT_SECTION_IDS, EDITOR_RIGHT_SECTION_IDS } from "./editor-sections";

/**
 * QC-200 pre-proof — Q191 (390px overflow, code core), Q195 (editor
 * mobile sheet) and the FE half of Q178 (ExportDoctor superseded).
 * Live 390px rendering on a real phone stays OWNER-WALK; what is
 * pinned here is every source contract the ledger cites.
 */

const readSrc = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const readRoot = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("Q191 viewport + global overflow guard", () => {
  it("index.html viewport meta is exactly the uncapped contract, with no zoom cap anywhere in the tag", () => {
    const html = readRoot("index.html");
    const m = html.match(/<meta name="viewport" content="([^"]*)" \/>/);
    expect(m?.[1]).toBe("width=device-width, initial-scale=1.0, viewport-fit=cover");
    const tag = m?.[0] ?? "";
    expect(tag).not.toContain("maximum-scale");
    expect(tag).not.toContain("user-scalable");
  });
  it("global html,body overflow-x: clip guard stands in index.css", () => {
    const css = readSrc("index.css");
    expect(css).toMatch(/html, body \{\s*\n\s*overflow-x: clip;/);
  });
  it("home hero keeps the historical-480px fix: minmax(0,1fr) grid + min-w-0 children", () => {
    const home = readSrc("pages/home.tsx");
    expect(home).toContain("grid-cols-[minmax(0,1fr)]");
    expect(home).toContain("min-w-0");
  });
  it("every min-w store-dashboard table sits immediately inside an overflow-x-auto wrapper", () => {
    const sd = readSrc("pages/store-dashboard.tsx");
    const lines = sd.split("\n");
    const tableIdx = lines.map((l, i) => [l, i] as const).filter(([l]) => l.includes("<table"));
    expect(tableIdx.length).toBeGreaterThanOrEqual(5);
    for (const [line, i] of tableIdx) {
      if (line.includes("min-w-[")) {
        // wrapper is the enclosing div directly above the table
        const above = lines.slice(Math.max(0, i - 2), i).join("\n");
        expect(above, `table at line ${i + 1}`).toContain("overflow-x-auto");
      }
    }
  });
  it("World header/input rows wrap (flex-wrap), never hard-clip at phone width", () => {
    const world = readSrc("pages/world.tsx");
    expect(world.match(/flex-wrap/g)?.length).toBeGreaterThanOrEqual(10);
  });
  it("the six named pages exist as routed surfaces", () => {
    const app = readSrc("App.tsx");
    // /, /dashboard, /create, /video-editor, /world, /store/dashboard are
    // real routes in the shell (home is the index route).
    for (const p of ["/dashboard", "/create", "/video-editor", "/world", "/store/dashboard"]) {
      expect(app, p).toContain(`path="${p}"`);
    }
  });
});

describe("Q195 editor mobile sheet (registry + sheet wiring)", () => {
  it("registry is still exactly 29 sections: 18 left + 11 right, unique", () => {
    expect(EDITOR_SECTION_IDS.length).toBe(29);
    expect(new Set(EDITOR_SECTION_IDS).size).toBe(29);
    expect(EDITOR_LEFT_SECTION_IDS.length).toBe(18);
    expect(EDITOR_RIGHT_SECTION_IDS.length).toBe(11);
  });
  it("both desktop asides are hidden below md", () => {
    const editor = readSrc("pages/video-editor.tsx");
    expect(editor.match(/hidden md:block/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("the mobile sheet is md:hidden, bottom, 84dvh, and renders the SAME body helpers routed by registry side", () => {
    const editor = readSrc("pages/video-editor.tsx");
    expect(editor).toContain('data-testid="editor-mobile-sheet"');
    expect(editor).toContain('data-testid="editor-mobile-sheet-body"');
    const sheet = editor.slice(editor.indexOf('data-testid="editor-mobile-sheet"') - 400, editor.indexOf('data-testid="editor-mobile-sheet"') + 200);
    expect(sheet).toContain("md:hidden");
    expect(sheet).toContain("84dvh");
    // sheet body routes through the shared helpers, not a mobile copy
    const body = editor.slice(editor.indexOf('data-testid="editor-mobile-sheet-body"'));
    expect(body.slice(0, 800)).toContain("renderRightPanelBody(tab");
    expect(body.slice(0, 800)).toContain("renderLeftPanelBody(tab");
  });
  it("rail taps open sections through the single openSectionFromRail entry", () => {
    const editor = readSrc("pages/video-editor.tsx");
    expect(editor).toContain("const openSectionFromRail = (id: EditorTab)");
    expect(editor.match(/openSectionFromRail\(item\.id as EditorTab\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Q178 ExportDoctor — superseded, FE residue check", () => {
  it("video-editor and the section registry carry no ExportDoctor / export-doctor reference", () => {
    const editor = readSrc("pages/video-editor.tsx");
    expect(editor).not.toMatch(/export-?doctor/i);
    expect(EDITOR_SECTION_IDS).not.toContain("export-doctor" as never);
    const registry = readSrc("lib/editor-sections.ts");
    expect(registry).not.toMatch(/export-?doctor/i);
  });
});
