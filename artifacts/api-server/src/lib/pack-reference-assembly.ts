/**
 * Pack-lock reference assembly ("Turbo Reference Casting").
 *
 * When a pre-production pack is finalized (locked), every shot gets a
 * REFERENCE SET assembled from the creator's OWN material:
 *   character ← the pack's Artist Vault photo
 *   location  ← pack Location assets / the creator's locations library,
 *               matched to the shot (never another member's library)
 *   product   ← the pack's hero props that appear in the shot and have a
 *               generated plate image
 *   style     ← the creator's brand-kit logo image
 *
 * The caller (finalize route) loads every source with owner-scoped
 * queries — a vault, location, or brand kit that belongs to someone else
 * is simply never passed in, so it can never enter a set. This module is
 * the pure matching/gap logic over those owner-scoped inputs.
 *
 * Gaps are first-class output: a shot with no character photo or no
 * location reference says so in plain language (`referenceGaps`), so the
 * creator sees what is thin BEFORE any credits move — nothing is attached
 * silently and nothing pretends to exist.
 */

import type { PackAsset, PackProp, PackReference } from "@workspace/db";
import {
  MAX_SCENE_REFERENCES,
  REFERENCE_ROLE_PRIORITY,
} from "../routes/generate/clip-references";

export interface ReferenceAssemblySources {
  /** The pack's Artist Vault, ALREADY owner-scoped by the caller
   *  (null when the pack has no vault, the vault is not the caller's,
   *  or it was soft-deleted). */
  vault: { artistName: string; referenceImageUrl: string | null } | null;
  /** Finalized pack assets (Location plates are location candidates). */
  assets: PackAsset[];
  /** The creator's locations library, ALREADY owner-scoped. imageUrl is
   *  the stored value (storage ref or URL — re-signed on pack reads). */
  locations: { label: string; imageUrl: string }[];
  /** The creator's brand-kit logo image, if the kit has one. */
  brandLogoUrl: string | null;
  /** The bible's locations text — a location gap is only worth flagging
   *  when the production actually names locations. */
  bibleLocations: string | null;
}

export interface ShotReferenceAssembly {
  referenceSet: PackReference[];
  referenceGaps: string[];
}

/** Words long enough to match on (skips "the", "a", "in", …). */
function matchTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );
}

function labelMatchesShot(label: string, shotTokens: Set<string>): boolean {
  const labelTokens = matchTokens(label);
  if (labelTokens.size === 0) return false;
  for (const t of labelTokens) if (shotTokens.has(t)) return true;
  return false;
}

const MAX_LOCATION_REFS = 2;
const MAX_PRODUCT_REFS = 3;

/**
 * Assemble one shot's reference set + gaps from owner-scoped sources.
 * `namedPropRefs` are the hero-prop names the pack's AI plan said this
 * shot should match (the finalize route already resolves those to
 * referenceAssetUrls); a named prop with no plate image is a gap.
 */
export function assembleShotReferenceSet(opts: {
  shotNumber: number;
  shotDescription: string;
  props: PackProp[];
  namedPropRefs: string[];
  sources: ReferenceAssemblySources;
}): ShotReferenceAssembly {
  const { sources } = opts;
  const set: PackReference[] = [];
  const gaps: string[] = [];
  const seen = new Set<string>();
  const push = (ref: PackReference) => {
    if (seen.has(ref.url)) return;
    seen.add(ref.url);
    set.push(ref);
  };

  /* ── Character: the pack's Artist Vault photo ─────────────────────── */
  const vaultUrl = sources.vault?.referenceImageUrl?.trim();
  if (vaultUrl) {
    push({
      role: "character",
      url: vaultUrl,
      label: `${sources.vault!.artistName || "Artist"} — Artist Vault photo`,
      source: "artist_vault",
    });
  } else {
    gaps.push(
      "No character reference: no Artist Vault photo is locked to this pack, so generations can't lock the artist's face.",
    );
  }

  /* ── Location: pack Location plates + the creator's library ───────── */
  const shotTokens = matchTokens(opts.shotDescription);
  const locationPlates = sources.assets.filter(
    (a) => a.category === "Location" && a.imageUrl,
  );
  const locationCandidates: PackReference[] = [
    ...locationPlates.map((a) => ({
      role: "location" as const,
      url: a.imageUrl!,
      label: a.label,
      source: "pack_asset" as const,
    })),
    ...sources.locations
      .filter((l) => l.imageUrl)
      .map((l) => ({
        role: "location" as const,
        url: l.imageUrl,
        label: l.label,
        source: "location_library" as const,
      })),
  ];
  const matchedLocations = locationCandidates.filter((c) =>
    labelMatchesShot(c.label, shotTokens),
  );
  /* No label match: a single Location plate is the pack's hero location —
     attach it rather than leaving the shot unanchored. A library full of
     unmatched places is NOT guessed at. */
  const chosenLocations =
    matchedLocations.length > 0
      ? matchedLocations
      : locationPlates.length === 1
        ? locationCandidates.filter((c) => c.source === "pack_asset")
        : [];
  for (const loc of chosenLocations.slice(0, MAX_LOCATION_REFS)) push(loc);
  if (chosenLocations.length === 0 && (sources.bibleLocations ?? "").trim()) {
    gaps.push("No location reference for this scene.");
  }

  /* ── Product: hero props in this shot that have a plate image ─────── */
  const shotProps = opts.props.filter(
    (p) => p.shots.includes(opts.shotNumber) && p.assetImageUrl,
  );
  for (const p of shotProps.slice(0, MAX_PRODUCT_REFS)) {
    push({
      role: "product",
      url: p.assetImageUrl!,
      label: p.name,
      source: "pack_prop",
    });
  }
  const imagedPropNames = new Set(
    opts.props.filter((p) => p.assetImageUrl).map((p) => p.name.toLowerCase()),
  );
  for (const name of opts.namedPropRefs) {
    if (!imagedPropNames.has(name.toLowerCase())) {
      gaps.push(`No product reference image for "${name}".`);
    }
  }

  /* ── Style: the creator's brand-kit logo ───────────────────────────── */
  if (sources.brandLogoUrl) {
    push({
      role: "style",
      url: sources.brandLogoUrl,
      label: "Brand kit logo",
      source: "brand_kit",
    });
  }

  set.sort(
    (a, b) => REFERENCE_ROLE_PRIORITY[a.role] - REFERENCE_ROLE_PRIORITY[b.role],
  );
  return { referenceSet: set.slice(0, MAX_SCENE_REFERENCES), referenceGaps: gaps };
}
