import { describe, it, expect } from "vitest";
import { estimateKeyColor, chromaKeyAlpha, MATTING_TIERS, tierLabel } from "./photo-matting";
import {
  ortScriptUrls,
  rvmModelUrls,
  ORT_LOCAL_BASE,
  ORT_ORIGIN_BASE,
  ORT_CDN_BASE,
  RVM_LOCAL_BASE,
  RVM_ORIGIN_BASE,
  RVM_CDN_BASE,
  RVM_MODEL_FILE,
} from "./stream-kit/rvm-engine";

/** 4x4 image: green corners/background, red subject block in the middle. */
function fixture(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) { px[i * 4] = 0; px[i * 4 + 1] = 200; px[i * 4 + 2] = 0; px[i * 4 + 3] = 255; }
  for (const idx of [5, 6, 9, 10]) { px[idx * 4] = 220; px[idx * 4 + 1] = 30; px[idx * 4 + 2] = 30; }
  return px;
}

describe("photo-matting basic color-key fallback (pure)", () => {
  it("estimates the key color from the corners", () => {
    expect(estimateKeyColor(fixture(), 4, 4)).toEqual([0, 200, 0]);
  });
  it("keys the background out and keeps the subject, with a soft band between", () => {
    const alpha = chromaKeyAlpha(fixture(), 4, 4, 0.5);
    expect(alpha[0]).toBe(0);   // corner = pure key color
    expect(alpha[5]).toBe(1);   // red subject, far from green
    expect(alpha[15]).toBe(0);
  });
  it("higher aggressiveness keys more", () => {
    const px = fixture();
    // A near-green edge pixel at index 1.
    px[1 * 4] = 40; px[1 * 4 + 1] = 190; px[1 * 4 + 2] = 40;
    const gentle = chromaKeyAlpha(px, 4, 4, 0);
    const strong = chromaKeyAlpha(px, 4, 4, 1);
    expect(strong[1]!).toBeLessThan(gentle[1]!);
  });
  it("quality tiers are labeled truthfully — the heuristic is Basic, never AI", () => {
    expect(MATTING_TIERS.map((t) => t.id)).toEqual(["pro", "basic"]);
    expect(tierLabel("basic")).toBe("Basic color-key");
    expect(MATTING_TIERS.find((t) => t.id === "basic")!.blurb).not.toMatch(/\bAI\b/);
    expect(MATTING_TIERS.find((t) => t.id === "pro")!.blurb).toContain("matting model");
  });
});

describe("rvm asset urls (the still-photo path's Pro engine)", () => {
  // This pin moved here from background-changer.test.ts when the
  // heavy engine left the Go Live studio path (Oct 18, 2026): the
  // still-photo matting path is the engine's remaining consumer,
  // so its vendored-first asset discipline is pinned with it.
  it("are vendored-first for both the runtime and the model", () => {
    expect(ortScriptUrls()[0]).toBe(`${ORT_LOCAL_BASE}/ort.all.min.js`);
    expect(rvmModelUrls()[0]).toBe(`${RVM_LOCAL_BASE}/rvm_mobilenetv3_fp32.onnx`);
  });

  it("fallback order is R2 bucket → shipped same-origin copy → third-party CDN (S27-18)", () => {
    expect(ortScriptUrls()).toEqual([
      `${ORT_LOCAL_BASE}/ort.all.min.js`,
      `${ORT_ORIGIN_BASE}/ort.all.min.js`,
      `${ORT_CDN_BASE}/ort.all.min.js`,
    ]);
    expect(rvmModelUrls()).toEqual([
      `${RVM_LOCAL_BASE}/${RVM_MODEL_FILE}`,
      `${RVM_ORIGIN_BASE}/${RVM_MODEL_FILE}`,
      `${RVM_CDN_BASE}/${RVM_MODEL_FILE}`,
    ]);
    /* The middle step is the TRUE origin base: a same-origin path
       hanging off BASE_URL, not another remote host. */
    expect(ORT_ORIGIN_BASE).toBe(`${import.meta.env.BASE_URL}engines/onnxruntime`);
    expect(RVM_ORIGIN_BASE).toBe(`${import.meta.env.BASE_URL}engines/rvm`);
    expect(ORT_ORIGIN_BASE.startsWith("http")).toBe(false);
  });
});
