/**
 * spotlight.ts — the studio picker's spotlight ordering.
 *
 * "Who's In Front of the Camera" shows the creator's whole Creative
 * Vault: the top three rows get the featured spotlight treatment and
 * EVERY other character stands in the grid below — nobody is capped
 * out of the studio for having more than ten characters.
 */

import type { ArtistVault } from "@/components/ArtistVaultSelector";

/** Spotlight order wins (the creator's drag-arranged order), then
 *  most recently created first. */
export function sortSpotlightVaults(vaults: ArtistVault[]): ArtistVault[] {
  return [...vaults].sort((a, b) => {
    const ao = a.spotlight_order ?? 0;
    const bo = b.spotlight_order ?? 0;
    if (ao !== bo) return ao - bo;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export interface SpotlightSplit {
  /** The first three rows — the featured spotlight slots. */
  featured: ArtistVault[];
  /** Everyone else, in spotlight order — the full remaining roster. */
  remaining: ArtistVault[];
}

export function splitSpotlightVaults(sortedVaults: ArtistVault[]): SpotlightSplit {
  return {
    featured: sortedVaults.slice(0, 3),
    remaining: sortedVaults.slice(3),
  };
}
