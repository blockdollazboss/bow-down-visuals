/**
 * The World — view mode tests (lib/world/view-mode).
 * Third person is the default (Oct 29 2026 — the owner walked a
 * fresh window blind to his own character under the old first-
 * person default); first person survives only as an explicitly
 * stored choice, and both modes are remembered on the device.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeViewMode,
  loadViewMode,
  storeViewMode,
  toggledViewMode,
  selfPlateVisible,
  WORLD_VIEW_STORAGE_KEY,
} from "./view-mode";

describe("view mode", () => {
  it("normalizes: only an explicit 'first' is first person", () => {
    expect(normalizeViewMode("third")).toBe("third");
    expect(normalizeViewMode("first")).toBe("first");
    expect(normalizeViewMode("orbit")).toBe("third");
    expect(normalizeViewMode(null)).toBe("third");
    expect(normalizeViewMode(undefined)).toBe("third");
  });

  it("toggles both ways", () => {
    expect(toggledViewMode("first")).toBe("third");
    expect(toggledViewMode("third")).toBe("first");
  });

  it("your own name plate never renders in third person", () => {
    // Third person: the plate would billboard at the follow camera,
    // detached from the figure — suppressed. First person keeps the
    // standing behavior (the self rig is hidden there regardless).
    expect(selfPlateVisible("third")).toBe(false);
    expect(selfPlateVisible("first")).toBe(true);
  });

  it("round-trips through device memory; third person is the fresh default", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    /* A fresh window (his Incognito walks) has nothing stored and
     * must land in third person — the view that shows his figure. */
    expect(loadViewMode(storage)).toBe("third");
    storeViewMode("third", storage);
    expect(map.get(WORLD_VIEW_STORAGE_KEY)).toBe("third");
    expect(loadViewMode(storage)).toBe("third");
    /* First person is stored EXPLICITLY now — absence means
     * "never chose" (third), so a deliberate first-person choice
     * has to survive as its own value, not as a missing key. */
    storeViewMode("first", storage);
    expect(map.get(WORLD_VIEW_STORAGE_KEY)).toBe("first");
    expect(loadViewMode(storage)).toBe("first");
    expect(loadViewMode(null)).toBe("third");
  });
});
