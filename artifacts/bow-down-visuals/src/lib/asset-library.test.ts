import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchAssetLibrary, libraryAssetsOfKind, type LibraryAsset } from "./asset-library";

const sample: LibraryAsset[] = [
  { id: "hub:a1", mediaKind: "audio", hubKind: "song", label: "Song", url: "https://x/s.mp3", origin: "project", detail: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "gen:g1", mediaKind: "image", hubKind: null, label: "Thumb", url: "https://x/t.jpg", origin: "generation", detail: "thumbnail", createdAt: "2026-01-02T00:00:00.000Z" },
];

describe("asset library client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the unified library with the caller's token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ assets: sample }) }));
    vi.stubGlobal("fetch", fetchMock);
    const assets = await fetchAssetLibrary(async () => "tok-1");
    expect(assets).toEqual(sample);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(libraryAssetsOfKind(assets, "image")).toEqual([sample[1]]);
  });

  it("throws on failure so callers show an honest error, not a fake empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(fetchAssetLibrary(async () => null)).rejects.toThrow("500");
  });
});
