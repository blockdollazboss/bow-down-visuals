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

export type CaptionMode = "auto" | "manual" | "hook" | "best-bar" | "none";
export type CaptionStylePreset = "clean-white" | "drill" | "luxury" | "rnb" | "kids";

export interface CaptionLine {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

export const CAPTION_MODE_DEFS: { id: CaptionMode; label: string; description: string }[] = [
  { id: "auto",     label: "Auto from Lyrics", description: "Split pasted lyrics into timed caption lines" },
  { id: "manual",   label: "Manual Captions",  description: "Add rows with custom timing and text" },
  { id: "hook",     label: "Hook Only",         description: "Show hook / chorus text as a caption" },
  { id: "best-bar", label: "Best Bar",          description: "Burn one standout bar as a text overlay" },
  { id: "none",     label: "No Captions",       description: "Export without any text overlay" },
];

export const CAPTION_STYLE_PRESET_DEFS: {
  id: CaptionStylePreset; name: string; description: string; accent: string;
}[] = [
  { id: "clean-white", name: "Clean White", description: "Bold white · black shadow · bottom center", accent: "from-white/10 to-white/5 border-white/20" },
  { id: "drill",       name: "Drill",       description: "Uppercase · white · red/purple outline", accent: "from-red-500/20 to-purple-500/10 border-red-500/30" },
  { id: "luxury",      name: "Luxury",      description: "Gold text · elegant shadow · cinematic", accent: "from-yellow-500/20 to-amber-600/10 border-yellow-500/30" },
  { id: "rnb",         name: "R&B",         description: "Soft white · smooth shadow · romantic", accent: "from-pink-500/20 to-purple-500/10 border-pink-500/20" },
  { id: "kids",        name: "Kids",        description: "Big bright text · playful · clean", accent: "from-sky-400/20 to-emerald-400/10 border-sky-400/30" },
];

export const TRANSITIONS = [
  "Cut",
  "Crossfade",
  "Flash",
  "Glitch",
  "Whip Pan",
  "Zoom",
  "Light Leak",
  "Fade to Black",
  "Slide",
  "Spin",
] as const;

export const EFFECTS = [
  "Film Grain",
  "Glow",
  "Blur",
  "Sharpen",
  "Vignette",
  "Black & White",
  "Neon Glow",
  "VHS",
  "Cinematic Bars",
  "Camera Shake",
  "Slow Zoom",
  "Speed Ramp",
] as const;

/** Color-grade presets (a subset of the Effects catalog applied as a look). */
export const COLOR_GRADES = [
  "Warm Grade",
  "Cool Grade",
  "Teal & Orange",
  "Moody Desaturated",
  "Vibrant Pop",
] as const;

export const OVERLAYS = [
  "Smoke",
  "Rain",
  "Sparks",
  "Lens Flare",
  "Dust",
  "Light Leaks",
  "Animated Waveform",
  "Logo / Watermark",
] as const;

export const CAPTION_FONT_SIZES = ["Small", "Medium", "Large", "XL"] as const;

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
  /** Caption workflow mode. */
  mode: CaptionMode;
  /** Visual style preset. */
  stylePreset: CaptionStylePreset;
  position: string;
  /** Font size preset, see CAPTION_FONT_SIZES. */
  fontSize: string;
  /** Hex colour string, e.g. "#ffffff". */
  textColor: string;
  outline: boolean;
  background: boolean;
  showArtistName: boolean;
  showSongTitle: boolean;
  /** Artist name to burn when showArtistName is true. */
  artistNameText: string;
  /** Song title to burn when showSongTitle is true. */
  songTitleText: string;
  /** Raw pasted lyrics for auto-caption generation. */
  lyricsText: string;
  /** Single hook text for "hook" mode. */
  hookText: string;
  /** Single best-bar text for "best-bar" mode. */
  bestBarText: string;
  /** Timed caption lines (populated by generate / manual entry). */
  lines: CaptionLine[];
  /** Legacy fields kept for backward compat. */
  style: string;
  titleText: string;
  lyricText: string;
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
  watermark: boolean;
  customWatermarkUrl?: string | null;
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

/* ─────────────────────────────────────────────────────────────
   Music Studio (in-editor DAW) model.

   Lives nested inside EditorSettings.musicStudio and persists in the
   same project output_data.editorSettings blob (no DB migration).

   Two workflows:
   • AI Auto Mix & Master — pick a preset + a few sliders, generate a
     structured mix plan (rendering "coming soon").
   • Manual DAW — upload stems and shape mute/solo/volume/pan/trim per
     track plus a global master chain.

   Mixing/mastering shaping is *plan only* — it describes how the final
   render should sound and is not baked into audio until rendering is
   enabled. Stem uploads themselves are real and persist.
───────────────────────────────────────────────────────────── */

export type LoudnessTarget = "demo" | "streaming" | "loud";
export type ReverbAmount = "none" | "light" | "medium" | "heavy";
export type AutotuneStyle = "off" | "light" | "modern" | "heavy";
export type EqTone = "dark" | "balanced" | "bright";
export type FxLevel = "off" | "low" | "medium" | "high";

export type MixPresetId = "radio" | "drill" | "rnb" | "club" | "pain" | "kids";

export interface MixPreset {
  id: MixPresetId;
  name: string;
  tagline: string;
  description: string;
  accent: string;
}

export const MIX_PRESETS: MixPreset[] = [
  {
    id: "radio",
    name: "Radio Ready Hip-Hop",
    tagline: "Punchy, clean, balanced",
    description:
      "Loud clear vocals over a tight beat with controlled low end. The safe pro sound for most rap records.",
    accent: "from-yellow-500/20 to-amber-600/10",
  },
  {
    id: "drill",
    name: "Drill / Street",
    tagline: "Dark, gritty, hard",
    description:
      "Aggressive vocals, heavy sliding 808s and a cold, raw master. Built for drill and street records.",
    accent: "from-slate-500/20 to-blue-500/10",
  },
  {
    id: "rnb",
    name: "R&B Smooth",
    tagline: "Warm, lush, intimate",
    description:
      "Silky vocals with rich reverb, smooth compression and a gentle master. Lets the vocal breathe.",
    accent: "from-pink-500/20 to-purple-500/10",
  },
  {
    id: "club",
    name: "Club Loud",
    tagline: "Huge, hyped, maximum",
    description:
      "Maximum loudness, big bass and wide stereo for a system-shaking party master.",
    accent: "from-fuchsia-500/20 to-red-500/10",
  },
  {
    id: "pain",
    name: "Pain / Emotional",
    tagline: "Raw, open, honest",
    description:
      "Up-front emotional vocals, light beat and dynamic master so feeling sits forward in the mix.",
    accent: "from-zinc-500/20 to-slate-700/10",
  },
  {
    id: "kids",
    name: "Kids Clean",
    tagline: "Bright, friendly, safe",
    description:
      "Bright clear vocals, gentle loudness and a clean, family-friendly balance for kids music.",
    accent: "from-sky-400/20 to-emerald-400/10",
  },
];

export const STEM_TYPES = [
  "Lead Vocals",
  "Background Vocals",
  "Ad-libs",
  "Beat / Instrumental",
  "Drums",
  "808 / Bass",
  "Melody",
  "Piano / Keys",
  "Guitar",
  "FX / Risers",
  "Full Song Mix",
  "Other Stem",
] as const;

export const STEM_EQ_PRESETS = [
  "Off",
  "Warm",
  "Bright",
  "Radio",
  "Telephone",
  "Boomy Cut",
  "Air Boost",
] as const;

export const REVERB_AMOUNTS: ReverbAmount[] = ["none", "light", "medium", "heavy"];
export const AUTOTUNE_STYLES: AutotuneStyle[] = ["off", "light", "modern", "heavy"];
export const FX_LEVELS: FxLevel[] = ["off", "low", "medium", "high"];
export const EQ_TONES: EqTone[] = ["dark", "balanced", "bright"];

export const LOUDNESS_TARGETS: { id: LoudnessTarget; label: string; note: string }[] = [
  { id: "demo", label: "Demo", note: "Quiet, dynamic" },
  { id: "streaming", label: "Streaming", note: "Spotify / Apple level" },
  { id: "loud", label: "Loud", note: "Max club loudness" },
];

/** Accepted stem upload audio formats. */
export const STEM_ACCEPT = ".wav,.mp3,.m4a,.flac,audio/*";
export const STEM_MAX_MB = 50;

export const AUDIO_EXPORT_FORMATS = [
  "Full Mix WAV",
  "Full Mix MP3",
  "Instrumental",
  "Acapella",
  "Clean Version",
  "Performance Mix",
  "Music Video Audio Mix",
] as const;

export interface StemEffects {
  /** EQ tone preset, see STEM_EQ_PRESETS. */
  eq: string;
  autotune: AutotuneStyle;
  reverb: ReverbAmount;
  delay: ReverbAmount;
  compression: FxLevel;
  saturation: FxLevel;
  deEsser: boolean;
  noiseReduction: boolean;
}

export interface AudioStem {
  id: string;
  /** User-facing track name. */
  name: string;
  /** Stem category, see STEM_TYPES. */
  type: string;
  /** Public URL of the uploaded file. */
  url: string;
  /** Storage path within the bucket (used for deletion). */
  storagePath: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  /** Track length in seconds, captured at upload time when the browser can decode it. */
  durationSec?: number;
  /* mixer state */
  muted: boolean;
  solo: boolean;
  locked: boolean;
  /** 0–100. */
  volume: number;
  /** -100 (L) … 100 (R). */
  pan: number;
  /** Seconds trimmed off the start (plan only). */
  trimStart: number;
  /** Seconds trimmed off the end (plan only). */
  trimEnd: number;
  /** Alignment offset on the timeline, in seconds (plan only). */
  startTime: number;
  effects: StemEffects;
}

export interface AiMixOptions {
  preset: MixPresetId;
  vocalLoudness: Intensity;
  beatLoudness: Intensity;
  bassStrength: Intensity;
  vocalClarity: Intensity;
  reverbAmount: ReverbAmount;
  autotuneStyle: AutotuneStyle;
  masterLoudness: LoudnessTarget;
  /** Strip profanity / keep it family-safe in the plan. */
  cleanRadioMode: boolean;
}

export interface AiMixPlan {
  preset: string;
  summary: string;
  stemLevels: { name: string; level: string }[];
  vocalChain: string[];
  beatChain: string[];
  masterChain: string[];
  loudnessTarget: string;
  exportRecommendation: string;
  notes: string;
  /** True when generated by deterministic fallback rather than AI. */
  fallback?: boolean;
  generatedAt: string;
}

export interface MasterSettings {
  /** 0–100. */
  volume: number;
  limiter: boolean;
  /** Bus compression amount 0–100. */
  compression: number;
  eqTone: EqTone;
  /** 0–100 stereo width. */
  stereoWidth: number;
  /** 0–100 low-end boost. */
  bassBoost: number;
  loudnessTarget: LoudnessTarget;
  fadeIn: boolean;
  fadeOut: boolean;
}

export type VideoAudioSource = "uploaded" | "full-mix" | "instrumental" | "acapella" | "none";

export interface VideoAudioSync {
  /** Which audio plays under the video clips. */
  source: VideoAudioSource;
  startSec: number;
  fadeIn: boolean;
  fadeOut: boolean;
  /** Loop audio if it is shorter than the total video duration. */
  loopAudio: boolean;
  /** Trim/loop the audio to match the video length. */
  matchVideoLength: boolean;
}

export type AudioExportKind = "full" | "instrumental" | "acapella";

export interface AudioExportRecord {
  id: string;
  /** Button label, e.g. "Export Full Mix MP3". */
  label: string;
  kind: AudioExportKind;
  /** Public URL of the rendered audio file. */
  url: string;
  format: "mp3" | "wav";
  /** Names of the stems included in this render. */
  stemsUsed: string[];
  /** Snapshot of the mix settings used for this export. */
  mixSettings: {
    masterVolume: number;
    stems: { name: string; volume: number; muted: boolean }[];
  };
  createdAt: string;
}

export interface MusicStudioSettings {
  mode: "auto" | "manual";
  stems: AudioStem[];
  aiMix: AiMixOptions;
  aiMixPlan: AiMixPlan | null;
  master: MasterSettings;
  videoAudio: VideoAudioSync;
  /** Chosen audio export deliverables, see AUDIO_EXPORT_FORMATS. */
  exportSelections: string[];
  /** Rendered audio exports (Audio Export Beta), newest first. */
  exports: AudioExportRecord[];
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
  musicStudio: MusicStudioSettings;
  updatedAt: string;
}

export function defaultClipEdit(): ClipEdit {
  return {
    trimStart: 0,
    trimEnd: 0,
    muted: false,
    volume: 100,
    transition: "Cut",
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
      mode: "none",
      stylePreset: "clean-white",
      position: "Bottom",
      fontSize: "Medium",
      textColor: "#ffffff",
      outline: true,
      background: false,
      showArtistName: false,
      showSongTitle: false,
      artistNameText: "",
      songTitleText: "",
      lyricsText: "",
      hookText: "",
      bestBarText: "",
      lines: [],
      style: "Karaoke Highlight",
      titleText: "",
      lyricText: "",
      timingOffset: 0,
    },
    effects: [],
    overlays: [],
    audio: { startSec: 0, volume: 100, fadeIn: true, fadeOut: true },
    export: { format: "9:16", resolution: "1080p", quality: "draft", watermark: true, customWatermarkUrl: null },
    musicStudio: defaultMusicStudioSettings(),
    updatedAt: new Date().toISOString(),
  };
}

