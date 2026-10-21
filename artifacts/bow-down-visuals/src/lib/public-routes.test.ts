/**
 * public-routes.test.ts — Lane 1 of the access lockdown (audit §5.2).
 *
 * Two jobs:
 *  1. THE CENSUS. Walk the real route table in App.tsx (both Switches,
 *     redirect aliases included) and assert every declared route has
 *     exactly one entry in ROUTE_MATRIX — and that the matrix names no
 *     route App.tsx no longer declares. A new route added without a
 *     classification FAILS this test on purpose: default-deny means a
 *     route is locked until someone deliberately classifies it (audit
 *     §4.1). That failure is the spine of the whole lockdown build.
 *  2. THE MATCHER. Pin `isPublicPath`'s segment-exact semantics,
 *     especially the close neighbours the law depends on telling
 *     apart (`/tips/:handle` public vs `/tips` locked, shops browse
 *     vs store act, …) and representative positives/negatives from
 *     every public and locked family.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATCH_ALL_PATH,
  PUBLIC_ROUTES,
  ROUTE_MATRIX,
  effectiveDisposition,
  isPublicPath,
  resolveRouteRedirect,
  type RouteMatrixEntry,
} from "./public-routes";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

/* ------------------------------------------------------------------ */
/* Extraction — how the census reads App.tsx.                          */
/*                                                                     */
/* Every routed page is declared as `<Route path="…">…</Route>` on a   */
/* single line in one of the two Switches, so a non-greedy scan for    */
/* path-carrying Route elements recovers the whole table (path        */
/* routes never nest inside each other). Redirect aliases carry a      */
/* `<Redirect>`, `<QueryPreservingRedirect>` or `<CreateRedirect>`     */
/* child whose `to` is the alias target.                               */
/*                                                                     */
/* Two path-less Route elements exist and are NOT extra rows here:     */
/* the bare `<Route>` wrapper that mounts AuthedLayout + the inner     */
/* Switch (a container, not a destination), and the catch-all          */
/* `<Route component={NotFound} />`, which the census represents as    */
/* CATCH_ALL_PATH ("*") when it is present.                            */
/* ------------------------------------------------------------------ */

interface ExtractedRoute {
  path: string;
  redirectTo: string | null;
}

function extractAppRoutes(source: string): ExtractedRoute[] {
  const routes: ExtractedRoute[] = [];
  const routeRe = /<Route\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/Route>/g;
  for (const match of source.matchAll(routeRe)) {
    const redirect = match[2].match(
      /<(?:Redirect|QueryPreservingRedirect|CreateRedirect)\b[^>]*\bto="([^"]+)"/,
    );
    routes.push({ path: match[1], redirectTo: redirect ? redirect[1] : null });
  }
  if (/<Route\s+component=\{NotFound\}\s*\/>/.test(source)) {
    routes.push({ path: CATCH_ALL_PATH, redirectTo: null });
  }
  return routes;
}

const extracted = extractAppRoutes(appSource);
const matrixByPath = new Map<string, RouteMatrixEntry>(
  ROUTE_MATRIX.map((entry) => [entry.path, entry]),
);

