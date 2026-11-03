/**
 * social-proof-desk — the Social Proof desk's pure logic seam
 * (stack1500 world parity wave #3, census item 32).
 *
 * THE FEATURE (website): Social Proof settings
 * (components/SocialProofSettings.tsx) — the verified audience
 * figures from a creator's connected Instagram / Facebook /
 * TikTok accounts that show on their public profile: followers,
 * posts, likes, videos. The owner sees every figure, refreshes
 * the numbers live, and holds the off switch: hide a figure and
 * it vanishes from the profile for everyone, instantly.
 *
 * THE RAILS (routes/social-proof.ts, all requireAuth, all FREE):
 *   GET  /api/social-proof/me → the owner state (below); when the
 *        cached figures are stale it refreshes inline first. A
 *        503 { error: "social_proof_not_ready" } means the server
 *        isn't switched on — an honest not-ready state, not a
 *        failure.
 *   POST /api/social-proof/refresh → force a live re-fetch;
 *        404 when the member has no creator profile yet.
 *   PUT  /api/social-proof/visibility { hiddenKeys } → the full
 *        state again; unknown keys are a 400 (the desk only ever
 *        sends keys the state itself carried).
 *
 * PRICE: free — the refresh path carries a registry row at cost
 * 0 ("Social Proof (free)"), pinned in this seam's tests. No
 * confirmation is needed because nothing is charged; the runs
 * ride plain authed fetches exactly like the settings card.
 *
 * DRIFT DISCIPLINE: the state guard accepts a body only with a
 * real hasProfile boolean; figure rows missing their key, label,
 * or a finite value are dropped, never dressed up. A body that
 * isn't the state at all reads as failure — separate from the
 * honest empty states (no profile, no figures yet), which the
 * desk renders as themselves.
 */
import { getCreditCost } from "../credit-costs";

export const SOCIAL_PROOF_ME_PATH = "/api/social-proof/me";
export const SOCIAL_PROOF_REFRESH_PATH = "/api/social-proof/refresh";
export const SOCIAL_PROOF_VISIBILITY_PATH = "/api/social-proof/visibility";

/** Free — the registry row for the refresh rail, pinned at 0. */
export const SOCIAL_PROOF_REFRESH_COST = getCreditCost(SOCIAL_PROOF_REFRESH_PATH)?.cost ?? -1;

export interface SocialProofFigure {
  key: string;
  platform: string;
  accountId: string;
  accountLabel: string;
  label: string;
  value: number;
  /** ISO time the rail fetched this number (updatedAt on the
      wire; some payloads call it fetchedAt — both read). */
  updatedAt: string;
  visible: boolean;
  connected: boolean;
}

export interface SocialProofState {
  hasProfile: boolean;
  figures: SocialProofFigure[];
  hiddenKeys: string[];
  refreshedAt: string | null;
  stale: boolean;
  connectedPlatforms: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function figureOf(raw: unknown): SocialProofFigure | null {
  if (!isRecord(raw)) return null;
  const key = str(raw["key"]);
  const label = str(raw["label"]);
  const value = raw["value"];
  if (!key || !label || typeof value !== "number" || !Number.isFinite(value)) return null;
  return {
    key,
    platform: str(raw["platform"]),
    accountId: str(raw["accountId"]),
    accountLabel: str(raw["accountLabel"]),
    label,
    value,
    updatedAt: str(raw["updatedAt"]) || str(raw["fetchedAt"]),
    visible: raw["visible"] !== false,
    connected: raw["connected"] !== false,
  };
}

export function socialProofStateOf(data: unknown): SocialProofState | null {
  if (!isRecord(data) || typeof data["hasProfile"] !== "boolean") return null;
  const figures: SocialProofFigure[] = [];
  if (Array.isArray(data["figures"])) {
    for (const row of data["figures"]) {
      const figure = figureOf(row);
      if (figure) figures.push(figure);
    }
  }
  return {
    hasProfile: data["hasProfile"],
    figures,
    hiddenKeys: stringList(data["hiddenKeys"]),
    refreshedAt: typeof data["refreshedAt"] === "string" ? data["refreshedAt"] : null,
    stale: data["stale"] === true,
    connectedPlatforms: stringList(data["connectedPlatforms"]),
  };
}

/** The settings card's exact toggle computation: showing removes
 *  the key, hiding adds it — deduped, everything else untouched. */
export function hiddenKeysAfterToggle(
  hiddenKeys: readonly string[],
  key: string,
  show: boolean,
): string[] {
  if (show) return hiddenKeys.filter((k) => k !== key);
  return [...new Set([...hiddenKeys, key])];
}

export function buildVisibilityPayload(hiddenKeys: readonly string[]) {
  return { hiddenKeys: [...hiddenKeys] };
}

/** The platform's display name — the three the catalog knows. */
export const SOCIAL_PROOF_PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

export function platformLabel(platform: string): string {
  return SOCIAL_PROOF_PLATFORM_LABELS[platform] ?? platform;
}
