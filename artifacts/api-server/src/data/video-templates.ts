/**
 * Video edit template recipes — the server-side "CapCut templates" engine.
 *
 * Each template is pure DATA (cuts, transitions, overlay slots, duration
 * targets, aspect). The route `video-template.ts` interprets these recipes
 * with ffmpeg — no per-template code. Adding a template = adding an object
 * here.
 */

export type TemplateAspect = "9:16" | "16:9" | "1:1";

/** xfade transition keys — must match the 20-transition system in routes/generate/transitions.ts */
export const TEMPLATE_TRANSITION_KEYS = [
  "fade",
  "fadeblack",
  "fadewhite",
  "dissolve",
  "wipeleft",
  "wiperight",
  "wipeup",
  "wipedown",
  "slideleft",
  "slideright",
  "slideup",
  "slidedown",
  "smoothleft",
  "smoothright",
  "circlecrop",
  "circleopen",
  "circleclose",
  "radial",
  "pixelize",
  "hblur",
] as const;

export type TemplateTransitionKey = (typeof TEMPLATE_TRANSITION_KEYS)[number];

export interface TemplateSlot {
  /** stable slot id used by the frontend slot-mapping UI */
  key: string;
  /** short label shown on the slot card */
  label: string;
  /** "video" = video only, "photo" = image only, "any" = either */
  kind: "video" | "photo" | "any";
  /** seconds this slot occupies in the final cut */
  durationSec: number;
}

export interface TemplateOverlay {
  /** default text — the user can edit every overlay before applying */
  text: string;
  /** 0-based index into slots[] */
  slotIndex: number;
  position: "top" | "center" | "bottom";
  /** seconds after the slot's appearance starts */
  startSec: number;
  /** seconds the overlay stays on screen */
  durationSec: number;
  size: "sm" | "md" | "lg";
  color: "white" | "gold";
}

export interface VideoTemplateRecipe {
  key: string;
  name: string;
  tagline: string;
  description: string;
  aspect: TemplateAspect;
  /** target total seconds (engine computes the exact output length) */
  durationTargetSec: number;
  slots: TemplateSlot[];
  /** xfade keys between slots — the last one repeats when shorter than slots-1 */
  transitions: TemplateTransitionKey[];
  /** crossfade seconds per junction (clamped to fit each clip) */
  transitionDurationSec: number;
  overlays: TemplateOverlay[];
  /** "keep" = keep the clips' own audio · "bed" = optional music bed drives the track */
  audioMode: "keep" | "bed";
  /** subtle premium color grade pass */
  grade: "none" | "luxury-gold";
}

