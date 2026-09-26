/* Shared constants for the Music Distribution hub (/distribute).
   Platform keys must stay in sync with the backend route's
   DISTRIBUTION_PLATFORMS enum in
   artifacts/api-server/src/routes/generate/distribution.ts. */

export const DISTRIBUTION_PLATFORMS = [
  { key: "spotify", label: "Spotify" },
  { key: "apple_music", label: "Apple Music" },
  { key: "youtube_music", label: "YouTube Music" },
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "amazon_music", label: "Amazon Music" },
  { key: "deezer", label: "Deezer" },
  { key: "tidal", label: "Tidal" },
  { key: "correctional", label: "Jails & Prisons" },
] as const;

export type DistributionPlatformKey = (typeof DISTRIBUTION_PLATFORMS)[number]["key"];

/** Pricing shown in the UI — mirrors the backend env-overridable defaults. */
export const DISTRIBUTION_AI_CREDIT_COST = 1;
export const DISTRIBUTION_PACKAGING_CREDITS = 10;

export function platformLabel(key: string): string {
  return DISTRIBUTION_PLATFORMS.find((p) => p.key === key)?.label ?? key;
}

/** Release lifecycle statuses. draft → submit (pay tier price) → packaged,
    after which the aggregator delivery job moves each platform's status
    through queued → pending → delivered → live. */
export const DISTRIBUTION_STATUSES = ["draft", "packaged"] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

export function isPackaged(status: string): boolean {
  return status === "packaged";
}

/* ── Release tiers (credits charged at submit) ──────────────────────────
   Mirrors the backend pricing defaults; the UI also fetches
   GET /api/distribution/pricing and prefers that when it loads. */
export const DISTRIBUTION_TIERS = [
  { type: "single", credits: 10, label: "Single", blurb: "1 track — one release event" },
  { type: "ep", credits: 20, label: "EP", blurb: "2–5 tracks — a short project" },
  { type: "album", credits: 30, label: "Album", blurb: "6+ tracks — a full project" },
] as const;

export type DistributionTier = (typeof DISTRIBUTION_TIERS)[number]["type"];

export function tierCredits(type: string): number {
  return DISTRIBUTION_TIERS.find((t) => t.type === type)?.credits ?? 10;
}

export function tierLabel(type: string): string {
  return DISTRIBUTION_TIERS.find((t) => t.type === type)?.label ?? type;
}

/* ── Per-platform delivery statuses ─────────────────────────────────────
   Progression: queued → pending → delivered → live. "failed" is terminal.
   The UI only ever shows a status the API returned — never invents one. */
export const PLATFORM_STATUSES = ["queued", "pending", "delivered", "live", "failed"] as const;
export type PlatformStatusValue = (typeof PLATFORM_STATUSES)[number];

export interface PlatformStatusEntry {
  platform: string;
  status: PlatformStatusValue;
  detail?: string;
  updatedAt?: string;
}

/** Non-terminal statuses — the tracker keeps polling while any of these
    are present. "delivered", "live", and "failed" stop the poll loop. */
const TERMINAL_PLATFORM_STATUSES: ReadonlySet<string> = new Set(["delivered", "live", "failed"]);

export function isTerminalPlatformStatus(status: string): boolean {
  return TERMINAL_PLATFORM_STATUSES.has(status);
}

export function platformStatusLabel(status: string): string {
  switch (status) {
    case "queued": return "Queued";
    case "pending": return "Pending";
    case "delivered": return "Delivered";
    case "live": return "Live";
    case "failed": return "Failed";
    default: return status;
  }
}

/* ── Royalty splits ───────────────────────────────────────────────────── */
export interface RoyaltySplit {
  name: string;
  role?: string;
  share: number;
}

/** Shares must total exactly 100 (within floating-point tolerance). */
export function splitsTotal(splits: RoyaltySplit[]): number {
  return splits.reduce((sum, s) => sum + (Number(s.share) || 0), 0);
}

export function splitsValid(splits: RoyaltySplit[]): boolean {
  if (splits.length === 0) return true;
  if (splits.some((s) => !s.name.trim() || Number(s.share) <= 0)) return false;
  return Math.abs(splitsTotal(splits) - 100) < 0.01;
}
