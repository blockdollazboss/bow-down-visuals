/* ─── Theme Packs ────────────────────────────────────────────────────────
   One pack reskins the WHOLE site at once — page ground, panels,
   accents, buttons, ink, scrollbars, selection, and the paired cursor —
   on phone and desktop alike (owner order, Oct 24 2026: "phone and
   computer custom themes packs to change everything").

   Packs EXTEND the existing theme machinery; they are not a parallel
   system:
   - The mode layer is untouched: <html> still carries .light / .dark and
     the choice still persists in localStorage "bdv-theme" (the toggles,
     main.tsx boot, and every MutationObserver hook keep working).
   - A pack is a full set of the SAME CSS custom properties the house
     themes define in index.css (`:root, .dark` and `.light` blocks),
     plus a small set of pack-only `--pk-*` values the shared pack rules
     in index.css use to repaint the hardcoded-class sea (the bg-black /
     zinc slabs, black/* glass, white ink scale, gold text) the way the
     Ivory Palace tables repaint it for the house light theme.
   - Applying a non-house pack sets `data-theme-pack="<id>"` on <html>;
     the pack's token blocks in index.css are mode-scoped
     (`[data-theme-pack="x"]:not(.light)` / `[data-theme-pack="x"].light`),
     so flipping the mode toggle inside a pack's other mode lands on the
     house theme of that mode — never a half-skinned page. Applying a
     pack whose world is a single mode brings that mode with it.
   - The two house themes are packs 1 and 2. Applying one removes the
     attribute and the stylesheet's own blocks rule, exactly as before
     packs existed. Their palettes below MIRROR index.css for previews
     and contrast pins — the stylesheet stays the source of truth and
     theme-packs.test.ts fails if the two ever drift.
   - Persistence follows the cursor pattern ("bdv-cursor-choice"):
     localStorage "bdv-theme-pack", validated against the registry,
     with a "bdv-theme-pack-changed" window event.
   - Premium packs are ownable items in shape only: `tier: "premium"`
     renders visible-but-locked in the desk. The preset-pack selling
     model is an OPEN owner decision, so NO charge is wired and NO price
     exists anywhere in this system; `isThemePackUnlocked` is the single
     seam a future entitlement feed plugs into (owned ids arrive as an
     argument; today nothing feeds it, so premium packs stay locked).
   - Protected surfaces keep their own look regardless of pack: the
     editor (Visual Vibes) and every [data-dark-lock] subtree are
     excluded from the pack repaint rules by the same `:not(...)`
     guards the house light tables use. */

import { setCursorChoice, type CursorId } from "@/lib/cursor-settings";

export type ThemePackMode = "light" | "dark";
export type ThemePackTier = "included" | "premium";

/** Core token set — one entry per CSS custom property of the house
    theme blocks in index.css, camelCase for the `--kebab-case` var. */
export interface ThemePackTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  cardBorder: string;
  border: string;
  input: string;
  ring: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  destructiveBorder: string;
  popover: string;
  popoverForeground: string;
  popoverBorder: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarRing: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

/** Pack-only machinery values (the `--pk-*` custom properties). All are
    HSL channel strings ("206 48% 5%"), same format as the core tokens.
    - slab / slabDeep / slabLift: the solid surfaces the dark slab
      classes (bg-black, zinc-950/900/800 families) repaint to.
    - glass: base color for the translucent black/* and zinc-900/* steps.
    - ink: the light-mode ink scale (text-white / zinc text repaints).
    - line: tint for the white/10-family hairline borders.
    - deepAccent: light-mode deepened accent text (the #8A6B1F role).
    - accentText: dark-mode accent text (solid amber/yellow steps).
    - glowA / glowB: the two radial glows of the page ground.
    - selection / selectionInk: text selection colors.
    - scroll / scrollDeep: scrollbar thumb gradient stops. */
export interface ThemePackExtras {
  slab: string;
  slabDeep: string;
  slabLift: string;
  glass: string;
  ink: string;
  line: string;
  deepAccent: string;
  accentText: string;
  glowA: string;
  glowB: string;
  selection: string;
  selectionInk: string;
  scroll: string;
  scrollDeep: string;
}

export interface ThemePackVariant {
  tokens: ThemePackTokens;
  extras: ThemePackExtras;
  /** Extra CSS vars this variant defines beyond the core + --pk-* sets
      (house light's Ivory Palace signature tokens). Kebab-case names. */
  cssExtras?: Record<string, string>;
}

