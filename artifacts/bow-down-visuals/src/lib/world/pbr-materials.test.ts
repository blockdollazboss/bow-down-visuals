/**
 * The World — procedural PBR tests (lib/world/pbr-materials).
 *
 * Overhaul board items 7/9/11/12: per-metre repeats, derived
 * normal/roughness/AO maps (vein-aware — not the colour map as its
 * own bump), seamless tiling proven on pixel data, and brushed
 * gold. The patterns here are synthetic stand-ins for the marble
 * sources: a cream field with a dark vein, and a black field with
 * a bright gold vein — the two polarities the real textures carry.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  MARBLE_METRES_PER_TILE,
  PBR_KIND_PARAMS,
  GOLD_ROUGHNESS_RANGE,
  repeatForSize,
  makeTileable,
  seamStepRatio,
  tileBlendMask,
  heightFromColour,
  normalFromHeight,
  derivePbrMaps,
  brushedMetalMaps,
  derivedPbrTextures,
  brushedGoldTextures,
} from "./pbr-materials";

const W = 64;
const H = 64;

function image(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y);
      const o = (y * W + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

/** Cream marble with a 2px dark vein at x = 32. */
const creamVein = image((x) => (x === 32 || x === 33 ? [88, 76, 62] : [240, 230, 200]));
/** Black marble with a 2px bright gold vein at x = 32. */
const blackVein = image((x) => (x === 32 || x === 33 ? [196, 158, 62] : [18, 16, 14]));
/** A hard sawtooth: 0 at the left edge, 255 at the right — the
 *  worst possible tile seam, with a known interior step (~4). */
const sawtooth = image((x) => {
  const v = Math.round((x / (W - 1)) * 255);
  return [v, v, v];
});

describe("repeatForSize (item 7)", () => {
  it("gives a 1 m lintel and a 28.8 m wall the same texel density", () => {
    const lintel = repeatForSize(1, 1, MARBLE_METRES_PER_TILE);
    const wall = repeatForSize(28.8, 6.5, MARBLE_METRES_PER_TILE);
    expect(lintel.x).toBeCloseTo(0.25);
    expect(wall.x).toBeCloseTo(7.2);
    // Density (tiles per metre) is identical — the whole point.
    expect(wall.x / 28.8).toBeCloseTo(lintel.x / 1);
    expect(wall.y / 6.5).toBeCloseTo(lintel.x / 1);
  });

  it("sizes the 28×30 m hall floor from its real dimensions", () => {
    const rep = repeatForSize(28, 30, MARBLE_METRES_PER_TILE);
    expect(rep.x).toBeCloseTo(7);
    expect(rep.y).toBeCloseTo(7.5);
  });

  it("never returns a degenerate repeat", () => {
    expect(repeatForSize(0, -3, MARBLE_METRES_PER_TILE).x).toBeGreaterThan(0);
    expect(repeatForSize(5, 5, 0).x).toBeGreaterThan(0);
  });
});

describe("makeTileable (item 11)", () => {
  it("the blend mask is exactly 1 at the border and exactly 0 at the centre", () => {
    expect(tileBlendMask(0, W)).toBeCloseTo(1);
    expect(tileBlendMask(W / 2, W)).toBeCloseTo(0);
  });

  it("kills the seam: a sawtooth's border step becomes an interior step", () => {
    // The raw sawtooth's seam jump (255) dwarfs its interior step (~4).
    expect(seamStepRatio(sawtooth, W, H)).toBeGreaterThan(10);
    const tiled = makeTileable(sawtooth, W, H);
    expect(seamStepRatio(tiled, W, H)).toBeLessThan(1.6);
  });

  it("leaves the tile centre untouched (the mask is 0 there)", () => {
    const tiled = makeTileable(sawtooth, W, H);
    const mid = (32 * W + 32) * 4;
    expect(tiled[mid]).toBe(sawtooth[mid]);
  });

  it("keeps a flat image flat", () => {
    const flat = image(() => [200, 180, 150]);
    const tiled = makeTileable(flat, W, H);
    for (let i = 0; i < tiled.length; i += 4) {
      expect(tiled[i]).toBe(200);
      expect(tiled[i + 1]).toBe(180);
      expect(tiled[i + 2]).toBe(150);
    }
  });
});

describe("heightFromColour — veins recess, either polarity (item 9)", () => {
  it("dark vein in cream marble sits below the field", () => {
    const h = heightFromColour(creamVein, W, H);
    const field = h[32 * W + 10]!;
    const vein = h[32 * W + 32]!;
    expect(vein).toBeLessThan(field - 0.2);
  });

  it("bright gold vein in black marble ALSO sits below the field", () => {
    const h = heightFromColour(blackVein, W, H);
    const field = h[32 * W + 10]!;
    const vein = h[32 * W + 32]!;
    expect(vein).toBeLessThan(field - 0.15);
  });

  it("a flat image gets a flat heightfield", () => {
    const h = heightFromColour(image(() => [120, 120, 120]), W, H);
    const first = h[0]!;
    for (const v of h) expect(v).toBeCloseTo(first, 5);
  });
});

describe("normalFromHeight (item 9)", () => {
  it("flat height gives the neutral tangent normal everywhere", () => {
    const flat = new Float32Array(W * H).fill(0.5);
    const n = normalFromHeight(flat, W, H, 2);
    for (let i = 0; i < n.length; i += 4) {
      expect(n[i]).toBe(128);
      expect(n[i + 1]).toBe(128);
      expect(n[i + 2]).toBe(255);
    }
  });

  it("a height ramp tilts the normal against the rise", () => {
    const ramp = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = x / W;
    const n = normalFromHeight(ramp, W, H, 2);
    const mid = (32 * W + 32) * 4;
    expect(n[mid]!).toBeLessThan(128); // rising in +x → normal leans −x
    expect(n[mid + 1]!).toBe(128); // no y slope → no y tilt
    expect(n[mid + 2]!).toBeGreaterThan(200);
  });
});

