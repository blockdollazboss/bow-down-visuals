import type { SceneData } from "@/lib/scene-parser";

/* ─────────────────────────────────────────────────────────────
   Video Editor settings model.

   All editor state is persisted nested inside a project's
   output_data.editorSettings (no DB migration). Per-clip edits are
   keyed by scene id so reordering/duplicating scenes never loses data.

   NOTE: transitions, effects, overlays, trims, captions and audio
   shaping are *edit-plan only* — they describe how the final render
   should look and are not burned into clips until final rendering is
   enabled. Scene reorder / duplicate / remove / approve are real and
   persist on the scenes array itself.
───────────────────────────────────────────────────────────── */

export type VideoFormat = "9:16" | "16:9" | "1:1";
export type Intensity = "low" | "medium" | "high";
export type ExportQuality = "draft" | "final";
export type ExportResolution = "720p" | "1080p";

export type AutoEditPresetId =
  | "drill"
  | "luxury"
  | "rnb"
  | "club"
  | "pain"
  | "kids";

export interface AutoEditPreset {
  id: AutoEditPresetId;
  name: string;
  tagline: string;
  description: string;
  /** Default pacing this preset leans toward. */
  defaultBeatCut: Intensity;
  defaultTransition: Intensity;
  /** Accent gradient classes for the preset card. */
  accent: string;
}

export const AUTO_EDIT_PRESETS: AutoEditPreset[] = [
  {
    id: "drill",
    name: "Drill / Street Cut",
    tagline: "Hard, fast, gritty",
    description:
      "Aggressive beat-synced hard cuts, cold color grade, handheld energy. Built for drill and street records.",
    defaultBeatCut: "high",
    defaultTransition: "high",
    accent: "from-slate-500/20 to-blue-500/10",
  },
  {
    id: "luxury",
    name: "Luxury Rap Visual",
    tagline: "Rich, smooth, expensive",
    description:
      "Slow-burn glides, warm gold grade, slow-mo flexes. Premium high-fashion feel for luxury rap.",
    defaultBeatCut: "medium",
    defaultTransition: "low",
    accent: "from-yellow-500/20 to-amber-600/10",
  },
  {
    id: "rnb",
    name: "R&B Dream Edit",
    tagline: "Soft, dreamy, intimate",
    description:
      "Crossfades, soft bloom, shallow depth. Gentle pacing that breathes with the vocal.",
    defaultBeatCut: "low",
    defaultTransition: "low",
    accent: "from-pink-500/20 to-purple-500/10",
  },
  {
    id: "club",
    name: "Club / Party Edit",
    tagline: "Loud, punchy, hype",
    description:
      "Flash cuts, zoom punches, strobe-style transitions locked to the drop. Maximum energy.",
    defaultBeatCut: "high",
    defaultTransition: "high",
    accent: "from-fuchsia-500/20 to-red-500/10",
  },
  {
    id: "pain",
    name: "Pain / Emotional Visual",
    tagline: "Raw, slow, cinematic",
    description:
      "Long holds, desaturated grade, minimal movement. Lets emotion sit in the frame.",
    defaultBeatCut: "low",
    defaultTransition: "low",
    accent: "from-zinc-500/20 to-slate-700/10",
  },
  {
    id: "kids",
    name: "Kids / Cartoon Edit",
    tagline: "Bright, fun, playful",
    description:
      "Bouncy cuts, vivid colors, pop transitions and big captions. Built for kids and cartoon music.",
    defaultBeatCut: "medium",
    defaultTransition: "medium",
    accent: "from-sky-400/20 to-emerald-400/10",
  },
];

export const VIDEO_FORMATS: { id: VideoFormat; label: string; note: string }[] = [
  { id: "9:16", label: "9:16", note: "TikTok · Reels · Shorts" },
  { id: "16:9", label: "16:9", note: "YouTube widescreen" },
  { id: "1:1", label: "1:1", note: "Square social post" },
];

export const CAPTION_STYLES = [
  "None",
  "Karaoke Highlight",
  "Bold Center",
  "Lower Third",
  "Minimal Top",
  "TikTok Auto",
] as const;

export const CAPTION_POSITIONS = ["Top", "Center", "Bottom"] as const;

export const TRANSITIONS = [
  "Hard Cut",
  "Crossfade",
  "Whip Pan",
  "Zoom Punch",
  "Glitch",
  "Flash",
  "Slide",
  "Fade to Black",
] as const;

export const EFFECTS = [
  "Film Grain",
  "VHS",
  "Light Leaks",
  "Chromatic Aberration",
  "Slow Motion",
  "Speed Ramp",
  "Black & White",
  "Warm Grade",
  "Cool Grade",
  "Camera Shake",
] as const;