export function defaultStemEffects(): StemEffects {
  return {
    eq: "Off",
    autotune: "off",
    reverb: "none",
    delay: "none",
    compression: "off",
    saturation: "off",
    deEsser: false,
    noiseReduction: false,
  };
}

export function defaultMusicStudioSettings(): MusicStudioSettings {
  return {
    mode: "auto",
    stems: [],
    aiMix: {
      preset: "radio",
      vocalLoudness: "medium",
      beatLoudness: "medium",
      bassStrength: "medium",
      vocalClarity: "medium",
      reverbAmount: "light",
      autotuneStyle: "light",
      masterLoudness: "streaming",
      cleanRadioMode: false,
    },
    aiMixPlan: null,
    master: {
      volume: 100,
      limiter: true,
      compression: 40,
      eqTone: "balanced",
      stereoWidth: 50,
      bassBoost: 30,
      loudnessTarget: "streaming",
      fadeIn: false,
      fadeOut: true,
    },
    videoAudio: {
      source: "uploaded",
      startSec: 0,
      fadeIn: true,
      fadeOut: true,
      loopAudio: false,
      matchVideoLength: true,
    },
    exportSelections: [],
    exports: [],
  };
}

type StemRole = "lead" | "backing" | "adlib" | "beat" | "bass" | "drums" | "hats" | "melody" | "other";

