/**
 * seo-share-invariants.test.ts — Stack-100 #3 W3 lane 16 (SEO & share).
 *
 * Pins the invariants the audit (.lane/AUDIT.md) fixed, at the level the
 * codebase pins such things (source/file assertions, like
 * prerender-sitemap-lockdown.test.ts):
 *   - index.html carries exactly one of each core meta/OG/Twitter tag,
 *     on the canonical host, pointing at files that exist;
 *   - declared og:image dimensions equal the REAL pixel size of the
 *     share-card files (they lied before: 1200×630 declared, 1280×720
 *     actual);
 *   - both brand share cards are 1200×630 and the JSON-LD Organization
 *     logo is the real lockup (logo-static.webp) — never the app icon;
 *   - prerender.mjs homepage title/description match index.html (one
 *     homepage card, not two);
 *   - the Organization JSON-LD description matches the meta description;
 *   - sitemap ↔ public allowlist agreement: every sitemap URL is
 *     public, and every static public route is either in the sitemap
 *     or in the deliberate-exclusion list below (auth / transactional /
 *     token surfaces are never sitemap material);
 *   - robots.txt references the sitemap on the canonical host and
 *     disallows nothing;
 *   - llms.txt never advertises a locked route as public.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, isPublicPath } from "./public-routes";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readBuf = (rel: string) => readFileSync(new URL(rel, import.meta.url));

const indexHtml = read("../../index.html");
const prerender = read("../../scripts/prerender.mjs");
const jsonLdSource = read("../components/seo/json-ld.tsx");
const sitemap = read("../../public/sitemap.xml");
const robots = read("../../public/robots.txt");
const llms = read("../../public/llms.txt");

const CANON = "https://bowdownvisuals.com";

function pngDims(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function jpegDims(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1]!;
    if (marker === 0xc0 || marker === 0xc2) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error("no JPEG SOF marker");
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("index.html — one of each core tag, canonical host", () => {
  it.each([
    "<title>",
    'name="description"',
    'property="og:title"',
    'property="og:description"',
    'property="og:type"',
    'property="og:url"',
    'property="og:image"',
    'name="twitter:card"',
    'name="twitter:title"',
    'name="twitter:description"',
    'name="twitter:image"',
    'rel="canonical"',
  ])("has exactly one %s", (needle) => {
    expect(count(indexHtml, needle), needle).toBe(1);
  });

  it("canonical + og:url + og:image all live on the canonical host", () => {
    expect(indexHtml).toContain(`<link rel="canonical" href="${CANON}/" />`);
    expect(indexHtml).toContain(`<meta property="og:url" content="${CANON}/" />`);
    expect(indexHtml).toContain(
      `<meta property="og:image" content="${CANON}/opengraph.jpg" />`,
    );
    expect(indexHtml).not.toMatch(/og:(url|image)" content="https?:\/\/(?!bowdownvisuals\.com)/);
    expect(indexHtml).not.toContain("replit.app");
    expect(indexHtml).not.toContain("onrender.com");
  });
});

describe("share-card files — declared dims are the real dims (D-3)", () => {
  it("opengraph.jpg is really 1200x630, as index.html declares", () => {
    expect(indexHtml).toContain('<meta property="og:image:width" content="1200" />');
    expect(indexHtml).toContain('<meta property="og:image:height" content="630" />');
    expect(jpegDims(readBuf("../../public/opengraph.jpg"))).toEqual({ w: 1200, h: 630 });
  });

  it("og-fallback.png (the og-preview fallback) is really 1200x630", () => {
    expect(pngDims(readBuf("../../public/og-fallback.png"))).toEqual({ w: 1200, h: 630 });
  });

  it("the lockup file the JSON-LD names as the logo exists", () => {
    expect(readBuf("../../public/logo-static.webp").length).toBeGreaterThan(0);
    expect(indexHtml).toContain(`"logo": "${CANON}/logo-static.webp"`);
  });

  it("no share surface uses the app icon as the logo", () => {
    for (const src of [indexHtml, jsonLdSource]) {
      expect(src).not.toMatch(/og:image[^>]*icon-(192|512)/);
      expect(src).not.toMatch(/"logo":[^,]*icon-(192|512)/);
    }
  });
});

describe("one homepage card — prerender agrees with index.html (D-7)", () => {
  const title = indexHtml.match(/<title>([^<]+)<\/title>/)?.[1];
  const desc = indexHtml.match(/<meta name="description" content="([^"]+)"/)?.[1];

  it("prerender.mjs rewrites to the same title + description", () => {
    expect(title).toBeTruthy();
    expect(desc).toBeTruthy();
    expect(prerender).toContain(`title: "${title}"`);
    expect(prerender).toContain(`"${desc}"`);
  });

  it("Organization JSON-LD description matches the meta description (D-10)", () => {
    expect(jsonLdSource).toContain(`"${desc}"`);
  });
});

describe("sitemap ↔ public allowlist agreement (D-11)", () => {
  const sitemapPaths = [
    ...sitemap.matchAll(/<loc>https:\/\/bowdownvisuals\.com([^<]*)<\/loc>/g),
  ].map((m) => (m[1] === "" ? "/" : m[1]!));

  /* Static publics deliberately kept OUT of the sitemap: sign-in /
     sign-up surfaces, a password-reset form, and a post-purchase
     thank-you page. Token publics are parameterized, so they are
     excluded by the static-only rule itself. */
  const DELIBERATE_EXCLUSIONS = new Set([
    "/login",
    "/signup",
    "/qr-login",
    "/reset-password",
    "/store/success",
  ]);

  it("every sitemap URL is on the public allowlist", () => {
    for (const p of sitemapPaths) {
      expect(isPublicPath(p), `sitemap lists non-public ${p}`).toBe(true);
    }
  });

  it("every static public route is sitemapped or deliberately excluded", () => {
    const statik = PUBLIC_ROUTES.filter((r) => !r.includes(":"));
    for (const r of statik) {
      expect(
        sitemapPaths.includes(r) || DELIBERATE_EXCLUSIONS.has(r),
        `static public ${r} is neither in the sitemap nor excluded on purpose`,
      ).toBe(true);
    }
  });

  it("includes the two always-public surfaces: / and /world", () => {
    expect(sitemapPaths).toContain("/");
    expect(sitemapPaths).toContain("/world");
  });
});

describe("robots.txt + llms.txt honesty", () => {
  it("robots references the sitemap on the canonical host and blocks nothing", () => {
    expect(robots).toContain(`Sitemap: ${CANON}/sitemap.xml`);
    expect(robots).not.toContain("Disallow:");
  });

  it("llms.txt does not advertise locked routes as public (D-12)", () => {
    for (const locked of [
      "(/pricing)",
      "(/features)",
      "(/explore)",
      "(/tools)",
      "(/templates)",
      "(/showcase)",
      "(/download)",
      "(/extension)",
      "(/beta-access)",
      "(/contact)",
      "(/hooks)",
      "(/coach)",
      "(/academy)",
      "(/genres)",
    ]) {
      expect(llms, `llms.txt advertises locked ${locked}`).not.toContain(locked);
    }
    expect(llms).toContain("(/world)");
    expect(llms).toContain("Members-Only");
  });
});
