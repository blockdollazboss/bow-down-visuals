import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import es from "../locales/es.json";
import pt from "../locales/pt.json";
import fr from "../locales/fr.json";
import itCatalog from "../locales/it.json";
import de from "../locales/de.json";
import ar from "../locales/ar.json";
import hi from "../locales/hi.json";
import ja from "../locales/ja.json";
import ko from "../locales/ko.json";
import { THEME_PACKS, THEME_PACK_COPY_KEYS, themePackCopy } from "./theme-packs";

/* ─── Stack 100 locale unit 53 — the theme-pack registry copy
   speaks through the catalogs (worldThemePacks).

   SCOPE (manifest [D20]): src/lib/theme-packs.ts — all 6 packs
   (golden-marble, shark-tank, golden-hour, kings-set, arcade-gold,
   crimson-marble — the sixth added by Stack-200 U4)
   carried name/tagline/description as English literals with zero
   i18n references. The registry now carries the copy's catalog KEY
   REFERENCES (THEME_PACK_COPY_KEYS) and one resolver
   (themePackCopy): hand it a translator and the copy resolves
   through the catalogs; hand it nothing and it returns the pack's
   own fields — the registry literals ARE the English defaults, so
   every non-resolving consumer renders byte-identical English.

   CONSUMERS CENSUSED (every live reader of the registry copy):
   - components/theme-packs/ThemePacksDesk.tsx (Settings →
     Appearance) — renders name/tagline/description on the card,
     the name in the mode-toggle aria-label, the shared-look banner
     and the "You're wearing {{pack}}" line. Resolves at each site
     through its existing useTranslation.
   - components/theme-packs/ThemePackQuickPicker.tsx (hangs on the
     floating theme toggle) — renders the name; now resolves it.
   - components/theme-packs/ThemeKitPanel.tsx (inside every desk
     card) — its aria-labels/alt text resolve the pack name; the
     kit BUILDERS it calls keep the raw pack (below).
   - lib/theme-kit.ts builders — generated file CONTENT (widget
     SVG text, wallpaper names, browser-theme manifests). They
     receive raw registry packs and keep the English name: file
     content is data, not UI copy (the standing rail-content rule).
   - The API server carries NO pack copy (routes/theme-packs.ts
     mirrors only the two premium ids + the price); creator packs
     in CreatorPacksSection are user data, never catalogued.

   MONEY LAW: none of the 18 fields states a price, fee or amount —
   verified by scan (the only digit in the whole family is the "8"
   of the "8-Bit Shark" cursor name in sharkTankDescription, a
   proper name kept verbatim in every catalog). The price lives
   only in THEME_PACK_PRICE_VB and the desk chrome keys, both
   outside this unit and untouched. MONEY_KEYS is therefore empty
   by verification, not by omission.

   DELIBERATELY NOT EXTRACTED: the desk's own chrome (its
   settings.themePacks* defaultValue keys and remaining literals,
   incl. the shared-look banner's sentences — only the pack NAME
   interpolating into them resolves here); the quick picker's
   chrome literals; cursor names (CURSOR_OPTIONS is a different
   registry); wallpaper preset names (lib/wallpapers, another
   surface); kit-builder generated content (above); the server's
   SERVER_PACKS names in api-server theme-kit-build (bundle
   content, pinned for tier parity by qcproof-theme-packs).

   All non-English values in worldThemePacks are AGENT-DRAFTED
   and UNREVIEWED — no native speaker has checked them. Proper
   nouns ride verbatim in every catalog: Bow Down Visuals, the
   cursor names (8-Bit Shark, Flame, King's Crown, Game
   Controller) and the approved set name "King's Set" inside
   kingsSetDescription. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const NS = "worldThemePacks";
type Catalog = Record<string, Record<string, string>>;
const CATALOGS: Record<string, Catalog> = {
  en: en as unknown as Catalog,
  es: es as unknown as Catalog,
  pt: pt as unknown as Catalog,
  fr: fr as unknown as Catalog,
  it: itCatalog as unknown as Catalog,
  de: de as unknown as Catalog,
  ar: ar as unknown as Catalog,
  hi: hi as unknown as Catalog,
  ja: ja as unknown as Catalog,
  ko: ko as unknown as Catalog,
};
const EN = CATALOGS.en[NS];

const SOURCES = [
  "./theme-packs.ts",
  "../components/theme-packs/ThemePacksDesk.tsx",
  "../components/theme-packs/ThemePackQuickPicker.tsx",
  "../components/theme-packs/ThemeKitPanel.tsx",
];

/** No money lines exist in this family — see the header. */
const MONEY_KEYS: string[] = [];

const tokensOf = (value: string): string[] => {
  const found = value.match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [];
  return [...found].sort();
};
const digitsOf = (value: string): string[] => value.match(/[0-9][0-9,]*/g) ?? [];

