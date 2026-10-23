/**
 * district-gates — board item 37's honesty, pinned.
 *
 * Pins:
 * - the six Phase-1 district names survive, exactly six;
 * - only three thresholds are "gate"s, and each stands centred
 *   in a REAL wall gap (DISTRICT_GATE_GAPS) — a gate at a solid
 *   wall is the dishonesty this item removes;
 * - the three others are "marker"s (signposts, not doorways) —
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
import { DISTRICT_GATE_GAPS, DISTRICT_OPEN_SUBPLATE, DISTRICT_SUBPLATE, DISTRICT_THRESHOLDS } from "./district-gates";

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
     * the south wall on its old marker's line. */
    expect(gates.map((g) => g.name)).toEqual(["STAGE GROUNDS", "THE BOARDWALK", "LISTENING GARDENS"]);
    for (const gate of gates) {
      const gap = DISTRICT_GATE_GAPS[gate.name]!;
      expect(gap.axis).toBe(gate.axis);
      const along = gate.axis === "x" ? gate.x : gate.z;
      const at = gate.axis === "x" ? gate.z : gate.x;
      expect(at).toBe(gap.at);
      expect(along).toBe((gap.min + gap.max) / 2);
    }
  });

  it("the other three are grounded markers, not doorways", () => {
    const markers = DISTRICT_THRESHOLDS.filter((d) => d.kind === "marker");
    /* DELIBERATELY moved in item 32: LISTENING GARDENS left the
     * markers — it is an open gate now (below). */
    expect(markers.map((m) => m.name)).toEqual([
      "CREATION ROW",
      "THE ATELIERS",
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

  it("items 31+32: the Stage Grounds and Listening Gardens gates are OPEN — their districts are built; every other threshold is not open", () => {
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
    for (const d of DISTRICT_THRESHOLDS) {
      if (d.name !== "STAGE GROUNDS" && d.name !== "LISTENING GARDENS") {
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
});
