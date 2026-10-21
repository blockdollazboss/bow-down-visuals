/* ─── Trending presets — the "Trending Remix Feed" catalog ───
   Curated viral motion/style presets creators can remix with their own
   character. Each preset deep-links into /video-editor via the remixParams:
   - ?fx=<library-fx-slug>      → applies the mapped editor effect + opens the Effects tab
                                 (slug must exist in the library catalog, see LIBRARY_FX_TO_EFFECT)
   - ?transition=<tr-slug>      → applies the mapped transition to every clip + opens Timeline
   - { remix: "<slug>" }        → fallback: the feed's remix button builds the look
                                 (motion and VFX looks that have no library mapping) */

export interface TrendingPreset {
  slug: string;           // url-safe id, e.g. "bullet-time-hero"
  name: string;           // display name, e.g. "Bullet Time Hero"
  description: string;    // 1-2 sentences on the vibe
  category: "Motion" | "Style" | "Transition" | "Effect";
  /** Maps to the video editor's built-in effect/motion names where possible */
  editorEffect?: string;  // e.g. existing effect name from the editor's EFFECTS/COLOR_GRADES catalog
  editorMotion?: string;  // e.g. motion preset name (none exist in the editor yet — leave undefined)
  /** Deep-link into /video-editor — the remix button will use these */
  remixParams: Record<string, string>; // e.g. { fx: "fx-gold-hour" } or { remix: "bullet-time-hero" }
  trendScore: number;     // 1-100, higher = hotter right now
  platform: string[];     // e.g. ["tiktok", "reels", "shorts"]
}

