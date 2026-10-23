import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #49 (A5-P3) — entry composition: no marketing/SEO page module
 * may be statically imported by App.tsx; all go through lazyWithRetry.
 * The prerender entry keeps its own direct home import (checked too).
 */
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const entryServer = readFileSync(new URL("../entry-server.tsx", import.meta.url), "utf8");

const MODULES = [
  "@/pages/home", "@/pages/pricing", "@/pages/creator-pricing", "@/pages/extension",
  "@/pages/download", "@/pages/templates/index", "@/pages/templates/videos",
  "@/pages/templates/thumbnails", "@/pages/templates/hooks", "@/pages/templates/captions",
  "@/pages/seo/tools-index", "@/pages/seo/for-index", "@/pages/seo/tool-page",
  "@/pages/seo/vertical-hub", "@/pages/seo/genre-hub", "@/pages/showcase/index",
  "@/pages/showcase/item", "@/pages/albums/public", "@/pages/plan-public",
];

describe("lazy marketing routes (Stack-28 #49)", () => {
  it("App.tsx has no static import of any of the 19 page modules", () => {
    for (const m of MODULES) {
      expect(app).not.toMatch(new RegExp(`^import .* from "${m}"`, "m"));
      expect(app).toContain(`import("${m}")`);
    }
  });
  it("prerender entry still imports home directly", () => {
    expect(entryServer).toContain('import Home from "@/pages/home"');
  });
});
