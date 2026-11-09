/**
 * page-designer-bench — Stack 400 world parity (census Lane B
 * item B-05) lib pins. The AI Page Designer bench rides the
 * /artist-setup designer's own rails: theme 400 / bio 100 /
 * banner 200 / upload 0, every price the credit registry's,
 * every payload byte-identical to the component's own post
 * body, and every apply patch the exact shape its onApply
 * hands the setup page — applied on the profile's own
 * PUT /api/creator-profiles/me rail.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "../credit-costs";
import {
  PAGE_DESIGNER_BANNER_PATH,
  PAGE_DESIGNER_BIO_PATH,
  PAGE_DESIGNER_THEME_PATH,
  PAGE_DESIGNER_UPLOAD_PATH,
  PROFILE_ME_PATH,
  buildPageBannerPayload,
  buildPageBioPayload,
  buildPageThemePayload,
  buildProfileBannerPatch,
  buildProfileBioPatch,
  buildProfileDesignPatch,
  buildProfileUploadPatch,
  designerProfileOf,
  pageBioOf,
  pageDesignOf,
  pageDesignerBannerCost,
  pageDesignerBioCost,
  pageDesignerThemeCost,
  pageDesignerUploadCost,
  pageDesignerWordingReady,
  pageImageUrlOf,
} from "./page-designer-bench";

describe("prices — the registry's, read live (B-05)", () => {
  it("theme 400 / bio 100 / banner 200 / upload 0", () => {
    expect(pageDesignerThemeCost()).toBe(400);
    expect(pageDesignerThemeCost()).toBe(getCreditCost(PAGE_DESIGNER_THEME_PATH)!.cost);
    expect(pageDesignerBioCost()).toBe(100);
    expect(pageDesignerBioCost()).toBe(getCreditCost(PAGE_DESIGNER_BIO_PATH)!.cost);
    expect(pageDesignerBannerCost()).toBe(200);
    expect(pageDesignerBannerCost()).toBe(getCreditCost(PAGE_DESIGNER_BANNER_PATH)!.cost);
    expect(pageDesignerUploadCost()).toBe(0);
    expect(pageDesignerUploadCost()).toBe(getCreditCost(PAGE_DESIGNER_UPLOAD_PATH)!.cost);
    expect(PROFILE_ME_PATH).toBe("/api/creator-profiles/me");
  });
});

describe("the page's own wording gates", () => {
  it("vibe and facts each need a trimmed length of 10 before a charged rail", () => {
    expect(pageDesignerWordingReady("123456789")).toBe(false);
    expect(pageDesignerWordingReady("1234567890")).toBe(true);
    expect(pageDesignerWordingReady("   1234567890   ")).toBe(true);
    expect(pageDesignerWordingReady("      short      ")).toBe(false);
    expect(pageDesignerWordingReady("")).toBe(false);
  });
});

describe("payload builders — the component's own post bodies", () => {
  it("theme: vibe trimmed, display name falling back to the page's Creator", () => {
    expect(
      buildPageThemePayload({
        vertical: "music",
        vibe: "  gold everything  ",
        displayName: "",
        palette: ["#d4af37"],
        baseThemeId: "midnight-gold",
        regenerate: false,
      }),
    ).toEqual({
      vertical: "music",
      vibe: "gold everything",
      displayName: "Creator",
      palette: ["#d4af37"],
      baseThemeId: "midnight-gold",
      regenerate: false,
    });
    expect(
      buildPageThemePayload({
        vertical: "gaming",
        vibe: "neon arcade nights",
        displayName: "Boss",
        palette: [],
        baseThemeId: "royal-stage",
        regenerate: true,
      }),
    ).toEqual({
      vertical: "gaming",
      vibe: "neon arcade nights",
      displayName: "Boss",
      palette: [],
      baseThemeId: "royal-stage",
      regenerate: true,
    });
  });

  it("bio: facts trimmed, same display-name fallback", () => {
    expect(buildPageBioPayload({ vertical: "music", displayName: "Boss", facts: "  three albums out  " })).toEqual({
      vertical: "music",
      displayName: "Boss",
      facts: "three albums out",
    });
    expect(buildPageBioPayload({ vertical: "music", displayName: "", facts: "facts facts facts" })).toEqual({
      vertical: "music",
      displayName: "Creator",
      facts: "facts facts facts",
    });
  });

  it("banner: { vertical, vibe, palette }", () => {
    expect(buildPageBannerPayload({ vertical: "film", vibe: "  cinema gold ", palette: ["#000"] })).toEqual({
      vertical: "film",
      vibe: "cinema gold",
      palette: ["#000"],
    });
  });
});

describe("response readers — null on drift", () => {
  it("a design needs themeConfig.themeId + a sections array", () => {
    expect(
      pageDesignOf({ themeConfig: { themeId: "royal-stage", colors: {} }, sections: [{ type: "hero" }], rationale: "Because gold." }),
    ).toEqual({
      themeConfig: { themeId: "royal-stage", colors: {} },
      sections: [{ type: "hero" }],
      rationale: "Because gold.",
    });
    expect(pageDesignOf({ themeConfig: { colors: {} }, sections: [] })).toBeNull();
    expect(pageDesignOf({ themeConfig: { themeId: "x" } })).toBeNull();
    expect(pageDesignOf({ themeConfig: { themeId: "x" }, sections: "nope" })).toBeNull();
    expect(pageDesignOf(null)).toBeNull();
    expect(pageDesignOf({ themeConfig: { themeId: "x" }, sections: [] })?.rationale).toBe("");
  });

  it("bio and image urls read their single field", () => {
    expect(pageBioOf({ bio: "Hello world" })).toBe("Hello world");
    expect(pageBioOf({ bio: "" })).toBeNull();
    expect(pageBioOf({})).toBeNull();
    expect(pageImageUrlOf({ url: "https://cdn/b.png" })).toBe("https://cdn/b.png");
    expect(pageImageUrlOf({ url: 7 })).toBeNull();
    expect(pageImageUrlOf(null)).toBeNull();
  });

  it("the profile reader accepts the bare profile and the { profile } wrap", () => {
    const wire = {
      display_name: "Boss",
      vertical: "music",
      theme_id: "midnight-gold",
      avatar_url: "https://cdn/a.png",
      banner_url: null,
      bio: "Hi",
      ai_design: { vibe: "gold" },
    };
    const expected = {
      displayName: "Boss",
      vertical: "music",
      themeId: "midnight-gold",
      avatarUrl: "https://cdn/a.png",
      bannerUrl: null,
      bio: "Hi",
      aiDesign: { vibe: "gold" },
    };
    expect(designerProfileOf(wire)).toEqual(expected);
    expect(designerProfileOf({ profile: wire })).toEqual(expected);
    expect(designerProfileOf({})).toBeNull();
    expect(designerProfileOf(null)).toBeNull();
    expect(designerProfileOf({ profile: null })).toBeNull();
  });
});

describe("apply patches — the designer's onApply shapes, verbatim", () => {
  const design = {
    themeConfig: { themeId: "royal-stage", colors: { bg: "#000" } },
    sections: [{ type: "hero" }, { type: "tracks" }],
    rationale: "Gold on black.",
  };

  it("the design patch carries theme_id/theme_config/sections + the ai_design trail", () => {
    expect(
      buildProfileDesignPatch({
        vertical: "music",
        design,
        vibe: "gold everything",
        palette: ["#d4af37", "#000000"],
        existingAiDesign: { starterTemplate: "music" },
        designedAt: "2026-11-08T00:00:00.000Z",
      }),
    ).toEqual({
      vertical: "music",
      theme_id: "royal-stage",
      theme_config: { themeId: "royal-stage", colors: { bg: "#000" } },
      sections: [{ type: "hero" }, { type: "tracks" }],
      ai_design: {
        starterTemplate: "music",
        vibe: "gold everything",
        palette: ["#d4af37", "#000000"],
        rationale: "Gold on black.",
        designedAt: "2026-11-08T00:00:00.000Z",
      },
    });
    /* No prior ai_design → the patch still carries the full trail. */
    expect(
      buildProfileDesignPatch({
        vertical: "music",
        design,
        vibe: "v",
        palette: [],
        existingAiDesign: null,
        designedAt: "2026-11-08T00:00:00.000Z",
      }).ai_design,
    ).toEqual({ vibe: "v", palette: [], rationale: "Gold on black.", designedAt: "2026-11-08T00:00:00.000Z" });
  });

  it("bio / banner / upload patches are the single-field shapes", () => {
    expect(buildProfileBioPatch("New bio")).toEqual({ bio: "New bio" });
    expect(buildProfileBannerPatch("https://cdn/b.png")).toEqual({ banner_url: "https://cdn/b.png" });
    expect(buildProfileUploadPatch("avatar", "https://cdn/a.png")).toEqual({ avatar_url: "https://cdn/a.png" });
    expect(buildProfileUploadPatch("banner", "https://cdn/b.png")).toEqual({ banner_url: "https://cdn/b.png" });
  });
});
