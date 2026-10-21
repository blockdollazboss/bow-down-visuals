/**
 * Video edit template display metadata — used by the public
 * /templates/videos gallery (no login) and the Video Editor Templates tab.
 * The render recipes themselves live server-side
 * (api-server/src/data/video-templates.ts); this file is display-only.
 */

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
];

export const VIDEO_TEMPLATE_CATEGORIES = [
  "All",
  "Slideshow",
  "Music",
  "Promo",
  "Reveal",
  "Creator",
  "Podcast",
];

export function getVideoTemplateMeta(key: string): VideoTemplateMeta | null {
  return VIDEO_TEMPLATE_METAS.find((t) => t.key === key) ?? null;
}
