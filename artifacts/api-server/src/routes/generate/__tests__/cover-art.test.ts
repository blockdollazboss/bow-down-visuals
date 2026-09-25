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
  resolveCoverArtSize,
  resolveCoverArtStyle,
  resolveCoverArtCredits,
  coverArtSchema,
  buildArtDirectionRequest,
  parseArtDirection,
  buildCoverImagePrompt,
} from "../cover-art";

describe("cover art pricing", () => {
  it("charges 2 credits for standard", () => {
    expect(COVER_ART_STANDARD_CREDITS).toBe(2);
  });

  it("charges 3 credits for premium", () => {
    expect(COVER_ART_PREMIUM_CREDITS).toBe(3);
  });

  it("resolves credits by tier", () => {
    expect(resolveCoverArtCredits("standard")).toBe(2);
    expect(resolveCoverArtCredits("premium")).toBe(3);
    expect(resolveCoverArtCredits("bogus")).toBe(2); // safe default
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