const translatorFor = (catalog: Catalog) => (key: string) => {
  const [ns, k] = key.split(".");
  return catalog[ns!][k!];
};

describe("unit 53 — theme-pack registry copy resolves through the catalog", () => {
  it("the key map covers exactly the five registry packs", () => {
    expect(Object.keys(THEME_PACK_COPY_KEYS).sort()).toEqual(THEME_PACKS.map((p) => p.id).sort());
  });

  it("the en namespace carries the full copy set (18 keys = 6 packs × 3 fields)", () => {
    expect(Object.keys(EN)).toHaveLength(18);
  });

  it("en catalog values ARE the registry literals, verbatim, pack for pack", () => {
    for (const pack of THEME_PACKS) {
      const keys = THEME_PACK_COPY_KEYS[pack.id]!;
      expect(EN[keys.name.split(".")[1]!], pack.id).toBe(pack.name);
      expect(EN[keys.tagline.split(".")[1]!], pack.id).toBe(pack.tagline);
      expect(EN[keys.description.split(".")[1]!], pack.id).toBe(pack.description);
    }
  });

  it("referenced keys == catalog keys (zero orphans, zero missing) across the seam + consumers", () => {
    const joined = SOURCES.map(read).join("\n");
    const referenced = new Set([...joined.matchAll(/worldThemePacks\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    expect([...referenced].sort()).toEqual(Object.keys(EN).sort());
  });

  it("every live consumer resolves the copy through the seam", () => {
    const desk = read("../components/theme-packs/ThemePacksDesk.tsx");
    expect(desk).toContain("const copy = themePackCopy(pack, t);");
    expect(desk).toContain("{copy.name}");
    expect(desk).toContain("{copy.tagline}");
    expect(desk).toContain("{copy.description}");
    expect(desk).toContain("themePackCopy(lookPack, t).name");
    expect(desk).toContain("themePackCopy(activePack, t).name");
    const picker = read("../components/theme-packs/ThemePackQuickPicker.tsx");
    expect(picker).toContain('import { useTranslation } from "react-i18next"');
    expect(picker).toContain("themePackCopy(pack, t).name");
    const panel = read("../components/theme-packs/ThemeKitPanel.tsx");
    expect(panel).toContain('import { useTranslation } from "react-i18next"');
    expect(panel).toContain("themePackCopy(pack, t).name");
    /* The kit builders keep the raw pack — generated content is data. */
    expect(panel).toContain("kitManifest(pack)");
  });

  it("with no translator the resolver returns the pack's own English fields", () => {
    for (const pack of THEME_PACKS) {
      expect(themePackCopy(pack)).toEqual({
        name: pack.name,
        tagline: pack.tagline,
        description: pack.description,
      });
    }
  });

  it("with a catalog translator the resolver returns that catalog's copy, all ten locales", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const t = translatorFor(catalog);
      for (const pack of THEME_PACKS) {
        const keys = THEME_PACK_COPY_KEYS[pack.id]!;
        const ns = catalog[NS];
        expect(themePackCopy(pack, t), `${locale}/${pack.id}`).toEqual({
          name: ns[keys.name.split(".")[1]!],
          tagline: ns[keys.tagline.split(".")[1]!],
          description: ns[keys.description.split(".")[1]!],
        });
      }
    }
  });

  it("no field in any catalog states a price — the family's only digit is the 8-Bit proper name", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, value] of Object.entries(catalog[NS])) {
        expect(value, `${locale}.${key}`).not.toMatch(/\$|€|£|\bVB\b|Visual Bucs/);
        expect(digitsOf(value).join(""), `${locale}.${key}`).toMatch(/^8?$/);
      }
    }
    expect(MONEY_KEYS).toHaveLength(0);
  });
});

describe("unit 53 — all ten catalogs carry the family whole", () => {
  it("every catalog has exactly the en key set, no empty values", () => {
    const enKeys = Object.keys(EN).sort();
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const ns = catalog[NS];
      expect(ns, locale).toBeDefined();
      expect(Object.keys(ns).sort(), locale).toEqual(enKeys);
      for (const [key, value] of Object.entries(ns)) {
        expect(typeof value, `${locale}.${key}`).toBe("string");
        expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolation tokens match the English per key in every catalog", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(tokensOf(ns[key]), `${locale}.${key}`).toEqual(tokensOf(enValue));
      }
    }
  });

  it("digit sequences match the English per key in every catalog", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(digitsOf(ns[key]), `${locale}.${key}`).toEqual(digitsOf(enValue));
      }
    }
  });

  it("leading/trailing spaces match the English per key", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "en") continue;
      const ns = catalog[NS];
      for (const [key, enValue] of Object.entries(EN)) {
        expect(ns[key].startsWith(" "), `${locale}.${key} leading`).toBe(enValue.startsWith(" "));
        expect(ns[key].endsWith(" "), `${locale}.${key} trailing`).toBe(enValue.endsWith(" "));
      }
    }
  });
});
