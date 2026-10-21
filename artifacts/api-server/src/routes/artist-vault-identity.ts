import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";
import { db, artistVaultsTable, artistVaultIdentityPhotosTable } from "@workspace/db";
import { eq, and, asc, isNull } from "drizzle-orm";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { refreshSupabaseStorageUrl, isStorageRef } from "../lib/objectStorage";
import { getUserActiveTeam } from "../lib/teams";
import {
  IDENTITY_ANGLES,
  IDENTITY_EXPRESSIONS,
  IDENTITY_PHOTO_SOURCES,
  MAX_IDENTITY_PHOTOS_PER_VAULT,
  deriveShotNeeds,
  identityCoverage,
  selectIdentityPhoto,
  type IdentityCandidate,
} from "../lib/identity-set";

/* ─── Identity Sets (Higgsfield G4, honest near-term form) ───────────────
   A vault character holds a SET of labeled photos of the same character
   (angle / expression / wardrobe) beside its main reference photo. Per
   generation, POST …/identity-photos/select picks the best-matching
   photo for the shot and returns the pick + a plain-language reason —
   visible and overridable, never silent. NO training happens here and
   nothing claims otherwise: this is disciplined reference selection
   feeding the reference the generation rail already consumes.

   Access mirrors the vault rails: reads + selection are USE operations
   (owner, or a member of the team the vault is shared with); manage
   operations (add / relabel / remove) are strict-owner only, and every
   not-yours answer is a no-leak 404, exactly like the vault PUT/DELETE.
   Deletes are soft (deleted_at) — set photos are user data and are
   never hard-deleted; the storage object is never touched. */

const router = Router();

const httpsUrl = z
  .string()
  .trim()
  .min(1)
  .refine((u) => /^https?:\/\//i.test(u), { message: "image_url must be an http(s) URL" });

const AddPhotoSchema = z.object({
  image_url: httpsUrl,
  image_path: z.string().trim().max(500).optional().nullable(),
  angle: z.enum(IDENTITY_ANGLES),
  expression: z.enum(IDENTITY_EXPRESSIONS).optional(),
  wardrobe: z.string().trim().max(120).optional().nullable(),
  source: z.enum(IDENTITY_PHOTO_SOURCES).optional(),
});

const UpdatePhotoSchema = z.object({
  angle: z.enum(IDENTITY_ANGLES).optional(),
  expression: z.enum(IDENTITY_EXPRESSIONS).optional(),
  wardrobe: z.string().trim().max(120).optional().nullable(),
});

const SelectSchema = z.object({
  cameraMovement: z.string().max(500).optional().nullable(),
  promptText: z.string().max(5000).optional().nullable(),
  actionText: z.string().max(2000).optional().nullable(),
  mood: z.string().max(200).optional().nullable(),
  wardrobeHint: z.string().max(120).optional().nullable(),
  overridePhotoId: z.string().max(100).optional().nullable(),
});

type VaultRow = typeof artistVaultsTable.$inferSelect;
type PhotoRow = typeof artistVaultIdentityPhotosTable.$inferSelect;

/** The vault if the caller can USE it (owner or active-team share),
 *  mirroring getAccessibleVault in artist-vaults.ts. */
async function getAccessibleVault(userId: string, vaultId: string): Promise<VaultRow | null> {
  const [vault] = await db
    .select()
    .from(artistVaultsTable)
    .where(and(eq(artistVaultsTable.id, vaultId), isNull(artistVaultsTable.deleted_at)))
    .limit(1);
  if (!vault) return null;
  if (vault.user_id === userId) return vault;
  if (vault.team_id) {
    const activeTeam = await getUserActiveTeam(userId);
    if (activeTeam && activeTeam.team.id === vault.team_id) return vault;
  }
  return null;
}

/** The vault if the caller OWNS it (manage rails), mirroring
 *  getOwnedVaultRow in artist-vaults.ts. */
async function getOwnedVault(userId: string, vaultId: string): Promise<VaultRow | null> {
  const [vault] = await db
    .select()
    .from(artistVaultsTable)
    .where(
      and(
        eq(artistVaultsTable.id, vaultId),
        eq(artistVaultsTable.user_id, userId),
        isNull(artistVaultsTable.deleted_at),
      ),
    )
    .limit(1);
  return vault ?? null;
}

async function listLivePhotos(vaultId: string): Promise<PhotoRow[]> {
  return db
    .select()
    .from(artistVaultIdentityPhotosTable)
    .where(
      and(
        eq(artistVaultIdentityPhotosTable.vault_id, vaultId),
        isNull(artistVaultIdentityPhotosTable.deleted_at),
      ),
    )
    .orderBy(asc(artistVaultIdentityPhotosTable.sort_order), asc(artistVaultIdentityPhotosTable.created_at));
}

/* Stored media may be a storage ref (mirrored at save) or a legacy
   public URL — resolve R2-first / re-sign on read, same as outfits. */
async function presentPhoto<T extends { image_url: string; image_path: string | null }>(row: T): Promise<T> {
  const source = row.image_path ?? row.image_url;
  return { ...row, image_url: source ? await refreshSupabaseStorageUrl(source) : row.image_url };
}

/** The selection pool: the vault's main photo (when it has one) as the
 *  "main" candidate + every live set photo, in display order. */
async function buildPool(vault: VaultRow, photos: PhotoRow[]): Promise<IdentityCandidate[]> {
  const pool: IdentityCandidate[] = [];
  if (vault.reference_image_url) {
    pool.push({
      id: "main",
      imageUrl: await refreshSupabaseStorageUrl(vault.reference_image_url),
      angle: "front",
      expression: "neutral",
      wardrobe: null,
      source: "upload",
      isMain: true,
    });
  }
  for (const p of photos) {
    const presented = await presentPhoto(p);
    pool.push({
      id: p.id,
      imageUrl: presented.image_url,
      angle: p.angle,
      expression: p.expression,
      wardrobe: p.wardrobe,
      source: p.source,
      isMain: false,
    });
  }
  return pool;
}

/* ── GET /api/artist-vaults/:vaultId/identity-photos — the set + coverage ── */
router.get("/artist-vaults/:vaultId/identity-photos", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const vault = await getAccessibleVault(req.userId!, vaultId);
  if (!vault) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const photos = await listLivePhotos(vaultId);
  const pool = await buildPool(vault, photos);
  res.json({
    photos: await Promise.all(photos.map(presentPhoto)),
    mainPhoto: vault.reference_image_url
      ? { image_url: await refreshSupabaseStorageUrl(vault.reference_image_url) }
      : null,
    coverage: identityCoverage(pool),
    maxPhotos: MAX_IDENTITY_PHOTOS_PER_VAULT,
  });
});

