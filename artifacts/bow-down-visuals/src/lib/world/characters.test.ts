/**
 * "Walk in as" picker data tests (lib/world/characters).
 * - normalization tolerates the vault DTO's snake_case rows, camelCase
 *   stragglers, junk rows, and missing fields without guessing
 * - the device pick round-trips through storage and clears on null
 * - a remembered pick for a character that no longer exists (or lost
 *   its portrait) reconciles to the house avatar instead of a refusal
 */
import { describe, it, expect } from "vitest";
import {
  normalizeVaultCharacters,
  characterMonogram,
  loadStoredCharacterId,
  storeCharacterId,
  reconcileStoredPick,
  WORLD_CHARACTER_STORAGE_KEY,
  type VaultCharacter,
} from "./characters";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("normalizeVaultCharacters", () => {
  it("shapes the vault payload, preserving server order", () => {
    const out = normalizeVaultCharacters({
      vaults: [
        { id: "c1", artist_name: "Nova", reference_image_url: "https://img/nova.png" },
        { id: "c2", artist_name: "Rey", reference_image_url: null },
        { id: "c3", artistName: "Cam", referenceImageUrl: "https://img/cam.png" },
      ],
    });
    expect(out).toEqual([
      { id: "c1", name: "Nova", portraitUrl: "https://img/nova.png" },
      { id: "c2", name: "Rey", portraitUrl: null },
      { id: "c3", name: "Cam", portraitUrl: "https://img/cam.png" },
    ]);
  });

  it("skips unrecognizable rows and defaults a blank name honestly", () => {
    const out = normalizeVaultCharacters({
      vaults: [null, "junk", { name: "no id" }, { id: "c9", artist_name: "   " }, { id: "c8", reference_image_url: "" }],
    });
    expect(out).toEqual([
      { id: "c9", name: "Untitled character", portraitUrl: null },
      { id: "c8", name: "Untitled character", portraitUrl: null },
    ]);
    expect(normalizeVaultCharacters(null)).toEqual([]);
    expect(normalizeVaultCharacters({ nope: 1 })).toEqual([]);
    expect(normalizeVaultCharacters([{ id: "c1", artist_name: "Solo", reference_image_url: "x" }])).toHaveLength(1);
  });
});

describe("characterMonogram", () => {
  it("takes the first letter or digit, uppercased", () => {
    expect(characterMonogram("Test Creator")).toBe("T");
    expect(characterMonogram("shark king")).toBe("S");
    expect(characterMonogram("  7th Son")).toBe("7");
    expect(characterMonogram("★ Nova")).toBe("N");
  });

  it("never comes back empty — the placeholder disc always has a mark", () => {
    expect(characterMonogram("")).toBe("B");
    expect(characterMonogram("   ")).toBe("B");
    expect(characterMonogram("★")).toBe("B");
  });
});

describe("device pick storage", () => {
  it("round-trips and clears", () => {
    const s = memStorage();
    expect(loadStoredCharacterId(s)).toBeNull();
    storeCharacterId("c1", s);
    expect(s.getItem(WORLD_CHARACTER_STORAGE_KEY)).toBe("c1");
    expect(loadStoredCharacterId(s)).toBe("c1");
    storeCharacterId(null, s);
    expect(loadStoredCharacterId(s)).toBeNull();
  });

  it("survives a throwing storage (private mode) without throwing", () => {
    const hostile = {
      getItem: () => { throw new Error("nope"); },
      setItem: () => { throw new Error("nope"); },
      removeItem: () => { throw new Error("nope"); },
    };
    expect(loadStoredCharacterId(hostile)).toBeNull();
    expect(() => storeCharacterId("c1", hostile)).not.toThrow();
    expect(loadStoredCharacterId(null)).toBeNull();
  });
});

describe("reconcileStoredPick", () => {
  const chars: VaultCharacter[] = [
    { id: "c1", name: "Nova", portraitUrl: "https://img/nova.png" },
    { id: "c2", name: "Rey", portraitUrl: null },
  ];
  it("keeps a live pick, drops a vanished or portrait-less one", () => {
    expect(reconcileStoredPick(chars, "c1")).toBe("c1");
    expect(reconcileStoredPick(chars, "gone")).toBeNull();
    expect(reconcileStoredPick(chars, "c2")).toBeNull();
    expect(reconcileStoredPick(chars, null)).toBeNull();
    expect(reconcileStoredPick([], "c1")).toBeNull();
  });
  it("keeps a house guard pick — it needs no vault row", () => {
    expect(reconcileStoredPick([], "house:palace-guard")).toBe("house:palace-guard");
    expect(reconcileStoredPick(chars, "house:palace-guard-female")).toBe("house:palace-guard-female");
  });
});
