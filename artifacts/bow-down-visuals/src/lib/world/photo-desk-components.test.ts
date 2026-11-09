/**
 * photo-desk-components — Stack 400 world parity (census Lane B
 * items B-04, B-05, B-23) source-contract pins. The Photo Desk
 * stands in the Create Wing as a real station dispatched by
 * CreateDeskPanel; every bench starts its charged call through
 * the confirmed-spend seam at the registry price; the Native
 * States trio is wired on the new desks; the Page Designer
 * bench stacks at the profile desk on the My Studio board and
 * applies on the profile's own PUT rail; and the Cover Art
 * bench's cartoonize mode rides its own confirmed
 * generate-artist-image call with the verbatim redraw payload
 * at overrideCost 200.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATION_BY_ID } from "./stations";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const benches = read("../../components/world/native/PhotoBenches.tsx");
const desk = read("../../components/world/native/PhotoDesk.tsx");
const designerBench = read("../../components/world/native/PageDesignerBench.tsx");
const createDesks = read("../../components/world/native/CreateDesks.tsx");
const createPanel = read("../../components/world/native/CreateDeskPanel.tsx");
const studioBoard = read("../../components/world/native/boards/StudioBoard.tsx");

describe("B-04 — the Photo Desk station + dispatch", () => {
  it("photo-desk is a members-only create station in the Song Desk's wing", () => {
    const station = STATION_BY_ID.get("photo-desk")!;
    expect(station).toBeDefined();
    expect(station.panel).toEqual({ kind: "native", pattern: "create" });
    expect(station.membersOnly).toBe(true);
    expect(station.roomId).toBe(STATION_BY_ID.get("song-desk")!.roomId);
    expect(station.websitePath).toBe("/thumbnail-studio?tab=background");
    expect(station.x).toBe(21);
    expect(station.z).toBe(-4);
    expect(station.name).toBe("Photo Desk");
  });

  it("CreateDeskPanel dispatches photo-desk to the PhotoDesk", () => {
    expect(createPanel).toContain('import { PhotoDesk } from "./PhotoDesk";');
    expect(createPanel).toContain('case "photo-desk":');
    expect(createPanel).toContain("return <PhotoDesk {...props} />;");
  });

  it("the desk renders the shared intake + all six benches behind its tabs", () => {
    expect(desk).toContain("export function PhotoDesk(props: CreateDeskProps)");
    expect(desk).toContain('data-testid="world-photo-desk"');
    expect(desk).toContain("<PhotoIntake isLight={isLight} photo={photo} onPhoto={setPhoto} />");
    for (const bench of [
      "RemoveBackgroundBench",
      "PhotoBackdropBench",
      "BgPlateBench",
      "PhotoEnhanceBench",
      "HeadshotBench",
      "ProductPhotoBench",
    ]) {
      expect(desk, bench).toContain(`<${bench} isLight={isLight}`);
      expect(benches, bench).toContain(`export function ${bench}(`);
    }
  });
});

describe("B-04 — every bench rides the confirmed-spend seam at the registry price", () => {
  it("the intake uploads through the free door with skipConfirm (never a bare fetch)", () => {
    expect(benches).toContain('confirmedFetch(PHOTO_UPLOAD_PATH, { method: "POST", body: form, skipConfirm: true })');
    expect(benches).not.toContain("await fetch(");
    expect(benches).toContain("photoIntakeVerdict(file)");
  });

  it("remove-background: confirmedFetch at removeBackgroundCost() with the page's feature name", () => {
    expect(benches).toContain("confirmedFetch(REMOVE_BACKGROUND_PATH, {");
    expect(benches).toContain("buildRemoveBackgroundPayload(photo.url, aggressiveness)");
    expect(benches).toContain('overrideFeature: "Background Removal"');
    expect(benches).toContain("const cost = removeBackgroundCost();");
    expect(benches).toContain('data-testid="world-photo-remove-bg-run"');
  });

  it("photo-backdrop: a skipConfirm status gate, then the confirmed post", () => {
    expect(benches).toContain("confirmedFetch(PHOTO_BACKDROP_STATUS_PATH, { skipConfirm: true })");
    expect(benches).toContain("confirmedFetch(PHOTO_BACKDROP_PATH, {");
    expect(benches).toContain("buildPhotoBackdropPayload(prompt.trim(), provider, ratio)");
    expect(benches).toContain('overrideFeature: "Photo Backdrop"');
    expect(benches).toContain("backdropStatusOf(data)");
    expect(benches).toContain("defaultBackdropProvider(status)");
  });

  it("bg-generate: a skipConfirm status gate, the section's idempotency discipline, the confirmed post", () => {
    expect(benches).toContain("confirmedFetch(BG_GENERATE_STATUS_PATH, { skipConfirm: true })");
    expect(benches).toContain("confirmedFetch(BG_GENERATE_PATH, {");
    expect(benches).toContain("mintBgGenerateIdempotencyKey(Date.now(), Math.random())");
    expect(benches).toContain("buildBgGeneratePayload(prompt.trim(), style, attemptKey.current)");
    expect(benches).toContain("BG_GENERATE_NOT_CONFIGURED_CODE");
    expect(benches).toContain("bgGenerateUrlOf(data)");
  });

  it("photo-enhance: the confirmed post with the page's Autopilot set + strengths discipline", () => {
    expect(benches).toContain("confirmedFetch(PHOTO_ENHANCE_PATH, {");
    expect(benches).toContain("buildPhotoEnhancePayload(photo.url, ops, withStrengths ? strengths : null)");
    expect(benches).toContain("AUTOPILOT_ENHANCE_OPS");
    expect(benches).toContain("PHOTO_ENHANCE_NOT_CONNECTED_CODE");
    expect(benches).toContain('data-testid="world-photo-enhance-autopilot"');
  });

  it("headshot: the confirmed post with the studio's provider-down honesty", () => {
    expect(benches).toContain("confirmedFetch(HEADSHOT_PATH, {");
    expect(benches).toContain("buildHeadshotPayload({ flow, preset, promptText: prompt, model, referenceImageUrl: referenceUrl })");
    expect(benches).toContain("isHeadshotProviderDown(res.status, data)");
    expect(benches).toContain('data-testid="world-photo-headshot-run"');
  });

  it("product-photo: the confirmed post priced by shot type (100 packshot / 150 lifestyle)", () => {
    expect(benches).toContain("confirmedFetch(PRODUCT_PHOTO_PATH, {");
    expect(benches).toContain("const cost = productPhotoCost(shotType);");
    expect(benches).toContain("productPhotoResultOf(data)");
    expect(benches).toContain('data-testid="world-photo-product-run"');
  });

  it("402s land on the shared out-of-Bucs line; finished work flows into the hub project", () => {
    expect(benches.split("res.status === 402").length - 1).toBe(6);
    expect(benches).toContain('t("worldBenches300.outOfBucs", { feature })');
    expect(benches).toContain('addAsset({ kind: "image", url');
  });

  it("the NativeStates trio is wired across the bench family", () => {
    expect(benches).toContain('import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";');
    expect(benches.split("<NativeLoadingState").length - 1).toBeGreaterThanOrEqual(5);
    expect(benches.split("<NativeEmptyState").length - 1).toBeGreaterThanOrEqual(3);
    expect(benches.split("<NativeErrorState").length - 1).toBeGreaterThanOrEqual(5);
  });

  it("the benches branch their surfaces on isLight (light/dark parity)", () => {
    expect(benches).toContain('isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"');
    expect(desk).toContain('? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"');
    expect(desk).toContain(': "border-white/15 text-white/75 hover:text-white"');
  });
});

describe("B-05 — the Page Designer bench at the profile desk", () => {
  it("stacks on the My Studio board directly under the creator-profile card", () => {
    expect(studioBoard).toContain('import { PageDesignerBench } from "@/components/world/native/PageDesignerBench";');
    const cardAt = studioBoard.indexOf("<CreatorProfileCreateCard isLight={isLight} />");
    const benchAt = studioBoard.indexOf("<PageDesignerBench isLight={isLight} />");
    expect(cardAt).toBeGreaterThan(-1);
    expect(benchAt).toBeGreaterThan(cardAt);
  });

  it("is an ({ isLight }) bench rooted at its testid, opening on the profile's own GET rail", () => {
    expect(designerBench).toContain("export function PageDesignerBench({ isLight }: { isLight: boolean })");
    expect(designerBench).toContain('data-testid="world-page-designer-bench"');
    expect(designerBench).toContain("fetch(PROFILE_ME_PATH, { headers: await authHeaders() })");
    expect(designerBench).toContain("designerProfileOf(data)");
  });

  it("the three charged rails ride confirmedFetch at their registry costs", () => {
    expect(designerBench).toContain("confirmedFetch(PAGE_DESIGNER_THEME_PATH, {");
    expect(designerBench).toContain("overrideCost: themeCost");
    expect(designerBench).toContain("pageDesignerThemeCost()");
    expect(designerBench).toContain("confirmedFetch(PAGE_DESIGNER_BIO_PATH, {");
    expect(designerBench).toContain("overrideCost: bioCost");
    expect(designerBench).toContain("confirmedFetch(PAGE_DESIGNER_BANNER_PATH, {");
    expect(designerBench).toContain("overrideCost: bannerCost");
    expect(designerBench.split("res.status === 402").length - 1).toBe(3);
  });

  it("the upload door is free (skipConfirm) and results apply on the PUT rail", () => {
    expect(designerBench).toContain("confirmedFetch(PAGE_DESIGNER_UPLOAD_PATH, { method: \"POST\", body: form, skipConfirm: true })");
    expect(designerBench).toContain('method: "PUT"');
    expect(designerBench).toContain("buildProfileDesignPatch({");
    expect(designerBench).toContain("buildProfileBioPatch(bioDraft)");
    expect(designerBench).toContain("buildProfileBannerPatch(url)");
    expect(designerBench).toContain("buildProfileUploadPatch(uploadKind, uploadedUrl)");
  });

  it("the page's wording gates stand before every charged run", () => {
    expect(designerBench).toContain("pageDesignerWordingReady(vibe)");
    expect(designerBench).toContain("pageDesignerWordingReady(facts)");
    expect(designerBench).toContain("extractPalette(art, 5)");
  });

  it("the NativeStates trio carries its loading / empty / error moments", () => {
    expect(designerBench).toContain("<NativeLoadingState");
    expect(designerBench).toContain("<NativeEmptyState");
    expect(designerBench).toContain("<NativeErrorState");
    expect(designerBench).toContain('data-testid="world-page-designer-theme-run"');
    expect(designerBench).toContain('data-testid="world-page-designer-bio-run"');
    expect(designerBench).toContain('data-testid="world-page-designer-banner-run"');
  });
});

describe("B-23 — cartoonize mode on the Cover Art desk's artist-image bench", () => {
  it("the mode switch sits on the bench, words mode untouched beside it", () => {
    expect(createDesks).toContain('data-testid="world-artist-image-mode-words"');
    expect(createDesks).toContain('data-testid="world-artist-image-mode-cartoonize"');
    expect(createDesks).toContain('t("cartoonStudio.tabCartoonize")');
    expect(createDesks).toContain("buildArtistImagePayload(generationPrompt, imageModel)");
    expect(createDesks).toContain("overrideCost: artistImageCost(imageModel)");
    expect(createDesks).toContain('data-testid="world-create-artist-image-run"');
  });

  it("the photo rides the page's R2 key up through r2UploadFile — no new upload plumbing", () => {
    expect(createDesks).toContain('import { r2UploadFile } from "@/lib/r2-storage";');
    expect(createDesks).toContain("cartoonizeUploadKey(cartoonFile.name, Date.now())");
    expect(createDesks).toContain("cartoonizeFileVerdict(file)");
  });

  it("the run is the bench's own confirmed generate-artist-image call at overrideCost 200", () => {
    expect(createDesks).toContain("confirmedFetch(ARTIST_IMAGE_PATH, {");
    expect(createDesks).toContain("buildCartoonizePayload(referenceImageUrl, style.direction)");
    expect(createDesks).toContain("overrideCost: cartoonizeCost()");
    expect(createDesks).toContain('overrideFeature: t("cartoonStudio.cartoonizeFeatureName")');
    expect(createDesks).toContain('data-testid="world-create-artist-image-cartoonize-run"');
    expect(createDesks).toContain('t("cartoonStudio.cartoonizeButton", { cost: cartoonizeCost() })');
  });

  it("the style pick is the mirrored STYLE_PRESETS strip, and the poll is the bench's own", () => {
    expect(createDesks).toContain("const [cartoonStyleId, setCartoonStyleId] = useState<CartoonStyleId>(\"anime\")");
    expect(createDesks).toContain("const style = cartoonStyleOf(cartoonStyleId);");
    expect(createDesks.split("startImagePoll(data.taskId)").length - 1).toBe(2);
  });
});
