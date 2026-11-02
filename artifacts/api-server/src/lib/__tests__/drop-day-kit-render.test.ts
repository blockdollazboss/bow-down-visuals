/**
 * drop-day-kit-render.test.ts — Drop Day Kit (#169 remainder).
 *
 * Pins the banner render contract:
 * - the layout for each of the four spec sizes keeps the scrim and
 *   both text lines inside the canvas, headline above subline;
 * - the ffmpeg filter cover-fits the release's own artwork to the
 *   banner's EXACT spec size and burns the banner's headline/subline
 *   verbatim (drawtext-escaped — a colon or quote in a title can
 *   never break the filter or change the words);
 * - the orchestrator fills imageRef ONLY on a proven render: any
 *   failure (artwork unreachable, compose failed, empty output,
 *   upload failed) leaves that banner a spec with imageRef null,
 *   and the input payload is never mutated.
 */
import { describe, expect, it, vi } from "vitest";
import { assembleKit, type KitRelease } from "../drop-day-kit";
import {
  buildKitBannerFilter,
  clampKitBannerText,
  escapeKitDrawtext,
  kitBannerLayout,
  kitBannerObjectName,
  renderKitBanners,
  type KitBannerRenderDeps,
} from "../drop-day-kit-render";

const FULL: KitRelease = {
  id: "rel-1",
  userId: "user-1",
  title: "Midnight Run",
  artistName: "Thy Cheat Code",
  releaseDate: "2026-11-15",
  audioUrl: "https://cdn.example/track.mp3",
  artworkUrl: "https://cdn.example/cover.jpg",
  status: "packaged",
  presaveSlug: "midnight-run",
};

const SIZES = [
  { size: "profile", width: 1584, height: 396 },
  { size: "wide", width: 1920, height: 1080 },
  { size: "post", width: 1080, height: 1080 },
  { size: "story", width: 1080, height: 1920 },
] as const;

describe("kitBannerLayout — the text band fits every spec size", () => {
  it("scrim and text lines stay inside the canvas, headline above subline", () => {
    for (const s of SIZES) {
      const layout = kitBannerLayout({ size: s.size });
      expect(layout.scrimHeight).toBeGreaterThan(0);
      expect(layout.scrimHeight).toBeLessThan(s.height);
      /* Both text lines sit ON the scrim (their from-bottom offsets
         are within the scrim's height)… */
      expect(layout.headlineFromBottom).toBeLessThan(layout.scrimHeight);
      expect(layout.sublineFromBottom).toBeLessThan(layout.scrimHeight);
      /* …each line's full height fits above the canvas bottom… */
      expect(layout.headlineFromBottom).toBeGreaterThanOrEqual(layout.headlineSize);
      expect(layout.sublineFromBottom).toBeGreaterThanOrEqual(layout.sublineSize);
      /* …and the headline's bottom edge clears the subline's top. */
      expect(layout.sublineFromBottom).toBeLessThanOrEqual(layout.headlineFromBottom - layout.headlineSize);
      expect(layout.headlineSize).toBeGreaterThan(0);
      expect(layout.sublineSize).toBeGreaterThan(0);
      expect(layout.headlineMaxChars).toBeGreaterThan(0);
      expect(layout.sublineMaxChars).toBeGreaterThan(0);
    }
  });
});

describe("buildKitBannerFilter — the release's own art and words, exactly", () => {
  it("cover-fits to the banner's exact spec size and burns headline + subline", () => {
    const kit = assembleKit(FULL);
    for (const banner of kit.banners) {
      const filter = buildKitBannerFilter(banner, "/fonts/Test.ttf");
      expect(filter).toContain(`scale=${banner.width}:${banner.height}:force_original_aspect_ratio=increase`);
      expect(filter).toContain(`crop=${banner.width}:${banner.height}`);
      expect(filter).toContain("drawbox");
      expect(filter).toContain("0xE8B64C");
      expect(filter).toContain("text='Midnight Run'");
      expect(filter).toContain("text='Thy Cheat Code · 2026-11-15'");
      expect(filter).toContain("fontfile='/fonts/Test.ttf'");
    }
  });

  it("escapes drawtext specials so a title can never break the filter", () => {
    expect(escapeKitDrawtext("a:b")).toBe("a\\:b");
    expect(escapeKitDrawtext("it's")).toBe("it\\'s");
    expect(escapeKitDrawtext("100%")).toBe("100%%");
    expect(escapeKitDrawtext("a\\b")).toBe("a\\\\b");
    const kit = assembleKit({ ...FULL, title: "Live: At 100% — It's On" });
    const filter = buildKitBannerFilter(kit.banners[0]!, "/fonts/Test.ttf");
    expect(filter).toContain("Live\\: At 100%% — It\\'s On");
  });
});

