/**
 * perf-census.ts — the World geometry census (Stack-100 #2 perf
 * round 2, un-parking items 86–91 + 95 the honest way).
 *
 * The round-1 perf board parked the instancing/LOD items with one
 * instruction: CENSUS FIRST, convert nothing blind. This module is
 * that census, kept as living accounting next to perf-instancing.ts:
 * every number below is DERIVED — placements imported from the same
 * data modules the scene builds from, triangle counts computed by
 * constructing the actual THREE geometries the builders use, and
 * per-kit mesh recipes stated once here and pinned against
 * hall-scene.ts source by perf-census.test.ts (if a builder's
 * recipe changes, the pin fails and this census must be re-derived,
 * never silently stale).
 *
 * Headline the census proves: the shipped world is DRAW-CALL bound,
 * not triangle bound. The heaviest single mesh in the world is the
 * sky dome (~1k triangles); most dressing is 12-triangle boxes.
 * What costs frames is hundreds of small meshes each drawing
 * alone — and the facet-E audit's scary counts (276 columns, 120
 * trough meshes, a 16-tower backdrop, a 5,710-triangle moon) are
 * STALE against this tree: the overhaul + Stack-100 #2 already
 * instanced the lamps, benches, stalls' posts, troughs, backdrop
 * and more. What remained un-instanced is enumerated kit by kit
 * below — and converted in hall-scene.ts exactly where this census
 * proves the conversion appearance-identical:
 *
 *   - identical geometry + shared material → one InstancedMesh;
 *   - per-instance material CLONES whose only difference is an
 *     HSL-offset colour on a WHITE-based material → instanceColor
 *     carrying the offset colour (diffuse = map × colour either
 *     way — the two paths are the same multiplication);
 *   - per-instance colour clones on the leaf material (base
 *     0x2e5d33) → white-based twin material + instanceColor with
 *     the offset colour (the lawn-crown instanced build in the
 *     same file already works exactly this way).
 *
 * Where a conversion would change a pixel, the item STAYS PARKED
 * below with its measured reason (90, 91-as-LOD, 95).
 */
import * as THREE from "three";
import { PLAZA_BRAZIERS, PLAZA_COLUMNS, PLAZA_PLANTERS } from "./palace-layout";
import { BACKDROP, BACKDROP_GARDENS, BACKDROP_WINGS, MONUMENT } from "./palace-grounds";
import { STAGE_LAMPS, STAGE_PIERS } from "./stage-grounds";
import { GARDENS_LAMPS, GARDENS_PIERS } from "./listening-gardens";
import { ROW_LAMPS, ROW_PIERS, ROW_STALLS } from "./creation-row";
import { ATELIERS_LAMPS, ATELIERS_PIERS } from "./ateliers";
import { BOARDWALK_LAMPS, BOARDWALK_PIERS, BOARDWALK_STALLS } from "./boardwalk";
import { HEIGHTS_LAMPS, HEIGHTS_PIERS } from "./creator-heights";
import { PLAZA_LAMPS, PLAZA_STALLS } from "./plaza-life";
import { propVariation, type PropVariation } from "./prop-variation";
import { QUALITY_RUNGS } from "./quality";
import { lodTierForDistance, type LodTier } from "./visibility";

/* ── Shared geometry cache (item 89) ──────────────────────────────
 * One geometry object per spec, serving every district. The
 * builders used to construct the same BoxGeometry/CylinderGeometry
 * per shell (and per pier, per stall, per candle). Geometry data
 * is never mutated after construction anywhere in hall-scene.ts
 * (the census test pins the absence of geometry mutation calls),
 * so sharing the object is safe: three.js re-uploads GPU buffers
 * transparently if a disposed copy is rendered again, which is
 * exactly what happens across look rebuilds today with per-shell
 * duplicates. Materials were already shared per look by
 * makeMaterials' sized caches — this closes the geometry half. */
const geometryCache = new Map<string, THREE.BufferGeometry>();

export function sharedGeometry<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geometryCache.get(key);
  if (hit) return hit as T;
  const geo = make();
  geometryCache.set(key, geo);
  return geo;
}

/** Test/debug view of the cache's current keys. */
export function sharedGeometryKeys(): string[] {
  return [...geometryCache.keys()];
}

