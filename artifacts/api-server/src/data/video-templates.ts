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
  {
    key: "launch-announcement",
    name: "Launch Announcement",
    tagline: "Tease it, reveal it, date it",
    description:
      "A three-act launch post: a shadowy teaser, the big reveal, then the details. Built for drop days, grand openings, and first episodes.",
    aspect: "9:16",
    durationTargetSec: 7,
    slots: [
      { key: "teaser", label: "Teaser", kind: "any", durationSec: 1.4 },
      { key: "reveal", label: "The reveal", kind: "any", durationSec: 2 },
      { key: "in-action", label: "In action", kind: "any", durationSec: 1.6 },
      { key: "details", label: "Details close", kind: "any", durationSec: 2 },
    ],
    transitions: ["fadeblack", "circleopen", "fade"],
    transitionDurationSec: 0.4,
    overlays: [
      {
        text: "SOMETHING IS COMING",
        slotIndex: 0,
        position: "top",
        startSec: 0.2,
        durationSec: 1.2,
        size: "lg",
        color: "gold",
      },
      {
        text: "IT'S HERE",
        slotIndex: 1,
        position: "center",
        startSec: 0.1,
        durationSec: 1.6,
        size: "lg",
        color: "gold",
      },
      {
        text: "tap the link to get yours",
        slotIndex: 3,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.6,
        size: "md",
        color: "white",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "product-showcase",
    name: "Product Showcase",
    tagline: "A slow, premium walk-around",
    description:
      "Landscape product tour: hero angle, two feature close-ups, the product in real life, and a clean closing card. Callouts land on each feature as it appears.",
    aspect: "16:9",
    durationTargetSec: 10,
    slots: [
      { key: "hero", label: "Hero angle", kind: "any", durationSec: 2 },
      { key: "feature-1", label: "Feature 1", kind: "any", durationSec: 1.8 },
      { key: "feature-2", label: "Feature 2", kind: "any", durationSec: 1.8 },
      { key: "in-use", label: "In real life", kind: "video", durationSec: 2.2 },
      { key: "close", label: "Closing card", kind: "any", durationSec: 1.8 },
    ],
    transitions: ["dissolve", "fade", "dissolve", "fadeblack"],
    transitionDurationSec: 0.5,
    overlays: [
      {
        text: "meet your new favorite",
        slotIndex: 0,
        position: "bottom",
        startSec: 0.3,
        durationSec: 1.5,
        size: "md",
        color: "white",
      },
      {
        text: "feature one",
        slotIndex: 1,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.4,
        size: "md",
        color: "gold",
      },
      {
        text: "feature two",
        slotIndex: 2,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.4,
        size: "md",
        color: "gold",
      },
      {
        text: "link in bio to shop",
        slotIndex: 4,
        position: "center",
        startSec: 0.2,
        durationSec: 1.4,
        size: "lg",
        color: "gold",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "sale-announcement",
    name: "Sale Announcement",
    tagline: "The offer, loud and clear",
    description:
      "Deal-first and direct: your offer stamped big over product shots, the details underneath, and a hard close on how to claim it. No timers, no games — just the offer.",
    aspect: "9:16",
    durationTargetSec: 6,
    slots: [
      { key: "hero", label: "Hero shot", kind: "photo", durationSec: 1.6 },
      { key: "product-1", label: "Product 1", kind: "photo", durationSec: 1.4 },
      { key: "product-2", label: "Product 2", kind: "photo", durationSec: 1.4 },
      { key: "close", label: "CTA close", kind: "photo", durationSec: 1.8 },
    ],
    transitions: ["circleopen", "slideleft", "fadeblack"],
    transitionDurationSec: 0.4,
    overlays: [
      {
        text: "SALE — UP TO 40% OFF",
        slotIndex: 0,
        position: "center",
        startSec: 0.2,
        durationSec: 1.3,
        size: "lg",
        color: "gold",
      },
      {
        text: "the details they need",
        slotIndex: 2,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.1,
        size: "md",
        color: "white",
      },
      {
        text: "link in bio — go",
        slotIndex: 3,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.4,
        size: "md",
        color: "gold",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "seasonal-drop",
    name: "Seasonal Drop",
    tagline: "This season only",
    description:
      "A limited-run drop wrapped in the season's mood: a moody opener, the pieces one by one, and a while-it's-here close. Holidays, capsules, and limited runs.",
    aspect: "9:16",
    durationTargetSec: 8,
    slots: [
      { key: "opener", label: "Mood opener", kind: "any", durationSec: 1.8 },
      { key: "piece-1", label: "Piece 1", kind: "photo", durationSec: 1.4 },
      { key: "piece-2", label: "Piece 2", kind: "photo", durationSec: 1.4 },
      { key: "piece-3", label: "Piece 3", kind: "photo", durationSec: 1.4 },
      { key: "close", label: "Closing shot", kind: "any", durationSec: 1.8 },
    ],
    transitions: ["fadeblack", "dissolve", "dissolve", "fade"],
    transitionDurationSec: 0.45,
    overlays: [
      {
        text: "THE SEASON DROP",
        slotIndex: 0,
        position: "top",
        startSec: 0.3,
        durationSec: 1.4,
        size: "lg",
        color: "gold",
      },
      {
        text: "limited run — while it's here",
        slotIndex: 4,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.4,
        size: "md",
        color: "white",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "testimonial-spotlight",
    name: "Testimonial Spotlight",
    tagline: "A happy customer, in their own words",
    description:
      "One testimonial clip framed with a big pull-quote and a five-star stamp — the review your future customers actually believe.",
    aspect: "9:16",
    durationTargetSec: 12,
    slots: [
      { key: "testimonial", label: "Their words", kind: "video", durationSec: 12 },
    ],
    transitions: [],
    transitionDurationSec: 0,
    overlays: [
      {
        text: "★★★★★",
        slotIndex: 0,
        position: "top",
        startSec: 0.6,
        durationSec: 3,
        size: "md",
        color: "gold",
      },
      {
        text: "\u201cthe words that sell it for you\u201d",
        slotIndex: 0,
        position: "bottom",
        startSec: 1.2,
        durationSec: 5,
        size: "md",
        color: "white",
      },
      {
        text: "— a real customer",
        slotIndex: 0,
        position: "bottom",
        startSec: 6.4,
        durationSec: 3,
        size: "sm",
        color: "gold",
      },
    ],
    audioMode: "keep",
    grade: "none",
  },
  {
    key: "quote-card",
    name: "Quote Card",
    tagline: "One line worth framing",
    description:
      "Your strongest line over a slow-drifting photo, set big and gold, with your name signed underneath. Made for saves, shares, and story reposts.",
    aspect: "1:1",
    durationTargetSec: 6,
    slots: [
      { key: "backdrop", label: "Backdrop photo", kind: "photo", durationSec: 6 },
    ],
    transitions: [],
    transitionDurationSec: 0,
    overlays: [
      {
        text: "\u201cyour strongest line here\u201d",
        slotIndex: 0,
        position: "center",
        startSec: 0.5,
        durationSec: 4.5,
        size: "lg",
        color: "gold",
      },
      {
        text: "— your name",
        slotIndex: 0,
        position: "bottom",
        startSec: 4.2,
        durationSec: 1.5,
        size: "sm",
        color: "white",
      },
    ],
    audioMode: "bed",
    grade: "none",
  },
  {
    key: "event-recap",
    name: "Event Recap",
    tagline: "The whole night, one highlight reel",
    description:
      "Eight fast hits — doors, crowd, stage, the moment everyone lost it — cut hard with your event name stamped over the peak. Relive it, then sell the next one.",
    aspect: "9:16",
    durationTargetSec: 13,
    slots: [
      { key: "doors", label: "Doors open", kind: "any", durationSec: 1.2 },
      { key: "crowd", label: "The crowd", kind: "any", durationSec: 1.2 },
      { key: "stage", label: "On stage", kind: "any", durationSec: 1.6 },
      { key: "moment", label: "The moment", kind: "any", durationSec: 2 },
      { key: "crowd-2", label: "Crowd goes up", kind: "any", durationSec: 1.2 },
      { key: "stage-2", label: "Back to stage", kind: "any", durationSec: 1.6 },
      { key: "finale", label: "The finale", kind: "any", durationSec: 2 },
      { key: "closing", label: "Closing shot", kind: "any", durationSec: 1.4 },
    ],
    transitions: ["fade", "slideleft", "fade", "radial", "fade", "slideleft", "fade"],
    transitionDurationSec: 0.25,
    overlays: [
      {
        text: "LAST NIGHT WAS A MOVIE",
        slotIndex: 0,
        position: "center",
        startSec: 0.1,
        durationSec: 1.6,
        size: "lg",
        color: "gold",
      },
      {
        text: "the moment it went up",
        slotIndex: 3,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.6,
        size: "md",
        color: "white",
      },
      {
        text: "next date — link in bio",
        slotIndex: 7,
        position: "bottom",
        startSec: 0.2,
        durationSec: 1.2,
        size: "md",
        color: "gold",
      },
    ],
    audioMode: "bed",
    grade: "luxury-gold",
  },
  {
    key: "tutorial-steps",
    name: "Tutorial Steps",
    tagline: "Step one, step two, done",
    description:
      "An intro card, four steps each stamped with its number as it plays, and a clean you're-done close. How-tos, recipes, setups, and routines.",
    aspect: "9:16",
    durationTargetSec: 15,
    slots: [
      { key: "intro", label: "Intro", kind: "any", durationSec: 1.6 },
      { key: "step-1", label: "Step 1", kind: "video", durationSec: 3 },
      { key: "step-2", label: "Step 2", kind: "video", durationSec: 3 },
      { key: "step-3", label: "Step 3", kind: "video", durationSec: 3 },
      { key: "step-4", label: "Step 4", kind: "video", durationSec: 3 },
      { key: "done", label: "Done card", kind: "any", durationSec: 1.8 },
    ],
    transitions: ["fade"],
    transitionDurationSec: 0.3,
    overlays: [
      {
        text: "HOW TO: your thing",
        slotIndex: 0,
        position: "center",
        startSec: 0.2,
        durationSec: 1.3,
        size: "lg",
        color: "gold",
      },
      {
        text: "STEP 1",
        slotIndex: 1,
        position: "top",
        startSec: 0.15,
        durationSec: 1.2,
        size: "md",
        color: "gold",
      },
      {
        text: "STEP 2",
        slotIndex: 2,
        position: "top",
        startSec: 0.15,
        durationSec: 1.2,
        size: "md",
        color: "gold",
      },
      {
        text: "STEP 3",
        slotIndex: 3,
        position: "top",
        startSec: 0.15,
        durationSec: 1.2,
        size: "md",
        color: "gold",
      },
      {
        text: "STEP 4",
        slotIndex: 4,
        position: "top",
        startSec: 0.15,
        durationSec: 1.2,
        size: "md",
        color: "gold",
      },
      {
        text: "and you're done ✓",
        slotIndex: 5,
        position: "center",
        startSec: 0.2,
        durationSec: 1.4,
        size: "lg",
        color: "gold",
      },
    ],
    audioMode: "keep",
    grade: "none",
  },
  {
    key: "podcast-clip-vertical",
    name: "Podcast Clip",
    tagline: "The moment, cut vertical",
    description:
      "Your podcast's best stretch in vertical: a hook line up top in the first breath, the exchange in the middle, and the show name stamped at the close.",
    aspect: "9:16",
    durationTargetSec: 30,
    slots: [
      { key: "clip", label: "The exchange", kind: "video", durationSec: 30 },
    ],
    transitions: [],
    transitionDurationSec: 0,
    overlays: [
      {
        text: "the hook line goes here",
        slotIndex: 0,
        position: "top",
        startSec: 0.5,
        durationSec: 4,
        size: "lg",
        color: "gold",
      },
      {
        text: "your show name — new episode out now",
        slotIndex: 0,
        position: "bottom",
        startSec: 26,
        durationSec: 3.5,
        size: "sm",
        color: "white",
      },
    ],
    audioMode: "keep",
    grade: "none",
  },
  {
    key: "lyric-video-landscape",
    name: "Lyric Video",
    tagline: "The full song, every word framed",
    description:
      "Landscape lyric layout for the official upload: your performance or visual loop underneath, each lyric line centered and timed to its section. The long-form companion to the snippet cut.",
    aspect: "16:9",
    durationTargetSec: 12,
    slots: Array.from({ length: 4 }, (_, i) => ({
      key: `section-${i + 1}`,
      label: `Section ${i + 1}`,
      kind: "video" as const,
      durationSec: 3,
    })),
    transitions: ["fade"],
    transitionDurationSec: 0.25,
    overlays: Array.from({ length: 4 }, (_, i) => ({
      text: `lyric line ${i + 1}`,
      slotIndex: i,
      position: "center" as const,
      startSec: 0.2,
      durationSec: 2.6,
      size: "lg" as const,
      color: "white" as const,
    })),
    audioMode: "keep",
    grade: "luxury-gold",
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
