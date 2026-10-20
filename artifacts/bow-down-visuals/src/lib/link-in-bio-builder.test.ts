/**
 * link-in-bio-builder.test.ts — pins the builder's publish-state
 * surface (Ring 4 parity tail: bio-page publish/unpublish management).
 *
 * The management itself is server-side and pinned over HTTP by the
 * api-server's bio-pages-publish.test.ts (paid publish, free
 * unpublish, public 404 gating, owner-only 404s). This file pins the
 * builder half in LinkInBioBuilder (Promote → Link in Bio):
 *
 *  - a plain-text status pill (data-testid "bio-page-status") renders
 *    for the selected page, keyed on its server-reported isPublished,
 *    so the owner sees "Live — anyone with the link can see this page"
 *    vs "Draft — only you can see this page" in words, not just in
 *    which buttons happen to be showing;
 *  - both status strings exist in the English catalog (the linkInBio
 *    namespace is English-only today; other catalogs fall back);
 *  - the publish/unpublish controls call the real rails
 *    (POST /api/bio-publish/:id and POST /api/bio-pages/:id/unpublish);
 *  - the visitor-facing not-found copy names the offline case
 *    honestly ("doesn't exist or was taken offline").
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const builder = read("../components/promote/LinkInBioBuilder.tsx");
const en = JSON.parse(read("../locales/en.json")) as {
  linkInBio: {
    actions: Record<string, string>;
    public: Record<string, string>;
  };
};

describe("link-in-bio builder publish state", () => {
  it("renders a plain-text status pill keyed on the page's isPublished state", () => {
    expect(builder).toContain('data-testid="bio-page-status"');
    expect(builder).toContain('page.isPublished ? "live" : "draft"');
    expect(builder).toContain('t("linkInBio.actions.statusLive")');
    expect(builder).toContain('t("linkInBio.actions.statusDraft")');
  });

  it("the status pill only renders for an existing page, never for a fresh unsaved form", () => {
    const pillAt = builder.indexOf('data-testid="bio-page-status"');
    const guardAt = builder.lastIndexOf("{page && (", pillAt);
    expect(guardAt).toBeGreaterThan(-1);
    expect(pillAt - guardAt).toBeLessThan(200);
  });

  it("both status strings exist in the English catalog and say what they mean", () => {
    expect(en.linkInBio.actions.statusLive).toMatch(/^Live — /);
    expect(en.linkInBio.actions.statusDraft).toMatch(/^Draft — /);
  });

  it("publish and unpublish controls call the real server rails", () => {
    expect(builder).toContain("/api/bio-publish/${id}");
    expect(builder).toContain("/api/bio-pages/${pageId}/unpublish");
    expect(builder).toContain('t("linkInBio.actions.unpublish")');
    expect(builder).toContain('t("linkInBio.actions.publish", { cost: PUBLISH_COST })');
  });

  it("live-only affordances (view/share) stay gated on isPublished", () => {
    expect(builder).toContain("page?.isPublished && shareUrl");
  });

  it("visitor not-found copy honestly covers the taken-offline case", () => {
    expect(en.linkInBio.public.notFound).toBe("Page not found");
    expect(en.linkInBio.public.notFoundDetail).toContain("taken offline");
  });
});
