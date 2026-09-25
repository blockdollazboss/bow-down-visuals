/* Collab Finder pure helpers — extracted for unit tests. */

export const NicheLabel = (n: string): string =>
  n.length > 0 ? n.charAt(0).toUpperCase() + n.slice(1) : n;

export const PlatformLabel = (p: string): string =>
  p === "x" ? "X" : NicheLabel(p);

export function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-300";
  return "text-red-400";
}

export interface ProposalTemplate {
  name: string;
  body: string;
}

/** Fill a proposal template's placeholders for a given target + sender. */
export function fillProposalTemplate(
  body: string,
  target: { displayName: string; nicheLabel: string },
  sender: { displayName: string; nicheLabel: string },
): string {
  return body
    .replace("{name}", target.displayName)
    .replace("{niche}", target.nicheLabel.toLowerCase())
    .replace("{me}", sender.displayName || "a fellow creator")
    .replace("{myNiche}", sender.nicheLabel.toLowerCase());
}

/** Clamp a follower-count input string to the API's 0–1B range. */
export function clampFollowers(raw: string): number {
  const n = parseInt(raw || "0", 10) || 0;
  return Math.max(0, Math.min(1000000000, n));
}
