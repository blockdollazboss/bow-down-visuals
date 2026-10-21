/**
 * Multi-reference scene generation — per-model truth + submission mapping.
 *
 * A scene can carry a REFERENCE SET: labeled images (character / location /
 * product / style) assembled from the creator's own Artist Vault, locations
 * library, pack assets, and brand kit. What a generation may actually send
 * is decided HERE, from each wired model's real input shape — never from a
 * uniform assumption:
 *
 * ── gen4.5 (Runway SDK, vendored @runwayml/sdk 4.20.0) ──────────────────
 * `ImageToVideoCreateParams.Gen4_5.promptImage: string | PromptImage[]`
 * where `Gen4_5.PromptImage.position` is typed `'first'` ONLY — every
 * entry must claim the first-frame slot, so the model honestly takes ONE
 * reference image: the first frame.
 *
 * ── seedance2_5 (same SDK) ───────────────────────────────────────────────
 * `Seedance2_5.promptImage: string | PromptImage[]` with
 * `PromptImage.position?: 'first' | 'last'` — "Use position first/last
 * for keyframe mode, or omit position for reference images. The two modes
 * cannot be mixed." So Seedance takes a SET of unpositioned reference
 * images (reference mode). The SDK states no numeric cap; our product cap
 * is MAX_SCENE_REFERENCES below.
 *
 * ── veo3_1 (our lib/veo-client.ts) ───────────────────────────────────────
 * The wired client submits a single `image` (first frame) per generation.
 * (The Gemini API also documents referenceImages, but our client does not
 * send them and the tier is pricing-gated off — the honest in-tree truth
 * is one image, so Veo plans as single-reference here.)
 *
 * Mapping rules (stated, testable):
 * - Priority order is character → location → product → style. A model that
 *   takes one image gets the highest-priority set member.
 * - A continuity ANCHOR (the previous scene's last frame, or the legacy
 *   single reference photo) outranks the set on single-image models —
 *   exactly the priority the rail has always applied. On Seedance the
 *   anchor joins the reference array first instead of displacing the set.
 * - Nothing is ever dropped silently: when set members are not submitted,
 *   the plan says so (`reduced` + a plain-language `note`) and the submit
 *   response carries it to the UI.
 *
 * Kept dependency-free (beside clip-pricing.ts) so it unit-tests clean.
 */

import type { ClipModel } from "./clip-pricing";

export type ReferenceRole = "character" | "location" | "product" | "style";

export interface SceneReference {
  role: ReferenceRole;
  /** Public HTTPS image URL (storage refs are minted before planning). */
  url: string;
  /** Human label shown in the UI ("Lead artist — Artist Vault photo"). */
  label: string;
  /** Provenance: artist_vault | pack_asset | pack_prop |
   *  location_library | brand_kit | upload | legacy. */
  source: string;
}

/** Stated priority: character first, then location, product, style. */
export const REFERENCE_ROLE_PRIORITY: Record<ReferenceRole, number> = {
  character: 0,
  location: 1,
  product: 2,
  style: 3,
};

/** Product cap for a scene's reference set (Seedance's SDK type states no
 *  numeric cap; 8 keeps a set curated rather than a dump). */
export const MAX_SCENE_REFERENCES = 8;

export interface ModelReferenceSupport {
  /** Max images this model path will actually receive. */
  maxSubmitted: number;
  /** reference_images = a set of unpositioned references (Seedance);
   *  single_first_frame = exactly one image, used as the first frame. */
  mode: "reference_images" | "single_first_frame";
  /** The evidence for the row above, in one line. */
  truth: string;
}

