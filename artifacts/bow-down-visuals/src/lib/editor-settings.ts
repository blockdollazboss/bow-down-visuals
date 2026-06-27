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

export type VideoFormat = "9:16" | "16:9" | "1:1" | "4:5";
export type FitMode    = "fill" | "fit" | "blur";
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
  { id: "9:16", label: "9:16",  note: "TikTok · Reels · Shorts" },
  { id: "16:9", label: "16:9",  note: "YouTube · Landscape" },
  { id: "1:1",  label: "1:1",   note: "Square social post" },
  { id: "4:5",  label: "4:5",   note: "Instagram Portrait" },
];

export const FORMAT_PRESET_LABELS: Record<VideoFormat, { name: string; dims: string }> = {
  "9:16": { name: "TikTok / Reels / Shorts",  dims: "1080×1920" },
  "16:9": { name: "YouTube / Landscape",       dims: "1920×1080" },
  "1:1":  { name: "Square",                    dims: "1080×1080" },
  "4:5":  { name: "Instagram Portrait",        dims: "1080×1350" },
};

/** CSS aspect-ratio value for the player container. */
export function formatAspectCss(fmt: VideoFormat): string {
  const map: Record<VideoFormat, string> = { "9:16": "9/16", "16:9": "16/9", "1:1": "1/1", "4:5": "4/5" };
  return map[fmt] ?? "9/16";
}

/** Export pixel dimensions for a format. */
export function formatDimensions(fmt: VideoFormat): [number, number] {
  const map: Record<VideoFormat, [number, number]> = {
    "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350],
  };
  return map[fmt] ?? [1080, 1920];
}

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
export type CaptionStylePreset =
  | "clean-white"
  | "gold-hiphop"
  | "karaoke"
  | "boxed"
  | "viral-shorts"
  | "minimal";

export type CaptionAnimation = "none" | "fade" | "pop" | "bounce" | "slide-up";

export const CAPTION_ANIMATIONS: { id: CaptionAnimation; label: string }[] = [
  { id: "none",     label: "None"     },
  { id: "fade",     label: "Fade"     },
  { id: "pop",      label: "Pop"      },
  { id: "bounce",   label: "Bounce"   },
  { id: "slide-up", label: "Slide Up" },
];

export type CaptionSplitStyle = "short" | "medium" | "long";

export interface CaptionLine {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  /** Set by AI Sync — confidence of the vocal match. */
  confidence?: "high" | "medium" | "low" | "needs-review";
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
  { id: "clean-white",   name: "Clean White",    description: "Bold white · black outline · light shadow",          accent: "from-white/10 to-white/5 border-white/20" },
  { id: "gold-hiphop",   name: "Gold Hip-Hop",   description: "Gold/yellow text · black outline · strong shadow",   accent: "from-yellow-500/20 to-amber-600/10 border-yellow-500/30" },
  { id: "karaoke",       name: "Karaoke",        description: "White text · gold underline highlight",              accent: "from-yellow-400/10 to-white/5 border-yellow-400/20" },
  { id: "boxed",         name: "Boxed",          description: "White text · semi-transparent black box",            accent: "from-white/10 to-black/20 border-white/15" },
  { id: "viral-shorts",  name: "Viral Shorts",   description: "Large bold uppercase · thick outline · center-bottom", accent: "from-red-500/20 to-pink-500/10 border-red-500/30" },
  { id: "minimal",       name: "Minimal",        description: "Small clean white · soft shadow · bottom",           accent: "from-white/5 to-white/0 border-white/10" },
];

/* ── AI Edit types ───────────────────────────────────── */

export type AiEditStylePreset =
  | "viral-tiktok"
  | "luxury-hiphop"
  | "dark-drill"
  | "clean-music-video"
  | "high-energy-promo"
  | "cinematic-story"
  | "street-performance"
  | "gold-luxury-brand";

