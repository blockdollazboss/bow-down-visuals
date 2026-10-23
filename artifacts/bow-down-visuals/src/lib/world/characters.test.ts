/**
 * "Walk in as" picker data tests (lib/world/characters).
 * - normalization tolerates the vault DTO's snake_case rows, camelCase
 *   stragglers, junk rows, and missing fields without guessing
 * - the device pick round-trips through storage and clears on null
 * - a remembered pick for a character that no longer exists (or has
 *   neither portrait nor living loop) reconciles to the house avatar
 *   instead of a refusal; a video-only character's pick stands
 */
import { describe, it, expect } from "vitest";
import {
  normalizeVaultCharacters,
  characterMonogram,
  loadStoredCharacterId,
  storeCharacterId,
  reconcileStoredPick,
  buildVaultRenameBody,
  renameVaultCharacter,
  removeVaultCharacter,
  vaultAppearanceFromRow,
  buildVaultAppearanceBody,
  buildVaultCreateBody,
  createVaultCharacter,
  fetchVaultAppearance,
  saveVaultAppearance,
  VAULT_APPEARANCE_KEYS,
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
        { id: "c2", artist_name: "Rey", reference_image_url: null, reference_video_url: "https://vid/rey.mp4" },
        { id: "c3", artistName: "Cam", referenceImageUrl: "https://img/cam.png", referenceVideoUrl: "https://vid/cam.mp4" },
      ],
    });
    expect(out).toEqual([
      { id: "c1", name: "Nova", portraitUrl: "https://img/nova.png", loopUrl: null, isOwn: false },
      { id: "c2", name: "Rey", portraitUrl: null, loopUrl: "https://vid/rey.mp4", isOwn: false },
      { id: "c3", name: "Cam", portraitUrl: "https://img/cam.png", loopUrl: "https://vid/cam.mp4", isOwn: false },
    ]);
  });

  it("skips unrecognizable rows and defaults a blank name honestly", () => {
    const out = normalizeVaultCharacters({
      vaults: [null, "junk", { name: "no id" }, { id: "c9", artist_name: "   " }, { id: "c8", reference_image_url: "" }],
    });
    expect(out).toEqual([
      { id: "c9", name: "Untitled character", portraitUrl: null, loopUrl: null, isOwn: false },
      { id: "c8", name: "Untitled character", portraitUrl: null, loopUrl: null, isOwn: false },
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
    { id: "c1", name: "Nova", portraitUrl: "https://img/nova.png", loopUrl: null, isOwn: true },
    { id: "c2", name: "Rey", portraitUrl: null, loopUrl: "https://vid/rey.mp4", isOwn: true },
    { id: "c3", name: "Cam", portraitUrl: null, loopUrl: null, isOwn: true },
  ];
  it("keeps a live pick — portrait or living loop — and drops a vanished or empty one", () => {
    expect(reconcileStoredPick(chars, "c1")).toBe("c1");
    // video-only: the living loop stands as the figure, so the pick stands
    expect(reconcileStoredPick(chars, "c2")).toBe("c2");
    expect(reconcileStoredPick(chars, "c3")).toBeNull();
    expect(reconcileStoredPick(chars, "gone")).toBeNull();
    expect(reconcileStoredPick(chars, null)).toBeNull();
    expect(reconcileStoredPick([], "c1")).toBeNull();
  });
  it("keeps a house guard pick — it needs no vault row", () => {
    expect(reconcileStoredPick([], "house:palace-guard")).toBe("house:palace-guard");
    expect(reconcileStoredPick(chars, "house:palace-guard-female")).toBe("house:palace-guard-female");
  });
});

describe("normalizeVaultCharacters ownership", () => {
  it("marks only the rows whose user_id is the current member's", () => {
    const out = normalizeVaultCharacters(
      {
        vaults: [
          { id: "c1", artist_name: "Mine", user_id: "u-1", reference_image_url: "https://img/a.png" },
          { id: "c2", artist_name: "Team shared", user_id: "u-2", reference_image_url: "https://img/b.png" },
          { id: "c3", artist_name: "No owner field", reference_image_url: "https://img/c.png" },
        ],
      },
      "u-1",
    );
    expect(out.map((c) => [c.id, c.isOwn])).toEqual([
      ["c1", true],
      ["c2", false],
      ["c3", false],
    ]);
  });

  it("marks nothing own when no current user id is supplied", () => {
    const out = normalizeVaultCharacters({
      vaults: [{ id: "c1", artist_name: "Nova", user_id: "u-1", reference_image_url: "x" }],
    });
    expect(out[0]?.isOwn).toBe(false);
  });
});

const FULL_ROW = {
  id: "c1",
  user_id: "u-1",
  artist_name: "Nova",
  artist_type: "rapper",
  genre: "Trap",
  voice_style: "deep",
  visual_style: "Street Cinematic",
  hair: "waves",
  tattoos: "sleeve",
  jewelry: "gold chain",
  clothing_style: "luxury street",
  brand_colors: "gold/black",
  theme_id: "gold-royalty",
  personality: "calm",
  do_not_change_rules: "never change the chain",
  description: "Nova the great",
  special_style_rules: "film grain",
  reference_image_url: "https://img/nova.png",
  reference_image_path: "u-1/nova.png",
  reference_video_url: "https://vid/nova.mp4",
  consistency_prompt: "keep Nova consistent",
  voice_profile: { pitchSemitones: -2, formantRatio: 1, formantGainDb: 0, eq: [] },
};

describe("buildVaultRenameBody", () => {
  it("changes only the name and round-trips every stored field", () => {
    const body = buildVaultRenameBody(FULL_ROW, "  Nova Prime  ");
    expect(body).toEqual({
      artistName: "Nova Prime",
      artistType: "rapper",
      genre: "Trap",
      voiceStyle: "deep",
      visualStyle: "Street Cinematic",
      hair: "waves",
      tattoos: "sleeve",
      jewelry: "gold chain",
      clothingStyle: "luxury street",
      brandColors: "gold/black",
      themeId: "gold-royalty",
      personality: "calm",
      doNotChangeRules: "never change the chain",
      artistDescription: "Nova the great",
      specialStyleRules: "film grain",
      referenceImageUrl: "https://img/nova.png",
      referenceImagePath: "u-1/nova.png",
      consistencyPrompt: "keep Nova consistent",
      voiceProfile: { pitchSemitones: -2, formantRatio: 1, formantGainDb: 0, eq: [] },
    });
    /* The living loop is not an update field — the PUT must not carry
       it (the server never touches reference_video_url on update). */
    expect(body).not.toHaveProperty("referenceVideoUrl");
    expect(body).not.toHaveProperty("reference_video_url");
  });

  it("omits voiceProfile when the row never carried the field, and keeps nulls null", () => {
    const row = { ...FULL_ROW, genre: null };
    delete (row as Record<string, unknown>)["voice_profile"];
    const body = buildVaultRenameBody(row, "Nova");
    expect(body).not.toHaveProperty("voiceProfile");
    expect(body["genre"]).toBeNull();
  });
});

function jsonRes(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("renameVaultCharacter", () => {
  it("re-reads the vault, PUTs the round-tripped body, and returns the renamed character", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PUT") return jsonRes({ success: true });
      return jsonRes({ vaults: [FULL_ROW] });
    }) as unknown as typeof fetch;
    const out = await renameVaultCharacter(async () => "tok", "c1", "Nova Prime", "u-1", fetchFn);
    expect(out).toEqual({ id: "c1", name: "Nova Prime", portraitUrl: "https://img/nova.png", loopUrl: "https://vid/nova.mp4", isOwn: true });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("/api/artist-vaults/c1");
    const sent = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
    expect(sent["artistName"]).toBe("Nova Prime");
    expect(sent["doNotChangeRules"]).toBe("never change the chain");
  });

  it("refuses before any write when the character is gone or not the member's own", async () => {
    let writes = 0;
    const goneFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") writes++;
      return jsonRes({ vaults: [] });
    }) as unknown as typeof fetch;
    await expect(renameVaultCharacter(async () => "tok", "c1", "X", "u-1", goneFetch)).rejects.toThrow("isn't in your vault anymore");
    const sharedFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") writes++;
      return jsonRes({ vaults: [{ ...FULL_ROW, user_id: "u-2" }] });
    }) as unknown as typeof fetch;
    await expect(renameVaultCharacter(async () => "tok", "c1", "X", "u-1", sharedFetch)).rejects.toThrow("Only the owner");
    expect(writes).toBe(0);
  });

  it("surfaces the server's error when the PUT fails, and rejects a blank name without any fetch", async () => {
    const failFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return jsonRes({ error: "Invalid artist vault data" }, false, 400);
      return jsonRes({ vaults: [FULL_ROW] });
    }) as unknown as typeof fetch;
    await expect(renameVaultCharacter(async () => "tok", "c1", "Nova", "u-1", failFetch)).rejects.toThrow("Invalid artist vault data");
    let fetches = 0;
    const countingFetch = (async () => {
      fetches++;
      return jsonRes({ vaults: [FULL_ROW] });
    }) as unknown as typeof fetch;
    await expect(renameVaultCharacter(async () => "tok", "c1", "   ", "u-1", countingFetch)).rejects.toThrow("Give the character a name");
    expect(fetches).toBe(0);
  });
});

