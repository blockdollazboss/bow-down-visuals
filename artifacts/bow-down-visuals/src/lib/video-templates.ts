/* ── Video Editor Templates ─────────────────────────────────────────────
   Template = the "what are you making?" choice at editor start. Each
   template drives:
     - default aspect ratio
     - which tool tabs surface first (priority order)
     - which presets appear in each feature's gallery (captions, effects,
       transitions, color grades) — everything else stays one click away
       via "Show all"
     - the default caption style + AI-edit style
     - the EXECUTION spec Turbo runs when the template is picked
       (captionAnimation, transitionDurationSec, overlaySequence):
       picking a template no longer just sets two defaults — it builds
       the timeline (see lib/template-execution.ts): clips sequenced in
       scene order with the template's transitions, its effects, its
       caption style + animation, and its title/hook overlay steps
       placed. Advanced/manual control stays available afterwards.
   Templates are starting points, never locks: every setting stays fully
   customizable after picking one.
------------------------------------------------------------------------ */

import type {
  VideoFormat,
  CaptionStylePreset,
  AiEditStylePreset,
  CaptionAnimation,
  OverlayItem,
  OverlayPosition,
} from "./editor-settings";

/**
 * One overlay step in a template's execution sequence. Steps run in
 * array order. Content is resolved at execution time from the project
 * (title = the project's song/video title, hook = the project's hook
 * text or first lyric line); a step whose content the project does not
 * have is skipped and reported, never filled with invented text.
 *  - "title" → a timed text OverlayItem on the timeline.
 *  - "hook"  → the editor's hook caption (captions.hookText + the
 *              0–3s opening line, via withOpeningHook).
 */
export interface TemplateOverlayStep {
  role: "title" | "hook";
  position: OverlayPosition;
  /** Seconds from the start of the timeline. */
  startSec: number;
  /** Seconds the step stays on screen. */
  durationSec: number;
  /** Overlay entrance animation (title steps). */
  animation?: OverlayItem["animation"];
}

export type VideoTemplateId =
  | "music-video"
  | "promo-ad"
  | "lyric-video"
  | "vlog"
  | "social-short"
  | "slideshow"
  | "intro-outro"
  | "winner-reel"
  | "blank-canvas";

