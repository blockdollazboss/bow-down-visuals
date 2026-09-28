/* ── Video Editor Templates ─────────────────────────────────────────────
   Template = the "what are you making?" choice at editor start. Each
   template drives:
     - default aspect ratio
     - which tool tabs surface first (priority order)
     - which presets appear in each feature's gallery (captions, effects,
       transitions, color grades) — everything else stays one click away
       via "Show all"
     - the default caption style + AI-edit style
   Templates are starting points, never locks: every setting stays fully
   customizable after picking one.
------------------------------------------------------------------------ */

import type {
  VideoFormat,
  CaptionStylePreset,
  AiEditStylePreset,
} from "./editor-settings";

export type VideoTemplateId =
  | "music-video"
  | "promo-ad"
  | "lyric-video"
  | "vlog"
  | "social-short"
  | "slideshow"
  | "intro-outro"
  | "blank-canvas";

export type TemplateIconName =
  | "music" | "megaphone" | "mic" | "video"
  | "smartphone" | "images" | "sparkles" | "layout";

export interface VideoTemplate {
  id: VideoTemplateId;
  name: string;
  tagline: string;
  description: string;
  icon: TemplateIconName;
  /** gradient accent classes for the picker card */
  accent: string;
  defaultFormat: VideoFormat;
  /** tool-tab ids in the order this template wants them (rest follow after) */
  priorityTabs: string[];
  defaultCaptionPreset: CaptionStylePreset;
  captionPresets: CaptionStylePreset[];
  effects: string[];
  transitions: string[];
  colorGrades: string[];
  aiEditStyle: AiEditStylePreset;
}

export const VIDEO_TEMPLATES: VideoTemplate[] = [
  {
    id: "music-video",
    name: "Music Video",
    tagline: "The full cinematic treatment",
    description: "16:9 · karaoke captions · film effects · lip-sync tools up front",
    icon: "music",
    accent: "from-yellow-500/20 to-amber-600/10 border-yellow-500/30",
    defaultFormat: "16:9",
    priorityTabs: ["clips", "music", "timeline", "captions", "effects", "lip-sync", "export"],
    defaultCaptionPreset: "karaoke-word",
    captionPresets: ["karaoke-word", "karaoke", "gold-hiphop", "clean-white", "neon-glow", "drill"],
    effects: ["Film Grain", "Glow", "Vignette", "Cinematic Bars", "Slow Zoom", "Camera Shake", "Neon Glow"],
    transitions: ["Crossfade", "Flash", "Zoom", "Whip Pan", "Light Leak"],
    colorGrades: ["Cinematic Contrast", "Warm Grade", "Luxury Gold", "Dark Drill", "Teal & Orange"],
    aiEditStyle: "clean-music-video",
  },
  {
    id: "promo-ad",
    name: "Promo / Ad",
    tagline: "Sell it in seconds",
    description: "9:16 · bold titles · brand tools · punchy effects",
    icon: "megaphone",
    accent: "from-fuchsia-500/20 to-red-500/10 border-fuchsia-500/30",
    defaultFormat: "9:16",
    priorityTabs: ["clips", "captions", "branding", "effects", "timeline", "export"],
    defaultCaptionPreset: "pill-pop",
    captionPresets: ["pill-pop", "viral-shorts", "brutalist", "clean-white", "gold-hiphop"],
    effects: ["Glow", "Neon Glow", "Camera Shake", "Speed Ramp", "Slow Zoom"],
    transitions: ["Flash", "Zoom", "Whip Pan", "Glitch", "Spin"],
    colorGrades: ["Vibrant Pop", "Luxury Gold", "Teal & Orange"],
    aiEditStyle: "high-energy-promo",
  },
  {
    id: "lyric-video",
    name: "Lyric Video",
    tagline: "Every word on screen",
    description: "16:9 · word-by-word karaoke · captions first",
    icon: "mic",
    accent: "from-cyan-400/20 to-fuchsia-500/10 border-cyan-400/30",
    defaultFormat: "16:9",
    priorityTabs: ["music", "captions", "timeline", "effects", "export"],
    defaultCaptionPreset: "karaoke-word",
    captionPresets: ["karaoke-word", "karaoke", "clean-white", "neon-glow", "rnb", "minimal"],
    effects: ["Glow", "Neon Glow", "Vignette", "Blur"],
    transitions: ["Crossfade", "Fade to Black", "Blur Dissolve"],
    colorGrades: ["Moody Desaturated", "Cinematic Contrast", "Cool Grade"],
    aiEditStyle: "cinematic-story",
  },
  {
    id: "vlog",
    name: "Vlog / Talking Head",
    tagline: "Clean and personal",
    description: "16:9 · subtle captions · minimal effects",
    icon: "video",
    accent: "from-white/10 to-white/5 border-white/20",
    defaultFormat: "16:9",
    priorityTabs: ["clips", "captions", "timeline", "export"],
    defaultCaptionPreset: "minimal",
    captionPresets: ["minimal", "clean-white", "boxed", "luxury"],
    effects: ["Sharpen", "Vignette"],
    transitions: ["Cut", "Crossfade", "Fade to Black"],
    colorGrades: ["Warm Grade", "Vibrant Pop"],
    aiEditStyle: "clean-music-video",
  },
  {
    id: "social-short",
    name: "Social Short",
    tagline: "Built to go viral",
    description: "9:16 · punchy captions · trending effects",
    icon: "smartphone",
    accent: "from-red-500/20 to-pink-500/10 border-red-500/30",
    defaultFormat: "9:16",
    priorityTabs: ["clips", "captions", "effects", "music", "export"],
    defaultCaptionPreset: "viral-shorts",
    captionPresets: ["viral-shorts", "karaoke-word", "pill-pop", "brutalist", "neon-glow"],
    effects: ["Camera Shake", "Speed Ramp", "Neon Glow", "Glow", "VHS"],
    transitions: ["Whip Pan", "Zoom", "Flash", "Glitch", "Cut"],
    colorGrades: ["Vibrant Pop", "Street Night", "Teal & Orange"],
    aiEditStyle: "viral-tiktok",
  },
  {
    id: "slideshow",
    name: "Slideshow",
    tagline: "Photos that move",
    description: "16:9 · transitions first · gentle motion",
    icon: "images",
    accent: "from-orange-200/10 to-white/5 border-orange-200/20",
    defaultFormat: "16:9",
    priorityTabs: ["clips", "timeline", "music", "effects", "export"],
    defaultCaptionPreset: "boxed",
    captionPresets: ["boxed", "minimal", "luxury", "clean-white"],
    effects: ["Slow Zoom", "Vignette", "Film Grain"],
    transitions: ["Crossfade", "Slide", "Fade to Black", "Blur Dissolve", "Light Leak"],
    colorGrades: ["Warm Grade", "Cinematic Contrast"],
    aiEditStyle: "cinematic-story",
  },
  {
    id: "intro-outro",
    name: "Intro / Outro",
    tagline: "Brand the bookends",
    description: "16:9 · logo + titles · brand tools first",
    icon: "sparkles",
    accent: "from-yellow-400/20 to-amber-500/10 border-yellow-400/30",
    defaultFormat: "16:9",
    priorityTabs: ["branding", "clips", "effects", "export"],
    defaultCaptionPreset: "luxury",
    captionPresets: ["luxury", "pill-pop", "gold-hiphop", "brutalist"],
    effects: ["Glow", "Film Grain", "Vignette"],
    transitions: ["Fade to Black", "Flash", "Zoom", "Light Leak"],
    colorGrades: ["Luxury Gold", "Cinematic Contrast", "Dark Drill"],
    aiEditStyle: "gold-luxury-brand",
  },
  {
    id: "blank-canvas",
    name: "Blank Canvas",
    tagline: "Everything, unfiltered",
    description: "16:9 · every tool · every preset",
    icon: "layout",
    accent: "from-zinc-500/20 to-slate-700/10 border-zinc-400/20",
    defaultFormat: "16:9",
    priorityTabs: [],
    defaultCaptionPreset: "clean-white",
    captionPresets: [], // empty = show all
    effects: [],
    transitions: [],
    colorGrades: [],
    aiEditStyle: "clean-music-video",
  },
];

