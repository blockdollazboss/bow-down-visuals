import type { SocialProofFigureDto } from "./artist-profiles";

/* Pure display contract for the C5 social-proof strip — split from the
   component per the repo's test pattern (vitest here runs jsx:preserve,
   so suites import this module and pin the component by source).
   The law: counts render EXACT and in full (Intl thousands separators,
   never a k-abbreviation, never rounded up), and every figure carries
   the date the platform actually returned it. */

export function formatProofValue(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/** "Oct 21, 2026" for a valid ISO stamp; "" for anything unparseable —
    a figure without a trustworthy date renders without a date line
    rather than with an invented one. */
export function proofUpdatedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** The strip shows exactly the figures the server shipped (it does its
    own hiding/retiring); this only guards absent payloads. */
export function liveProofFigures(figures: SocialProofFigureDto[] | undefined): SocialProofFigureDto[] {
  return Array.isArray(figures) ? figures : [];
}