export type TemplateIconName =
  | "music" | "megaphone" | "mic" | "video"
  | "smartphone" | "images" | "sparkles" | "layout" | "trophy";

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
  /** Caption entrance animation Turbo applies with the caption preset. */
  captionAnimation: CaptionAnimation;
  /** Seconds per transition when Turbo sequences the clips. */
  transitionDurationSec: number;
  /** Title/hook overlay steps Turbo places, in order. */
  overlaySequence: TemplateOverlayStep[];
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
    captionAnimation: "word-pop",
    transitionDurationSec: 0.5,
    overlaySequence: [
      { role: "title", position: "top-center", startSec: 0, durationSec: 3, animation: "fade-in-out" },
      { role: "hook", position: "bottom-center", startSec: 0, durationSec: 3 },
    ],
  },
  {
    id: "promo-ad",
    name: "Promo / Ad",
    tagline: "Sell it in seconds",
    description: "9:16 · bold titles · brand tools · punchy effects",
    icon: "megaphone",
    accent: "from-violet-500/25 to-purple-700/10 border-violet-400/40",
    defaultFormat: "9:16",
    priorityTabs: ["clips", "captions", "branding", "effects", "timeline", "export"],
    defaultCaptionPreset: "pill-pop",
    captionPresets: ["pill-pop", "viral-shorts", "brutalist", "clean-white", "gold-hiphop"],
    effects: ["Glow", "Neon Glow", "Camera Shake", "Speed Ramp", "Slow Zoom"],
    transitions: ["Flash", "Zoom", "Whip Pan", "Glitch", "Spin"],
    colorGrades: ["Vibrant Pop", "Luxury Gold", "Teal & Orange"],
    aiEditStyle: "high-energy-promo",
    captionAnimation: "pop",
    transitionDurationSec: 0.4,
    overlaySequence: [
      { role: "title", position: "top-center", startSec: 0, durationSec: 2.5, animation: "fade-in-out" },
      { role: "hook", position: "bottom-center", startSec: 0, durationSec: 3 },
    ],
  },
  {
    id: "lyric-video",
    name: "Lyric Video",
    tagline: "Every word on screen",
    description: "16:9 · word-by-word karaoke · captions first",
    icon: "mic",
    accent: "from-sky-400/25 to-blue-700/10 border-sky-400/40",
    defaultFormat: "16:9",
    priorityTabs: ["music", "captions", "timeline", "effects", "export"],
    defaultCaptionPreset: "karaoke-word",
    captionPresets: ["karaoke-word", "karaoke", "clean-white", "neon-glow", "rnb", "minimal"],
    effects: ["Glow", "Neon Glow", "Vignette", "Blur"],
    transitions: ["Crossfade", "Fade to Black", "Blur Dissolve"],
    colorGrades: ["Moody Desaturated", "Cinematic Contrast", "Cool Grade"],
    aiEditStyle: "cinematic-story",
    captionAnimation: "word-pop",
    transitionDurationSec: 0.5,
    overlaySequence: [
      { role: "title", position: "top-center", startSec: 0, durationSec: 3, animation: "fade-in-out" },
    ],
  },
  {
    id: "vlog",
    name: "Vlog / Talking Head",
    tagline: "Clean and personal",
    description: "16:9 · subtle captions · minimal effects",
    icon: "video",
    accent: "from-emerald-400/20 to-teal-700/10 border-emerald-400/40",
    defaultFormat: "16:9",
    priorityTabs: ["clips", "captions", "timeline", "export"],
    defaultCaptionPreset: "minimal",
    captionPresets: ["minimal", "clean-white", "boxed", "luxury"],
    effects: ["Sharpen", "Vignette"],
    transitions: ["Cut", "Crossfade", "Fade to Black"],
    colorGrades: ["Warm Grade", "Vibrant Pop"],
    aiEditStyle: "clean-music-video",
    captionAnimation: "fade",
    transitionDurationSec: 0.5,
    overlaySequence: [
      { role: "title", position: "bottom-left", startSec: 0, durationSec: 3, animation: "fade-in-out" },
    ],
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
    captionAnimation: "word-pop",
    transitionDurationSec: 0.35,
    overlaySequence: [
      { role: "hook", position: "bottom-center", startSec: 0, durationSec: 3 },
      { role: "title", position: "center", startSec: 0, durationSec: 2, animation: "fade-in-out" },
    ],
  },
  {
    id: "slideshow",
    name: "Slideshow",
    tagline: "Photos that move",
    description: "16:9 · transitions first · gentle motion",
    icon: "images",
    accent: "from-orange-400/25 to-amber-700/10 border-orange-400/40",
    defaultFormat: "16:9",
    priorityTabs: ["clips", "timeline", "music", "effects", "export"],
    defaultCaptionPreset: "boxed",
    captionPresets: ["boxed", "minimal", "luxury", "clean-white"],
    effects: ["Slow Zoom", "Vignette", "Film Grain"],
    transitions: ["Crossfade", "Slide", "Fade to Black", "Blur Dissolve", "Light Leak"],
    colorGrades: ["Warm Grade", "Cinematic Contrast"],
    aiEditStyle: "cinematic-story",
    captionAnimation: "fade",
    transitionDurationSec: 0.8,
    overlaySequence: [
      { role: "title", position: "center", startSec: 0, durationSec: 3, animation: "fade-in-out" },
    ],
  },
  {
    id: "intro-outro",
    name: "Intro / Outro",
    tagline: "Brand the bookends",
    description: "16:9 · logo + titles · brand tools first",
    icon: "sparkles",
    accent: "from-pink-500/25 to-fuchsia-700/10 border-pink-400/40",
    defaultFormat: "16:9",
    priorityTabs: ["branding", "clips", "effects", "export"],
    defaultCaptionPreset: "luxury",
    captionPresets: ["luxury", "pill-pop", "gold-hiphop", "brutalist"],
    effects: ["Glow", "Film Grain", "Vignette"],
    transitions: ["Fade to Black", "Flash", "Zoom", "Light Leak"],
    colorGrades: ["Luxury Gold", "Cinematic Contrast", "Dark Drill"],
    aiEditStyle: "gold-luxury-brand",
    captionAnimation: "pop",
    transitionDurationSec: 0.5,
    overlaySequence: [
      { role: "title", position: "center", startSec: 0, durationSec: 3, animation: "fade-in-out" },
    ],
  },
  {
    id: "winner-reel",
    name: "Winner Reel",
    tagline: "Crown your win",
    description: "9:16 · gold captions · celebration glow · branding up front for the watermark",
    icon: "trophy",
    accent: "from-amber-400/25 to-yellow-600/10 border-amber-400/40",
    defaultFormat: "9:16",
    priorityTabs: ["clips", "captions", "effects", "branding", "music", "timeline", "export"],
    defaultCaptionPreset: "gold-hiphop",
    captionPresets: ["gold-hiphop", "luxury", "karaoke-word", "pill-pop", "clean-white"],
    effects: ["Glow", "Slow Zoom", "Vignette", "Film Grain"],
    transitions: ["Flash", "Zoom", "Light Leak", "Crossfade"],
    colorGrades: ["Luxury Gold", "Cinematic Contrast", "Warm Grade"],
    aiEditStyle: "gold-luxury-brand",
    captionAnimation: "pop",
    transitionDurationSec: 0.4,
    overlaySequence: [
      { role: "title", position: "center", startSec: 0, durationSec: 3, animation: "fade-in-out" },
      { role: "hook", position: "bottom-center", startSec: 0, durationSec: 3 },
    ],
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
    captionAnimation: "none",
    transitionDurationSec: 0.5,
    overlaySequence: [],
  },
];

