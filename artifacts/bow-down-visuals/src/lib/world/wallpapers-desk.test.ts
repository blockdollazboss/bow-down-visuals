/**
 * wallpapers-desk — stack1500 world parity wave #3 item 34 pins.
 *
 * The Wallpapers Desk is the wallpaper flow's native form. These
 * pins hold: the station is wired into the Create Wing dispatch;
 * every price is the wallpapers-prices module's derivation AND the
 * registry row AND the route's constant (a drift in any one fails
 * here first) — including the pack of 10 at its flat 500, never
 * 10 × the clean single; the payload builders produce the rails'
 * exact bodies (branding fields ride ONLY the branded path); the
 * pack builder refuses any count but exactly ten rather than
 * sending a pack the rail would reject; the response guards treat
 * drift as failure.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WALLPAPERS_CLEAN_COST,
  WALLPAPERS_CLIP_REGISTRY_COST,
  WALLPAPERS_DESK_STATION_ID,
  WALLPAPERS_PACK10_COST,
  WALLPAPERS_PACK10_REGISTRY_COST,
  WALLPAPERS_SCREENSAVER_COST,
  WALLPAPERS_SCREENSAVER_REGISTRY_COST,
  WALLPAPER_GENERATE_COST,
  WALLPAPER_PACK_OF_10_COUNT,
  WALLPAPER_PRESETS,
  buildArtRequest,
  buildClipRequest,
  buildPack10Request,
  buildPackDownloadRequest,
  buildRenderRequest,
  buildScreensaverRequest,
  clampScreensaverSeconds,
  generationPollOf,
  generationSubmitOf,
  packOfResponse,
  packReady,
  prependRenders,
  renderOfResponse,
  screensaverOfResponse,
  togglePackSelection,
  wallpaperArtRatio,
  wallpaperPresetByKeyIn,
  type WallpaperBrandInputs,
  type WallpaperRender,
} from "./wallpapers-desk";
import { getCreditCost } from "../credit-costs";
import { STATION_BY_ID } from "./stations";
import { isCreateDeskId } from "./create-desks";

const routeSrc = readFileSync(
  new URL("../../../../api-server/src/routes/wallpapers.ts", import.meta.url),
  "utf8",
);
const modelSrc = readFileSync(
  new URL("../../components/generate-artist-image.ts", import.meta.url),
  "utf8",
);
const desk2dSrc = readFileSync(
  new URL("../../components/wallpapers/WallpapersDesk.tsx", import.meta.url),
  "utf8",
);

function deriveConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const ${name}[^=]*=\\s*(?:Number\\([^)]*\\)\\s*\\|\\|\\s*)?(\\d+)`));
  if (!m) throw new Error(`could not derive ${name}`);
  return Number(m[1]);
}

const PHONE = WALLPAPER_PRESETS[0]!;
const DESKTOP = WALLPAPER_PRESETS.find((p) => p.kind === "desktop")!;
const BRAND: WallpaperBrandInputs = {
  branded: true,
  logoUrl: "https://cdn.example/logo.png",
  brandName: "Thy Cheat Code",
  aiDisclosure: true,
};
const CLEAN: WallpaperBrandInputs = { branded: false, logoUrl: null, brandName: null, aiDisclosure: false };

describe("station wiring", () => {
  it("the station exists, native create pattern, members-only, /wallpapers path", () => {
    const station = STATION_BY_ID.get(WALLPAPERS_DESK_STATION_ID);
    expect(station).toBeDefined();
    expect(station!.panel).toEqual({ kind: "native", pattern: "create" });
    expect(station!.membersOnly).toBe(true);
    expect(station!.websitePath).toBe("/wallpapers");
    expect(isCreateDeskId(WALLPAPERS_DESK_STATION_ID)).toBe(true);
  });
});

describe("prices — prices module == registry == route", () => {
  it("clean render 400: the shared clean-export registry row and the route constant agree", () => {
    expect(WALLPAPERS_CLEAN_COST).toBe(400);
    expect(getCreditCost("/api/export-final-video")?.cost).toBe(400);
    expect(deriveConst(routeSrc, "CLEAN_RENDER_COST")).toBe(400);
  });

  it("pack of 10 is the flat 500 — never 10 × the clean single (4,000)", () => {
    expect(WALLPAPERS_PACK10_COST).toBe(500);
    expect(WALLPAPERS_PACK10_REGISTRY_COST).toBe(500);
    expect(getCreditCost("/api/wallpapers/pack-of-10")?.cost).toBe(500);
    expect(deriveConst(routeSrc, "PACK_OF_10_COST")).toBe(500);
    expect(WALLPAPERS_PACK10_COST).not.toBe(10 * WALLPAPERS_CLEAN_COST);
    expect(desk2dSrc).toContain("WALLPAPER_PACK_OF_10_COST");
  });

  it("screensaver render 300: registry row, cross-check and route constant agree", () => {
    expect(WALLPAPERS_SCREENSAVER_COST).toBe(300);
    expect(WALLPAPERS_SCREENSAVER_REGISTRY_COST).toBe(300);
    expect(deriveConst(routeSrc, "SCREENSAVER_RENDER_COST")).toBe(300);
  });

  it("art generation 100 — the nano model's own row in the model table", () => {
    expect(WALLPAPER_GENERATE_COST).toBe(100);
    const row = modelSrc.match(/id: "nano-banana-2\.1"[^}]*credits: (\d+)/);
    expect(row).not.toBeNull();
    expect(Number(row![1])).toBe(WALLPAPER_GENERATE_COST);
  });

  it("the screensaver's source clip rides the runway registry row at 400", () => {
    expect(WALLPAPERS_CLIP_REGISTRY_COST).toBe(400);
    expect(getCreditCost("/api/generate-runway-clip")?.cost).toBe(400);
  });
});

describe("payload builders — the rails' exact bodies", () => {
  it("art request: trimmed prompt, the nano model, the preset's ratio", () => {
    expect(wallpaperArtRatio(PHONE)).toBe("1080:1920");
    expect(wallpaperArtRatio(DESKTOP)).toBe("1920:1080");
    expect(buildArtRequest("  a crown  ", PHONE)).toEqual({
      promptText: "a crown",
      model: "nano-banana-2.1",
      ratio: "1080:1920",
    });
  });

  it("branded render carries the stamp fields; a clean render carries neither", () => {
    expect(buildRenderRequest("https://x/a.png", PHONE.key, BRAND)).toEqual({
      sourceUrl: "https://x/a.png",
      presetKey: PHONE.key,
      branded: true,
      aiDisclosure: true,
      logoUrl: "https://cdn.example/logo.png",
      brandName: "Thy Cheat Code",
    });
    const clean = buildRenderRequest("https://x/a.png", PHONE.key, CLEAN);
    expect(clean).toEqual({
      sourceUrl: "https://x/a.png",
      presetKey: PHONE.key,
      branded: false,
      aiDisclosure: false,
    });
    expect("logoUrl" in clean).toBe(false);
    expect("brandName" in clean).toBe(false);
  });

  it("a branded render with no logo saved sends the name alone (logoUrl omitted, never faked)", () => {
    const body = buildRenderRequest("https://x/a.png", PHONE.key, { ...BRAND, logoUrl: null });
    expect("logoUrl" in body).toBe(false);
    expect(body["brandName"]).toBe("Thy Cheat Code");
  });

  it("the pack body is exactly ten items at the one picked size — and refuses any other count", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `https://x/${i}.png`);
    const body = buildPack10Request(ten, DESKTOP.key, true);
    expect(body!.items).toHaveLength(WALLPAPER_PACK_OF_10_COUNT);
    expect(body!.items.every((it) => it.presetKey === DESKTOP.key)).toBe(true);
    expect(buildPack10Request(ten.slice(0, 9), DESKTOP.key, true)).toBeNull();
    expect(buildPack10Request([...ten, "https://x/extra.png"], DESKTOP.key, true)).toBeNull();
  });

  it("clip request: the 2D desk's runway body", () => {
    expect(buildClipRequest(" waves ")).toEqual({
      promptText: "waves",
      ratio: "1280:720",
      model: "gen4.5",
    });
  });

  it("screensaver seconds clamp to the rail's 10–120 with the 60 fallback", () => {
    expect(clampScreensaverSeconds(5)).toBe(10);
    expect(clampScreensaverSeconds(999)).toBe(120);
    expect(clampScreensaverSeconds(Number.NaN)).toBe(60);
    expect(clampScreensaverSeconds(45.6)).toBe(46);
    const body = buildScreensaverRequest("https://x/v.mp4", DESKTOP.key, 500, BRAND);
    expect(body["seconds"]).toBe(120);
    expect(body["logoUrl"]).toBe("https://cdn.example/logo.png");
  });

  it("pack download: non-empty urls only, capped at the rail's 12, null when empty", () => {
    expect(buildPackDownloadRequest(["", "https://x/1.png"])).toEqual({ urls: ["https://x/1.png"] });
    expect(buildPackDownloadRequest([])).toBeNull();
    const many = Array.from({ length: 20 }, (_, i) => `https://x/${i}.png`);
    expect(buildPackDownloadRequest(many, " Pack ")!.urls).toHaveLength(12);
    expect(buildPackDownloadRequest(many, " Pack ")!["name"]).toBe("Pack");
  });
});

describe("pack selection — the 2D desk's toggle rule", () => {
  it("toggles, and never grows past ten", () => {
    let sel: string[] = [];
    sel = togglePackSelection(sel, "a");
    sel = togglePackSelection(sel, "b");
    expect(sel).toEqual(["a", "b"]);
    sel = togglePackSelection(sel, "a");
    expect(sel).toEqual(["b"]);
    for (let i = 0; i < 10; i++) sel = togglePackSelection(sel, `u${i}`);
    expect(sel).toHaveLength(10);
    expect(togglePackSelection(sel, "overflow")).toEqual(sel);
    expect(packReady(sel)).toBe(true);
    expect(packReady(sel.slice(0, 9))).toBe(false);
  });
});

describe("response guards — drift is failure", () => {
  const renderRow = { url: "https://x/r.png", presetKey: PHONE.key, width: 1320, height: 2868 };

  it("a render answer needs its url; dimensions fall back to the preset's", () => {
    expect(renderOfResponse(renderRow, PHONE)).toEqual(renderRow);
    expect(renderOfResponse({ url: "https://x/r.png" }, PHONE)).toEqual({
      url: "https://x/r.png",
      presetKey: PHONE.key,
      width: PHONE.width,
      height: PHONE.height,
    });
    expect(renderOfResponse({ width: 1 }, PHONE)).toBeNull();
    expect(renderOfResponse(null, PHONE)).toBeNull();
  });

  it("a pack answer is exactly ten well-formed renders or nothing", () => {
    const ten = { renders: Array.from({ length: 10 }, () => ({ ...renderRow })) };
    expect(packOfResponse(ten)).toHaveLength(10);
    expect(packOfResponse({ renders: ten.renders.slice(0, 9) })).toBeNull();
    expect(packOfResponse({ renders: [{ url: "https://x/r.png" }] })).toBeNull();
    expect(packOfResponse({})).toBeNull();
  });

  it("a screensaver answer carries its seconds and charged cost, with honest fallbacks", () => {
    const r = screensaverOfResponse({ ...renderRow, seconds: 45, creditCost: 300 }, PHONE);
    expect(r).toMatchObject({ seconds: 45, creditCost: 300 });
    const bare = screensaverOfResponse({ url: "https://x/s.mp4" }, PHONE);
    expect(bare!.creditCost).toBe(WALLPAPERS_SCREENSAVER_COST);
  });

  it("generation polls: done needs succeeded + url; failed/cancelled fail; the rest pend", () => {
    expect(generationPollOf({ status: "succeeded", url: "https://x/a.png" })).toEqual({
      kind: "done",
      url: "https://x/a.png",
    });
    expect(generationPollOf({ status: "succeeded" })).toEqual({ kind: "pending" });
    expect(generationPollOf({ status: "failed" })).toEqual({ kind: "failed" });
    expect(generationPollOf({ status: "processing" })).toEqual({ kind: "pending" });
    expect(generationPollOf(null)).toEqual({ kind: "pending" });
  });

  it("generation submits: immediate success, a task to poll, or null", () => {
    expect(generationSubmitOf({ status: "succeeded", url: "https://x/a.png" })).toEqual({
      kind: "done",
      url: "https://x/a.png",
    });
    expect(generationSubmitOf({ taskId: "t1" })).toEqual({ kind: "task", taskId: "t1" });
    expect(generationSubmitOf({})).toBeNull();
  });

  it("session renders prepend and cap", () => {
    const old: WallpaperRender[] = [{ url: "old", presetKey: PHONE.key, width: 1, height: 1 }];
    const fresh: WallpaperRender[] = [{ url: "new", presetKey: PHONE.key, width: 1, height: 1 }];
    expect(prependRenders(old, fresh).map((r) => r.url)).toEqual(["new", "old"]);
    const big = Array.from({ length: 30 }, (_, i) => ({ url: `u${i}`, presetKey: PHONE.key, width: 1, height: 1 }));
    expect(prependRenders([], big)).toHaveLength(24);
  });

  it("preset lookup falls back to the first preset, never undefined", () => {
    expect(wallpaperPresetByKeyIn(WALLPAPER_PRESETS, "nope")).toBe(PHONE);
    expect(wallpaperPresetByKeyIn(WALLPAPER_PRESETS, DESKTOP.key)).toBe(DESKTOP);
  });
});