/* ── POST /api/artist-vaults/:vaultId/identity-photos — add a photo ── */
router.post("/artist-vaults/:vaultId/identity-photos", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const vault = await getOwnedVault(req.userId!, vaultId);
  if (!vault) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const parsed = AddPhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid identity photo data", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  const existing = await listLivePhotos(vaultId);
  if (existing.length >= MAX_IDENTITY_PHOTOS_PER_VAULT) {
    res.status(400).json({
      error: `An identity set holds up to ${MAX_IDENTITY_PHOTOS_PER_VAULT} photos. Remove one before adding another.`,
    });
    return;
  }

  /* Mirror-on-save (2026-10-13 law): the photo is re-hosted into
     permanent storage so a set photo can never expire. */
  const storedUrl =
    (await mirrorExternalMediaUrl(d.image_url, { kind: "image", ownerKey: req.userId! })) ?? d.image_url;
  const [row] = await db
    .insert(artistVaultIdentityPhotosTable)
    .values({
      vault_id: vaultId,
      user_id: req.userId!,
      image_url: storedUrl,
      image_path: isStorageRef(storedUrl) ? storedUrl : (d.image_path ?? null),
      angle: d.angle,
      expression: d.expression ?? "neutral",
      wardrobe: d.wardrobe ?? null,
      source: d.source ?? "upload",
      sort_order: existing.length,
    })
    .returning();

  res.status(201).json({ photo: row ? await presentPhoto(row) : row });
});

