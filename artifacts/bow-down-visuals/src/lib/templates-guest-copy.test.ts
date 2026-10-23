import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-28 #46 (A1-02) — /templates* is locked for guests (public-routes.ts
 * ROUTE_MATRIX, disposition "locked" — unchanged by this item). No
 * templates surface may promise guests a free/public browse.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pages = [
  "../pages/templates/index.tsx",
  "../pages/templates/videos.tsx",
  "../pages/templates/thumbnails.tsx",
  "../pages/templates/hooks.tsx",
  "../pages/templates/captions.tsx",
].map(read);
const en = read("../locales/en.json");
const routes = read("./public-routes.ts");

describe("templates guest copy (Stack-28 #46)", () => {
  it("gate unchanged: templates routes stay locked", () => {
    for (const p of ["/templates", "/templates/videos", "/templates/thumbnails", "/templates/hooks", "/templates/captions"]) {
      expect(routes).toContain(`{ path: "${p}", disposition: "locked" }`);
    }
  });
  it("no template page promises no-login or unqualified free browsing", () => {
    for (const src of pages) {
      expect(src).not.toContain("No login required");
      expect(src).not.toMatch(/free to browse(?![\s\S]{0,30}with your account)/);
    }
    const vt = en.slice(en.indexOf('"videoTemplatesPage"'), en.indexOf('"videoTemplatesPage"') + 4000);
    expect(vt).toContain("Free to browse with your account");
  });
});
