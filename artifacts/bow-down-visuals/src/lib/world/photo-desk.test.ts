/**
 * photo-desk — Stack 400 world parity (census Lane B items
 * B-04 + B-23) lib pins. The Photo Desk bench family rides the
 * Photo Studio twins' own rails: every price is the credit
 * registry's (never a desk-invented number — the lifestyle
 * product shot's 150 is the page's own ratified constant),
 * every payload builder is byte-identical to its 2D twin's
 * post body, and the cartoonize redraw prompt is the Cartoon
 * Studio page's, verbatim, for every STYLE_PRESETS direction.
 */
import { describe, expect, it } from "vitest";
import { getCreditCost } from "../credit-costs";
import {
  ARTIST_IMAGE_PATH,
  AUTOPILOT_ENHANCE_OPS,
  BACKDROP_PROVIDERS,
  BACKDROP_RATIOS,
  BG_GENERATE_PATH,
  BG_GENERATE_STYLES,
  CARTOONIZE_MAX_BYTES,
  CARTOONIZE_MODEL,
  ENHANCE_OPS,
  HEADSHOT_FLOWS,
  HEADSHOT_MODELS,
  HEADSHOT_PRESETS,
  PHOTO_BACKDROP_PATH,
  PHOTO_ENHANCE_PATH,
  PHOTO_INTAKE_MAX_BYTES,
  PHOTO_UPLOAD_PATH,
  PRODUCT_KINDS,
  PRODUCT_MODELS,
  PRODUCT_PHOTO_LIFESTYLE_COST,
  PRODUCT_PHOTO_PATH,
  PRODUCT_RATIOS,
  PRODUCT_STYLE_MODES,
  REMOVE_BACKGROUND_PATH,
  backdropStatusOf,
  bgGenerateCost,
  bgGenerateStatusOf,
  bgGenerateReplayNoteOf,
  bgGenerateUrlOf,
  buildBgGeneratePayload,
  buildCartoonizePayload,
  buildHeadshotPayload,
  buildPhotoBackdropPayload,
  buildPhotoEnhancePayload,
  buildProductPhotoPayload,
  buildRemoveBackgroundPayload,
  cartoonizeCost,
  cartoonizeFileVerdict,
  cartoonizePrompt,
  cartoonizeUploadKey,
  closestBackdropRatio,
  defaultBackdropProvider,
  enhanceResultOf,
  headshotCost,
  isHeadshotProviderDown,
  mintBgGenerateIdempotencyKey,
  photoBackdropCost,
  photoEnhanceCost,
  photoIntakeVerdict,
  photoResultUrlOf,
  photoUploadCost,
  photoUploadUrlOf,
  productPhotoCost,
  productPhotoPackshotCost,
  productPhotoResultOf,
  productScenePresets,
  removeBackgroundCost,
} from "./photo-desk";

describe("prices — the registry's, read live (B-04 + B-23)", () => {
  it("every bench cost equals its registry row AND the censused figure", () => {
    expect(removeBackgroundCost()).toBe(200);
    expect(removeBackgroundCost()).toBe(getCreditCost(REMOVE_BACKGROUND_PATH)!.cost);
    expect(photoBackdropCost()).toBe(100);
    expect(photoBackdropCost()).toBe(getCreditCost(PHOTO_BACKDROP_PATH)!.cost);
    expect(bgGenerateCost()).toBe(200);
    expect(bgGenerateCost()).toBe(getCreditCost(BG_GENERATE_PATH)!.cost);
    expect(photoEnhanceCost()).toBe(100);
    expect(photoEnhanceCost()).toBe(getCreditCost(PHOTO_ENHANCE_PATH)!.cost);
    expect(headshotCost()).toBe(100);
    expect(headshotCost()).toBe(getCreditCost("/api/generate-headshot")!.cost);
    expect(productPhotoPackshotCost()).toBe(100);
    expect(productPhotoPackshotCost()).toBe(getCreditCost(PRODUCT_PHOTO_PATH)!.cost);
    expect(cartoonizeCost()).toBe(200);
    expect(cartoonizeCost()).toBe(getCreditCost(ARTIST_IMAGE_PATH)!.cost);
    expect(photoUploadCost()).toBe(0);
    expect(photoUploadCost()).toBe(getCreditCost(PHOTO_UPLOAD_PATH)!.cost);
  });

  it("the product shot prices by type — packshot 100, lifestyle 150 (the page's ratified constant)", () => {
    expect(productPhotoCost("packshot")).toBe(100);
    expect(PRODUCT_PHOTO_LIFESTYLE_COST).toBe(150);
    expect(productPhotoCost("lifestyle")).toBe(150);
  });
});