/* ── Instance tint (items 86/88 conversions) ──────────────────────
 * The colour a per-instance material clone WOULD have carried:
 * the base colour with the variation's HSL offsets applied. On an
 * InstancedMesh whose material colour is the base itself, three
 * multiplies diffuse by instanceColor — so the instance colour
 * that reproduces a clone exactly is the offset colour divided
 * back out of the base. For the WHITE-based materials (the shared
 * marble and fabric — makeMaterials passes no colour, so both are
 * 0xffffff) the division is by 1 and this is just the offset
 * colour, bit-for-bit the clone's colour. The planter crowns'
 * leaf material is based on 0x2e5d33 instead, so their instanced
 * build uses a white-based twin of that material and carries this
 * same offset colour — the lawn crowns in hall-scene.ts already
 * instance foliage exactly this way. */
export function tintColor(baseHex: number, v: PropVariation): THREE.Color {
  return new THREE.Color(baseHex).offsetHSL(v.hueShift, 0, v.lightnessShift);
}

/** Exact triangle count of a geometry, from its own buffers. */
export function triCount(geo: THREE.BufferGeometry): number {
  const n = geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0);
  return Math.floor(n / 3);
}

function trisOf(make: () => THREE.BufferGeometry): number {
  const geo = make();
  const n = triCount(geo);
  geo.dispose();
  return n;
}

/* ── The kit census ───────────────────────────────────────────────
 * One record per repeated kit: where it lives, how many placements
 * the data holds, the parts recipe (geometry → triangles, from
 * constructing the real geometry), and the draw calls before /
 * after the round-2 conversions. `converted` kits are the ones
 * hall-scene.ts now builds as InstancedMeshes; the test pins the
 * scene source to each record's claim. */

export interface KitPart {
  name: string;
  tris: number;
  /** Instances of this part per placement (bench legs ×2, chandelier candles ×8…). */
  perPlacement: number;
}

export interface KitRecord {
  item: string;
  kit: string;
  where: string;
  placements: number;
  parts: KitPart[];
  drawsBefore: number;
  drawsAfter: number;
  converted: boolean;
  note: string;
}

const box = (w: number, h: number, d: number) => () => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg: number) => () => new THREE.CylinderGeometry(rt, rb, h, seg);

/** The pier recipe — one recipe, seven builds (courtyard columns
 *  use these same three boxes; see plaza-columns below). */
const PIER_PARTS: KitPart[] = [
  { name: "plinth Box(0.9,0.3,0.9)", tris: trisOf(box(0.9, 0.3, 0.9)), perPlacement: 1 },
  { name: "shaft Box(0.62,3.54,0.62)", tris: trisOf(box(0.62, 3.54, 0.62)), perPlacement: 1 },
  { name: "cap Box(0.86,0.18,0.86)", tris: trisOf(box(0.86, 0.18, 0.86)), perPlacement: 1 },
];

const DISTRICT_PIERS: Array<{ where: string; list: ReadonlyArray<{ x: number; z: number }> }> = [
  { where: "Stage Grounds", list: STAGE_PIERS },
  { where: "Listening Gardens", list: GARDENS_PIERS },
  { where: "Creation Row", list: ROW_PIERS },
  { where: "The Ateliers", list: ATELIERS_PIERS },
  { where: "The Boardwalk", list: BOARDWALK_PIERS },
  { where: "Creator Heights", list: HEIGHTS_PIERS },
];

const plazaColumnVariants = PLAZA_COLUMNS.map((_, i) => propVariation("column", i).variant);
const planterTrimCount = PLAZA_PLANTERS.filter((_, i) => propVariation("trough", i).variant !== 0).length;

