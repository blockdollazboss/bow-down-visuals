/**
 * perf-census.test.ts — pins for the World geometry census and
 * the perf round-2 conversions (Stack-100 #2, items 86–91 + 95).
 *
 * The contract being pinned is PARITY: the conversions change how
 * many draw calls the same pixels cost, never the pixels. Three
 * kinds of evidence:
 *   1. the census numbers re-derive from the scene's own data
 *      modules (placements are imported, not hardcoded);
 *   2. the tint math reproduces the retired material clones
 *      bit-for-bit (instanceColor over a white-based material is
 *      the same diffuse multiplication the clone performed);
 *   3. the pier builder EXECUTES here and its instanced output is
 *      checked transform-by-transform against the recipe the six
 *      district loops used to build by hand; the remaining
 *      builders are pinned against hall-scene.ts source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  KIT_CENSUS, GEOMETRY_CENSUS, PARKED_WITH_EVIDENCE, censusTotals,
  sharedGeometry, tintColor, triCount, renderCensusMarkdown,
  BACKDROP_CENSUS, backdropTotals, backdropLodEvaluation,
} from "./perf-census";
import { BACKDROP_WINGS, BACKDROP_GARDENS } from "./palace-grounds";
import { buildPierSet } from "./hall-scene";
import { STAGE_PIERS } from "./stage-grounds";
import { GARDENS_PIERS } from "./listening-gardens";
import { ROW_PIERS, ROW_STALLS } from "./creation-row";
import { ATELIERS_PIERS } from "./ateliers";
import { BOARDWALK_PIERS, BOARDWALK_STALLS } from "./boardwalk";
import { HEIGHTS_PIERS } from "./creator-heights";
import { PLAZA_COLUMNS, PLAZA_PLANTERS } from "./palace-layout";
import { propVariation } from "./prop-variation";

const sceneSrc = readFileSync(fileURLToPath(new URL("./hall-scene.ts", import.meta.url)), "utf8");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const bodyOf = (start: string, end: string): string => {
  const a = sceneSrc.indexOf(start);
  const b = sceneSrc.indexOf(end, a + start.length);
  expect(a, `missing ${start}`).toBeGreaterThan(-1);
  expect(b, `missing ${end}`).toBeGreaterThan(a);
  return sceneSrc.slice(a, b);
};
const kit = (name: string) => {
  const k = KIT_CENSUS.find((r) => r.kit === name);
  expect(k, `kit ${name}`).toBeDefined();
  return k!;
};

describe("the census itself", () => {
  it("placements re-derive from the scene's own data modules", () => {
    const pierTotal = STAGE_PIERS.length + GARDENS_PIERS.length + ROW_PIERS.length
      + ATELIERS_PIERS.length + BOARDWALK_PIERS.length + HEIGHTS_PIERS.length;
    expect(kit("district piers").placements).toBe(pierTotal);
    expect(kit("plaza columns").placements).toBe(PLAZA_COLUMNS.length);
    expect(kit("planter trough crowns").placements).toBe(PLAZA_PLANTERS.length * 2);
    expect(kit("stall canopies + trims").placements).toBe(ROW_STALLS.length + BOARDWALK_STALLS.length);
  });

  it("draw arithmetic is internally consistent and every converted kit saves", () => {
    const t = censusTotals();
    expect(t.drawsBefore - t.drawsAfter).toBe(t.drawsSaved);
    expect(t.drawsSaved).toBeGreaterThan(150);
    for (const k of KIT_CENSUS) {
      if (k.converted) expect(k.drawsAfter, k.kit).toBeLessThan(k.drawsBefore);
      for (const p of k.parts) expect(p.tris, `${k.kit}:${p.name}`).toBeGreaterThan(0);
    }
    /* The lamp kit was already instanced before this round — the
     * census says so instead of claiming the win. */
    const lamps = kit("district + plaza lamp standards");
    expect(lamps.converted).toBe(false);
    expect(lamps.drawsAfter).toBe(lamps.drawsBefore);
  });

  it("plaza column after-count re-derives from the variation rolls", () => {
    const variants = PLAZA_COLUMNS.map((_, i) => propVariation("column", i).variant);
    const expected = 2
      + (variants.some((v) => v !== 2) ? 1 : 0)
      + (variants.some((v) => v === 2) ? 1 : 0)
      + (variants.some((v) => v === 1) ? 1 : 0);
    expect(kit("plaza columns").drawsAfter).toBe(expected);
    expect(kit("plaza columns").drawsBefore)
      .toBe(PLAZA_COLUMNS.length * 3 + variants.filter((v) => v === 1).length);
  });

  it("the parked items carry measured evidence, not vibes", () => {
    for (const item of ["90", "91", "95"]) {
      const p = PARKED_WITH_EVIDENCE.find((r) => r.item === item);
      expect(p, `parked ${item}`).toBeDefined();
      expect(p!.measured.length).toBeGreaterThan(100);
      expect(p!.why.length).toBeGreaterThan(50);
    }
    const md = renderCensusMarkdown();
    expect(md).toContain("Parked with evidence");
    expect(md).toContain(String(censusTotals().drawsSaved));
  });

  it("triangle counts come from real geometries (a box is 12)", () => {
    expect(triCount(new THREE.BoxGeometry(1, 1, 1))).toBe(12);
    expect(triCount(new THREE.SphereGeometry(0.21, 10, 8))).toBeGreaterThan(100);
  });
});

