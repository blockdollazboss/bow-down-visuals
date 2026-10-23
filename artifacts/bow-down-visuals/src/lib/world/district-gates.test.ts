/**
 * district-gates — board item 37's honesty, pinned.
 *
 * Pins:
 * - the six Phase-1 district names survive, exactly six;
 * - only five thresholds are "gate"s, and each stands centred
 *   in a REAL wall gap (DISTRICT_GATE_GAPS) — a gate at a solid
 *   wall is the dishonesty this item removes;
 * - the one other is a "marker" (a signpost, not a doorway):
 *   markers stand OFF the walls on open floor, and no marker
 *   carries gate parts in the data (no bar offsets);
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
     * the south wall on its old marker's line. DELIBERATELY
     * moved again in item 33: the Creation Row gate joined —
     * its district is built, through a real new gap in the east
     * wall on its old marker's line. DELIBERATELY moved again
     * in item 34: the Ateliers gate joined — its district is
     * built south of Creation Row, through a real new gap in
     * the east wall's south run (not on its old marker's line:
     * east of z 22.5 is the Row's built quarter). */
    expect(gates.map((g) => g.name)).toEqual(["STAGE GROUNDS", "THE BOARDWALK", "CREATION ROW", "THE ATELIERS", "LISTENING GARDENS"]);
    for (const gate of gates) {
      const gap = DISTRICT_GATE_GAPS[gate.name]!;
      expect(gap.axis).toBe(gate.axis);
      const along = gate.axis === "x" ? gate.x : gate.z;
      const at = gate.axis === "x" ? gate.z : gate.x;
      expect(at).toBe(gap.at);
      expect(along).toBe((gap.min + gap.max) / 2);
    }
  });

  it("the other one is a grounded marker, not a doorway", () => {
    const markers = DISTRICT_THRESHOLDS.filter((d) => d.kind === "marker");
    /* DELIBERATELY moved in item 32: LISTENING GARDENS left the
     * markers — it is an open gate now (below). DELIBERATELY
     * moved in item 33: CREATION ROW left the markers the same
     * way. DELIBERATELY moved in item 34: THE ATELIERS left the
     * markers the same way — CREATOR HEIGHTS is the last one. */
    expect(markers.map((m) => m.name)).toEqual([
      "CREATOR HEIGHTS",
    ]);
    for (const m of markers) {
      /* No closure bar — a marker has nothing to close. */
      expect(m.barDx).toBeUndefined();
      expect(m.barDz).toBeUndefined();
    }
  });

  it("items 31+32+33+34+35: the Stage Grounds, Listening Gardens, Creation Row, Ateliers and Boardwalk gates are OPEN — their districts are built; every other threshold is not open", () => {
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
    for (const d of DISTRICT_THRESHOLDS) {
      if (d.name !== "STAGE GROUNDS" && d.name !== "LISTENING GARDENS" && d.name !== "CREATION ROW" && d.name !== "THE ATELIERS" && d.name !== "THE BOARDWALK") {
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
