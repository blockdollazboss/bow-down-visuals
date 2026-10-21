/* ─── Thy Library — preset catalog ───
   Effect presets, text styles, and transitions. Data-driven; each preset
   carries the CSS/effect config the tools apply on "Use". */

export type LibraryPresetCategory = "Effects" | "Text Styles" | "Transitions";

export interface LibraryPreset {
  slug: string;
  name: string;
  blurb: string;
  category: LibraryPresetCategory;
  /** CSS filter string applied as a live preview + handed to the tool. */
  cssFilter: string;
  /** Accent gradient for the card. */
  gradient: string;
  /** Deep-link into the tool with this preset applied. */
  useUrl: string;
  toolLabel: string;
}

export const LIBRARY_PRESET_CATEGORIES: LibraryPresetCategory[] = [
  "Effects",
  "Text Styles",
  "Transitions",
];

const EDITOR_LINK = "/video-editor";

/* ─── 30 effect presets (color grades / looks) ─── */
interface EffectSeed { slug: string; name: string; blurb: string; cssFilter: string; gradient: string; }

const EFFECT_SEEDS: EffectSeed[] = [
  { slug: "fx-gold-hour", name: "Gold Hour", blurb: "Warm golden glow. The Bow Down signature.", cssFilter: "sepia(0.35) saturate(1.4) contrast(1.05) brightness(1.02)", gradient: "linear-gradient(135deg,#a16207,#0a0a0a)" },
  { slug: "fx-cinematic-teal", name: "Cinematic Teal", blurb: "Blockbuster teal-and-orange grade.", cssFilter: "saturate(1.2) contrast(1.15) hue-rotate(-8deg)", gradient: "linear-gradient(135deg,#0e7490,#020617)" },
  { slug: "fx-noir", name: "Noir", blurb: "High-contrast black and white.", cssFilter: "grayscale(1) contrast(1.3) brightness(0.95)", gradient: "linear-gradient(135deg,#27272a,#0a0a0a)" },
  { slug: "fx-vintage-film", name: "Vintage Film", blurb: "Faded 70s film stock.", cssFilter: "sepia(0.5) contrast(0.9) brightness(1.05) saturate(0.8)", gradient: "linear-gradient(135deg,#713f12,#1a0a00)" },
  { slug: "fx-neon-nights", name: "Neon Nights", blurb: "Pumped saturation, electric night.", cssFilter: "saturate(1.8) contrast(1.2) hue-rotate(10deg)", gradient: "linear-gradient(135deg,#831843,#020617)" },
  { slug: "fx-moody-blue", name: "Moody Blue", blurb: "Cold desaturated drama.", cssFilter: "saturate(0.7) contrast(1.1) hue-rotate(15deg) brightness(0.95)", gradient: "linear-gradient(135deg,#1e3a8a,#020617)" },
  { slug: "fx-sunset-bloom", name: "Sunset Bloom", blurb: "Warm haze, soft highlights.", cssFilter: "sepia(0.25) saturate(1.3) brightness(1.08) contrast(0.95)", gradient: "linear-gradient(135deg,#c2410c,#0a0a0a)" },
  { slug: "fx-cyberpunk", name: "Cyberpunk", blurb: "Magenta shadows, cyan highs.", cssFilter: "saturate(1.6) contrast(1.25) hue-rotate(-25deg)", gradient: "linear-gradient(135deg,#a21caf,#020617)" },
  { slug: "fx-forest-mist", name: "Forest Mist", blurb: "Muted greens, dreamy softness.", cssFilter: "saturate(0.85) hue-rotate(20deg) brightness(1.02) contrast(0.95)", gradient: "linear-gradient(135deg,#14532d,#020617)" },
  { slug: "fx-desert-heat", name: "Desert Heat", blurb: "Baked oranges, crushed blacks.", cssFilter: "sepia(0.4) saturate(1.3) contrast(1.15)", gradient: "linear-gradient(135deg,#92400e,#0a0a0a)" },
  { slug: "fx-arctic", name: "Arctic", blurb: "Icy blues, crisp whites.", cssFilter: "saturate(0.8) hue-rotate(25deg) brightness(1.1) contrast(1.05)", gradient: "linear-gradient(135deg,#0c4a6e,#020617)" },
  { slug: "fx-blood-moon", name: "Blood Moon", blurb: "Deep red shadows. Horror vibe.", cssFilter: "saturate(1.2) hue-rotate(-40deg) contrast(1.2) brightness(0.9)", gradient: "linear-gradient(135deg,#7f1d1d,#0a0a0a)" },
  { slug: "fx-lavender-dream", name: "Lavender Dream", blurb: "Soft purple haze.", cssFilter: "saturate(1.1) hue-rotate(30deg) brightness(1.05)", gradient: "linear-gradient(135deg,#7e22ce,#0a0a0a)" },
  { slug: "fx-emerald-city", name: "Emerald City", blurb: "Rich green luxury.", cssFilter: "saturate(1.3) hue-rotate(25deg) contrast(1.1)", gradient: "linear-gradient(135deg,#047857,#020617)" },
  { slug: "fx-champagne", name: "Champagne", blurb: "Bright, airy, expensive.", cssFilter: "brightness(1.12) saturate(1.05) contrast(0.95)", gradient: "linear-gradient(135deg,#d4a24e,#0a0a0a)" },
  { slug: "fx-midnight-oil", name: "Midnight Oil", blurb: "Dark, rich, late-night.", cssFilter: "brightness(0.85) contrast(1.25) saturate(1.1)", gradient: "linear-gradient(135deg,#111827,#0a0a0a)" },
  { slug: "fx-candy-pop", name: "Candy Pop", blurb: "Hyper-saturated pop.", cssFilter: "saturate(2) contrast(1.1) brightness(1.05)", gradient: "linear-gradient(135deg,#db2777,#0a0a0a)" },
  { slug: "fx-old-money", name: "Old Money", blurb: "Muted, tasteful, timeless.", cssFilter: "saturate(0.75) contrast(1.05) sepia(0.15)", gradient: "linear-gradient(135deg,#57534e,#0a0a0a)" },
  { slug: "fx-toxic", name: "Toxic", blurb: "Acid green highlights.", cssFilter: "saturate(1.5) hue-rotate(45deg) contrast(1.15)", gradient: "linear-gradient(135deg,#4d7c0f,#020617)" },
  { slug: "fx-ultraviolet", name: "Ultraviolet", blurb: "Deep purple shadows.", cssFilter: "saturate(1.3) hue-rotate(40deg) brightness(0.95)", gradient: "linear-gradient(135deg,#5b21b6,#0a0a0a)" },
  { slug: "fx-paper-white", name: "Paper White", blurb: "Clean bright minimal.", cssFilter: "brightness(1.15) contrast(0.9) saturate(0.9)", gradient: "linear-gradient(135deg,#e7e5e4,#0a0a0a)" },
  { slug: "fx-ember", name: "Ember", blurb: "Smoldering warm darks.", cssFilter: "sepia(0.3) contrast(1.2) brightness(0.92) saturate(1.2)", gradient: "linear-gradient(135deg,#9a3412,#0a0a0a)" },
  { slug: "fx-tide", name: "Tide", blurb: "Ocean teal wash.", cssFilter: "saturate(1.15) hue-rotate(18deg) brightness(1.0)", gradient: "linear-gradient(135deg,#155e75,#020617)" },
  { slug: "fx-royal", name: "Royal", blurb: "Purple and gold. Crown energy.", cssFilter: "saturate(1.25) hue-rotate(-10deg) contrast(1.1)", gradient: "linear-gradient(135deg,#713f12,#0a0a0a)" },
  { slug: "fx-static-vhs", name: "Static VHS", blurb: "Tracking-error nostalgia.", cssFilter: "saturate(1.1) contrast(1.1) sepia(0.2)", gradient: "linear-gradient(135deg,#3f3f46,#0a0a0a)" },
  { slug: "fx-rose-gold", name: "Rosé Gold", blurb: "Pink-gold glam.", cssFilter: "sepia(0.25) saturate(1.35) hue-rotate(-15deg) brightness(1.05)", gradient: "linear-gradient(135deg,#be5a38,#0a0a0a)" },
  { slug: "fx-ink-black", name: "Ink Black", blurb: "Crushed, inky, dramatic.", cssFilter: "contrast(1.4) brightness(0.88) saturate(0.9)", gradient: "linear-gradient(135deg,#09090b,#000000)" },
  { slug: "fx-honey", name: "Honey", blurb: "Thick warm sweetness.", cssFilter: "sepia(0.45) saturate(1.25) brightness(1.03)", gradient: "linear-gradient(135deg,#b45309,#0a0a0a)" },
  { slug: "fx-storm", name: "Storm", blurb: "Desaturated tension.", cssFilter: "saturate(0.6) contrast(1.2) brightness(0.92)", gradient: "linear-gradient(135deg,#374151,#020617)" },
  { slug: "fx-gilded", name: "Gilded", blurb: "Everything dipped in gold.", cssFilter: "sepia(0.55) saturate(1.5) contrast(1.08)", gradient: "linear-gradient(135deg,#d4a017,#0a0a0a)" },
];