export interface ThemePack {
  id: string;
  name: string;
  tagline: string;
  description: string;
  tier: ThemePackTier;
  /** House packs are the site's own two themes — applying one removes
      the pack attribute and the index.css house blocks rule. */
  house: boolean;
  /** The cursor this pack pairs with, applied on desk apply. */
  cursor: CursorId;
  /** Card swatches (hex): ground, accent, ink. */
  swatches: [string, string, string];
  variants: Partial<Record<ThemePackMode, ThemePackVariant>>;
}

/* ─── Token → CSS var mapping ─────────────────────────────────────────── */

export const TOKEN_VAR_NAMES: Record<keyof ThemePackTokens, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  cardBorder: "--card-border",
  border: "--border",
  input: "--input",
  ring: "--ring",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  destructiveBorder: "--destructive-border",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  popoverBorder: "--popover-border",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarRing: "--sidebar-ring",
  chart1: "--chart-1",
  chart2: "--chart-2",
  chart3: "--chart-3",
  chart4: "--chart-4",
  chart5: "--chart-5",
};

export const EXTRA_VAR_NAMES: Record<keyof ThemePackExtras, string> = {
  slab: "--pk-slab",
  slabDeep: "--pk-slab-deep",
  slabLift: "--pk-slab-lift",
  glass: "--pk-glass",
  ink: "--pk-ink",
  line: "--pk-line",
  deepAccent: "--pk-deep-accent",
  accentText: "--pk-accent-text",
  glowA: "--pk-glow-a",
  glowB: "--pk-glow-b",
  selection: "--pk-selection",
  selectionInk: "--pk-selection-ink",
  scroll: "--pk-scroll",
  scrollDeep: "--pk-scroll-deep",
};

/** Every CSS var a variant carries, as a flat `--name: value` record. */
export function variantVarMap(variant: ThemePackVariant): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(TOKEN_VAR_NAMES) as (keyof ThemePackTokens)[]) {
    out[TOKEN_VAR_NAMES[k]] = variant.tokens[k];
  }
  for (const k of Object.keys(EXTRA_VAR_NAMES) as (keyof ThemePackExtras)[]) {
    out[EXTRA_VAR_NAMES[k]] = variant.extras[k];
  }
  return { ...out, ...(variant.cssExtras ?? {}) };
}

/* ─── The house palettes (mirror index.css — see header) ──────────────── */

const HOUSE_DARK_TOKENS: ThemePackTokens = {
  background: "36 24% 5%",
  foreground: "45 30% 94%",
  card: "36 22% 8%",
  cardForeground: "45 25% 92%",
  cardBorder: "43 70% 28%",
  border: "43 40% 14%",
  input: "36 18% 10%",
  ring: "45 95% 50%",
  primary: "45 95% 50%",
  primaryForeground: "0 0% 4%",
  secondary: "36 20% 11%",
  secondaryForeground: "45 15% 78%",
  muted: "36 18% 9%",
  mutedForeground: "40 12% 58%",
  accent: "45 95% 50%",
  accentForeground: "0 0% 4%",
  destructive: "0 72% 48%",
  destructiveForeground: "0 0% 98%",
  destructiveBorder: "0 60% 35%",
  popover: "36 24% 7%",
  popoverForeground: "45 25% 92%",
  popoverBorder: "43 50% 20%",
  sidebar: "36 26% 4%",
  sidebarForeground: "45 18% 88%",
  sidebarBorder: "43 55% 18%",
  sidebarPrimary: "45 95% 50%",
  sidebarPrimaryForeground: "0 0% 4%",
  sidebarAccent: "43 60% 16%",
  sidebarAccentForeground: "45 18% 88%",
  sidebarRing: "45 95% 50%",
  chart1: "45 95% 50%",
  chart2: "43 85% 40%",
  chart3: "43 70% 30%",
  chart4: "0 65% 42%",
  chart5: "36 20% 28%",
};