describe("tint parity — instanceColor reproduces the retired clones", () => {
  it("white-based kits: tintColor IS the clone's colour, bit-for-bit", () => {
    for (let i = 0; i < 12; i++) {
      for (const kind of ["column", "stall"] as const) {
        const v = propVariation(kind, i);
        const cloneColour = new THREE.Color(0xffffff).offsetHSL(v.hueShift, 0, v.lightnessShift);
        const tint = tintColor(0xffffff, v);
        expect(tint.r).toBeCloseTo(cloneColour.r, 10);
        expect(tint.g).toBeCloseTo(cloneColour.g, 10);
        expect(tint.b).toBeCloseTo(cloneColour.b, 10);
      }
    }
  });

  it("leaf crowns: white twin × instanceColor == the old tinted leaf, bit-for-bit", () => {
    for (let i = 0; i < PLAZA_PLANTERS.length * 2; i++) {
      const cv = propVariation("crown", i);
      const oldClone = new THREE.Color(0x2e5d33).offsetHSL(cv.hueShift, 0, cv.lightnessShift);
      /* New path: material colour white, instanceColor = the
       * offset leaf colour; three multiplies diffuse by
       * instanceColor — the product equals the old clone colour. */
      const carried = tintColor(0x2e5d33, cv);
      expect(carried.r).toBeCloseTo(oldClone.r, 10);
      expect(carried.g).toBeCloseTo(oldClone.g, 10);
      expect(carried.b).toBeCloseTo(oldClone.b, 10);
    }
  });
});

describe("shared geometry cache (item 89)", () => {
  it("returns the identical object per key, distinct objects per spec", () => {
    const a = sharedGeometry("test:box-a", () => new THREE.BoxGeometry(1, 2, 3));
    const b = sharedGeometry("test:box-a", () => new THREE.BoxGeometry(9, 9, 9));
    expect(b).toBe(a);
    const c = sharedGeometry("test:box-b", () => new THREE.BoxGeometry(1, 2, 3));
    expect(c).not.toBe(a);
  });

  it("no world code mutates a geometry — sharing cannot leak transforms", () => {
    expect(sceneSrc).not.toContain("mergeGeometries(");
    expect(sceneSrc).not.toContain(".geometry.scale(");
    expect(sceneSrc).not.toContain(".geometry.rotate");
    expect(sceneSrc).not.toContain(".geometry.translate(");
    expect(sceneSrc).not.toContain(".applyMatrix4(");
  });

  it("every duplicated spec in the census is served by the cache in scene source", () => {
    const sites: Array<[string, number]> = [
      ['sharedGeometry("lamp-plinth"', 7],
      ["sharedGeometry(`lamp-post:${LAMP.postH}`", 7],
      ['sharedGeometry("lamp-cage"', 7],
      ['sharedGeometry("lamp-glass"', 7],
      ['sharedGeometry("lamp-cap"', 7],
      ['sharedGeometry("bench-seat"', 5],
      ['sharedGeometry("bench-back"', 5],
      ['sharedGeometry("bench-legs"', 5],
      ['sharedGeometry("paving-slab"', 6],
      ['sharedGeometry("unit-box"', 8],
      ['sharedGeometry("stall-post"', 2],
      ['sharedGeometry("stall-bench"', 2],
      ['sharedGeometry("stall-bench-trim"', 2],
      ['sharedGeometry("trough-z"', 1],
      ['sharedGeometry("trough-x"', 1],
    ];
    for (const [needle, n] of sites) expect(count(sceneSrc, needle), needle).toBe(n);
    const geoTotal = GEOMETRY_CENSUS.reduce((s, g) => s + g.constructionsBefore, 0);
    expect(geoTotal).toBeGreaterThan(200);
  });
});