describe("the census — App.tsx route table ↔ ROUTE_MATRIX", () => {
  it("extracts a real route table from App.tsx (extraction is not vacuous)", () => {
    // The table holds 200+ declared routes today; a broken extractor
    // that found almost nothing must not let the census pass vacuously.
    expect(extracted.length).toBeGreaterThan(150);
    expect(extracted.some((r) => r.path === "/")).toBe(true);
    expect(extracted.some((r) => r.path === CATCH_ALL_PATH)).toBe(true);
    expect(extracted.filter((r) => r.redirectTo !== null).length).toBeGreaterThan(40);
  });

  it("extracts no duplicate route paths", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const route of extracted) {
      if (seen.has(route.path)) duplicates.push(route.path);
      seen.add(route.path);
    }
    expect(duplicates).toEqual([]);
  });

  it("declares no duplicate paths in the matrix", () => {
    expect(matrixByPath.size).toBe(ROUTE_MATRIX.length);
  });

  it("classifies every route App.tsx declares — an unclassified new route fails here", () => {
    const missing = extracted
      .map((route) => route.path)
      .filter((path) => !matrixByPath.has(path));
    expect(missing).toEqual([]);
  });

  it("names no route App.tsx no longer declares — a stale entry fails here", () => {
    const extractedPaths = new Set(extracted.map((route) => route.path));
    const stale = ROUTE_MATRIX.map((entry) => entry.path).filter(
      (path) => !extractedPaths.has(path),
    );
    expect(stale).toEqual([]);
  });

  it("covers exactly the extracted table (count reconciliation)", () => {
    expect(ROUTE_MATRIX.length).toBe(extracted.length);
  });

  it("marks every App.tsx redirect alias as a redirect with its exact target", () => {
    for (const route of extracted) {
      if (route.redirectTo === null) continue;
      const entry = matrixByPath.get(route.path);
      expect(entry, route.path).toBeDefined();
      expect(entry?.disposition, route.path).toBe("redirect");
      expect(entry?.redirectTo, route.path).toBe(route.redirectTo);
    }
  });

  it("gives no non-redirect route a redirect target, and vice versa", () => {
    const extractedByPath = new Map(extracted.map((r) => [r.path, r]));
    for (const entry of ROUTE_MATRIX) {
      const source = extractedByPath.get(entry.path);
      if (entry.disposition === "redirect") {
        expect(source?.redirectTo, entry.path).toBe(entry.redirectTo);
        expect(entry.targetDisposition, entry.path).toBeDefined();
      } else {
        expect(source?.redirectTo ?? null, entry.path).toBeNull();
        expect(entry.redirectTo, entry.path).toBeUndefined();
        expect(entry.targetDisposition, entry.path).toBeUndefined();
      }
    }
  });

  it("classifies each redirect by its resolved target (audit §1.5)", () => {
    for (const entry of ROUTE_MATRIX) {
      if (entry.disposition !== "redirect" || !entry.redirectTo) continue;
      const targetPath = entry.redirectTo.split(/[?#]/)[0];
      // The target is either itself public, or an alias whose own
      // classification resolves the chain (no alias chains exist
      // today, but the rule must hold if one is added).
      const targetEntry = matrixByPath.get(targetPath);
      const targetIsPublic = targetEntry
        ? effectiveDisposition(targetEntry) === "public"
        : isPublicPath(targetPath);
      expect(entry.targetDisposition, entry.path).toBe(
        targetIsPublic ? "public" : "locked",
      );
      expect(effectiveDisposition(entry), entry.path).toBe(
        entry.targetDisposition,
      );
    }
  });

  it("agrees with the matcher: public entries are exactly the allowlist", () => {
    const publicPaths = ROUTE_MATRIX.filter(
      (entry) => entry.disposition === "public",
    ).map((entry) => entry.path);
    expect(new Set(publicPaths)).toEqual(new Set(PUBLIC_ROUTES));
    for (const entry of ROUTE_MATRIX) {
      if (entry.disposition === "public") {
        // A route path doubles as a sample pathname: `:param` segments
        // match themselves, literals match themselves.
        expect(isPublicPath(entry.path), entry.path).toBe(true);
      } else if (entry.disposition === "locked") {
        expect(isPublicPath(entry.path), entry.path).toBe(false);
      }
    }
  });

  it("declares the catch-all 404 as locked (the gate runs before it for guests)", () => {
    const entry = matrixByPath.get(CATCH_ALL_PATH);
    expect(entry).toBeDefined();
    expect(entry?.disposition).toBe("locked");
    expect(isPublicPath("/definitely-not-a-real-route")).toBe(false);
  });
});