const HOUSE_LIGHT_TOKENS: ThemePackTokens = {
  background: "40 33% 97%",
  foreground: "26 28% 10%",
  card: "0 0% 100%",
  cardForeground: "26 28% 10%",
  cardBorder: "43 42% 80%",
  border: "43 38% 83%",
  input: "0 0% 100%",
  ring: "43 72% 52%",
  primary: "43 62% 46%",
  primaryForeground: "26 30% 8%",
  secondary: "43 45% 93%",
  secondaryForeground: "26 25% 16%",
  muted: "43 28% 92%",
  mutedForeground: "30 12% 36%",
  accent: "43 62% 46%",
  accentForeground: "26 30% 8%",
  destructive: "0 68% 44%",
  destructiveForeground: "0 0% 98%",
  destructiveBorder: "0 55% 32%",
  popover: "0 0% 100%",
  popoverForeground: "26 28% 10%",
  popoverBorder: "43 38% 80%",
  sidebar: "40 30% 95%",
  sidebarForeground: "26 25% 14%",
  sidebarBorder: "43 40% 82%",
  sidebarPrimary: "43 62% 46%",
  sidebarPrimaryForeground: "26 30% 8%",
  sidebarAccent: "43 50% 90%",
  sidebarAccentForeground: "26 25% 14%",
  sidebarRing: "43 72% 52%",
  chart1: "43 62% 46%",
  chart2: "36 70% 38%",
  chart3: "30 45% 30%",
  chart4: "0 65% 45%",
  chart5: "30 12% 55%",
};

/* House extras describe the shipped house surfaces (throne-room ground,
   ivory slabs) for previews; the house packs define no --pk-* vars in
   CSS — their repaint tables are the hand-tuned ones already in
   index.css. */
const HOUSE_DARK_EXTRAS: ThemePackExtras = {
  slab: "36 22% 8%",
  slabDeep: "36 26% 4%",
  slabLift: "36 20% 11%",
  glass: "36 22% 8%",
  ink: "45 30% 94%",
  line: "43 55% 40%",
  deepAccent: "45 95% 50%",
  accentText: "45 95% 50%",
  glowA: "45 95% 50%",
  glowB: "43 70% 30%",
  selection: "45 95% 50%",
  selectionInk: "0 0% 4%",
  scroll: "45 95% 50%",
  scrollDeep: "43 80% 38%",
};

const HOUSE_LIGHT_EXTRAS: ThemePackExtras = {
  slab: "45 67% 98%",
  slabDeep: "45 67% 98%",
  slabLift: "43 41% 92%",
  glass: "44 67% 95%",
  ink: "26 28% 9%",
  line: "43 45% 62%",
  deepAccent: "40 72% 30%",
  accentText: "43 62% 46%",
  glowA: "43 62% 46%",
  glowB: "46 78% 68%",
  selection: "43 57% 54%",
  selectionInk: "26 28% 9%",
  scroll: "44 63% 66%",
  scrollDeep: "43 74% 42%",
};

/* ─── The registry ────────────────────────────────────────────────────── */

