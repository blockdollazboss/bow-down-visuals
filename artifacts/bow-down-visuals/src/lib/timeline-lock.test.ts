/**
 * Timeline lock pins — the Studio Editor's "Lock Timeline" must really lock.
 *
 * Board evidence (editor audit): `lockedTimeline` had zero consumers in the
 * repo; it was a local JSON snapshot presented as an export gate. The fix
 * makes the lock state `EditorSettings.timelineLocked` and enforces it in
 * layers (see lib/timeline-lock.ts). These tests pin:
 *   1. The pure gate predicates the video-editor page's wrapped setters
 *      actually call — every mutation path funnels through them.
 *   2. The settings flag's default + normalize (persistence) behaviour.
 *   3. Source pins that the timeline surfaces (TimelineDock,
 *      StudioEditorSection) and the page carry their gates, so a future
 *      refactor can't silently un-wire the lock.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultClipEdit,
  defaultEditorSettings,
  normalizeEditorSettings,
  type EditorSettings,
} from "./editor-settings";
import type { SceneData } from "./scene-parser";
import {
  isTimelineLocked,
  timelineLockBlocksScenesChange,
  timelineLockBlocksSettingsChange,
  TIMELINE_LOCKED_MESSAGE,
} from "./timeline-lock";

const dockSource = readFileSync(
  new URL("../components/editor/TimelineDock.tsx", import.meta.url),
  "utf8",
);
const studioSource = readFileSync(
  new URL("../components/editor/sections/StudioEditorSection.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../pages/video-editor.tsx", import.meta.url),
  "utf8",
);

function lockedSettings(): EditorSettings {
  return { ...defaultEditorSettings(), timelineLocked: true };
}

const sceneA = { id: "sc_a" } as SceneData;
const sceneB = { id: "sc_b" } as SceneData;

describe("timeline lock — settings flag", () => {
  it("defaults to unlocked", () => {
    expect(defaultEditorSettings().timelineLocked).toBe(false);
    expect(normalizeEditorSettings(null).timelineLocked).toBe(false);
    expect(normalizeEditorSettings(undefined).timelineLocked).toBe(false);
  });

  it("persists through normalize (a project saved locked reopens locked)", () => {
    expect(normalizeEditorSettings({ timelineLocked: true }).timelineLocked).toBe(true);
    expect(normalizeEditorSettings({ timelineLocked: false }).timelineLocked).toBe(false);
  });

  it("non-boolean stored values fall back to unlocked", () => {
    expect(
      normalizeEditorSettings({ timelineLocked: "yes" as unknown as boolean }).timelineLocked,
    ).toBe(false);
  });

  it("isTimelineLocked reads only a strict true", () => {
    expect(isTimelineLocked(lockedSettings())).toBe(true);
    expect(isTimelineLocked(defaultEditorSettings())).toBe(false);
    expect(isTimelineLocked(null)).toBe(false);
    expect(isTimelineLocked(undefined)).toBe(false);
  });
});

describe("timeline lock — scenes gate (move / split / delete / add / replace)", () => {
  const prev = [sceneA, sceneB];

  it("blocks every scenes replacement while locked", () => {
    const s = lockedSettings();
    // reorder (move)
    expect(timelineLockBlocksScenesChange(s, prev, [sceneB, sceneA])).toBe(true);
    // split / duplicate / paste / add-a-clip (array grows)
    expect(timelineLockBlocksScenesChange(s, prev, [sceneA, sceneB, sceneA])).toBe(true);
    // delete (array shrinks)
    expect(timelineLockBlocksScenesChange(s, prev, [sceneA])).toBe(true);
    // rename / replace (same length, new array)
    expect(timelineLockBlocksScenesChange(s, prev, [{ ...sceneA }, sceneB])).toBe(true);
  });

  it("allows the identical array while locked (no-op writes pass)", () => {
    expect(timelineLockBlocksScenesChange(lockedSettings(), prev, prev)).toBe(false);
  });

  it("allows any scenes change while unlocked", () => {
    const s = defaultEditorSettings();
    expect(timelineLockBlocksScenesChange(s, prev, [sceneB, sceneA])).toBe(false);
    expect(timelineLockBlocksScenesChange(s, prev, [])).toBe(false);
  });
});

describe("timeline lock — settings gate (per-clip edits)", () => {
  it("blocks a change that rewrites settings.clips while locked (trim/move/transition/effect/speed/keyframes/lip-sync)", () => {
    const prev = lockedSettings();
    const next: EditorSettings = {
      ...prev,
      clips: { sc_a: { ...defaultClipEdit(), trimStart: 1 } },
    };
    expect(timelineLockBlocksSettingsChange(prev, next)).toBe(true);
  });

  it("allows non-clip settings changes while locked (playback, captions, export range, dock)", () => {
    const prev = lockedSettings();
    const next: EditorSettings = { ...prev, timelineDockHeight: 222 };
    expect(next.clips).toBe(prev.clips);
    expect(timelineLockBlocksSettingsChange(prev, next)).toBe(false);
  });

  it("always allows the lock toggle itself (unlock must never be refused)", () => {
    const prev = lockedSettings();
    const unlock: EditorSettings = { ...prev, timelineLocked: false };
    expect(timelineLockBlocksSettingsChange(prev, unlock)).toBe(false);
    // even if the same write also touched clips, the toggle wins
    const unlockPlus: EditorSettings = { ...prev, timelineLocked: false, clips: {} };
    expect(timelineLockBlocksSettingsChange(prev, unlockPlus)).toBe(false);
  });

  it("allows locking from the unlocked state", () => {
    const prev = defaultEditorSettings();
    const lock: EditorSettings = { ...prev, timelineLocked: true };
    expect(timelineLockBlocksSettingsChange(prev, lock)).toBe(false);
  });

  it("allows clip edits while unlocked", () => {
    const prev = defaultEditorSettings();
    const next: EditorSettings = { ...prev, clips: {} };
    expect(timelineLockBlocksSettingsChange(prev, next)).toBe(false);
  });

  it("the lock message tells the user how to unlock", () => {
    expect(TIMELINE_LOCKED_MESSAGE).toContain("locked");
    expect(TIMELINE_LOCKED_MESSAGE).toContain("unlock");
  });
});

describe("timeline lock — page chokepoint wiring (video-editor.tsx)", () => {
  it("the wrapped setScenes refuses via the scenes predicate", () => {
    expect(pageSource).toContain(
      "timelineLockBlocksScenesChange(settingsRef.current, prev, next)",
    );
  });

  it("the wrapped setSettings refuses via the settings predicate", () => {
    expect(pageSource).toContain("timelineLockBlocksSettingsChange(prev, next)");
  });

  it("project load uses the internal (never-refused) setters", () => {
    expect(pageSource).toContain("setScenesInternal(parsed)");
    expect(pageSource).toContain("setScenesInternal(savedScenes)");
    expect(pageSource).toContain(
      "setSettingsInternal(normalizeEditorSettings(data.project.output_data?.editorSettings))",
    );
  });

  it("undo/redo are refused while locked (they restore scenes+settings wholesale)", () => {
    expect(pageSource).toContain(
      "if (isTimelineLocked(settingsRef.current)) { notifyTimelineLocked(); return; }",
    );
  });

  it("applyBeatCuts (split path) is refused while locked and reports 0 cuts", () => {
    expect(pageSource).toContain(
      "if (isTimelineLocked(settingsRef.current)) { notifyTimelineLocked(); return 0; }",
    );
  });
});

describe("timeline lock — TimelineDock gates", () => {
  it("the dock derives its lock state from settings", () => {
    expect(dockSource).toContain("const timelineLocked = isTimelineLocked(settings);");
  });

  it("reorder is refused twice: dnd disabled + onDragEnd guard", () => {
    expect(dockSource).toContain("disabled={timelineLocked}");
    expect(dockSource).toContain("useSortable({ id, disabled })");
    expect(dockSource).toContain("function onDragEnd(event: DragEndEvent) {\n    if (timelineLocked) return;");
  });

  it("trim and freeform-move drags never start while locked, and trim handles are not rendered", () => {
    expect(dockSource).toContain("if (timelineLocked) return;\n    e.stopPropagation();");
    expect(dockSource).toContain("if (timelineLocked || !isManual) return;");
    expect(dockSource.match(/\{selected && !timelineLocked && \(/g)?.length).toBe(2);
  });

  it("split is gated on every entry: button state, S key (via canSplit), and the context-menu split", () => {
    expect(dockSource).toContain("const canSplit = !timelineLocked && !!splitScene");
    expect(dockSource).toContain("const splitClipAt = useCallback((idx: number) => {\n    if (timelineLocked) return;");
    expect(dockSource).toContain("title={timelineLocked ? TIMELINE_LOCKED_MESSAGE :");
  });

  it("context-menu mutations are disabled with the lock reason; copy is not", () => {
    expect(dockSource).toContain("const lockOff = timelineLocked");
    expect(dockSource).toContain("disabledTitle: TIMELINE_LOCKED_MESSAGE");
    // duplicate / delete / rename / parents carry lockOff
    expect(dockSource).toContain('key: "duplicate", label: "Duplicate clip", ...lockOff,');
    expect(dockSource).toContain('key: "delete", label: "Delete clip", danger: true, ...lockOff,');
    expect(dockSource).toContain('key: "rename", label: "Rename clip", ...lockOff,');
    // copy stays usable while locked (it does not change the timeline)
    expect(dockSource).not.toContain('key: "copy", label: "Copy clip", ...lockOff');
  });

  it("clip-edit handlers are gated as backstop (duplicate/delete/paste/rename/replace/patch/freeze)", () => {
    for (const fn of ["duplicateClip", "deleteClip", "renameClip"]) {
      expect(dockSource).toContain(`const ${fn} = useCallback((idx: number) => {\n    if (timelineLocked) return;`);
    }
    expect(dockSource).toContain("const pasteClip = useCallback((afterIdx: number) => {\n    if (timelineLocked) return;");
    expect(dockSource).toContain("const patchClipEdit = useCallback((sceneId: string, patch: Partial<ClipEdit>) => {\n    if (timelineLocked) return;");
    expect(dockSource).toContain("if (timelineLocked) {\n      toast({ title: \"Timeline locked\"");
  });

  it("the transport hint line announces the locked state", () => {
    expect(dockSource).toContain("Timeline locked — playback, selection, and export still work");
  });
});

describe("timeline lock — StudioEditorSection is the lock's home", () => {
  it("lock state derives from settings, not the local snapshot", () => {
    expect(studioSource).toContain("const isLocked = isTimelineLocked(settings);");
  });

  it("a successful lock engages the real settings flag; unlock clears it", () => {
    expect(studioSource).toContain("setSettings({ ...settings, timelineLocked: true });");
    expect(studioSource).toContain("setSettings({ ...settings, timelineLocked: false });");
  });

  it("the lock control is a toggle with aria-pressed and an Unlock label while locked", () => {
    expect(studioSource).toContain("aria-pressed={isLocked}");
    expect(studioSource).toContain("Unlock Timeline");
    expect(studioSource).toContain("if (isLocked) unlockTimeline(); else void validateAndLock();");
  });

  it("the inspector trim sliders are disabled and refused while locked", () => {
    expect(studioSource).toContain("disabled={isLocked}");
    expect(studioSource).toContain("function updateTrim(key: \"trimStart\" | \"trimEnd\", val: number) {\n            if (isLocked) return;");
  });

  it("the clip repair panel refuses to attach a URL while locked", () => {
    expect(studioSource).toContain("timelineLocked={isLocked}");
    expect(studioSource).toContain("if (timelineLocked || !setScenes) return;");
    expect(studioSource).toContain("disabled={timelineLocked || !!busy || !!currentUrl}");
  });

  it("export stays available while locked (exportReady still requires the lock)", () => {
    expect(studioSource).toContain("const exportReady = isStable && isLocked;");
  });
});
