import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultTermsForTier,
  describeTerms,
  describeTermsInline,
  formatLabel,
  saleTermsFromRow,
  plainWordsForTerms,
  templateTerms,
  type BeatLicenseTemplate,
  type BeatLicenseTerms,
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

describe("saleTermsFromRow — the dashboard's raw-row snapshot", () => {
  const sold: BeatLicenseTerms = {
    ...defaultTermsForTier("basic"),
    name: "Lease Plus",
    streamsCap: 250_000,
  };

  it("reads terms_snapshot from a raw dashboard sale row", () => {
    /* GET /beats/mine/dashboard returns raw beat_licenses rows: the
       snapshot is terms_snapshot, and a row read only for `terms`
       renders no sold terms at all (the bug this normalizer fixes). */
    expect(saleTermsFromRow({ terms_snapshot: sold })).toEqual(sold);
    expect(saleTermsFromRow({ terms_snapshot: sold })?.name).toBe("Lease Plus");
  });

  it("reads terms from a license DTO row", () => {
    expect(saleTermsFromRow({ terms: sold })).toEqual(sold);
  });

  it("the DTO name wins when both are present, and empty rows give null", () => {
    const dtoTerms: BeatLicenseTerms = { ...sold, name: "DTO Terms" };
    expect(saleTermsFromRow({ terms: dtoTerms, terms_snapshot: sold })?.name).toBe("DTO Terms");
    expect(saleTermsFromRow({})).toBeNull();
    expect(saleTermsFromRow({ terms: null, terms_snapshot: null })).toBeNull();
    /* A pre-0188 sale has no snapshot at all — null, never invented terms. */
    expect(saleTermsFromRow({ terms_snapshot: null })).toBeNull();
  });

  it("the beats page normalizes dashboard sales through it", () => {
    const page = readFileSync(new URL("../pages/beats.tsx", import.meta.url), "utf8");
    expect(page).toContain("saleTermsFromRow(s)");
    expect(page).toContain("describeTermsInline(s.terms)");
describe("plain-words checkout (N11)", () => {
  it("renders the four sections in reading order for a fixed tier", () => {
    const sections = plainWordsForTerms(defaultTermsForTier("basic"));
    expect(sections.map((s) => s.heading)).toEqual(["What you get", "What you can do", "The limits", "Credit"]);
    const lines = sections.flatMap((s) => s.lines);
    expect(lines).toContain("Up to 50,000 streams of your song.");
    expect(lines).toContain("Radio and TV play is NOT covered by this license.");
    expect(lines).toContain("Other artists can license this same beat too — it isn't only yours.");
  });

  it("exclusive words say only-you and never soften the ownership line", () => {
    const lines = plainWordsForTerms(defaultTermsForTier("exclusive")).flatMap((s) => s.lines);
    expect(lines[0]).toContain("full ownership");
    expect(lines.some((l) => l.includes("the producer stops selling this beat"))).toBe(true);
    expect(lines.some((l) => l.includes("Other artists can license"))).toBe(false);
  });
});
