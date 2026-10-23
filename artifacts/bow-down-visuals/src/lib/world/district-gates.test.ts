/**
 * district-gates — board item 37's honesty, pinned.
 *
 * Pins:
 * - the six Phase-1 district names survive, exactly six;
 * - only two thresholds are "gate"s, and each stands centred in
 *   a REAL wall gap (DISTRICT_GATE_GAPS) — a gate at a solid
 *   wall is the dishonesty this item removes;
 * - the four others are "marker"s (signposts, not doorways) —
 *   including the east pair, which used to be painted onto the
 *   unbroken east wall (x 28.2): markers stand OFF that wall on
 *   open floor, and no marker carries gate parts in the data
 *   (no bar offsets);
 * - hall-scene builds thresholds from this table alone (source
 *   pin): no stamped gate kit, no floating plate call at the
 *   old 2.33 height for a district name.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DISTRICT_GATE_GAPS, DISTRICT_SUBPLATE, DISTRICT_THRESHOLDS } from "./district-gates";

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
    expect(gates.map((g) => g.name)).toEqual(["STAGE GROUNDS", "THE BOARDWALK"]);
    for (const gate of gates) {
      const gap = DISTRICT_GATE_GAPS[gate.name]!;
      expect(gap.axis).toBe(gate.axis);
      const along = gate.axis === "x" ? gate.x : gate.z;
      const at = gate.axis === "x" ? gate.z : gate.x;
      expect(at).toBe(gap.at);
      expect(along).toBe((gap.min + gap.max) / 2);
    }
  });

  it("the other four are grounded markers, not doorways", () => {
    const markers = DISTRICT_THRESHOLDS.filter((d) => d.kind === "marker");
    expect(markers.map((m) => m.name)).toEqual([
      "CREATION ROW",
      "THE ATELIERS",
      "LISTENING GARDENS",
      "CREATOR HEIGHTS",
    ]);
    for (const m of markers) {
      /* No closure bar — a marker has nothing to close. */
      expect(m.barDx).toBeUndefined();
      expect(m.barDz).toBeUndefined();
    }
    /* The east pair no longer touch the east wall (x 28.2, plaza
     * face 28.025): they stand on open floor in front of it. */
    for (const name of ["CREATION ROW", "THE ATELIERS"]) {
      const m = DISTRICT_THRESHOLDS.find((d) => d.name === name)!;
      expect(m.x).toBeLessThan(28.0);
      expect(m.x).toBeGreaterThan(25);
    }
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
});