describe("resolveRouteRedirect — aliases resolve before the gate judges (fix 2026-10-18)", () => {
  it("resolves the two findability aliases to the targets App.tsx declares", () => {
    // The proven defect: a guest at /broadcast was bounced to
    // /login?next=%2Fbroadcast because the gate judged the alias path
    // before the router's redirect could run. /video-studio sits in
    // the inner Switch, /broadcast in the outer — the gate wraps
    // both, so both carried the identical defect.
    expect(resolveRouteRedirect("/broadcast")).toBe("/go-live");
    expect(resolveRouteRedirect("/video-studio")).toBe("/video-editor");
  });

  it("resolves every matrix alias to exactly its declared target", () => {
    const aliases = ROUTE_MATRIX.filter(
      (entry) => entry.disposition === "redirect",
    );
    expect(aliases.length).toBeGreaterThan(40);
    for (const entry of aliases) {
      expect(resolveRouteRedirect(entry.path), entry.path).toBe(
        entry.redirectTo,
      );
    }
  });

  it("returns the target exactly as written, query included", () => {
    expect(resolveRouteRedirect("/randomizer")).toBe("/hooks?tab=dice");
    expect(resolveRouteRedirect("/shows")).toBe("/go-live?tab=shows");
  });

  it("resolves no non-alias path — public, locked, target, or nonsense", () => {
    expect(resolveRouteRedirect("/")).toBeNull();
    expect(resolveRouteRedirect("/world")).toBeNull();
    expect(resolveRouteRedirect("/charts")).toBeNull();
    expect(resolveRouteRedirect("/dashboard")).toBeNull();
    // The targets themselves are destinations, not aliases.
    expect(resolveRouteRedirect("/go-live")).toBeNull();
    expect(resolveRouteRedirect("/video-editor")).toBeNull();
    expect(resolveRouteRedirect("/definitely-not-a-real-route")).toBeNull();
    expect(resolveRouteRedirect("/broadcast/extra")).toBeNull();
  });

  it("mirrors the matcher's tolerances: query/hash ignored, one trailing slash", () => {
    expect(resolveRouteRedirect("/broadcast?from=old-link")).toBe("/go-live");
    expect(resolveRouteRedirect("/broadcast#top")).toBe("/go-live");
    expect(resolveRouteRedirect("/video-studio/")).toBe("/video-editor");
  });

  it("resolves nothing malformed — default-deny, same as the matcher", () => {
    expect(resolveRouteRedirect("")).toBeNull();
    expect(resolveRouteRedirect("broadcast")).toBeNull();
    expect(resolveRouteRedirect("https://evil.example/broadcast")).toBeNull();
    expect(resolveRouteRedirect("//evil.example/broadcast")).toBeNull();
    expect(resolveRouteRedirect("/broadcast//")).toBeNull();
  });

  it("never makes an alias public — resolution is a hand-off, not an opening", () => {
    expect(isPublicPath("/broadcast")).toBe(false);
    expect(isPublicPath("/video-studio")).toBe(false);
    for (const entry of ROUTE_MATRIX) {
      if (entry.disposition !== "redirect") continue;
      expect(isPublicPath(entry.path), entry.path).toBe(false);
    }
  });

  it("is single-hop: no alias targets another alias, so the gate terminates at the target", () => {
    for (const entry of ROUTE_MATRIX) {
      if (entry.disposition !== "redirect" || !entry.redirectTo) continue;
      const targetPath = entry.redirectTo.split(/[?#]/)[0];
      expect(resolveRouteRedirect(targetPath), entry.path).toBeNull();
    }
  });
});

describe("isPublicPath — the critical distinctions", () => {
  it("keeps the tip jar public but the tips tool locked", () => {
    expect(isPublicPath("/tips/some-handle")).toBe(true);
    expect(isPublicPath("/tips")).toBe(false);
    expect(isPublicPath("/tips/")).toBe(false);
    expect(isPublicPath("/tips/a/b")).toBe(false);
  });

  it("keeps the shops directory public but the builder locked", () => {
    expect(isPublicPath("/storefronts")).toBe(true);
    expect(isPublicPath("/storefronts/builder")).toBe(false);
  });

  it("keeps a creator's shop public but the store's act surfaces locked", () => {
    expect(isPublicPath("/shop/some-creator")).toBe(true);
    expect(isPublicPath("/shop")).toBe(false);
    expect(isPublicPath("/store/buy/track/42")).toBe(false);
    expect(isPublicPath("/store/dashboard")).toBe(false);
    expect(isPublicPath("/store/success")).toBe(true);
    expect(isPublicPath("/store/success/extra")).toBe(false);
  });

  it("keeps the product shelf public at exactly one product deep", () => {
    expect(isPublicPath("/storefront/product/42")).toBe(true);
    expect(isPublicPath("/storefront/product")).toBe(false);
    expect(isPublicPath("/storefront/product/42/reviews")).toBe(false);
  });

  it("keeps memberships browse public with no deeper public path", () => {
    expect(isPublicPath("/memberships")).toBe(true);
    expect(isPublicPath("/memberships/anything")).toBe(false);
    expect(isPublicPath("/memberships/tiers/1")).toBe(false);
  });

  it("keeps profiles public but the vault locked", () => {
    expect(isPublicPath("/artist/some-creator")).toBe(true);
    expect(isPublicPath("/artist")).toBe(false);
    expect(isPublicPath("/artist/a/b")).toBe(false);
    expect(isPublicPath("/artist-vault")).toBe(false);
  });

  it("matches the root only at the root", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("")).toBe(false);
    expect(isPublicPath("//")).toBe(false);
    expect(isPublicPath("/world")).toBe(true);
    expect(isPublicPath("/world/extra")).toBe(false);
  });

  it("keeps challenge winners public at exactly the declared depth", () => {
    expect(isPublicPath("/challenge/spring")).toBe(true);
    expect(isPublicPath("/challenge/spring/winners")).toBe(true);
    expect(isPublicPath("/challenge/spring/losers")).toBe(false);
    expect(isPublicPath("/challenge")).toBe(false);
    expect(isPublicPath("/winners")).toBe(true);
  });

  it("tolerates a single trailing slash (except on the root)", () => {
    expect(isPublicPath("/world/")).toBe(true);
    expect(isPublicPath("/charts/")).toBe(true);
    expect(isPublicPath("/artist/some-creator/")).toBe(true);
    expect(isPublicPath("/tips/")).toBe(false);
  });

  it("rejects empty segments and param-less param routes", () => {
    expect(isPublicPath("/artist//")).toBe(false);
    expect(isPublicPath("/track/")).toBe(false);
    expect(isPublicPath("/track//x")).toBe(false);
    expect(isPublicPath("artist/some-creator")).toBe(false);
    expect(isPublicPath("https://example.com/artist/x")).toBe(false);
  });
});