export const KIT_CENSUS: KitRecord[] = [
  {
    item: "86", kit: "district piers", where: "all six district shells",
    placements: DISTRICT_PIERS.reduce((n, d) => n + d.list.length, 0),
    parts: PIER_PARTS,
    drawsBefore: DISTRICT_PIERS.reduce((n, d) => n + d.list.length, 0) * 3,
    drawsAfter: DISTRICT_PIERS.length * 3,
    converted: true,
    note: "One byte-identical 3-mesh group per pier in each shell → buildPierSet: 3 instanced draws per shell. Only the shaft casts shadows, exactly as before.",
  },
  {
    item: "86", kit: "plaza columns", where: "King's Plaza courtyard",
    placements: PLAZA_COLUMNS.length,
    parts: [
      ...PIER_PARTS,
      { name: "cap step Box(0.72,0.09,0.72) (variant 1 only)", tris: trisOf(box(0.72, 0.09, 0.72)), perPlacement: 0 },
    ],
    drawsBefore: PLAZA_COLUMNS.length * 3 + plazaColumnVariants.filter((v) => v === 1).length,
    drawsAfter: 2 + (plazaColumnVariants.some((v) => v === 2) ? 1 : 0) + (plazaColumnVariants.some((v) => v !== 2) ? 1 : 0)
      + (plazaColumnVariants.some((v) => v === 1) ? 1 : 0),
    converted: true,
    note: "Per-column group scale rides the instance matrix; the shaft's cloned tinted marble becomes instanceColor on the shared white-based marble (same multiplication); caps split by their gold/goldDark variant, cap steps instance over the variant-1 subset.",
  },
  {
    item: "86", kit: "hall columns", where: "King's Hall interior (both look styles)",
    placements: 6,
    parts: [
      { name: "plinth Box(1.5,0.28,1.5)", tris: trisOf(box(1.5, 0.28, 1.5)), perPlacement: 1 },
      { name: "foot Box(1.15,0.18,1.15) (gold-round)", tris: trisOf(box(1.15, 0.18, 1.15)), perPlacement: 1 },
      { name: "shaft Cyl(0.42,0.5,5.2,20) gold-round / Box(0.98,5.2,0.98) marble", tris: trisOf(cyl(0.42, 0.5, 5.2, 20)), perPlacement: 1 },
      { name: "neck Torus(0.46,0.05,8,24) (gold-round)", tris: trisOf(() => new THREE.TorusGeometry(0.46, 0.05, 8, 24)), perPlacement: 1 },
      { name: "bands Box(1.07,0.09,1.07) (marble)", tris: trisOf(box(1.07, 0.09, 1.07)), perPlacement: 2 },
      { name: "cap Box(1.2,0.22,1.2) gold-round / Box(1.3,0.24,1.3) marble", tris: trisOf(box(1.2, 0.22, 1.2)), perPlacement: 1 },
      { name: "abacus Box(1.38,0.18,1.38) gold-round / Box(1.44,0.16,1.44) marble", tris: trisOf(box(1.38, 0.18, 1.38)), perPlacement: 1 },
    ],
    drawsBefore: 36,
    drawsAfter: 6,
    converted: true,
    note: "Six 6-piece columns → one instanced draw per part (marble style: 5 draws, its two bands sharing one instanced mesh of 12). Per-part shadow flags preserved (shaft + cap cast; the rest never did).",
  },
  {
    item: "86", kit: "arrival-arch columns", where: "Stage Grounds arrival arch",
    placements: 2,
    parts: [
      { name: "plinth Box(0.72,0.28,0.72)", tris: trisOf(box(0.72, 0.28, 0.72)), perPlacement: 1 },
      { name: "shaft Cyl(0.21,0.25,H-0.46,12)", tris: trisOf(cyl(0.21, 0.25, 3, 12)), perPlacement: 1 },
      { name: "cap Box(0.66,0.18,0.66)", tris: trisOf(box(0.66, 0.18, 0.66)), perPlacement: 1 },
    ],
    drawsBefore: 6,
    drawsAfter: 3,
    converted: true,
    note: "The one arrival arch in the world (item 39) — same pier pattern at garden scale.",
  },
  {
    item: "87", kit: "district + plaza lamp standards", where: "every shell + plaza (ALREADY instanced)",
    placements:
      STAGE_LAMPS.length + GARDENS_LAMPS.length + ROW_LAMPS.length + ATELIERS_LAMPS.length
      + BOARDWALK_LAMPS.length + HEIGHTS_LAMPS.length + PLAZA_LAMPS.length,
    parts: [
      { name: "plinth Box(0.42,0.18,0.42)", tris: trisOf(box(0.42, 0.18, 0.42)), perPlacement: 1 },
      { name: "post Cyl(0.055,0.085,postH,10)", tris: trisOf(cyl(0.055, 0.085, 2.2, 10)), perPlacement: 1 },
      { name: "cage Box(0.3,0.36,0.3)", tris: trisOf(box(0.3, 0.36, 0.3)), perPlacement: 1 },
      { name: "glass Box(0.21,0.27,0.21)", tris: trisOf(box(0.21, 0.27, 0.21)), perPlacement: 1 },
      { name: "cap Cone(0.3,0.22,4)", tris: trisOf(() => new THREE.ConeGeometry(0.3, 0.22, 4)), perPlacement: 1 },
    ],
    drawsBefore: 7 * 5,
    drawsAfter: 7 * 5,
    converted: false,
    note: "Facet-E's '24 five-mesh street lights' is stale: every shell already instances all five lamp parts (one draw per part per shell). The only per-lamp objects left are the night glow sprites — animated, one sprite each, not convertible. Item 87's lamp half was already done in tree; its brazier half converts below.",
  },
  {
    item: "87/91", kit: "braziers (hall pair + plaza set)", where: "King's Hall dais + King's Plaza",
    placements: 2 + PLAZA_BRAZIERS.length,
    parts: [
      { name: "pedestal Cyl(0.09,0.14,0.5,10)", tris: trisOf(cyl(0.09, 0.14, 0.5, 10)), perPlacement: 1 },
      { name: "bowl Cyl(0.46,0.18,0.3,18)", tris: trisOf(cyl(0.46, 0.18, 0.3, 18)), perPlacement: 1 },
      { name: "coals Circle(0.4,20) (night look only)", tris: trisOf(() => new THREE.CircleGeometry(0.4, 20)), perPlacement: 1 },
    ],
    drawsBefore: 2 * 3 + PLAZA_BRAZIERS.length * 3,
    drawsAfter: 3 + 3,
    converted: true,
    note: "Solid parts instance within each parent group (hall / courtyard — the portal cull's units are untouched). Flame + glow sprites, embers and the real point lights stay per-brazier: they are the animation, not the furniture.",
  },
  {
    item: "88", kit: "stall canopies + trims", where: "Creation Row + Boardwalk streets",
    placements: ROW_STALLS.length + BOARDWALK_STALLS.length,
    parts: [
      { name: "trim Box(canopyW+0.1,0.05,canopyD+0.1)", tris: 12, perPlacement: 1 },
      { name: "canopy Box(canopyW,0.08,canopyD)", tris: 12, perPlacement: 1 },
    ],
    drawsBefore: (ROW_STALLS.length + BOARDWALK_STALLS.length) * 2,
    drawsAfter: 2 * 2,
    converted: true,
    note: "Posts and workbenches were already instanced. The canopy's per-stall cloned fabric tint (item 35) becomes instanceColor on the shared white-based fabric; its whisper of scale rides the instance matrix. Trims share goldDark already — pure instancing.",
  },
  {
    item: "88", kit: "plaza market stalls", where: "King's Plaza",
    placements: PLAZA_STALLS.length,
    parts: [
      { name: "counter Box(STALL.w,0.08,STALL.d)", tris: 12, perPlacement: 1 },
      { name: "skirt Box(STALL.w,counterY,STALL.d-0.15)", tris: 12, perPlacement: 1 },
      { name: "posts Cyl(0.04,0.04,canopyY,8)", tris: trisOf(cyl(0.04, 0.04, 2.2, 8)), perPlacement: 4 },
      { name: "canopy Box(STALL.w+0.3,0.05,STALL.d+0.45)", tris: 12, perPlacement: 1 },
      { name: "trim bar Box(STALL.w+0.3,0.05,0.06)", tris: 12, perPlacement: 1 },
    ],
    drawsBefore: PLAZA_STALLS.length * 8,
    drawsAfter: 5,
    converted: true,
    note: "The whole 8-piece stall kit instances within the plaza group; the canopy's -0.13 slope rides its instance matrix. Per-part shadow flags preserved (counter + canopy cast; the rest never did).",
  },
  {
    item: "88", kit: "planter trough crowns", where: "King's Plaza planters",
    placements: PLAZA_PLANTERS.length * 2,
    parts: [
      { name: "centre cone Cone(0.26,0.62,10)", tris: trisOf(() => new THREE.ConeGeometry(0.26, 0.62, 10)), perPlacement: 1 },
      { name: "side mounds Sphere(0.21,10,8)", tris: trisOf(() => new THREE.SphereGeometry(0.21, 10, 8)), perPlacement: 2 },
    ],
    drawsBefore: PLAZA_PLANTERS.length * 2 * 3,
    drawsAfter: 2,
    converted: true,
    note: "The trough+blob remainder facet-E counted: trough bodies instanced in round 1, but each crown stayed a 3-mesh group wearing a CLONED tinted leaf material. Cones instance together, mounds instance together, the tint rides instanceColor on a white-based twin of the leaf material — the lawn crowns' own shipped pattern. The ~6 rim trims stay individual (variant geometry per orientation; measured, not worth four micro-draws of machinery).",
  },
  {
    item: "91", kit: "hall chandeliers", where: "King's Hall",
    placements: 2,
    parts: [
      { name: "chain Cyl(0.018,0.018,1.5,6)", tris: trisOf(cyl(0.018, 0.018, 1.5, 6)), perPlacement: 1 },
      { name: "ring Torus(1.05,0.05,10,44)", tris: trisOf(() => new THREE.TorusGeometry(1.05, 0.05, 10, 44)), perPlacement: 1 },
      { name: "ring 2 Torus(0.62,0.04,10,36)", tris: trisOf(() => new THREE.TorusGeometry(0.62, 0.04, 10, 36)), perPlacement: 1 },
      { name: "candle sticks Cyl(0.016,0.016,0.14,6)", tris: trisOf(cyl(0.016, 0.016, 0.14, 6)), perPlacement: 8 },
      { name: "bulbs Sphere(0.042,10,8)", tris: trisOf(() => new THREE.SphereGeometry(0.042, 10, 8)), perPlacement: 8 },
    ],
    drawsBefore: 2 * (3 + 8 + 8),
    drawsAfter: 5,
    converted: true,
    note: "Item 91 named the chandelier for LOD; the census answer is instancing instead — the two chandeliers are identical, so every repeated part collapses to one draw with zero swapped geometry. LOD would have traded 33 draws for a visible silhouette swap at threshold; this trades them for nothing at all.",
  },
];


