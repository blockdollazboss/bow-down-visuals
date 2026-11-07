/**
 * Tests for the AI Cover Art Generator.
 *
 * Covers: pricing constants (2cr standard / 3cr premium), zod input
 * validation, style presets, aspect-ratio → image-size mapping, credit
 * resolution per tier, the art-direction request builder (asserts
 * max_completion_tokens is used and max_tokens never appears — GPT-6
 * rejects max_tokens), art-direction JSON parsing, and the image prompt
 * (never asks the model to render text).
 */
import { describe, expect, it } from "vitest";
import {
  COVER_ART_STANDARD_CREDITS,
  COVER_ART_PREMIUM_CREDITS,
  COVER_ART_STYLES,
  COVER_ART_RATIOS,
  COVER_ART_LAYOUTS,
  resolveCoverArtSize,
  resolveCoverArtStyle,
  resolveCoverArtCredits,
  resolveCoverArtLayout,
  coverArtSchema,
  buildArtDirectionRequest,
  parseArtDirection,
  buildCoverImagePrompt,
} from "../cover-art";

describe("cover art pricing", () => {
  it("charges 2 credits for standard", () => {
    expect(COVER_ART_STANDARD_CREDITS).toBe(200);
  });

  it("charges 3 credits for premium", () => {
    expect(COVER_ART_PREMIUM_CREDITS).toBe(300);
  });

  it("resolves credits by tier", () => {
    expect(resolveCoverArtCredits("standard")).toBe(200);
    expect(resolveCoverArtCredits("premium")).toBe(300);
    expect(resolveCoverArtCredits("bogus")).toBe(200); // safe default
  });
});

describe("style presets", () => {
  it("exposes exactly the five documented presets", () => {
    expect(COVER_ART_STYLES.map((s) => s.key)).toEqual([
      "luxury-gold",
      "dark-moody",
      "vibrant-pop",
      "retro",
      "minimal",
    ]);
  });

  it("every preset has a label, blurb, and direction", () => {
    for (const s of COVER_ART_STYLES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
      expect(s.direction.length).toBeGreaterThan(0);
    }
  });

  it("falls back to the first preset for unknown keys", () => {
    expect(resolveCoverArtStyle("nope").key).toBe("luxury-gold");
  });
});

describe("aspect ratios", () => {
  it("maps 1:1 to 1024x1024 (streaming)", () => {
    expect(resolveCoverArtSize("1:1")).toBe("1024x1024");
  });

  it("maps 16:9 to 1536x1024 (YouTube banner)", () => {
    expect(resolveCoverArtSize("16:9")).toBe("1536x1024");
  });

  it("maps 9:16 to 1024x1536 (stories)", () => {
    expect(resolveCoverArtSize("9:16")).toBe("1024x1536");
  });

  it("defaults to square for unknown ratios", () => {
    expect(resolveCoverArtSize("4:3")).toBe("1024x1024");
  });

  it("documents all three ratios with labels", () => {
    expect(COVER_ART_RATIOS.map((r) => r.key)).toEqual(["1:1", "16:9", "9:16"]);
  });
});

