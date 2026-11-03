/* ── Lip Sync Starter Presets ────────────────────────────────────────────
   Starter presets for the editor's Lip Sync studio (LipSyncSection).

   Before this registry the surface was blank-slate only: every creator
   opened Lip Sync to the same defaults and had to work out the strength
   and audio-source dials from nothing (org/design audit 2026-11-02 §2c —
   zero presets/templates/style lists anywhere for lip sync).

   A preset is ONLY a prefill. It sets exactly the fields listed in its
   `settings` — every one of them a field the existing Lip Sync form
   already exposes (see LipSyncSettings in lib/editor-settings.ts and the
   controls in LipSyncSection.tsx):
     - enabled               the form's "Enable Lip Sync" toggle
     - strength              the form's Strength segmented control
     - preserveFaceIdentity  the form's "Preserve Face Identity" toggle
     - preserveArtistLook    the form's "Preserve Artist Look" toggle
     - audioSource           the form's Audio Source segmented control

   A preset NEVER:
     - charges anything (picking one is a local settings change only —
       lip sync generation keeps charging on its existing rail, at its
       existing price, only when the creator submits a job);
     - submits a job, calls an API, or touches credits;
     - picks a scene (selectedSceneId is the creator's own choice) or
       invents an uploaded vocal stem (uploadedVocalStemUrl);
     - turns the preserve toggles off — the form itself labels both
       "Always on", so every starter keeps them on.

   Labels are honest by construction: each preset's `description` states
   the exact settings it applies, and the picker card renders a summary
   built from those same settings (lipSyncPresetSummary), so a preset can
   never claim more than its prefill actually sets.
------------------------------------------------------------------------ */

import type { EditorSettings, LipSyncStrength } from "./editor-settings";

/** The slice of LipSyncSettings a starter preset is allowed to prefill. */
export interface LipSyncPresetSettings {
  enabled: true;
  strength: LipSyncStrength;
  preserveFaceIdentity: true;
  preserveArtistLook: true;
  audioSource: "vocals" | "full";
}

export type LipSyncPresetId =
  | "soft-close-up"
  | "natural-performance"
  | "big-performance"
  | "gentle-full-mix"
  | "everyday-full-mix"
  | "bold-full-mix";

export interface LipSyncPreset {
  id: LipSyncPresetId;
  /** Starter name — a suggested use, never an outcome promise. */
  name: string;
  /** Who the starter is aimed at, in plain words. */
  tagline: string;
  /** What the starter actually sets — mirrors `settings` exactly. */
  description: string;
  settings: LipSyncPresetSettings;
}

export const LIP_SYNC_PRESETS: LipSyncPreset[] = [
  {
    id: "soft-close-up",
    name: "Soft Close-Up",
    tagline: "For quiet, close-up takes",
    description:
      "Sets strength to Low and audio to Vocals Only, with face identity and artist look preserved.",
    settings: {
      enabled: true,
      strength: "low",
      preserveFaceIdentity: true,
      preserveArtistLook: true,
      audioSource: "vocals",
    },
  },
  {
    id: "natural-performance",
    name: "Natural Performance",
    tagline: "The balanced everyday start",
    description:
      "Sets strength to Medium and audio to Vocals Only, with face identity and artist look preserved.",
    settings: {
      enabled: true,
      strength: "medium",
      preserveFaceIdentity: true,
      preserveArtistLook: true,
      audioSource: "vocals",
    },
  },
  {
    id: "big-performance",
    name: "Big Performance",
    tagline: "For high-energy performance clips",
    description:
      "Sets strength to High and audio to Vocals Only, with face identity and artist look preserved.",
    settings: {
      enabled: true,
      strength: "high",
      preserveFaceIdentity: true,
      preserveArtistLook: true,
      audioSource: "vocals",
    },
  },
  {
    id: "gentle-full-mix",
    name: "Gentle Full Mix",
    tagline: "For quiet takes when you only have the full song",
    description:
      "Sets strength to Low and audio to Full Mix, with face identity and artist look preserved.",
    settings: {
      enabled: true,
      strength: "low",
      preserveFaceIdentity: true,
      preserveArtistLook: true,
      audioSource: "full",
    },
  },
  {
    id: "everyday-full-mix",
    name: "Everyday Full Mix",
    tagline: "The balanced start when you only have the full song",
    description:
      "Sets strength to Medium and audio to Full Mix, with face identity and artist look preserved.",
    settings: {
      enabled: true,
      strength: "medium",
      preserveFaceIdentity: true,
      preserveArtistLook: true,
      audioSource: "full",
    },
  },
  {
    id: "bold-full-mix",
    name: "Bold Full Mix",
    tagline: "For high-energy clips when you only have the full song",
    description:
      "Sets strength to High and audio to Full Mix, with face identity and artist look preserved.",
    settings: {
      enabled: true,
      strength: "high",
      preserveFaceIdentity: true,
      preserveArtistLook: true,
      audioSource: "full",
    },
  },
];

export function getLipSyncPreset(id: string): LipSyncPreset | null {
  return LIP_SYNC_PRESETS.find((p) => p.id === id) ?? null;
}

/** Display labels for the two dials a preset sets — the same words the
 *  form's own controls use. */
export const LIP_SYNC_STRENGTH_LABELS: Record<LipSyncStrength, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const LIP_SYNC_AUDIO_SOURCE_LABELS: Record<
  LipSyncPresetSettings["audioSource"],
  string
> = {
  vocals: "Vocals Only",
  full: "Full Mix",
};

/**
 * One-line summary of exactly what a preset sets, built from its settings
 * (never hand-written per preset), e.g.
 * "Strength: Medium · Audio: Vocals Only · Face & look preserved".
 * The picker renders this so the label always matches the prefill.
 */
export function lipSyncPresetSummary(preset: LipSyncPreset): string {
  const { strength, audioSource } = preset.settings;
  return [
    `Strength: ${LIP_SYNC_STRENGTH_LABELS[strength]}`,
    `Audio: ${LIP_SYNC_AUDIO_SOURCE_LABELS[audioSource]}`,
    "Face & look preserved",
  ].join(" · ");
}

/** True when the current lip-sync settings are exactly a preset's prefill. */
export function lipSyncSettingsMatchPreset(
  lipSync: EditorSettings["lipSync"],
  preset: LipSyncPreset,
): boolean {
  return (
    lipSync.enabled === preset.settings.enabled &&
    lipSync.strength === preset.settings.strength &&
    lipSync.preserveFaceIdentity === preset.settings.preserveFaceIdentity &&
    lipSync.preserveArtistLook === preset.settings.preserveArtistLook &&
    lipSync.audioSource === preset.settings.audioSource
  );
}

/** The preset the current settings match, or null when they are custom. */
export function activeLipSyncPreset(
  settings: EditorSettings,
): LipSyncPreset | null {
  return (
    LIP_SYNC_PRESETS.find((p) =>
      lipSyncSettingsMatchPreset(settings.lipSync, p),
    ) ?? null
  );
}

/**
 * Apply a starter preset: a pure settings change. Returns a new
 * EditorSettings with only the preset's lip-sync fields set — the
 * creator's selected scene and uploaded vocal stem are preserved, no
 * other settings are touched, and nothing is submitted or charged.
 * This is the exact function the LipSyncSection picker calls.
 */
export function applyLipSyncPreset(
  settings: EditorSettings,
  preset: LipSyncPreset,
): EditorSettings {
  return {
    ...settings,
    lipSync: { ...settings.lipSync, ...preset.settings },
  };
}
