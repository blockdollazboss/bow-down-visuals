/**
 * plaza-solids.test.ts — the King's Plaza's named landmarks
 * (Stack-100 #2 add-on, un-parking World-100 items 40, 42–44).
 *
 * The facet audits named the lions, the fountain dams and the
 * compass rose as collision solids the plaza spec assumed; the
 * solids did not exist, so the items parked. This suite pins
 * the build that un-parks them:
 *   - the collision is DERIVED from plaza-solids' placement
 *     data and folded into PLAZA_BLOCKED;
 *   - the lions stand at the façade's foot, mirrored, flanking
 *     the ceremonial steps without touching them, the lawns,
 *     the spine, or the monument's pinned bypasses;
 *   - a figure cannot walk through a lion, cannot cross the
 *     compass rose, and still cannot stand in the fountain
 *     works — the dams are named sub-solids inside the pool's
 *     already-blocked rectangle;
 *   - nothing here is camera-tall: every landmark passes under
 *     the 2.45 m camera line, so PLAZA_TALL_BLOCKED is untouched;
 *   - the scene builds all three from the same data, and the
 *     dams' falling sheets share the fountain fall's material —
 *     the pool keeps ONE registered water entry.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PLAZA_LIONS, LION, COMPASS_ROSE, COMPASS_ROSE_BLOCKED,
  PLAZA_DAMS, DAM, PLAZA_DAMS_BLOCKED, PLAZA_SOLIDS_BLOCKED,
} from "./plaza-solids";
import { POOL, POOL_BLOCKED, FOUNTAIN } from "./plaza-life";
import { HALL_STEPS } from "./palace-grounds";
import {
  PLAZA_BLOCKED, PLAZA_TALL_BLOCKED, PALACE_LAYOUT, COURTYARD_ID,
  HALL_STEP_ZONES, isWalkable, stepZoneAt, resolvePalaceMove,
  type PalaceRect,
} from "./palace-layout";
import { PALACE_STATIONS } from "./stations";

const overlaps = (a: PalaceRect, b: PalaceRect): boolean =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const contains = (outer: PalaceRect, inner: PalaceRect): boolean =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX &&
  inner.minZ >= outer.minZ && inner.maxZ <= outer.maxZ;

/** PLAZA_BLOCKED as it stood before the landmarks landed. */
const PRE_EXISTING = PLAZA_BLOCKED.filter(
  (b) => !(PLAZA_SOLIDS_BLOCKED as readonly PalaceRect[]).includes(b),
);
const LION_RECTS = PLAZA_SOLIDS_BLOCKED.slice(0, PLAZA_LIONS.length);

describe("plaza solids — derived collision, folded into PLAZA_BLOCKED", () => {
  it("the aggregate is the two lions, the rose, and the two dams — all in PLAZA_BLOCKED", () => {
    expect(PLAZA_SOLIDS_BLOCKED).toHaveLength(5);
    for (const b of PLAZA_BLOCKED.slice(-PLAZA_SOLIDS_BLOCKED.length)) {
      expect(PLAZA_SOLIDS_BLOCKED).toContainEqual(b);
    }
    for (const b of PLAZA_SOLIDS_BLOCKED) expect(PLAZA_BLOCKED).toContainEqual(b);
  });

  it("the lions and the rose overlap NOTHING pre-existing; the dams overlap only the pool they stand in", () => {
    for (const b of [...LION_RECTS, COMPASS_ROSE_BLOCKED]) {
      for (const other of PRE_EXISTING) {
        expect(overlaps(b, other), JSON.stringify(other)).toBe(false);
      }
    }
    for (const dam of PLAZA_DAMS_BLOCKED) {
      const hit = PRE_EXISTING.filter((other) => overlaps(dam, other));
      expect(hit).toEqual([POOL_BLOCKED]);
      expect(contains(POOL_BLOCKED, dam)).toBe(true);
    }
    /* And the five never overlap each other (beyond the dams'
     * containment in the pool, which is not each other). */
    for (let i = 0; i < PLAZA_SOLIDS_BLOCKED.length; i++) {
      for (let j = i + 1; j < PLAZA_SOLIDS_BLOCKED.length; j++) {
        expect(overlaps(PLAZA_SOLIDS_BLOCKED[i]!, PLAZA_SOLIDS_BLOCKED[j]!)).toBe(false);
      }
    }
  });

  it("no landmark is camera-tall — PLAZA_TALL_BLOCKED is untouched by all five", () => {
    expect(LION.topY).toBeLessThan(2.45);
    expect(COMPASS_ROSE.rimTopY).toBeLessThan(2.45);
    expect(DAM.capTopY).toBeLessThan(2.45);
    for (const b of PLAZA_SOLIDS_BLOCKED) expect(PLAZA_TALL_BLOCKED).not.toContainEqual(b);
  });

  it("every courtyard station keeps its 0.45 m clearance from every landmark", () => {
    for (const s of PALACE_STATIONS.filter((st) => st.roomId === COURTYARD_ID)) {
      for (const b of PLAZA_SOLIDS_BLOCKED) {
        const dx = Math.max(b.minX - s.x, 0, s.x - b.maxX);
        const dz = Math.max(b.minZ - s.z, 0, s.z - b.maxZ);
        expect(Math.hypot(dx, dz), `${s.id} vs ${JSON.stringify(b)}`).toBeGreaterThanOrEqual(0.45);
      }
    }
  });
});

