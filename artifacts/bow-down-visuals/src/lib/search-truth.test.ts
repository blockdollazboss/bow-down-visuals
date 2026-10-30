/**
 * Search truth (Stack1000 lane N5) — the plain-words query table.
 *
 * The Oct-18 findability round fixed the nav's LABELS; this round
 * audits the site's own SEARCH. Two surfaces index pages:
 *   1. the sidebar's "Search pages…" filter (SECTIONS + FOOTER_LINKS
 *      in app-sidebar.tsx, matched over rendered label + searchTerms
 *      alias words + href), and
 *   2. the /features registry search (SITE_FEATURES, matched over
 *      name + tagline + keywords).
 *
 * Before this lane both matched the WHOLE typed string as one
 * substring and the registry didn't list several shipped surfaces at
 * all, so the table below scored 17/28 against the real data
 * (sidebar 10/14, registry 7/14 — measured with the lane's runner
 * over the pre-fix tree @1fe340a60). The table is the regression
 * guard: a creator typing plain words must land on the real feature,
 * by its real name, on BOTH surfaces.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { matchesQuery, queryTokens } from "./search-match";
import { SITE_FEATURES } from "../data/features";

const sidebar = readFileSync(
  new URL("../components/layout/app-sidebar.tsx", import.meta.url),
  "utf8",
);
const featuresPage = readFileSync(
  new URL("../pages/features.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const en = JSON.parse(
  readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"),
) as { nav: Record<string, string> };

/* Sidebar entries parsed from the component source (whole-object
   capture, then field extraction — a lazy single-regex pass silently
   drops searchTerms; the lane's first runner proved that the hard way). */
interface NavEntry { href: string; labelKey: string; searchTerms: string }
function parseNav(block: string): NavEntry[] {
  const out: NavEntry[] = [];
  const re = /\{ href: "([^"]+)", labelKey: "([^"]+)"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const terms = /searchTerms: "([^"]*)"/.exec(m[0]);
    out.push({ href: m[1], labelKey: m[2], searchTerms: terms ? terms[1] : "" });
  }
  return out;
}
const navEntries = [
  ...parseNav(sidebar.slice(sidebar.indexOf("const SECTIONS"), sidebar.indexOf("const FOOTER_LINKS"))),
  ...parseNav(sidebar.slice(sidebar.indexOf("const FOOTER_LINKS"), sidebar.indexOf("function SidebarSection"))),
];

function sidebarSearch(query: string): string[] {
  return navEntries
    .filter((l) =>
      matchesQuery(
        `${en.nav[l.labelKey.replace("nav.", "")] ?? ""} ${l.searchTerms} ${l.href}`,
        query,
      ),
    )
    .map((l) => l.href);
}

function registrySearch(query: string) {
  return SITE_FEATURES.filter((f) =>
    matchesQuery(`${f.name} ${f.tagline} ${f.keywords ?? ""}`, query),
  );
}

/* [query, expected sidebar href, expected registry route] */
const TABLE: Array<[string, string, string]> = [
  ["earnings", "/earnings", "/earnings"],
  ["go live", "/go-live", "/go-live"],
  ["green screen", "/go-live", "/go-live"],
  ["thumbnail", "/thumbnail-studio", "/thumbnail-studio"],
  ["get paid", "/earnings", "/earnings"],
  ["memberships", "/memberships", "/memberships"],
  ["book a show", "/events", "/shows"],
  ["sell beats", "/beats", "/beats"],
  ["subtitles", "/video-editor", "/video-editor"],
  ["translate my video", "/video-editor", "/video-editor?tab=translate"],
  ["widgets", "/promote", "/promote"],
  ["overlays", "/promote", "/promote"],
  ["now playing", "/promote", "/promote"],
  ["drop day", "/promote", "/promote"],
];

describe("plain-words search truth", () => {
  it("both page indexes run the shared plain-words matcher", () => {
    expect(sidebar).toContain("matchesQuery(");
    expect(sidebar).toContain('${t(link.labelKey)} ${link.searchTerms ?? ""} ${link.href}');
    expect(featuresPage).toContain("matchesQuery(");
    expect(featuresPage).toContain("f.keywords");
  });

  it("the matcher keeps single-word behaviour and drops filler words", () => {
    /* Single word: plain substring of the haystack, as before. */
    expect(matchesQuery("Go Live green screen", "live")).toBe(true);
    expect(matchesQuery("Go Live green screen", "purple")).toBe(false);
    /* Every meaningful word must land; filler words don't gate. */
    expect(matchesQuery("Earnings payouts", "get paid")).toBe(false);
    expect(matchesQuery("Earnings get paid payouts", "get paid")).toBe(true);
    expect(queryTokens("how do I translate my video")).toEqual(["translate", "video"]);
    /* A query of only filler words falls back to whole-string match. */
    expect(matchesQuery("the hub", "the")).toBe(true);
  });

  for (const [query, expSidebar, expRoute] of TABLE) {
    it(`"${query}" lands on ${expRoute} in both searches`, () => {
      expect(sidebarSearch(query), `sidebar: ${query}`).toContain(expSidebar);
      const routes = registrySearch(query).map((f) => f.route);
      const base = expRoute.split("?")[0];
      const hit = expRoute.includes("?")
        ? routes.includes(expRoute)
        : routes.some((r) => r === expRoute || r.startsWith(base + "?"));
      expect(hit, `registry: ${query} → got [${routes.join(", ")}]`).toBe(true);
    });
  }

  it("the registry lists the shipped surfaces the audit found missing", () => {
    const keys = SITE_FEATURES.map((f) => f.key);
    for (const key of [
      "earnings", "beats-marketplace", "show-finder", "video-translator",
      "green-screen", "widgets-desk", "stream-overlays", "drop-day-kit",
      "thumbnail-duels",
    ]) {
      expect(keys, `registry missing ${key}`).toContain(key);
    }
  });

  it("every new registry route is a real App.tsx route", () => {
    const appRoutes = new Set(
      [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]),
    );
    for (const key of [
      "earnings", "beats-marketplace", "show-finder", "video-translator",
      "green-screen", "widgets-desk", "stream-overlays", "drop-day-kit",
      "thumbnail-duels",
    ]) {
      const f = SITE_FEATURES.find((x) => x.key === key)!;
      expect(appRoutes.has(f.route.split("?")[0]), `${key} → ${f.route}`).toBe(true);
    }
  });

  it("the Promote door carries the stack800/900 desks' words", () => {
    const promote = navEntries.find((l) => l.href === "/promote")!;
    for (const word of ["widgets", "overlays", "now playing", "drop day"]) {
      expect(promote.searchTerms, `promote terms missing "${word}"`).toContain(word);
    }
  });
});
