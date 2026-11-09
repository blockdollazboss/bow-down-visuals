/**
 * social-kit-bench — Stack 400 world parity (Lane B item 9)
 * seam pins. The bench must ride the Social Kit panel's own
 * rail at the registry's price, shape the post exactly as the
 * panel posts it, enforce the panel's brand+tagline gate, and
 * hold every answer to the panel's real shape — an empty or
 * drifted asset list parses to null, never to a dressed-up
 * success.
 */
import { describe, expect, it } from "vitest";
import {
  SOCIAL_KIT_BRAND_MAX,
  SOCIAL_KIT_PATH,
  SOCIAL_KIT_STYLE_LABEL_KEYS,
  SOCIAL_KIT_STYLES,
  SOCIAL_KIT_TAGLINE_MAX,
  socialKitAssetsOf,
  socialKitCanRun,
  socialKitCost,
  socialKitPayload,
} from "./social-kit-bench";
import { getCreditCost } from "../credit-costs";

describe("the rail + the price", () => {
  it("posts where the panel posts, at the registry's 400", () => {
    expect(SOCIAL_KIT_PATH).toBe("/api/social-kit");
    expect(getCreditCost(SOCIAL_KIT_PATH)?.cost).toBe(400);
    expect(socialKitCost()).toBe(400);
  });

  it("carries the panel's styles + label keys verbatim", () => {
    expect(SOCIAL_KIT_STYLES).toEqual(["gold-luxury", "neon-pop", "minimal"]);
    expect(SOCIAL_KIT_STYLE_LABEL_KEYS["gold-luxury"]).toBe("hubSpine.socialKit.styleGold");
    expect(SOCIAL_KIT_STYLE_LABEL_KEYS["neon-pop"]).toBe("hubSpine.socialKit.styleNeon");
    expect(SOCIAL_KIT_STYLE_LABEL_KEYS.minimal).toBe("hubSpine.socialKit.styleMinimal");
    expect(SOCIAL_KIT_BRAND_MAX).toBe(60);
    expect(SOCIAL_KIT_TAGLINE_MAX).toBe(120);
  });
});

describe("the form shaping — the panel's generate post", () => {
  it("posts trimmed brand + tagline + the style verbatim", () => {
    expect(
      socialKitPayload({ brandName: "  Lil Nova ", tagline: " The cheat code ", style: "neon-pop" }),
    ).toEqual({ brandName: "Lil Nova", tagline: "The cheat code", style: "neon-pop" });
  });

  it("gates on brand + tagline exactly as the panel does", () => {
    expect(socialKitCanRun({ brandName: "Nova", tagline: "go", style: "minimal" })).toBe(true);
    expect(socialKitCanRun({ brandName: " ", tagline: "go", style: "minimal" })).toBe(false);
    expect(socialKitCanRun({ brandName: "Nova", tagline: "", style: "minimal" })).toBe(false);
  });
});

describe("the answer guard", () => {
  it("keeps url'd assets and normalizes the rest to null", () => {
    expect(
      socialKitAssetsOf({
        assets: [
          { url: "https://x/p.png", kind: "profile", label: "Profile" },
          { url: "https://x/b.png" },
          { kind: "banner" },
          { url: "" },
        ],
      }),
    ).toEqual([
      { url: "https://x/p.png", kind: "profile", label: "Profile" },
      { url: "https://x/b.png", kind: null, label: null },
    ]);
  });

  it("an empty or drifted list is a failure, never a success", () => {
    expect(socialKitAssetsOf({ assets: [] })).toBeNull();
    expect(socialKitAssetsOf({ assets: [{ kind: "banner" }] })).toBeNull();
    expect(socialKitAssetsOf({})).toBeNull();
    expect(socialKitAssetsOf(null)).toBeNull();
    expect(socialKitAssetsOf("nope")).toBeNull();
  });
});
