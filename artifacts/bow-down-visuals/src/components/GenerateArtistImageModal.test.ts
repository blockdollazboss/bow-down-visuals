import { describe, it, expect } from "vitest";
import {
  buildArtistImagePrompt,
  ARTIST_IMAGE_MODELS,
  ARTIST_IMAGE_RATIOS,
  SHOOT_POSES,
  SHOOT_OUTFITS,
  SHOOT_BACKGROUNDS,
  composePhotoShootBrief,
} from "./generate-artist-image";

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
  it("offers GPT Image 2.5 as the best-quality default, gen4 as alternative, turbo as the cheap option", () => {
    expect(ARTIST_IMAGE_MODELS[0].id).toBe("gpt-image-2.5-sunburst");
    expect(ARTIST_IMAGE_MODELS.find((m) => m.id === "gpt-image-2.5-sunburst")!.credits).toBe(2);
    expect(ARTIST_IMAGE_MODELS.find((m) => m.id === "gen4_image")!.credits).toBe(3);
    expect(ARTIST_IMAGE_MODELS.find((m) => m.id === "gen4_image_turbo")!.credits).toBe(2);
  });

  it("offers portrait, square, and landscape ratios with portrait first", () => {
    expect(ARTIST_IMAGE_RATIOS.map((r) => r.id)).toEqual(["1080:1920", "1080:1080", "1920:1080"]);
  });
});

describe("photo shoot presets", () => {
  it("offers 4 poses, 6 wardrobe presets, and 4 backdrops", () => {
    expect(SHOOT_POSES.map((p) => p.label)).toEqual(["Portrait", "Full body", "Throne pose", "Action"]);
    expect(SHOOT_OUTFITS).toHaveLength(6);
    expect(SHOOT_BACKGROUNDS.map((b) => b.label)).toEqual(["Keep as reference", "Studio", "Stage", "Throne room"]);
  });

  it("composes a brief from pose, outfit, and backdrop", () => {
    const brief = composePhotoShootBrief("throne", "black streetwear", "in a studio");
    expect(brief).toContain("seated on a golden throne");
    expect(brief).toContain("wearing black streetwear");
    expect(brief).toContain("in a studio");
    expect(brief).toContain("Photorealistic");
  });

  it("falls back to the first pose for an unknown pose id and skips an empty outfit", () => {
    const brief = composePhotoShootBrief("nope", "  ", "on a stage");
    expect(brief).toContain("upper-body portrait");
    expect(brief).not.toContain("wearing .");
    expect(brief).toContain("on a stage");
  });
});
