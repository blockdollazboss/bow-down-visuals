import type { SceneData } from "@/lib/scene-parser";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

/** Payload shape the `/api/improve-prompt` endpoint expects for Artist Vault context. */
export interface ArtistVaultPayload {
  artistType?: string | null;
  artistDescription?: string | null;
  visualStyle?: string | null;
  hair?: string | null;
  tattoos?: string | null;
  jewelry?: string | null;
  clothingStyle?: string | null;
  brandColors?: string | null;
  doNotChangeRules?: string | null;
  consistencyPrompt?: string | null;
  referenceImageUrl?: string | null;
}

/**
 * Best-effort improve-prompt context (video style, platform, artist look) derived from a
 * project's stored `input_data`. Older projects — created before this field existed, or
 * created via the plain "Make a Music Video" flow instead of "Song + Video" — may be missing
 * some or all of these fields, or have them in an unexpected shape. Every field is optional and
 * this function never throws; it simply omits whatever isn't present or isn't a string.
 */
export interface DerivedProjectContext {
  videoStyle?: string;
  platform?: string;
  artistVault: ArtistVaultPayload | null;
}

/** Derive Improve-button context from a project's `input_data`, tolerating missing/legacy shapes. */
export function deriveProjectContext(
  inputData: Record<string, unknown> | null | undefined,
): DerivedProjectContext {
  const str = (key: string): string | undefined => {
    const value = inputData?.[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };

  const videoStyle = str("videoStyle");
  const platform = str("platform");

  const artistDescription = str("artistDescription") ?? null;
  const visualStyle = str("visualStyleRules") ?? null;
  const brandColors = str("brandColors") ?? null;
  const doNotChangeRules = str("doNotChangeRules") ?? null;
  const artistVault: ArtistVaultPayload | null =
    !artistDescription && !visualStyle && !brandColors && !doNotChangeRules
      ? null
      : { artistDescription, visualStyle, brandColors, doNotChangeRules };

  return { videoStyle, platform, artistVault };
}

/** Convert a full Artist Vault record into the payload shape the improve-prompt API expects. */
export function vaultToPayload(vault: ArtistVault): ArtistVaultPayload {
  return {
    artistType:        vault.artist_type,
    artistDescription: vault.personality,
    visualStyle:       vault.visual_style,
    hair:              vault.hair,
    tattoos:           vault.tattoos,
    jewelry:           vault.jewelry,
    clothingStyle:     vault.clothing_style,
    brandColors:       vault.brand_colors,
    doNotChangeRules:  vault.do_not_change_rules,
    consistencyPrompt: vault.consistency_prompt,
    referenceImageUrl: vault.reference_image_url,
  };
}

/**
 * Distinguishable improve-prompt failure categories, mirrored from the API server's
 * `classifyImprovePromptError`. `unknown` covers network failures / unparseable responses
 * that never reached that classifier (e.g. the request never made it to the server).
 */
export type ImprovePromptErrorType =
  | "rate_limit"
  | "content_policy"
  | "invalid_prompt"
  | "server_error"
  | "unknown";

/** Thrown by `requestImprovedPrompt` with enough detail to explain *why* it failed. */
export class ImprovePromptError extends Error {
  readonly errorType: ImprovePromptErrorType;
  readonly status: number | null;

  constructor(message: string, errorType: ImprovePromptErrorType, status: number | null) {
    super(message);
    this.name = "ImprovePromptError";
    this.errorType = errorType;
    this.status = status;
  }
}

/** Ask the API to rewrite a scene's prompt into a cinematic, Runway-ready paragraph. */
export async function requestImprovedPrompt(params: {
  token: string | null;
  prompt: string;
  scene: SceneData;
  artistVault?: ArtistVaultPayload | null;
  videoStyle?: string;
  platform?: string;
}): Promise<string> {
  const { token, prompt, scene, artistVault, videoStyle, platform } = params;
  let res: Response;
  try {
    res = await fetch("/api/improve-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
      body: JSON.stringify({
        prompt,
        sceneContext: {
          section: scene.section,
          lyricLine: scene.lyricLine,
          action: scene.action,
          location: scene.location,
          cameraMovement: scene.cameraMovement,
          lighting: scene.lighting,
          mood: scene.mood,
        },
        videoStyle,
        platform,
        artistVault: artistVault ?? null,
      }),
    });
  } catch {
    throw new ImprovePromptError("Could not reach the server — check your connection and try again.", "unknown", null);
  }

  if (!res.ok) {
    let body: { error?: string; errorType?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body — fall through with defaults below */
    }
    const errorType: ImprovePromptErrorType =
      body.errorType === "rate_limit" ||
      body.errorType === "content_policy" ||
      body.errorType === "invalid_prompt" ||
      body.errorType === "server_error"
        ? body.errorType
        : "unknown";
    throw new ImprovePromptError(
      body.error || `Improve prompt API error (${res.status})`,
      errorType,
      res.status,
    );
  }

  const { improvedPrompt } = (await res.json()) as { improvedPrompt: string };
  return improvedPrompt;
}

/** Seed text used to improve a scene: its prompt, or a fallback built from details. */
export function sceneSeedPrompt(scene: SceneData): string {
  return (
    (scene.aiVideoPrompt ?? "").trim() ||
    [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean)
      .join(", ")
  );
}

/**
 * Prompts shorter than this are treated as "weak" — either missing entirely or a short/
 * generic seed value (e.g. raw section notes) rather than a Runway-ready cinematic paragraph.
 */
export const WEAK_PROMPT_MIN_LENGTH = 50;

/** True when a scene's AI Video Prompt is empty or too short/generic to be worth generating from as-is. */
export function isWeakPrompt(scene: Pick<SceneData, "aiVideoPrompt">): boolean {
  return (scene.aiVideoPrompt ?? "").trim().length < WEAK_PROMPT_MIN_LENGTH;
}
