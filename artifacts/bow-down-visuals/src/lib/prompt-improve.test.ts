import { describe, it, expect } from "vitest";
import { deriveProjectContext } from "./prompt-improve";

describe("deriveProjectContext", () => {
  it("derives full context when input_data has all fields (Song + Video projects)", () => {
    const result = deriveProjectContext({
      videoStyle: "Cinematic",
      platform: "TikTok / Reels (Vertical 9:16)",
      artistDescription: "Confident rapper with a calm stage presence",
      visualStyleRules: "Neon-lit urban nightlife",
      brandColors: "Purple and gold",
      doNotChangeRules: "Never show tattoos on the neck",
    });

    expect(result.videoStyle).toBe("Cinematic");
    expect(result.platform).toBe("TikTok / Reels (Vertical 9:16)");
    expect(result.artistVault).toEqual({
      artistDescription: "Confident rapper with a calm stage presence",
      visualStyle: "Neon-lit urban nightlife",
      brandColors: "Purple and gold",
      doNotChangeRules: "Never show tattoos on the neck",
    });
  });

  it("returns undefined/null context (no crash) for null input_data, e.g. pre-field legacy projects", () => {
    const result = deriveProjectContext(null);
    expect(result.videoStyle).toBeUndefined();
    expect(result.platform).toBeUndefined();
    expect(result.artistVault).toBeNull();
  });

  it("returns undefined/null context (no crash) for undefined input_data", () => {
    const result = deriveProjectContext(undefined);
    expect(result.videoStyle).toBeUndefined();
    expect(result.platform).toBeUndefined();
    expect(result.artistVault).toBeNull();
  });

  it("returns undefined/null context (no crash) for an empty input_data object", () => {
    const result = deriveProjectContext({});
    expect(result.videoStyle).toBeUndefined();
    expect(result.platform).toBeUndefined();
    expect(result.artistVault).toBeNull();
  });

  it("handles legacy 'Make a Music Video' projects that only stored a subset of fields", () => {
    const result = deriveProjectContext({
      lyrics: "some lyrics text",
      audioUrl: "https://cdn.example.com/song.mp3",
      videoStyle: "Documentary",
    });
    expect(result.videoStyle).toBe("Documentary");
    expect(result.platform).toBeUndefined();
    expect(result.artistVault).toBeNull();
  });

  it("builds a partial artist vault when only some vault fields are present", () => {
    const result = deriveProjectContext({
      brandColors: "Red and black",
    });
    expect(result.artistVault).toEqual({
      artistDescription: null,
      visualStyle: null,
      brandColors: "Red and black",
      doNotChangeRules: null,
    });
  });

  it("ignores fields with unexpected non-string types instead of crashing", () => {
    const result = deriveProjectContext({
      videoStyle: 123 as unknown as string,
      platform: { name: "TikTok" } as unknown as string,
      artistDescription: ["array", "not", "string"] as unknown as string,
    });
    expect(result.videoStyle).toBeUndefined();
    expect(result.platform).toBeUndefined();
    expect(result.artistVault).toBeNull();
  });

  it("treats blank/whitespace-only strings as absent", () => {
    const result = deriveProjectContext({
      videoStyle: "   ",
      platform: "",
      artistDescription: "  ",
    });
    expect(result.videoStyle).toBeUndefined();
    expect(result.platform).toBeUndefined();
    expect(result.artistVault).toBeNull();
  });
});
