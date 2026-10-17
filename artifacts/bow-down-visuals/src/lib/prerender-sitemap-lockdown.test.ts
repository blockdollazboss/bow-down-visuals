/**
 * prerender-sitemap-lockdown.test.ts — Access lock-down Lane 4
 * (audit ~/workspace/access-lockdown/AUDIT.md §1.4, §4.6, §5.1 Lane 4).
 *
 * The owner's ruling (D4, strict) LOCKED the whole SEO / marketing /
 * discovery family behind sign-in. A prerendered page — or a sitemap
 * entry — for a locked route is a soft-404 risk: crawlers receive a
 * page that bounces straight to /login. So the build's two crawler
 * surfaces shrink to the static PUBLIC set:
 *
 *   prerender (scripts/prerender.mjs + src/entry-server.tsx registry):
 *     ONLY "/" — it is the only route that is both static and public
 *     AND was ever prerendered. /charts, /shorts, the marketplace
 *     browse pages, the legal trio and /storefronts are public but
 *     were never prerendered (they are live app surfaces, not static
 *     marketing pages), and parameterized public routes
 *     (/artist/:slug, /shop/:slug, /tips/:handle…) get NO invented
 *     entries. The old prerender list contained no profile or showcase
 *     slugs from data — nothing of that kind existed to keep or drop.
 *
 *   sitemap (public/sitemap.xml): exactly the static public set —
 *     /, /charts, /shorts, marketplace browse (/beats, /shoutouts,
 *     /memberships, /contests, /winners), legal (/terms, /privacy,
 *     /refund-policy) and /storefronts.
 *
 * The definitive route census lives in Lane 1's matrix
 * (lib/public-routes.ts); this test pins the BUILD lists specifically.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const prerenderSource = read("../../scripts/prerender.mjs");
const entryServerSource = read("../entry-server.tsx");
const sitemapSource = read("../../public/sitemap.xml");

/** Routes the task / audit §1.4 names as LOCKED (D4) — prefixes included. */
const LOCKED_ROUTES = [
  "/pricing",
  "/creator-pricing",
  "/features",
  "/extension",
  "/download",
  "/contact",
  "/beta-access",
  "/invite",
  "/waitlist",
  "/templates",
  "/tools",
  "/for",
  "/genres",
  "/genre",
  "/vertical",
  "/showcase",
  "/search",
  "/browse",
  "/explore",
  "/trending",
  // Locked app surfaces (§1.3 / §1.6) that also used to sit in the
  // sitemap — none of them may creep back into either build list.
  "/academy",
  "/brand-calculator",
  "/brand-deals",
  "/branding-kit",
  "/coach",
  "/collabs",
  "/community",
  "/copyright",
  "/distribute",
  "/email-list",
  "/events",
  "/groups",
  "/hooks",
  "/interview-prep",
  "/jewelry-shop",
  "/llc-guide",
  "/my-shop",
  "/press-kit",
  "/promote",
  "/referrals",
  "/remix",
  "/setlist",
  "/team",
  "/tips",
  "/tour",
];

const SITEMAP_PUBLIC_SET = [
  "/",
  "/charts",
  "/shorts",
  "/beats",
  "/shoutouts",
  "/memberships",
  "/contests",
  "/winners",
  "/terms",
  "/privacy",
  "/refund-policy",
  "/storefronts",
];

function prerenderPaths(): string[] {
  return [...prerenderSource.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function entryServerPaths(): string[] {
  return [...entryServerSource.matchAll(/^\s*"(\/[^"]*)":/gm)].map((m) => m[1]);
}

function sitemapPaths(): string[] {
  return [...sitemapSource.matchAll(/<loc>https:\/\/bowdownvisuals\.com([^<]*)<\/loc>/g)].map(
    (m) => (m[1] === "" ? "/" : m[1]),
  );
}

function expectNoLockedRoute(paths: string[], surface: string) {
  for (const p of paths) {
    for (const locked of LOCKED_ROUTES) {
      expect(
        p !== locked && !p.startsWith(`${locked}/`),
        `${surface} lists locked route ${p} (locked family: ${locked})`,
      ).toBe(true);
    }
  }
}

describe("prerender list — trimmed to the static public set (Lane 4)", () => {
  it("scripts/prerender.mjs prerenders ONLY the home page", () => {
    expect(prerenderPaths()).toEqual(["/"]);
  });

  it("src/entry-server.tsx registers ONLY the home page for prerendering", () => {
    expect(entryServerPaths()).toEqual(["/"]);
    // The SEO registry plumbing is gone — locked pages cannot be
    // re-prerendered by re-adding a line to prerender.mjs alone.
    expect(entryServerSource).not.toContain("TOOL_PAGES");
    expect(entryServerSource).not.toContain("VERTICAL_HUBS");
    expect(entryServerSource).not.toContain("GENRE_HUBS");
    expect(entryServerSource).not.toContain("@/pages/seo/");
    expect(entryServerSource).not.toContain("@/pages/pricing");
    expect(entryServerSource).not.toContain("@/pages/beta-access");
  });

  it("no locked route appears in either prerender list", () => {
    expectNoLockedRoute(prerenderPaths(), "prerender.mjs");
    expectNoLockedRoute(entryServerPaths(), "entry-server.tsx");
  });
});

describe("sitemap — trimmed to the static public set (Lane 4)", () => {
  it("public/sitemap.xml lists exactly the static public set", () => {
    expect([...sitemapPaths()].sort()).toEqual([...SITEMAP_PUBLIC_SET].sort());
  });

  it("keeps the approved public families (home, charts/shorts, marketplace browse, legal, storefronts)", () => {
    const paths = sitemapPaths();
    for (const kept of SITEMAP_PUBLIC_SET) {
      expect(paths, `sitemap should keep ${kept}`).toContain(kept);
    }
  });

  it("no locked route appears in the sitemap", () => {
    expectNoLockedRoute(sitemapPaths(), "sitemap.xml");
  });
});
