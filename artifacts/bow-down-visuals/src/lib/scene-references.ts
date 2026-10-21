/**
 * Multi-reference scene generation — client mirror of the server's
 * per-model truth (artifacts/api-server/src/routes/generate/clip-references.ts).
 *
 * A scene carries a REFERENCE SET: labeled images (character / location /
 * product / style) proposed from the creator's own Artist Vault, picked
 * co-stars, the scene's location plate, and the brand-kit logo. The set is
 * VISIBLE in Scene Studio before generation — nothing is attached
 * silently — and the creator can remove entries; removals persist on the
 * scene. At generation the set rides the request and the SERVER plans the
 * actual submission per model; this module only predicts that plan so the
 * UI can say, in plain language, what the picked model will use:
 *
 *  - seedance2_5 ("Premium") takes the whole set as unpositioned reference
 *    images (Runway SDK: position first/last is keyframe mode and cannot
 *    be mixed with references).
 *  - gen4.5 ("Standard") takes ONE first-frame image (SDK PromptImage
 *    position is typed 'first' only).
 *  - veo3_1 ("Cinematic") takes ONE first-frame image (our Veo client
 *    submits a single image).
 *
 * Priority when a model takes fewer than the set holds: character →
 * location → product → style. The reduction is always stated, never
 * silent — here in the picker, and again in the server's submit response.
 */

export type ReferenceRole = "character" | "location" | "product" | "style";

export interface SceneReference {
  role: ReferenceRole;
  /** Public HTTPS image URL. */
  url: string;
  /** Human label shown in the picker ("Lead artist — Artist Vault photo"). */
  label: string;
  /** Provenance: artist_vault | pack_asset | pack_prop | location_library
   *  | brand_kit | upload | legacy. */
  source: string;
}

export type SceneClipModel = "gen4.5" | "seedance2_5" | "veo3_1";

/** Stated priority: character first, then location, product, style. */
export const REFERENCE_ROLE_PRIORITY: Record<ReferenceRole, number> = {
  character: 0,
  location: 1,
  product: 2,
  style: 3,
};

export const REFERENCE_ROLE_LABEL: Record<ReferenceRole, string> = {
  character: "Character",
  location: "Location",
  product: "Product",
  style: "Style",
};

/** Product cap for a scene's reference set (mirrors the server). */
export const MAX_SCENE_REFERENCES = 8;

export const CLIP_MODEL_TIER_LABEL: Record<SceneClipModel, string> = {
  "gen4.5": "Standard",
  seedance2_5: "Premium",
  veo3_1: "Cinematic",
};

export interface ModelReferenceSupport {
  /** Max set images this model path will actually receive. */
  maxSubmitted: number;
  mode: "reference_images" | "single_first_frame";
}

export const CLIP_REFERENCE_SUPPORT: Record<SceneClipModel, ModelReferenceSupport> = {
  seedance2_5: { maxSubmitted: MAX_SCENE_REFERENCES, mode: "reference_images" },
  "gen4.5": { maxSubmitted: 1, mode: "single_first_frame" },
  veo3_1: { maxSubmitted: 1, mode: "single_first_frame" },
};

function isRole(v: unknown): v is ReferenceRole {
  return v === "character" || v === "location" || v === "product" || v === "style";
}

function isHttps(url: string): boolean {
  return /^https:\/\//i.test(url);
}

/** Sort a set by the stated role priority (stable within a role). */
export function sortReferenceSet(refs: SceneReference[]): SceneReference[] {
  return [...refs].sort(
    (a, b) => REFERENCE_ROLE_PRIORITY[a.role] - REFERENCE_ROLE_PRIORITY[b.role],
  );
}

/**
 * Validate + normalize a set the same way the server does: HTTPS only,
 * deduped by URL, priority-sorted, capped. Used on anything read back
 * from a draft/pack before it is displayed or sent.
 */