export const THEME_PACKS: ThemePack[] = [
  {
    id: "golden-marble-light",
    name: "Golden Marble Light",
    tagline: "The house light — Ivory Palace",
    description:
      "Sunlit golden palace halls: warm ivory, champagne hairlines, and rich gold leaf. The flagship light theme, unchanged.",
    tier: "included",
    house: true,
    cursor: "shark-fin",
    swatches: ["#faf8f5", "#be952d", "#211912"],
    variants: {
      light: {
        tokens: HOUSE_LIGHT_TOKENS,
        extras: HOUSE_LIGHT_EXTRAS,
        cssExtras: {
          "--ivory": "40 33% 97%",
          "--marble": "0 0% 100%",
          "--champagne": "43 45% 88%",
          "--gold-deep": "40 72% 30%",
          "--gold": "43 62% 46%",
          "--gold-bright": "46 78% 68%",
          "--espresso": "26 28% 10%",
          "--warm-gray": "30 12% 36%",
        },
      },
    },
  },
  {
    id: "golden-black-marble",
    name: "Golden Black Marble",
    tagline: "The house dark — the throne room",
    description:
      "Deep obsidian and royal gold: the golden black marble the palace was built in. The flagship dark theme, unchanged.",
    tier: "included",
    house: true,
    cursor: "shark-fin",
    swatches: ["#100d0a", "#f9bc06", "#f4f2eb"],
    variants: { dark: { tokens: HOUSE_DARK_TOKENS, extras: HOUSE_DARK_EXTRAS } },
  },
  {
    id: "shark-tank",
    name: "Shark Tank",
    tagline: "Deep ocean — abyss below, lagoon above",
    description:
      "The King's own waters. Dark mode dives to a deep-teal abyss with electric aqua trim; light mode surfaces into a bright lagoon shallows. Pairs with the 8-Bit Shark cursor.",
    tier: "included",
    house: false,
    cursor: "pixel-shark",
    swatches: ["#070e13", "#0ccfe9", "#e7f1f3"],
    variants: {
      dark: {
        tokens: {
          background: "206 48% 5%",
          foreground: "192 32% 93%",
          card: "205 42% 8%",
          cardForeground: "192 28% 92%",
          cardBorder: "190 55% 26%",
          border: "204 38% 15%",
          input: "205 40% 10%",
          ring: "187 90% 48%",
          primary: "187 90% 48%",
          primaryForeground: "206 55% 5%",
          secondary: "205 35% 11%",
          secondaryForeground: "193 22% 78%",
          muted: "205 38% 9%",
          mutedForeground: "200 14% 60%",
          accent: "187 90% 48%",
          accentForeground: "206 55% 5%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "206 45% 7%",
          popoverForeground: "192 28% 92%",
          popoverBorder: "190 45% 20%",
          sidebar: "207 50% 4%",
          sidebarForeground: "193 22% 88%",
          sidebarBorder: "190 50% 17%",
          sidebarPrimary: "187 90% 48%",
          sidebarPrimaryForeground: "206 55% 5%",
          sidebarAccent: "196 55% 15%",
          sidebarAccentForeground: "193 22% 88%",
          sidebarRing: "187 90% 48%",
          chart1: "187 90% 48%",
          chart2: "190 70% 38%",
          chart3: "199 65% 30%",
          chart4: "16 85% 55%",
          chart5: "205 30% 28%",
        },
        extras: {
          slab: "205 42% 8%",
          slabDeep: "206 48% 4%",
          slabLift: "204 38% 12%",
          glass: "205 42% 8%",
          ink: "192 32% 93%",
          line: "190 60% 45%",
          deepAccent: "187 85% 40%",
          accentText: "187 90% 55%",
          glowA: "187 90% 48%",
          glowB: "222 80% 45%",
          selection: "187 90% 48%",
          selectionInk: "206 55% 5%",
          scroll: "187 75% 42%",
          scrollDeep: "190 80% 30%",
        },
      },
      light: {
        tokens: {
          background: "193 48% 96%",
          foreground: "207 48% 10%",
          card: "0 0% 100%",
          cardForeground: "207 48% 10%",
          cardBorder: "192 45% 78%",
          border: "193 38% 82%",
          input: "0 0% 100%",
          ring: "192 78% 38%",
          primary: "193 78% 32%",
          primaryForeground: "0 0% 100%",
          secondary: "193 45% 91%",
          secondaryForeground: "206 40% 17%",
          muted: "193 35% 90%",
          mutedForeground: "205 16% 36%",
          accent: "193 78% 32%",
          accentForeground: "0 0% 100%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "207 48% 10%",
          popoverBorder: "192 40% 79%",
          sidebar: "193 42% 94%",
          sidebarForeground: "206 40% 14%",
          sidebarBorder: "192 40% 81%",
          sidebarPrimary: "193 78% 32%",
          sidebarPrimaryForeground: "0 0% 100%",
          sidebarAccent: "192 50% 87%",
          sidebarAccentForeground: "206 40% 14%",
          sidebarRing: "192 78% 38%",
          chart1: "193 78% 32%",
          chart2: "192 65% 40%",
          chart3: "200 55% 30%",
          chart4: "16 75% 45%",
          chart5: "205 14% 52%",
        },
        extras: {
          slab: "193 55% 99%",
          slabDeep: "193 55% 99%",
          slabLift: "193 40% 92%",
          glass: "193 48% 97%",
          ink: "207 48% 10%",
          line: "192 45% 60%",
          deepAccent: "193 82% 27%",
          accentText: "187 90% 40%",
          glowA: "190 85% 55%",
          glowB: "187 70% 65%",
          selection: "193 78% 32%",
          selectionInk: "0 0% 100%",
          scroll: "192 70% 45%",
          scrollDeep: "193 78% 32%",
        },
      },
    },
  },
  {
    id: "rose-gold-palace",
    name: "Rose Gold Palace",
    tagline: "Blush marble and copper light",
    description:
      "Rose gold over deep plum-black marble at night; blush ivory and polished copper by day. Pairs with the Diamond cursor.",
    tier: "premium",
    house: false,
    cursor: "diamond",
    swatches: ["#130b0d", "#e07b5c", "#f6eee9"],
    variants: {
      dark: {
        tokens: {
          background: "348 26% 6%",
          foreground: "24 42% 94%",
          card: "347 24% 9%",
          cardForeground: "24 38% 92%",
          cardBorder: "14 50% 30%",
          border: "348 22% 16%",
          input: "347 22% 11%",
          ring: "14 68% 62%",
          primary: "14 68% 62%",
          primaryForeground: "348 42% 8%",
          secondary: "347 20% 12%",
          secondaryForeground: "22 30% 79%",
          muted: "347 22% 10%",
          mutedForeground: "20 14% 61%",
          accent: "14 68% 62%",
          accentForeground: "348 42% 8%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "348 25% 8%",
          popoverForeground: "24 38% 92%",
          popoverBorder: "14 42% 22%",
          sidebar: "349 28% 5%",
          sidebarForeground: "22 30% 88%",
          sidebarBorder: "14 45% 19%",
          sidebarPrimary: "14 68% 62%",
          sidebarPrimaryForeground: "348 42% 8%",
          sidebarAccent: "14 45% 17%",
          sidebarAccentForeground: "22 30% 88%",
          sidebarRing: "14 68% 62%",
          chart1: "14 68% 62%",
          chart2: "20 60% 45%",
          chart3: "348 45% 38%",
          chart4: "350 65% 45%",
          chart5: "347 20% 30%",
        },
        extras: {
          slab: "347 24% 9%",
          slabDeep: "348 26% 5%",
          slabLift: "346 22% 13%",
          glass: "347 24% 9%",
          ink: "24 42% 94%",
          line: "14 55% 45%",
          deepAccent: "14 68% 62%",
          accentText: "16 78% 70%",
          glowA: "14 68% 55%",
          glowB: "348 60% 40%",
          selection: "14 68% 62%",
          selectionInk: "348 42% 8%",
          scroll: "14 60% 50%",
          scrollDeep: "14 65% 38%",
        },
      },
      light: {
        tokens: {
          background: "26 56% 97%",
          foreground: "346 32% 12%",
          card: "0 0% 100%",
          cardForeground: "346 32% 12%",
          cardBorder: "16 48% 80%",
          border: "18 42% 83%",
          input: "0 0% 100%",
          ring: "12 58% 48%",
          primary: "12 56% 44%",
          primaryForeground: "0 0% 100%",
          secondary: "20 52% 92%",
          secondaryForeground: "346 28% 17%",
          muted: "20 40% 91%",
          mutedForeground: "20 12% 37%",
          accent: "12 56% 44%",
          accentForeground: "0 0% 100%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "346 32% 12%",
          popoverBorder: "16 42% 80%",
          sidebar: "24 48% 95%",
          sidebarForeground: "346 28% 15%",
          sidebarBorder: "16 44% 82%",
          sidebarPrimary: "12 56% 44%",
          sidebarPrimaryForeground: "0 0% 100%",
          sidebarAccent: "16 55% 89%",
          sidebarAccentForeground: "346 28% 15%",
          sidebarRing: "12 58% 48%",
          chart1: "12 56% 44%",
          chart2: "18 55% 40%",
          chart3: "346 40% 32%",
          chart4: "350 60% 45%",
          chart5: "20 14% 55%",
        },
        extras: {
          slab: "24 60% 99%",
          slabDeep: "24 60% 99%",
          slabLift: "22 48% 93%",
          glass: "26 56% 97%",
          ink: "346 32% 12%",
          line: "14 50% 62%",
          deepAccent: "10 62% 36%",
          accentText: "12 56% 44%",
          glowA: "14 75% 68%",
          glowB: "350 65% 72%",
          selection: "12 56% 44%",
          selectionInk: "0 0% 100%",
          scroll: "14 55% 55%",
          scrollDeep: "12 58% 44%",
        },
      },
    },
  },
  {
    id: "royal-amethyst",
    name: "Royal Amethyst",
    tagline: "Violet reign, gold-trimmed",
    description:
      "A violet court: amethyst over violet-black marble at night, lavender ivory by day. Pairs with the King's Crown cursor.",
    tier: "premium",
    house: false,
    cursor: "crown",
    swatches: ["#0f0a15", "#a35ff2", "#f0ebf5"],
    variants: {
      dark: {
        tokens: {
          background: "268 36% 6%",
          foreground: "270 32% 94%",
          card: "267 32% 9%",
          cardForeground: "270 28% 92%",
          cardBorder: "268 50% 30%",
          border: "267 30% 16%",
          input: "267 30% 11%",
          ring: "268 85% 66%",
          primary: "268 85% 66%",
          primaryForeground: "268 48% 8%",
          secondary: "267 26% 12%",
          secondaryForeground: "270 22% 79%",
          muted: "267 28% 10%",
          mutedForeground: "268 14% 62%",
          accent: "268 85% 66%",
          accentForeground: "268 48% 8%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "268 34% 8%",
          popoverForeground: "270 28% 92%",
          popoverBorder: "268 42% 22%",
          sidebar: "269 38% 5%",
          sidebarForeground: "270 22% 88%",
          sidebarBorder: "268 45% 19%",
          sidebarPrimary: "268 85% 66%",
          sidebarPrimaryForeground: "268 48% 8%",
          sidebarAccent: "268 45% 17%",
          sidebarAccentForeground: "270 22% 88%",
          sidebarRing: "268 85% 66%",
          chart1: "268 85% 66%",
          chart2: "45 90% 55%",
          chart3: "268 55% 40%",
          chart4: "320 60% 50%",
          chart5: "267 24% 30%",
        },
        extras: {
          slab: "267 32% 9%",
          slabDeep: "268 36% 5%",
          slabLift: "266 30% 13%",
          glass: "267 32% 9%",
          ink: "270 32% 94%",
          line: "268 55% 48%",
          deepAccent: "268 85% 66%",
          accentText: "268 90% 74%",
          glowA: "268 85% 55%",
          glowB: "285 70% 40%",
          selection: "268 85% 66%",
          selectionInk: "268 48% 8%",
          scroll: "268 70% 52%",
          scrollDeep: "268 75% 40%",
        },
      },
      light: {
        tokens: {
          background: "270 42% 97%",
          foreground: "267 36% 11%",
          card: "0 0% 100%",
          cardForeground: "267 36% 11%",
          cardBorder: "268 42% 81%",
          border: "268 36% 84%",
          input: "0 0% 100%",
          ring: "268 62% 48%",
          primary: "268 60% 44%",
          primaryForeground: "0 0% 100%",
          secondary: "270 40% 92%",
          secondaryForeground: "267 30% 17%",
          muted: "270 30% 91%",
          mutedForeground: "268 14% 37%",
          accent: "268 60% 44%",
          accentForeground: "0 0% 100%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "267 36% 11%",
          popoverBorder: "268 38% 81%",
          sidebar: "270 38% 95%",
          sidebarForeground: "267 30% 14%",
          sidebarBorder: "268 38% 83%",
          sidebarPrimary: "268 60% 44%",
          sidebarPrimaryForeground: "0 0% 100%",
          sidebarAccent: "268 48% 89%",
          sidebarAccentForeground: "267 30% 14%",
          sidebarRing: "268 62% 48%",
          chart1: "268 60% 44%",
          chart2: "43 62% 40%",
          chart3: "268 45% 32%",
          chart4: "320 55% 45%",
          chart5: "268 14% 55%",
        },
        extras: {
          slab: "270 50% 99%",
          slabDeep: "270 50% 99%",
          slabLift: "270 36% 93%",
          glass: "270 42% 97%",
          ink: "267 36% 11%",
          line: "268 45% 62%",
          deepAccent: "268 65% 36%",
          accentText: "268 60% 44%",
          glowA: "268 80% 70%",
          glowB: "285 70% 72%",
          selection: "268 65% 52%",
          selectionInk: "0 0% 100%",
          scroll: "268 55% 55%",
          scrollDeep: "268 60% 44%",
        },
      },
    },
  },
  {
    id: "studio-clean",
    name: "Studio Clean",
    tagline: "Graphite, porcelain, one signal light",
    description:
      "The working studio: neutral graphite at night, porcelain by day, a single signal-blue accent and nothing else shouting. Pairs with the Crosshair cursor.",
    tier: "included",
    house: false,
    cursor: "crosshair",
    swatches: ["#0e0f11", "#3d93f5", "#f1f2f4"],
    variants: {
      dark: {
        tokens: {
          background: "220 9% 6%",
          foreground: "220 12% 95%",
          card: "220 9% 9%",
          cardForeground: "220 10% 93%",
          cardBorder: "220 12% 24%",
          border: "220 10% 17%",
          input: "220 9% 11%",
          ring: "212 90% 60%",
          primary: "212 90% 60%",
          primaryForeground: "220 35% 6%",
          secondary: "220 8% 12%",
          secondaryForeground: "220 10% 79%",
          muted: "220 9% 10%",
          mutedForeground: "220 8% 62%",
          accent: "212 90% 60%",
          accentForeground: "220 35% 6%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "220 10% 8%",
          popoverForeground: "220 10% 93%",
          popoverBorder: "220 12% 21%",
          sidebar: "220 10% 5%",
          sidebarForeground: "220 10% 89%",
          sidebarBorder: "220 12% 18%",
          sidebarPrimary: "212 90% 60%",
          sidebarPrimaryForeground: "220 35% 6%",
          sidebarAccent: "220 12% 16%",
          sidebarAccentForeground: "220 10% 89%",
          sidebarRing: "212 90% 60%",
          chart1: "212 90% 60%",
          chart2: "220 10% 45%",
          chart3: "200 60% 40%",
          chart4: "0 65% 50%",
          chart5: "220 8% 30%",
        },
        extras: {
          slab: "220 9% 9%",
          slabDeep: "220 9% 5%",
          slabLift: "220 8% 13%",
          glass: "220 9% 9%",
          ink: "220 12% 95%",
          line: "212 60% 50%",
          deepAccent: "212 90% 60%",
          accentText: "212 95% 70%",
          glowA: "212 90% 55%",
          glowB: "220 15% 30%",
          selection: "212 90% 60%",
          selectionInk: "220 35% 6%",
          scroll: "212 70% 50%",
          scrollDeep: "212 80% 38%",
        },
      },
      light: {
        tokens: {
          background: "0 0% 98%",
          foreground: "220 16% 9%",
          card: "0 0% 100%",
          cardForeground: "220 16% 9%",
          cardBorder: "220 12% 84%",
          border: "220 10% 86%",
          input: "0 0% 100%",
          ring: "212 85% 42%",
          primary: "212 85% 40%",
          primaryForeground: "0 0% 100%",
          secondary: "220 14% 93%",
          secondaryForeground: "220 14% 17%",
          muted: "220 12% 92%",
          mutedForeground: "220 8% 38%",
          accent: "212 85% 40%",
          accentForeground: "0 0% 100%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "220 16% 9%",
          popoverBorder: "220 12% 85%",
          sidebar: "0 0% 96%",
          sidebarForeground: "220 14% 14%",
          sidebarBorder: "220 10% 85%",
          sidebarPrimary: "212 85% 40%",
          sidebarPrimaryForeground: "0 0% 100%",
          sidebarAccent: "220 14% 90%",
          sidebarAccentForeground: "220 14% 14%",
          sidebarRing: "212 85% 42%",
          chart1: "212 85% 40%",
          chart2: "220 10% 50%",
          chart3: "200 55% 35%",
          chart4: "0 60% 45%",
          chart5: "220 8% 60%",
        },
        extras: {
          slab: "0 0% 100%",
          slabDeep: "0 0% 100%",
          slabLift: "220 14% 94%",
          glass: "0 0% 98%",
          ink: "220 16% 9%",
          line: "212 50% 55%",
          deepAccent: "212 85% 34%",
          accentText: "212 85% 40%",
          glowA: "212 85% 60%",
          glowB: "220 20% 75%",
          selection: "212 85% 45%",
          selectionInk: "0 0% 100%",
          scroll: "212 60% 52%",
          scrollDeep: "212 85% 40%",
        },
      },
    },
  },
];

