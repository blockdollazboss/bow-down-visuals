/**
 * district-gates.ts — the six district thresholds of the King's
 * Plaza, classified HONESTLY (overhaul stage B, board item 37;
 * audit geometry #13).
 *
 * The shipped plaza stamped one gate kit six times. Four of the
 * six lied:
 *   - CREATION ROW and THE ATELIERS stood their posts and bar ON
 *     the east wall's face — a doorway painted onto solid wall,
 *     implying a passage that does not exist (the east wall runs
 *     unbroken z 12.4–26.0 behind them).
 *   - LISTENING GARDENS and CREATOR HEIGHTS stood freestanding in
 *     open floor as fake doorways, their name plates floating
 *     above the header with nothing holding them up.
 *
 * The honest classification, and the only two builds the scene
 * may make from it:
 *   - "gate" — a true threshold: the posts flank a REAL gap in a
 *     real wall (the west wall's gap at z 18.4–20.6, the south
 *     wall's gap at x −1.1…1.1). A CLOSED gate's gold bar across
 *     names the closure — the district is coming, the gap is
 *     real, and the walk rects end at the wall, so the bar is
 *     the truth. An OPEN gate (`open: true`) is a true passage:
 *     no bar, an OPEN plate under the name, and the walk truth
 *     (palace-layout's portal) runs through the gap into the
 *     built district beyond.
 *   - "marker" — a named district MARKER, not a doorway: one
 *     grounded signpost (plinth, post, plate mounted ON the post,
 *     a small COMING plate under the name). No span, no header,
 *     no bar — nothing about it suggests you could walk through
 *     it. The east pair stand on the open plaza floor in front of
 *     the wall they used to be painted on; the Creator Heights
 *     marker keeps its Phase-1 spot, rebuilt as a signpost.
 *
 * The six district names are Phase 1's and do not change. The
 * Stage Grounds (board item 31), the Listening Gardens
 * (board item 32) and Creation Row (board item 33) are BUILT
 * and their gates are open — the Gardens' marker was
 * reclassified when its district was built: it stood at
 * (−26, 33.8) on the promenade, and the gate now stands in a
 * REAL new gap in the south wall on that same line (x −26, gap
 * x −27.1…−24.9). Creation Row's marker was reclassified the
 * same way: it stood at (27.0, 14.5) on the plaza floor, and
 * the gate now stands in a REAL new gap in the east wall on
 * that same line (z 14.5, gap z 13.4…15.6). The remaining
 * districts are later picks (board items 34–36) — nothing
 * beyond their gates or markers is built yet.
 */

export type DistrictThresholdKind = "gate" | "marker";

export interface DistrictThreshold {
  name: string;
  kind: DistrictThresholdKind;
  x: number;
  z: number;
  /** The wall the threshold belongs to: "x" = a wall running
   *  along X at z = const (threshold spans X); "z" = a wall
   *  running along Z at x = const (threshold spans Z). For a
   *  marker this is only the direction its plate faces across. */
  axis: "x" | "z";
  /** Yaw of the name plate — it faces the plaza's walkers. */
  plateRotY: number;
  /** Gates only: the closure bar's offset toward the plaza face
   *  of the wall (the bar rides the wall's inner face, as the
   *  shipped east bars did — but only where a gap is real).
   *  Meaningless on an OPEN gate: it carries no bar. */
  barDx?: number;
  barDz?: number;
  /** Gates only: the district beyond is BUILT and this gate is a
   *  true passage — no bar, the sub-plate reads OPEN, and
   *  palace-layout's walk truth runs through the gap. Absent =
   *  the gate is closed and the district is still coming. */
  open?: boolean;
}

/** The small plate every CLOSED threshold carries under its name
 *  — the Phase-1 honesty, lettered: the district is COMING, not
 *  open. */
export const DISTRICT_SUBPLATE = "COMING";

/** The sub-plate an OPEN gate carries instead: the district
 *  beyond it is built, and the gate is a passage, not a promise. */
export const DISTRICT_OPEN_SUBPLATE = "OPEN";

export const DISTRICT_THRESHOLDS: DistrictThreshold[] = [
  /* True gates — real gaps in real walls. The west wall runs
   * z 12.4–18.4 and 20.6–34.0 (hall-scene's lowWall calls), so
   * its gap centres z 19.5; the south wall runs x −28.2…−1.1
   * and 1.1…2.35 across the promenade span, so its gap centres
   * x 0. */
  /* The Stage Grounds are BUILT (item 31): this gate is OPEN —
   * a true passage through the west wall's real gap into the
   * stage quarter beyond. No bar; the sub-plate reads OPEN. */
  { name: "STAGE GROUNDS", kind: "gate", x: -28.2, z: 19.5, axis: "z", plateRotY: Math.PI / 2, barDx: 0.22, barDz: 0, open: true },
  { name: "THE BOARDWALK", kind: "gate", x: 0, z: 34.0, axis: "x", plateRotY: Math.PI },
  /* The Creation Row is BUILT (item 33): the east pair's north
   * marker is reclassified — this gate is OPEN, a true passage
   * through a REAL new gap in the east wall on the marker's own
   * line (z 14.5). No bar; the sub-plate reads OPEN. */
  { name: "CREATION ROW", kind: "gate", x: 28.2, z: 14.5, axis: "z", plateRotY: -Math.PI / 2, barDx: -0.22, barDz: 0, open: true },
  /* Marker — the east wall's remaining signpost, off the wall
   * and on the floor as a signpost a walker reads, not a door
   * they try. x 27.0 stands a clear metre west of the east
   * wall's plaza face (28.025). */
  { name: "THE ATELIERS", kind: "marker", x: 27.0, z: 22.5, axis: "z", plateRotY: -Math.PI / 2 },
  /* The Listening Gardens are BUILT (item 32): the promenade
   * marker is reclassified — this gate is OPEN, a true passage
   * through a REAL new gap in the south wall on the marker's own
   * line (x −26). No bar; the sub-plate reads OPEN. */
  { name: "LISTENING GARDENS", kind: "gate", x: -26, z: 34.0, axis: "x", plateRotY: Math.PI, barDx: 0, barDz: -0.22, open: true },
  /* Marker — the promenade's remaining signpost, at its
   * Phase-1 spot. */
  { name: "CREATOR HEIGHTS", kind: "marker", x: 13.5, z: 24.6, axis: "x", plateRotY: Math.PI },
];

/** The wall gaps the true gates stand in — the testable form of
 *  "a gate either stands at a real opening". Mirrors the lowWall
 *  runs in hall-scene's courtyard build; if a wall run moves, its
 *  gate must move with it or be reclassified a marker. */
export const DISTRICT_GATE_GAPS: Record<string, { axis: "x" | "z"; at: number; min: number; max: number }> = {
  "STAGE GROUNDS": { axis: "z", at: -28.2, min: 18.4, max: 20.6 },
  "THE BOARDWALK": { axis: "x", at: 34.0, min: -1.1, max: 1.1 },
  "LISTENING GARDENS": { axis: "x", at: 34.0, min: -27.1, max: -24.9 },
  "CREATION ROW": { axis: "z", at: 28.2, min: 13.4, max: 15.6 },
};