const effectPresets: LibraryPreset[] = EFFECT_SEEDS.map((s) => ({
  ...s,
  category: "Effects" as const,
  useUrl: `${EDITOR_LINK}?fx=${s.slug}`,
  toolLabel: "Visual Vibes",
}));

/* ─── 20 text style presets ─── */
interface TextSeed { slug: string; name: string; blurb: string; cssFilter: string; gradient: string; fontFamily: string; }

const TEXT_SEEDS: TextSeed[] = [
  { slug: "txt-beast-mode", name: "Beast Mode", blurb: "Thick black outline, all caps screamer.", cssFilter: "none", gradient: "linear-gradient(135deg,#7c2d12,#0a0a0a)", fontFamily: "'Anton', sans-serif" },
  { slug: "txt-luxe-serif", name: "Luxe Serif", blurb: "Elegant gold serif. Quiet luxury.", cssFilter: "none", gradient: "linear-gradient(135deg,#a16207,#0a0a0a)", fontFamily: "'Playfair Display', serif" },
  { slug: "txt-street-tag", name: "Street Tag", blurb: "Graffiti marker scrawl.", cssFilter: "none", gradient: "linear-gradient(135deg,#831843,#0a0a0a)", fontFamily: "'Permanent Marker', cursive" },
  { slug: "txt-neon-glow", name: "Neon Glow", blurb: "Glowing neon tube text.", cssFilter: "none", gradient: "linear-gradient(135deg,#0e7490,#020617)", fontFamily: "'Bebas Neue', sans-serif" },
  { slug: "txt-bubble-pop", name: "Bubble Pop", blurb: "Round chunky cartoon letters.", cssFilter: "none", gradient: "linear-gradient(135deg,#db2777,#0a0a0a)", fontFamily: "'Titan One', cursive" },
  { slug: "txt-condensed-punch", name: "Condensed Punch", blurb: "Tall narrow impact type.", cssFilter: "none", gradient: "linear-gradient(135deg,#1e3a8a,#020617)", fontFamily: "'Barlow Condensed', sans-serif" },
  { slug: "txt-slab-authority", name: "Slab Authority", blurb: "Heavy slab serif. Means business.", cssFilter: "none", gradient: "linear-gradient(135deg,#44403c,#0a0a0a)", fontFamily: "'Alfa Slab One', serif" },
  { slug: "txt-archivo-black", name: "Archive Black", blurb: "Maximum weight grotesque.", cssFilter: "none", gradient: "linear-gradient(135deg,#18181b,#0a0a0a)", fontFamily: "'Archivo Black', sans-serif" },
  { slug: "txt-righteous", name: "Righteous", blurb: "Geometric retro-future.", cssFilter: "none", gradient: "linear-gradient(135deg,#6b21a8,#0a0a0a)", fontFamily: "'Righteous', cursive" },
  { slug: "txt-bungee", name: "Bungee", blurb: "Vertical urban signage.", cssFilter: "none", gradient: "linear-gradient(135deg,#c2410c,#0a0a0a)", fontFamily: "'Bungee', cursive" },
  { slug: "txt-cinzel", name: "Cinzel", blurb: "Roman imperial caps. Timeless.", cssFilter: "none", gradient: "linear-gradient(135deg,#713f12,#0a0a0a)", fontFamily: "'Cinzel', serif" },
  { slug: "txt-luckiest", name: "Luckiest", blurb: "Lucky cartoon bounce.", cssFilter: "none", gradient: "linear-gradient(135deg,#15803d,#020617)", fontFamily: "'Luckiest Guy', cursive" },
  { slug: "txt-poppins-bold", name: "Poppins Punch", blurb: "Clean geometric bold.", cssFilter: "none", gradient: "linear-gradient(135deg,#0c4a6e,#020617)", fontFamily: "'Poppins', sans-serif" },
  { slug: "txt-gold-foil", name: "Gold Foil", blurb: "Metallic gold gradient text.", cssFilter: "none", gradient: "linear-gradient(135deg,#d4a017,#713f12)", fontFamily: "'Cinzel', serif" },
  { slug: "txt-chrome", name: "Chrome", blurb: "Liquid metal shine.", cssFilter: "none", gradient: "linear-gradient(135deg,#9ca3af,#020617)", fontFamily: "'Archivo Black', sans-serif" },
  { slug: "txt-outline-only", name: "Outline Only", blurb: "Hollow stroke text.", cssFilter: "none", gradient: "linear-gradient(135deg,#27272a,#0a0a0a)", fontFamily: "'Anton', sans-serif" },
  { slug: "txt-shadow-drop", name: "Shadow Drop", blurb: "Hard offset shadow. Poster style.", cssFilter: "none", gradient: "linear-gradient(135deg,#7f1d1d,#0a0a0a)", fontFamily: "'Bebas Neue', sans-serif" },
  { slug: "txt-glitch", name: "Glitch", blurb: "RGB-split glitch layers.", cssFilter: "none", gradient: "linear-gradient(135deg,#a21caf,#020617)", fontFamily: "'Archivo Black', sans-serif" },
  { slug: "txt-handwritten", name: "Handwritten Note", blurb: "Personal marker note.", cssFilter: "none", gradient: "linear-gradient(135deg,#57534e,#0a0a0a)", fontFamily: "'Permanent Marker', cursive" },
  { slug: "txt-royal-script", name: "Royal Script", blurb: "Flowing luxury script.", cssFilter: "none", gradient: "linear-gradient(135deg,#a16207,#020617)", fontFamily: "'Playfair Display', serif" },
];

