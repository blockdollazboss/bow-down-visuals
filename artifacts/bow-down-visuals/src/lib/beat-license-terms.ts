/* Beat license terms (migration 0187) — the client mirror of the API's
   terms model (api-server beats-pricing.ts / lib/db schema beats.ts).
   A null cap means the license does not cap that use (unlimited); a
   null termYears means no fixed term. Buyer surfaces render the terms
   from the license's purchase-time snapshot, never from a live
   template that may have been edited since. */

export const BEAT_LICENSE_FORMATS = ["mp3", "wav_mp3", "wav_mp3_stems", "ownership_stems"] as const;
export type BeatLicenseFormat = (typeof BEAT_LICENSE_FORMATS)[number];

export interface BeatLicenseTerms {
  name: string;
  format: BeatLicenseFormat;
  streamsCap: number | null;
  salesCap: number | null;
  musicVideosCap: number | null;
  radioTvAllowed: boolean;
  livePerformancesCap: number | null;
  termYears: number | null;
  territory: string;
  creditLine: string | null;
  termsNote: string | null;
  isExclusive: boolean;
}

/** A producer's custom template as the API returns it (toTemplateJson). */
export interface BeatLicenseTemplate {
  id: string;
  producerId: string;
  name: string;
  priceCents: number;
  isExclusive: boolean;
  format: BeatLicenseFormat;
  streamsCap: number | null;
  salesCap: number | null;
  musicVideosCap: number | null;
  radioTvAllowed: boolean;
  livePerformancesCap: number | null;
  termYears: number | null;
  territory: string;
  creditLine: string | null;
  termsNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export function templateTerms(t: BeatLicenseTemplate): BeatLicenseTerms {
  return {
    name: t.name,
    format: t.format,
    streamsCap: t.streamsCap,
    salesCap: t.salesCap,
    musicVideosCap: t.musicVideosCap,
    radioTvAllowed: t.radioTvAllowed,
    livePerformancesCap: t.livePerformancesCap,
    termYears: t.termYears,
    territory: t.territory,
    creditLine: t.creditLine,
    termsNote: t.termsNote,
    isExclusive: t.isExclusive,
  };
}

/** The standing terms of the three fixed tiers — the same values the
    API snapshots for fixed-tier purchases (from the tier blurbs:
    Basic "MP3 lease · 1 music video · 50k streams", Premium "WAV + MP3 ·
    2 music videos · 500k streams", Exclusive "Full ownership · stems ·
    unlimited"). Display-only mirror; the server snapshot is binding. */
export function defaultTermsForTier(tier: string): BeatLicenseTerms {
  const base: BeatLicenseTerms = {
    name: tier,
    format: "mp3",
    streamsCap: null,
    salesCap: null,
    musicVideosCap: null,
    radioTvAllowed: false,
    livePerformancesCap: null,
    termYears: null,
    territory: "Worldwide",
    creditLine: null,
    termsNote: null,
    isExclusive: false,
  };
  if (tier === "basic") return { ...base, name: "Basic", streamsCap: 50_000, musicVideosCap: 1 };
  if (tier === "premium") return { ...base, name: "Premium", format: "wav_mp3", streamsCap: 500_000, musicVideosCap: 2 };
  return { ...base, name: "Exclusive", format: "ownership_stems", isExclusive: true };
}

const FORMAT_LABELS: Record<BeatLicenseFormat, string> = {
  mp3: "MP3",
  wav_mp3: "WAV + MP3",
  wav_mp3_stems: "WAV + MP3 + stems",
  ownership_stems: "Full ownership + stems",
};

export function formatLabel(format: string): string {
  return FORMAT_LABELS[format as BeatLicenseFormat] ?? format;
}

function capLine(cap: number | null, singular: string, plural: string): string {
  if (cap === null) return `Unlimited ${plural}`;
  return `${cap.toLocaleString()} ${cap === 1 ? singular : plural}`;
}

/** Human-readable term lines for a license, in marketplace order.
    Pure and total: every field of the snapshot is accounted for. */
export function describeTerms(terms: BeatLicenseTerms): string[] {
  const lines: string[] = [formatLabel(terms.format)];
  lines.push(capLine(terms.streamsCap, "stream", "streams"));
  if (terms.salesCap !== null) lines.push(capLine(terms.salesCap, "copy sold", "copies sold"));
  if (terms.musicVideosCap !== null) lines.push(capLine(terms.musicVideosCap, "music video", "music videos"));
  else lines.push("Unlimited music videos");
  lines.push(terms.radioTvAllowed ? "Radio & TV allowed" : "No radio & TV");
  if (terms.livePerformancesCap !== null) {
    lines.push(capLine(terms.livePerformancesCap, "live performance", "live performances"));
  }
  lines.push(terms.termYears !== null ? `${terms.termYears}-year term` : "Perpetual term");
  lines.push(terms.territory);
  if (terms.creditLine) lines.push(`Credit: ${terms.creditLine}`);
  if (terms.termsNote) lines.push(terms.termsNote);
  return lines;
}

export function describeTermsInline(terms: BeatLicenseTerms): string {
  return describeTerms(terms).join(" · ");
}