export function getVideoTemplate(id: string | null | undefined): VideoTemplate {
  /* Fallback is Blank Canvas BY ID, never by array index — the registry
     grows (winner-reel landed after intro-outro) and an index fallback
     would silently re-point unknown ids at the wrong template. */
  return (
    VIDEO_TEMPLATES.find((t) => t.id === id) ??
    VIDEO_TEMPLATES.find((t) => t.id === "blank-canvas")!
  );
}

export function isVideoTemplateId(id: string | null | undefined): id is VideoTemplateId {
  return !!id && VIDEO_TEMPLATES.some((t) => t.id === id);
}

/* ── Claim-to-asset door: the winners' circle "Build Winner Reel" ──────
   Opens the editor with the winner-reel template EXECUTED on arrival —
   the editor's ?make= deep link runs the same applyTemplate path a
   picker click runs (lib/template-execution.ts builds the timeline).
   Title/hook carry only facts the caller already holds: the winning
   entry's title and the winner's crown line. Execution never invents
   text, so an empty field is simply left out of the link. */
export function buildWinnerReelHref(input: { title: string; hook: string }): string {
  const params = new URLSearchParams({ make: "winner-reel" });
  if (input.title.trim()) params.set("title", input.title);
  if (input.hook.trim()) params.set("hook", input.hook);
  return `/video-editor?${params.toString()}`;
}

/* ── The editor side of the ?make= deep link ───────────────────────────
   A claim-to-asset door names a template but carries no project — the
   editor's one project convention is ?project=<id>, and an arrival
   without it used to land on the "No project selected" gate with the
   template executed into state the gate hid (the Build Winner Reel
   dead-end, found by the Stack 100 Gate-1 capture). The editor now
   parses the link with this one reader and, when it names a template
   but no project, resolves a project context before anything renders:
   the member's newest project (the palace step-through's own pattern,
   lib/world/station-panel newestEditorProjectId) or — for a member
   with none — a real project created through POST /api/projects, the
   same create-then-open rail the generation flows use. Pure parsing
   lives here; the fetching stays in the page. */
export interface MakeDeepLink {
  templateId: VideoTemplateId;
  title: string | null;
  hook: string | null;
}

/** Parse a ?make= deep link's search string. Unknown template ids are
 *  NOT a link — never resolved through the Blank Canvas fallback, so a
 *  bad link can never build (or bootstrap a project for) a timeline
 *  the member didn't ask for. */
export function parseMakeDeepLink(search: string): MakeDeepLink | null {
  const params = new URLSearchParams(search);
  const make = params.get("make");
  if (!make || !isVideoTemplateId(make)) return null;
  return { templateId: make, title: params.get("title"), hook: params.get("hook") };
}

/** True when the arrival is a ?make= deep link that still owes the
 *  editor a project: it names a template but no ?project=. */
export function makeDeepLinkNeedsProject(search: string): boolean {
  if (parseMakeDeepLink(search) === null) return false;
  return !new URLSearchParams(search).get("project");
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

/* Removed 2026-10-10: templateCaptionPresets was dead (zero imports). */



