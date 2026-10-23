/**
 * district-gates — board item 37's honesty, pinned.
 *
 * Pins:
 * - the six Phase-1 district names survive, exactly six;
 * - all six thresholds are "gate"s, and each stands centred
 *   in a REAL wall gap (DISTRICT_GATE_GAPS) — a gate at a solid
 *   wall is the dishonesty this item removes;
 * - no threshold is a "marker" any more (item 36 built the last
 *   district): the marker classification survives only as the
 *   honest form an unbuilt district would take;
 * - hall-scene builds thresholds from this table alone (source
 *   pin): no stamped gate kit, no floating plate call at the
 *   old 2.33 height for a district name.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DISTRICT_GATE_GAPS, DISTRICT_OPEN_SUBPLATE, DISTRICT_SUBPLATE, DISTRICT_THRESHOLDS, gateLeafYaw } from "./district-gates";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sceneSrc = read("./hall-scene.ts");

describe("district-gates", () => {
  it("keeps the six district names", () => {
    expect(DISTRICT_THRESHOLDS.map((d) => d.name)).toEqual([
      "STAGE GROUNDS",
      "THE BOARDWALK",
      "CREATION ROW",
      "THE ATELIERS",
      "LISTENING GARDENS",
      "CREATOR HEIGHTS",
    ]);
    expect(DISTRICT_SUBPLATE).toBe("COMING");
  });

  it("gates stand only at real wall gaps, centred in them", () => {
    const gates = DISTRICT_THRESHOLDS.filter((d) => d.kind === "gate");
    /* DELIBERATELY moved in item 32: the Listening Gardens gate
     * joined — its district is built, through a real new gap in
     * the south wall on its old marker's line. DELIBERATELY
     * moved again in item 33: the Creation Row gate joined —
     * its district is built, through a real new gap in the east
     * wall on its old marker's line. DELIBERATELY moved again
     * in item 34: the Ateliers gate joined — its district is
     * built south of Creation Row, through a real new gap in
     * the east wall's south run (not on its old marker's line:
     * east of z 22.5 is the Row's built quarter). DELIBERATELY
     * moved in item 36: the Creator Heights gate joined — its
     * district is built as an enclave on the plaza's north-east
     * quadrant, through a real new gap in the enclave's own
     * west wall on its old marker's exact spot (13.5, 24.6). */
    expect(gates.map((g) => g.name)).toEqual(["STAGE GROUNDS", "THE BOARDWALK", "CREATION ROW", "THE ATELIERS", "LISTENING GARDENS", "CREATOR HEIGHTS"]);
    for (const gate of gates) {
      const gap = DISTRICT_GATE_GAPS[gate.name]!;
      expect(gap.axis).toBe(gate.axis);
      const along = gate.axis === "x" ? gate.x : gate.z;
      const at = gate.axis === "x" ? gate.z : gate.x;
      expect(at).toBe(gap.at);
      expect(along).toBe((gap.min + gap.max) / 2);
    }
  });

  it("no markers remain — every district is built (item 36 closed the last one)", () => {
    const markers = DISTRICT_THRESHOLDS.filter((d) => d.kind === "marker");
    /* DELIBERATELY moved in item 32: LISTENING GARDENS left the
     * markers — it is an open gate now (below). DELIBERATELY
     * moved in item 33: CREATION ROW left the markers the same
     * way. DELIBERATELY moved in item 34: THE ATELIERS left the
     * markers the same way. DELIBERATELY moved in item 36:
     * CREATOR HEIGHTS — the last marker — left the same way,
     * and the list is empty: a marker is a promise, and no
     * promises remain unbuilt. */
    expect(markers.map((m) => m.name)).toEqual([]);
    for (const m of markers) {
      /* No closure bar — a marker has nothing to close. */
      expect(m.barDx).toBeUndefined();
      expect(m.barDz).toBeUndefined();
    }
  });

  it("items 31+32+33+34+35+36: the Stage Grounds, Listening Gardens, Creation Row, Ateliers, Boardwalk and Creator Heights gates are OPEN — their districts are built; every threshold is open", () => {
    const stage = DISTRICT_THRESHOLDS.find((d) => d.name === "STAGE GROUNDS")!;
    expect(stage.kind).toBe("gate");
    expect(stage.open).toBe(true);
    /* Item 32: the Gardens' marker was reclassified to an open
     * gate in the south wall on its own line (x −26, z 34). */
    const gardens = DISTRICT_THRESHOLDS.find((d) => d.name === "LISTENING GARDENS")!;
    expect(gardens.kind).toBe("gate");
    expect(gardens.open).toBe(true);
    expect(gardens.x).toBe(-26);
    expect(gardens.z).toBe(34.0);
    /* Item 33: the Row's marker was reclassified to an open
     * gate in the east wall on its own line (x 28.2, z 14.5). */
    const row = DISTRICT_THRESHOLDS.find((d) => d.name === "CREATION ROW")!;
    expect(row.kind).toBe("gate");
    expect(row.open).toBe(true);
    expect(row.x).toBe(28.2);
    expect(row.z).toBe(14.5);
    /* Item 34: the Ateliers' marker was reclassified to an open
     * gate in the east wall's south run (x 28.2, z 30.5) — not
     * on its own line (z 22.5), which opens into the built
     * Creation Row; the Ateliers stand south of the Row. */
    const ateliers = DISTRICT_THRESHOLDS.find((d) => d.name === "THE ATELIERS")!;
    expect(ateliers.kind).toBe("gate");
    expect(ateliers.open).toBe(true);
    expect(ateliers.x).toBe(28.2);
    expect(ateliers.z).toBe(30.5);
    /* Item 35: the Boardwalk's barred gate opened on its own
     * line (x 0, z 34) — it was always a gate in a real gap,
     * honestly closed; now its district stands beyond it. */
    const boardwalk = DISTRICT_THRESHOLDS.find((d) => d.name === "THE BOARDWALK")!;
    expect(boardwalk.kind).toBe("gate");
    expect(boardwalk.open).toBe(true);
    expect(boardwalk.x).toBe(0);
    expect(boardwalk.z).toBe(34.0);
    /* Item 36: the Heights' marker was reclassified to an open
     * gate on its exact spot (13.5, 24.6) — in the enclave's own
     * west wall on the marker's line (x 13.5), the one line that
     * opens into the quarter itself, every outward line being
     * built over. */
    const heights = DISTRICT_THRESHOLDS.find((d) => d.name === "CREATOR HEIGHTS")!;
    expect(heights.kind).toBe("gate");
    expect(heights.open).toBe(true);
    expect(heights.x).toBe(13.5);
    expect(heights.z).toBe(24.6);
    for (const d of DISTRICT_THRESHOLDS) {
      if (d.name !== "STAGE GROUNDS" && d.name !== "LISTENING GARDENS" && d.name !== "CREATION ROW" && d.name !== "THE ATELIERS" && d.name !== "THE BOARDWALK" && d.name !== "CREATOR HEIGHTS") {
        expect(d.open ?? false, d.name).toBe(false);
      }
    }
    expect(DISTRICT_OPEN_SUBPLATE).toBe("OPEN");
    /* The scene honours the classification: the bar is built
     * only for a closed gate, and the sub-plate is chosen by
     * openness — an open gate can never render barred or COMING. */
    expect(sceneSrc).toContain("if (!def.open)");
    expect(sceneSrc).toContain("def.open ? DISTRICT_OPEN_SUBPLATE : DISTRICT_SUBPLATE");
  });

  it("hall-scene builds thresholds from the table, not a stamped kit", () => {
    expect(sceneSrc).toContain("DISTRICT_THRESHOLDS");
    expect(sceneSrc).toContain("buildDistrictMarker");
    expect(sceneSrc).toContain("buildDistrictGate");
    /* The old dishonest calls are gone: no gate stamped onto
     * the east wall, none freestanding as a doorway. */
    expect(sceneSrc).not.toContain('districtGate("CREATION ROW"');
    expect(sceneSrc).not.toContain('districtGate("THE ATELIERS"');
    expect(sceneSrc).not.toContain('districtGate("LISTENING GARDENS"');
    expect(sceneSrc).not.toContain('districtGate("CREATOR HEIGHTS"');
  });

  it("gates round (Stack-100 #2): every gate carries its own identity — no two gates alike", () => {
    const accents = new Set(DISTRICT_THRESHOLDS.map((d) => d.identity.accent));
    const angles = new Set(DISTRICT_THRESHOLDS.map((d) => d.identity.leafAngleDeg));
    expect(accents.size).toBe(DISTRICT_THRESHOLDS.length);
    expect(angles.size).toBeGreaterThanOrEqual(5);
    expect(new Set(DISTRICT_THRESHOLDS.map((d) => d.identity.capVariant)).size).toBe(2);
    for (const d of DISTRICT_THRESHOLDS) {
      expect(d.identity.leafAngleDeg).toBeGreaterThanOrEqual(50);
      expect(d.identity.leafAngleDeg).toBeLessThanOrEqual(85);
    }
    /* districtDir agrees with the map: the Stage Grounds' district
     * lies at −X of its gate; every east/south district at +normal. */
    const sg = DISTRICT_THRESHOLDS.find((d) => d.name === "STAGE GROUNDS")!;
    expect(sg.identity.districtDir).toBe(-1);
    for (const d of DISTRICT_THRESHOLDS) {
      if (d.name !== "STAGE GROUNDS") expect(d.identity.districtDir, d.name).toBe(1);
    }
  });

  it("gateLeafYaw swings both leaves TOWARD the district, mirrored, never across the passage", () => {
    for (const d of DISTRICT_THRESHOLDS) {
      const plus = gateLeafYaw(d, true);
      const minus = gateLeafYaw(d, false);
      expect(minus).toBeCloseTo(-plus, 9);
      expect(Math.abs(plus)).toBeCloseTo((d.identity.leafAngleDeg * Math.PI) / 180, 9);
      /* A leaf swung past 90° would cross the passage line; the
       * yaw is the identity's angle exactly, so it rests along
       * the wall inside the district. */
      expect(Math.abs(plus)).toBeLessThan(Math.PI / 2);
    }
    /* South-wall gate (Boardwalk, axis x, district +Z): the
     * +x-extending leaf yaws negative (toward +Z). East-wall gate
     * (Creation Row, axis z, district +X): its +z-extending leaf
     * yaws positive (toward +X). */
    const bw = DISTRICT_THRESHOLDS.find((d) => d.name === "THE BOARDWALK")!;
    expect(gateLeafYaw(bw, true)).toBeLessThan(0);
    const cr = DISTRICT_THRESHOLDS.find((d) => d.name === "CREATION ROW")!;
    expect(gateLeafYaw(cr, true)).toBeGreaterThan(0);
    const sg = DISTRICT_THRESHOLDS.find((d) => d.name === "STAGE GROUNDS")!;
    expect(gateLeafYaw(sg, true)).toBeLessThan(0); // district at −X
  });

  it("the scene builds the identity: leaves, a lantern MESH, backed two-faced plates, full shadow flags", () => {
    expect(sceneSrc).toContain("gateLeafYaw(def, extendingPlus)");
    expect(sceneSrc).toContain("def.identity.accent");
    expect(sceneSrc).toContain("def.identity.capVariant");
    expect(sceneSrc).toContain("doorPlateBacked(g, name");
    expect(sceneSrc).toContain("doorPlateBacked(g, def.open ? DISTRICT_OPEN_SUBPLATE : DISTRICT_SUBPLATE");
    // The lantern is a mesh (cage + glass), not only a glow sprite.
    const gateBuild = sceneSrc.slice(sceneSrc.indexOf("const buildDistrictGate"), sceneSrc.indexOf("const buildDistrictMarker"));
    expect(gateBuild).toContain("const lantern = new THREE.Group()");
    expect(gateBuild).toContain("glassStyle.emissive");
    expect(gateBuild).toContain("cap.castShadow = shadows");
    expect(gateBuild).toContain("header.castShadow = shadows");
    expect(gateBuild).toContain("leaf.castShadow = shadows");
  });
});