describe("removeVaultCharacter", () => {
  it("DELETEs the vault row and resolves on success", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonRes({ success: true });
    }) as unknown as typeof fetch;
    await removeVaultCharacter(async () => "tok", "c1", fetchFn);
    expect(calls).toEqual([{ url: "/api/artist-vaults/c1", init: expect.objectContaining({ method: "DELETE" }) }]);
  });

  it("throws the server's error instead of pretending the character is gone", async () => {
    const fetchFn = (async () => jsonRes({ error: "nope" }, false, 500)) as unknown as typeof fetch;
    await expect(removeVaultCharacter(async () => "tok", "c1", fetchFn)).rejects.toThrow("nope");
  });
});

describe("#98 vault creation + appearance editing", () => {
  it("reads the stored appearance from a snake_case row, camelCase stragglers included", () => {
    const a = vaultAppearanceFromRow(FULL_ROW);
    expect(a.visualStyle).toBe("Street Cinematic");
    expect(a.referenceImageUrl).toBe("https://img/nova.png");
    expect(a.themeId).toBe("gold-royalty");
    expect(a.artistDescription).toBe("Nova the great");
    const camel = vaultAppearanceFromRow({ visualStyle: "Neon", clothingStyle: "techwear" });
    expect(camel.visualStyle).toBe("Neon");
    expect(camel.clothingStyle).toBe("techwear");
    expect(camel.hair).toBeNull();
  });

  it("the appearance PUT round-trips untouched fields and lays the patch over them", () => {
    const body = buildVaultAppearanceBody(FULL_ROW, { hair: "  braids  ", jewelry: "" });
    /* patched fields change (trimmed; empty becomes null) */
    expect(body["hair"]).toBe("braids");
    expect(body["jewelry"]).toBeNull();
    /* untouched fields round-trip exactly — locked rules included */
    expect(body["doNotChangeRules"]).toBe("never change the chain");
    expect(body["consistencyPrompt"]).toBe("keep Nova consistent");
    expect(body["visualStyle"]).toBe("Street Cinematic");
    expect(body["artistName"]).toBe("Nova");
    expect(body["voiceProfile"]).toEqual(FULL_ROW.voice_profile);
    expect(body).not.toHaveProperty("referenceVideoUrl");
  });

  it("a name patch rides the same body; absent appearance keys never clear a field", () => {
    const body = buildVaultAppearanceBody(FULL_ROW, { artistName: " Nova II " });
    expect(body["artistName"]).toBe("Nova II");
    expect(body["hair"]).toBe("waves");
    for (const k of VAULT_APPEARANCE_KEYS) expect(body).toHaveProperty(k);
  });

  it("the create body carries the name + look, empties become null, theme defaults to Gold Royalty", () => {
    const body = buildVaultCreateBody({ artistName: "  Nova  ", appearance: { genre: "Trap", hair: "" } });
    expect(body["artistName"]).toBe("Nova");
    expect(body["genre"]).toBe("Trap");
    expect(body["hair"]).toBeNull();
    expect(body["themeId"]).toBe("gold-royalty");
    const themed = buildVaultCreateBody({ artistName: "Nova", appearance: { themeId: "crimson-reign" } });
    expect(themed["themeId"]).toBe("crimson-reign");
  });

  it("createVaultCharacter POSTs the vault rail and returns the new id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return jsonRes({ id: "c-new" }, true, 201);
    }) as unknown as typeof fetch;
    const id = await createVaultCharacter(async () => "tok", { artistName: "Nova", appearance: { genre: "Trap" } }, fetchFn);
    expect(id).toBe("c-new");
    expect(calls[0]?.url).toBe("/api/artist-vaults");
    expect(calls[0]?.init?.method).toBe("POST");
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent["artistName"]).toBe("Nova");
    expect(sent["genre"]).toBe("Trap");
    /* a blank name never reaches the rail */
    await expect(createVaultCharacter(async () => "tok", { artistName: "   " }, fetchFn)).rejects.toThrow("Give the character a name");
    expect(calls).toHaveLength(1);
  });

  it("fetchVaultAppearance reads the row fresh and refuses a team-shared row", async () => {
    const ownFetch = (async () => jsonRes({ vaults: [FULL_ROW] })) as unknown as typeof fetch;
    const got = await fetchVaultAppearance(async () => "tok", "c1", "u-1", ownFetch);
    expect(got.name).toBe("Nova");
    expect(got.appearance.hair).toBe("waves");
    const sharedFetch = (async () => jsonRes({ vaults: [{ ...FULL_ROW, user_id: "u-2" }] })) as unknown as typeof fetch;
    await expect(fetchVaultAppearance(async () => "tok", "c1", "u-1", sharedFetch)).rejects.toThrow("Only the owner");
  });

  it("saveVaultAppearance re-reads, refuses non-owners before any write, and PUTs the patched round-trip", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (init?.method === "PUT") return jsonRes({ success: true });
      return jsonRes({ vaults: [FULL_ROW] });
    }) as unknown as typeof fetch;
    await saveVaultAppearance(async () => "tok", "c1", { visualStyle: "Golden Noir" }, "u-1", fetchFn);
    const put = calls.find((c) => c.init?.method === "PUT");
    expect(put?.url).toBe("/api/artist-vaults/c1");
    const sent = JSON.parse(String(put?.init?.body)) as Record<string, unknown>;
    expect(sent["visualStyle"]).toBe("Golden Noir");
    expect(sent["doNotChangeRules"]).toBe("never change the chain");

    let writes = 0;
    const sharedFetch = (async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") writes++;
      return jsonRes({ vaults: [{ ...FULL_ROW, user_id: "u-2" }] });
    }) as unknown as typeof fetch;
    await expect(saveVaultAppearance(async () => "tok", "c1", { hair: "x" }, "u-1", sharedFetch)).rejects.toThrow("Only the owner");
    expect(writes).toBe(0);
  });
});