export const CLIP_REFERENCE_SUPPORT: Record<ClipModel, ModelReferenceSupport> = {
  seedance2_5: {
    maxSubmitted: MAX_SCENE_REFERENCES,
    mode: "reference_images",
    truth:
      "Runway SDK Seedance2_5.promptImage accepts an array of unpositioned reference images (position first/last is keyframe mode and cannot be mixed with references).",
  },
  "gen4.5": {
    maxSubmitted: 1,
    mode: "single_first_frame",
    truth:
      "Runway SDK Gen4_5.PromptImage.position is typed 'first' only — the model takes a single first-frame image.",
  },
  veo3_1: {
    maxSubmitted: 1,
    mode: "single_first_frame",
    truth:
      "Our Veo client (lib/veo-client.ts) submits one first-frame image per generation.",
  },
};

/** Creator-facing tier names (match the Scene Studio model picker). */
export const CLIP_MODEL_TIER_LABEL: Record<ClipModel, string> = {
  "gen4.5": "Standard",
  seedance2_5: "Premium",
  veo3_1: "Cinematic",
};

const ROLE_LABEL: Record<ReferenceRole, string> = {
  character: "Character",
  location: "Location",
  product: "Product",
  style: "Style",
};

function isRole(v: unknown): v is ReferenceRole {
  return v === "character" || v === "location" || v === "product" || v === "style";
}

/**
 * Validate + normalize an untrusted reference set: HTTPS URLs only,
 * deduped by URL, sorted by role priority (stable within a role), capped
 * at MAX_SCENE_REFERENCES. Invalid entries are dropped, never trusted.
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
    if (!/^https:\/\//i.test(url) || url.length > 2048 || seen.has(url)) continue;
    seen.add(url);
    const label =
      typeof r["label"] === "string" && r["label"].trim()
        ? r["label"].trim().slice(0, 200)
        : `${ROLE_LABEL[r["role"]]} reference`;
    const source =
      typeof r["source"] === "string" && r["source"].trim()
        ? r["source"].trim().slice(0, 60)
        : "upload";
    out.push({ role: r["role"], url, label, source });
  }
  out.sort((a, b) => REFERENCE_ROLE_PRIORITY[a.role] - REFERENCE_ROLE_PRIORITY[b.role]);
  return out.slice(0, MAX_SCENE_REFERENCES);
}

/** Sort an already-valid set by the stated role priority (stable). */
export function sortReferenceSet(refs: SceneReference[]): SceneReference[] {
  return [...refs].sort(
    (a, b) => REFERENCE_ROLE_PRIORITY[a.role] - REFERENCE_ROLE_PRIORITY[b.role],
  );
}

export interface ClipReferencePlan {
  mode: "reference_images" | "single" | "none";
  /** Runway-shaped promptImage: the legacy string for single/legacy paths,
   *  an array of unpositioned {uri} entries for Seedance reference mode.
   *  Undefined = text-to-video (no image submitted). */
  promptImage?: string | Array<{ uri: string }>;
  /** The one image URL for single-image clients (Veo). */
  singleUrl?: string;
  /** Every image URL actually submitted, anchor first. */
  submittedUrls: string[];
  /** How many of the submitted URLs came from the reference set. */
  submittedFromSet: number;
  /** Size of the normalized reference set that was considered. */
  setSize: number;
  /** True when set members exist that this model will NOT receive. */
  reduced: boolean;
  /** Plain-language explanation when reduced; null otherwise. */
  note: string | null;
}

/**
 * Plan exactly what one generation submits for a model, given the scene's
 * reference set and the continuity anchor (previous scene's last frame or
 * the legacy single reference photo; null when neither exists).
 */
