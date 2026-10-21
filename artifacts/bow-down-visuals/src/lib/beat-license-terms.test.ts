import { describe, expect, it } from "vitest";
import {
  defaultTermsForTier,
  describeTerms,
  describeTermsInline,
  formatLabel,
  templateTerms,
  type BeatLicenseTemplate,
} from "./beat-license-terms";

describe("beat license terms display", () => {
  it("fixed tier defaults mirror the API's standing terms", () => {
    expect(defaultTermsForTier("basic")).toMatchObject({ format: "mp3", streamsCap: 50_000, musicVideosCap: 1 });
    expect(defaultTermsForTier("premium")).toMatchObject({ format: "wav_mp3", streamsCap: 500_000, musicVideosCap: 2 });
    expect(defaultTermsForTier("exclusive")).toMatchObject({ format: "ownership_stems", streamsCap: null, isExclusive: true });
  });

  it("describes a capped custom license completely", () => {
    const lines = describeTerms({
      name: "Sync Special",
      format: "wav_mp3",
      streamsCap: 250_000,
      salesCap: 5_000,
      musicVideosCap: 3,
      radioTvAllowed: true,
      livePerformancesCap: 10,
      termYears: 3,
      territory: "Worldwide",
      creditLine: "Prod. by Midnight",
      termsNote: "One verse swap allowed.",
      isExclusive: false,
    });
    expect(lines[0]).toBe("WAV + MP3");
    expect(lines).toContain("250,000 streams");
    expect(lines).toContain("5,000 copies sold");
    expect(lines).toContain("3 music videos");
    expect(lines).toContain("Radio & TV allowed");
    expect(lines).toContain("10 live performances");
    expect(lines).toContain("3-year term");
    expect(lines).toContain("Worldwide");
    expect(lines).toContain("Credit: Prod. by Midnight");
    expect(lines).toContain("One verse swap allowed.");
  });

  it("null caps read as unlimited and a null term as perpetual", () => {
    const inline = describeTermsInline(defaultTermsForTier("exclusive"));
    expect(inline).toContain("Unlimited streams");
    expect(inline).toContain("Unlimited music videos");
    expect(inline).toContain("Perpetual term");
    expect(inline).toContain("No radio & TV");
  });

  it("maps a template DTO to its terms without dropping fields", () => {
    const template: BeatLicenseTemplate = {
      id: "t1",
      producerId: "p1",
      name: "Lease Plus",
      priceCents: 7500,
      isExclusive: false,
      format: "wav_mp3_stems",
      streamsCap: null,
      salesCap: 100,
      musicVideosCap: null,
      radioTvAllowed: false,
      livePerformancesCap: null,
      termYears: 5,
      territory: "US",
      creditLine: null,
      termsNote: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const terms = templateTerms(template);
    expect(terms.name).toBe("Lease Plus");
    expect(terms.format).toBe("wav_mp3_stems");
    expect(terms.salesCap).toBe(100);
    expect(terms.termYears).toBe(5);
    expect(terms.territory).toBe("US");
    expect(formatLabel("wav_mp3_stems")).toBe("WAV + MP3 + stems");
  });
});