export function getVideoTemplate(id: string | null | undefined): VideoTemplate {
  return VIDEO_TEMPLATES.find((t) => t.id === id) ?? VIDEO_TEMPLATES[7]!;
}

/* ── localStorage: custom card order + last choice ── */

const ORDER_KEY = "bdv-template-order";
const LAST_KEY = "bdv-last-template";

export function getTemplateOrder(): VideoTemplateId[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return VIDEO_TEMPLATES.map((t) => t.id);
    const ids = JSON.parse(raw) as string[];
    const known = new Set<string>(VIDEO_TEMPLATES.map((t) => t.id));
    const ordered = ids.filter((id) => known.has(id)) as VideoTemplateId[];
    for (const t of VIDEO_TEMPLATES) if (!ordered.includes(t.id)) ordered.push(t.id);
    return ordered;
  } catch {
    return VIDEO_TEMPLATES.map((t) => t.id);
  }
}

export function setTemplateOrder(ids: VideoTemplateId[]) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch { /* noop */ }
}

export function getLastTemplate(): VideoTemplateId | null {
  try {
    const id = localStorage.getItem(LAST_KEY);
    return VIDEO_TEMPLATES.some((t) => t.id === id) ? (id as VideoTemplateId) : null;
  } catch {
    return null;
  }
}

export function setLastTemplate(id: VideoTemplateId) {
  try { localStorage.setItem(LAST_KEY, id); } catch { /* noop */ }
}

/* ── preset filtering helpers (empty list = show all) ── */

function filterOrAll<T>(subset: T[], all: readonly T[]): T[] {
  return subset.length > 0 ? subset : [...all];
}

export function templateCaptionPresets(t: VideoTemplate): CaptionStylePreset[] {
  return t.captionPresets.length > 0 ? [...t.captionPresets] : [];
}

export function templateEffects(t: VideoTemplate, all: readonly string[]): string[] {
  return filterOrAll(t.effects, all);
}

export function templateTransitions(t: VideoTemplate, all: readonly string[]): string[] {
  return filterOrAll(t.transitions, all);
}

export function templateColorGrades(t: VideoTemplate, all: readonly string[]): string[] {
  return filterOrAll(t.colorGrades, all);
}
