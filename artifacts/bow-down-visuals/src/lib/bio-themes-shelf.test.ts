/**
 * bio-themes-shelf.test.ts — pins the expanded link-in-bio theme shelf
 * (Stack 100 wave 2, item 9 / audit A8).
 *
 * The shelf was 3 dark-only designs. It grew to 9: the original three,
 * three more dark designs (Velvet Noir, Emerald Court, Smoke Platinum)
 * and the first light designs (Golden Marble, Ivory Pearl, Rose
 * Champagne) — company law is light AND dark for everything, and the
 * profile is the creator's front door. Stack-200 U1 added three more
 * (Cobalt Stage dark — the shelf's first blue, Mint Atelier light —
 * its first light green, Amber Dusk dark) — now 12. Stack-300 added
 * two more (Violet Reign dark — the shelf's first purple, Sky Atrium
 * light — its first light blue) — now 14. Stack 400 added two more
 * (Sandstone Dune light — the shelf's first sandstone, Graphite Pro
 * dark — its first neutral business graphite) — now 16.
 *
 * The theme key list lives in three places by construction:
 *  - the FE design registry (components/promote/bio-themes.tsx) — the
 *    full token sets BioPageView renders;
 *  - the db schema's BIO_THEMES (lib/db/src/schema/bio-pages.ts) — the
 *    server validates the key on save (BIO_THEME_KEYS), so a key the
 *    schema doesn't know is a theme a creator can pick but never save;
 *  - the World desk's BIO_PAGE_THEMES (lib/world/business-desks.ts).
 * This suite pins all three to the same ordered keys, the schema's
 * English label/blurb to the en catalog, and every catalog to carrying
 * every theme's label + blurb — the drift shape the cover-art dedupe
 * (item 7) was built to kill.
 *
 * It also pins: every theme carries the complete token set; BioPageView
 * renders the featured rows / footer / page text FROM the theme (the
 * tokens the light designs need — before this lane they were hard-coded
 * white-on-dark literals, which made a light design impossible); the
 * builder picker renders from the registry; bioTheme()'s fallback is
 * still the first theme; and the original three themes' design tokens
 * are byte-for-byte the ones they shipped with (their new tokens carry
 * exactly the literals BioPageView used to hard-code, so their pages
 * render identically).
 *
 * House pattern: registries that live in .tsx modules are read as
 * source (vitest here runs jsx:preserve tsconfig), pure .ts modules
 * are imported for real.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BIO_PAGE_THEMES } from "./world/business-desks";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const EXPECTED_KEYS = [
  "gold-royal", "midnight-gold", "onyx-minimal",
  "velvet-noir", "emerald-court", "smoke-platinum",
  "golden-marble", "ivory-pearl", "rose-champagne",
  "cobalt-stage", "mint-atelier", "amber-dusk",
  "violet-reign", "sky-atrium", "sandstone-dune",
  "graphite-pro",
];
const DARK_KEYS = ["gold-royal", "midnight-gold", "onyx-minimal", "velvet-noir", "emerald-court", "smoke-platinum", "cobalt-stage", "amber-dusk", "violet-reign", "graphite-pro"];
const LIGHT_KEYS = ["golden-marble", "ivory-pearl", "rose-champagne", "mint-atelier", "sky-atrium", "sandstone-dune"];

/* Every token a theme must define. linkTitle / linkIcon may be "" —
   "" means "inherit the button's own text color", a real design value
   the original three already use. Everything else must be non-empty. */
const ALL_TOKENS = [
  "key", "labelKey", "blurbKey", "mode", "page", "glow", "card", "pageText",
  "name", "headline", "bioText", "linkButton", "linkTitle", "linkIcon",
  "socialButton", "featuredCard", "sectionLabel", "featuredIcon",
  "featuredLabel", "featuredKind", "tipButton", "badge", "footerText",
] as const;
const NON_EMPTY_TOKENS = ALL_TOKENS.filter((k) => k !== "linkTitle" && k !== "linkIcon");

