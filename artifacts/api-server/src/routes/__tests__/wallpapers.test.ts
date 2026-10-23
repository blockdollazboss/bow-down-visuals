/**
 * Wallpapers / Screensavers — route pins over HTTP (express + mocked rails):
 *  - presets endpoint returns exactly the 10 presets with exact pixels;
 *  - render rejects unknown preset (400) and non-http source (400), free success;
 *  - screensaver rejects phone preset (400) and 402s when broke, charges 400;
 *  - pack-download rejects empty urls (400) and streams a zip on success;
 *  - pure preset invariants (positive ints, phone portrait, desktop landscape)
 *    and ffmpeg arg builders.
 *  - branded-by-default (amendment, Oct 22): branded absent/true takes no
 *    charge path and applies logo + brandName drawtext overlays; clean
 *    (branded:false) charges 400, 402s when broke, refunds on failure;
 *    screensaver applies the same overlays at its flat 400 charge.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  ffmpegCalls: [] as string[][],
  ffmpegFail: false,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(u);
    req.userCredits = Number(req.headers["x-test-credits"] ?? 10000);
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 9600),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (name: string) => `supabase://generated-clips/${name}`),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://cdn.example/${ref}`),
}));

vi.mock("../../lib/save-generation", () => ({
  saveGeneration: vi.fn(async () => undefined),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    execFile: (file: string, args: string[], opts: unknown, cb?: unknown) => {
      const callback = (typeof opts === "function" ? opts : cb) as (
        err: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      if (file === "ffmpeg") {
        h.ffmpegCalls.push([...args]);
        if (h.ffmpegFail) {
          callback(new Error("ffmpeg boom"), "", "");
          return;
        }
        writeFileSync(args[args.length - 1]!, Buffer.from("fake-output"));
        callback(null, "", "");
        return;
      }
      callback(new Error(`unexpected execFile: ${file}`), "", "");
    },
  };
});

import wallpapersRouter, {
  buildWallpaperFfmpegArgs,
  buildScreensaverFfmpegArgs,
  buildWallpaperScaleFilter,
  buildDrawtextFilter,
  buildLogoScaleFilter,
  escapeDrawtextText,
  resolveBrandFontFile,
  BRAND_FONT_CANDIDATES,
  sanitizePackName,
  renderSchema,
  screensaverSchema,
  SCREENSAVER_RENDER_COST,
  CLEAN_RENDER_COST,
} from "../wallpapers";
import { WALLPAPER_PRESETS, presetByKey } from "../../lib/wallpaper-presets";
import { chargeCredits, refundCredits } from "../../lib/credits";
import { saveGeneration } from "../../lib/save-generation";

const EXPECTED: Array<[string, string, string, number, number]> = [
  ["phone-iphone-promax", "phone", "iPhone Pro Max", 1320, 2868],
  ["phone-iphone", "phone", "iPhone", 1179, 2556],
  ["phone-android-flagship", "phone", "Android Flagship", 1440, 3120],
  ["phone-android", "phone", "Android", 1080, 2400],
  ["tablet-ipad-pro", "tablet", "iPad Pro", 2048, 2732],
  ["tablet-ipad", "tablet", "iPad", 1640, 2360],
  ["desktop-fhd", "desktop", "Desktop Full HD", 1920, 1080],
  ["desktop-qhd", "desktop", "Desktop QHD", 2560, 1440],
  ["desktop-4k", "desktop", "Desktop 4K", 3840, 2160],
  ["desktop-ultrawide", "desktop", "Ultrawide", 3440, 1440],
];

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(wallpapersRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal(
    "fetch",
    async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.ffmpegCalls.length = 0;
  h.ffmpegFail = false;
  vi.clearAllMocks();
});

async function call(method: string, path: string, body?: unknown, credits?: number) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": "user-1",
      ...(credits !== undefined ? { "x-test-credits": String(credits) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // binary (zip) responses land here
  }
  return { status: r.status, headers: r.headers, json, text };
}

describe("wallpaper presets (pure)", () => {
  it("has exactly the 10 presets with exact pixel dimensions", () => {
    expect(WALLPAPER_PRESETS).toHaveLength(10);
    for (const [key, kind, label, width, height] of EXPECTED) {
      const p = presetByKey(key);
      expect(p, key).toBeTruthy();
      expect(p).toEqual({ key, kind, label, width, height });
    }
    expect(presetByKey("nope")).toBeUndefined();
  });

  it("every preset has positive integer dimensions; phone portrait, desktop landscape", () => {
    for (const p of WALLPAPER_PRESETS) {
      expect(Number.isInteger(p.width)).toBe(true);
      expect(Number.isInteger(p.height)).toBe(true);
      expect(p.width).toBeGreaterThan(0);
      expect(p.height).toBeGreaterThan(0);
      if (p.kind === "phone") expect(p.height).toBeGreaterThan(p.width);
      if (p.kind === "desktop") expect(p.width).toBeGreaterThan(p.height);
    }
  });

  it("ffmpeg arg builders produce exact scale/crop and screensaver loop args", () => {
    const preset = presetByKey("desktop-fhd")!;
    expect(buildWallpaperScaleFilter(preset)).toBe(
      "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080",
    );
    const args = buildWallpaperFfmpegArgs({ inputPath: "in.png", outputPath: "out.png", preset });
    expect(args).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    const withLogo = buildWallpaperFfmpegArgs({ inputPath: "in.png", logoPath: "logo.png", outputPath: "out.png", preset });
    // logo width = 16% of 1920 = 307 (rounded), margin = 6% of 1080 = 65 (rounded)
    expect(withLogo.join(" ")).toContain("scale=307:-1");
    expect(withLogo.join(" ")).toContain("overlay=(W-w)/2:H-h-65");
    const ss = buildScreensaverFfmpegArgs({ inputPath: "in.mp4", outputPath: "out.mp4", preset, seconds: 60 });
    expect(ss).toContain("-stream_loop");
    expect(ss).toContain("-an");
    expect(ss).toContain("libx264");
    expect(ss).toContain("yuv420p");
    expect(ss[ss.indexOf("-t") + 1]).toBe("60");
    expect(SCREENSAVER_RENDER_COST).toBe(400);
    expect(sanitizePackName("My Pack!")).toBe("My_Pack");
    expect(sanitizePackName(undefined)).toBe("wallpaper-pack");
  });

  it("branding helpers: drawtext escaping, font candidates, no-font skip", () => {
    expect(CLEAN_RENDER_COST).toBe(400);
    expect(BRAND_FONT_CANDIDATES).toEqual([
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    ]);
    expect(escapeDrawtextText("a:b'c%d\\e")).toBe("a\\:b\\'c\\%d\\\\e");
    expect(resolveBrandFontFile(["/nope.ttf", "/yes.ttf"], (p) => p === "/yes.ttf")).toBe("/yes.ttf");
    expect(resolveBrandFontFile(["/nope.ttf"], () => false)).toBeNull();
    const preset = presetByKey("desktop-fhd")!;
    const dt = buildDrawtextFilter({ text: "My: Brand", fontFile: "/f.ttf", preset, bottomOffset: 65 });
    expect(dt).toContain("drawtext=fontfile=/f.ttf");
    expect(dt).toContain("text='My\\: Brand'");
    expect(dt).toContain("fontcolor=white");
    expect(dt).toContain("bordercolor=black");
    expect(dt).toContain("x=(w-text_w)/2:y=h-text_h-65");
    // brandName without a font file → text overlay silently skipped
    const noFont = buildWallpaperFfmpegArgs({ inputPath: "in.png", outputPath: "out.png", preset, brandName: "My Brand", fontFile: null });
    expect(noFont.join(" ")).not.toContain("drawtext");
    // brandName with a font file → drawtext present, even without a logo
    const withText = buildWallpaperFfmpegArgs({ inputPath: "in.png", outputPath: "out.png", preset, brandName: "My Brand", fontFile: "/f.ttf" });
    expect(withText.join(" ")).toContain("drawtext");
    // logo + text → overlay lifted, drawtext after it
    const both = buildWallpaperFfmpegArgs({ inputPath: "in.png", logoPath: "logo.png", outputPath: "out.png", preset, brandName: "My Brand", fontFile: "/f.ttf" });
    expect(both.join(" ")).toContain("overlay=(W-w)/2:H-h-119");
    expect(both.join(" ")).toContain("drawtext");
    // screensaver logo + text uses the same overlay/drawtext chain
    const ssBoth = buildScreensaverFfmpegArgs({ inputPath: "in.mp4", outputPath: "out.mp4", preset, seconds: 45, logoPath: "logo.png", brandName: "My Brand", fontFile: "/f.ttf" });
    expect(ssBoth.join(" ")).toContain("drawtext");
    expect(ssBoth.join(" ")).toContain("overlay=");
    expect(ssBoth).toContain("-stream_loop");
  });

  it("logo rule (amendment 2): intact artwork only — width-only scale, NO crop on the logo stream; tall logo → bounding-box decrease", () => {
    const preset = presetByKey("desktop-fhd")!; // 1920x1080; logoW = 307, max logo height = floor(1080*0.30) = 324
    const logoSegment = (args: string[]): string => {
      const joined = args.join(" ");
      const seg = joined.split(";").find((x) => x.startsWith("[1:v]"));
      expect(seg, joined).toBeTruthy();
      return seg!;
    };

    // Direct helper pins
    expect(buildLogoScaleFilter(preset)).toBe("scale=307:-1");
    expect(buildLogoScaleFilter(preset, { width: 1000, height: 500 })).toBe("scale=307:-1");
    expect(buildLogoScaleFilter(preset, { width: 400, height: 2000 })).toBe(
      "scale=307:324:force_original_aspect_ratio=decrease",
    );

    // Normal logo: aspect-preserving width-only scale; the logo segment
    // contains NO crop (the only crop in the chain is on the [0:v]
    // source canvas stream, never on [1:v]).
    const normal = buildWallpaperFfmpegArgs({
      inputPath: "in.png", logoPath: "logo.png", outputPath: "out.png", preset,
      logoDimensions: { width: 1000, height: 500 },
    });
    const normalSeg = logoSegment(normal);
    expect(normalSeg).toContain("scale=307:-1");
    expect(normalSeg).not.toContain("crop");
    expect(normalSeg).not.toContain("force_original_aspect_ratio=increase");

    // Tall logo (would render 1535px tall at 307 wide, > 30% of 1080):
    // bounding-box decrease path — whole logo visible, still NO crop.
    const tall = buildWallpaperFfmpegArgs({
      inputPath: "in.png", logoPath: "logo.png", outputPath: "out.png", preset,
      logoDimensions: { width: 400, height: 2000 },
    });
    const tallSeg = logoSegment(tall);
    expect(tallSeg).toContain("scale=307:324:force_original_aspect_ratio=decrease");
    expect(tallSeg).not.toContain("crop");
    expect(tallSeg).not.toContain(":-1");

    // Screensaver follows the same rule on both paths.
    const ssNormal = buildScreensaverFfmpegArgs({
      inputPath: "in.mp4", outputPath: "out.mp4", preset, seconds: 30,
      logoPath: "logo.png", logoDimensions: { width: 1000, height: 500 },
    });
    expect(logoSegment(ssNormal)).toContain("scale=307:-1");
    expect(logoSegment(ssNormal)).not.toContain("crop");
    const ssTall = buildScreensaverFfmpegArgs({
      inputPath: "in.mp4", outputPath: "out.mp4", preset, seconds: 30,
      logoPath: "logo.png", brandName: "My Brand", fontFile: "/f.ttf",
      logoDimensions: { width: 400, height: 2000 },
    });
    expect(logoSegment(ssTall)).toContain("scale=307:324:force_original_aspect_ratio=decrease");
    expect(logoSegment(ssTall)).not.toContain("crop");
  });
});

describe("wallpapers routes (HTTP)", () => {
  it("GET /wallpapers/presets returns exactly the 10 presets", async () => {
    const { status, json } = await call("GET", "/wallpapers/presets");
    expect(status).toBe(200);
    expect(json.presets).toHaveLength(10);
    for (const [key, , , width, height] of EXPECTED) {
      const p = json.presets.find((x: any) => x.key === key);
      expect(p, key).toBeTruthy();
      expect(p.width).toBe(width);
      expect(p.height).toBe(height);
    }
  });

  it("render rejects unknown preset with 400", async () => {
    const { status } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "does-not-exist",
    });
    expect(status).toBe(400);
    expect(h.ffmpegCalls).toHaveLength(0);
  });

  it("render rejects non-http source with 400", async () => {
    for (const sourceUrl of ["ftp://files.example/a.png", "file:///etc/passwd", "not-a-url"]) {
      const { status } = await call("POST", "/wallpapers/render", {
        sourceUrl,
        presetKey: "desktop-fhd",
      });
      expect(status, sourceUrl).toBe(400);
    }
    expect(h.ffmpegCalls).toHaveLength(0);
  });

  it("render succeeds free: exact crop, upload, history at 0 credits", async () => {
    const { status, json } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "phone-iphone",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ presetKey: "phone-iphone", width: 1179, height: 2556 });
    expect(json.url).toContain("https://cdn.example/");
    expect(h.ffmpegCalls).toHaveLength(1);
    expect(h.ffmpegCalls[0]!.join(" ")).toContain(
      "scale=1179:2556:force_original_aspect_ratio=increase,crop=1179:2556",
    );
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    expect(vi.mocked(saveGeneration)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "wallpaper", creditsSpent: 0, userId: "user-1" }),
    );
  });

  it("screensaver-render rejects a phone preset with 400", async () => {
    const { status } = await call("POST", "/wallpapers/screensaver-render", {
      videoUrl: "https://files.example/v.mp4",
      presetKey: "phone-iphone",
    });
    expect(status).toBe(400);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });

  it("screensaver-render returns 402 when credits are insufficient", async () => {
    const { status, json } = await call(
      "POST",
      "/wallpapers/screensaver-render",
      { videoUrl: "https://files.example/v.mp4", presetKey: "desktop-fhd" },
      100,
    );
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    expect(h.ffmpegCalls).toHaveLength(0);
  });

  it("screensaver-render succeeds: charges 400, loops, no audio", async () => {
    const { status, json } = await call("POST", "/wallpapers/screensaver-render", {
      videoUrl: "https://files.example/v.mp4",
      presetKey: "desktop-fhd",
      seconds: 30,
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ presetKey: "desktop-fhd", width: 1920, height: 1080, seconds: 30, creditCost: 400 });
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledWith(
      "user-1",
      400,
      expect.objectContaining({ action: "Screensaver Loop Render" }),
    );
    const args = h.ffmpegCalls[0]!;
    expect(args).toContain("-stream_loop");
    expect(args).toContain("-an");
    expect(vi.mocked(saveGeneration)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "screensaver", creditsSpent: 400 }),
    );
  });

  it("screensaver-render refunds on ffmpeg failure and answers 502", async () => {
    h.ffmpegFail = true;
    const { status } = await call("POST", "/wallpapers/screensaver-render", {
      videoUrl: "https://files.example/v.mp4",
      presetKey: "desktop-fhd",
    });
    expect(status).toBe(502);
    expect(vi.mocked(refundCredits)).toHaveBeenCalledWith(
      "user-1",
      400,
      expect.objectContaining({ action: expect.stringContaining("Refund") }),
    );
  });

  it("render defaults to branded: no charge when branded is absent, branded:true + creditCost:0", async () => {
    const { status, json } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "desktop-fhd",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ branded: true, creditCost: 0 });
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    expect(vi.mocked(saveGeneration)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "wallpaper", creditsSpent: 0 }),
    );
  });

  it("render branded:true explicitly also takes no charge path", async () => {
    const { status, json } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "desktop-fhd",
      branded: true,
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ branded: true, creditCost: 0 });
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });

  it("render branded with logo + brandName overlays logo and drawtext, still free", async () => {
    const { status, json } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "desktop-fhd",
      logoUrl: "https://files.example/logo.png",
      brandName: "My Brand",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ branded: true, creditCost: 0 });
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    const joined = h.ffmpegCalls[0]!.join(" ");
    expect(joined).toContain("overlay=");
    // drawtext only when a candidate font exists on this box; the first
    // candidate exists in this environment, so it must be present here.
    expect(joined).toContain("drawtext");
    expect(joined).toContain("My Brand");
    // Logo rule at route level (probe fails open in tests → width-only):
    // the [1:v] logo segment is an aspect-preserving scale with NO crop.
    const logoSeg = joined.split(";").find((x) => x.startsWith("[1:v]"));
    expect(logoSeg).toBeTruthy();
    expect(logoSeg).toContain("scale=307:-1");
    expect(logoSeg).not.toContain("crop");
  });

  it("clean render (branded:false) returns 402 when credits are insufficient", async () => {
    const { status, json } = await call(
      "POST",
      "/wallpapers/render",
      { sourceUrl: "https://files.example/a.png", presetKey: "desktop-fhd", branded: false },
      100,
    );
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    expect(h.ffmpegCalls).toHaveLength(0);
  });

  it("clean render with unknown preset still 400, before any charge", async () => {
    const { status } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "does-not-exist",
      branded: false,
    });
    expect(status).toBe(400);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });

  it("clean render succeeds: charges 400, no branding overlays, history at 400", async () => {
    const { status, json } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "desktop-fhd",
      branded: false,
      logoUrl: "https://files.example/logo.png",
      brandName: "My Brand",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ branded: false, creditCost: 400 });
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledWith(
      "user-1",
      400,
      expect.objectContaining({ action: "Wallpaper Clean Render" }),
    );
    const joined = h.ffmpegCalls[0]!.join(" ");
    expect(joined).not.toContain("drawtext");
    expect(joined).not.toContain("overlay=");
    expect(vi.mocked(saveGeneration)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "wallpaper", creditsSpent: 400 }),
    );
  });

  it("clean render refunds the 400 on ffmpeg failure and answers 502", async () => {
    h.ffmpegFail = true;
    const { status } = await call("POST", "/wallpapers/render", {
      sourceUrl: "https://files.example/a.png",
      presetKey: "desktop-fhd",
      branded: false,
    });
    expect(status).toBe(502);
    expect(vi.mocked(refundCredits)).toHaveBeenCalledWith(
      "user-1",
      400,
      expect.objectContaining({ action: expect.stringContaining("Wallpaper Clean Render") }),
    );
  });

  it("screensaver branded with logo + brandName overlays both, charge stays flat 400", async () => {
    const { status, json } = await call("POST", "/wallpapers/screensaver-render", {
      videoUrl: "https://files.example/v.mp4",
      presetKey: "desktop-fhd",
      logoUrl: "https://files.example/logo.png",
      brandName: "My Brand",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ branded: true, creditCost: 400 });
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledWith(
      "user-1",
      400,
      expect.objectContaining({ action: "Screensaver Loop Render" }),
    );
    const joined = h.ffmpegCalls[0]!.join(" ");
    expect(joined).toContain("overlay=");
    expect(joined).toContain("drawtext");
  });

  it("screensaver branded:false adds no clean charge and no overlays", async () => {
    const { status, json } = await call("POST", "/wallpapers/screensaver-render", {
      videoUrl: "https://files.example/v.mp4",
      presetKey: "desktop-fhd",
      branded: false,
      logoUrl: "https://files.example/logo.png",
      brandName: "My Brand",
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({ branded: false, creditCost: 400 });
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledTimes(1);
    const joined = h.ffmpegCalls[0]!.join(" ");
    expect(joined).not.toContain("drawtext");
    expect(joined).not.toContain("overlay=");
  });

  it("pack-download rejects an empty urls array with 400", async () => {
    const { status } = await call("POST", "/wallpapers/pack-download", { urls: [] });
    expect(status).toBe(400);
  });

  it("pack-download rejects non-http urls with 400", async () => {
    const { status } = await call("POST", "/wallpapers/pack-download", {
      urls: ["ftp://files.example/a.png"],
    });
    expect(status).toBe(400);
  });

  it("pack-download streams a zip with attachment headers", async () => {
    const r = await realFetch(`${baseUrl}/wallpapers/pack-download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": "user-1" },
      body: JSON.stringify({ urls: ["https://files.example/a.png", "https://files.example/b.png"], name: "My Pack" }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/zip");
    expect(r.headers.get("content-disposition")).toContain("My_Pack.zip");
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    // ZIP magic
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });
});

/* Stack-28 item 13 — King's Set integration: the desk's starter-pack
   assets ship as site-relative paths (FE lib/kings-set.ts), which both
   rails' http(s)-only schemas rejected with 400. The desk now
   absolutifies at selection time (absoluteKingsSetUrl, pinned in the
   FE kings-set.test.ts); this block proves the resulting desk-shaped
   URLs pass the rail schemas and the HTTP routes, while the raw
   relative forms still fail — the rails themselves did not loosen. */
