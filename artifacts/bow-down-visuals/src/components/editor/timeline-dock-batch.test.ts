/**
 * timeline-dock-batch.test.ts — stack1100 X2 (stash@{2} hand-port) wiring pins.
 *
 * The batch behaviour itself is unit-tested against lib/timeline-batch;
 * these pins lock the dock's wiring so the feature can't silently detach:
 * the seam import, the id-based multi-select state, shift+click handling
 * at BOTH clip render variants, the toolbar Duplicate/Delete buttons,
 * the Delete / Ctrl+D keyboard path, and the batch highlight in both
 * clip variants.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./TimelineDock.tsx", import.meta.url), "utf8");

describe("TimelineDock clip batch — pins", () => {
  it("runs on the lib/timeline-batch seam", () => {
    expect(src).toContain('from "@/lib/timeline-batch"');
    for (const fn of ["clickSelection(", "batchIndices(", "deleteBatch(", "duplicateBatch("]) {
      expect(src, fn).toContain(fn);
    }
  });
  it("multi-select state stores scene ids, not indices", () => {
    expect(src).toContain("multiSelected");
    expect(src).toContain("useState<ReadonlySet<string>>");
  });
  it("both clip render variants route clicks through handleClipClick", () => {
    expect(src.match(/onClick=\{\(e\) => handleClipClick\(e, i\)\}/g)?.length).toBe(2);
  });
  it("both clip variants highlight batch members alongside the anchor", () => {
    expect(src.match(/multiSelected\.has\(scene\.id\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("toolbar carries Duplicate + Delete batch buttons beside Split", () => {
    expect(src).toContain('data-testid="timeline-dock-duplicate"');
    expect(src).toContain('data-testid="timeline-dock-delete"');
  });
  it("keyboard: Delete/Backspace deletes the batch, Ctrl/Cmd+D duplicates it", () => {
    expect(src).toContain('e.key === "Delete"');
    expect(src).toContain('e.key === "Backspace"');
    expect(src).toContain('key === "d"');
  });
  it("the pre-existing single-clip paths still stand", () => {
    expect(src).toContain("splitClipAt");
    expect(src).toContain("duplicateClip");
    expect(src).toContain("deleteClip");
  });
});