function classifyStem(stem: AudioStem): StemRole {
  const t = `${stem.type} ${stem.name}`.toLowerCase();
  if (/ad[- ]?lib/.test(t)) return "adlib";
  if (/back|harmon|bgv/.test(t)) return "backing";
  if (/lead|vocal|vox|verse|hook|rap/.test(t)) return "lead";
  if (/808|bass|sub/.test(t)) return "bass";
  if (/hi[- ]?hat|hat/.test(t)) return "hats";
  if (/drum|perc|kick|snare/.test(t)) return "drums";
  if (/beat|instrument|full song/.test(t)) return "beat";
  if (/melod|synth|key|piano|guitar|string|pad/.test(t)) return "melody";
  return "other";
}

const INTENSITY_VOL: Record<Intensity, number> = { low: 72, medium: 86, high: 100 };

/**
 * Derive preview volume + pan per stem from the AI mix options. Deterministic
 * (no network) so "Apply AI Mix Settings" is instant and repeatable. These are
 * preview values only — not final rendered mastering.
 */
export function suggestMixSettings(
  stems: AudioStem[],
  aiMix: AiMixOptions,
): Record<string, { volume: number; pan: number }> {
  const vocal = INTENSITY_VOL[aiMix.vocalLoudness];
  const beat = INTENSITY_VOL[aiMix.beatLoudness];
  const bass = INTENSITY_VOL[aiMix.bassStrength];
  const clampVol = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const out: Record<string, { volume: number; pan: number }> = {};

  let adlibIdx = 0;
  let backIdx = 0;
  for (const stem of stems) {
    const role = classifyStem(stem);
    let volume = 86;
    let pan = 0;
    switch (role) {
      case "lead":
        volume = vocal;
        break;
      case "backing":
        volume = vocal - 16;
        pan = backIdx % 2 === 0 ? -28 : 28;
        backIdx += 1;
        break;
      case "adlib":
        volume = vocal - 22;
        pan = adlibIdx % 2 === 0 ? 35 : -35;
        adlibIdx += 1;
        break;
      case "beat":
        volume = beat;
        break;
      case "bass":
        volume = bass;
        break;
      case "drums":
        volume = beat - 6;
        break;
      case "hats":
        volume = beat - 10;
        pan = 12;
        break;
      case "melody":
        volume = beat - 8;
        pan = -15;
        break;
      default:
        volume = 86;
    }
    out[stem.id] = { volume: clampVol(volume), pan };
  }
  return out;
}