describe("isPublicPath — representative positives from every public family", () => {
  const positives: Array<[string, string]> = [
    ["law — home", "/"],
    ["law — the World", "/world"],
    ["ruling — creator profile storefront", "/artist/king-shark"],
    ["necessity — login", "/login"],
    ["necessity — signup", "/signup"],
    ["necessity — reset password", "/reset-password"],
    ["necessity — QR login approve", "/qr-login"],
    ["legal — terms", "/terms"],
    ["legal — privacy", "/privacy"],
    ["legal — refund policy", "/refund-policy"],
    ["token link — client review", "/review/abc123token"],
    ["token link — sync one-sheet", "/sync-one-sheet/abc123token"],
    ["checkout return — store success", "/store/success"],
    ["D3 shops — directory", "/storefronts"],
    ["D3 shops — a creator's shop", "/shop/king-shark"],
    ["D3 shops — one product", "/storefront/product/42"],
    ["§1.6 exception — charts", "/charts"],
    ["§1.6 exception — shorts", "/shorts"],
    ["§1.6 exception — public press kit", "/press/king-shark"],
    ["D1 media — track", "/track/101"],
    ["D1 media — watch", "/watch/101"],
    ["D1 media — playlist", "/playlist/101"],
    ["D1 media — live", "/live/101"],
    ["guest door — invite backstage (0198)", "/live/guest/some-token"],
    ["D1 media — premiere", "/premiere/101"],
    ["D1 media — sound", "/sound/101"],
    ["D1 media — hashtag", "/hashtag/goldchain"],
    ["D1 media — album", "/albums/gold-album"],
    ["D1 media — plan", "/plan/pro-plan"],
    ["D1 media — photo preset", "/photo-preset/glow"],
    ["D1 media — collection", "/collection/favourites"],
    ["D2 funnel — presave", "/presave/new-single"],
    ["D2 funnel — unlock", "/unlock/new-single"],
    ["D2 funnel — splits", "/splits/new-single"],
    ["D2 funnel — join", "/join/king-shark"],
    ["D2 funnel — link in bio", "/bio/king-shark"],
    ["D2 funnel — NFC card profile", "/c/king-shark"],
    ["D2 funnel — tip jar", "/tips/king-shark"],
    ["D5 marketplace — beats", "/beats"],
    ["D5 marketplace — shoutouts", "/shoutouts"],
    ["D5 marketplace — memberships", "/memberships"],
    ["D5 marketplace — contests", "/contests"],
    ["D5 marketplace — winners", "/winners"],
    ["D5 marketplace — challenge", "/challenge/spring-jam"],
    ["D5 marketplace — challenge winners", "/challenge/spring-jam/winners"],
  ];

  it("covers every entry on the shipped allowlist", () => {
    // One sample per PUBLIC_ROUTES pattern, so the positives list can
    // never silently drift from the allowlist itself.
    expect(positives).toHaveLength(PUBLIC_ROUTES.length);
  });

  for (const [family, path] of positives) {
    it(`is public: ${family} (${path})`, () => {
      expect(isPublicPath(path)).toBe(true);
    });
  }
});