describe("King's Set desk-shaped URLs vs the rail schemas (Stack-28 item 13)", () => {
  const ORIGIN = "https://bowdownvisuals.com";
  // The set's exact paths, mirrored from FE lib/kings-set.ts.
  const PIECES = [
    { still: "/wallpapers/kings-set-plaza-phone.webp", loop: "/wallpapers/kings-set-plaza-loop.mp4", presetKey: "phone-iphone" },
    { still: "/wallpapers/kings-set-throne-phone.webp", loop: "/wallpapers/kings-set-throne-loop.mp4", presetKey: "phone-iphone" },
    { still: "/wallpapers/kings-set-stage-desktop.webp", loop: "/wallpapers/kings-set-stage-loop.mp4", presetKey: "desktop-fhd" },
  ] as const;

  it("renderSchema + screensaverSchema ACCEPT every absolutified King's Set URL", () => {
    for (const p of PIECES) {
      const render = renderSchema.safeParse({
        sourceUrl: `${ORIGIN}${p.still}`,
        presetKey: p.presetKey,
      });
      expect(render.success, `render ${p.still}`).toBe(true);
      const screensaver = screensaverSchema.safeParse({
        videoUrl: `${ORIGIN}${p.loop}`,
        presetKey: "desktop-fhd",
      });
      expect(screensaver.success, `screensaver ${p.loop}`).toBe(true);
    }
  });

  it("the same URLs in their raw relative form still FAIL both schemas", () => {
    for (const p of PIECES) {
      expect(
        renderSchema.safeParse({ sourceUrl: p.still, presetKey: p.presetKey }).success,
        `relative render ${p.still}`,
      ).toBe(false);
      expect(
        screensaverSchema.safeParse({ videoUrl: p.loop, presetKey: "desktop-fhd" }).success,
        `relative screensaver ${p.loop}`,
      ).toBe(false);
    }
  });

  it("HTTP: an absolutified King's Set still renders (200) and a loop screensaver-renders (200)", async () => {
    const render = await call("POST", "/wallpapers/render", {
      sourceUrl: `${ORIGIN}${PIECES[0].still}`,
      presetKey: PIECES[0].presetKey,
    });
    expect(render.status).toBe(200);
    const screensaver = await call("POST", "/wallpapers/screensaver-render", {
      videoUrl: `${ORIGIN}${PIECES[2].loop}`,
      presetKey: "desktop-fhd",
    });
    expect(screensaver.status).toBe(200);
  });
});

