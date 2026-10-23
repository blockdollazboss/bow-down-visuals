import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EDITOR_LEFT_SECTION_IDS,
  EDITOR_RIGHT_SECTION_IDS,
  EDITOR_RIGHT_SECTION_SET,
  EDITOR_SECTION_IDS,
  EDITOR_SECTIONS,
  editorSectionSide,
} from "./editor-sections";

/**
 * Stack-28 #53 (A5-M1) — Video Editor mobile section sheet.
 *
 * Below 768px both desktop section panels are `hidden md:block`, so rail
 * taps used to switch state to panels that never rendered. The fix derives
 * every section list from the single registry in editor-sections.ts, renders
 * the panels through ONE pair of body helpers shared by the desktop asides
 * and the mobile bottom sheet, and opens the sheet on rail taps when the
 * viewport is under the md breakpoint.
 */
const editor = readFileSync(new URL("../pages/video-editor.tsx", import.meta.url), "utf8");

describe("editor section registry (single source of section ids)", () => {
  it("holds 29 unique sections: 18 left + 11 right", () => {
    expect(EDITOR_SECTION_IDS.length).toBe(29);
    expect(new Set(EDITOR_SECTION_IDS).size).toBe(29);
    expect(EDITOR_LEFT_SECTION_IDS.length).toBe(18);
    expect(EDITOR_RIGHT_SECTION_IDS.length).toBe(11);
    expect(editorSectionSide("clips")).toBe("left");
    expect(editorSectionSide("export")).toBe("right");
    for (const s of EDITOR_SECTIONS) {
      expect(editorSectionSide(s.id)).toBe(s.side);
      expect(EDITOR_RIGHT_SECTION_SET.has(s.id)).toBe(s.side === "right");
    }
  });

  it("video-editor derives its tab type, right set and deep-link list from the registry", () => {
    expect(editor).toContain('from "@/lib/editor-sections"');
    expect(editor).toContain("type EditorTab = EditorSectionId;");
    expect(editor).toContain("const RIGHT_TABS = new Set<string>(EDITOR_RIGHT_SECTION_IDS);");
    expect(editor).toContain("const RAIL_TAB_IDS: EditorTab[] = EDITOR_SECTION_IDS;");
    // No second, driftable copy of the id list survives in the page.
    expect(editor).not.toContain('type EditorTab = "clips"');
    expect(editor).not.toContain("RIGHT_TABS = new Set([");
    expect(editor).not.toMatch(/RAIL_TAB_IDS: EditorTab\[\] = \[/);
  });

  it("every registry id has a rail button, a title and exactly one panel render", () => {
    const titleMap = editor.slice(
      editor.indexOf("const editorTabTitle"),
      editor.indexOf("as Record<EditorTab, string>"),
    );
    for (const id of EDITOR_SECTION_IDS) {
      // Reachable from a rail (the left rail array lists every section).
      expect(editor, `rail entry for ${id}`).toContain(`{ id: "${id}", label:`);
      // The one title map covers it (Record<EditorTab, string> also enforces this at compile time).
      expect(titleMap, `title for ${id}`).toMatch(new RegExp(`"?${id}"?\\s*:`));
      // Exactly ONE panel render conditional for the id — the shared body
      // helpers are the only implementation, for desktop and mobile alike.
      const renders = editor.match(new RegExp(`activeTab === "${id}"`, "g")) ?? [];
      expect(renders.length, `panel render for ${id}`).toBe(1);
    }
  });
});

describe("desktop panels unchanged (Stack-28 #53)", () => {
  it("both asides keep their exact desktop markup and hidden md:block classes", () => {
    expect(editor).toContain(
      '<aside style={{ width: panelCollapsed ? 0 : panelWidth, display: panelCollapsed ? "none" : undefined }} className="shrink-0 vv-marble-panel border-r vv-border overflow-y-auto hidden md:block">',
    );
    expect(editor).toContain(
      '<aside style={{ width: rightPanelCollapsed ? 0 : rightPanelWidth, display: rightPanelCollapsed ? "none" : undefined }} className="shrink-0 vv-marble-panel border-l vv-border overflow-y-auto hidden md:block">',
    );
    expect(editor.match(/overflow-y-auto hidden md:block/g)?.length).toBe(2);
  });

  it("desktop asides render through the shared helpers with the playback engine mounted", () => {
    expect(editor).toContain(
      "renderLeftPanelBody(leftTab, { includeEngine: true, includeSections: !mobileSectionInSheet })",
    );
    expect(editor).toContain(
      "renderRightPanelBody(rightTab, { includeSections: !mobileSectionInSheet })",
    );
    // The playback engine exists exactly once in the page and only the
    // desktop panel mounts it.
    expect(editor.match(/<TimelinePreviewPlayer/g)?.length).toBe(1);
    expect(editor).toContain("{includeEngine && (");
  });
});

describe("mobile section sheet (Stack-28 #53)", () => {
  it("is a bottom Sheet, mobile-only, in the editor's marble language", () => {
    expect(editor).toContain("<Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>");
    expect(editor).toContain('data-testid="editor-mobile-sheet"');
    expect(editor).toContain('side="bottom"');
    expect(editor).toContain("md:hidden h-[84dvh]");
    expect(editor).toContain("style={vvVars}");
    expect(editor).toContain('data-testid="editor-mobile-sheet-body"');
  });

  it("renders the active section through the SAME helpers, routed by the registry side", () => {
    expect(editor).toContain("renderRightPanelBody(tab, { includeSections: true })");
    expect(editor).toContain(
      "renderLeftPanelBody(tab, { includeEngine: false, includeSections: true })",
    );
    expect(editor).toContain("RIGHT_TABS.has(tab)");
    expect(editor).toContain("{editorTabTitle(tab)}");
  });

  it("opens on rail taps only under the md breakpoint; sections never mount twice", () => {
    expect(editor.match(/openSectionFromRail\(item\.id as EditorTab\)/g)?.length).toBe(2);
    expect(editor).toContain('window.matchMedia("(max-width: 767px)")');
    expect(editor).toContain("if (isMobileViewport) setMobileSheetOpen(true);");
    expect(editor).toContain(
      "const mobileSectionInSheet = isMobileViewport && mobileSheetOpen;",
    );
    // Crossing back to desktop closes the sheet and restores the asides.
    expect(editor).toContain("if (!e.matches) setMobileSheetOpen(false);");
  });
});
