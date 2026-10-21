import { describe, it, expect } from "vitest";
import {
  buildDevelopFilter, buildOutputFilter, buildRenderArgs, clampDevelop,
  normalizeOutputSpecs, runBatchLookSync,
} from "../photo-render";

describe("photo-render develop filter", () => {
  it("identity recipe renders no filter", () => {
    expect(buildDevelopFilter({})).toBe("");
    expect(buildDevelopFilter(null)).toBe("");
  });
  it("maps sliders deterministically: crop → rotate → eq → colorbalance → hue", () => {
    const vf = buildDevelopFilter({
      brightness: 20, contrast: 10, saturation: -20, exposure: 1,
      temperature: 100, hue: 30, lightness: 0, rotateDeg: 5,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    });
    expect(vf.startsWith("crop=iw*0.8:ih*0.8:iw*0.1:ih*0.1,rotate=")).toBe(true);
    expect(vf).toContain("eq=brightness=0.2:contrast=1.1:saturation=0.8:gamma=0.707");
    expect(vf).toContain("colorbalance=rs=0.5:gs=0.25:bs=-0.5");
    expect(vf.endsWith("hue=h=30")).toBe(true);
  });
  it("clamps out-of-range values", () => {
    const d = clampDevelop({ exposure: 99, saturation: -500 });
    expect(d.exposure).toBe(2); expect(d.saturation).toBe(-100);
  });
});

describe("photo-render multi-output specs", () => {
  it("defaults to wide/vertical/square set", () => {
    const specs = normalizeOutputSpecs(undefined)!;
    expect(specs.map((s) => s.id)).toEqual(["wide-png", "vertical-png", "square-jpg"]);
  });
  it("rejects bad formats and empty lists, clamps sizes", () => {
    expect(normalizeOutputSpecs([{ format: "gif", width: 10, height: 10 }])).toBeNull();
    expect(normalizeOutputSpecs([])).toBeNull();
    expect(normalizeOutputSpecs([{ format: "png", width: 99999, height: 100 }])![0]!.width).toBe(4096);
  });
  it("output filter letterboxes (scale+pad), never stretches", () => {
    const vf = buildOutputFilter({}, { id: "x", format: "png", width: 1920, height: 1080, watermark: false });
    expect(vf).toBe("scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black");
  });
  it("watermarked render overlays the stamp; unstamped stays a plain -vf render", () => {
    const spec = { id: "x", format: "png" as const, width: 100, height: 100, watermark: true };
    const args = buildRenderArgs({ inputPath: "in.png", outputPath: "out.png", spec, watermarkPath: "/wm.webp" });
    expect(args).toContain("-filter_complex");
    expect(args.join(" ")).toContain("overlay=W-w-24:H-h-24");
    const plain = buildRenderArgs({ inputPath: "in.png", outputPath: "out.png", spec: { ...spec, watermark: false } });
    expect(plain).toContain("-vf");
    expect(plain.join(" ")).not.toContain("overlay");
  });
});

describe("batch look-sync per-photo outcomes", () => {
  it("reports each photo's outcome in input order; one failure never fails or hides the batch", async () => {
    const outcome = await runBatchLookSync(
      ["https://x/1.jpg", "https://x/bad.jpg", "https://x/3.jpg"],
      { contrast: 20 },
      async (url, develop) => {
        expect(develop.contrast).toBe(20);
        if (url.includes("bad")) throw new Error("Could not download the photo (404).");
        return `https://cdn/out-${url.split("/").pop()}`;
      },
    );
    expect(outcome.succeeded).toBe(2);
    expect(outcome.failed).toBe(1);
    expect(outcome.results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(outcome.results[1]!.error).toContain("404");
    expect(outcome.results[0]!.url).toBe("https://cdn/out-1.jpg");
  });
});
