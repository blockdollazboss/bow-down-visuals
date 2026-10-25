import { describe, expect, it } from "vitest";
import {
  formatLipSyncResultMeta,
  lipSyncProviderLabel,
} from "../lip-sync-result-meta";

describe("lipSyncProviderLabel (board item 60: no raw provider ids in the editor)", () => {
  it("maps the raw LatentSync id to a human label", () => {
    expect(lipSyncProviderLabel("latentsync")).toBe("LatentSync");
  });
  it("maps the sync family to Sync", () => {
    expect(lipSyncProviderLabel("sync")).toBe("Sync");
    expect(lipSyncProviderLabel("sync.so")).toBe("Sync");
  });
  it("falls back honestly for empty values", () => {
    expect(lipSyncProviderLabel(null)).toBe("Lip Sync");
    expect(lipSyncProviderLabel(undefined)).toBe("Lip Sync");
    expect(lipSyncProviderLabel("")).toBe("Lip Sync");
  });
});

describe("formatLipSyncResultMeta (item 191: 0230 result_meta surfaced)", () => {
  it("states a reduced resolution plainly with both sizes", () => {
    const s = formatLipSyncResultMeta({
      provider: "latentsync",
      inputWidth: 672,
      inputHeight: 1344,
      outputWidth: 432,
      outputHeight: 880,
      resolutionReduced: true,
    });
    expect(s).toContain("432×880");
    expect(s).toContain("672×1344");
    expect(s).toContain("reduced the resolution");
  });

  it("states same resolution when the provider did not reduce", () => {
    const s = formatLipSyncResultMeta({
      inputWidth: 720,
      inputHeight: 1280,
      outputWidth: 720,
      outputHeight: 1280,
      resolutionReduced: false,
    });
    expect(s).toContain("720×1280");
    expect(s).toContain("same resolution");
  });

  it("states unknown as unknown when the probe could not answer", () => {
    const s = formatLipSyncResultMeta({
      inputWidth: 720,
      inputHeight: 1280,
      outputWidth: 720,
      outputHeight: 1280,
      resolutionReduced: null,
    });
    expect(s).toContain("did not report whether the resolution changed");
  });

  it("says the final size was not reported when the output probe failed", () => {
    const s = formatLipSyncResultMeta({
      inputWidth: 720,
      inputHeight: 1280,
      outputWidth: null,
      outputHeight: null,
      resolutionReduced: null,
    });
    expect(s).toBe("Final size: not reported by the lip-sync provider.");
  });

  it("returns null for pre-0230 jobs with no metadata at all", () => {
    expect(formatLipSyncResultMeta(null)).toBeNull();
    expect(formatLipSyncResultMeta(undefined)).toBeNull();
    expect(formatLipSyncResultMeta({})).toBeNull();
  });
});