/* ── PATCH /api/artist-vaults/:vaultId/identity-photos/:photoId — relabel ── */
router.patch("/artist-vaults/:vaultId/identity-photos/:photoId", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const photoId = String(req.params["photoId"]);
  const vault = await getOwnedVault(req.userId!, vaultId);
  if (!vault) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const parsed = UpdatePhotoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid identity photo data", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  const [photo] = await db
    .select({ id: artistVaultIdentityPhotosTable.id })
    .from(artistVaultIdentityPhotosTable)
    .where(
      and(
        eq(artistVaultIdentityPhotosTable.id, photoId),
        eq(artistVaultIdentityPhotosTable.vault_id, vaultId),
        isNull(artistVaultIdentityPhotosTable.deleted_at),
      ),
    )
    .limit(1);
  if (!photo) {
    res.status(404).json({ error: "Identity photo not found" });
    return;
  }

  const set: Record<string, unknown> = { updated_at: new Date() };
  if (d.angle !== undefined) set["angle"] = d.angle;
  if (d.expression !== undefined) set["expression"] = d.expression;
  if (d.wardrobe !== undefined) set["wardrobe"] = d.wardrobe;
  await db
    .update(artistVaultIdentityPhotosTable)
    .set(set)
    .where(eq(artistVaultIdentityPhotosTable.id, photoId));

  res.json({ success: true });
});

/* ── DELETE /api/artist-vaults/:vaultId/identity-photos/:photoId — remove ──
   Soft delete only: the row is hidden, the data and the storage object
   are preserved (the vault's never-lose-data law). */
router.delete("/artist-vaults/:vaultId/identity-photos/:photoId", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const photoId = String(req.params["photoId"]);
  const vault = await getOwnedVault(req.userId!, vaultId);
  if (!vault) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const [photo] = await db
    .select({ id: artistVaultIdentityPhotosTable.id })
    .from(artistVaultIdentityPhotosTable)
    .where(
      and(
        eq(artistVaultIdentityPhotosTable.id, photoId),
        eq(artistVaultIdentityPhotosTable.vault_id, vaultId),
        isNull(artistVaultIdentityPhotosTable.deleted_at),
      ),
    )
    .limit(1);
  if (!photo) {
    res.status(404).json({ error: "Identity photo not found" });
    return;
  }
  await db
    .update(artistVaultIdentityPhotosTable)
    .set({ deleted_at: new Date(), updated_at: new Date() })
    .where(eq(artistVaultIdentityPhotosTable.id, photoId));

  res.json({ success: true });
});

/* ── POST /api/artist-vaults/:vaultId/identity-photos/select ─────────────
   The per-generation pick. Body carries the shot's context (camera
   movement / prompt / action / mood / wardrobe hint); the answer is
   the chosen photo + why, plus the whole scored pool so the creator
   can override from the same payload. An overridePhotoId that names
   no pool photo is a 400 — the pick is never silently different from
   what the creator chose. */
router.post("/artist-vaults/:vaultId/identity-photos/select", requireAuth, async (req, res) => {
  const vaultId = String(req.params["vaultId"]);
  const vault = await getAccessibleVault(req.userId!, vaultId);
  if (!vault) {
    res.status(404).json({ error: "Character not found" });
    return;
  }
  const parsed = SelectSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid selection request", details: parsed.error.issues });
    return;
  }
  const d = parsed.data;

  const photos = await listLivePhotos(vaultId);
  const pool = await buildPool(vault, photos);
  const coverage = identityCoverage(pool);

  if (d.overridePhotoId && !pool.some((c) => c.id === d.overridePhotoId)) {
    res.status(400).json({ error: "That photo is not in this character's identity set." });
    return;
  }

  const needs = deriveShotNeeds({
    cameraMovement: d.cameraMovement,
    promptText: d.promptText,
    actionText: d.actionText,
    mood: d.mood,
    wardrobeHint: d.wardrobeHint,
  });
  const selection = selectIdentityPhoto(pool, needs, d.overridePhotoId);

  if (!selection) {
    res.json({
      chosen: null,
      reason: "This character has no identity photo yet — add one in the Artist Vault.",
      overridden: false,
      setCount: photos.length,
      poolSize: 0,
      pool: [],
      coverage,
    });
    return;
  }

  res.json({
    chosen: {
      id: selection.chosen.id,
      imageUrl: selection.chosen.imageUrl,
      angle: selection.chosen.angle,
      expression: selection.chosen.expression,
      wardrobe: selection.chosen.wardrobe,
      source: selection.chosen.source,
      isMain: selection.chosen.isMain,
    },
    reason: selection.reason,
    overridden: selection.overridden,
    setCount: photos.length,
    poolSize: pool.length,
    pool: selection.scored.map((s) => ({
      id: s.candidate.id,
      imageUrl: s.candidate.imageUrl,
      angle: s.candidate.angle,
      expression: s.candidate.expression,
      wardrobe: s.candidate.wardrobe,
      source: s.candidate.source,
      isMain: s.candidate.isMain,
      score: s.score,
    })),
    coverage,
  });
});

export default router;