export const VIDEO_TEMPLATES: VideoTemplateRecipe[] = [
  {
    key: "photo-dump-montage",
    name: "Photo Dump Montage",
    tagline: "Rapid-fire photo carousel with swipe energy",
    description:
      "Drop in your photos — the engine Ken-Burns each one, swipes between them, and stamps your caption on top. The classic recap dump, done in one tap.",
    aspect: "9:16",
    durationTargetSec: 10,
    slots: Array.from({ length: 12 }, (_, i) => ({
      key: `photo-${i + 1}`,
      label: `Photo ${i + 1}`,
      kind: "photo" as const,
      durationSec: 0.9,
    })),
    transitions: ["slideleft", "slideup", "slideright", "slidedown"],
    transitionDurationSec: 0.35,
    overlays: [
      {
        text: "the dump 📸",
        slotIndex: 0,
        position: "top",
        startSec: 0,
        durationSec: 3,
        size: "lg",
        color: "gold",
      },
      {
        text: "which one's your fave?",
        slotIndex: 8,
        position: "bottom",
        startSec: 0,
        durationSec: 2.4,
        size: "md",
        color: "white",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "lyric-sync-cut",
    name: "Lyric Sync Cut",
    tagline: "Hard cuts on the beat with lyric captions",
    description:
      "Feed in performance clips — the template chops them into beat-length cuts and burns each lyric line across the frame. Built for song promos and snippet drops.",
    aspect: "9:16",
    durationTargetSec: 9,
    slots: Array.from({ length: 6 }, (_, i) => ({
      key: `clip-${i + 1}`,
      label: `Clip ${i + 1}`,
      kind: "video" as const,
      durationSec: 1.6,
    })),
    transitions: ["fade", "fade"],
    transitionDurationSec: 0.18,
    overlays: Array.from({ length: 6 }, (_, i) => ({
      text: `lyric line ${i + 1}`,
      slotIndex: i,
      position: "center" as const,
      startSec: 0,
      durationSec: 1.5,
      size: "lg" as const,
      color: "white" as const,
    })),
    audioMode: "keep",
    grade: "luxury-gold",
  },
  {
    key: "product-promo-punch",
    name: "Product Promo Punch",
    tagline: "Bold product shots with punchy reveals",
    description:
      "Product photos get punch-in reveals, price and CTA stamps, and a hard gold close. Made for drops, restocks, and launch-day posts.",
    aspect: "9:16",
    durationTargetSec: 7,
    slots: [
      { key: "hero", label: "Hero shot", kind: "photo", durationSec: 1.6 },
      { key: "detail-1", label: "Detail 1", kind: "photo", durationSec: 1.2 },
      { key: "detail-2", label: "Detail 2", kind: "photo", durationSec: 1.2 },
      { key: "lifestyle", label: "Lifestyle", kind: "any", durationSec: 1.4 },
      { key: "cta", label: "CTA close", kind: "photo", durationSec: 1.6 },
    ],
    transitions: ["circleopen", "radial", "slideleft", "pixelize"],
    transitionDurationSec: 0.45,
    overlays: [
      {
        text: "NEW DROP",
        slotIndex: 0,
        position: "top",
        startSec: 0.2,
        durationSec: 1.4,
        size: "lg",
        color: "gold",
      },
      {
        text: "$49 — link in bio",
        slotIndex: 4,
        position: "bottom",
        startSec: 0,
        durationSec: 1.6,
        size: "md",
        color: "white",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "before-after-reveal",
    name: "Before/After Reveal",
    tagline: "The satisfying wipe reveal",
    description:
      "Two clips, one dramatic wipe. Before on the left, after on the right — transformations, glow-ups, renovations, and makeovers.",
    aspect: "1:1",
    durationTargetSec: 7,
    slots: [
      { key: "before", label: "Before", kind: "any", durationSec: 3.2 },
      { key: "after", label: "After", kind: "any", durationSec: 3.2 },
    ],
    transitions: ["wipeleft"],
    transitionDurationSec: 0.9,
    overlays: [
      {
        text: "BEFORE",
        slotIndex: 0,
        position: "top",
        startSec: 0,
        durationSec: 2.8,
        size: "md",
        color: "white",
      },
      {
        text: "AFTER",
        slotIndex: 1,
        position: "top",
        startSec: 0,
        durationSec: 3.2,
        size: "md",
        color: "gold",
      },
    ],
    audioMode: "keep",
    grade: "none",
  },
  {
    key: "travel-recap",
    name: "Travel Recap",
    tagline: "Cinematic wanderlust slideshow",
    description:
      "Landscape photos drift with slow cinematic zooms and soft dissolves, location stamps fading in per stop. Your trip, trailer-ified.",
    aspect: "16:9",
    durationTargetSec: 13,
    slots: Array.from({ length: 8 }, (_, i) => ({
      key: `stop-${i + 1}`,
      label: `Stop ${i + 1}`,
      kind: "photo" as const,
      durationSec: 1.8,
    })),
    transitions: ["dissolve", "fade"],
    transitionDurationSec: 0.7,
    overlays: Array.from({ length: 8 }, (_, i) => ({
      text: i === 0 ? "somewhere beautiful ✈️" : `stop ${i + 1}`,
      slotIndex: i,
      position: "bottom" as const,
      startSec: 0.3,
      durationSec: 1.2,
      size: "md" as const,
      color: "white" as const,
    })),
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "talking-head-polish",
    name: "Talking Head Polish",
    tagline: "One-take polish with a pro lower third",
    description:
      "Your talking-head clip gets a cinematic fade in/out, a gold lower-third name card, and balanced audio — instant credibility, zero editing.",
    aspect: "9:16",
    durationTargetSec: 15,
    slots: [
      { key: "take", label: "Your take", kind: "video", durationSec: 15 },
    ],
    transitions: [],
    transitionDurationSec: 0,
    overlays: [
      {
        text: "Your Name • @handle",
        slotIndex: 0,
        position: "bottom",
        startSec: 0.8,
        durationSec: 3.5,
        size: "md",
        color: "gold",
      },
    ],
    audioMode: "keep",
    grade: "luxury-gold",
  },
  {
    key: "hype-trailer",
    name: "Hype Trailer",
    tagline: "Fast cuts, big energy, bigger text",
    description:
      "Eight rapid cuts with punchy transitions and oversized hype captions. For announcements, drops, and anything that needs to feel huge.",
    aspect: "16:9",
    durationTargetSec: 7,
    slots: Array.from({ length: 8 }, (_, i) => ({
      key: `beat-${i + 1}`,
      label: `Beat ${i + 1}`,
      kind: "any" as const,
      durationSec: 1.0,
    })),
    transitions: ["radial", "pixelize", "slideleft", "circlecrop", "hblur"],
    transitionDurationSec: 0.3,
    overlays: [
      {
        text: "IT'S HAPPENING",
        slotIndex: 0,
        position: "center",
        startSec: 0,
        durationSec: 1.8,
        size: "lg",
        color: "gold",
      },
      {
        text: "don't miss it",
        slotIndex: 5,
        position: "center",
        startSec: 0,
        durationSec: 2.2,
        size: "lg",
        color: "white",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "podcast-highlight",
    name: "Podcast Highlight",
    tagline: "The quotable moment, framed",
    description:
      "Your best podcast moment gets a clean square frame, the quote burned across the lower third, and a gold intro fade. Built to be clipped and shared.",
    aspect: "1:1",
    durationTargetSec: 20,
    slots: [
      { key: "moment", label: "The moment", kind: "video", durationSec: 20 },
    ],
    transitions: [],
    transitionDurationSec: 0,
    overlays: [
      {
        text: "\u201cthe quote that broke the internet\u201d",
        slotIndex: 0,
        position: "bottom",
        startSec: 1,
        durationSec: 6,
        size: "md",
        color: "white",
      },
      {
        text: "🎙️ new episode out now",
        slotIndex: 0,
        position: "top",
        startSec: 15,
        durationSec: 4,
        size: "sm",
        color: "gold",
      },
    ],
    audioMode: "keep",
    grade: "none",
  },
];

export function getVideoTemplateRecipe(key: string): VideoTemplateRecipe | null {
  return VIDEO_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Exact output seconds for a recipe (sum of slots minus transitions). */
export function recipeOutputSeconds(recipe: VideoTemplateRecipe): number {
  const total = recipe.slots.reduce((s, slot) => s + slot.durationSec, 0);
  const junctions = Math.max(0, recipe.slots.length - 1);
  return Math.max(0.5, total - junctions * recipe.transitionDurationSec);
}
