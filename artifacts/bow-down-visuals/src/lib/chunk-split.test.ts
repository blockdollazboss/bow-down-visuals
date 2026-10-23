import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #51 (A5-P5) — chunk budget + natural-seam splits:
 * recharts is its own vendor chunk (analytics-hub only); video-editor
 * section panels are React.lazy (per-tab chunks), not static imports;
 * vite.config carries a chunkSizeWarningLimit budget.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const vite = read("../../vite.config.ts");
const editor = read("../pages/video-editor.tsx");

describe("chunk splits (Stack-28 #51)", () => {
  it("vite config has a chunk budget and the recharts seam", () => {
    expect(vite).toContain("chunkSizeWarningLimit: 650");
    expect(vite).toContain('"vendor-recharts"');
  });
  it("editor sections are lazy, not static imports", () => {
    for (const name of ["CaptionsSection", "LipSyncSection", "ExportSection", "MusicStudio"]) {
      expect(editor).not.toMatch(new RegExp(`^import .*${name}.* from`, "m"));
      expect(editor).toContain(`const ${name} = lazy(`);
    }
    expect(editor).toContain("<Suspense");
  });
});
