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
 *     wall's gap at x −1.1…1.1). The gold bar across names the
 *     closure — the district is coming, the gap is real, and the
 *     walk rects end at the wall, so the bar is the truth.
 *   - "marker" — a named district MARKER, not a doorway: one
 *     grounded signpost (plinth, post, plate mounted ON the post,
 *     a small COMING plate under the name). No span, no header,
 *     no bar — nothing about it suggests you could walk through
 *     it. The east pair stand on the open plaza floor in front of
 *     the wall they used to be painted on; the promenade pair
 *     keep their Phase-1 spots, rebuilt as signposts.
 *
 * The six district names are Phase 1's and do not change. The
 * districts themselves are a later pick (board items 31–36) —
 * nothing beyond a gate or marker is built here.
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
   *  shipped east bars did — but only where a gap is real). */
  barDx?: number;
  barDz?: number;
}

/** The small plate every threshold carries under its name — the
 *  Phase-1 honesty, lettered: the district is COMING, not open. */
export const DISTRICT_SUBPLATE = "COMING";

export const DISTRICT_THRESHOLDS: DistrictThreshold[] = [
  /* True gates — real gaps in real walls. The west wall runs
   * z 12.4–18.4 and 20.6–34.0 (hall-scene's lowWall calls), so
   * its gap centres z 19.5; the south wall runs x −28.2…−1.1
   * and 1.1…2.35 across the promenade span, so its gap centres
   * x 0. */
  { name: "STAGE GROUNDS", kind: "gate", x: -28.2, z: 19.5, axis: "z", plateRotY: Math.PI / 2, barDx: 0.22, barDz: 0 },
  { name: "THE BOARDWALK", kind: "gate", x: 0, z: 34.0, axis: "x", plateRotY: Math.PI },
  /* Markers — the east pair, off the wall and on the floor as
   * signposts a walker reads, not a door they try. x 27.0 stands
   * a clear metre west of the east wall's plaza face (28.025). */
  { name: "CREATION ROW", kind: "marker", x: 27.0, z: 14.5, axis: "z", plateRotY: -Math.PI / 2 },
  { name: "THE ATELIERS", kind: "marker", x: 27.0, z: 22.5, axis: "z", plateRotY: -Math.PI / 2 },
  /* Markers — the promenade pair, at their Phase-1 spots. */
  { name: "LISTENING GARDENS", kind: "marker", x: -26, z: 33.8, axis: "x", plateRotY: Math.PI },
  { name: "CREATOR HEIGHTS", kind: "marker", x: 13.5, z: 24.6, axis: "x", plateRotY: Math.PI },
];

/** The wall gaps the true gates stand in — the testable form of
 *  "a gate either stands at a real opening". Mirrors the lowWall
 *  runs in hall-scene's courtyard build; if a wall run moves, its
 *  gate must move with it or be reclassified a marker. */
export const DISTRICT_GATE_GAPS: Record<string, { axis: "x" | "z"; at: number; min: number; max: number }> = {
  "STAGE GROUNDS": { axis: "z", at: -28.2, min: 18.4, max: 20.6 },
  "THE BOARDWALK": { axis: "x", at: 34.0, min: -1.1, max: 1.1 },
};
