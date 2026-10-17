/**
 * avatar-vault.ts — the stream avatar meets the Creative Vault.
 *
 * The avatar a creator goes live as can BE one of their vault
 * characters: the scene's AvatarSettings carry the character's vault
 * id (`vaultId`), and the character's portrait is resolved from its
 * vault row into the ordinary uploaded-picture settings — so the
 * existing picture rig (avatar-rigs' drawUploadedAvatar: bob,
 * breathe, blink, talk bounce) performs it with no second rig, and
 * the name the studio shows comes from the row.
 *
 * Resolution happens at pick time (SourcesPanel) and again at studio
 * load (BroadcastStudio): if the portrait was edited in the vault,
 * the stream picks up the new portrait; if the row has vanished, the
 * last resolved picture stays as the honest fallback rather than
 * blanking the character mid-setup.
 *
 * The vault list itself is the same read the studio picker and the
 * World use (GET /api/artist-vaults, shaped by lib/world/characters)
 * — one roster everywhere. And the id carried here is the same uuid
 * the World's character-voice resolver takes, so the stream's voice
 * layer can key the character's shaping profile off `vaultId` in a
 * later lane; voice conversion is deliberately not built here.
 */

import type { VaultCharacter } from "../world/characters";
import type { AvatarSettings, Scene, SceneSource } from "./scenes";

export type { VaultCharacter };

/**
 * Go live as this vault character: link the id, take the name from
 * the row, and resolve its current portrait into the uploaded-
 * picture rig. Drive and sensitivity are the performer's settings,
 * not the character's — they carry over untouched.
 */
export function applyVaultCharacter(
  settings: AvatarSettings,
  character: VaultCharacter,
): AvatarSettings {
  return {
    ...settings,
    character: "upload",
    imageUrl: character.portraitUrl ?? settings.imageUrl,
    vaultId: character.id,
    vaultName: character.name,
  };
}

/**
 * Break the vault link (the performer picked a stock character or
 * supplied their own picture by hand): the avatar goes back to being
 * just its settings. Everything else is preserved.
 */
export function unlinkVaultCharacter(settings: AvatarSettings): AvatarSettings {
  if (!settings.vaultId && !settings.vaultName) return settings;
  const next = { ...settings };
  delete next.vaultId;
  delete next.vaultName;
  return next;
}

/**
 * Re-resolve a linked avatar against the live vault roster. Returns
 * the settings to store when the row's portrait or name has moved
 * on, and null when nothing changed — or when the row is gone, in
 * which case the last resolved picture stays as the fallback.
 */
export function refreshVaultAvatarSettings(
  settings: AvatarSettings,
  characters: VaultCharacter[],
): AvatarSettings | null {
  if (!settings.vaultId) return null;
  const row = characters.find((c) => c.id === settings.vaultId);
  if (!row) return null;
  const imageUrl = row.portraitUrl ?? settings.imageUrl;
  if (imageUrl === settings.imageUrl && row.name === settings.vaultName && settings.character === "upload") {
    return null;
  }
  return {
    ...settings,
    character: "upload",
    imageUrl,
    vaultName: row.name,
  };
}

/** The stage surface the studio-load refresh needs (Stage satisfies it). */
export interface VaultAvatarStageLike {
  scenes: Scene[];
  updateSource(sceneId: string, sourceId: string, patch: Partial<SceneSource>): void;
}

/**
 * Studio load: re-resolve every vault-linked avatar in every scene
 * against the live roster, so a portrait edited in the vault since
 * the scene was built reaches the stream. Returns how many sources
 * were refreshed.
 */
export function refreshStageVaultAvatars(
  stage: VaultAvatarStageLike,
  characters: VaultCharacter[],
): number {
  let refreshed = 0;
  for (const scene of stage.scenes) {
    for (const source of scene.sources) {
      if (source.type !== "avatar" || !source.avatar?.vaultId) continue;
      const next = refreshVaultAvatarSettings(source.avatar, characters);
      if (next) {
        stage.updateSource(scene.id, source.id, { avatar: next });
        refreshed += 1;
      }
    }
  }
  return refreshed;
}
