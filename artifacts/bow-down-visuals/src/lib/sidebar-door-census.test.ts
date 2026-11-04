import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHORTS_NAV_ENTRY } from "./shorts-navigation";

/* Sidebar door census (Stack100 wave 1, lane A).
 *
 * The Stack100 census (~/workspace/stack100-manifest.md, items 1–4)
 * found 13 live routes with NO door in the app sidebar — every one
 * reachable only from in-flow page links, a findability-law defect
 * (every feature reachable from the shell). This suite pins the fix:
 * each of the 13 doors hangs in the sidebar, in its correct workflow
 * group, with a real label in all ten catalogs and a searchTerms
 * entry — and, sweep-wide, every href the sidebar carries resolves
 * to a registered App route. Route resolution mirrors
 * nav-route-existence.test.ts. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const sidebar = read("../components/layout/app-sidebar.tsx");
const app = read("../App.tsx");

const routePaths = new Set<string>();
for (const m of app.matchAll(/<Route\s+path="([^"]+)"/g)) routePaths.add(m[1]);

const strip = (u: string) => u.split("?")[0].split("#")[0];

/** A pathname resolves when a route declares it exactly, or a
 *  :param route matches it segment-for-segment. */
function resolves(pathname: string): boolean {
  if (routePaths.has(pathname)) return true;
  for (const r of routePaths) {
    if (!r.includes(":")) continue;
    const rp = r.split("/");
    const pp = pathname.split("/");
    if (rp.length !== pp.length) continue;
    if (rp.every((seg, i) => seg.startsWith(":") || seg === pp[i])) return true;
  }
  return false;
}

/* The sidebar's two door registries: the SECTIONS array and the
 * FOOTER_LINKS array that follows it. */
const sectionsBlock = sidebar.slice(
  sidebar.indexOf("const SECTIONS"),
  sidebar.indexOf("const FOOTER_LINKS"),
);
const footerBlock = sidebar.slice(sidebar.indexOf("const FOOTER_LINKS"));

type Door = { href: string; labelKey: string; searchTerms?: string };

function literalDoors(block: string): Door[] {
  const out: Door[] = [];
  for (const m of block.matchAll(
    /\{\s*href:\s*"([^"]+)",\s*labelKey:\s*"([^"]+)"(?:,\s*icon:[^,}]+)?(?:,\s*searchTerms:\s*"([^"]*)")?/g,
  )) {
    out.push({ href: m[1]!, labelKey: m[2]!, searchTerms: m[3] });
  }
  return out;
}

const sectionDoors = literalDoors(sectionsBlock);
/* The Shorts door is the one dynamic entry — its href/labelKey live
 * in SHORTS_NAV_ENTRY (shorts-navigation.ts), spread into SECTIONS. */
expect(sectionsBlock).toContain("SHORTS_NAV_ENTRY");
sectionDoors.push({
  href: SHORTS_NAV_ENTRY.href,
  labelKey: SHORTS_NAV_ENTRY.labelKey,
  searchTerms: "shorts", // the entry's own literal in the sidebar
});
const footerDoors = literalDoors(footerBlock);
const allDoors = [...sectionDoors, ...footerDoors];

/** The slice of SECTIONS belonging to one group (from its titleKey
 *  marker to the next group's, or the end of the block). */
function sectionSlice(titleKey: string): string {
  const ORDER = [
    "nav.myStudio",
    "nav.create",
    "nav.branding",
    "nav.promote",
    "nav.social",
    "nav.getPaid",
  ];
  const start = sectionsBlock.indexOf(`titleKey: "${titleKey}"`);
  expect(start, `section ${titleKey} exists`).toBeGreaterThanOrEqual(0);
  const next = ORDER[ORDER.indexOf(titleKey) + 1];
  const end = next ? sectionsBlock.indexOf(`titleKey: "${next}"`) : sectionsBlock.length;
  return sectionsBlock.slice(start, end === -1 ? sectionsBlock.length : end);
}

/* The 13 doors of manifest items 1–4: href, the nav.* label key, the
 * en label (the page's own name), and the home group. */