export function normalizeReferenceSet(raw: unknown): SceneReference[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SceneReference[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isRole(r["role"])) continue;
    const url = typeof r["url"] === "string" ? r["url"].trim() : "";
    if (!isHttps(url) || url.length > 2048 || seen.has(url)) continue;
    seen.add(url);
    out.push({
      role: r["role"],
      url,
      label:
        typeof r["label"] === "string" && r["label"].trim()
          ? r["label"].trim().slice(0, 200)
          : `${REFERENCE_ROLE_LABEL[r["role"]]} reference`,
      source:
        typeof r["source"] === "string" && r["source"].trim()
          ? r["source"].trim().slice(0, 60)
          : "upload",
    });
  }
  return sortReferenceSet(out).slice(0, MAX_SCENE_REFERENCES);
}

export interface ReferenceSetProposalSources {
  /** The lead artist's Artist Vault photo (character). */
  characterPhotoUrl?: string | null;
  characterName?: string | null;
  /** Picked co-stars with photos (character each). */
  coStars?: Array<{ name: string; imageUrl: string }>;
  /** The scene's location plate from the Locations library. */
  locationImageUrl?: string | null;
  locationLabel?: string | null;
  /** The creator's brand-kit logo (style). */
  brandLogoUrl?: string | null;
}

/**
 * Assemble the PROPOSED set from the creator's own seed sources. Every
 * entry is labeled with its role and where it came from; missing sources
 * simply contribute nothing (the pack-lock flow flags gaps server-side).
 */
export function buildProposedReferenceSet(sources: ReferenceSetProposalSources): SceneReference[] {
  const refs: SceneReference[] = [];
  const push = (ref: SceneReference) => {
    if (isHttps(ref.url) && !refs.some((r) => r.url === ref.url)) refs.push(ref);
  };
  if (sources.characterPhotoUrl) {
    push({
      role: "character",
      url: sources.characterPhotoUrl,
      label: sources.characterName
        ? `${sources.characterName} — Artist Vault photo`
        : "Lead artist — Artist Vault photo",
      source: "artist_vault",
    });
  }
  for (const c of sources.coStars ?? []) {
    if (c.imageUrl) {
      push({ role: "character", url: c.imageUrl, label: c.name, source: "artist_vault" });
    }
  }
  if (sources.locationImageUrl) {
    push({
      role: "location",
      url: sources.locationImageUrl,
      label: sources.locationLabel?.trim() || "Scene location",
      source: "location_library",
    });
  }
  if (sources.brandLogoUrl) {
    push({ role: "style", url: sources.brandLogoUrl, label: "Brand logo", source: "brand_kit" });
  }
  return sortReferenceSet(refs).slice(0, MAX_SCENE_REFERENCES);
}

export interface SceneReferencePlan {
  /** How many of the set this model will receive. */
  submittedCount: number;
  setSize: number;
  /** True when set members exist that this model will NOT receive. */
  reduced: boolean;
  /** Plain-language line for the picker; null when the set is empty. */
  summary: string | null;
}

/**
 * Predict the server's per-model plan for the SET (the continuity anchor
 * is separate and server-decided; the submit response's note is the
 * authoritative wording after generation starts).
 */
export function planSceneReferences(model: SceneClipModel, set: SceneReference[]): SceneReferencePlan {
  const support = CLIP_REFERENCE_SUPPORT[model];
  const tier = CLIP_MODEL_TIER_LABEL[model];
  const sorted = sortReferenceSet(set);
  const setSize = sorted.length;
  if (setSize === 0) {
    return { submittedCount: 0, setSize: 0, reduced: false, summary: null };
  }
  if (support.mode === "reference_images") {
    const submittedCount = Math.min(setSize, support.maxSubmitted);
    const dropped = setSize - submittedCount;
    return {
      submittedCount,
      setSize,
      reduced: dropped > 0,
      summary: dropped > 0
        ? `${tier} takes up to ${support.maxSubmitted} reference images — ${dropped} of your ${setSize} references won't be sent.`
        : `${tier} uses all ${setSize} reference${setSize === 1 ? "" : "s"}.`,
    };
  }
  const top = sorted[0]!;
  return {
    submittedCount: 1,
    setSize,
    reduced: setSize > 1,
    summary: setSize > 1
      ? `${tier} uses 1 of ${setSize} references — your ${top.role} reference goes first (character → location → product → style); the rest aren't sent to this model.`
      : `${tier} uses your 1 reference.`,
  };
}
