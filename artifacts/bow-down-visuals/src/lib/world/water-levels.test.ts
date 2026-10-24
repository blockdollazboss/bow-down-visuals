/**
 * water-levels.test.ts — Stack-100 #3, items 37/38 retry.
 *
 * Board-2's gardens items rested on facet-A claims:
 *   37 (LG-2): "audio-node lily discs sit at y=0.03 while the pond
 *      surface is y=0.02 — they hover";
 *   38 (LG-3): "an under-stage river runs at y=−0.18, sunk below
 *      an opaque ground plane".
 * The districts lane parked both (6b8db350): neither the discs,
 * the pond, nor the sunk river exist in the tree. This lane
 * re-verified exhaustively (full-tree greps for pond/lily/tube/
 * −0.18; every water body's data + scene build read) — the facet
 * described water that was never built; its river citations named
 * files (plaza-engine.ts, ticks.ts) that do not exist.
 *
 * What is built instead:
 *   37 — the item's intent for real: lily pads that SIT on the
 *        gardens' water (the rill), at the surface's own height.
 *   38 — the item's demand as an executable census: every water
 *        surface in the world stands ABOVE its ground and BELOW
 *        its rim, and the facet's sunk-river form (a tube under a
 *        ground plane) is absent from the scene source. If a
 *        future build ever sinks a water, this file fails.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { POOL } from "./plaza-life";
import {
  RILL, RILL_BLOCKED, PARTERRE_LAWN, GARDENS_FOUNTAIN,
  LILY_PADS, LILY_PAD_Y, LILY_PAD_LIFT,
} from "./listening-gardens";
import { BOARDWALK_BASIN } from "./boardwalk";
import { BACKDROP } from "./palace-grounds";
import { pointInRect } from "./palace-layout";

const scene = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");

describe("item 38 retry — no sunk water anywhere in the world", () => {
  it("every basin's water stands above its ground and below its rim", () => {
    for (const body of [POOL, RILL, BOARDWALK_BASIN]) {
      expect(body.waterY).toBeGreaterThan(0);
      expect(body.waterY).toBeLessThan(body.rimH);
    }
    expect(GARDENS_FOUNTAIN.waterY).toBeGreaterThan(0);
    expect(GARDENS_FOUNTAIN.waterY).toBeLessThan(GARDENS_FOUNTAIN.rimH);
    expect(GARDENS_FOUNTAIN.jetBaseY).toBeGreaterThan(GARDENS_FOUNTAIN.waterY);
  });

  it("the backdrop moat floats on the skirt, not under it", () => {
    expect(BACKDROP.moatY).toBeGreaterThan(BACKDROP.skirtY);
  });

  it("the facet's sunk-river form is absent: no tube geometry, no −0.18 run", () => {
    expect(scene).not.toContain("TubeGeometry");
    expect(scene).not.toContain("-0.18");
    expect(scene).not.toContain("pond");
  });

  it("the gardens' waters build at their data heights in the scene", () => {
    expect(scene).toContain("RILL.waterY + PARTERRE_LAWN.topY");
    expect(scene).toContain("baseY + f.waterY");
  });
});

describe("item 37 retry — lily pads sit on the rill's water", () => {
  it("the pad height is the water's own height plus the wet-edge hover, under the rim", () => {
    expect(LILY_PAD_Y).toBeCloseTo(PARTERRE_LAWN.topY + RILL.waterY + LILY_PAD_LIFT, 10);
    expect(LILY_PAD_LIFT).toBeGreaterThan(0);
    expect(LILY_PAD_LIFT).toBeLessThan(0.02);
    expect(LILY_PAD_Y).toBeGreaterThan(PARTERRE_LAWN.topY + RILL.waterY);
    expect(LILY_PAD_Y).toBeLessThan(PARTERRE_LAWN.topY + RILL.rimH);
  });

  it("every pad lies fully on the rill's water, clear of the fountain basin", () => {
    expect(LILY_PADS.length).toBeGreaterThanOrEqual(4);
    const waterHalfW = RILL.w / 2 - RILL.rimLip;
    const waterHalfD = RILL.d / 2 - RILL.rimLip;
    for (const p of LILY_PADS) {
      expect(Math.abs(p.x - RILL.cx) + p.r).toBeLessThanOrEqual(waterHalfW + 1e-9);
      expect(Math.abs(p.z - RILL.cz) + p.r).toBeLessThanOrEqual(waterHalfD + 1e-9);
      expect(pointInRect(p.x, p.z, RILL_BLOCKED)).toBe(true);
      const distFountain = Math.hypot(p.x - GARDENS_FOUNTAIN.cx, p.z - GARDENS_FOUNTAIN.cz);
      expect(distFountain).toBeGreaterThan(GARDENS_FOUNTAIN.rimR + p.r);
    }
  });

  it("the scene builds the pads as one instanced draw at LILY_PAD_Y", () => {
    expect(scene).toContain("LILY_PADS");
    expect(scene).toContain("dummy.position.set(p.x, LILY_PAD_Y, p.z)");
    expect(scene).toContain("LILY_PADS.length");
  });
});
