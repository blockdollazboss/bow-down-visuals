/**
 * shell-routes.test.ts — stack1400 org wave, audit rank 2 (§1a).
 *
 * The org-design tightening audit (2026-11-02) found the site's core
 * signed-in flow pages rendering in App.tsx's OUTER Switch — outside
 * AuthedLayout, with no sidebar — so whole sections felt like separate
 * websites. Earlier rings (2026-10-18) had already wrapped most of
 * them; this suite pins the end state the audit asked for:
 *
 *   1. The eight routes the audit names — /coach, /brand-deals,
 *      /distribute, /earnings, /academy, /analytics-hub,
 *      /branding-kit, /promote — ALL render inside AuthedLayout.
 *   2. Every route this wave moved (money flow, social/community,
 *      studio rings) renders inside AuthedLayout and nowhere outside.
 *   3. The by-design exceptions stay outside: public/fan surfaces,
 *      marketing/SEO landers, auth pages, the full-viewport Video
 *      Editor and the World portal's outer neighbours.
 *   4. Placement only: each moved route keeps the exact element body
 *      (guards, wrappers, props) it had in the outer Switch.
 *
 * Extraction follows the house pattern (public-routes.test.ts,
 * qcproof-routes-contract.test.ts): split App.tsx at the
 * <AuthedLayout>…</AuthedLayout> span and read each zone's Route
 * declarations. A route "renders within AuthedLayout" iff its single
 * declaration lives in the inner span.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

const innerStart = appSource.indexOf("<AuthedLayout>");
const innerEnd = appSource.indexOf("</AuthedLayout>");
const innerSource = appSource.slice(innerStart, innerEnd);
const outerSource = appSource.slice(0, innerStart) + appSource.slice(innerEnd);

function extract(source: string): Map<string, string> {
  const routes = new Map<string, string>();
  for (const m of source.matchAll(
    /<Route\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/Route>/g,
  )) {
    routes.set(m[1]!, m[2]!.replace(/\s+/g, " ").trim());
  }
  return routes;
}

const inner = extract(innerSource);
const outer = extract(outerSource);

/* The eight routes audit §1a names as core flow pages that rendered
   with no sidebar. */
const AUDIT_NAMED_EIGHT = [
  "/coach",
  "/brand-deals",
  "/distribute",
  "/earnings",
  "/academy",
  "/analytics-hub",
  "/branding-kit",
  "/promote",
] as const;

/* Every route this wave moved, with the exact element body it must
   keep — placement change, not behavior change. */
const MOVED: Array<[string, string]> = [
  // Money-flow ring.
  ["/brand-deals", "<BrandDealsRoute />"],
  ["/distribute", "<DistributeRoute />"],
  ["/brand-calculator", "<BrandDealCalculator />"],
  ["/tour", "<TourPlanner />"],
  ["/interview-prep", "<InterviewPrep />"],
  ["/setlist", "<SetlistBuilder />"],
  // Social / community ring.
  ["/home", "<ProtectedRoute><SocialHome /></ProtectedRoute>"],
  ["/trending", "<Trending />"],
  ["/remix", "<Remix />"],
  ["/saved", "<ProtectedRoute><Saved /></ProtectedRoute>"],
  ["/post/:id", "<ProtectedRoute><PostPage /></ProtectedRoute>"],
  ["/explore", "<Explore />"],
  ["/groups", "<Groups />"],
  ["/groups/:slug", "<GroupDetail />"],
  ["/events", "<Events />"],
  ["/events/:id", "<EventDetailPage />"],
  // Studio ring.
  ["/import", "<ProtectedRoute><MediaImport /></ProtectedRoute>"],
  ["/jewelry-shop", "<JewelryShop />"],
];

/* By design OUTSIDE the shell: public/fan surfaces, marketing/SEO
   landers, auth pages, and the full-viewport Video Editor. */
const STAYS_OUTSIDE = [
  "/artist/:slug",
  "/bio/:slug",
  "/c/:slug",
  "/shop/:slug",
  "/tips/:handle",
  "/press/:handle",
  "/review/:token",
  "/login",
  "/signup",
  "/pricing",
  "/tools",
  "/for",
  "/templates",
  "/video-editor",
] as const;

describe("shell routes — audit §1a rank 2 (stack1400 org wave)", () => {
  it("finds the AuthedLayout span and a real route table in both zones", () => {
    expect(innerStart).toBeGreaterThan(-1);
    expect(innerEnd).toBeGreaterThan(innerStart);
    expect(inner.size).toBeGreaterThan(100);
    expect(outer.size).toBeGreaterThan(50);
  });

  it("renders all eight audit-named core flow routes inside AuthedLayout", () => {
    for (const path of AUDIT_NAMED_EIGHT) {
      expect(inner.has(path), `${path} inside AuthedLayout`).toBe(true);
      expect(outer.has(path), `${path} not outside AuthedLayout`).toBe(false);
    }
  });

  it("renders every route this wave moved inside AuthedLayout, exactly once", () => {
    for (const [path] of MOVED) {
      expect(inner.has(path), `${path} inside AuthedLayout`).toBe(true);
      expect(outer.has(path), `${path} not outside AuthedLayout`).toBe(false);
    }
  });

  it("preserves each moved route's guards, wrappers and props exactly", () => {
    for (const [path, body] of MOVED) {
      expect(inner.get(path), `${path} element body`).toBe(body);
    }
  });

  it("keeps the by-design exceptions outside the shell", () => {
    for (const path of STAYS_OUTSIDE) {
      expect(outer.has(path), `${path} stays outside`).toBe(true);
      expect(inner.has(path), `${path} not wrapped`).toBe(false);
    }
  });

  it("does not double-host Thy Cheat Code on /brand-deals", () => {
    /* AuthedLayout renders ThyCheatCodeHost in <main>; a wrapped page
       still listed in marketingCoachRoute would render him twice
       (the /coach + /academy precedent in findability-nav.test.ts). */
    const listAt = appSource.indexOf("const marketingCoachRoute = [");
    expect(listAt).toBeGreaterThan(-1);
    const list = appSource.slice(listAt, appSource.indexOf("]", listAt));
    expect(list).not.toContain('"/brand-deals"');
  });
});
