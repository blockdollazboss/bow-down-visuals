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
   - The house themes are the first pack (Golden Marble): its light
     variant IS the Ivory Palace block, its dark variant IS the
     `:root, .dark` block. Applying it removes the attribute and the
     stylesheet's own blocks rule, exactly as before packs existed.
     Its palettes below MIRROR index.css for previews and contrast
     pins — the stylesheet stays the source of truth and
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
   - Design law (owner steer, Oct 24 2026): every pack's language comes
     from bowdownvisuals.com itself — golden marble / black marble
     grounds, the antique-gold accent system, the King Shark's worlds
     (throne room, plaza, his waters, golden hour, the cheat-code
     arcade). No generic color themes. And EVERY pack ships BOTH a
     designed light variant (warm marble/cream grounds, bronze-gold
     ink) and a designed dark variant — no exceptions, the house pack
     included: the two house themes are the two variants of the
     Golden Marble pack.
   - Device delivery (owner steer, Oct 24 2026): every pack also puts
     its world on the visitor's actual phone and computer. Each pack
     carries a ground artwork per mode (`deviceArt`, shipped under
     public/wallpapers/theme-packs/) which the wallpaper desk's rails
     render at every device preset — POST /api/wallpapers/render
     (branded, free, the full logo lockup composited whole by the
     rail's own logo rule) — and zip per device kind via
     POST /api/wallpapers/pack-download. The desk drives this from the
     pack card. BOARDED GAP: full King scene art per pack×mode (the
     King's Set treatment — subject-led scenes) needs generated,
     owner-approved artwork; until it lands, device pieces carry the
     pack's marble ground + the whole logo lockup, and the source per
     pack×mode is one registry field to swap when the art approves.
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
  /** Device-pack ground artwork per mode (site-relative paths under
      public/wallpapers/theme-packs/), rendered by the wallpaper rails
      at every device preset. See the header's device-delivery note. */
  deviceArt: Record<ThemePackMode, string>;
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
    id: "golden-marble",
    name: "Golden Marble",
    tagline: "The house theme — ivory palace by day, black marble throne by night",
    description:
      "The site's own skin: golden white marble and antique gold in the light, golden black marble in the dark. The world Bow Down Visuals was built in.",
    tier: "included",
    house: true,
    cursor: "shark-fin",
    swatches: ["#100d0a", "#f9bc06", "#f4f2eb"],
    deviceArt: {
      dark: "/wallpapers/theme-packs/golden-marble-dark.webp",
      light: "/wallpapers/theme-packs/golden-marble-light.webp",
    },
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
      dark: { tokens: HOUSE_DARK_TOKENS, extras: HOUSE_DARK_EXTRAS },
    },
  },
  {
    id: "shark-tank",
    name: "Shark Tank",
    tagline: "The King's waters — deep-sea marble, gold trim",
    description:
      "The waters around the throne: deep blue-black marble in the dark, pale sea-glass marble in the light — the antique-gold system untouched, on the King Shark's home turf. Pairs with the 8-Bit Shark cursor.",
    tier: "included",
    house: false,
    cursor: "pixel-shark",
    swatches: ["#070d12", "#f9bc06", "#e9eff2"],
    deviceArt: {
      dark: "/wallpapers/theme-packs/shark-tank-dark.webp",
      light: "/wallpapers/theme-packs/shark-tank-light.webp",
    },
    variants: {
      dark: {
        tokens: {
          background: "209 42% 5%",
          foreground: "200 25% 93%",
          card: "208 38% 8%",
          cardForeground: "200 22% 92%",
          cardBorder: "43 55% 26%",
          border: "206 32% 15%",
          input: "208 36% 10%",
          ring: "45 95% 50%",
          primary: "45 95% 50%",
          primaryForeground: "0 0% 4%",
          secondary: "207 30% 11%",
          secondaryForeground: "200 18% 78%",
          muted: "208 34% 9%",
          mutedForeground: "205 12% 60%",
          accent: "45 95% 50%",
          accentForeground: "0 0% 4%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "209 40% 7%",
          popoverForeground: "200 22% 92%",
          popoverBorder: "43 45% 20%",
          sidebar: "210 44% 4%",
          sidebarForeground: "200 18% 88%",
          sidebarBorder: "43 50% 18%",
          sidebarPrimary: "45 95% 50%",
          sidebarPrimaryForeground: "0 0% 4%",
          sidebarAccent: "205 40% 15%",
          sidebarAccentForeground: "200 18% 88%",
          sidebarRing: "45 95% 50%",
          chart1: "45 95% 50%",
          chart2: "43 85% 40%",
          chart3: "199 55% 32%",
          chart4: "0 65% 42%",
          chart5: "206 25% 28%",
        },
        extras: {
          slab: "208 38% 8%",
          slabDeep: "209 42% 4%",
          slabLift: "207 34% 12%",
          glass: "208 38% 8%",
          ink: "200 25% 93%",
          line: "205 45% 42%",
          deepAccent: "45 95% 50%",
          accentText: "46 90% 58%",
          glowA: "214 85% 42%",
          glowB: "187 75% 32%",
          selection: "45 95% 50%",
          selectionInk: "0 0% 4%",
          scroll: "45 90% 48%",
          scrollDeep: "43 75% 36%",
        },
      },
      light: {
        tokens: {
          background: "186 32% 96%",
          foreground: "204 32% 11%",
          card: "0 0% 100%",
          cardForeground: "204 32% 11%",
          cardBorder: "190 30% 79%",
          border: "188 26% 82%",
          input: "0 0% 100%",
          ring: "43 72% 52%",
          primary: "43 62% 46%",
          primaryForeground: "26 30% 8%",
          secondary: "186 30% 91%",
          secondaryForeground: "204 28% 17%",
          muted: "186 24% 90%",
          mutedForeground: "200 12% 37%",
          accent: "43 62% 46%",
          accentForeground: "26 30% 8%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "204 32% 11%",
          popoverBorder: "190 28% 80%",
          sidebar: "186 28% 94%",
          sidebarForeground: "204 28% 14%",
          sidebarBorder: "190 28% 81%",
          sidebarPrimary: "43 62% 46%",
          sidebarPrimaryForeground: "26 30% 8%",
          sidebarAccent: "186 32% 87%",
          sidebarAccentForeground: "204 28% 14%",
          sidebarRing: "43 72% 52%",
          chart1: "43 62% 46%",
          chart2: "36 70% 38%",
          chart3: "196 50% 34%",
          chart4: "0 65% 45%",
          chart5: "205 14% 52%",
        },
        extras: {
          slab: "186 40% 99%",
          slabDeep: "186 40% 99%",
          slabLift: "186 28% 92%",
          glass: "186 32% 97%",
          ink: "204 32% 11%",
          line: "190 30% 58%",
          deepAccent: "40 72% 30%",
          accentText: "43 62% 46%",
          glowA: "190 60% 62%",
          glowB: "174 45% 66%",
          selection: "43 57% 54%",
          selectionInk: "26 28% 9%",
          scroll: "44 63% 66%",
          scrollDeep: "43 74% 42%",
        },
      },
    },
  },
  {
    id: "golden-hour",
    name: "Golden Hour",
    tagline: "Sunset over the plaza — ember marble, hot gold",
    description:
      "The plaza at golden hour: ember-bronze marble and the hottest gold in the house in the dark, warming to champagne marble by day. Pairs with the Flame cursor.",
    tier: "included",
    house: false,
    cursor: "flame",
    swatches: ["#110c09", "#ffab1a", "#f4efe6"],
    deviceArt: {
      dark: "/wallpapers/theme-packs/golden-hour-dark.webp",
      light: "/wallpapers/theme-packs/golden-hour-light.webp",
    },
    variants: {
      dark: {
        tokens: {
          background: "27 32% 5%",
          foreground: "36 38% 93%",
          card: "27 28% 8%",
          cardForeground: "36 34% 92%",
          cardBorder: "36 65% 28%",
          border: "28 26% 15%",
          input: "27 24% 10%",
          ring: "38 100% 55%",
          primary: "38 100% 55%",
          primaryForeground: "24 45% 6%",
          secondary: "27 22% 11%",
          secondaryForeground: "34 26% 78%",
          muted: "27 26% 9%",
          mutedForeground: "30 14% 60%",
          accent: "38 100% 55%",
          accentForeground: "24 45% 6%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "27 30% 7%",
          popoverForeground: "36 34% 92%",
          popoverBorder: "36 50% 20%",
          sidebar: "28 34% 4%",
          sidebarForeground: "34 26% 88%",
          sidebarBorder: "36 55% 18%",
          sidebarPrimary: "38 100% 55%",
          sidebarPrimaryForeground: "24 45% 6%",
          sidebarAccent: "34 55% 16%",
          sidebarAccentForeground: "34 26% 88%",
          sidebarRing: "38 100% 55%",
          chart1: "38 100% 55%",
          chart2: "32 90% 45%",
          chart3: "24 80% 32%",
          chart4: "0 65% 42%",
          chart5: "27 20% 28%",
        },
        extras: {
          slab: "27 28% 8%",
          slabDeep: "27 32% 4%",
          slabLift: "27 24% 12%",
          glass: "27 28% 8%",
          ink: "36 38% 93%",
          line: "36 60% 42%",
          deepAccent: "38 100% 55%",
          accentText: "40 100% 62%",
          glowA: "24 92% 46%",
          glowB: "36 90% 40%",
          selection: "38 100% 55%",
          selectionInk: "24 45% 6%",
          scroll: "38 90% 48%",
          scrollDeep: "36 80% 36%",
        },
      },
      light: {
        tokens: {
          background: "33 58% 96%",
          foreground: "25 34% 11%",
          card: "0 0% 100%",
          cardForeground: "25 34% 11%",
          cardBorder: "34 50% 79%",
          border: "33 44% 82%",
          input: "0 0% 100%",
          ring: "36 75% 45%",
          primary: "38 85% 50%",
          primaryForeground: "25 40% 8%",
          secondary: "33 52% 91%",
          secondaryForeground: "25 30% 17%",
          muted: "33 40% 90%",
          mutedForeground: "28 14% 37%",
          accent: "38 85% 50%",
          accentForeground: "25 40% 8%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "25 34% 11%",
          popoverBorder: "34 44% 80%",
          sidebar: "33 50% 94%",
          sidebarForeground: "25 30% 14%",
          sidebarBorder: "34 46% 81%",
          sidebarPrimary: "38 85% 50%",
          sidebarPrimaryForeground: "25 40% 8%",
          sidebarAccent: "35 58% 88%",
          sidebarAccentForeground: "25 30% 14%",
          sidebarRing: "36 75% 45%",
          chart1: "36 75% 42%",
          chart2: "30 70% 36%",
          chart3: "24 60% 30%",
          chart4: "0 65% 45%",
          chart5: "30 14% 55%",
        },
        extras: {
          slab: "33 62% 99%",
          slabDeep: "33 62% 99%",
          slabLift: "33 48% 92%",
          glass: "33 58% 97%",
          ink: "25 34% 11%",
          line: "34 50% 60%",
          deepAccent: "30 78% 29%",
          accentText: "38 85% 50%",
          glowA: "36 90% 64%",
          glowB: "24 85% 68%",
          selection: "36 80% 48%",
          selectionInk: "25 40% 8%",
          scroll: "36 70% 52%",
          scrollDeep: "34 75% 40%",
        },
      },
    },
  },
  {
    id: "kings-set",
    name: "The King's Set",
    tagline: "The flagship — blackest marble, brightest gold",
    description:
      "Built on the approved King's Set: the blackest marble and the brightest gold leaf in the dark, the brightest ivory and deepest antique bronze by day. Pairs with the King's Crown cursor.",
    tier: "premium",
    house: false,
    cursor: "crown",
    swatches: ["#0a0805", "#ffcb1f", "#f7f5ee"],
    deviceArt: {
      dark: "/wallpapers/theme-packs/kings-set-dark.webp",
      light: "/wallpapers/theme-packs/kings-set-light.webp",
    },
    variants: {
      dark: {
        tokens: {
          background: "36 30% 3%",
          foreground: "46 34% 95%",
          card: "36 26% 6%",
          cardForeground: "46 30% 93%",
          cardBorder: "44 80% 32%",
          border: "40 35% 13%",
          input: "36 22% 8%",
          ring: "46 100% 56%",
          primary: "46 100% 56%",
          primaryForeground: "0 0% 3%",
          secondary: "36 22% 9%",
          secondaryForeground: "44 20% 80%",
          muted: "36 24% 7%",
          mutedForeground: "42 14% 62%",
          accent: "46 100% 56%",
          accentForeground: "0 0% 3%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "36 28% 5%",
          popoverForeground: "46 30% 93%",
          popoverBorder: "44 55% 20%",
          sidebar: "36 32% 2%",
          sidebarForeground: "44 20% 89%",
          sidebarBorder: "44 60% 16%",
          sidebarPrimary: "46 100% 56%",
          sidebarPrimaryForeground: "0 0% 3%",
          sidebarAccent: "43 65% 15%",
          sidebarAccentForeground: "44 20% 89%",
          sidebarRing: "46 100% 56%",
          chart1: "46 100% 56%",
          chart2: "43 90% 45%",
          chart3: "40 75% 30%",
          chart4: "0 65% 42%",
          chart5: "36 20% 26%",
        },
        extras: {
          slab: "36 26% 6%",
          slabDeep: "36 30% 2%",
          slabLift: "36 22% 10%",
          glass: "36 26% 6%",
          ink: "46 34% 95%",
          line: "44 65% 45%",
          deepAccent: "46 100% 56%",
          accentText: "46 100% 64%",
          glowA: "45 100% 50%",
          glowB: "40 85% 32%",
          selection: "46 100% 56%",
          selectionInk: "0 0% 3%",
          scroll: "46 95% 52%",
          scrollDeep: "44 85% 38%",
        },
      },
      light: {
        tokens: {
          background: "42 48% 98%",
          foreground: "26 34% 8%",
          card: "0 0% 100%",
          cardForeground: "26 34% 8%",
          cardBorder: "43 50% 78%",
          border: "43 44% 81%",
          input: "0 0% 100%",
          ring: "40 78% 44%",
          primary: "42 85% 48%",
          primaryForeground: "26 34% 7%",
          secondary: "42 46% 92%",
          secondaryForeground: "26 30% 16%",
          muted: "42 36% 91%",
          mutedForeground: "30 14% 36%",
          accent: "42 85% 48%",
          accentForeground: "26 34% 7%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "26 34% 8%",
          popoverBorder: "43 44% 79%",
          sidebar: "41 44% 96%",
          sidebarForeground: "26 30% 13%",
          sidebarBorder: "43 46% 80%",
          sidebarPrimary: "42 85% 48%",
          sidebarPrimaryForeground: "26 34% 7%",
          sidebarAccent: "43 55% 89%",
          sidebarAccentForeground: "26 30% 13%",
          sidebarRing: "40 78% 44%",
          chart1: "40 78% 40%",
          chart2: "36 70% 36%",
          chart3: "30 50% 28%",
          chart4: "0 65% 45%",
          chart5: "30 12% 52%",
        },
        extras: {
          slab: "42 55% 99%",
          slabDeep: "42 55% 99%",
          slabLift: "42 44% 93%",
          glass: "42 48% 98%",
          ink: "26 34% 8%",
          line: "43 55% 58%",
          deepAccent: "38 80% 27%",
          accentText: "42 85% 48%",
          glowA: "44 90% 62%",
          glowB: "46 85% 70%",
          selection: "42 85% 48%",
          selectionInk: "26 34% 7%",
          scroll: "42 75% 55%",
          scrollDeep: "40 78% 40%",
        },
      },
    },
  },
  {
    id: "arcade-gold",
    name: "Arcade Gold",
    tagline: "Cheat-code charcoal, hot gold, ember glow",
    description:
      "The cheat-code side of the palace: warm charcoal marble, hot gold, and an ember underglow in the dark — warm paper marble and deep bronze by day. Pairs with the Game Controller cursor.",
    tier: "premium",
    house: false,
    cursor: "gamepad",
    swatches: ["#0f0d0b", "#ffbe0a", "#f3f1ec"],
    deviceArt: {
      dark: "/wallpapers/theme-packs/arcade-gold-dark.webp",
      light: "/wallpapers/theme-packs/arcade-gold-light.webp",
    },
    variants: {
      dark: {
        tokens: {
          background: "38 14% 5%",
          foreground: "44 24% 94%",
          card: "38 12% 8%",
          cardForeground: "44 20% 92%",
          cardBorder: "44 60% 27%",
          border: "38 12% 16%",
          input: "38 10% 10%",
          ring: "44 100% 52%",
          primary: "44 100% 52%",
          primaryForeground: "30 40% 5%",
          secondary: "38 10% 11%",
          secondaryForeground: "40 16% 78%",
          muted: "38 11% 9%",
          mutedForeground: "38 10% 61%",
          accent: "44 100% 52%",
          accentForeground: "30 40% 5%",
          destructive: "0 72% 48%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 60% 35%",
          popover: "38 13% 7%",
          popoverForeground: "44 20% 92%",
          popoverBorder: "44 45% 20%",
          sidebar: "39 16% 4%",
          sidebarForeground: "40 16% 88%",
          sidebarBorder: "44 50% 18%",
          sidebarPrimary: "44 100% 52%",
          sidebarPrimaryForeground: "30 40% 5%",
          sidebarAccent: "42 50% 16%",
          sidebarAccentForeground: "40 16% 88%",
          sidebarRing: "44 100% 52%",
          chart1: "44 100% 52%",
          chart2: "38 85% 42%",
          chart3: "0 70% 42%",
          chart4: "0 65% 45%",
          chart5: "38 12% 28%",
        },
        extras: {
          slab: "38 12% 8%",
          slabDeep: "38 14% 4%",
          slabLift: "38 11% 12%",
          glass: "38 12% 8%",
          ink: "44 24% 94%",
          line: "44 55% 42%",
          deepAccent: "44 100% 52%",
          accentText: "44 100% 60%",
          glowA: "44 100% 48%",
          glowB: "0 65% 38%",
          selection: "44 100% 52%",
          selectionInk: "30 40% 5%",
          scroll: "44 90% 46%",
          scrollDeep: "42 80% 34%",
        },
      },
      light: {
        tokens: {
          background: "40 38% 96%",
          foreground: "30 26% 10%",
          card: "0 0% 100%",
          cardForeground: "30 26% 10%",
          cardBorder: "42 40% 79%",
          border: "42 34% 82%",
          input: "0 0% 100%",
          ring: "40 78% 44%",
          primary: "40 82% 46%",
          primaryForeground: "30 34% 7%",
          secondary: "40 36% 91%",
          secondaryForeground: "30 24% 16%",
          muted: "40 26% 90%",
          mutedForeground: "34 12% 37%",
          accent: "40 82% 46%",
          accentForeground: "30 34% 7%",
          destructive: "0 68% 44%",
          destructiveForeground: "0 0% 98%",
          destructiveBorder: "0 55% 32%",
          popover: "0 0% 100%",
          popoverForeground: "30 26% 10%",
          popoverBorder: "42 36% 80%",
          sidebar: "40 34% 94%",
          sidebarForeground: "30 24% 13%",
          sidebarBorder: "42 36% 81%",
          sidebarPrimary: "40 82% 46%",
          sidebarPrimaryForeground: "30 34% 7%",
          sidebarAccent: "41 48% 88%",
          sidebarAccentForeground: "30 24% 13%",
          sidebarRing: "40 78% 44%",
          chart1: "40 82% 42%",
          chart2: "34 70% 36%",
          chart3: "0 60% 40%",
          chart4: "0 65% 45%",
          chart5: "34 12% 54%",
        },
        extras: {
          slab: "40 45% 99%",
          slabDeep: "40 45% 99%",
          slabLift: "39 34% 92%",
          glass: "40 38% 97%",
          ink: "30 26% 10%",
          line: "42 45% 58%",
          deepAccent: "36 82% 28%",
          accentText: "40 82% 46%",
          glowA: "44 95% 60%",
          glowB: "20 85% 66%",
          selection: "40 82% 46%",
          selectionInk: "30 34% 7%",
          scroll: "40 72% 52%",
          scrollDeep: "38 78% 38%",
        },
      },
    },
  },
];

/* ─── Registry helpers ────────────────────────────────────────────────── */

export const HOUSE_PACK_FOR_MODE: Record<ThemePackMode, string> = {
  light: "golden-marble",
  dark: "golden-marble",
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
