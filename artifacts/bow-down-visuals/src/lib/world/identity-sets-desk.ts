/* ─── Identity sets desk seam (stack1500 world parity wave #4b,
   census item 38 — a vault character's labeled photo set) ────────
   The identity-set half of pages/artist-vault.tsx, native in the
   My Studio stack on the page's own rails
   (routes/artist-vault-identity.ts, every one requireAuth):

     GET    /api/artist-vaults/:vaultId/identity-photos
            (USE access — owner or active-team share) →
            { photos, mainPhoto, coverage, maxPhotos: 12 }
     POST   /api/artist-vaults/:vaultId/identity-photos
            (STRICT OWNER) → 201 { photo } — the server mirrors
            the image into permanent storage on save.
     PATCH  /api/artist-vaults/:vaultId/identity-photos/:photoId
            (STRICT OWNER) → { success: true }
     DELETE /api/artist-vaults/:vaultId/identity-photos/:photoId
            (STRICT OWNER) → { success: true } — SOFT delete: the
            row hides, the storage object is preserved.
     POST   /api/artist-vaults/:vaultId/identity-photos/select
            (USE access) → { chosen, reason, overridden, setCount,
            poolSize, pool, coverage } — the explainable pick for
            a shot; an override naming no pool photo is a 400,
            never a silent different pick.

   The vault picker rides the same vault read the character
   picker uses (GET /api/artist-vaults) shaped by the existing
   normalizeVaultCharacters — isOwn is the desk's honesty gate:
   manage controls (add / relabel / remove) render ONLY on the
   member's own vaults, because the manage rails are strict-owner
   (a shared vault answers them with a no-leak 404). Reads and
   the shot pick are USE operations and work on shared vaults.

   FREE: the registry prices the family's pattern row at
   { "/api/artist-vaults/:id/identity-photos": { cost: 0,
   feature: "Identity Set Photos (free)" } }. NOTE the pinning
   subtlety: the registry matches by exact key or key + "/" /
   key + "?" prefix, and a CONCRETE path (/api/artist-vaults/
   <uuid>/identity-photos) can never match the ":id" pattern key —
   so the desk pins the row by its literal pattern key, exactly
   as registered, through the throw-on-unregistered helper.

   HONESTY: coverage labels and missing-messages render from the
   rail's own answer verbatim (identityCoverage's words), the
   pick's reason renders verbatim, the main photo is badged as
   the main photo (it joins every pick pool as candidate "main"),
   and a "generated" photo is badged as generated — the rail's
   own rule ("'generated' photos are admitted only with the label
   on and are badged everywhere they appear"). Picking is label
   fit over the creator's own labels — the desk never claims a
   photo was looked inside. */

import { getCreditCost } from "@/lib/credit-costs";

/** The registry's pattern row for this family — pinned literally
 *  (see the header: concrete paths cannot match the ":id" key). */
export const IDENTITY_PHOTOS_REGISTRY_KEY = "/api/artist-vaults/:id/identity-photos";
export function identityPhotosCost(): number {
  const entry = getCreditCost(IDENTITY_PHOTOS_REGISTRY_KEY);
  if (!entry) throw new Error(`Identity photos endpoint is not registered: ${IDENTITY_PHOTOS_REGISTRY_KEY}`);
  return entry.cost;
}

export const ARTIST_VAULTS_PATH = "/api/artist-vaults";

export function identityPhotosPath(vaultId: string): string {
  return `${ARTIST_VAULTS_PATH}/${encodeURIComponent(vaultId)}/identity-photos`;
}

export function identityPhotoPath(vaultId: string, photoId: string): string {
  return `${identityPhotosPath(vaultId)}/${encodeURIComponent(photoId)}`;
}

export function identitySelectPath(vaultId: string): string {
  return `${identityPhotosPath(vaultId)}/select`;
}

/* ─── The rail's own vocabularies (lib/identity-set.ts mirrors) ─── */

export const IDENTITY_ANGLES = [
  "front",
  "three_quarter_left",
  "three_quarter_right",
  "left_profile",
  "right_profile",
  "back",
  "full_body",
  "close_up",
] as const;

export const IDENTITY_EXPRESSIONS = [
  "neutral",
  "smile",
  "laughing",
  "serious",
  "intense",
  "singing",
  "sad",
  "surprised",
] as const;

