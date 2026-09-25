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
] as const;

export type DistributionPlatformKey = (typeof DISTRIBUTION_PLATFORMS)[number]["key"];

/** Pricing shown in the UI — mirrors the backend env-overridable defaults. */
export const DISTRIBUTION_AI_CREDIT_COST = 1;
export const DISTRIBUTION_PACKAGING_CREDITS = 10;

export function platformLabel(key: string): string {
  return DISTRIBUTION_PLATFORMS.find((p) => p.key === key)?.label ?? key;
}

/** v1 statuses. There is deliberately no "delivered" — v1 prepares the
    release package; real platform delivery is a future integration. */
export const DISTRIBUTION_STATUSES = ["draft", "packaged"] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

export function isPackaged(status: string): boolean {
  return status === "packaged";
}
