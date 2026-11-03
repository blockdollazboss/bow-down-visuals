/**
 * suggest — the ONE suggestion brain (stack1400 org wave #2, audit §3.3).
 *
 * Pins: the brain derives hooks / titles / captions / bio from the
 * profile's own fields only; a profile with no usable signal gets
 * null (surfaces fall back to their raw value / honest empty state —
 * never an invented suggestion); and the shared prefill rule never
 * overwrites text the creator already has.
 */
import { describe, expect, it } from "vitest";
import {
  prefillWithSuggestion,
  suggestedBioForProfile,
  suggestionSubject,
  suggestionsForProfile,
} from "./suggest";

const FULL = {
  displayName: "King Shark",
  genre: "Hip-Hop",
  vertical: "music",
  personality: "bold and playful",
  visualStyle: "gold luxury",
  voiceStyle: "deep",
};

describe("suggestionsForProfile — derived from the profile", () => {
  it("builds hooks, titles, captions and a bio from a full profile", () => {
    const s = suggestionsForProfile(FULL);
    expect(s).not.toBeNull();
    expect(s!.hooks).toHaveLength(3);
    expect(s!.titles).toHaveLength(3);
    expect(s!.captions.length).toBeGreaterThanOrEqual(2);
    expect(s!.hooks.join(" ")).toContain("Hip-Hop");
    expect(s!.captions.join(" ")).toContain("King Shark");
    expect(s!.bio).toContain("King Shark makes Hip-Hop.");
    expect(s!.bio).toContain("Bold and playful.");
    expect(s!.bio).toContain("gold luxury · deep");
    expect(s!.topic).toBe("King Shark — Hip-Hop");
  });

  it("genre beats vertical for the subject; vertical is the fallback lane", () => {
    expect(suggestionSubject({ genre: "Drill", vertical: "music" })).toBe("Drill");
    expect(suggestionSubject({ vertical: "podcast" })).toBe("podcast episodes");
    expect(suggestionSubject({ vertical: "unknown-thing" })).toBeNull();
    expect(suggestionSubject({})).toBeNull();
  });

  it("works from a name alone, and from a vertical alone", () => {
    const byName = suggestionsForProfile({ displayName: "Nova" });
    expect(byName).not.toBeNull();
    expect(byName!.bio).toContain("Nova creates.");
    const byVertical = suggestionsForProfile({ vertical: "gaming" });
    expect(byVertical).not.toBeNull();
    expect(byVertical!.bio).toContain("streams and clips");
  });

  it("returns null — never an invented suggestion — for an empty profile", () => {
    expect(suggestionsForProfile({})).toBeNull();
    expect(suggestionsForProfile({ displayName: "  ", genre: "", vertical: null })).toBeNull();
    expect(suggestedBioForProfile({})).toBeNull();
  });

  it("never carries style lines the profile does not have", () => {
    const s = suggestionsForProfile({ displayName: "Nova", vertical: "music" });
    expect(s!.bio).not.toContain("Signature look");
  });
});

describe("prefillWithSuggestion — the shared surface rule", () => {
  it("fills an empty field from the brain", () => {
    expect(prefillWithSuggestion("", "Suggested bio")).toBe("Suggested bio");
    expect(prefillWithSuggestion("   ", "Suggested bio")).toBe("Suggested bio");
  });

  it("never overwrites the creator's own text", () => {
    expect(prefillWithSuggestion("My own bio", "Suggested bio")).toBe("My own bio");
  });

  it("falls back to the current value when the brain has nothing", () => {
    expect(prefillWithSuggestion("", null)).toBe("");
    expect(prefillWithSuggestion("raw profile value", null)).toBe("raw profile value");
  });
});