/* ─── Registry helpers ────────────────────────────────────────────────── */

export const HOUSE_PACK_FOR_MODE: Record<ThemePackMode, string> = {
  light: "golden-marble-light",
  dark: "golden-black-marble",
};

export function themePackById(id: string | null | undefined): ThemePack | undefined {
  if (!id) return undefined;
  return THEME_PACKS.find((p) => p.id === id);
}

export function packModes(pack: ThemePack): ThemePackMode[] {
  const out: ThemePackMode[] = [];
  if (pack.variants.light) out.push("light");
  if (pack.variants.dark) out.push("dark");
  return out;
}

/** The mode a pack actually renders in, given the visitor's preferred
    mode: the preferred mode when the pack lives there, else the pack's
    own (first) mode. */
export function resolvePackMode(pack: ThemePack, preferred: ThemePackMode): ThemePackMode {
  if (pack.variants[preferred]) return preferred;
  return packModes(pack)[0] ?? preferred;
}

/** Ownable-item seam: included packs are always unlocked; premium packs
    unlock when a future entitlement feed reports the id as owned.
    No feed exists yet, so premium packs are locked for everyone. */
export function isThemePackUnlocked(pack: ThemePack, ownedPackIds: readonly string[] = []): boolean {
  return pack.tier === "included" || ownedPackIds.includes(pack.id);
}

