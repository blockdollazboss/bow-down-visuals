/* Sitemap tests (Stack-300 SEO #82) — the pure renderers plus the
   invariants that keep the dynamic sitemap honest:
   - the index lists "static" first, then every family, and every child
     name in the index has a loader behind it (or is "static");
   - the static child mirrors FE public/sitemap.xml EXACTLY (that file
     is the access-law static set, pinned by the FE lockdown test — the
     two lists must never drift apart);
   - no listed path may be a locked route, a token shape, or an
     auth/transactional page;
   - the middleware answers /sitemap.xml + the static child without
     touching the DB, and passes everything else through. */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  STATIC_SITEMAP_PATHS,
  SITEMAP_CHILDREN,
  renderIndex,
  renderUrlset,
  sitemapMiddleware,
} from "../sitemap";

const ORIGIN = "https://bowdownvisuals.com";

describe("renderIndex", () => {
  it("lists static first, then the families, as absolute child URLs", () => {
    const xml = renderIndex(ORIGIN, [...SITEMAP_CHILDREN]);
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap-static.xml</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap-artists.xml</loc>`);
    expect(xml.indexOf("sitemap-static.xml")).toBeLessThan(xml.indexOf("sitemap-artists.xml"));
    for (const child of SITEMAP_CHILDREN) {
      expect(xml).toContain(`<loc>${ORIGIN}/sitemap-${child}.xml</loc>`);
    }
  });
});

describe("renderUrlset", () => {
  it("renders loc + lastmod, escapes hostile slugs, omits bad dates", () => {
    const xml = renderUrlset(ORIGIN, [
      { path: "/artist/thy-cheat-code", lastmod: new Date("2026-11-01T10:00:00.000Z") },
      { path: "/artist/a&b", lastmod: "not-a-date" },
      { path: "/shop/plain" },
    ]);
    expect(xml).toContain(`<loc>${ORIGIN}/artist/thy-cheat-code</loc><lastmod>2026-11-01</lastmod>`);
    expect(xml).toContain(`<loc>${ORIGIN}/artist/a&amp;b</loc>`);
    expect(xml).not.toContain("not-a-date");
    expect(xml).toContain(`<loc>${ORIGIN}/shop/plain</loc></url>`);
  });

  it("renders an empty urlset without blowing up", () => {
    expect(renderUrlset(ORIGIN, [])).toContain("<urlset");
  });
});

describe("the static child", () => {
  it("mirrors FE public/sitemap.xml exactly", () => {
    const feXml = readFileSync(
      new URL("../../../../bow-down-visuals/public/sitemap.xml", import.meta.url),
      "utf8",
    );
    const fePaths = [...feXml.matchAll(/<loc>https:\/\/bowdownvisuals\.com([^<]*)<\/loc>/g)].map(
      (m) => (m[1] === "" ? "/" : (m[1] as string)),
    );
    expect([...fePaths].sort()).toEqual([...STATIC_SITEMAP_PATHS].sort());
  });

  it("contains no locked route, token shape, or auth/transactional page", () => {
    const banned = [
      "/login", "/signup", "/reset-password", "/qr-login", "/store/success",
      "/review/", "/sync-one-sheet/", "/live/guest/", "/overlay/",
      "/post/", "/events/", "/dashboard", "/admin", "/groups",
    ];
    for (const p of STATIC_SITEMAP_PATHS) {
      for (const b of banned) {
        expect(p.startsWith(b), `static sitemap lists banned ${p}`).toBe(false);
      }
    }
  });
});

describe("sitemapMiddleware (no-DB paths)", () => {
  function fakeRes() {
    const res: Record<string, unknown> = {};
    res["set"] = (k: string, v: string) => {
      (res["headers"] as Record<string, string>)[k] = v;
    };
    res["headers"] = {};
    res["send"] = (body: string) => {
      res["body"] = body;
    };
    res["status"] = (code: number) => {
      res["statusCode"] = code;
      return res;
    };
    return res;
  }

  it("answers /sitemap.xml with the index", async () => {
    const mw = sitemapMiddleware();
    const res = fakeRes();
    let nextCalled = false;
    await mw(
      { method: "GET", path: "/sitemap.xml" } as never,
      res as never,
      (() => { nextCalled = true; }) as never,
    );
    expect(nextCalled).toBe(false);
    expect(res["body"]).toContain("<sitemapindex");
    expect((res["headers"] as Record<string, string>)["Content-Type"]).toContain("application/xml");
  });

  it("answers /sitemap-static.xml with the static set", async () => {
    const mw = sitemapMiddleware();
    const res = fakeRes();
    await mw(
      { method: "GET", path: "/sitemap-static.xml" } as never,
      res as never,
      (() => { throw new Error("must not call next"); }) as never,
    );
    expect(res["body"]).toContain(`<loc>${ORIGIN}/world</loc>`);
    expect(res["body"]).toContain(`<loc>${ORIGIN}/app</loc>`);
  });

  it("passes non-sitemap paths through untouched", async () => {
    const mw = sitemapMiddleware();
    const res = fakeRes();
    let nextCalled = false;
    await mw(
      { method: "GET", path: "/artist/thy-cheat-code" } as never,
      res as never,
      (() => { nextCalled = true; }) as never,
    );
    expect(nextCalled).toBe(true);
    expect(res["body"]).toBeUndefined();
  });

  it("passes non-GET requests through", async () => {
    const mw = sitemapMiddleware();
    const res = fakeRes();
    let nextCalled = false;
    await mw(
      { method: "POST", path: "/sitemap.xml" } as never,
      res as never,
      (() => { nextCalled = true; }) as never,
    );
    expect(nextCalled).toBe(true);
  });
});