export const AI_EDIT_STYLE_DEFS: {
  id: AiEditStylePreset; name: string; description: string; accent: string;
}[] = [
  { id: "viral-tiktok",       name: "Viral TikTok / Reels",  description: "Fast cuts · trending effects · bold captions",     accent: "from-red-500/20 to-pink-500/10 border-red-500/30" },
  { id: "luxury-hiphop",      name: "Luxury Hip-Hop",        description: "Smooth glides · warm gold grade · premium feel",   accent: "from-yellow-500/20 to-amber-600/10 border-yellow-500/30" },
  { id: "dark-drill",         name: "Dark Drill Video",       description: "Hard cuts · cold grade · raw street energy",       accent: "from-slate-500/20 to-blue-900/20 border-slate-400/20" },
  { id: "clean-music-video",  name: "Clean Music Video",      description: "Balanced pacing · neutral grade · professional",   accent: "from-white/10 to-white/5 border-white/20" },
  { id: "high-energy-promo",  name: "High Energy Promo",      description: "Zoom punches · flash transitions · max hype",      accent: "from-fuchsia-500/20 to-red-500/10 border-fuchsia-500/30" },
  { id: "cinematic-story",    name: "Cinematic Story",        description: "Long holds · cinematic bars · deep emotion",       accent: "from-zinc-500/20 to-slate-700/10 border-zinc-400/20" },
  { id: "street-performance", name: "Street Performance",     description: "Handheld energy · gritty grade · raw documentary", accent: "from-orange-500/20 to-amber-800/10 border-orange-500/20" },
  { id: "gold-luxury-brand",  name: "Gold Luxury Brand",      description: "Gold accents · slow-mo · premium brand identity",  accent: "from-yellow-400/20 to-amber-500/10 border-yellow-400/30" },
];

export interface AiSceneNote {
  sceneIndex: number;
  note: string;
  transition: string;
  effect: string;
}

export interface AiEditPlan {
  style: AiEditStylePreset;
  transitionPlan: Array<{ sceneIndex: number; transition: string; note: string }>;
  effectsPlan: string[];
  colorGrade: string;
  captionStylePreset: CaptionStylePreset;
  beatCutNotes: string;
  introPlan: string;
  outroPlan: string;
  sceneEditNotes: AiSceneNote[];
  exportSettings: {
    captionStylePreset: CaptionStylePreset;
    effects: string[];
    colorGrade: string;
  };
  generatedAt: string;
}

/** Structured transition created from the AI Transition Plan and applied to the timeline. */
export interface AppliedTransition {
  sceneId: string;
  sceneIndex: number;
  transitionType: string;
  startTime: number;
  duration: number;
  fromSceneId: string | null;
  toSceneId: string;
  direction: string;
  intensity: number;
  applied: boolean;
}

export interface AiEditSettings {
  enabled: boolean;
  style: AiEditStylePreset;
  plan: AiEditPlan | null;
  applied: boolean;
  preApplyEffects: string[] | null;
  preApplyCaptionStylePreset: CaptionStylePreset | null;
  /** When true, AI transitions are applied to the timeline automatically after a plan is generated. */
  autoApplyTransitions: boolean;
  /** True once the AI transition plan has been written into per-clip transition data. */
  transitionsApplied: boolean;
  /** Structured transitions created the last time the plan was applied. */
  appliedTransitions: AppliedTransition[];
}

export function defaultAiEditSettings(): AiEditSettings {
  return {
    enabled: false,
    style: "luxury-hiphop",
    plan: null,
    applied: false,
    preApplyEffects: null,
    preApplyCaptionStylePreset: null,
    autoApplyTransitions: false,
    transitionsApplied: false,
    appliedTransitions: [],
  };
}

/* ── Branding types ──────────────────────────────────── */

export type IntroCardPreset =
  | "luxury-dark" | "drill-street" | "rnb-smooth"
  | "club-neon"   | "kids-bright"  | "clean-minimal";

export type OutroCtaPreset =
  | "stream-now" | "follow-for-more" | "new-music-out-now"
  | "watch-full-video" | "created-with-bdv" | "custom";

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WatermarkOpacity  = "low" | "medium" | "high";
export type WatermarkSize     = "small" | "medium" | "large";
export type TitleStylePreset  = "clean-white" | "luxury-gold" | "minimal";
export type CardDuration      = 1 | 2 | 3 | 5;