describe("isPublicPath — negatives from the locked families", () => {
  const negatives: Array<[string, string]> = [
    // Money hub (audit §1.3).
    ["money hub — earnings", "/earnings"],
    ["money hub — brand deals", "/brand-deals"],
    ["money hub — distribute", "/distribute"],
    ["money hub — press kit tool", "/press-kit"],
    ["money hub — email list", "/email-list"],
    ["money hub — collabs", "/collabs"],
    ["money hub — team", "/team"],
    ["money hub — my shop", "/my-shop"],
    ["money hub — promote", "/promote"],
    ["money hub — analytics hub", "/analytics-hub"],
    ["money hub — branding kit", "/branding-kit"],
    ["money hub — coach", "/coach"],
    // Discovery / community (audit §1.4, §1.6 lock lines).
    ["discovery — explore", "/explore"],
    ["discovery — search", "/search"],
    ["discovery — browse", "/browse"],
    ["discovery — community", "/community"],
    ["discovery — groups", "/groups"],
    ["discovery — one group", "/groups/some-group"],
    ["discovery — events", "/events"],
    ["discovery — one event", "/events/42"],
    ["discovery — vertical", "/vertical/music"],
    ["discovery — genres index", "/genres"],
    ["discovery — one genre", "/genre/hip-hop"],
    // SEO / marketing family (D4 locks).
    ["SEO — pricing", "/pricing"],
    ["SEO — creator pricing", "/creator-pricing"],
    ["SEO — tools index", "/tools"],
    ["SEO — one tool page", "/tools/ai-song-maker"],
    ["SEO — for index", "/for"],
    ["SEO — for youtubers", "/for/youtubers"],
    ["SEO — genre hub", "/genres/hip-hop"],
    ["SEO — showcase", "/showcase"],
    ["SEO — one showcase item", "/showcase/some-item"],
    ["SEO — features", "/features"],
    ["SEO — templates", "/templates"],
    ["SEO — beta access", "/beta-access"],
    ["SEO — invite", "/invite/ABC123"],
    ["SEO — contact", "/contact"],
    ["SEO — download", "/download"],
    ["SEO — extension", "/extension"],
    // App surfaces (audit §1.2, §1.3).
    ["app — dashboard", "/dashboard"],
    ["app — settings", "/settings"],
    ["app — admin", "/admin"],
    ["app — create", "/create"],
    ["app — hooks studio", "/hooks"],
    ["app — referrals", "/referrals"],
    ["app — trending", "/trending"],
    ["app — cursor lab", "/cursor-lab"],
    ["app — jewelry shop page", "/jewelry-shop"],
    ["unknown — nonsense path", "/definitely-not-a-route"],
  ];

  for (const [family, path] of negatives) {
    it(`is locked: ${family} (${path})`, () => {
      expect(isPublicPath(path)).toBe(false);
    });
  }
});

describe("the shipped allowlist itself", () => {
  it("has no duplicate patterns", () => {
    expect(new Set(PUBLIC_ROUTES).size).toBe(PUBLIC_ROUTES.length);
  });

  it("contains exactly the approved public set (45 patterns)", () => {
    expect(PUBLIC_ROUTES).toHaveLength(45);
  });

  it("judges a path with a query string the same as the bare path", () => {
    expect(isPublicPath("/artist/king-shark?ref=ABC123")).toBe(true);
    expect(isPublicPath("/dashboard?tab=money")).toBe(false);
  });
});