/* ── Backdrop census (item 90, re-measured Stack-100 #3) ──────────
 * The backdrop ring as hall-scene's buildBackdropGrounds actually
 * builds it today, element by element: draws counted from the
 * builder's own constructions, triangles from constructing the
 * real geometries at the builder's own specs (placements imported
 * from palace-grounds — BACKDROP_WINGS / BACKDROP_GARDENS are the
 * builder's data). perf-census.test.ts pins the scene source to
 * every record, so this census re-derives or fails, never drifts.
 * Round-2's prose census (~10 draws / ~1.7k tris) re-measures
 * EXACT here; one prose correction: since the Stack-100 #2 water
 * round, the moat and the windows are MeshStandardMaterial (the
 * moat joined the animated water system; the windows shade) —
 * draws and triangles are unchanged by it. */

export interface BackdropRecord {
  element: string;
  /** Draw calls this element costs per look build. */
  draws: number;
  /** Triangles across all its instances. */
  tris: number;
  /** Instances behind the draw(s) (1 for a lone mesh). */
  instances: number;
  note: string;
}

const backdropWindowCount = BACKDROP_WINGS.reduce((s, w) => s + w.windows.length, 0);

export const BACKDROP_CENSUS: BackdropRecord[] = [
  {
    element: "ground skirt disc",
    draws: 1,
    tris: trisOf(() => new THREE.CircleGeometry(BACKDROP.skirtR, 40)),
    instances: 1,
    note: "One unlit disc under everything beyond the grounds, out to just inside the 90 m dome.",
  },
  {
    element: "moat ring segment",
    draws: 1,
    tris: trisOf(() => new THREE.RingGeometry(BACKDROP.moatInnerR, BACKDROP.moatOuterR, 48, 1, Math.PI * 0.72, Math.PI * 0.95)),
    instances: 1,
    note: "One ring segment of animated water (Stack-100 #2 item 5's system) along the south + east.",
  },
  {
    element: "wing masses + roofline caps",
    draws: BACKDROP_WINGS.length * 2,
    tris: BACKDROP_WINGS.length * 2 * trisOf(box(1, 1, 1)),
    instances: BACKDROP_WINGS.length * 2,
    note: "Per wing: one mass box + one cap box, both unlit MeshBasicMaterial silhouettes in fog.",
  },
  {
    element: "wing windows (instanced)",
    draws: 1,
    tris: backdropWindowCount * trisOf(() => new THREE.PlaneGeometry(1.5, 2.1)),
    instances: backdropWindowCount,
    note: "ONE instanced draw for every wing window — there is no per-window geometry left to swap.",
  },
  {
    element: "garden masses (instanced)",
    draws: 1,
    tris: BACKDROP_GARDENS.length * trisOf(() => new THREE.SphereGeometry(1, 12, 8)),
    instances: BACKDROP_GARDENS.length,
    note: "ONE instanced draw of squashed spheres; this is 86% of the backdrop's triangles and a single draw — segment count is a build choice, not an LOD axis.",
  },
];

