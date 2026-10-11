/**
 * avatar-client.ts — AI avatar / talking-head provider abstraction.
 *
 * Shaped for HeyGen OR Hedra (provider chosen at deploy time via env).
 * No provider key is configured yet — every live call path is gated behind
 * avatarProviderConfigured() and throws AvatarNotConfiguredError.
 *
 * Env:
 *   HEYGEN_API_KEY — HeyGen API key (https://docs.heygen.com)
 *   HEDRA_API_KEY  — Hedra API key (https://docs.hedra.com)
 *   AVATAR_PROVIDER — "heygen" | "hedra" (default: "heygen" when its key exists)
 *
 * DO NOT make live provider calls until a key is provisioned and the user
 * has approved the provider + pricing.
 */

export type AvatarProvider = "heygen" | "hedra";

export function avatarProviderName(): AvatarProvider | null {
  const forced = (process.env["AVATAR_PROVIDER"] || "").toLowerCase();
  if (forced === "heygen" && process.env["HEYGEN_API_KEY"]) return "heygen";
  if (forced === "hedra" && process.env["HEDRA_API_KEY"]) return "hedra";
  if (process.env["HEYGEN_API_KEY"]) return "heygen";
  if (process.env["HEDRA_API_KEY"]) return "hedra";
  return null;
}

/** True only when a provider key is configured. The UI gates on this. */
export function avatarProviderConfigured(): boolean {
  return avatarProviderName() !== null;
}

export class AvatarNotConfiguredError extends Error {
  readonly code = "AVATAR_PROVIDER_NOT_CONFIGURED";
  constructor() {
    super(
      "AI avatar generation is not connected yet — no HeyGen or Hedra API key is configured on the server. " +
        "Add HEYGEN_API_KEY or HEDRA_API_KEY to enable talking-head presenters.",
    );
    this.name = "AvatarNotConfiguredError";
  }
}

function requireProvider(): AvatarProvider {
  const provider = avatarProviderName();
  if (!provider) throw new AvatarNotConfiguredError();
  return provider;
}

export interface AvatarCatalogEntry {
  id: string;
  name: string;
  /** Short descriptor shown in the picker. */
  style: string;
  /** Provider-side avatar id, filled in once the provider is wired. */
  providerAvatarId: string | null;
}

/**
 * Placeholder avatar catalog. These are UI samples so the presenter picker
 * has real shape before a provider is connected — providerAvatarId is null
 * until the catalog is synced from HeyGen/Hedra.
 */
export const AVATAR_PLACEHOLDER_CATALOG: AvatarCatalogEntry[] = [
  { id: "avatar-host-male", name: "Host — Male", style: "Confident studio host", providerAvatarId: null },
  { id: "avatar-host-female", name: "Host — Female", style: "Warm studio host", providerAvatarId: null },
  { id: "avatar-creator-casual", name: "Creator — Casual", style: "Relaxed creator energy", providerAvatarId: null },
  { id: "avatar-creator-bold", name: "Creator — Bold", style: "High-energy hype presenter", providerAvatarId: null },
];

export interface AvatarVideoRequest {
  /** Catalog avatar id (see AVATAR_PLACEHOLDER_CATALOG). */
  avatarId: string;
  /** Spoken script for the talking head (plain text). */
  script: string;
  /** Optional voice id override (provider voice). */
  voiceId?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  userId: string;
}

export interface AvatarVideoResult {
  providerJobId: string;
  status: "queued" | "processing" | "done" | "failed";
  videoUrl?: string;
}

/**
 * Submits a talking-head generation to the configured provider.
 * NOT IMPLEMENTED — throws AvatarNotConfiguredError until a key exists,
 * and throws "not implemented" once configured until the provider SDK call
 * is written (requires user approval of provider + pricing first).
 */
export async function submitAvatarVideo(_req: AvatarVideoRequest): Promise<AvatarVideoResult> {
  const provider = requireProvider();
  // Provider call deliberately not implemented: no key, no approved pricing.
  throw new Error(
    `Avatar provider "${provider}" is configured but the live submit call is not implemented yet — ` +
      "needs provider + pricing approval before any paid generation runs.",
  );
}
