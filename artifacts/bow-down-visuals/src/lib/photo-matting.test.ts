import { describe, it, expect } from "vitest";
import { estimateKeyColor, chromaKeyAlpha, MATTING_TIERS, tierLabel } from "./photo-matting";

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
