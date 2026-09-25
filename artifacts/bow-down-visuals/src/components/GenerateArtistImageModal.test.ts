import { describe, it, expect } from "vitest";
import { buildArtistImagePrompt, ARTIST_IMAGE_MODELS, ARTIST_IMAGE_RATIOS } from "./generate-artist-image";

const base = {
  visualStyle: "",
  artistType: "",
  hair: "",
  tattoos: "",
  jewelry: "",
  clothingStyle: "",
  brandColors: "",
  personality: "",
  genre: "",
  doNotChangeRules: "",
};

describe("buildArtistImagePrompt", () => {
  it("builds a base portrait prompt from empty fields", () => {
    const p = buildArtistImagePrompt(base);
    expect(p).toContain("Professional artist portrait photograph");
    expect(p).toContain("Photorealistic");
  });

  it("weaves vault fields into the prompt", () => {
    const p = buildArtistImagePrompt({
      ...base,
      visualStyle: "cinematic",
      hair: "long braids",
      tattoos: "dragon sleeve",
      jewelry: "gold chains",
      clothingStyle: "leather jacket",
      brandColors: "black and gold",
      personality: "fierce",
      genre: "hip-hop",
    });
    for (const bit of ["cinematic", "long braids", "dragon sleeve", "gold chains", "leather jacket", "black and gold", "fierce", "hip-hop"]) {
      expect(p).toContain(bit);
    }
  });

  it("appends do-not-change rules and caps length", () => {
    const p = buildArtistImagePrompt({ ...base, doNotChangeRules: "Never cartoon style." });
    expect(p).toContain("Strict rules: Never cartoon style.");
    expect(p.length).toBeLessThanOrEqual(900);
  });
});

describe("artist image model catalog", () => {
  it("offers gen4_image as the quality default and turbo as the cheap option", () => {
    expect(ARTIST_IMAGE_MODELS.find((m) => m.id === "gen4_image")!.credits).toBe(3);
    expect(ARTIST_IMAGE_MODELS.find((m) => m.id === "gen4_image_turbo")!.credits).toBe(2);
  });

  it("offers portrait, square, and landscape ratios with portrait first", () => {
    expect(ARTIST_IMAGE_RATIOS.map((r) => r.id)).toEqual(["1080:1920", "1080:1080", "1920:1080"]);
  });
});