describe("the lions — guardians at the façade's foot (items 40/42)", () => {
  it("two lions, mirrored about the spine, both facing south over the plaza", () => {
    expect(PLAZA_LIONS).toHaveLength(2);
    const [w, e] = PLAZA_LIONS as [typeof PLAZA_LIONS[0], typeof PLAZA_LIONS[0]];
    expect(w.x).toBe(-e.x);
    expect(w.z).toBe(e.z);
    expect(w.rotY).toBe(0);
    expect(e.rotY).toBe(0);
  });

  it("their posts flank the ceremonial steps — clear of the step platforms, the lawns, and every step zone", () => {
    for (const lion of PLAZA_LIONS) {
      const inner = Math.abs(lion.x) - LION.blockHalfX;
      const outer = Math.abs(lion.x) + LION.blockHalfX;
      /* In the slot between the step platforms (|x| to 5.6) and
       * the lawn panels (|x| from 6.5), at the steps' own depth. */
      expect(inner).toBeGreaterThanOrEqual(HALL_STEPS.sideX1);
      expect(outer).toBeLessThanOrEqual(6.5);
      expect(lion.z).toBeGreaterThan(HALL_STEPS.z0);
      expect(lion.z).toBeLessThan(HALL_STEPS.z1);
      expect(stepZoneAt(lion.x, lion.z)).toBeNull();
    }
    for (const b of LION_RECTS) {
      for (const zone of HALL_STEP_ZONES) expect(overlaps(b, zone.rect)).toBe(false);
    }
  });

  it("the monument's bypasses and the spine survive the lions", () => {
    expect(isWalkable(2.6, 19.7)).toBe(true);
    expect(isWalkable(-2.6, 19.7)).toBe(true);
    expect(isWalkable(0, 24.9)).toBe(true);
  });

  it("a figure cannot walk through a lion — centre unwalkable, approach stops dead", () => {
    for (const lion of PLAZA_LIONS) {
      expect(isWalkable(lion.x, lion.z)).toBe(false);
      const fromX = lion.x + Math.sign(lion.x) * 1.25;
      const step = resolvePalaceMove({ x: fromX, z: lion.z, room: COURTYARD_ID }, lion.x, lion.z);
      expect(step.x).toBeCloseTo(fromX);
      expect(step.z).toBeCloseTo(lion.z);
      expect(step.room).toBe(COURTYARD_ID);
    }
  });
});