export interface TextStylePreset extends LibraryPreset { fontFamily: string; }

const textPresets: TextStylePreset[] = TEXT_SEEDS.map((s) => ({
  slug: s.slug,
  name: s.name,
  blurb: s.blurb,
  category: "Text Styles" as const,
  cssFilter: s.cssFilter,
  gradient: s.gradient,
  fontFamily: s.fontFamily,
  useUrl: `${EDITOR_LINK}?textstyle=${s.slug}`,
  toolLabel: "Visual Vibes",
}));

/* ─── 15 transition presets ─── */
interface TransitionSeed { slug: string; name: string; blurb: string; cssFilter: string; gradient: string; }

const TRANSITION_SEEDS: TransitionSeed[] = [
  { slug: "tr-whip-pan", name: "Whip Pan", blurb: "Fast horizontal blur pan.", cssFilter: "none", gradient: "linear-gradient(135deg,#1e3a8a,#020617)" },
  { slug: "tr-zoom-burst", name: "Zoom Burst", blurb: "Radial zoom punch.", cssFilter: "none", gradient: "linear-gradient(135deg,#7c2d12,#0a0a0a)" },
  { slug: "tr-glitch-cut", name: "Glitch Cut", blurb: "Digital glitch tear.", cssFilter: "none", gradient: "linear-gradient(135deg,#a21caf,#020617)" },
  { slug: "tr-spin-in", name: "Spin In", blurb: "Rotate and scale entrance.", cssFilter: "none", gradient: "linear-gradient(135deg,#6b21a8,#0a0a0a)" },
  { slug: "tr-slide-wipe", name: "Slide Wipe", blurb: "Clean directional wipe.", cssFilter: "none", gradient: "linear-gradient(135deg,#0e7490,#020617)" },
  { slug: "tr-fade-through", name: "Fade Through", blurb: "Soft cross-dissolve.", cssFilter: "none", gradient: "linear-gradient(135deg,#44403c,#0a0a0a)" },
  { slug: "tr-light-leak", name: "Light Leak", blurb: "Warm light flash.", cssFilter: "none", gradient: "linear-gradient(135deg,#d4a017,#0a0a0a)" },
  { slug: "tr-shake-hit", name: "Shake Hit", blurb: "Impact shake on cut.", cssFilter: "none", gradient: "linear-gradient(135deg,#7f1d1d,#0a0a0a)" },
  { slug: "tr-page-turn", name: "Page Turn", blurb: "3D page flip.", cssFilter: "none", gradient: "linear-gradient(135deg,#713f12,#0a0a0a)" },
  { slug: "tr-morph-zoom", name: "Morph Zoom", blurb: "Seamless object zoom match.", cssFilter: "none", gradient: "linear-gradient(135deg,#14532d,#020617)" },
  { slug: "tr-split-screen", name: "Split Reveal", blurb: "Screen splits open.", cssFilter: "none", gradient: "linear-gradient(135deg,#1d4ed8,#020617)" },
  { slug: "tr-ink-bleed", name: "Ink Bleed", blurb: "Ink spreads across frame.", cssFilter: "none", gradient: "linear-gradient(135deg,#18181b,#0a0a0a)" },
  { slug: "tr-flash-cut", name: "Flash Cut", blurb: "White flash hard cut.", cssFilter: "none", gradient: "linear-gradient(135deg,#e7e5e4,#0a0a0a)" },
  { slug: "tr-vertigo", name: "Vertigo", blurb: "Dolly-zoom disorientation.", cssFilter: "none", gradient: "linear-gradient(135deg,#4c1d95,#0a0a0a)" },
  { slug: "tr-gold-sweep", name: "Gold Sweep", blurb: "Gold light sweeps across.", cssFilter: "none", gradient: "linear-gradient(135deg,#a16207,#020617)" },
];

const transitionPresets: LibraryPreset[] = TRANSITION_SEEDS.map((s) => ({
  ...s,
  category: "Transitions" as const,
  useUrl: `${EDITOR_LINK}?transition=${s.slug}`,
  toolLabel: "Visual Vibes",
}));

/* ─── Unified catalog ─── */
export const LIBRARY_PRESETS: LibraryPreset[] = [
  ...effectPresets,
  ...textPresets,
  ...transitionPresets,
];

export const TEXT_STYLE_PRESETS: TextStylePreset[] = textPresets;

export const LIBRARY_PRESET_COUNTS: Record<LibraryPresetCategory, number> = {
  "Effects": effectPresets.length,
  "Text Styles": textPresets.length,
  "Transitions": transitionPresets.length,
};

export function getLibraryPreset(slug: string): LibraryPreset | undefined {
  return LIBRARY_PRESETS.find((p) => p.slug === slug);
}
