/* Beat license terms (migration 0188) — the client mirror of the API's
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

/** The sold terms on a license/sale row, whichever shape the row
    arrived in. License DTOs (purchase verify, GET /beats/licenses/mine)
    call the purchase-time snapshot `terms`; the producer dashboard
    (GET /beats/mine/dashboard) returns raw license rows, where the same
    snapshot rides `terms_snapshot`. Reading only `terms` silently
    drops the sold terms on dashboard rows — normalize here so every
    surface renders the terms exactly as sold. */
export function saleTermsFromRow(row: {
  terms?: BeatLicenseTerms | null;
  terms_snapshot?: BeatLicenseTerms | null;
}): BeatLicenseTerms | null {
  return row.terms ?? row.terms_snapshot ?? null;
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

/* ─── One-tap leases (N11): the plain-words checkout ─────────────────────
   The same rendering the API serves on GET /beats/:id/offers and
   stamps acceptance against (api-server lib/beat-plain-terms.ts) —
   kept word-for-word so the words on this screen are the words in
   the license snapshot. The modal's one tap ("Agree & pay") sends
   plainTermsAgreed and the server records terms_accepted_at. */

export interface PlainTermsSection {
  heading: string;
  lines: string[];
}

const PLAIN_FORMAT_LINES: Record<BeatLicenseFormat, string> = {
  mp3: "The beat as an MP3 file.",
  wav_mp3: "The beat as WAV + MP3 files.",
  wav_mp3_stems: "The beat as WAV + MP3 files, plus the separate track stems.",
  ownership_stems: "The beat itself — full ownership, plus the separate track stems.",
};

function plainCapLine(cap: number | null, capped: string, unlimited: string): string {
  return cap === null ? unlimited : capped.replace("{n}", cap.toLocaleString("en-US"));
}

export function plainWordsForTerms(terms: BeatLicenseTerms): PlainTermsSection[] {
  const get: string[] = [PLAIN_FORMAT_LINES[terms.format] ?? PLAIN_FORMAT_LINES.mp3];
  if (terms.isExclusive) {
    get.push("Only you get this — once you buy it, the producer stops selling this beat.");
  }
  const canDo: string[] = [
    plainCapLine(terms.streamsCap, "Up to {n} streams of your song.", "Unlimited streams of your song."),
    plainCapLine(terms.salesCap, "Up to {n} copies or downloads sold.", "Unlimited copies or downloads sold."),
    plainCapLine(terms.musicVideosCap, "Up to {n} music video(s) with the song.", "Unlimited music videos with the song."),
    plainCapLine(terms.livePerformancesCap, "Up to {n} live performances of the song.", "Unlimited live performances of the song."),
    terms.radioTvAllowed
      ? "Radio and TV play is allowed."
      : "Radio and TV play is NOT covered by this license.",
  ];
  const limits: string[] = [
    terms.termYears === null
      ? "The license never expires."
      : `The license runs ${terms.termYears} year${terms.termYears === 1 ? "" : "s"} from purchase.`,
    `Valid ${terms.territory === "Worldwide" ? "worldwide" : `in ${terms.territory}`}.`,
  ];
  if (!terms.isExclusive) {
    limits.push("Other artists can license this same beat too — it isn't only yours.");
  }
  if (terms.termsNote) {
    limits.push(`Also from the producer: ${terms.termsNote}`);
  }
  const credit: string[] = [
    terms.creditLine
      ? `Use this credit line wherever the song appears: "${terms.creditLine}"`
      : "Credit the producer in your song's credits wherever it appears.",
  ];
  return [
    { heading: "What you get", lines: get },
    { heading: "What you can do", lines: canDo },
    { heading: "The limits", lines: limits },
    { heading: "Credit", lines: credit },
  ];
}

export const BEAT_PLAIN_TERMS_COPY = {
  agreeAndPay: "Agree & pay",
  agreeHint:
    "Tapping “Agree & pay” is your signature on these words — they're saved with your license exactly as shown here.",
  oneTapNote: "One tap: you agree to the words above and go straight to payment. No contract wall, no fine print.",
} as const;