export function planClipReferences(opts: {
  model: ClipModel;
  referenceSet?: SceneReference[] | null;
  anchorUrl?: string | null;
  /** What the anchor is, for honest note copy: the previous scene's last
   *  frame (continuity chain) or a single chosen photo (legacy rail). */
  anchorKind?: "previous_scene" | "single_photo";
}): ClipReferencePlan {
  const support = CLIP_REFERENCE_SUPPORT[opts.model];
  const set = sortReferenceSet(
    normalizeReferenceSet(opts.referenceSet ?? []),
  );
  const anchor =
    typeof opts.anchorUrl === "string" && /^https:\/\//i.test(opts.anchorUrl)
      ? opts.anchorUrl
      : null;
  const tier = CLIP_MODEL_TIER_LABEL[opts.model];

  /* ── Multi-reference model (Seedance 2.5): reference mode ──────────── */
  if (support.mode === "reference_images") {
    if (!anchor && set.length === 0) {
      return { mode: "none", submittedUrls: [], submittedFromSet: 0, setSize: 0, reduced: false, note: null };
    }
    if (!anchor && set.length === 1) {
      /* One reference, no anchor: keep the exact legacy shape (a plain
         string promptImage) so single-reference Seedance generations are
         byte-identical to before. */
      return {
        mode: "single",
        promptImage: set[0]!.url,
        singleUrl: set[0]!.url,
        submittedUrls: [set[0]!.url],
        submittedFromSet: 1,
        setSize: 1,
        reduced: false,
        note: null,
      };
    }
    if (set.length === 0 && anchor) {
      /* Legacy path: anchor only, exactly as before. */
      return {
        mode: "single",
        promptImage: anchor,
        singleUrl: anchor,
        submittedUrls: [anchor],
        submittedFromSet: 0,
        setSize: 0,
        reduced: false,
        note: null,
      };
    }
    /* Reference mode: anchor first (continuity), then the set in priority
       order, deduped, capped. Keyframe positions are NOT used — the SDK
       forbids mixing positioned and reference entries. */
    const urls: string[] = [];
    const push = (u: string) => { if (!urls.includes(u)) urls.push(u); };
    if (anchor) push(anchor);
    for (const ref of set) push(ref.url);
    const capped = urls.slice(0, support.maxSubmitted);
    const submittedFromSet = capped.filter((u) => set.some((r) => r.url === u)).length;
    const dropped = set.length - submittedFromSet;
    return {
      mode: "reference_images",
      promptImage: capped.map((uri) => ({ uri })),
      submittedUrls: capped,
      submittedFromSet,
      setSize: set.length,
      reduced: dropped > 0,
      note: dropped > 0
        ? `${tier} takes up to ${support.maxSubmitted} reference images — ${dropped} of your ${set.length} set references weren't sent.`
        : null,
    };
  }

  /* ── Single-image models (Gen-4.5, Veo 3.1): one first frame ────────── */
  if (anchor) {
    const anchorRef = set.find((r) => r.url === anchor);
    const submittedFromSet = anchorRef ? 1 : 0;
    const notSent = set.length - submittedFromSet;
    let note: string | null = null;
    if (notSent > 0 && anchorRef) {
      note = `${tier} uses 1 of your ${set.length} references — your ${anchorRef.role} reference; the rest aren't sent to this model.`;
    } else if (notSent > 0 && opts.anchorKind === "previous_scene") {
      note = `${tier} uses one reference image — this generation is anchored on your previous scene's final frame, so your set references aren't sent to this model.`;
    } else if (notSent > 0) {
      note = `${tier} uses one reference image — your set references aren't sent to this model.`;
    }
    return {
      mode: "single",
      promptImage: anchor,
      singleUrl: anchor,
      submittedUrls: [anchor],
      submittedFromSet,
      setSize: set.length,
      reduced: notSent > 0,
      note,
    };
  }
  if (set.length === 0) {
    return { mode: "none", submittedUrls: [], submittedFromSet: 0, setSize: 0, reduced: false, note: null };
  }
  const top = set[0]!;
  return {
    mode: "single",
    promptImage: top.url,
    singleUrl: top.url,
    submittedUrls: [top.url],
    submittedFromSet: 1,
    setSize: set.length,
    reduced: set.length > 1,
    note: set.length > 1
      ? `${tier} uses 1 of your ${set.length} references — your ${top.role} reference goes first (character → location → product → style); the rest aren't sent to this model.`
      : null,
  };
}