describe("the pier conversion executes with parity (item 86)", () => {
  it("buildPierSet emits exactly 3 instanced draws with the loops' transforms", () => {
    const mats = {
      marble: new THREE.MeshStandardMaterial(),
      gold: new THREE.MeshStandardMaterial(),
    };
    const g = new THREE.Group();
    buildPierSet(g, mats as never, true, STAGE_PIERS);
    expect(g.children).toHaveLength(3);
    const [plinth, shaft, cap] = g.children as THREE.InstancedMesh[];
    for (const im of [plinth, shaft, cap]) {
      expect(im).toBeInstanceOf(THREE.InstancedMesh);
      expect(im.count).toBe(STAGE_PIERS.length);
    }
    /* Materials are the look's shared pair, geometries the cache's. */
    expect(plinth.material).toBe(mats.marble);
    expect(shaft.material).toBe(mats.marble);
    expect(cap.material).toBe(mats.gold);
    expect(shaft.geometry).toBe(sharedGeometry("pier-shaft", () => new THREE.BoxGeometry(0.62, 3.54, 0.62)));
    expect(triCount(shaft.geometry)).toBe(12);
    /* Transforms: instance i stands at pier i, part heights exact. */
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const heights: Array<[THREE.InstancedMesh, number]> = [[plinth, 0.15], [shaft, 0.3 + 3.54 / 2], [cap, 3.93]];
    for (const [im, y] of heights) {
      STAGE_PIERS.forEach((p, i) => {
        im.getMatrixAt(i, m);
        m.decompose(pos, quat, scl);
        /* 5 digits: instance matrices are Float32Array — this is
         * the storage format's own precision, not slack. */
        expect(pos.x).toBeCloseTo(p.x, 5);
        expect(pos.y).toBeCloseTo(y, 5);
        expect(pos.z).toBeCloseTo(p.z, 5);
        expect(scl.x).toBeCloseTo(1, 5);
        expect(scl.y).toBeCloseTo(1, 5);
      });
    }
    /* Shadow parity: only the shaft casts, and it follows the rung. */
    expect(shaft.castShadow).toBe(true);
    expect(plinth.castShadow).toBe(false);
    expect(cap.castShadow).toBe(false);
    const g2 = new THREE.Group();
    buildPierSet(g2, mats as never, false, STAGE_PIERS);
    expect((g2.children[1] as THREE.InstancedMesh).castShadow).toBe(false);
  });

  it("all six district shells call the shared pier builder; the hand loops are gone", () => {
    for (const list of ["STAGE_PIERS", "GARDENS_PIERS", "ROW_PIERS", "ATELIERS_PIERS", "BOARDWALK_PIERS", "HEIGHTS_PIERS"]) {
      expect(sceneSrc).toContain(`buildPierSet(g, mats, shadows, ${list});`);
    }
    expect(sceneSrc).not.toContain("const pier = new THREE.Group();");
  });
});