/* ─── The FE registry, extracted from bio-themes.tsx source ──────────
   Each entry is a flat object literal of string fields; token values
   contain no braces or double quotes, so a block + field regex is an
   exact read of the registry. */
const bioThemesSrc = read("../components/promote/bio-themes.tsx");
const registryBlock = bioThemesSrc.slice(
  bioThemesSrc.indexOf("export const BIO_THEMES"),
  bioThemesSrc.indexOf("export function bioTheme"),
);
type ThemeRow = Record<(typeof ALL_TOKENS)[number], string>;
const FE_THEMES: ThemeRow[] = [...registryBlock.matchAll(/\{\s*key: "([^"]+)",([\s\S]*?)\n  \},/g)].map((m) => {
  const row = { key: m[1]! } as ThemeRow;
  for (const f of m[2]!.matchAll(/(\w+): "([^"]*)"/g)) {
    row[f[1] as (typeof ALL_TOKENS)[number]] = f[2]!;
  }
  return row;
});

/* ─── Catalogs ─────────────────────────────────────────────────────── */
interface Catalog { linkInBio: { theme: Record<string, string> } }
const catalogNames = readdirSync(new URL("../locales", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
const catalogs = new Map<string, Catalog>(
  catalogNames.map((n) => [n, JSON.parse(read(`../locales/${n}.json`)) as Catalog]),
);
const en = catalogs.get("en")!;

/* ─── The db schema's BIO_THEMES, extracted from source ────────────── */
const schemaSrc = read("../../../../lib/db/src/schema/bio-pages.ts");
const schemaBlock = schemaSrc.slice(schemaSrc.indexOf("export const BIO_THEMES"));
const schemaThemes = [...schemaBlock.matchAll(/\{\s*key: "([^"]+)", label: "([^"]+)", blurb: "([^"]+)"\s*\}/g)]
  .map((m) => ({ key: m[1]!, label: m[2]!, blurb: m[3]! }));

const builder = read("../components/promote/LinkInBioBuilder.tsx");
const apiRoute = read("../../../api-server/src/routes/bio-pages.ts");

describe("bio themes shelf — registry", () => {
  it("is a real shelf: 16 themes, the expected keys in order, no duplicates", () => {
    expect(FE_THEMES.map((t) => t.key)).toEqual(EXPECTED_KEYS);
    expect(new Set(FE_THEMES.map((t) => t.key)).size).toBe(FE_THEMES.length);
  });

  it("every theme carries the complete token set", () => {
    expect(FE_THEMES.length).toBe(EXPECTED_KEYS.length);
    for (const theme of FE_THEMES) {
      for (const token of ALL_TOKENS) {
        expect(typeof theme[token], `${theme.key}.${token}`).toBe("string");
      }
      for (const token of NON_EMPTY_TOKENS) {
        expect(theme[token].length, `${theme.key}.${token}`).toBeGreaterThan(0);
      }
      expect(["dark", "light"], theme.key).toContain(theme.mode);
    }
  });

  it("label/blurb keys follow the house pattern and resolve in every catalog", () => {
    expect(catalogNames).toEqual(["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "pt"]);
    for (const theme of FE_THEMES) {
      expect(theme.labelKey.startsWith("linkInBio.theme.")).toBe(true);
      expect(theme.blurbKey).toBe(`${theme.labelKey}Blurb`);
      const leaf = theme.labelKey.split(".").pop()!;
      for (const [name, catalog] of catalogs) {
        expect(catalog.linkInBio.theme[leaf]?.length, `${name}:${leaf}`).toBeGreaterThan(0);
        expect(catalog.linkInBio.theme[`${leaf}Blurb`]?.length, `${name}:${leaf}Blurb`).toBeGreaterThan(0);
      }
    }
  });
});

describe("bio themes shelf — light and dark", () => {
  it("covers both grounds: 10 dark designs and 6 light designs", () => {
    expect(FE_THEMES.filter((t) => t.mode === "dark").map((t) => t.key)).toEqual(DARK_KEYS);
    expect(FE_THEMES.filter((t) => t.mode === "light").map((t) => t.key)).toEqual(LIGHT_KEYS);
  });

  it("each theme resolves in its own ground: dark grounds carry white text, light grounds carry espresso text", () => {
    for (const theme of FE_THEMES) {
      if (theme.mode === "dark") {
        expect(theme.page, theme.key).toMatch(/^bg-(black|\[#0)/);
        expect(theme.name, theme.key).toBe("text-white");
        expect(theme.featuredLabel, theme.key).toBe("text-white/90");
      } else {
        expect(theme.page, theme.key).toMatch(/^bg-\[#F/);
        expect(theme.name, theme.key).not.toContain("text-white");
        expect(theme.pageText, theme.key).not.toContain("text-white");
        expect(theme.featuredLabel, theme.key).not.toContain("text-white");
      }
    }
  });

  it("BioPageView renders page text, featured rows and footer FROM the theme, dark-locked as authored", () => {
    expect(bioThemesSrc).toContain("data-dark-lock");
    expect(bioThemesSrc).toContain("${theme.page} ${theme.pageText}");
    expect(bioThemesSrc).toContain("${theme.sectionLabel}");
    expect(bioThemesSrc).toContain("${theme.featuredIcon}");
    expect(bioThemesSrc).toContain("${theme.featuredLabel}");
    expect(bioThemesSrc).toContain("${theme.featuredKind}");
    expect(bioThemesSrc).toContain("${theme.footerText}");
    /* the old hard-coded white-on-dark literals are gone from the view */
    expect(bioThemesSrc).not.toContain("${theme.page} text-white");
    expect(bioThemesSrc).not.toContain("font-semibold text-white/90");
  });

  it("bioTheme resolves by key with the first theme (gold-royal) as fallback", () => {
    expect(bioThemesSrc).toContain("BIO_THEMES.find((t) => t.key === key) ?? BIO_THEMES[0]!");
    expect(FE_THEMES[0]!.key).toBe("gold-royal");
  });
});

describe("bio themes shelf — picker + parity", () => {
  it("the builder picker renders from the registry", () => {
    expect(builder).toContain("BIO_THEMES.map");
    expect(builder).toContain("t(th.labelKey)");
    expect(builder).toContain("t(th.blurbKey)");
  });

  it("the db schema's validation list carries the same keys in the same order", () => {
    expect(schemaThemes.map((t) => t.key)).toEqual(EXPECTED_KEYS);
    expect(schemaSrc).toContain("BIO_THEME_KEYS");
    expect(apiRoute).toContain("BIO_THEME_KEYS");
  });

  it("the World desk shelf carries the same keys in the same order", () => {
    expect(BIO_PAGE_THEMES.map((t) => t.key)).toEqual(EXPECTED_KEYS);
  });

  it("schema and World English labels match the en catalog; schema blurbs match too", () => {
    for (const theme of FE_THEMES) {
      const leaf = theme.labelKey.split(".").pop()!;
      const schemaRow = schemaThemes.find((t) => t.key === theme.key)!;
      expect(schemaRow.label, theme.key).toBe(en.linkInBio.theme[leaf]);
      expect(schemaRow.blurb, theme.key).toBe(en.linkInBio.theme[`${leaf}Blurb`]);
      const worldRow = BIO_PAGE_THEMES.find((t) => t.key === theme.key)!;
      expect(worldRow.label, theme.key).toBe(en.linkInBio.theme[leaf]);
    }
  });
});

describe("bio themes shelf — the original three are unchanged", () => {
  /* Their pre-expansion design tokens, verbatim (bio-themes.tsx at
     23a636903). The expansion added mode + the view tokens; every value
     here must still match, and the added view tokens must equal the
     literals BioPageView hard-coded before (text-white page text,
     amber-400/80 section label, amber-400 featured icon, white/90
     featured label, white/35 kind + footer) — so an existing page in
     any of these themes renders pixel-identically. */
  const ORIGINALS: Record<string, Record<string, string>> = {
    "gold-royal": {
      page: "bg-black",
      glow: "radial-gradient(600px 320px at 50% -60px, rgba(212,175,55,0.22), transparent 70%)",
      card: "border-amber-500/30 bg-gradient-to-b from-zinc-900 to-black shadow-[0_0_60px_rgba(212,175,55,0.12)]",
      name: "text-white", headline: "text-amber-200/90", bioText: "text-zinc-400",
      linkButton: "border-amber-500/25 bg-gradient-to-r from-amber-400 to-yellow-500 text-black hover:brightness-110 shadow-[0_4px_24px_rgba(212,175,55,0.25)]",
      linkTitle: "", linkIcon: "",
      socialButton: "border-white/12 bg-white/[0.04] text-amber-300/90 hover:border-amber-500/50 hover:text-amber-300",
      featuredCard: "border-white/10 bg-white/[0.03] hover:border-amber-500/40",
      tipButton: "border-amber-500/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20",
      badge: "text-amber-500/80 hover:text-amber-400",
    },
    "midnight-gold": {
      page: "bg-[#070b16]",
      glow: "radial-gradient(600px 320px at 50% -60px, rgba(212,175,55,0.16), transparent 70%), radial-gradient(400px 200px at 80% 0%, rgba(56,89,199,0.12), transparent 70%)",
      card: "border-amber-400/20 bg-gradient-to-b from-[#0d1428] to-[#070b16] shadow-[0_0_60px_rgba(212,175,55,0.08)]",
      name: "text-white", headline: "text-amber-200/80", bioText: "text-slate-400",
      linkButton: "border border-amber-400/30 bg-[#0d1428]/80 text-amber-100 hover:border-amber-400/60 hover:bg-[#131c36]",
      linkTitle: "", linkIcon: "text-amber-400",
      socialButton: "border-white/10 bg-white/[0.03] text-slate-300 hover:border-amber-400/50 hover:text-amber-300",
      featuredCard: "border-white/10 bg-white/[0.02] hover:border-amber-400/40",
      tipButton: "border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20",
      badge: "text-amber-500/70 hover:text-amber-400",
    },
    "onyx-minimal": {
      page: "bg-black",
      glow: "none",
      card: "border-white/10 bg-black",
      name: "text-white", headline: "text-white/60", bioText: "text-white/45",
      linkButton: "border border-white/15 bg-white text-black hover:bg-amber-100",
      linkTitle: "", linkIcon: "",
      socialButton: "border-white/15 bg-transparent text-white/60 hover:border-amber-500/60 hover:text-amber-300",
      featuredCard: "border-white/10 bg-transparent hover:border-amber-500/40",
      tipButton: "border border-amber-500/50 bg-transparent text-amber-300 hover:bg-amber-400/10",
      badge: "text-white/40 hover:text-amber-400",
    },
  };

  it("every original design token still matches its shipped value", () => {
    for (const [key, tokens] of Object.entries(ORIGINALS)) {
      const theme = FE_THEMES.find((t) => t.key === key)!;
      for (const [token, value] of Object.entries(tokens)) {
        expect(theme[token as keyof ThemeRow], `${key}.${token}`).toBe(value);
      }
      expect(theme.mode, key).toBe("dark");
      expect(theme.pageText, key).toBe("text-white");
      expect(theme.sectionLabel, key).toBe("text-amber-400/80");
      expect(theme.featuredIcon, key).toBe("text-amber-400");
      expect(theme.featuredLabel, key).toBe("text-white/90");
      expect(theme.featuredKind, key).toBe("text-white/35");
      expect(theme.footerText, key).toBe("text-white/35");
    }
  });
});
