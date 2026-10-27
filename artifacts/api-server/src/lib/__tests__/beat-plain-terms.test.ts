import { describe, it, expect } from "vitest";
import type { BeatLicenseTerms } from "@workspace/db";
import { plainWordsForTerms, renderPlainTermsText } from "../beat-plain-terms";

const base: BeatLicenseTerms = {
  name: "Basic",
  format: "mp3",
  streamsCap: 50_000,
  salesCap: null,
  musicVideosCap: 1,
  radioTvAllowed: false,
  livePerformancesCap: null,
  termYears: null,
  territory: "Worldwide",
  creditLine: null,
  termsNote: null,
  isExclusive: false,
};

function allLines(terms: BeatLicenseTerms): string[] {
  return plainWordsForTerms(terms).flatMap((s) => s.lines);
}

describe("plainWordsForTerms", () => {
  it("renders the four sections in reading order", () => {
    expect(plainWordsForTerms(base).map((s) => s.heading)).toEqual([
      "What you get",
      "What you can do",
      "The limits",
      "Credit",
    ]);
  });

  it("says the caps as caps and the unlimited parts as unlimited", () => {
    const lines = allLines(base);
    expect(lines).toContain("Up to 50,000 streams of your song.");
    expect(lines).toContain("Unlimited copies or downloads sold.");
    expect(lines).toContain("Up to 1 music video(s) with the song.");
    expect(lines).toContain("Unlimited live performances of the song.");
  });

  it("never softens a refusal: no radio/TV renders as NOT covered", () => {
    expect(allLines(base)).toContain("Radio and TV play is NOT covered by this license.");
    expect(allLines({ ...base, radioTvAllowed: true })).toContain("Radio and TV play is allowed.");
  });

  it("renders each delivery format in words", () => {
    expect(allLines({ ...base, format: "mp3" })[0]).toBe("The beat as an MP3 file.");
    expect(allLines({ ...base, format: "wav_mp3" })[0]).toBe("The beat as WAV + MP3 files.");
    expect(allLines({ ...base, format: "wav_mp3_stems" })[0]).toContain("track stems");
    expect(allLines({ ...base, format: "ownership_stems" })[0]).toContain("full ownership");
  });

  it("exclusive says only-you and drops the others-can-license line", () => {
    const lines = allLines({ ...base, isExclusive: true });
    expect(lines.some((l) => l.includes("the producer stops selling this beat"))).toBe(true);
    expect(lines.some((l) => l.includes("Other artists can license"))).toBe(false);
    const nonExclusive = allLines(base);
    expect(nonExclusive.some((l) => l.includes("Other artists can license this same beat too"))).toBe(true);
  });

  it("renders term + territory + producer note + credit line", () => {
    const lines = allLines({
      ...base,
      termYears: 3,
      territory: "United States",
      termsNote: "No resale of the raw beat files.",
      creditLine: "Prod. by Partner Two",
    });
    expect(lines).toContain("The license runs 3 years from purchase.");
    expect(lines).toContain("Valid in United States.");
    expect(lines).toContain("Also from the producer: No resale of the raw beat files.");
    expect(lines).toContain('Use this credit line wherever the song appears: "Prod. by Partner Two"');
    expect(allLines(base)).toContain("The license never expires.");
    expect(allLines(base)).toContain("Valid worldwide.");
  });

  it("flattens to a text block headed by the offer name", () => {
    const text = renderPlainTermsText(base);
    expect(text.startsWith("Basic license — in plain words:")).toBe(true);
    expect(text).toContain("What you can do:");
    expect(text).toContain("• Up to 50,000 streams of your song.");
  });
});