export const INTRO_STYLE_DEFS: {
  id: IntroCardPreset; name: string; description: string; accent: string;
}[] = [
  { id: "luxury-dark",   name: "Luxury Dark",   description: "Gold text · deep black · cinematic",       accent: "from-yellow-500/20 to-black/60 border-yellow-500/30" },
  { id: "drill-street",  name: "Drill Street",  description: "White uppercase · red outline · raw",        accent: "from-red-500/20 to-black/60 border-red-500/30" },
  { id: "rnb-smooth",    name: "R&B Smooth",    description: "Soft rose · deep purple · romantic",         accent: "from-pink-500/20 to-purple-900/30 border-pink-500/20" },
  { id: "club-neon",     name: "Club Neon",     description: "Cyan/magenta · pure black · electric",       accent: "from-cyan-400/20 to-fuchsia-500/10 border-cyan-400/30" },
  { id: "kids-bright",   name: "Kids Bright",   description: "Yellow · electric blue · playful",           accent: "from-yellow-400/20 to-sky-500/10 border-yellow-400/30" },
  { id: "clean-minimal", name: "Clean Minimal", description: "White bg · black text · modern",             accent: "from-white/10 to-white/5 border-white/20" },
];

export const OUTRO_CTA_PRESETS: { id: OutroCtaPreset; label: string }[] = [
  { id: "stream-now",        label: "Stream now" },
  { id: "follow-for-more",   label: "Follow for more" },
  { id: "new-music-out-now", label: "New music out now" },
  { id: "watch-full-video",  label: "Watch full video" },
  { id: "created-with-bdv",  label: "Created with Bow Down Visuals" },
  { id: "custom",            label: "Custom text…" },
];

export interface IntroCardSettings {
  enabled: boolean;
  artistName: string;
  songTitle: string;
  tagline: string;
  duration: CardDuration;
  stylePreset: IntroCardPreset;
}

export interface OutroCardSettings {
  enabled: boolean;
  textLine1: string;
  textLine2: string;
  ctaPreset: OutroCtaPreset;
  customCtaText: string;
  duration: CardDuration;
  stylePreset: IntroCardPreset;
}

export interface BrandingWatermarkSettings {
  enabled: boolean;
  bdvWatermark: boolean;
  customLogoUrl: string | null;
  position: WatermarkPosition;
  opacity: WatermarkOpacity;
  size: WatermarkSize;
}

export interface TitleOverlaySettings {
  showArtistName: boolean;
  artistNameText: string;
  showSongTitle: boolean;
  songTitleText: string;
  showSectionLabels: boolean;
  stylePreset: TitleStylePreset;
}

export interface BrandingSettings {
  introCard: IntroCardSettings;
  outroCard: OutroCardSettings;
  watermark: BrandingWatermarkSettings;
  titleOverlay: TitleOverlaySettings;
}

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
  "Street Night",
  "Luxury Gold",
  "Dark Drill",
  "Cinematic Contrast",
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

/* ─── Overlay + Transition structured types ──────────────────── */

export type OverlayType =
  | "text" | "image" | "color" | "vignette" | "film-grain"
  | "light-leak" | "lower-third" | "watermark" | "particles";

export type OverlayPosition =
  | "top-left" | "top-center" | "top-right"
  | "center-left" | "center" | "center-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export type OverlayAnimation = "none" | "fade-in" | "fade-out" | "fade-in-out" | "slide-in" | "pulse";

export interface OverlayItem {
  id: string;
  /** null = not scene-specific (global timeline). */
  sceneId: string | null;
  /** Seconds from start of full video timeline. */
  startTime: number;
  endTime: number;
  type: OverlayType;
  /** Text content for "text" / "lower-third" overlays. */
  content: string;
  /** URL for "image" / "watermark" overlays. */
  source: string | null;
  position: OverlayPosition;
  /** 1–200, interpreted as % width for images, relative font size for text. */
  size: number;
  /** 0–100 */
  opacity: number;
  animation: OverlayAnimation;
  zIndex: number;
  /** CSS color string for "color" / "flash" type. */
  color: string;
  /** CSS color for text overlay text. */
  textColor: string;
}

export interface TransitionItem {
  fromSceneId: string;
  toSceneId: string;
  type: string;
  /** Duration in seconds. */
  duration: number;
  /** Absolute timeline position where this transition starts (seconds). */
  timelineStart: number;
  enabled: boolean;
}

/** Lip-sync processing strength. */
export type LipSyncStrength = "low" | "medium" | "high";