export const OVERLAYS = [
  "Watermark",
  "Logo",
  "Date Stamp",
  "Lyrics",
  "Artist Name",
  "Social Handle",
] as const;

export const INTENSITIES: Intensity[] = ["low", "medium", "high"];

/** Per-clip edit data, keyed by scene id inside EditorSettings.clips. */
export interface ClipEdit {
  /** Seconds to trim from the start of the clip (edit-plan only). */
  trimStart: number;
  /** Seconds to trim from the end of the clip (edit-plan only). */
  trimEnd: number;
  muted: boolean;
  /** Clip audio volume 0–100 (edit-plan only). */
  volume: number;
  /** Transition INTO this clip. */
  transition: string;
  /** Visual effect applied to this clip. */
  effect: string;
  /** Optional replacement clip URL override (edit-plan only). */
  replaceUrl: string | null;
}

export interface CaptionSettings {
  enabled: boolean;
  style: string;
  position: string;
  /** Caption appears this many seconds into each clip. */
  timingOffset: number;
}

export interface AudioSettings {
  /** Where the song starts, in seconds. */
  startSec: number;
  volume: number;
  fadeIn: boolean;
  fadeOut: boolean;
}

export interface ExportSettings {
  format: VideoFormat;
  resolution: ExportResolution;
  quality: ExportQuality;
}

export interface AutoEditOptions {
  preset: AutoEditPresetId;
  format: VideoFormat;
  captionStyle: string;
  intro: boolean;
  outro: boolean;
  watermark: boolean;
  beatCutIntensity: Intensity;
  transitionIntensity: Intensity;
}

export interface AutoEditPlanClip {
  sceneId: string;
  order: number;
  label: string;
  transition: string;
  effect: string;
  captionTiming: string;
  durationSec: number;
}

export interface AutoEditPlan {
  template: string;
  format: VideoFormat;
  estimatedDuration: string;
  introText: string;
  outroText: string;
  clips: AutoEditPlanClip[];
  notes: string;
  /** True when generated by deterministic fallback rather than AI. */
  fallback?: boolean;
  generatedAt: string;
}

export interface EditorSettings {
  mode: "auto" | "manual";
  autoEdit: AutoEditOptions;
  autoEditPlan: AutoEditPlan | null;
  /** Per-clip edits keyed by scene id. */
  clips: Record<string, ClipEdit>;
  captions: CaptionSettings;
  effects: string[];
  overlays: string[];
  audio: AudioSettings;
  export: ExportSettings;
  updatedAt: string;
}

export function defaultClipEdit(): ClipEdit {
  return {
    trimStart: 0,
    trimEnd: 0,
    muted: false,
    volume: 100,
    transition: "Hard Cut",
    effect: "None",
    replaceUrl: null,
  };
}

export function defaultEditorSettings(): EditorSettings {
  return {
    mode: "auto",
    autoEdit: {
      preset: "drill",
      format: "9:16",
      captionStyle: "Karaoke Highlight",
      intro: true,
      outro: true,
      watermark: false,
      beatCutIntensity: "high",
      transitionIntensity: "medium",
    },
    autoEditPlan: null,
    clips: {},
    captions: {
      enabled: true,
      style: "Karaoke Highlight",
      position: "Bottom",
      timingOffset: 0,
    },
    effects: [],
    overlays: [],
    audio: { startSec: 0, volume: 100, fadeIn: true, fadeOut: true },
    export: { format: "9:16", resolution: "1080p", quality: "draft" },
    updatedAt: new Date().toISOString(),
  };
}

/** Merge a stored (possibly partial / legacy) settings object onto fresh defaults. */
export function normalizeEditorSettings(
  stored: Partial<EditorSettings> | null | undefined,
): EditorSettings {
  const base = defaultEditorSettings();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    autoEdit: { ...base.autoEdit, ...(stored.autoEdit ?? {}) },
    autoEditPlan: stored.autoEditPlan ?? null,
    clips: stored.clips ?? {},
    captions: { ...base.captions, ...(stored.captions ?? {}) },
    effects: stored.effects ?? [],
    overlays: stored.overlays ?? [],
    audio: { ...base.audio, ...(stored.audio ?? {}) },
    export: { ...base.export, ...(stored.export ?? {}) },
  };
}

/** Read a clip's edit data, falling back to defaults. */
export function getClipEdit(settings: EditorSettings, sceneId: string): ClipEdit {
  return { ...defaultClipEdit(), ...(settings.clips[sceneId] ?? {}) };
}

/** A scene has a usable clip when it has an http(s) demo clip URL. */
export function sceneHasClip(scene: SceneData): boolean {
  return !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
}