describe("the remaining conversions are pinned in scene source", () => {
  it("plaza columns: clones retired, tints + variant caps instanced", () => {
    expect(sceneSrc).not.toContain("shaftMat");
    expect(sceneSrc).toContain('tintColor(0xffffff, propVariation("column", i))');
    expect(sceneSrc).toContain('sharedGeometry("column-cap-step"');
    /* The honest remainder: gate + marker post builders still
     * clone marble per post (2 sites) — recorded in the census. */
    expect(count(sceneSrc, "mats.marble.clone()")).toBe(2);
  });

  it("crowns: cone + mound instanced meshes with the leaf tint carried", () => {
    expect(sceneSrc).toContain('sharedGeometry("crown-cone"');
    expect(sceneSrc).toContain('sharedGeometry("crown-mound"');
    expect(sceneSrc).toContain("tintColor(0x2e5d33, cv)");
    expect(sceneSrc).not.toContain("crownMat");
  });

  it("stall canopies: fabric clones retired in both districts", () => {
    expect(count(sceneSrc, "mats.fabric.clone()")).toBe(0);
    expect(sceneSrc).not.toContain("canopyMat");
    expect(sceneSrc).toContain('tintColor(0xffffff, propVariation("stall", si + 0))');
    expect(sceneSrc).toContain('tintColor(0xffffff, propVariation("stall", si + 100))');
    expect(count(sceneSrc, 'sharedGeometry("stall-canopy"')).toBe(2);
  });

  it("braziers: one cached geometry set serves the hall pair and the plaza set", () => {
    expect(count(sceneSrc, 'sharedGeometry("brazier-pedestal"')).toBe(2);
    expect(count(sceneSrc, 'sharedGeometry("brazier-bowl"')).toBe(2);
    expect(count(sceneSrc, 'sharedGeometry("brazier-coals"')).toBe(2);
  });

  it("chandeliers: five instanced parts, no per-candle meshes left", () => {
    const body = bodyOf("private buildChandeliers", "private buildBraziers");
    expect(count(body, "instancedPart(")).toBe(5);
    expect(body).toContain('sharedGeometry("chandelier-stick"');
    expect(body).toContain('sharedGeometry("chandelier-bulb"');
    expect(body).not.toContain("const ch = new THREE.Group();");
    expect(body).not.toContain("new THREE.Mesh(");
  });

  it("hall columns: per-part instancing in both styles, group loop gone", () => {
    const body = bodyOf("private buildColumns", "private buildStage");
    expect(body).not.toContain("const col = new THREE.Group();");
    expect(body).toContain('sharedGeometry("hall-column-shaft-round"');
    expect(body).toContain('sharedGeometry("hall-column-shaft-box"');
    expect(body).toContain('sharedGeometry("hall-column-band"');
    expect(body).toContain('sharedGeometry("hall-column-neck"');
  });

  it("plaza stalls + arrival arch instance their kits", () => {
    for (const key of ["plaza-stall-counter", "plaza-stall-skirt", "plaza-stall-post", "plaza-stall-canopy", "plaza-stall-trim"]) {
      expect(sceneSrc, key).toContain(`sharedGeometry("${key}"`);
    }
    expect(sceneSrc).toContain('sharedGeometry("arch-column-plinth"');
    expect(sceneSrc).toContain('sharedGeometry("arch-column-cap"');
  });
});

describe("backdrop census — item 90 re-measured (Stack-100 #3)", () => {
  it("the backdrop totals re-derive: 10 draws, 1,754 triangles", () => {
    const t = backdropTotals();
    expect(t.draws).toBe(10);
    expect(t.tris).toBe(1754);
    /* The garden masses are 86% of the triangles and ONE draw. */
    const gardens = BACKDROP_CENSUS.find((r) => r.element.startsWith("garden masses"))!;
    expect(gardens.draws).toBe(1);
    expect(gardens.instances).toBe(BACKDROP_GARDENS.length);
    expect(gardens.tris / t.tris).toBeGreaterThan(0.8);
    const windows = BACKDROP_CENSUS.find((r) => r.element.startsWith("wing windows"))!;
    expect(windows.draws).toBe(1);
    expect(windows.instances).toBe(BACKDROP_WINGS.reduce((s, w) => s + w.windows.length, 0));
  });

  it("the scene builder matches the census, element for element", () => {
    const body = bodyOf("private buildBackdropGrounds", "private buildFloor");
    expect(body).toContain("new THREE.CircleGeometry(BACKDROP.skirtR, 40)");
    expect(body).toContain("new THREE.RingGeometry(BACKDROP.moatInnerR, BACKDROP.moatOuterR, 48, 1");
    expect(count(body, "new THREE.BoxGeometry(wing.")).toBe(2);
    expect(count(body, "new THREE.InstancedMesh(")).toBe(2);
    expect(body).toContain("new THREE.SphereGeometry(1, 12, 8)");
    expect(body).toContain("new THREE.PlaneGeometry(1.5, 2.1)");
    /* No LOD machinery touches the backdrop: no THREE.LOD, no
     * lodItems registration inside the builder. */
    expect(body).not.toContain("THREE.LOD");
    expect(body).not.toContain("lodItems");
  });

  it("the house-LOD evaluation is measured: wings tier FAR at low, MID at medium", () => {
    const rows = backdropLodEvaluation();
    expect(rows).toHaveLength(BACKDROP_WINGS.length + BACKDROP_GARDENS.length);
    const wings = rows.slice(0, BACKDROP_WINGS.length);
    for (const w of wings) {
      expect(w.distance).toBeGreaterThan(60);
      expect(w.distance).toBeLessThan(75);
      /* FAR at the low rung = the group would be HIDDEN — the
       * void returns. MID at medium = detail (the windows' one
       * instanced draw) would be hidden. Both disqualify. */
      expect(w.tiers.low).toBe("far");
      expect(w.tiers.medium).toBe("mid");
    }
    /* Every anchor stands beyond half the low rung's draw
     * distance from the palace heart — and real viewpoints
     * inside the districts read farther still. */
    for (const r of rows) expect(r.distance).toBeGreaterThan(30);
  });
});