/* Stack-28 item 15 — the API side of the desk price pin: the FE desk's
   derived figures must land on THIS suite's server constants. The FE
   suite (wallpapers-prices.test.ts) derives the constants from these
   source files; here the live imported constants are compared against
   the FE price module's derivation sources (the credit-cost registry
   it reads), so both suites fail if either side drifts. */
describe("desk price derivations land on the server constants (Stack-28 item 15)", () => {
  it("FE registry + price module derive exactly SCREENSAVER_RENDER_COST / CLEAN_RENDER_COST", async () => {
    const { readFileSync } = await import("node:fs");
    const fe = (rel: string) =>
      readFileSync(new URL(`../../../../bow-down-visuals/src/${rel}`, import.meta.url), "utf8");
    const registry = fe("lib/credit-costs.ts");
    const prices = fe("lib/wallpapers-prices.ts");
    const deskSrc = fe("components/wallpapers/WallpapersDesk.tsx");

    // Registry entries the FE derivations read:
    expect(registry).toContain('"/api/wallpapers/screensaver-render": { cost: 400');
    expect(registry).toContain('"/api/generate-runway-clip": { cost: 400');
    expect(registry).toContain('"/api/export-final-video": { cost: 400');
    expect(registry).toContain('"/api/wallpapers/render": { cost: 0');

    // Those registry figures equal this suite's imported rail constants:
    expect(SCREENSAVER_RENDER_COST).toBe(400);
    expect(CLEAN_RENDER_COST).toBe(400);

    // The price module derives (never hardcodes) each desk figure:
    expect(prices).toContain('getCreditCost("/api/wallpapers/screensaver-render")');
    expect(prices).toContain('getCreditCost("/api/generate-runway-clip")');
    expect(prices).toContain('getCreditCost("/api/export-final-video")');
    expect(prices).toContain("WALLPAPER_CLEAN_RENDER_COST * 2");

    // And the desk renders/quotes only through those constants:
    expect(deskSrc).not.toMatch(/— \d+ Visual Bucs/);
    expect(deskSrc).not.toMatch(/const (GENERATE_COST|CLEAN_RENDER_COST)\s*=/);
    expect(deskSrc).toContain("WALLPAPER_CLEAN_PACK_COST");
  });
});