/* ─── Color math (pure; the contrast pins run on these) ───────────────── */

const HSL_RE = /^([\d.]+) ([\d.]+)% ([\d.]+)%$/;

export function parseHsl(hsl: string): { h: number; s: number; l: number } | null {
  const m = HSL_RE.exec(hsl.trim());
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

export function hslToRgb(hsl: string): { r: number; g: number; b: number } | null {
  const p = parseHsl(hsl);
  if (!p) return null;
  const s = p.s / 100;
  const l = p.l / 100;
  const k = (n: number) => (n + p.h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function hslToHex(hsl: string): string | null {
  const rgb = hslToRgb(hsl);
  if (!rgb) return null;
  const c = (v: number) => v.toString(16).padStart(2, "0");
  return `#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`;
}

/** CSS color for a token value, e.g. hslCss("206 48% 5%", 0.5). */
export function hslCss(hsl: string, alpha?: number): string {
  return alpha === undefined ? `hsl(${hsl})` : `hsl(${hsl} / ${alpha})`;
}

function relativeLuminance(hsl: string): number | null {
  const rgb = hslToRgb(hsl);
  if (!rgb) return null;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

/** WCAG contrast ratio between two HSL channel strings (1–21). */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ─── Persistence + application ───────────────────────────────────────── */

export const THEME_PACK_STORAGE_KEY = "bdv-theme-pack";
export const THEME_MODE_STORAGE_KEY = "bdv-theme";
export const THEME_PACK_EVENT = "bdv-theme-pack-changed";
export const THEME_PACK_ATTRIBUTE = "data-theme-pack";

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — the choice still applies for this session */
  }
}

/** The visitor's stored mode preference ("bdv-theme"), dark by default —
    the same rule main.tsx and the toggles have always used. */
export function getThemeMode(): ThemePackMode {
  return storageGet(THEME_MODE_STORAGE_KEY) === "light" ? "light" : "dark";
}

export function getSavedThemePackId(): string | null {
  const raw = storageGet(THEME_PACK_STORAGE_KEY);
  return themePackById(raw) ? raw : null;
}

/** The pack in force right now: the saved pack, or the house pack for
    the stored mode when none is saved. */
export function getActiveThemePack(): ThemePack {
  const saved = themePackById(getSavedThemePackId());
  if (saved) return saved;
  return themePackById(HOUSE_PACK_FOR_MODE[getThemeMode()])!;
}

function paintMode(mode: ThemePackMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", mode === "light");
  root.classList.toggle("dark", mode === "dark");
}

function paintPackAttribute(pack: ThemePack): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (pack.house) root.removeAttribute(THEME_PACK_ATTRIBUTE);
  else root.setAttribute(THEME_PACK_ATTRIBUTE, pack.id);
}

function announcePackChange(): void {
  try {
    window.dispatchEvent(new Event(THEME_PACK_EVENT));
  } catch {
    /* non-browser environment */
  }
}

/**
 * Apply a pack: one switch that moves everything. Resolves the mode
 * (the pack brings its mode when it doesn't live in the current one),
 * paints the mode class + pack attribute, persists both choices, and —
 * unless told otherwise — pairs the pack's cursor. Returns the applied
 * pack and the mode it landed in, or null for an unknown id.
 */
export function applyThemePack(
  id: string,
  opts: { pairCursor?: boolean } = {},
): { pack: ThemePack; mode: ThemePackMode } | null {
  const pack = themePackById(id);
  if (!pack) return null;
  const mode = resolvePackMode(pack, getThemeMode());
  paintMode(mode);
  storageSet(THEME_MODE_STORAGE_KEY, mode);
  paintPackAttribute(pack);
  storageSet(THEME_PACK_STORAGE_KEY, pack.id);
  if (opts.pairCursor !== false) setCursorChoice(pack.cursor);
  announcePackChange();
  return { pack, mode };
}

/**
 * Flip the light/dark mode (what the theme toggles do). If the active
 * pack doesn't live in the new mode, the visitor lands on that mode's
 * house pack — the pack attribute never points at a mode the pack
 * doesn't define. Cursor pairing is NOT touched here.
 */
export function applyThemeMode(mode: ThemePackMode): { pack: ThemePack; mode: ThemePackMode } {
  let pack = getActiveThemePack();
  if (!pack.variants[mode]) {
    pack = themePackById(HOUSE_PACK_FOR_MODE[mode])!;
    storageSet(THEME_PACK_STORAGE_KEY, pack.id);
  }
  paintMode(mode);
  storageSet(THEME_MODE_STORAGE_KEY, mode);
  paintPackAttribute(pack);
  announcePackChange();
  return { pack, mode };
}

/**
 * Pre-paint boot (main.tsx): restore the saved pack + mode before the
 * first frame so a packed visitor never flashes the house theme.
 * Mirrors the rule the toggles use — a saved pack wins; a pack that
 * doesn't live in the saved mode brings its own mode with it.
 */
export function bootThemePack(): void {
  const pack = getActiveThemePack();
  const mode = resolvePackMode(pack, getThemeMode());
  paintMode(mode);
  paintPackAttribute(pack);
}
