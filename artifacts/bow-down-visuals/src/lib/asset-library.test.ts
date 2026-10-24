import { describe, expect, it, vi, afterEach } from "vitest";
import {
  downloadLicenceCertificate, fetchAssetLibrary, fetchProvenance, libraryAssetsOfKind, saveAssetLicence,
  type LibraryAsset, type ProvenanceRecord,
} from "./asset-library";

const sampleRecord: ProvenanceRecord = {
  assetId: "gen:g1",
  title: "Thumb",
  mediaKind: "image",
  creator: { id: "u1", name: "TRGDY TRBLZ" },
  createdWith: { tool: "Thumbnail Studio", model: null, platform: "Bow Down Visuals" },
  createdAt: "2026-01-02T00:00:00.000Z",
  aiGenerated: true,
  editHistory: ["Created 2026-01-02 with Thumbnail Studio on Bow Down Visuals."],
  licence: "all-rights-reserved",
  disclosureDefaultEnabled: true,
};

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

  describe("provenance doors (lane F7)", () => {
    it("fetchProvenance splits the library id into the /api/provenance path", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ record: sampleRecord, licenceOptions: [{ id: "cc-by-4.0", name: "CC BY 4.0", summary: "", url: null }] }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      const out = await fetchProvenance(async () => "tok-1", "gen:g1");
      expect(out?.record).toEqual(sampleRecord);
      expect(out?.licenceOptions[0]?.id).toBe("cc-by-4.0");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/provenance/gen/g1");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer " + "tok-1");
    });

    it("fetchProvenance returns null for malformed ids and failed reads", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
      expect(await fetchProvenance(async () => null, "nocolon")).toBeNull();
      expect(await fetchProvenance(async () => null, "weird:kind")).toBeNull();
      expect(await fetchProvenance(async () => null, "gen:g1")).toBeNull();
    });

    it("saveAssetLicence posts the choice and returns the updated record", async () => {
      const updated = { ...sampleRecord, licence: "cc-by-4.0" as const };
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ record: updated }) }));
      vi.stubGlobal("fetch", fetchMock);
      const out = await saveAssetLicence(async () => "tok-1", "hub:a1", "cc-by-4.0");
      expect(out?.licence).toBe("cc-by-4.0");
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/provenance/hub/a1/licence");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ licence: "cc-by-4.0" });
    });

    it("downloadLicenceCertificate saves the PDF under the server's filename", async () => {
      const blob = new Blob(["%PDF-fake"], { type: "application/pdf" });
      vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        blob: async () => blob,
        headers: { get: (n: string) => (n === "content-disposition" ? 'attachment; filename="thumb-licence-certificate.pdf"' : null) },
      })));
      const createObjectURL = vi.fn(() => "blob:fake");
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
      /* lib tests run in a node environment — stub the DOM surface the
         helper touches (anchor + body) instead of a real document. */
      const click = vi.fn();
      const anchor = { href: "", download: "", click, remove: vi.fn() };
      vi.stubGlobal("document", {
        createElement: vi.fn(() => anchor),
        body: { appendChild: vi.fn() },
      });
      const ok = await downloadLicenceCertificate(async () => "tok-1", "gen:g1", "fallback.pdf");
      expect(ok).toBe(true);
      expect(anchor.download).toBe("thumb-licence-certificate.pdf");
      expect(click).toHaveBeenCalled();
    });
  });
});
