/**
 * Catalog/Library i18n pins (stack100 locale unit 42, manifest item 42).
 *
 * The World's Catalog/Library desk family — CatalogExportDesk,
 * CatalogImportDesk, SavedDesk, AlbumsDesk, BooksDesk,
 * WallpapersDesk and MoviesDesk — rendered hard-coded English
 * inside a 10-locale product. Their own copy now lives in the
 * locale catalogs under worldCatalogLibrary.*, extracted
 * key-for-key (the en values are the desks' original wording,
 * verbatim). These pins hold:
 *
 *  - extraction: every family component renders through
 *    useTranslation, and every catalog key in the namespace is
 *    actually referenced by the components or their seams (no
 *    orphan keys, no unextracted remainder in the namespace);
 *  - parity: all 10 locales carry the full extracted key set,
 *    values non-empty, with identical interpolation-token sets
 *    per key;
 *  - the MONEY LAW: every line that states a specific price, fee,
 *    charge, refund or no-charge fact (enumerated in MONEY_KEYS
 *    below — publish/cover/assist prices, print quote + order
 *    totals, wallpaper pack/clip/loop prices, movie run costs,
 *    out-of-Bucs and refund honesty lines) carries the English
 *    source VERBATIM in every catalog. Money copy is never
 *    agent-drafted; figures reach the line by interpolation;
 *  - formatting: numbers/currency in the family format with
 *    i18n.language — no hard-coded "en-US", no bare toLocale*()
 *    calls.
 *
 * Anti-drift reuse (NOT re-keyed into this namespace): strings
 * the desks share verbatim with the same feature's 2D page ride
 * that page's existing catalog keys — the import desk's status
 * words and shared verbs ride catalogImport.* (status per status,
 * dismiss, bringIn, approvePutHome, rebuildDetails,
 * approveAllReady, accountsTitle, homeTitle, titleLabel,
 * descriptionLabel, yourUpload, retry, captionsPreview,
 * chaptersLine); the movies desk's mode tabs, format labels and
 * result headers ride movies.* (tabs, formats, whatMaking,
 * describeConcept, describeStream, charCount, need50,
 * genrePlaceholder, streamUrlPlaceholder, logline, characterBible,
 * pilotHook, comparables, threeAct, episodeBreakdown, epLabel,
 * arcLabel, streamSummary, clipMoments, postingStrategy, finding);
 * the wallpapers desk's generation/render failure lines ride
 * wallpapers.* (generateFailed, renderFailed, pack10Failed,
 * videoGenerateFailed, screensaverRenderFailed, libraryFailed).
 *
 * Deliberately NOT extracted (documented in the unit report):
 * catalog DATA the code treats as content, not UI copy — the
 * wallpaper device presets (lib/wallpapers, the website's own
 * shared lib data), catalog platform names, movie clip category
 * words the model returns; rail-provided copy rendered verbatim
 * (honesty movesLine, item statusNote, account notes, printer
 * shipping-option labels, the detection note); enum/status tokens
 * themselves; overrideFeature rail labels per house convention;
 * the albums seam's albumTypeLabel English defaults (the desk
 * maps known types to catalog keys and falls back to the seam);
 * the movies seam's hub-asset label fallback ("Movie concept" —
 * filed member data, not desk chrome); the get-paid-tail seam's
 * option-label records (the desk maps them to catalog keys; the
 * seam's composed problem/result lines take optional string
 * bundles with byte-identical English defaults).
 *
 * TRANSLATION STATUS: en is final. The other nine catalogs' values
 * are AGENT-DRAFTED and UNREVIEWED (standing stack600 practice);
 * the MONEY_KEYS values are exempt from drafting by the money
 * law — they are the English source in every catalog.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];
const NS = "worldCatalogLibrary";

const COMPONENTS: Record<string, string> = {
  CatalogExportDesk: read("../../components/world/native/CatalogExportDesk.tsx"),
  CatalogImportDesk: read("../../components/world/native/CatalogImportDesk.tsx"),
  SavedDesk: read("../../components/world/native/SavedDesk.tsx"),
  AlbumsDesk: read("../../components/world/native/AlbumsDesk.tsx"),
  BooksDesk: read("../../components/world/native/BooksDesk.tsx"),
  WallpapersDesk: read("../../components/world/native/WallpapersDesk.tsx"),
  MoviesDesk: read("../../components/world/native/MoviesDesk.tsx"),
};
const SEAMS: Record<string, string> = {
  getPaidTail: read("./get-paid-tail.ts"),
};
const ALL_SOURCES = { ...COMPONENTS, ...SEAMS };
const JOINED = Object.values(ALL_SOURCES).join("\n");

const en = readJson("../../locales/en.json");
const enNs = (en[NS] ?? {}) as Record<string, string>;
const enKeys = Object.keys(enNs).sort();
const CATALOGS: Record<string, Record<string, string>> = {};
for (const loc of LOCALES) {
  CATALOGS[loc] = (readJson(`../../locales/${loc}.json`)[NS] ?? {}) as Record<string, string>;
}

const MONEY_KEYS = [
  "albumsIntro",
  "albumsOutOfCredits",
  "albumsPublishButton",
  "booksAssistError",
  "booksAssistTitle",
  "booksCoverError",
  "booksCoverGenerate",
  "booksCoverNew",
  "booksCoverTitle",
  "booksIntro",
  "booksOrderConfirm",
  "booksOrderPlacedAmount",
  "booksOutOfCredits",
  "booksQuoteLine",
  "moviesCostLine",
  "moviesFailClipsEmpty",
  "moviesFailConceptEmpty",
  "moviesFailStudio",
  "moviesOutOfBucs",
  "wpArtCostLine",
  "wpCleanCost",
  "wpCostClean",
  "wpLivingIntro",
  "wpMakeLoop",
  "wpMakePack",
  "wpOutOfBucs",
  "wpPackIntro",
];

const tokensOf = (value: string): string[] =>
  [...value.matchAll(/\{\{\s*[^{}]+?\s*\}\}/g)].map((m) => m[0].replace(/\s+/g, "")).sort();

describe("Catalog/Library extraction (unit 42)", () => {
  it("every family component renders through useTranslation", () => {
    for (const [name, src] of Object.entries(COMPONENTS)) {
      expect(src, name).toContain('import { useTranslation } from "react-i18next"');
      expect(src, name).toContain("useTranslation()");
    }
  });

  it("the namespace holds the family's full extracted key set", () => {
    expect(enKeys.length).toBe(382);
  });

  it("every catalog key is referenced by a component or seam (no orphans, no remainder)", () => {
    const referenced = new Set<string>();
    for (const m of JOINED.matchAll(/worldCatalogLibrary\.([A-Za-z0-9_]+)/g)) {
      referenced.add(m[1]!);
    }
    expect([...referenced].sort()).toEqual(enKeys);
  });

  it("numbers and currency format in the walker's language — never hard-coded en-US, never bare", () => {
    for (const [name, src] of Object.entries(ALL_SOURCES)) {
      expect(src, name).not.toContain('toLocaleDateString("en-US"');
      expect(src, name).not.toContain('toLocaleString("en-US"');
      expect(src, name).not.toContain(".toLocaleDateString()");
      expect(src, name).not.toContain(".toLocaleString()");
    }
    expect(COMPONENTS.WallpapersDesk).toContain("toLocaleString(i18n.language)");
    expect(COMPONENTS.MoviesDesk).toContain("cost.toLocaleString(i18n.language)");
    expect(COMPONENTS.BooksDesk).toContain('Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD" })');
    expect(SEAMS.getPaidTail).toContain("result.count.toLocaleString(locale)");
  });

  it("the desks reuse the 2D pages' own catalog keys where the words are shared (anti-drift)", () => {
    expect(COMPONENTS.CatalogImportDesk).toContain("catalogImport.statusListed");
    expect(COMPONENTS.CatalogImportDesk).toContain("catalogImport.approvePutHome");
    expect(COMPONENTS.CatalogImportDesk).toContain("catalogImport.dismiss");
    expect(COMPONENTS.MoviesDesk).toContain("movies.tabs.concept");
    expect(COMPONENTS.MoviesDesk).toContain("movies.formats.movie");
    expect(COMPONENTS.MoviesDesk).toContain("movies.episodeBreakdown");
    expect(COMPONENTS.WallpapersDesk).toContain("wallpapers.generateFailed");
    expect(COMPONENTS.WallpapersDesk).toContain("wallpapers.pack10Failed");
  });

  it("en copy is the desks' original wording, verbatim (representative pins)", () => {
    expect(enNs.exportTitle).toBe("Your catalog, downloadable");
    expect(enNs.importApproveAllNotice).toBe(
      "Approved {{ok}} of {{total}} — the rest keep their drafts for your word.",
    );
    expect(enNs.savedEmptyAll).toBe(
      "Nothing saved yet — the bookmark buttons across the site fill this shelf.",
    );
    expect(enNs.albumsPublishButton).toBe("Publish — {{cost}} Bucs");
    expect(enNs.booksQuoteLine).toBe(
      "{{quantity}} × 6″×9″ paperback ({{pages}} pages) — print {{price}} Bucs (${{usd}})",
    );
    expect(enNs.wpPackIntro).toBe(
      "Pick exactly {{count}} pieces — one flat {{cost}} Visual Bucs for all ten at the size picked above, never ten separate charges. {{picked}} of {{count}} picked.",
    );
    expect(enNs.moviesCostLine).toBe("Costs {{cost}} Visual Bucs — shown before anything runs.");
    expect(enNs.exportResultBuilt).toBe(
      "Built: {{count}} {{kind}} · {{format}} — downloading as {{file}}.",
    );
  });
});

describe("Catalog/Library catalog parity (unit 42)", () => {
  it("all 10 locales carry exactly the extracted key set", () => {
    for (const loc of LOCALES) {
      expect(Object.keys(CATALOGS[loc]!).sort(), loc).toEqual(enKeys);
    }
  });

  it("no locale's value is empty or an untranslated copy of the key name", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        const value = CATALOGS[loc]![key];
        expect(typeof value, `${loc}.${key}`).toBe("string");
        expect(value.trim().length, `${loc}.${key}`).toBeGreaterThan(0);
        expect(value, `${loc}.${key}`).not.toBe(key);
      }
    }
  });

  it("interpolation tokens survive identically in every locale, key for key", () => {
    for (const loc of LOCALES) {
      for (const key of enKeys) {
        expect(tokensOf(CATALOGS[loc]![key]!), `${loc}.${key}`).toEqual(tokensOf(enNs[key]!));
      }
    }
  });

  it("MONEY LAW: every money line is the English source verbatim in all 10 catalogs", () => {
    expect(MONEY_KEYS.length).toBe(27);
    for (const key of MONEY_KEYS) {
      expect(enNs[key], `en missing money key ${key}`).toBeDefined();
      for (const loc of LOCALES) {
        expect(CATALOGS[loc]![key], `${loc}.${key}`).toBe(enNs[key]);
      }
    }
  });
});