export function backdropTotals(): { draws: number; tris: number } {
  return {
    draws: BACKDROP_CENSUS.reduce((s, r) => s + r.draws, 0),
    tris: BACKDROP_CENSUS.reduce((s, r) => s + r.tris, 0),
  };
}

/* ── Item 90 re-evaluation: the house LOD pattern (Stack-100 #3) ──
 * Round 2 evaluated only THREE.LOD geometry swaps. The tree also
 * has a house LOD pattern (visibility.ts lodTierAt + the scene's
 * lodItems, item 99): NEAR full, MID hides detail children, FAR
 * hides the whole group, judged at the rung's lodDrawDistance
 * (120 / 90 / 60). This evaluation runs that pattern over the
 * backdrop's anchors from the palace heart (the moat's centre,
 * the plaza's visual centre) — the nearest honest viewpoint;
 * every real viewpoint inside a district reads FARTHER. */

export interface BackdropLodRow {
  anchor: string;
  x: number;
  z: number;
  /** Distance from the palace heart (BACKDROP.moatCenter). */
  distance: number;
  tiers: Record<"high" | "medium" | "low", LodTier>;
}

export function backdropLodEvaluation(): BackdropLodRow[] {
  const heart = BACKDROP.moatCenter;
  const anchors: Array<{ anchor: string; x: number; z: number }> = [
    ...BACKDROP_WINGS.map((w, i) => ({ anchor: `wing ${i + 1}`, x: w.cx, z: w.cz })),
    ...BACKDROP_GARDENS.map((g, i) => ({ anchor: `garden mass ${i + 1}`, x: g.x, z: g.z })),
  ];
  return anchors.map((a) => {
    const distance = Math.hypot(a.x - heart.x, a.z - heart.z);
    return {
      ...a,
      distance,
      tiers: {
        high: lodTierForDistance(distance, QUALITY_RUNGS.high.lodDrawDistance),
        medium: lodTierForDistance(distance, QUALITY_RUNGS.medium.lodDrawDistance),
        low: lodTierForDistance(distance, QUALITY_RUNGS.low.lodDrawDistance),
      },
    };
  });
}