export const IDENTITY_PHOTO_SOURCES = ["upload", "generated"] as const;

export const MAX_IDENTITY_PHOTOS = 12;

/** Display labels — the rail's own ANGLE_LABELS / EXPRESSION_LABELS. */
export const IDENTITY_ANGLE_LABELS: Record<string, string> = {
  front: "front",
  three_quarter_left: "three-quarter (left)",
  three_quarter_right: "three-quarter (right)",
  left_profile: "left profile",
  right_profile: "right profile",
  back: "back",
  full_body: "full-body",
  close_up: "close-up",
};

export const IDENTITY_EXPRESSION_LABELS: Record<string, string> = {
  neutral: "neutral",
  smile: "smiling",
  laughing: "laughing",
  serious: "serious",
  intense: "intense",
  singing: "singing",
  sad: "sad",
  surprised: "surprised",
};

export function identityAngleLabel(angle: string): string {
  return IDENTITY_ANGLE_LABELS[angle] ?? angle.replace(/_/g, " ");
}

export function identityExpressionLabel(expression: string): string {
  return IDENTITY_EXPRESSION_LABELS[expression] ?? expression.replace(/_/g, " ");
}

/* ─── Shapes (the rails' answers, guarded) ──────────────────────── */

export interface IdentityPhoto {
  id: string;
  imageUrl: string;
  angle: string;
  expression: string;
  wardrobe: string | null;
  source: string;
}

export interface IdentityCoverageItem {
  key: string;
  label: string;
  covered: boolean;
  missingMessage: string;
}

export interface IdentitySetView {
  photos: IdentityPhoto[];
  mainPhotoUrl: string | null;
  coverage: IdentityCoverageItem[];
  coverageSummary: string;
  maxPhotos: number;
}

export interface IdentityCandidateView {
  id: string;
  imageUrl: string;
  angle: string;
  expression: string;
  wardrobe: string | null;
  source: string;
  isMain: boolean;
  score: number | null;
}

export interface IdentitySelectionView {
  chosen: IdentityCandidateView | null;
  reason: string;
  overridden: boolean;
  setCount: number;
  poolSize: number;
  pool: IdentityCandidateView[];
  coverage: IdentityCoverageItem[];
  coverageSummary: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function photoOf(raw: unknown): IdentityPhoto | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const imageUrl = str(raw["image_url"] ?? raw["imageUrl"]);
  const angle = str(raw["angle"]);
  if (!id || !imageUrl || !angle) return null;
  return {
    id,
    imageUrl,
    angle,
    expression: str(raw["expression"]) || "neutral",
    wardrobe: typeof raw["wardrobe"] === "string" && raw["wardrobe"] ? raw["wardrobe"] : null,
    source: str(raw["source"]) || "upload",
  };
}

function coverageOf(raw: unknown): IdentityCoverageItem[] {
  if (!isRecord(raw) || !Array.isArray(raw["items"])) return [];
  const out: IdentityCoverageItem[] = [];
  for (const item of raw["items"]) {
    if (!isRecord(item) || typeof item["key"] !== "string" || typeof item["label"] !== "string") continue;
    out.push({
      key: item["key"],
      label: item["label"],
      covered: item["covered"] === true,
      missingMessage: str(item["missingMessage"]),
    });
  }
  return out;
}

function coverageSummaryOf(raw: unknown): string {
  return isRecord(raw) ? str(raw["summary"]) : "";
}

export function identitySetOfResponse(data: unknown): IdentitySetView | null {
  if (!isRecord(data) || !Array.isArray(data["photos"])) return null;
  const photos: IdentityPhoto[] = [];
  for (const raw of data["photos"]) {
    const photo = photoOf(raw);
    if (photo) photos.push(photo);
  }
  const main = isRecord(data["mainPhoto"]) ? str(data["mainPhoto"]["image_url"]) : "";
  return {
    photos,
    mainPhotoUrl: main || null,
    coverage: coverageOf(data["coverage"]),
    coverageSummary: coverageSummaryOf(data["coverage"]),
    maxPhotos: typeof data["maxPhotos"] === "number" ? data["maxPhotos"] : MAX_IDENTITY_PHOTOS,
  };
}