describe("the compass rose — relief at the yard's heart (items 42/44)", () => {
  const yard = PALACE_LAYOUT[COURTYARD_ID]!.grounds!.find(
    (g) => g.minX === 16.6 && g.minZ === 25.9,
  )!;

  it("it sits at the south-east yard's heart", () => {
    expect(Math.abs(COMPASS_ROSE.cx - (yard.minX + yard.maxX) / 2)).toBeLessThanOrEqual(0.05);
    expect(COMPASS_ROSE.cz).toBeCloseTo((yard.minZ + yard.maxZ) / 2);
    expect(contains(yard, COMPASS_ROSE_BLOCKED)).toBe(true);
  });

  it("the relief is real: rim proud of the base disc, star and hub below the rim", () => {
    expect(COMPASS_ROSE.rimTopY).toBeGreaterThan(COMPASS_ROSE.baseTopY);
    expect(COMPASS_ROSE.starTopY).toBeGreaterThan(COMPASS_ROSE.baseTopY);
    expect(COMPASS_ROSE.starTopY).toBeLessThan(COMPASS_ROSE.rimTopY);
    expect(COMPASS_ROSE.hubTopY).toBeLessThan(COMPASS_ROSE.rimTopY);
    expect(COMPASS_ROSE.starR).toBeLessThan(COMPASS_ROSE.ringInnerR);
  });

  it("a figure cannot cross it — but the yard still walks around it", () => {
    expect(isWalkable(COMPASS_ROSE.cx, COMPASS_ROSE.cz)).toBe(false);
    const bonk = resolvePalaceMove(
      { x: COMPASS_ROSE.cx, z: 26.9, room: COURTYARD_ID }, COMPASS_ROSE.cx, COMPASS_ROSE.cz,
    );
    expect(bonk.z).toBeCloseTo(26.9);
    const across = resolvePalaceMove({ x: 18.0, z: 32.9, room: COURTYARD_ID }, 26.0, 32.9);
    expect(across.x).toBeCloseTo(26.0);
    expect(across.room).toBe(COURTYARD_ID);
    expect(isWalkable(19.5, COMPASS_ROSE.cz)).toBe(true);
    expect(isWalkable(25.5, COMPASS_ROSE.cz)).toBe(true);
  });
});

describe("the fountain dams — the waterworks divided (item 43)", () => {
  it("two dams at the pool's third-points, the fountain's basin between them", () => {
    expect(PLAZA_DAMS).toHaveLength(2);
    const [w, e] = PLAZA_DAMS as [typeof PLAZA_DAMS[0], typeof PLAZA_DAMS[0]];
    expect(w.x).toBeLessThan(FOUNTAIN.x);
    expect(e.x).toBeGreaterThan(FOUNTAIN.x);
    expect(e.x - w.x).toBeCloseTo(POOL.w / 3);
    expect(w.z).toBe(POOL.cz);
    expect(e.z).toBe(POOL.cz);
  });

  it("each dam runs rim to rim, and its cap stands proud of rim and water", () => {
    expect(DAM.spanD).toBeCloseTo(POOL.d - POOL.rimLip * 2);
    expect(DAM.capTopY).toBeGreaterThan(POOL.rimH);
    expect(DAM.capTopY).toBeGreaterThan(POOL.waterY);
    for (const dam of PLAZA_DAMS_BLOCKED) {
      expect(dam.minZ).toBeCloseTo(POOL.cz - DAM.spanD / 2);
      expect(dam.maxZ).toBeCloseTo(POOL.cz + DAM.spanD / 2);
    }
  });

  it("no figure stands in the fountain works — dam centres and the fountain itself stay solid", () => {
    for (const dam of PLAZA_DAMS) expect(isWalkable(dam.x, dam.z)).toBe(false);
    expect(isWalkable(FOUNTAIN.x, FOUNTAIN.z)).toBe(false);
    const step = resolvePalaceMove({ x: -6.2, z: POOL.cz, room: COURTYARD_ID }, PLAZA_DAMS[1]!.x, POOL.cz);
    expect(step.x).toBeCloseTo(-6.2);
    expect(step.room).toBe(COURTYARD_ID);
  });
});

describe("the scene builds the landmarks from this data", () => {
  const scene = readFileSync(
    fileURLToPath(new URL("./hall-scene.ts", import.meta.url)), "utf8",
  );
  const body = scene.slice(
    scene.indexOf("private buildPlazaLife"), scene.indexOf("private buildCreatorRoomsArch"),
  );

  it("buildPlazaLife builds the lions, the rose, and the dams from plaza-solids", () => {
    expect(body).toContain("PLAZA_LIONS");
    expect(body).toContain("COMPASS_ROSE");
    expect(body).toContain("PLAZA_DAMS");
    /* The mane construction that makes LION.topY true. */
    expect(body).toContain("top + 0.92");
  });

  it("the dams' falling sheets share the fountain fall's material — no second water registration", () => {
    /* The dam build sits between its marker and the pool's one
     * waters push: the sheets are built from fallMat BEFORE that
     * push and register nothing of their own. */
    const damStart = scene.indexOf("Plaza-solids (item 43)");
    const damSection = scene.slice(damStart, scene.indexOf("anim.waters.push", damStart));
    expect(damSection).toContain("PLAZA_DAMS");
    expect(damSection).toContain("fallMat");
    expect(damSection).not.toContain("PointLight");
  });
});