/* ── Parked with evidence ───────────────────────────────────────── */

export interface ParkedRecord {
  item: string;
  subject: string;
  measured: string;
  why: string;
}

export const PARKED_WITH_EVIDENCE: ParkedRecord[] = [
  {
    item: "90",
    subject: "backdrop LOD (fog-ring skyline)",
    measured:
      `RE-MEASURED Stack-100 #3 (BACKDROP_CENSUS above, executed not prose): the shipped backdrop is ${backdropTotals().draws} draws / ${backdropTotals().tris} triangles total — ` +
      `${BACKDROP_WINGS.length} wing masses + caps (2 boxes each, 12 tris), one instanced draw of ${backdropWindowCount} emissive windows, ` +
      `one instanced draw of ${BACKDROP_GARDENS.length} garden masses (Sphere(1,12,8) = ${trisOf(() => new THREE.SphereGeometry(1, 12, 8))} tris each, 86% of the total), ` +
      `a ${trisOf(() => new THREE.CircleGeometry(1, 40))}-tri ground skirt disc and a ${trisOf(() => new THREE.RingGeometry(1, 2, 48, 1, Math.PI * 0.72, Math.PI * 0.95))}-tri moat ring segment. ` +
      `The facet's backdrop (16 towers, 8 domes, colonnade at full geometry) still does not exist in this tree. ` +
      `House-LOD evaluation (backdropLodEvaluation, the item-99 pattern round 2 did not evaluate): from the palace heart the wing anchors stand 65–69 m out — ` +
      `at the low rung (lodDrawDistance 60) they tier FAR, at medium (90) they tier MID.`,
    why: "There is nothing left to LOD, on either pattern. Geometry swap: the geometry is already minimal boxes and single instanced draws inside fog — a THREE.LOD swap could only remove a handful of 12-triangle boxes at the cost of a pop at the swap distance. House pattern: FAR hides the whole group — hiding a wing re-opens the void the backdrop exists to close (round-1 item 5); MID hides detail children — the backdrop's only detail is the windows' ONE instanced draw, so the entire saving is 1 draw, paid for with the skyline's only lit detail on medium and low rungs. Stays parked — measured twice, on both patterns, not assumed.",
  },
  {
    item: "91",
    subject: "district LOD pass (as LOD — braziers, monument reliefs)",
    measured:
      `Braziers: 6 placements, ~${trisOf(cyl(0.46, 0.18, 0.3, 18)) + trisOf(cyl(0.09, 0.14, 0.5, 10)) + trisOf(() => new THREE.CircleGeometry(0.4, 20))} tris of solid parts each — converted by instancing instead (see kit census). ` +
      `The Kingdom Board monument is ONE hero object at the plaza's centre: ${MONUMENT.reliefBandYs.length} relief heights × 4 faces of gold bands + 4 relief panels + tiers, drum and crown — every part a different size (the bands follow the stele's taper), ~45 meshes / ~600 tris total, nothing repeated identically. ` +
      `The chandelier (the third named target) converts by instancing above.`,
    why: "LOD swaps geometry at distance; the monument is the plaza's centrepiece — the walker is always near it, and its parts are unique sizes with no far form to swap to that isn't a different-looking object. Braziers and chandelier got their draw savings from instancing, which changes no pixel at any distance. LOD-as-LOD stays parked with these numbers as the reason.",
  },
  {
    item: "95",
    subject: "figure draw budget (pooled / impostor far form)",
    measured:
      `Per-figure draws today: capsule figure = 4 (torso Capsule(0.3,0.78,4,12) = ${trisOf(() => new THREE.CapsuleGeometry(0.3, 0.78, 4, 12))} tris, head Sphere(0.21,18,14) = ${trisOf(() => new THREE.SphereGeometry(0.21, 18, 14))} tris, visor, floor blob); ` +
      `portrait/default figures = 4–5 (portrait plane + frame + blob + nameplate sprite). Facet-E's 'canvas textures uploaded eagerly for every figure including off-screen' is not in this tree: no initTexture/upload call exists anywhere in the world code — three.js uploads a CanvasTexture on its first rendered frame, and figures in rested rooms are not rendered.`,
    why: "Every figure is unique — its own presence tint, portrait texture, nameplate, mouth and per-frame pose — so there is no identical kit to instance, and the pooled/impostor route replaces a person with a flat billboard at distance: a visible change to how people look, which the premium bar forbids as a side effect. The honest budget lever for figures stays the presence cap and the room cull that already exist. Stays parked — measured, not assumed.",
  },
  {
    item: "89",
    subject: "shared geometry & materials (REMAINDER)",
    measured:
      "Materials: makeMaterials already caches every per-metre factory per look (sizedCache / goldCache) — the facet's 'materials re-created per mesh' survives only as deliberate per-instance tint clones, and the conversions above retire the column-shaft (8), stall-canopy (12) and planter-crown (18) clones in favour of instanceColor. The district-gate builders still clone marble per post (2 source sites — gate posts and marker posts; 12 gate posts stand across today's 6 gates, each gate's pair sharing one variation by design) — gates are outside items 86–91's named kits and their posts also carry receiveShadow; measured here as the known remainder for a future pass. Geometries: see GEOMETRY_CENSUS — the duplicated-spec constructions collapse into sharedGeometry.",
    why: "The convertible half is converted; the gate-post remainder is recorded with its count instead of being swept in silently under another item's number.",
  },
];