function candidateOf(raw: unknown, withScore: boolean): IdentityCandidateView | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const imageUrl = str(raw["imageUrl"]);
  if (!id || !imageUrl) return null;
  return {
    id,
    imageUrl,
    angle: str(raw["angle"]),
    expression: str(raw["expression"]),
    wardrobe: typeof raw["wardrobe"] === "string" && raw["wardrobe"] ? raw["wardrobe"] : null,
    source: str(raw["source"]) || "upload",
    isMain: raw["isMain"] === true,
    score: withScore && typeof raw["score"] === "number" ? raw["score"] : null,
  };
}

export function identitySelectionOfResponse(data: unknown): IdentitySelectionView | null {
  if (!isRecord(data) || typeof data["reason"] !== "string") return null;
  const pool: IdentityCandidateView[] = [];
  if (Array.isArray(data["pool"])) {
    for (const raw of data["pool"]) {
      const c = candidateOf(raw, true);
      if (c) pool.push(c);
    }
  }
  return {
    chosen: data["chosen"] === null ? null : candidateOf(data["chosen"], false),
    reason: data["reason"],
    overridden: data["overridden"] === true,
    setCount: typeof data["setCount"] === "number" ? data["setCount"] : 0,
    poolSize: typeof data["poolSize"] === "number" ? data["poolSize"] : pool.length,
    pool,
    coverage: coverageOf(data["coverage"]),
    coverageSummary: coverageSummaryOf(data["coverage"]),
  };
}

/* ─── Payload builders (the route schemas, mirrored) ────────────── */

export interface IdentityAddDraft {
  imageUrl: string;
  angle: string;
  expression: string;
  wardrobe: string;
  source: string;
}

/** AddPhotoSchema: an http(s) image URL is required; the angle
 *  must be one of the rail's; blank optionals ride as absent. */
export function buildIdentityAddPayload(draft: IdentityAddDraft) {
  return {
    image_url: draft.imageUrl.trim(),
    angle: draft.angle,
    expression: draft.expression || undefined,
    wardrobe: draft.wardrobe.trim() ? draft.wardrobe.trim() : undefined,
    source: draft.source || undefined,
  };
}

export function identityAddReady(draft: IdentityAddDraft): boolean {
  return (
    /^https?:\/\//i.test(draft.imageUrl.trim()) &&
    (IDENTITY_ANGLES as readonly string[]).includes(draft.angle) &&
    draft.wardrobe.trim().length <= 120
  );
}

export interface IdentityRelabelDraft {
  angle: string;
  expression: string;
  wardrobe: string;
}

/** UpdatePhotoSchema: every field optional; wardrobe may clear. */
export function buildIdentityRelabelPayload(draft: IdentityRelabelDraft) {
  return {
    angle: draft.angle || undefined,
    expression: draft.expression || undefined,
    wardrobe: draft.wardrobe.trim() ? draft.wardrobe.trim() : null,
  };
}

export interface IdentityShotDraft {
  cameraMovement: string;
  promptText: string;
  actionText: string;
  mood: string;
  wardrobeHint: string;
}

/** SelectSchema: the shot's context words, capped at its bounds;
 *  the override names a pool photo ("main" or a set-photo id). */
export function buildIdentitySelectPayload(draft: IdentityShotDraft, overridePhotoId?: string) {
  const cap = (v: string, max: number) => {
    const t = v.trim().slice(0, max);
    return t ? t : undefined;
  };
  return {
    cameraMovement: cap(draft.cameraMovement, 500),
    promptText: cap(draft.promptText, 5000),
    actionText: cap(draft.actionText, 2000),
    mood: cap(draft.mood, 200),
    wardrobeHint: cap(draft.wardrobeHint, 120),
    overridePhotoId: overridePhotoId || undefined,
  };
}

/** A remove is a SOFT delete on the rail — the desk's copy says
 *  the photo leaves the set while its file is kept. */
export const IDENTITY_REMOVE_COPY =
  "Removing takes the photo out of the set. The file itself is kept in storage — nothing is destroyed.";

export const IDENTITY_SETS_PROMOTION =
  "Identity Sets in the My Studio stack: each vault character's labeled photo set on the artist-vault identity rails — the set grid with angle / expression / wardrobe labels, the rail's own coverage checklist, add / relabel / remove for the character's owner (reads + the shot pick work on team-shared characters too), and the pick-for-a-shot panel with the rail's stated reason and a one-tap override";