/** Per-clip lip-sync job status. */
export type LipSyncStatus = "idle" | "processing" | "done" | "failed";

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
  /** Duration of the transition in seconds. */
  transitionDuration: number;
  /** Visual effect applied to this clip. */
  effect: string;
  /** Optional replacement clip URL override (edit-plan only). */
  replaceUrl: string | null;
  /** Fade-in duration in seconds (edit-plan only). */
  fadeIn: number;
  /** Fade-out duration in seconds (edit-plan only). */
  fadeOut: number;
  /** Lip-sync result clip URL (replaces demoClipUrl in preview/export when set). */
  lipSyncUrl: string | null;
  /** Current lip-sync job status for this clip. */
  lipSyncStatus: LipSyncStatus | null;
  /** Provider that produced the lip-sync result. */
  lipSyncProvider: string | null;
  /** ISO timestamp when lip sync was created. */
  lipSyncCreatedAt: string | null;
  /** Error message if lip sync failed. */
  lipSyncError: string | null;
}

export interface CaptionSettings {
  enabled: boolean;
  /** Caption workflow mode. */
  mode: CaptionMode;
  /** Visual style preset. */
  stylePreset: CaptionStylePreset;
  /** Caption entrance animation. */
  animation: CaptionAnimation;
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
  /** How many words per caption line when auto-splitting lyrics. */
  captionSplitStyle: CaptionSplitStyle;
  /** Legacy fields kept for backward compat. */
  style: string;
  titleText: string;
  lyricText: string;
  timingOffset: number;
  /** Show dashed safe-area guide box in the master player. */
  showSafeArea: boolean;
  /** Max caption width as % of canvas width. */
  maxWidth: "60%" | "70%" | "80%" | "90%";
  /** Max visible lines before text is clipped. */
  maxLines: "2" | "3";
}

export interface AudioSettings {
  /** Where the song starts, in seconds. */
  startSec: number;
  volume: number;
  fadeIn: boolean;
  fadeOut: boolean;
}

/** How captions appear in the final exported video file. */
export type CaptionExportMode = "off" | "overlay" | "burn";

export type ExportRangeMode = "full" | "first-10" | "first-15" | "first-30" | "custom";

export interface ExportRangeSettings {
  mode: ExportRangeMode;
  customStartSec: number;
  customEndSec: number;
}