describe("the shared photo intake (BgStudio's own door + rules)", () => {
  it("verdicts mirror the page's pick rules — image files, ≤ 5 MB", () => {
    expect(PHOTO_INTAKE_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(photoIntakeVerdict({ type: "image/png", size: 1024 })).toBe("ok");
    expect(photoIntakeVerdict({ type: "image/jpeg", size: PHOTO_INTAKE_MAX_BYTES })).toBe("ok");
    expect(photoIntakeVerdict({ type: "image/png", size: PHOTO_INTAKE_MAX_BYTES + 1 })).toBe("too-large");
    expect(photoIntakeVerdict({ type: "video/mp4", size: 1024 })).toBe("not-image");
    expect(photoIntakeVerdict({ type: "application/pdf", size: 1024 })).toBe("not-image");
  });

  it("the upload answer is its { url } — drift reads as null", () => {
    expect(photoUploadUrlOf({ url: "https://cdn/x.png" })).toBe("https://cdn/x.png");
    expect(photoUploadUrlOf({ url: "" })).toBeNull();
    expect(photoUploadUrlOf({})).toBeNull();
    expect(photoUploadUrlOf(null)).toBeNull();
    expect(photoUploadUrlOf("https://cdn/x.png")).toBeNull();
  });

  it("photoResultUrlOf reads { url } off the sync rails only", () => {
    expect(photoResultUrlOf({ url: "https://cdn/y.png" })).toBe("https://cdn/y.png");
    expect(photoResultUrlOf({ imageUrl: "https://cdn/y.png" })).toBeNull();
    expect(photoResultUrlOf({ url: 42 })).toBeNull();
    expect(photoResultUrlOf(null)).toBeNull();
  });
});

describe("remove-background — BgStudio's post body", () => {
  it("builds { imageUrl, aggressiveness } exactly", () => {
    expect(buildRemoveBackgroundPayload("https://cdn/a.png", 0.5)).toEqual({
      imageUrl: "https://cdn/a.png",
      aggressiveness: 0.5,
    });
    expect(buildRemoveBackgroundPayload("https://cdn/a.png", 0)).toEqual({
      imageUrl: "https://cdn/a.png",
      aggressiveness: 0,
    });
  });
});

describe("photo-backdrop — status gate, provider pick, ratio, body", () => {
  it("the status parser demands a boolean configured and reads the pair", () => {
    expect(backdropStatusOf({ configured: true, nanoConfigured: true, ideogramConfigured: false })).toEqual({
      configured: true,
      nanoConfigured: true,
      ideogramConfigured: false,
    });
    expect(backdropStatusOf({ configured: "yes" })).toBeNull();
    expect(backdropStatusOf(null)).toBeNull();
    expect(backdropStatusOf({})).toBeNull();
  });

  it("the provider pick is nano first, ideogram when it is the only one wired", () => {
    expect(defaultBackdropProvider({ configured: true, nanoConfigured: true, ideogramConfigured: true })).toBe("nano-banana-2.1");
    expect(defaultBackdropProvider({ configured: true, nanoConfigured: false, ideogramConfigured: true })).toBe("ideogram-4.0");
    expect(defaultBackdropProvider({ configured: true, nanoConfigured: false, ideogramConfigured: false })).toBeNull();
    expect(BACKDROP_PROVIDERS).toEqual(["nano-banana-2.1", "ideogram-4.0"]);
  });

  it("closestBackdropRatio is BgStudio's nearest-aspect match", () => {
    expect(BACKDROP_RATIOS).toEqual(["1080:1080", "1080:1920", "1920:1080"]);
    expect(closestBackdropRatio(0, 0)).toBe("1080:1080");
    expect(closestBackdropRatio(800, 800)).toBe("1080:1080");
    expect(closestBackdropRatio(1920, 1080)).toBe("1920:1080");
    expect(closestBackdropRatio(720, 1280)).toBe("1080:1920");
    expect(closestBackdropRatio(1000, 900)).toBe("1080:1080");
    expect(closestBackdropRatio(1600, 900)).toBe("1920:1080");
  });

  it("builds { prompt, provider, ratio } exactly", () => {
    expect(buildPhotoBackdropPayload("golden dunes", "ideogram-4.0", "1920:1080")).toEqual({
      prompt: "golden dunes",
      provider: "ideogram-4.0",
      ratio: "1920:1080",
    });
  });
});

describe("bg-generate — the editor section's rail", () => {
  it("the style ids are the section's four, verbatim", () => {
    expect(BG_GENERATE_STYLES).toEqual(["studio", "neon-city", "golden-palace", "beach-sunset"]);
  });

  it("the idempotency key is the section's formula", () => {
    const now = 1730000000000;
    const random = 0.42424242;
    expect(mintBgGenerateIdempotencyKey(now, random)).toBe(
      `bg-${now.toString(36)}-${random.toString(36).slice(2, 10)}`,
    );
    expect(mintBgGenerateIdempotencyKey(now, random)).toMatch(/^bg-[0-9a-z]+-[0-9a-z]+$/);
    expect(mintBgGenerateIdempotencyKey(now, 0.111)).not.toBe(mintBgGenerateIdempotencyKey(now, 0.222));
  });

  it("builds { prompt, style, idempotencyKey } and reads { imageUrl }", () => {
    expect(buildBgGeneratePayload("neon alley", "neon-city", "bg-x-1")).toEqual({
      prompt: "neon alley",
      style: "neon-city",
      idempotencyKey: "bg-x-1",
    });
    expect(bgGenerateUrlOf({ imageUrl: "https://cdn/p.png" })).toBe("https://cdn/p.png");
    expect(bgGenerateUrlOf({ url: "https://cdn/p.png" })).toBeNull();
    expect(bgGenerateUrlOf(null)).toBeNull();
  });

  it("the replay note is the server's, verbatim — a fresh answer carries none", () => {
    /* The rail's exact words (bg-generate.ts REPLAY_NOTE): a replayed
       answer serves the stored plate and explains itself; the FE
       reader passes the note through untouched and invents nothing
       for fresh or drifted answers. */
    const note =
      "This is the background plate you already made for this request — tweak the prompt or style for a fresh one.";
    expect(bgGenerateReplayNoteOf({ imageUrl: "https://cdn/p.png", replayed: true, replayNote: note })).toBe(note);
    expect(bgGenerateReplayNoteOf({ imageUrl: "https://cdn/p.png" })).toBeNull();
    expect(bgGenerateReplayNoteOf({ replayed: true })).toBeNull();
    expect(bgGenerateReplayNoteOf({ replayNote: note })).toBeNull();
    expect(bgGenerateReplayNoteOf({ replayed: true, replayNote: "" })).toBeNull();
    expect(bgGenerateReplayNoteOf({ replayed: "true", replayNote: note })).toBeNull();
    expect(bgGenerateReplayNoteOf(null)).toBeNull();
  });

  it("the status parser reads configured + creditCost, registry as the fallback", () => {
    expect(bgGenerateStatusOf({ configured: true, creditCost: 200, pricePlaceholder: false })).toEqual({
      configured: true,
      creditCost: 200,
    });
    expect(bgGenerateStatusOf({ configured: false })).toEqual({ configured: false, creditCost: 200 });
    expect(bgGenerateStatusOf({ creditCost: 200 })).toBeNull();
    expect(bgGenerateStatusOf(null)).toBeNull();
  });
});

describe("photo-enhance — ops, body, result", () => {
  it("the op ids and the Autopilot set are the page's", () => {
    expect(ENHANCE_OPS).toEqual(["upscale", "denoise", "restore", "colorize"]);
    expect(AUTOPILOT_ENHANCE_OPS).toEqual(["upscale", "denoise", "restore"]);
  });

  it("strengths ride only when shaped, one entry per chosen op", () => {
    expect(buildPhotoEnhancePayload("https://cdn/a.png", ["upscale", "denoise"])).toEqual({
      imageUrl: "https://cdn/a.png",
      operations: ["upscale", "denoise"],
    });
    expect(
      buildPhotoEnhancePayload("https://cdn/a.png", ["upscale"], { upscale: 70, denoise: 40 }),
    ).toEqual({
      imageUrl: "https://cdn/a.png",
      operations: ["upscale"],
      strengths: { upscale: 70 },
    });
  });

  it("the result reader keeps the rail's ops, falling back to the run's", () => {
    expect(enhanceResultOf({ url: "https://cdn/e.png", operations: ["upscale"] }, ["upscale", "denoise"])).toEqual({
      url: "https://cdn/e.png",
      operations: ["upscale"],
    });
    expect(enhanceResultOf({ url: "https://cdn/e.png" }, ["restore"])).toEqual({
      url: "https://cdn/e.png",
      operations: ["restore"],
    });
    expect(enhanceResultOf({ operations: ["upscale"] }, ["upscale"])).toBeNull();
    expect(enhanceResultOf({ url: "https://cdn/e.png", operations: ["bogus", "denoise"] }, [])).toEqual({
      url: "https://cdn/e.png",
      operations: ["denoise"],
    });
  });
});

describe("headshot — flows, presets, body discipline", () => {
  it("the enums are the studio's", () => {
    expect(HEADSHOT_FLOWS).toEqual(["autopilot", "preset", "manual"]);
    expect(HEADSHOT_PRESETS).toEqual(["studio", "stage", "street", "luxury"]);
    expect(HEADSHOT_MODELS).toEqual(["nano-banana-2.1", "ideogram-4.0"]);
  });

  it("preset rides only on the preset flow, promptText only on manual (trimmed)", () => {
    expect(
      buildHeadshotPayload({ flow: "autopilot", preset: "stage", promptText: "ignored", model: "nano-banana-2.1", referenceImageUrl: "" }),
    ).toEqual({ mode: "autopilot", preset: undefined, promptText: undefined, model: "nano-banana-2.1", referenceImageUrl: null });
    expect(
      buildHeadshotPayload({ flow: "preset", preset: "luxury", promptText: "", model: "ideogram-4.0", referenceImageUrl: " https://cdn/me.png " }),
    ).toEqual({ mode: "preset", preset: "luxury", promptText: undefined, model: "ideogram-4.0", referenceImageUrl: "https://cdn/me.png" });
    expect(
      buildHeadshotPayload({ flow: "manual", preset: "studio", promptText: "  film noir  ", model: "nano-banana-2.1", referenceImageUrl: "" }),
    ).toEqual({ mode: "manual", preset: undefined, promptText: "film noir", model: "nano-banana-2.1", referenceImageUrl: null });
  });

  it("provider-down is HTTP 503 or the provider_not_connected code", () => {
    expect(isHeadshotProviderDown(503, {})).toBe(true);
    expect(isHeadshotProviderDown(200, { code: "provider_not_connected" })).toBe(true);
    expect(isHeadshotProviderDown(500, { error: "provider_not_connected" })).toBe(true);
    expect(isHeadshotProviderDown(400, { code: "bad_request" })).toBe(false);
    expect(isHeadshotProviderDown(402, {})).toBe(false);
  });
});

describe("product-photo — modes, presets, body discipline, result gate", () => {
  it("the enums are the studio's", () => {
    expect(PRODUCT_STYLE_MODES).toEqual(["autopilot", "presets", "custom"]);
    expect(PRODUCT_MODELS).toEqual(["nano-banana-2.1", "ideogram-4.0"]);
    expect(PRODUCT_RATIOS).toEqual(["1080:1080", "1080:1920"]);
    expect(PRODUCT_KINDS).toEqual(["apparel", "drinkware", "jewelry", "poster", "accessory", "home", "other"]);
    expect(productScenePresets("packshot")).toEqual(["studio-white", "light-grey", "infinity-white"]);
    expect(productScenePresets("lifestyle")).toEqual(["marble-luxe", "street-style", "golden-hour", "cozy-home"]);
  });

  it("kind / scenePreset / customPrompt ride only on their own style mode, nulls where the page sends nulls", () => {
    const base = {
      productImageUrl: " https://cdn/tee.png ",
      productName: " Gold Chain Tee ",
      productKind: "apparel" as const,
      shotType: "packshot" as const,
      scenePreset: "studio-white" as const,
      customPrompt: " on marble ",
      model: "nano-banana-2.1" as const,
      ratio: "1080:1080" as const,
    };
    expect(buildProductPhotoPayload({ ...base, styleMode: "autopilot" })).toEqual({
      productImageUrl: "https://cdn/tee.png",
      productName: "Gold Chain Tee",
      productKind: "apparel",
      shotType: "packshot",
      styleMode: "autopilot",
      scenePreset: null,
      customPrompt: null,
      model: "nano-banana-2.1",
      ratio: "1080:1080",
    });
    expect(buildProductPhotoPayload({ ...base, styleMode: "presets" })).toEqual({
      productImageUrl: "https://cdn/tee.png",
      productName: "Gold Chain Tee",
      productKind: null,
      shotType: "packshot",
      styleMode: "presets",
      scenePreset: "studio-white",
      customPrompt: null,
      model: "nano-banana-2.1",
      ratio: "1080:1080",
    });
    expect(buildProductPhotoPayload({ ...base, styleMode: "custom", productName: " " })).toEqual({
      productImageUrl: "https://cdn/tee.png",
      productName: null,
      productKind: null,
      shotType: "packshot",
      styleMode: "custom",
      scenePreset: null,
      customPrompt: "on marble",
      model: "nano-banana-2.1",
      ratio: "1080:1080",
    });
  });

  it("a shot counts as landed only on status succeeded WITH a url", () => {
    expect(productPhotoResultOf({ status: "succeeded", url: "https://cdn/s.png", path: "p/s.png" })).toEqual({
      url: "https://cdn/s.png",
      path: "p/s.png",
    });
    expect(productPhotoResultOf({ status: "succeeded", url: "https://cdn/s.png" })).toEqual({
      url: "https://cdn/s.png",
      path: null,
    });
    expect(productPhotoResultOf({ status: "failed", url: "https://cdn/s.png" })).toBeNull();
    expect(productPhotoResultOf({ status: "succeeded" })).toBeNull();
    expect(productPhotoResultOf(null)).toBeNull();
  });
});

/* ─── B-23: cartoonize ─────────────────────────────────────────
   The direction strings below are cartoon-studio.tsx's
   STYLE_PRESETS, copied character for character — if the page's
   presets ever change, this pin must change with them, exactly
   like the Cover Art desk's mirrored CARTOON_STYLE_PRESETS. */
const STYLE_DIRECTIONS: Record<string, string> = {
  anime:
    "vibrant anime style, cel-shaded, clean dynamic linework, Japanese animation aesthetic, expressive",
  toon3d:
    "3D cartoon render style, stylized animated feature film look, soft volumetric lighting, smooth appealing shapes",
  classic2d:
    "classic 2D hand-drawn cartoon style, vintage animation cel aesthetic, bold confident outlines, flat cheerful colors",
  comic:
    "comic book art style, bold ink outlines, halftone dot shading, dramatic cel shading, graphic novel look",
};

describe("cartoonize (B-23) — the Cartoonize tab's rail, verbatim", () => {
  it("the redraw prompt is the page's, byte for byte, for every STYLE_PRESETS direction", () => {
    for (const direction of Object.values(STYLE_DIRECTIONS)) {
      expect(cartoonizePrompt(direction)).toBe(
        `Redraw the attached photo as a cartoon in ${direction}. ` +
          "Keep the same subject, pose, composition and likeness — only the art style changes. " +
          "Clean bold cartoon finish, no photorealistic remnants.",
      );
    }
    /* The full literal for one preset, spelled out end to end so
       a template edit can never slip through as a variable. */
    expect(cartoonizePrompt(STYLE_DIRECTIONS.anime)).toBe(
      "Redraw the attached photo as a cartoon in vibrant anime style, cel-shaded, clean dynamic linework, Japanese animation aesthetic, expressive. Keep the same subject, pose, composition and likeness — only the art style changes. Clean bold cartoon finish, no photorealistic remnants.",
    );
  });

  it("the payload is the tab's own post body — redraw prompt, gen4_image, the uploaded reference", () => {
    expect(CARTOONIZE_MODEL).toBe("gen4_image");
    expect(buildCartoonizePayload("https://cdn/ref.png", STYLE_DIRECTIONS.comic)).toEqual({
      promptText:
        "Redraw the attached photo as a cartoon in comic book art style, bold ink outlines, halftone dot shading, dramatic cel shading, graphic novel look. Keep the same subject, pose, composition and likeness — only the art style changes. Clean bold cartoon finish, no photorealistic remnants.",
      model: "gen4_image",
      referenceImageUrl: "https://cdn/ref.png",
    });
  });

  it("the upload key is the tab's cartoon-studio-refs key, filename sanitized", () => {
    expect(cartoonizeUploadKey("my photo!.png", 1730000000000)).toBe("cartoon-studio-refs/1730000000000-my_photo_.png");
    expect(cartoonizeUploadKey("plain-name_1.jpg", 5)).toBe("cartoon-studio-refs/5-plain-name_1.jpg");
  });

  it("the pick rules are the tab's — image files, ≤ 10 MB", () => {
    expect(CARTOONIZE_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(cartoonizeFileVerdict({ type: "image/png", size: CARTOONIZE_MAX_BYTES })).toBe("ok");
    expect(cartoonizeFileVerdict({ type: "image/png", size: CARTOONIZE_MAX_BYTES + 1 })).toBe("too-large");
    expect(cartoonizeFileVerdict({ type: "video/mp4", size: 10 })).toBe("not-image");
  });
});