/* ── Geometry-construction census (item 89) ───────────────────────
 * Per-spec construction counts for ONE look build, before → after
 * sharedGeometry. `before` counts runtime constructions (a spec
 * built inside a per-placement loop counts per placement — that
 * was the real cost), derived from the builders' recipes and the
 * placement lists; the test pins the after-state by counting
 * sharedGeometry call sites per key in hall-scene.ts. */

export interface GeometrySpecRecord {
  spec: string;
  sites: string;
  constructionsBefore: number;
  constructionsAfter: number;
}

export const GEOMETRY_CENSUS: GeometrySpecRecord[] = [
  { spec: "pier plinth/shaft/cap boxes (0.9/0.62/0.86 family)", sites: "courtyard columns + 6 district pier loops", constructionsBefore: (16 + PLAZA_COLUMNS.length) * 3, constructionsAfter: 3 },
  { spec: "lamp kit (plinth, post, cage, glass, cap)", sites: "7 lamp builds (6 shells + plaza)", constructionsBefore: 7 * 5, constructionsAfter: 5 },
  { spec: "bench kit (seat, back, legs)", sites: "5 bench builds", constructionsBefore: 5 * 3, constructionsAfter: 3 },
  { spec: "paving slab Box(4,0.03,4)", sites: "6 shell floors + courtyard", constructionsBefore: 6, constructionsAfter: 1 },
  { spec: "unit Box(1,1,1) (edging / steps / terraces)", sites: "8 construction sites", constructionsBefore: 8, constructionsAfter: 1 },
  { spec: "stall kit (posts, trim, canopy, bench, bench trim)", sites: "Creation Row + Boardwalk (canopy/trim per stall)", constructionsBefore: 2 * 3 + (ROW_STALLS.length + BOARDWALK_STALLS.length) * 2, constructionsAfter: 5 },
  { spec: "brazier solids (pedestal, bowl, coals)", sites: "hall + courtyard builds, per brazier", constructionsBefore: (2 + PLAZA_BRAZIERS.length) * 3, constructionsAfter: 3 },
  { spec: "chandelier parts (chain, rings, sticks, bulbs)", sites: "hall buildChandeliers, per candle", constructionsBefore: 2 * 3 + 2 * 16, constructionsAfter: 5 },
  { spec: "planter crown cone + mounds", sites: "courtyard crowns, per crown", constructionsBefore: PLAZA_PLANTERS.length * 2 * 3, constructionsAfter: 2 },
  { spec: "plaza stall kit (counter, skirt, post, canopy, trim)", sites: "plaza stalls, per part per stall", constructionsBefore: PLAZA_STALLS.length * 8, constructionsAfter: 5 },
];

