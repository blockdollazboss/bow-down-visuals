/* ─── Beat leases in plain words (Stack-200 upgrade N11) ──────────────────
   The licensing rail is complete (routes/generate/beats.ts): tiers,
   producer templates, terms snapshotted at purchase, Stripe checkout +
   verify. What it never had is the CHECKOUT IN PLAIN WORDS: a buyer
   saw prices and tier names, not the deal itself. This module renders
   a BeatLicenseTerms — the exact structured terms that get snapshotted
   onto the license row — as the lines a person actually reads before
   they tap "Agree & pay":

     what you get · what you can do · the limits · the credit line

   The one-tap lease panel on the beats page renders THESE lines as
   the checkout: the words on the screen are the words in the snapshot
   (the offers endpoint serves both from the same terms object), and
   the tap records terms_accepted_at on the license row — a durable
   record that the buyer agreed to exactly these words. No legalese is
   invented and no term is softened: caps render as caps, "not
   allowed" renders as not allowed. */

import type { BeatLicenseTerms } from "@workspace/db";

export interface PlainTermsSection {
  heading: string;
  lines: string[];
}

const FORMAT_LINES: Record<BeatLicenseTerms["format"], string> = {
  mp3: "The beat as an MP3 file.",
  wav_mp3: "The beat as WAV + MP3 files.",
  wav_mp3_stems: "The beat as WAV + MP3 files, plus the separate track stems.",
  ownership_stems: "The beat itself — full ownership, plus the separate track stems.",
};

function capLine(cap: number | null, capped: string, unlimited: string): string {
  return cap === null ? unlimited : capped.replace("{n}", cap.toLocaleString("en-US"));
}

/** Render one offer's terms as plain-words sections. Pure: the same
 *  terms object the purchase snapshots is the only input. */
export function plainWordsForTerms(terms: BeatLicenseTerms): PlainTermsSection[] {
  const get: string[] = [FORMAT_LINES[terms.format] ?? FORMAT_LINES.mp3];
  if (terms.isExclusive) {
    get.push("Only you get this — once you buy it, the producer stops selling this beat.");
  }

  const canDo: string[] = [
    capLine(terms.streamsCap, "Up to {n} streams of your song.", "Unlimited streams of your song."),
    capLine(terms.salesCap, "Up to {n} copies or downloads sold.", "Unlimited copies or downloads sold."),
    capLine(terms.musicVideosCap, "Up to {n} music video(s) with the song.", "Unlimited music videos with the song."),
    capLine(terms.livePerformancesCap, "Up to {n} live performances of the song.", "Unlimited live performances of the song."),
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

/** The same sections flattened to one text block — for receipts,
 *  emails, and anywhere the words need to travel as text. */
export function renderPlainTermsText(terms: BeatLicenseTerms): string {
  const sections = plainWordsForTerms(terms);
  return [
    `${terms.name} license — in plain words:`,
    ...sections.flatMap((s) => ["", `${s.heading}:`, ...s.lines.map((l) => `• ${l}`)]),
  ].join("\n");
}

export const BEAT_PLAIN_TERMS_COPY = {
  agreeAndPay: "Agree & pay",
  agreeHint:
    "Tapping “Agree & pay” is your signature on these words — they're saved with your license exactly as shown here.",
  oneTapNote: "One tap: you agree to the words above and go straight to payment. No contract wall, no fine print.",
} as const;
