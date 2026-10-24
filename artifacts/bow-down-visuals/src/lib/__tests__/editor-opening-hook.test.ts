import { describe, it, expect } from "vitest";
import {
  normalizeEditorSettings,
  withOpeningHook,
  OPENING_HOOK_LINE_ID,
  type EditorSettings,
} from "../editor-settings";

/**
 * Stack-100 #3 Lane D — 3-Second Lab apply pins. The Lab's ranked
 * openings are text hooks; applying one writes it into the editor's own
 * hook-caption channel (captions.hookText + mode "hook" + a timed line
 * at 0–3s) so preview and export carry it.
 */
function baseSettings(): EditorSettings {
  return normalizeEditorSettings(null);
}

describe("withOpeningHook", () => {
  it("sets the hook source fields and enables captions", () => {
    const next = withOpeningHook(baseSettings(), "Stop scrolling. Watch this.");
    expect(next.captions.enabled).toBe(true);
    expect(next.captions.mode).toBe("hook");
    expect(next.captions.hookText).toBe("Stop scrolling. Watch this.");
  });

  it("seeds exactly one timed line over the first 3 seconds", () => {
    const next = withOpeningHook(baseSettings(), "Hook line");
    const hookLines = next.captions.lines.filter((l) => l.id === OPENING_HOOK_LINE_ID);
    expect(hookLines).toEqual([
      { id: OPENING_HOOK_LINE_ID, startSec: 0, endSec: 3, text: "Hook line" },
    ]);
  });

  it("re-applying replaces the previous hook line instead of stacking", () => {
    const once = withOpeningHook(baseSettings(), "First hook");
    const twice = withOpeningHook(once, "Better hook");
    const hookLines = twice.captions.lines.filter((l) => l.id === OPENING_HOOK_LINE_ID);
    expect(hookLines).toHaveLength(1);
    expect(hookLines[0]?.text).toBe("Better hook");
    expect(twice.captions.hookText).toBe("Better hook");
  });

  it("preserves the user's other caption lines, sorted by start", () => {
    const start = baseSettings();
    start.captions.lines = [
      { id: "later", startSec: 12, endSec: 15, text: "Chorus" },
      { id: "mid", startSec: 5, endSec: 8, text: "Verse" },
    ];
    const next = withOpeningHook(start, "Hook");
    expect(next.captions.lines.map((l) => l.id)).toEqual([OPENING_HOOK_LINE_ID, "mid", "later"]);
  });

  it("ignores blank hook text (settings returned unchanged)", () => {
    const start = baseSettings();
    expect(withOpeningHook(start, "   ")).toBe(start);
  });

  it("does not mutate the input settings", () => {
    const start = baseSettings();
    const linesBefore = start.captions.lines.length;
    withOpeningHook(start, "Hook");
    expect(start.captions.lines).toHaveLength(linesBefore);
    expect(start.captions.hookText).not.toBe("Hook");
  });
});