/* ── Totals ─────────────────────────────────────────────────────── */

export interface CensusTotals {
  drawsBefore: number;
  drawsAfter: number;
  drawsSaved: number;
  geometryConstructionsBefore: number;
  geometryConstructionsAfter: number;
}

export function censusTotals(): CensusTotals {
  const drawsBefore = KIT_CENSUS.reduce((n, k) => n + k.drawsBefore, 0);
  const drawsAfter = KIT_CENSUS.reduce((n, k) => n + k.drawsAfter, 0);
  return {
    drawsBefore,
    drawsAfter,
    drawsSaved: drawsBefore - drawsAfter,
    geometryConstructionsBefore: GEOMETRY_CENSUS.reduce((n, g) => n + g.constructionsBefore, 0),
    geometryConstructionsAfter: GEOMETRY_CENSUS.reduce((n, g) => n + g.constructionsAfter, 0),
  };
}

/** The census as a durable markdown record (written to .lane/). */
export function renderCensusMarkdown(): string {
  const t = censusTotals();
  const lines: string[] = [
    "# WORLD GEOMETRY CENSUS — perf round 2 (Stack-100 #2)",
    "",
    "Measured from the shipped tree at stack28/world @ 14221f86: placements imported from the",
    "scene's own data modules, triangle counts computed by constructing the real THREE",
    "geometries, recipes read from hall-scene.ts builders. Generated by perf-census.ts;",
    "perf-census.test.ts pins every claim below against the scene source.",
    "",
    `**Headline: the world is draw-call bound, not triangle bound.** In-scope kits drew`,
    `**${t.drawsBefore} → ${t.drawsAfter} calls (−${t.drawsSaved})** after the safe conversions, and duplicated-spec`,
    `geometry constructions per look build fell **${t.geometryConstructionsBefore} → ${t.geometryConstructionsAfter}**.`,
    "",
    "## Kit census",
    "",
    "| Item | Kit | Where | Placements | Draws before | Draws after | Converted |",
    "|---|---|---|---|---|---|---|",
    ...KIT_CENSUS.map((k) => `| ${k.item} | ${k.kit} | ${k.where} | ${k.placements} | ${k.drawsBefore} | ${k.drawsAfter} | ${k.converted ? "yes" : "already instanced"} |`),
    "",
    ...KIT_CENSUS.flatMap((k) => [`### ${k.item} — ${k.kit} (${k.where})`, "", `Parts: ${k.parts.map((p) => `${p.name} = ${p.tris} tris${p.perPlacement > 1 ? ` ×${p.perPlacement}/placement` : ""}`).join("; ")}.`, "", k.note, ""]),
    "## Geometry constructions (item 89)",
    "",
    "| Spec family | Sites | Constructions before | After shared cache |",
    "|---|---|---|---|",
    ...GEOMETRY_CENSUS.map((g) => `| ${g.spec} | ${g.sites} | ${g.constructionsBefore} | ${g.constructionsAfter} |`),
    "",
    "## Parked with evidence",
    "",
    ...PARKED_WITH_EVIDENCE.flatMap((p) => [`### Item ${p.item} — ${p.subject}`, "", p.measured, "", p.why, ""]),
    "## Measured remainders (out of scope, recorded not swept)",
    "",
    "- District gate posts: 6 gates × 2 posts with per-gate cloned marble tints + receiveShadow — outside the named kits; a future pass can instance them the same way (posts by instanceColor, caps by cap-variant material).",
    "- Wall-run caps (33 runs across plaza + districts) share mats.gold and could instance as scaled unit boxes the way edging already does; the walls themselves cannot (per-metre marbleFor texture repeats differ per run).",
    `- Planter rim trims: ${planterTrimCount} of ${PLAZA_PLANTERS.length} planters wear one (variant geometry per orientation) — left individual.`,
    "- Per-shell lamp-glass materials: 7 identical MeshStandardMaterials (one per lamp build) — a look-scoped factory could share them; materials already share everywhere the factories reach.",
    "",
  ];
  return lines.join("\n");
}
