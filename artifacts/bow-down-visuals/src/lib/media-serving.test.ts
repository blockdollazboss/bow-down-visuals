/**
 * Media serving consistency (Stack-27 S27-17 / S27-18).
 *
 * The R2 migration moved the site's heavy media into the
 * bow-down-visuals-media bucket (lib/media-cdn.ts); any asset still
 * pointed at the app origin silently bypasses the bucket and burns
 * Render's metered bandwidth. These pins hold the migrated assets on
 * the media base:
 *
 *  - the Mystery Crate's Visual Bucs emblem resolves through
 *    mediaBaseUrl() exactly like VisualBucsIcon (the crate used to
 *    hard-code the origin path /images/visual-bucs-icon.webp);
 *  - the three policy pages (privacy / terms / refund-policy) serve
 *    their header logo through mediaBaseUrl() too — same single
 *    logo-static choice as before, only the serving path changed;
 *  - the editor's BackgroundReplaceSection MediaPipe chain keeps the
 *    shipped same-origin engines copy between the R2 base and the CDN.
 *
 * Source pins follow the repo's established pattern for component
 * contracts (cf. cooldown.test.ts reading MysteryCrate.tsx).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEDIA_CDN_URL, mediaBaseUrl, mediaUrl } from "./media-cdn";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const crateSource = read("../components/MysteryCrate.tsx");
const bucsIconSource = read("../components/VisualBucsIcon.tsx");
const bgReplaceSource = read("../components/editor/sections/BackgroundReplaceSection.tsx");
const policySources: Record<string, string> = {
  privacy: read("../pages/privacy.tsx"),
  terms: read("../pages/terms.tsx"),
  "refund-policy": read("../pages/refund-policy.tsx"),
};

describe("media base (the R2 bucket every migrated asset must hang off)", () => {
  it("mediaBaseUrl is the R2 public bucket with a trailing slash", () => {
    expect(MEDIA_CDN_URL).toBe("https://pub-424304b1e8d24fa28e3a072be022c74b.r2.dev");
    expect(mediaBaseUrl()).toBe(`${MEDIA_CDN_URL}/`);
    expect(mediaUrl("images/visual-bucs-icon.webp")).toBe(
      `${MEDIA_CDN_URL}/images/visual-bucs-icon.webp`,
    );
    expect(mediaUrl("/logo-static.webp")).toBe(`${MEDIA_CDN_URL}/logo-static.webp`);
  });
});

describe("MysteryCrate Visual Bucs emblem (S27-17)", () => {
  it("is served via mediaBaseUrl — the identical pattern VisualBucsIcon uses", () => {
    expect(crateSource).toContain('import { mediaBaseUrl } from "@/lib/media-cdn";');
    expect(crateSource).toContain("`${base}images/visual-bucs-icon.webp`");
    expect(bucsIconSource).toContain("`${base}images/visual-bucs-icon.webp`");
  });

  it("no longer hard-codes the origin path", () => {
    expect(crateSource).not.toContain('src="/images/visual-bucs-icon.webp"');
  });
});

describe("policy page logos (S27-17)", () => {
  for (const [page, src] of Object.entries(policySources)) {
    it(`${page}: logo hangs off mediaBaseUrl, single logo-static choice preserved`, () => {
      expect(src).toContain('import { mediaBaseUrl } from "@/lib/media-cdn";');
      expect(src).toContain("`${base}logo-static.webp`");
      expect(src).not.toContain("${import.meta.env.BASE_URL}logo-static.webp");
      /* The pages always showed the one static logo (no light/dark
         swap) — the fix changes only the serving path. */
      expect(src).not.toContain("logo-light.webp");
    });
  }
});

describe("BackgroundReplaceSection MediaPipe chain (S27-18)", () => {
  it("orders the bases R2 → shipped same-origin copy → CDN", () => {
    expect(bgReplaceSource).toContain(
      "const MEDIAPIPE_BASES = [MEDIAPIPE_LOCAL, MEDIAPIPE_ORIGIN, MEDIAPIPE_CDN];",
    );
    expect(bgReplaceSource).toContain(
      'const MEDIAPIPE_ORIGIN = `${import.meta.env.BASE_URL}engines/selfie-segmentation`;',
    );
    expect(bgReplaceSource).toContain(
      'const MEDIAPIPE_LOCAL = mediaUrl("engines/selfie-segmentation");',
    );
  });
});