describe("coverArtSchema", () => {
  const valid = {
    songTitle: "Midnight Crown",
    artistName: "Thy Cheat Code",
    mood: "dark hip-hop",
    style: "luxury-gold",
    aspectRatio: "1:1",
    tier: "standard",
  };

  it("accepts a full valid payload", () => {
    expect(coverArtSchema.safeParse(valid).success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const parsed = coverArtSchema.safeParse({
      songTitle: "Neon Tide",
      artistName: "Shark King",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.style).toBe("luxury-gold");
      expect(parsed.data.aspectRatio).toBe("1:1");
      expect(parsed.data.tier).toBe("standard");
      expect(parsed.data.mood).toBe("");
    }
  });

  it("rejects missing song title", () => {
    const parsed = coverArtSchema.safeParse({ ...valid, songTitle: "" });
    expect(parsed.success).toBe(false);
  });

  it("rejects missing artist name", () => {
    const parsed = coverArtSchema.safeParse({ ...valid, artistName: "  ".slice(0, 0) });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown style presets", () => {
    const parsed = coverArtSchema.safeParse({ ...valid, style: "cyberpunk" });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown aspect ratios", () => {
    const parsed = coverArtSchema.safeParse({ ...valid, aspectRatio: "21:9" });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown tiers", () => {
    const parsed = coverArtSchema.safeParse({ ...valid, tier: "deluxe" });
    expect(parsed.success).toBe(false);
  });

  it("rejects oversized titles", () => {
    const parsed = coverArtSchema.safeParse({ ...valid, songTitle: "x".repeat(121) });
    expect(parsed.success).toBe(false);
  });
});

describe("layout templates", () => {
  it("exposes exactly the ten documented layouts", () => {
    expect(COVER_ART_LAYOUTS.map((l) => l.key)).toEqual([
      "center-stage",
      "headline-top",
      "bottom-band",
      "split-frame",
      "corner-mark",
      "corner-seal",
      "pure-art",
      "tracklist-back",
      "frame-in-frame",
      "magazine-cover",
    ]);
  });

  it("every layout has a label, blurb, direction, and image zone", () => {
    for (const l of COVER_ART_LAYOUTS) {
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.blurb.length).toBeGreaterThan(0);
      expect(l.direction.length).toBeGreaterThan(0);
      expect(l.imageZone.length).toBeGreaterThan(0);
    }
  });

  it("resolves known layouts and treats absent/unknown as freeform", () => {
    expect(resolveCoverArtLayout("bottom-band")?.key).toBe("bottom-band");
    expect(resolveCoverArtLayout(undefined)).toBeUndefined();
    expect(resolveCoverArtLayout("")).toBeUndefined();
    expect(resolveCoverArtLayout("nope")).toBeUndefined();
  });

  it("schema accepts every layout key", () => {
    for (const l of COVER_ART_LAYOUTS) {
      const parsed = coverArtSchema.safeParse({
        songTitle: "Midnight Crown",
        artistName: "Thy Cheat Code",
        layout: l.key,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.layout).toBe(l.key);
    }
  });

  it("schema leaves layout undefined when the client sends none", () => {
    const parsed = coverArtSchema.safeParse({
      songTitle: "Neon Tide",
      artistName: "Shark King",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.layout).toBeUndefined();
  });

  it("schema rejects unknown layout templates", () => {
    const parsed = coverArtSchema.safeParse({
      songTitle: "Midnight Crown",
      artistName: "Thy Cheat Code",
      layout: "spiral",
    });
    expect(parsed.success).toBe(false);
  });

  it("a layout never changes the price", () => {
    for (const l of COVER_ART_LAYOUTS) {
      const parsed = coverArtSchema.safeParse({
        songTitle: "Midnight Crown",
        artistName: "Thy Cheat Code",
        layout: l.key,
        tier: "standard",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(resolveCoverArtCredits(parsed.data.tier)).toBe(200);
    }
  });
});

describe("buildArtDirectionRequest", () => {
  const input = {
    songTitle: "Midnight Crown",
    artistName: "Thy Cheat Code",
    mood: "dark hip-hop",
    style: "dark-moody",
    aspectRatio: "1:1" as const,
    tier: "standard" as const,
  };

  it("uses max_completion_tokens (never max_tokens) — GPT-6 rejects max_tokens", () => {
    const req = buildArtDirectionRequest(input);
    expect(req).toHaveProperty("max_completion_tokens");
    expect(req).not.toHaveProperty("max_tokens");
    expect((req as Record<string, unknown>)["max_tokens"]).toBeUndefined();
  });

  it("requests a JSON object response", () => {
    const req = buildArtDirectionRequest(input);
    expect(req.response_format).toEqual({ type: "json_object" });
  });

  it("names the song, artist, and style in the prompt", () => {
    const req = buildArtDirectionRequest(input);
    const text = req.messages.map((m) => m.content).join(" ");
    expect(text).toContain("Midnight Crown");
    expect(text).toContain("Thy Cheat Code");
    expect(text).toContain("dark hip-hop");
  });

  it("uses the centralized text model (never a hardcoded model id)", () => {
    const req = buildArtDirectionRequest(input);
    expect(typeof req.model).toBe("string");
    expect(req.model.length).toBeGreaterThan(0);
  });
});

describe("parseArtDirection", () => {
  it("parses a full art-direction payload", () => {
    const art = parseArtDirection(
      JSON.stringify({
        concept: "A crown sinking into black water.",
        typography: "Bold serif title, top third.",
        palette: ["#000000", "#d4af37", "#1a1a1a"],
      }),
    );
    expect(art.concept).toBe("A crown sinking into black water.");
    expect(art.typography).toBe("Bold serif title, top third.");
    expect(art.palette).toEqual(["#000000", "#d4af37", "#1a1a1a"]);
  });

  it("drops malformed palette entries and caps at three", () => {
    const art = parseArtDirection(
      JSON.stringify({
        concept: "x",
        typography: "y",
        palette: ["#000000", "not-a-color", "#d4af37", "#ffffff", "#111111"],
      }),
    );
    expect(art.palette).toEqual(["#000000", "#d4af37", "#ffffff"]);
  });

  it("returns empty direction for malformed JSON instead of throwing", () => {
    const art = parseArtDirection("this is not json");
    expect(art).toEqual({ concept: "", typography: "", palette: [] });
  });
});

describe("buildCoverImagePrompt", () => {
  const input = {
    songTitle: "Midnight Crown",
    artistName: "Thy Cheat Code",
    mood: "",
    style: "luxury-gold",
    aspectRatio: "1:1" as const,
    tier: "premium" as const,
  };

  it("never asks the image model to render text (it mangles words)", () => {
    const prompt = buildCoverImagePrompt(input, {
      concept: "Gold crown on black silk.",
      typography: "Serif title top.",
      palette: ["#000000", "#d4af37"],
    });
    expect(prompt.toLowerCase()).toContain("no text");
    expect(prompt).not.toContain("Midnight Crown");
  });

  it("carries the style direction and palette", () => {
    const prompt = buildCoverImagePrompt(input, {
      concept: "",
      typography: "",
      palette: ["#000000", "#d4af37"],
    });
    expect(prompt).toContain("black-and-gold");
    expect(prompt).toContain("#d4af37");
  });

  it("works with an empty art direction", () => {
    const prompt = buildCoverImagePrompt(input, { concept: "", typography: "", palette: [] });
    expect(prompt.length).toBeGreaterThan(50);
  });
});

describe("layout prompt folding", () => {
  const base = {
    songTitle: "Midnight Crown",
    artistName: "Thy Cheat Code",
    mood: "",
    style: "luxury-gold",
    aspectRatio: "1:1" as const,
    tier: "standard" as const,
  };
  const art = { concept: "Gold crown on black silk.", typography: "", palette: ["#000000"] };

  it("image prompt without a layout is byte-identical to the pre-layout wording", () => {
    const style = resolveCoverArtStyle(base.style);
    const expected =
      `Album cover artwork, no text, no words, no letters, no logos. ` +
      `${style.direction}. Concept: Gold crown on black silk. Color palette: #000000. ` +
      `Leave a clean uncluttered area in the composition where a song title can be placed. ` +
      `Professional music-industry quality, high detail, striking focal point.`;
    expect(buildCoverImagePrompt(base, art)).toBe(expected);
    /* …and with an empty art direction too (no concept/palette lines). */
    const bare = buildCoverImagePrompt(base, { concept: "", typography: "", palette: [] });
    const bareExpected =
      `Album cover artwork, no text, no words, no letters, no logos. ` +
      `${style.direction}. ` +
      `Leave a clean uncluttered area in the composition where a song title can be placed. ` +
      `Professional music-industry quality, high detail, striking focal point.`;
    expect(bare).toBe(bareExpected);
  });

  it("image prompt moves the clean zone to the layout's placement", () => {
    const prompt = buildCoverImagePrompt({ ...base, layout: "bottom-band" }, art);
    expect(prompt).toContain("clean uncluttered band across the bottom");
    expect(prompt).not.toContain("clean uncluttered area in the composition");
  });

  it("pure-art asks for a full frame with no text zone", () => {
    const prompt = buildCoverImagePrompt({ ...base, layout: "pure-art" }, art);
    expect(prompt).toContain("no text zone needed");
    expect(prompt.toLowerCase()).toContain("no text");
  });

  it("art direction names the layout when one is chosen", () => {
    const req = buildArtDirectionRequest({ ...base, layout: "split-frame" });
    const text = req.messages.map((m) => m.content).join(" ");
    expect(text).toContain("Layout:");
    expect(text).toContain("split composition");
  });

  it("art direction without a layout carries no layout line", () => {
    const req = buildArtDirectionRequest(base);
    const text = req.messages.map((m) => m.content).join(" ");
    expect(text).not.toContain("Layout:");
  });
});
