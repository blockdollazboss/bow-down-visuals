/**
 * Video edit template display metadata — used by the public
 * /templates/videos gallery (no login) and the Video Editor Templates tab.
 * The render recipes themselves live server-side
 * (api-server/src/data/video-templates.ts); this file is display-only.
 */
import { getCreditCost } from "@/lib/credit-costs";

export interface VideoTemplateMeta {
  key: string;
  name: string;
  tagline: string;
  description: string;
  aspect: "9:16" | "16:9" | "1:1";
  durationLabel: string;
  slotCount: number;
  category: string;
  /** punchy outcome line for the gallery card */
  outcome: string;
}

export const VIDEO_TEMPLATE_METAS: VideoTemplateMeta[] = [
  {
    key: "photo-dump-montage",
    name: "Photo Dump Montage",
    tagline: "Rapid-fire photo carousel with swipe energy",
    description:
      "Drop in your photos — each one gets a cinematic Ken Burns drift, swipe transitions carry the momentum, and your caption stamps on top. The classic recap dump, done in one tap.",
    aspect: "9:16",
    durationLabel: "~7s",
    slotCount: 12,
    category: "Slideshow",
    outcome: "Recap dumps that feel like a music video",
  },
  {
    key: "lyric-sync-cut",
    name: "Lyric Sync Cut",
    tagline: "Hard cuts on the beat with lyric captions",
    description:
      "Feed in performance clips — the template chops them into beat-length cuts and burns each lyric line across the frame. Built for song promos and snippet drops.",
    aspect: "9:16",
    durationLabel: "~9s",
    slotCount: 6,
    category: "Music",
    outcome: "Snippet drops with burned-in lyric lines",
  },
  {
    key: "product-promo-punch",
    name: "Product Promo Punch",
    tagline: "Bold product shots with punchy reveals",
    description:
      "Product photos get iris and radial reveals, price and CTA stamps, and a hard gold close. Made for drops, restocks, and launch-day posts.",
    aspect: "9:16",
    durationLabel: "~5s",
    slotCount: 5,
    category: "Promo",
    outcome: "Launch-day promos with a gold CTA close",
  },
  {
    key: "before-after-reveal",
    name: "Before/After Reveal",
    tagline: "The satisfying wipe reveal",
    description:
      "Two clips, one dramatic wipe. Before on the left, after on the right — transformations, glow-ups, renovations, and makeovers.",
    aspect: "1:1",
    durationLabel: "~6s",
    slotCount: 2,
    category: "Reveal",
    outcome: "Glow-ups with the satisfying wipe",
  },
  {
    key: "travel-recap",
    name: "Travel Recap",
    tagline: "Cinematic wanderlust slideshow",
    description:
      "Landscape photos drift with slow cinematic zooms and soft dissolves while location stamps fade in per stop. Your trip, trailer-ified.",
    aspect: "16:9",
    durationLabel: "~10s",
    slotCount: 8,
    category: "Slideshow",
    outcome: "Trip recaps that look like a film trailer",
  },
  {
    key: "talking-head-polish",
    name: "Talking Head Polish",
    tagline: "One-take polish with a pro lower third",
    description:
      "Your talking-head clip gets a cinematic fade in/out, a gold lower-third name card, and balanced audio — instant credibility, zero editing.",
    aspect: "9:16",
    durationLabel: "~15s",
    slotCount: 1,
    category: "Creator",
    outcome: "One-take videos with a pro lower third",
  },
  {
    key: "hype-trailer",
    name: "Hype Trailer",
    tagline: "Fast cuts, big energy, bigger text",
    description:
      "Eight rapid cuts with punchy radial and pixel transitions plus oversized hype captions. For announcements, drops, and anything that needs to feel huge.",
    aspect: "16:9",
    durationLabel: "~6s",
    slotCount: 8,
    category: "Promo",
    outcome: "Announcements that feel huge",
  },
  {
    key: "podcast-highlight",
    name: "Podcast Highlight",
    tagline: "The quotable moment, framed",
    description:
      "Your best podcast moment gets a clean square frame, the quote burned across the lower third, and a gold intro fade. Built to be clipped and shared.",
    aspect: "1:1",
    durationLabel: "~20s",
    slotCount: 1,
    category: "Podcast",
    outcome: "Quotable moments, framed to be shared",
  },
  {
    key: "launch-announcement",
    name: "Launch Announcement",
    tagline: "Tease it, reveal it, date it",
    description:
      "A three-act launch post: a shadowy teaser, the big reveal, then the details. Built for drop days, grand openings, and first episodes.",
    aspect: "9:16",
    durationLabel: "~6s",
    slotCount: 4,
    category: "Promo",
    outcome: "Drop days that feel like premieres",
  },
  {
    key: "product-showcase",
    name: "Product Showcase",
    tagline: "A slow, premium walk-around",
    description:
      "Landscape product tour: hero angle, two feature close-ups, the product in real life, and a clean closing card. Callouts land on each feature as it appears.",
    aspect: "16:9",
    durationLabel: "~8s",
    slotCount: 5,
    category: "Promo",
    outcome: "Product tours with feature callouts",
  },
  {
    key: "sale-announcement",
    name: "Sale Announcement",
    tagline: "The offer, loud and clear",
    description:
      "Deal-first and direct: your offer stamped big over product shots, the details underneath, and a hard close on how to claim it. No timers, no games — just the offer.",
    aspect: "9:16",
    durationLabel: "~5s",
    slotCount: 4,
    category: "Promo",
    outcome: "Offers nobody can scroll past",
  },
  {
    key: "seasonal-drop",
    name: "Seasonal Drop",
    tagline: "This season only",
    description:
      "A limited-run drop wrapped in the season's mood: a moody opener, the pieces one by one, and a while-it's-here close. Holidays, capsules, and limited runs.",
    aspect: "9:16",
    durationLabel: "~6s",
    slotCount: 5,
    category: "Promo",
    outcome: "Limited runs wrapped in the season",
  },
  {
    key: "testimonial-spotlight",
    name: "Testimonial Spotlight",
    tagline: "A happy customer, in their own words",
    description:
      "One testimonial clip framed with a big pull-quote and a five-star stamp — the review your future customers actually believe.",
    aspect: "9:16",
    durationLabel: "~12s",
    slotCount: 1,
    category: "Creator",
    outcome: "Reviews your next customers believe",
  },
  {
    key: "quote-card",
    name: "Quote Card",
    tagline: "One line worth framing",
    description:
      "Your strongest line over a slow-drifting photo, set big and gold, with your name signed underneath. Made for saves, shares, and story reposts.",
    aspect: "1:1",
    durationLabel: "~6s",
    slotCount: 1,
    category: "Creator",
    outcome: "Lines worth saving and sharing",
  },
  {
    key: "event-recap",
    name: "Event Recap",
    tagline: "The whole night, one highlight reel",
    description:
      "Eight fast hits — doors, crowd, stage, the moment everyone lost it — cut hard with your event name stamped over the peak. Relive it, then sell the next one.",
    aspect: "9:16",
    durationLabel: "~11s",
    slotCount: 8,
    category: "Slideshow",
    outcome: "Nights relived in one reel",
  },
  {
    key: "tutorial-steps",
    name: "Tutorial Steps",
    tagline: "Step one, step two, done",
    description:
      "An intro card, four steps each stamped with its number as it plays, and a clean you're-done close. How-tos, recipes, setups, and routines.",
    aspect: "9:16",
    durationLabel: "~14s",
    slotCount: 6,
    category: "Tutorial",
    outcome: "How-tos with every step stamped",
  },
  {
    key: "podcast-clip-vertical",
    name: "Podcast Clip",
    tagline: "The moment, cut vertical",
    description:
      "Your podcast's best stretch in vertical: a hook line up top in the first breath, the exchange in the middle, and the show name stamped at the close.",
    aspect: "9:16",
    durationLabel: "~30s",
    slotCount: 1,
    category: "Podcast",
    outcome: "Best moments, cut for the feed",
  },
  {
    key: "lyric-video-landscape",
    name: "Lyric Video",
    tagline: "The full song, every word framed",
    description:
      "Landscape lyric layout for the official upload: your performance or visual loop underneath, each lyric line centered and timed to its section. The long-form companion to the snippet cut.",
    aspect: "16:9",
    durationLabel: "~11s",
    slotCount: 4,
    category: "Music",
    outcome: "Full-song lyric videos, framed",
  },
];

export const VIDEO_TEMPLATE_CATEGORIES = [
  "All",
  "Slideshow",
  "Music",
  "Promo",
  "Reveal",
  "Creator",
  "Podcast",
  "Tutorial",
];

export function getVideoTemplateMeta(key: string): VideoTemplateMeta | null {
  return VIDEO_TEMPLATE_METAS.find((t) => t.key === key) ?? null;
}

/**
 * Flat price of applying any template in this gallery, in Visual Bucs.
 * Read from the central CREDIT_COSTS registry — the same entry the
 * editor's pre-spend confirmation dialog quotes for
 * POST /api/video-template/apply — never a second hardcoded copy, so
 * the gallery card cannot drift from the charge: the rail's
 * TEMPLATE_COST is pinned equal to the registry in
 * credit-costs-rail-truth.test.ts, and this export is pinned to the
 * rail in video-template-gallery-price.test.ts. Null only if the
 * registry entry ever disappears; the gallery then renders no price
 * chip rather than a wrong price.
 */
export const VIDEO_TEMPLATE_APPLY_COST: number | null =
  getCreditCost("/api/video-template/apply")?.cost ?? null;
