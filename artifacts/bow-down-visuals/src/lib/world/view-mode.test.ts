/**
 * The World — view mode tests (lib/world/view-mode).
 * First person is the default and the fallback for anything
 * unrecognized; third person is remembered on the device.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeViewMode,
  loadViewMode,
  storeViewMode,
  toggledViewMode,
  WORLD_VIEW_STORAGE_KEY,
} from "./view-mode";

describe("view mode", () => {
  it("normalizes: only 'third' is third person", () => {
    expect(normalizeViewMode("third")).toBe("third");
    expect(normalizeViewMode("first")).toBe("first");
    expect(normalizeViewMode("orbit")).toBe("first");
    expect(normalizeViewMode(null)).toBe("first");
    expect(normalizeViewMode(undefined)).toBe("first");
  });

  it("toggles both ways", () => {
    expect(toggledViewMode("first")).toBe("third");
    expect(toggledViewMode("third")).toBe("first");
  });

  it("round-trips through device memory; first person is the clean default", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    expect(loadViewMode(storage)).toBe("first");
    storeViewMode("third", storage);
    expect(map.get(WORLD_VIEW_STORAGE_KEY)).toBe("third");
    expect(loadViewMode(storage)).toBe("third");
    storeViewMode("first", storage);
    expect(map.has(WORLD_VIEW_STORAGE_KEY)).toBe(false);
    expect(loadViewMode(storage)).toBe("first");
    expect(loadViewMode(null)).toBe("first");
  });
});