export interface ExportSettings {
  format: VideoFormat;
  resolution: ExportResolution;
  quality: ExportQuality;
  watermark: boolean;
  customWatermarkUrl?: string | null;
  /** Controls how captions are included in the final exported video. */
  captionExportMode: CaptionExportMode;
  exportRange: ExportRangeSettings;
  /** How source clips fill the target canvas. fill=crop, fit=letterbox, blur=blurred bg */
  fitMode: FitMode;
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

/**
 * How the project audio and video clips are aligned when their durations differ.
 *
 * keep-as-is   — no stretching; each track uses its own real duration.
 * trim-audio   — audio is cut at the end of the video clips (+ optional fade).
 * extend-video — extra empty clip slots are added until video matches audio length.
 * loop-clips   — existing clips repeat until they cover the full audio duration.
 * auto-fit     — clips are evenly distributed across the entire audio duration.
 * fade-audio   — clips unchanged; audio fades out when the last clip ends.
 */
export type AudioVideoSyncMode =
  | "keep-as-is"
  | "trim-audio"
  | "extend-video"
  | "loop-clips"
  | "auto-fit"
  | "fade-audio";

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
  /**
   * Detected audio duration in seconds.
   * Saved automatically when the audio URL resolves — shared by
   * Timeline Preview, Auto Sync Captions, and export.
   */
  duration?: number;
  /**
   * How to handle an audio/video length mismatch.
   * Saved per-project and respected by Export Doctor.
   * Defaults to "keep-as-is" (no automatic stretching).
   */
  syncMode: AudioVideoSyncMode;
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
  mode: "auto" | "manual" | "lipsync";
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

/** Per-effect intensity defaults — professional/subtle, not 100%. */
export const OVERLAY_DEFAULT_INTENSITY: Record<string, number> = {
  "Light Leaks":       35,
  "Lens Flare":        30,
  "Smoke":             28,
  "Rain":              35,
  "Sparks":            35,
  "Dust":              25,
  "Animated Waveform": 45,
  "Logo / Watermark":  65,
};

export interface EditorSettings {
  mode: "auto" | "manual";
  autoEdit: AutoEditOptions;
  autoEditPlan: AutoEditPlan | null;
  /** Per-clip edits keyed by scene id. */
  clips: Record<string, ClipEdit>;
  captions: CaptionSettings;
  effects: string[];
  /** Legacy overlay type names (chips UI). */
  overlays: string[];
  /** Per-overlay intensity 0–100 (missing key = per-effect default, not 100). */
  overlayIntensity: Record<string, number>;
  /** Watermark text shown in the master player and burned into exports. */
  watermarkText: string;
  /** Waveform position: "bottom-safe" | "top" | "bottom" | "hidden" */
  waveformPosition: string;
  /** Overlay quality preset: "subtle" | "music-video" | "cinematic" | "heavy" */
  overlayQualityMode: string;
  /** Watermark type: "logo" | "text" | "none" */
  watermarkType: string;
  /** Watermark corner: "bottom-right" | "bottom-left" | "top-right" | "top-left" */
  watermarkPosition: string;
  /** Watermark size: "small" | "medium" | "large" */
  watermarkSize: string;
  /** Watermark edge margin in pixels */
  watermarkMargin: number;
  /** Show watermark in master player preview */
  watermarkShowOnPreview: boolean;
  /** Include watermark when burning to export */
  watermarkIncludeInExport: boolean;
  /** Protect caption safe area from overlays */
  overlayProtectCaptions: boolean;
  /** Protect center/face area from overlays */
  overlayProtectFace: boolean;
  /** When set, only this overlay is shown in the master player (solo preview mode). */
  soloPreviewOverlay: string | null;
  /** Structured timed overlay items rendered above the video. */
  overlayItems: OverlayItem[];
  /** Structured transition data (fromSceneId → toSceneId). */
  transitions: TransitionItem[];
  audio: AudioSettings;
  export: ExportSettings;
  musicStudio: MusicStudioSettings;
  branding: BrandingSettings;
  aiEdit: AiEditSettings;
  lipSync: LipSyncSettings;
  updatedAt: string;
}

/** Global lip-sync settings stored in EditorSettings. */
export interface LipSyncSettings {
  enabled: boolean;
  /** Scene id of the currently selected clip for lip sync. */
  selectedSceneId: string | null;
  strength: LipSyncStrength;
  preserveFaceIdentity: boolean;
  preserveArtistLook: boolean;
  /** Whether to use isolated vocal stem (if available) or full mix. */
  audioSource: "vocals" | "full";
  /** URL of a manually-uploaded vocal stem (saved via /api/lip-sync/upload-vocal-stem). */
  uploadedVocalStemUrl: string | null;
}

export function defaultClipEdit(): ClipEdit {
  return {
    trimStart: 0,
    trimEnd: 0,
    muted: false,
    volume: 100,
    transition: "Cut",
    transitionDuration: 1.0,
    effect: "None",
    replaceUrl: null,
    fadeIn: 0,
    fadeOut: 0,
    lipSyncUrl: null,
    lipSyncStatus: null,
    lipSyncProvider: null,
    lipSyncCreatedAt: null,
    lipSyncError: null,
  };
}

export function defaultLipSyncSettings(): LipSyncSettings {
  return {
    enabled: false,
    selectedSceneId: null,
    strength: "medium",
    preserveFaceIdentity: true,
    preserveArtistLook: true,
    audioSource: "vocals",
    uploadedVocalStemUrl: null,
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
      watermark: true,
      beatCutIntensity: "high",
      transitionIntensity: "medium",
    },
    autoEditPlan: null,
    clips: {},
    captions: {
      enabled: true,
      mode: "none",
      stylePreset: "clean-white",
      animation: "none",
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
      captionSplitStyle: "short",
      style: "Karaoke Highlight",
      titleText: "",
      lyricText: "",
      timingOffset: 0,
      showSafeArea: false,
      maxWidth: "80%",
      maxLines: "2",
    },
    effects: [],
    overlays: [],
    overlayIntensity: {},
    watermarkText: "Bow Down Visuals",
    waveformPosition: "bottom-safe",
    overlayQualityMode: "music-video",
    watermarkType: "logo",
    watermarkPosition: "bottom-right",
    watermarkSize: "medium",
    watermarkMargin: 16,
    watermarkShowOnPreview: true,
    watermarkIncludeInExport: true,
    overlayProtectCaptions: true,
    overlayProtectFace: true,
    soloPreviewOverlay: null,
    overlayItems: [],
    transitions: [],
    audio: { startSec: 0, volume: 100, fadeIn: true, fadeOut: true },
    export: { format: "9:16", resolution: "1080p", quality: "draft", watermark: true, customWatermarkUrl: null, captionExportMode: "burn" as CaptionExportMode, exportRange: { mode: "full" as ExportRangeMode, customStartSec: 0, customEndSec: 30 }, fitMode: "fill" as FitMode },
    musicStudio: defaultMusicStudioSettings(),
    aiEdit: defaultAiEditSettings(),
    branding: {
      introCard: {
        enabled: false,
        artistName: "",
        songTitle: "",
        tagline: "",
        duration: 3,
        stylePreset: "luxury-dark",
      },
      outroCard: {
        enabled: false,
        textLine1: "",
        textLine2: "",
        ctaPreset: "follow-for-more",
        customCtaText: "",
        duration: 3,
        stylePreset: "luxury-dark",
      },
      watermark: {
        enabled: true,
        bdvWatermark: true,
        customLogoUrl: null,
        position: "bottom-right",
        opacity: "medium",
        size: "medium",
      },
      titleOverlay: {
        showArtistName: false,
        artistNameText: "",
        showSongTitle: false,
        songTitleText: "",
        showSectionLabels: false,
        stylePreset: "clean-white",
      },
    },
    lipSync: defaultLipSyncSettings(),
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
      syncMode: "keep-as-is",
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

function normalizeMusicMode(raw: unknown): MusicStudioSettings["mode"] {
  if (raw === "auto" || raw === "manual" || raw === "lipsync") return raw;
  return "auto";
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
    mode: normalizeMusicMode(stored.mode),
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
    overlayIntensity: (stored.overlayIntensity && typeof stored.overlayIntensity === "object" && !Array.isArray(stored.overlayIntensity)) ? stored.overlayIntensity as Record<string, number> : {},
    watermarkText: typeof stored.watermarkText === "string" ? stored.watermarkText : "Bow Down Visuals",
    waveformPosition: typeof stored.waveformPosition === "string" ? stored.waveformPosition : "bottom-safe",
    overlayQualityMode: (stored.overlayQualityMode && ["off", "subtle", "visible", "music-video", "heavy"].includes(stored.overlayQualityMode)) ? stored.overlayQualityMode : "music-video",
    watermarkType: (stored.watermarkType && ["logo", "text", "none"].includes(stored.watermarkType)) ? stored.watermarkType : "logo",
    watermarkPosition: (stored.watermarkPosition && ["bottom-right", "bottom-left", "top-right", "top-left"].includes(stored.watermarkPosition)) ? stored.watermarkPosition : "bottom-right",
    watermarkSize: (stored.watermarkSize && ["small", "medium", "large"].includes(stored.watermarkSize)) ? stored.watermarkSize : "medium",
    watermarkMargin: typeof stored.watermarkMargin === "number" ? stored.watermarkMargin : 16,
    watermarkShowOnPreview: typeof stored.watermarkShowOnPreview === "boolean" ? stored.watermarkShowOnPreview : true,
    watermarkIncludeInExport: typeof stored.watermarkIncludeInExport === "boolean" ? stored.watermarkIncludeInExport : true,
    overlayProtectCaptions: typeof stored.overlayProtectCaptions === "boolean" ? stored.overlayProtectCaptions : true,
    overlayProtectFace: typeof stored.overlayProtectFace === "boolean" ? stored.overlayProtectFace : true,
    soloPreviewOverlay: typeof stored.soloPreviewOverlay === "string" ? stored.soloPreviewOverlay : null,
    overlayItems: Array.isArray(stored.overlayItems) ? stored.overlayItems : [],
    transitions: Array.isArray(stored.transitions) ? stored.transitions : [],
    audio: { ...base.audio, ...(stored.audio ?? {}) },
    export: { ...base.export, ...(stored.export ?? {}) },
    musicStudio: normalizeMusicStudio(stored.musicStudio),
    aiEdit: stored.aiEdit
      ? { ...defaultAiEditSettings(), ...stored.aiEdit }
      : defaultAiEditSettings(),
    lipSync: stored.lipSync
      ? { ...defaultLipSyncSettings(), ...stored.lipSync }
      : defaultLipSyncSettings(),
    branding: stored.branding
      ? {
          introCard:    { ...base.branding.introCard,    ...(stored.branding.introCard    ?? {}) },
          outroCard:    { ...base.branding.outroCard,    ...(stored.branding.outroCard    ?? {}) },
          watermark:    { ...base.branding.watermark,    ...(stored.branding.watermark    ?? {}) },
          titleOverlay: { ...base.branding.titleOverlay, ...(stored.branding.titleOverlay ?? {}) },
        }
      : base.branding,
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

/* ─────────────────────────────────────────────────────────────
   AI Transition Plan → timeline transitions.

   The master player renders transitions from per-clip ClipEdit.transition
   (see handleSceneChange in video-editor.tsx → TransitionCompositor).
   These helpers translate the AI Transition Plan (free-text transition
   names) into that vocabulary and write them onto the per-clip data so
   they actually render and persist.
   ───────────────────────────────────────────────────────────── */

/** Parse a "0:00 - 0:05" style timestamp into its duration in seconds. */
function parseSceneDuration(ts: string | null | undefined): number {
  if (!ts) return 5;
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1] * 60 + +m[2];
    const e = +m[3] * 60 + +m[4];
    return e > s ? e - s : 5;
  }
  return 5;
}

/**
 * Normalize a free-text transition name (from the AI plan) into the exact
 * vocabulary the master player's TransitionCompositor understands. Unknown
 * names fall back to "Crossfade" so the transition is still visible.
 */
export function normalizeTransitionName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "Cut";
  if (s.includes("cut") && !s.includes("flash")) return "Cut";
  if (s.includes("flash")) return "Flash";
  if (s.includes("black") || (s.includes("fade") && s.includes("out"))) return "Fade to Black";
  if (s.includes("whip") || s.includes("swipe") || s.includes("pan")) return "Whip Pan";
  if (s.includes("zoom") || s.includes("punch")) return "Zoom";
  if (s.includes("glitch")) return "Glitch";
  if (s.includes("light") || s.includes("leak")) return "Light Leak";
  if (s.includes("spin") || s.includes("rotate")) return "Spin";
  if (s.includes("blur")) return "Blur Dissolve";
  if (s.includes("slide")) return "Slide";
  if (s.includes("cross") || s.includes("dissolve") || s.includes("fade")) return "Crossfade";
  return "Crossfade";
}

