import { describe, it, expect, vi } from "vitest";
import { buildStemContextItems, type StemMenuActions } from "./track-context-menu";
import type { AudioStem } from "./editor-settings";
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";

function stem(patch: Partial<AudioStem> = {}): AudioStem {
  return {
    id: "stem-1", name: "Vocals", muted: false, solo: false, locked: false,
    ...patch,
  } as unknown as AudioStem;
}

function actions(): StemMenuActions & { [K in "patchStem" | "deleteStem" | "startReplace" | "focusRename" | "addTrack"]: ReturnType<typeof vi.fn> } {
  return {
    patchStem: vi.fn(),
    deleteStem: vi.fn(),
    startReplace: vi.fn(),
    focusRename: vi.fn(),
    addTrack: vi.fn(),
  };
}

function item(items: ContextMenuItem[], key: string): ContextMenuItem {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

describe("stem (track header) context menu", () => {
  it("mute / solo / lock toggle through patchStem and reflect state", () => {
    const a = actions();
    const items = buildStemContextItems(stem({ muted: true }), a);
    expect(item(items, "mute").checked).toBe(true);
    expect(item(items, "mute").label).toBe("Unmute track");
    item(items, "mute").onClick?.();
    expect(a.patchStem).toHaveBeenCalledWith("stem-1", { muted: false });
    item(items, "solo").onClick?.();
    expect(a.patchStem).toHaveBeenCalledWith("stem-1", { solo: true });
    item(items, "lock").onClick?.();
    expect(a.patchStem).toHaveBeenCalledWith("stem-1", { locked: true });
  });

  it("rename / replace / add-track / delete call the row's real handlers", () => {
    const a = actions();
    const s = stem();
    const items = buildStemContextItems(s, a);
    item(items, "rename").onClick?.();
    expect(a.focusRename).toHaveBeenCalledWith("stem-1");
    item(items, "replace").onClick?.();
    expect(a.startReplace).toHaveBeenCalledWith("stem-1");
    item(items, "add-track").onClick?.();
    expect(a.addTrack).toHaveBeenCalledTimes(1);
    item(items, "delete").onClick?.();
    expect(a.deleteStem).toHaveBeenCalledWith(s);
    expect(item(items, "delete").danger).toBe(true);
  });

  it("a locked track disables rename / replace / delete but keeps the toggles live", () => {
    const a = actions();
    const items = buildStemContextItems(stem({ locked: true }), a);
    expect(item(items, "rename").disabled).toBe(true);
    expect(item(items, "replace").disabled).toBe(true);
    expect(item(items, "delete").disabled).toBe(true);
    expect(item(items, "mute").disabled).toBeFalsy();
    expect(item(items, "lock").disabled).toBeFalsy();
    expect(item(items, "lock").label).toBe("Unlock track");
  });

  it("omits Add track where the surface has no add-track picker", () => {
    const a = actions();
    delete (a as { addTrack?: unknown }).addTrack;
    const items = buildStemContextItems(stem(), a);
    expect(items.find((i) => i.key === "add-track")).toBeUndefined();
  });
});
