import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from "./use-sidebar-collapsed";

/** Minimal localStorage stand-in for the node test environment. */
function mockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
  };
}

describe("sidebar collapsed persistence", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = {
      localStorage: mockStorage(),
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it("defaults to expanded when nothing is stored", () => {
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("round-trips the collapsed flag through localStorage", () => {
    writeSidebarCollapsed(true);
    expect(readSidebarCollapsed()).toBe(true);
    expect(
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY),
    ).toBe("1");

    writeSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
    expect(
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY),
    ).toBe("0");
  });

  it("treats unexpected stored values as expanded", () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "yes");
    expect(readSidebarCollapsed()).toBe(false);

    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "");
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("uses a stable namespaced storage key", () => {
    expect(SIDEBAR_COLLAPSED_STORAGE_KEY).toBe("bdv-sidebar-collapsed");
  });

  it("never throws when storage is unavailable (SSR / private mode)", () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(readSidebarCollapsed()).toBe(false);
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
  });

  it("falls back to expanded when localStorage throws on read", () => {
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {},
      },
    };
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("does not throw when localStorage throws on write", () => {
    (globalThis as Record<string, unknown>).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
  });
});