/** Cumulative start time (seconds) for each scene, from parsed timestamps. */
function sceneStartTimes(scenes: SceneData[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of scenes) { out.push(acc); acc += parseSceneDuration(s.timestamp); }
  return out;
}

/**
 * Build structured transitions from the AI plan, mapped onto real scenes.
 * Scene 0 is always a "Cut" (nothing transitions INTO the first scene).
 */
export function buildAppliedTransitions(
  plan: AiEditPlan,
  scenes: SceneData[],
): AppliedTransition[] {
  const starts = sceneStartTimes(scenes);
  const out: AppliedTransition[] = [];
  for (const entry of plan.transitionPlan ?? []) {
    const idx = entry.sceneIndex;
    const scene = scenes[idx];
    if (!scene) continue;
    const type = idx === 0 ? "Cut" : normalizeTransitionName(entry.transition);
    out.push({
      sceneId: scene.id,
      sceneIndex: idx,
      transitionType: type,
      startTime: starts[idx] ?? idx * 5,
      duration: type === "Cut" ? 0 : 1.0,
      fromSceneId: idx > 0 ? (scenes[idx - 1]?.id ?? null) : null,
      toSceneId: scene.id,
      direction: type === "Whip Pan" || type === "Slide" ? "left" : "none",
      intensity: 100,
      applied: true,
    });
  }
  return out;
}

/**
 * Apply the AI Transition Plan to the timeline: writes each transition into
 * the per-clip ClipEdit data (which the master player renders) and records the
 * structured transitions + flags on aiEdit. Returns a new EditorSettings.
 */
export function applyAiTransitionsToClips(
  settings: EditorSettings,
  scenes: SceneData[],
  plan: AiEditPlan,
): EditorSettings {
  const applied = buildAppliedTransitions(plan, scenes);
  const clips: Record<string, ClipEdit> = { ...settings.clips };
  for (const t of applied) {
    const current = getClipEdit(settings, t.sceneId);
    clips[t.sceneId] = {
      ...current,
      transition: t.transitionType,
      transitionDuration: t.duration > 0 ? t.duration : current.transitionDuration,
    };
  }
  return {
    ...settings,
    clips,
    aiEdit: {
      ...settings.aiEdit,
      transitionsApplied: true,
      appliedTransitions: applied,
    },
  };
}