describe("clampKitBannerText — long titles ellipsize, never overflow", () => {
  it("leaves short text untouched", () => {
    expect(clampKitBannerText("Midnight Run", 36)).toBe("Midnight Run");
  });

  it("cuts at a word boundary with an ellipsis within the cap", () => {
    const out = clampKitBannerText("A Very Long Release Title That Keeps Going", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain(" Go…");
  });
});

describe("kitBannerObjectName — deterministic per kit", () => {
  it("names the object by owner, release, and size", () => {
    expect(kitBannerObjectName(FULL, "post")).toBe("drop-day-kits/user-1/rel-1/banner-post.jpg");
  });
});

function fakeDeps(overrides: Partial<KitBannerRenderDeps> = {}): KitBannerRenderDeps & {
  uploads: Array<{ name: string; bytes: number }>;
} {
  const uploads: Array<{ name: string; bytes: number }> = [];
  return {
    uploads,
    downloadArtwork: vi.fn(async () => true),
    composeBanner: vi.fn(async () => {}),
    uploadBanner: vi.fn(async (name: string, buffer: Buffer) => {
      uploads.push({ name, bytes: buffer.length });
      return `r2://generated-clips/${name}`;
    }),
    readFileBuffer: vi.fn(async () => Buffer.from("jpeg-bytes")),
    makeWorkDir: vi.fn(async () => "/tmp/kit-test"),
    removeDir: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("renderKitBanners — imageRef only on a proven render", () => {
  it("renders all four banners and stores each ref under its deterministic name", async () => {
    const kit = assembleKit(FULL);
    const deps = fakeDeps();
    const out = await renderKitBanners(FULL, kit, deps);
    expect(out.banners.map((b) => b.imageRef)).toEqual([
      "r2://generated-clips/drop-day-kits/user-1/rel-1/banner-profile.jpg",
      "r2://generated-clips/drop-day-kits/user-1/rel-1/banner-wide.jpg",
      "r2://generated-clips/drop-day-kits/user-1/rel-1/banner-post.jpg",
      "r2://generated-clips/drop-day-kits/user-1/rel-1/banner-story.jpg",
    ]);
    expect(deps.uploads).toHaveLength(4);
    /* The rest of the kit is untouched, and the input never mutated. */
    expect(out.teaser).toEqual(kit.teaser);
    expect(out.countdown).toEqual(kit.countdown);
    expect(kit.banners.every((b) => b.imageRef === null)).toBe(true);
    expect(deps.removeDir).toHaveBeenCalled();
  });

  it("artwork unreachable: the kit comes back as specs, nothing composed", async () => {
    const kit = assembleKit(FULL);
    const deps = fakeDeps({ downloadArtwork: vi.fn(async () => false) });
    const out = await renderKitBanners(FULL, kit, deps);
    expect(out.banners.every((b) => b.imageRef === null)).toBe(true);
    expect(deps.composeBanner).not.toHaveBeenCalled();
    expect(deps.uploads).toHaveLength(0);
  });

  it("one compose failure leaves only that banner a spec", async () => {
    const kit = assembleKit(FULL);
    const deps = fakeDeps({
      composeBanner: vi.fn(async ({ banner }: { banner: { size: string } }) => {
        if (banner.size === "story") throw new Error("ffmpeg died");
      }),
    });
    const out = await renderKitBanners(FULL, kit, deps);
    expect(out.banners.find((b) => b.size === "story")!.imageRef).toBeNull();
    expect(out.banners.filter((b) => b.imageRef).map((b) => b.size)).toEqual(["profile", "wide", "post"]);
  });

  it("an empty compose output or a failed upload never earns a ref", async () => {
    const kit = assembleKit(FULL);
    const empty = fakeDeps({ readFileBuffer: vi.fn(async () => Buffer.alloc(0)) });
    const outEmpty = await renderKitBanners(FULL, kit, empty);
    expect(outEmpty.banners.every((b) => b.imageRef === null)).toBe(true);

    const failing = fakeDeps({
      uploadBanner: vi.fn(async () => {
        throw new Error("storage down");
      }),
    });
    const outFail = await renderKitBanners(FULL, kit, failing);
    expect(outFail.banners.every((b) => b.imageRef === null)).toBe(true);
  });

  it("a kit with no banners is returned untouched and downloads nothing", async () => {
    const kit = assembleKit({ ...FULL, artworkUrl: null });
    const deps = fakeDeps();
    const out = await renderKitBanners({ ...FULL, artworkUrl: null }, kit, deps);
    expect(out).toBe(kit);
    expect(deps.downloadArtwork).not.toHaveBeenCalled();
  });
});