/** Apply AI-suggested preview volume/pan onto stems (locked stems untouched). */
export function applyAiMixToStems(stems: AudioStem[], aiMix: AiMixOptions): AudioStem[] {
  const suggestion = suggestMixSettings(stems, aiMix);
  return stems.map((s) => {
    const next = suggestion[s.id];
    if (!next || s.locked) return s;
    return { ...s, volume: next.volume, pan: next.pan };
  });
}

/** Normalize a stored stem onto fresh defaults (backward-compat). */
export function normalizeStem(s: Partial<AudioStem>): AudioStem {
  return {
    id: s.id ?? `stem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: s.name ?? "Stem",
    type: s.type ?? "Other Stem",
    url: s.url ?? "",
    storagePath: s.storagePath ?? "",
    fileType: s.fileType ?? "",
    fileSize: s.fileSize ?? 0,
    uploadedAt: s.uploadedAt ?? new Date().toISOString(),
    ...(s.durationSec != null ? { durationSec: s.durationSec } : {}),
    muted: s.muted ?? false,
    solo: s.solo ?? false,
    locked: s.locked ?? false,
    volume: s.volume ?? 100,
    pan: s.pan ?? 0,
    trimStart: s.trimStart ?? 0,
    trimEnd: s.trimEnd ?? 0,
    startTime: s.startTime ?? 0,
    effects: { ...defaultStemEffects(), ...(s.effects ?? {}) },
  };
}

function normalizeVideoAudioSource(raw: unknown): VideoAudioSource {
  if (raw === "finalMix") return "full-mix"; // backward-compat: old name
  if (raw === "uploaded" || raw === "full-mix" || raw === "instrumental" || raw === "acapella" || raw === "none") {
    return raw;
  }
  return "uploaded";
}

export function normalizeMusicStudio(
  stored: Partial<MusicStudioSettings> | null | undefined,
): MusicStudioSettings {
  const base = defaultMusicStudioSettings();
  if (!stored) return base;
  const storedVideoAudio = stored.videoAudio ?? {};
  return {
    ...base,
    ...stored,
    stems: Array.isArray(stored.stems) ? stored.stems.map(normalizeStem) : [],
    aiMix: { ...base.aiMix, ...(stored.aiMix ?? {}) },
    aiMixPlan: stored.aiMixPlan ?? null,
    master: { ...base.master, ...(stored.master ?? {}) },
    videoAudio: {
      ...base.videoAudio,
      ...storedVideoAudio,
      source: normalizeVideoAudioSource((storedVideoAudio as Partial<VideoAudioSync>).source),
    },
    exportSelections: Array.isArray(stored.exportSelections) ? stored.exportSelections : [],
    exports: Array.isArray(stored.exports) ? stored.exports : [],
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
    musicStudio: normalizeMusicStudio(stored.musicStudio),
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