describe("derivePbrMaps (item 9)", () => {
  it("produces full-size normal/roughness/AO from the colour pixels", () => {
    const maps = derivePbrMaps(creamVein, W, H, "marble");
    expect(maps.normal.length).toBe(W * H * 4);
    expect(maps.roughness.length).toBe(W * H * 4);
    expect(maps.ao.length).toBe(W * H * 4);
    expect(maps.color.length).toBe(W * H * 4);
  });

  it("veins are rougher and more occluded than the polished field", () => {
    const maps = derivePbrMaps(creamVein, W, H, "marble");
    const field = (32 * W + 10) * 4;
    const vein = (32 * W + 32) * 4;
    expect(maps.roughness[vein]!).toBeGreaterThan(maps.roughness[field]! + 20);
    expect(maps.ao[vein]!).toBeLessThan(maps.ao[field]!);
  });

  it("the field roughness sits at the kind's encoded base", () => {
    const maps = derivePbrMaps(creamVein, W, H, "marble");
    const field = (32 * W + 10) * 4;
    const expected = PBR_KIND_PARAMS.marble.baseRoughness * 255;
    expect(Math.abs(maps.roughness[field]! - expected)).toBeLessThan(26);
  });

  it("derived maps inherit the tileability (their seam ratio stays low)", () => {
    // Height/normal derivation wraps, so a veined pattern's derived
    // maps must not reintroduce a border the colour pass removed.
    const maps = derivePbrMaps(creamVein, W, H, "marble");
    expect(seamStepRatio(maps.normal, W, H)).toBeLessThan(2.5);
    expect(seamStepRatio(maps.ao, W, H)).toBeLessThan(2.5);
  });

  it("the floor kind is polished; the rough kind is not", () => {
    expect(PBR_KIND_PARAMS["marble-floor"].baseRoughness).toBeLessThan(0.15);
    expect(PBR_KIND_PARAMS["marble-rough"].baseRoughness).toBeGreaterThan(0.45);
  });
});

describe("brushed gold (item 12)", () => {
  it("is deterministic for a seed", () => {
    const a = brushedMetalMaps(64, 42, "bright");
    const b = brushedMetalMaps(64, 42, "bright");
    expect(Array.from(a.roughness)).toEqual(Array.from(b.roughness));
    expect(Array.from(a.normal)).toEqual(Array.from(b.normal));
  });

  it("roughness stays inside the variant's range (plus grain slack)", () => {
    for (const variant of ["bright", "dark"] as const) {
      const { roughness } = brushedMetalMaps(64, 7, variant);
      const range = GOLD_ROUGHNESS_RANGE[variant];
      for (let i = 0; i < roughness.length; i += 4) {
        const v = roughness[i]! / 255;
        expect(v).toBeGreaterThanOrEqual(range.min - 0.03);
        expect(v).toBeLessThanOrEqual(range.max + 0.03);
      }
      // And it genuinely VARIES — flat gold was the defect.
      const values = new Set<number>();
      for (let i = 0; i < roughness.length; i += 4) values.add(roughness[i]!);
      expect(values.size).toBeGreaterThan(20);
    }
  });

  it("brushing is anisotropic: smoother along X than across Y", () => {
    const { height } = brushedMetalMaps(128, 99, "bright");
    let dx = 0;
    let dy = 0;
    let n = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 127; x++) {
        dx += Math.abs(height[y * 128 + x + 1]! - height[y * 128 + x]!);
        dy += Math.abs(height[(y < 127 ? y + 1 : y) * 128 + x]! - height[y * 128 + x]!);
        n++;
      }
    }
    expect(dx / n).toBeLessThan((dy / n) * 0.8);
  });

  it("bright gold is more polished than dark gold on average", () => {
    const mean = (m: { roughness: Uint8ClampedArray }) => {
      let s = 0;
      for (let i = 0; i < m.roughness.length; i += 4) s += m.roughness[i]!;
      return s / (m.roughness.length / 4);
    };
    expect(mean(brushedMetalMaps(64, 5, "bright"))).toBeLessThan(mean(brushedMetalMaps(64, 5, "dark")));
  });
});

describe("three-facing texture registry", () => {
  it("derived placeholders are honest neutrals before the source lands", () => {
    const pbr = derivedPbrTextures("/world/textures/marble-cream.jpg", "marble", 3, 3);
    // Neutral normal (128,128,255), white AO on channel 0, repeat set.
    const n = pbr.normalMap.image.data as Uint8Array;
    expect([n[0], n[1], n[2]]).toEqual([128, 128, 255]);
    const ao = pbr.aoMap.image.data as Uint8Array;
    expect(ao[0]).toBe(255);
    expect(pbr.aoMap.channel).toBe(0);
    expect(pbr.normalMap.repeat.x).toBe(3);
    expect(pbr.normalMap.wrapS).toBe(THREE.RepeatWrapping);
    // Derived maps flip Y to match the colour texture's orientation.
    expect(pbr.normalMap.flipY).toBe(true);
  });

  it("brushed gold textures are 256² repeat-wrapped data textures", () => {
    const gold = brushedGoldTextures("bright", 2, 2);
    expect(gold.normalMap.image.width).toBe(256);
    expect(gold.roughnessMap.image.height).toBe(256);
    expect(gold.normalMap.wrapS).toBe(THREE.RepeatWrapping);
    expect(gold.normalMap.repeat.x).toBe(2);
  });
});