const NEW_DOORS: Array<{ href: string; key: string; en: string; section: string }> = [
  // Item 1 — Promote
  { href: "/tour", key: "tourPlanner", en: "Tour Planner", section: "nav.promote" },
  { href: "/setlist", key: "setlistBuilder", en: "Setlist Builder", section: "nav.promote" },
  { href: "/interview-prep", key: "interviewPrep", en: "Interview Prep", section: "nav.promote" },
  { href: "/label-pitch", key: "labelPitch", en: "Label Pitch", section: "nav.promote" },
  // Item 2 — Create / My Studio
  { href: "/carousel-maker", key: "carouselMaker", en: "Carousel Maker", section: "nav.create" },
  { href: "/detector", key: "mediaDetector", en: "Media Detector", section: "nav.create" },
  { href: "/my-music", key: "myMusic", en: "My Music", section: "nav.myStudio" },
  { href: "/import", key: "mediaImport", en: "Import Media", section: "nav.myStudio" },
  // Item 3 — Social
  { href: "/trending", key: "trending", en: "Trending", section: "nav.social" },
  { href: "/movies", key: "movies", en: "Movies", section: "nav.social" },
  { href: "/saved", key: "saved", en: "Saved", section: "nav.social" },
  // Item 4 — Branding
  { href: "/jewelry-shop", key: "jewelryShop", en: "Jewelry Shop", section: "nav.branding" },
  { href: "/creator/domains", key: "creatorDomains", en: "Creator Domains", section: "nav.branding" },
];

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
type Catalog = { nav?: Record<string, string> };
const catalogs = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(read(`../locales/${l}.json`)) as Catalog]),
) as Record<(typeof LOCALES)[number], Catalog>;

describe("sidebar door census — the extraction is not vacuous", () => {
  it("reads a real sidebar and a real route table", () => {
    expect(routePaths.size).toBeGreaterThan(150);
    /* Exact census at this lane: 69 section doors (68 literal
     * entries + the dynamic Shorts entry) and 5 footer doors.
     * Adding or removing a sidebar door updates this pin. */
    expect(sectionDoors.length).toBe(69);
    expect(footerDoors.length).toBe(5);
  });
});

describe("sidebar door census — the 13 Stack100 wave-1 doors", () => {
  it("every door is present in the sidebar with its label key", () => {
    for (const d of NEW_DOORS) {
      const found = sectionDoors.find((x) => x.href === d.href);
      expect(found, `door ${d.href}`).toBeDefined();
      expect(found!.labelKey).toBe(`nav.${d.key}`);
    }
  });

  it("every door hangs in its home workflow group", () => {
    for (const d of NEW_DOORS) {
      expect(
        sectionSlice(d.section),
        `${d.href} in ${d.section}`,
      ).toContain(`{ href: "${d.href}", labelKey: "nav.${d.key}"`);
    }
  });

  it("every door carries search terms for the shell search", () => {
    for (const d of NEW_DOORS) {
      const found = sectionDoors.find((x) => x.href === d.href)!;
      expect(found.searchTerms, `searchTerms on ${d.href}`).toBeTruthy();
      expect(found.searchTerms!.length).toBeGreaterThan(10);
    }
  });

  it("every door's label is the page's own name in en and exists in all ten catalogs", () => {
    for (const d of NEW_DOORS) {
      expect(catalogs.en.nav?.[d.key], `en nav.${d.key}`).toBe(d.en);
      for (const l of LOCALES) {
        const v = catalogs[l].nav?.[d.key];
        expect(typeof v, `${l} nav.${d.key}`).toBe("string");
        expect(v!.trim().length, `${l} nav.${d.key} non-empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe("sidebar door census — every sidebar href lands on a real route", () => {
  it("sections + footer hrefs all resolve to registered routes", () => {
    for (const d of allDoors) {
      expect(resolves(strip(d.href)), `sidebar → ${d.href}`).toBe(true);
    }
  });

  it("section hrefs are unique (no door hangs twice)", () => {
    const hrefs = sectionDoors.map((d) => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("every section door carries a label key whose en label exists", () => {
    for (const d of sectionDoors) {
      expect(d.labelKey.startsWith("nav."), `${d.href} labelKey`).toBe(true);
      const key = d.labelKey.slice("nav.".length);
      const v = catalogs.en.nav?.[key];
      expect(typeof v, `en ${d.labelKey} for ${d.href}`).toBe("string");
      expect(v!.trim().length).toBeGreaterThan(0);
    }
  });
});
