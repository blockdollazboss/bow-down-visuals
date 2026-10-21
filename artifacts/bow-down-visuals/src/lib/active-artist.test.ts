import { describe, expect, it } from "vitest";
import {
  ACTIVE_ARTIST_STORAGE_KEY,
  readLegacyActiveArtistSnapshot,
  readStoredActiveArtistId,
  resolveActiveArtist,
  writeStoredActiveArtistId,
} from "./active-artist";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

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
  };
}

function vaultRow(partial: Record<string, unknown>): ArtistVault {
  return {
    id: "vault-1",
    user_id: "user-1",
    artist_name: "Shark King",
    artist_type: "character",
    genre: null,
    voice_style: null,
    visual_style: null,
    hair: null,
    tattoos: null,
    jewelry: null,
    clothing_style: null,
    brand_colors: null,
    theme_id: null,
    personality: null,
    do_not_change_rules: null,
    description: null,
    special_style_rules: null,
    reference_image_url: "https://img.example/old-portrait.png",
    reference_image_path: null,
    reference_video_url: null,
    consistency_prompt: null,
    voice_id: null,
    voice_name: null,
    voice_preview_url: null,
    is_active: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as ArtistVault;
}

describe("readStoredActiveArtistId", () => {
  it("is null when nothing is stored", () => {
    expect(readStoredActiveArtistId(mockStorage())).toBeNull();
  });

  it("reads the current format — the bare id", () => {
    const s = mockStorage();
    s.setItem(ACTIVE_ARTIST_STORAGE_KEY, "vault-42");
    expect(readStoredActiveArtistId(s)).toBe("vault-42");
  });

  it("migrates the legacy format — a whole-row JSON snapshot yields its id", () => {
    const s = mockStorage();
    s.setItem(ACTIVE_ARTIST_STORAGE_KEY, JSON.stringify(vaultRow({ id: "vault-legacy" })));
    expect(readStoredActiveArtistId(s)).toBe("vault-legacy");
  });

  it("reads a JSON-encoded string id", () => {
    const s = mockStorage();
    s.setItem(ACTIVE_ARTIST_STORAGE_KEY, JSON.stringify("vault-json"));
    expect(readStoredActiveArtistId(s)).toBe("vault-json");
  });

  it("refuses unrecognizable stored shapes instead of guessing", () => {
    const s = mockStorage();
    s.setItem(ACTIVE_ARTIST_STORAGE_KEY, JSON.stringify({ name: "no id here" }));
    expect(readStoredActiveArtistId(s)).toBeNull();
    s.setItem(ACTIVE_ARTIST_STORAGE_KEY, "   ");
    expect(readStoredActiveArtistId(s)).toBeNull();
  });

  it("survives a throwing storage (private mode) without throwing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    expect(readStoredActiveArtistId(throwing)).toBeNull();
  });
});

describe("writeStoredActiveArtistId", () => {
  it("stores ONLY the id — never the row", () => {
    const s = mockStorage();
    writeStoredActiveArtistId("vault-7", s);
    const raw = s.getItem(ACTIVE_ARTIST_STORAGE_KEY);
    expect(raw).toBe("vault-7");
    expect(raw).not.toContain("artist_name");
  });

  it("round-trips, and writing null forgets the pick", () => {
    const s = mockStorage();
    writeStoredActiveArtistId("vault-7", s);
    expect(readStoredActiveArtistId(s)).toBe("vault-7");
    writeStoredActiveArtistId(null, s);
    expect(readStoredActiveArtistId(s)).toBeNull();
    expect(s.getItem(ACTIVE_ARTIST_STORAGE_KEY)).toBeNull();
  });
});

describe("readLegacyActiveArtistSnapshot", () => {
  it("returns the snapshot only while the legacy format is on the device", () => {
    const s = mockStorage();
    const row = vaultRow({ id: "vault-old" });
    s.setItem(ACTIVE_ARTIST_STORAGE_KEY, JSON.stringify(row));
    expect(readLegacyActiveArtistSnapshot(s)?.id).toBe("vault-old");
    s.setItem(ACTIVE_ARTIST_STORAGE_KEY, "vault-old");
    expect(readLegacyActiveArtistSnapshot(s)).toBeNull();
  });
});

describe("resolveActiveArtist", () => {
  it("resolves by id against the live list", () => {
    const rows = [vaultRow({ id: "a" }), vaultRow({ id: "b", artist_name: "Second" })];
    expect(resolveActiveArtist(rows, "b")?.artist_name).toBe("Second");
    expect(resolveActiveArtist(rows, null)).toBeNull();
  });

  it("reflects an edited row — the fresh portrait and voice, not a stored copy", () => {
    /* The vault row was edited after the pick was stored: new
       portrait, a locked voice. Resolution must surface the edit. */
    const edited = vaultRow({
      id: "vault-1",
      reference_image_url: "https://img.example/NEW-portrait.png",
      voice_id: "voice-clone-9",
    });
    const resolved = resolveActiveArtist([edited], "vault-1");
    expect(resolved).toBe(edited);
    expect(resolved?.reference_image_url).toBe("https://img.example/NEW-portrait.png");
    expect(resolved?.voice_id).toBe("voice-clone-9");
  });

  it("a deleted or inaccessible id resolves to no artist — no ghost", () => {
    const rows = [vaultRow({ id: "someone-else" })];
    expect(resolveActiveArtist(rows, "vault-deleted")).toBeNull();
    expect(resolveActiveArtist([], "vault-deleted")).toBeNull();
  });
});
