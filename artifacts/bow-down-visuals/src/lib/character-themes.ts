/**
 * Character themes — every artist gets their own visual identity.
 * A theme drives the artist's color scheme across character selection,
 * the vault, and anywhere their identity shows up, so you can tell
 * WHO a character is at a glance.
 */

export interface CharacterTheme {
  id: string;
  name: string;
  vibe: string;
  /** Main brand color (hex) */
  primary: string;
  /** Bright highlight for glows and text accents (hex) */
  highlight: string;
  /** Deep shade for gradients and borders (hex) */
  deep: string;
  /** Soft tinted background for cards (css color) */
  cardTint: string;
}

export const CHARACTER_THEMES: CharacterTheme[] = [
  {
    id: "gold-royalty",
    name: "Gold Royalty",
    vibe: "Luxury · crowns · timeless",
    primary: "#C9A84C",
    highlight: "#F5DE8E",
    deep: "#8A6B1F",
    cardTint: "rgba(201,168,76,0.08)",
  },
  {
    id: "crimson-reign",
    name: "Crimson Reign",
    vibe: "Bold · fierce · unstoppable",
    primary: "#E63946",
    highlight: "#FF8A94",
    deep: "#8F1D26",
    cardTint: "rgba(230,57,70,0.08)",
  },
  {
    id: "midnight-empire",
    name: "Midnight Empire",
    vibe: "Mysterious · sleek · after-hours",
    primary: "#4C6EF5",
    highlight: "#91A7FF",
    deep: "#2B3F9E",
    cardTint: "rgba(76,110,245,0.08)",
  },
  {
    id: "emerald-throne",
    name: "Emerald Throne",
    vibe: "Money · growth · boss moves",
    primary: "#2ECC71",
    highlight: "#7DEFA8",
    deep: "#1A7A44",
    cardTint: "rgba(46,204,113,0.08)",
  },
  {
    id: "violet-reign",
    name: "Violet Reign",
    vibe: "Royal · cosmic · otherworldly",
    primary: "#9B5DE5",
    highlight: "#C4A5F5",
    deep: "#5F3494",
    cardTint: "rgba(155,93,229,0.08)",
  },
  {
    id: "rose-dynasty",
    name: "Rose Dynasty",
    vibe: "Glam · romance · spotlight",
    primary: "#F15BB5",
    highlight: "#FF9ED2",
    deep: "#A12C72",
    cardTint: "rgba(241,91,181,0.08)",
  },
  {
    id: "arctic-ice",
    name: "Arctic Ice",
    vibe: "Clean · sharp · futuristic",
    primary: "#66D9E8",
    highlight: "#B8F1F9",
    deep: "#2E7D8A",
    cardTint: "rgba(102,217,232,0.08)",
  },
  {
    id: "sunset-blaze",
    name: "Sunset Blaze",
    vibe: "Fire · energy · West Coast",
    primary: "#FF922B",
    highlight: "#FFC078",
    deep: "#B25A12",
    cardTint: "rgba(255,146,43,0.08)",
  },
  {
    id: "shadow-noir",
    name: "Shadow Noir",
    vibe: "Dark · gritty · underground",
    primary: "#868E96",
    highlight: "#CED4DA",
    deep: "#343A40",
    cardTint: "rgba(134,142,150,0.08)",
  },
  {
    id: "toxic-lime",
    name: "Toxic Lime",
    vibe: "Street · loud · viral",
    primary: "#A9E34B",
    highlight: "#D8F3A0",
    deep: "#5C940D",
    cardTint: "rgba(169,227,75,0.08)",
  },
];

const FALLBACK = CHARACTER_THEMES[0]!;

export function getCharacterTheme(themeId: string | null | undefined): CharacterTheme {
  return CHARACTER_THEMES.find((t) => t.id === themeId) ?? FALLBACK;
}

/** rgba() helper from a hex color + opacity. */
export function themeAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