export const TRENDING_PRESETS: TrendingPreset[] = [
  /* ─── Motion ─── */
  {
    slug: "bullet-time-hero",
    name: "Bullet Time Hero",
    description: "Time freezes mid-action while the camera orbits 180 degrees around your character. The Matrix money shot, now pocket-sized.",
    category: "Motion",
    remixParams: { remix: "bullet-time-hero" },
    trendScore: 95,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "crash-zoom-punch",
    name: "Crash Zoom Punch",
    description: "A violent whip-zoom slams into your character's face on the beat drop. Raw hype energy for hooks and intros.",
    category: "Motion",
    remixParams: { remix: "crash-zoom-punch" },
    trendScore: 93,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "fpv-drone-dive",
    name: "FPV Drone Dive",
    description: "A first-person dive from the clouds straight at your character. Pure adrenaline for reveals and entrances.",
    category: "Motion",
    remixParams: { remix: "fpv-drone-dive" },
    trendScore: 88,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "whip-pan-hero",
    name: "Whip Pan",
    description: "A blur-fast sideways pan that snaps your character into frame. The classic sports-edit entrance move.",
    category: "Motion",
    remixParams: { transition: "tr-whip-pan" },
    trendScore: 85,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "smooth-dolly-in",
    name: "Smooth Dolly In",
    description: "A slow, confident push-in from wide to close-up. Cinematic gravity for announcements and big moments.",
    category: "Motion",
    editorEffect: "Slow Zoom",
    remixParams: { remix: "smooth-dolly-in" },
    trendScore: 82,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "floating-fall",
    name: "Floating Fall",
    description: "Your character drifts weightlessly through the air like gravity gave up. Dreamy, otherworldly, hypnotic.",
    category: "Motion",
    remixParams: { remix: "floating-fall" },
    trendScore: 79,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "world-morph",
    name: "World Morph",
    description: "The world transforms around your character — street to neon jungle, day to night — while they stay locked center frame.",
    category: "Motion",
    remixParams: { remix: "world-morph" },
    trendScore: 77,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "slow-mo-power-walk",
    name: "Slow-Mo Power Walk",
    description: "Dramatic slow-motion walk straight at the camera. Main-character energy, zero apologies.",
    category: "Motion",
    editorEffect: "Speed Ramp",
    remixParams: { remix: "slow-mo-power-walk" },
    trendScore: 74,
    platform: ["tiktok", "reels", "shorts"],
  },
  /* ─── Style ─── */
  {
    slug: "gold-luxury-grade",
    name: "Gold Luxury Grade",
    description: "The Bow Down signature: warm golden glow, rich contrast. Everything looks expensive.",
    category: "Style",
    editorEffect: "Luxury Gold",
    remixParams: { fx: "fx-gold-hour" },
    trendScore: 92,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "dark-drill-grade",
    name: "Dark Drill Grade",
    description: "Gritty, crushed-black street grade. The drill video look — cold, heavy, menacing.",
    category: "Style",
    editorEffect: "Dark Drill",
    remixParams: { fx: "fx-ink-black" },
    trendScore: 90,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "neon-night",
    name: "Neon Night",
    description: "Electric neon glow on a midnight city grade. Cyber-street vibes for night anthems.",
    category: "Style",
    editorEffect: "Neon Glow",
    remixParams: { fx: "fx-neon-nights" },
    trendScore: 86,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "vintage-film",
    name: "Vintage Film",
    description: "Faded 70s film stock warmth. Nostalgic, soulful, timeless — perfect for storytelling cuts.",
    category: "Style",
    editorEffect: "Warm Grade",
    remixParams: { fx: "fx-vintage-film" },
    trendScore: 73,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "anime-pop",
    name: "Anime Pop",
    description: "Hyper-saturated candy colors that pop off the screen. Bold, loud, impossible to scroll past.",
    category: "Style",
    editorEffect: "Vibrant Pop",
    remixParams: { fx: "fx-candy-pop" },
    trendScore: 81,
    platform: ["tiktok", "reels", "shorts"],
  },
  /* ─── Transition ─── */
  {
    slug: "match-cut-snap",
    name: "Match Cut Snap",
    description: "Two matching shapes snap together across the cut. Feels like one continuous impossible move.",
    category: "Transition",
    remixParams: { transition: "tr-morph-zoom" },
    trendScore: 89,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "whoosh-wipe",
    name: "Whoosh Wipe",
    description: "A clean directional whoosh wipes one scene into the next. Fast, punchy, endlessly reusable.",
    category: "Transition",
    remixParams: { transition: "tr-slide-wipe" },
    trendScore: 78,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "zoom-flash",
    name: "Zoom Flash",
    description: "Radial zoom punch into the next scene. Maximum impact for beat switches and drops.",
    category: "Transition",
    remixParams: { transition: "tr-zoom-burst" },
    trendScore: 84,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "glitch-cut",
    name: "Glitch Cut",
    description: "The frame tears apart in digital glitch before snapping to the next scene. Chaos, but make it clean.",
    category: "Transition",
    remixParams: { transition: "tr-glitch-cut" },
    trendScore: 76,
    platform: ["tiktok", "reels", "shorts"],
  },
  /* ─── Effect ─── */
  {
    slug: "film-grain-storm",
    name: "Film Grain Storm",
    description: "Heavy rolling film grain that makes everything feel shot on 16mm. Texture for days.",
    category: "Effect",
    editorEffect: "Film Grain",
    remixParams: { remix: "film-grain-storm" },
    trendScore: 71,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "light-leaks",
    name: "Light Leaks",
    description: "Warm golden light bleeds across the frame like sun hitting old film. Instant nostalgia glow.",
    category: "Effect",
    editorEffect: "Glow",
    remixParams: { remix: "light-leaks" },
    trendScore: 69,
    platform: ["tiktok", "reels", "shorts"],
  },
  {
    slug: "particle-burst",
    name: "Particle Burst",
    description: "A burst of glowing particles erupts around your character. Magic spark energy for reveals.",
    category: "Effect",
    remixParams: { remix: "particle-burst" },
    trendScore: 72,
    platform: ["tiktok", "reels", "shorts"],
  },
];

export function getTrendingPreset(slug: string): TrendingPreset | undefined {
  return TRENDING_PRESETS.find((p) => p.slug === slug);
}
