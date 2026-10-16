import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { menuToneClasses } from "@/lib/context-menu-tone";

const menuSource = readFileSync(
  new URL("../components/editor/ClipContextMenu.tsx", import.meta.url),
  "utf8",
);
const timelineSource = readFileSync(
  new URL("../components/editor/TimelineDock.tsx", import.meta.url),
  "utf8",
);
const editorSource = readFileSync(
  new URL("../pages/video-editor.tsx", import.meta.url),
  "utf8",
);

describe("ClipContextMenu tones (Lane V4 item 3)", () => {
  it("dark tone is byte-identical to the original treatment", () => {
    const tc = menuToneClasses("dark");
    expect(tc.panel).toContain("bg-[#0a0a0a]/[0.98]");
    expect(tc.panel).toContain("border-[#C9A84C]/40");
    expect(tc.row).toBe("text-white/85");
    expect(tc.rowDanger).toContain("text-red-300/90");
  });

  it("light tone is the house ivory panel recipe with bronze ink", () => {
    const tc = menuToneClasses("light");
    expect(tc.panel).toContain("from-[#FCF7EA]");
    expect(tc.panel).toContain("to-[#F4E7C3]");
    expect(tc.panel).not.toContain("#0a0a0a");
    expect(tc.row).toBe("text-[#2A1E07]");
    expect(tc.row).not.toContain("text-white");
    expect(tc.rowDisabled).toContain("#6B5B36");
    expect(tc.rowDanger).toContain("text-red-700");
    expect(tc.check).toBe("text-[#7A5A12]");
  });

  it("the component resolves tone from the site theme when no tone is passed", () => {
    expect(menuSource).toContain("useIsLightTheme()");
    expect(menuSource).toContain('toneProp ?? (siteLight ? "light" : "dark")');
  });

  it("the protected video-editor mounts pin the dark tone explicitly", () => {
    expect(timelineSource).toContain('testId="timeline-clip-context-menu"\n          tone="dark"');
    expect(editorSource).toContain('testId="player-context-menu"\n          tone="dark"');
  });
});
