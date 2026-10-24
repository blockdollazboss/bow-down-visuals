import { describe, expect, it } from "vitest";
import {
  TARGET_LANGUAGES,
  isSupportedLanguage,
  languageLabel,
  estimateTranslateCost,
  formatDuration,
  TRANSLATOR_CREDITS_PER_MIN_PER_LANG,
  TRANSLATOR_MAX_LANGUAGES,
} from "./video-translator";

describe("video-translator lib", () => {
  it("prices at 500 Visual Bucs per minute per language (rail truth)", () => {
    // Pin corrected Stack-100 #3 Lane D: the rail charges
    // VIDEO_TRANSLATOR_CREDITS_PER_MINUTE = 500 (api-server
    // routes/generate/video-translator.ts, pinned 500 in its own suite).
    // The old pin held the pre-x100-rescale figure 5, so the UI preview
    // under-quoted the real charge 100x.
    expect(TRANSLATOR_CREDITS_PER_MIN_PER_LANG).toBe(500);
  });

  it("caps at 6 languages per job", () => {
    expect(TRANSLATOR_MAX_LANGUAGES).toBe(6);
  });

  it("estimates cost from duration and language count", () => {
    // 90s, 2 languages → 2 min × 2 × 500 = 2000 (matches the rail's
    // estimateTranslateCost for the same inputs)
    expect(estimateTranslateCost(90, 2)).toEqual({ billableMinutes: 2, credits: 2000 });
  });

  it("floors unknown duration at the 1-minute estimate", () => {
    expect(estimateTranslateCost(null, 1).credits).toBe(500);
    expect(estimateTranslateCost(0, 3).billableMinutes).toBe(1);
  });

  it("validates language codes against the catalog", () => {
    expect(isSupportedLanguage("es")).toBe(true);
    expect(isSupportedLanguage("xx")).toBe(false);
  });

  it("labels known languages, passes through unknown codes", () => {
    expect(languageLabel("fr")).toBe("French");
    expect(languageLabel("xx")).toBe("xx");
  });

  it("covers the core creator languages", () => {
    const codes = TARGET_LANGUAGES.map((l) => l.code);
    for (const c of ["es", "fr", "pt", "de"]) expect(codes).toContain(c);
  });

  it("formats durations for the UI", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(5)).toBe("0:05");
  });
});
