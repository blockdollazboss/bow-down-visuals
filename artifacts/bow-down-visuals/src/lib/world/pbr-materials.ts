/**
 * pbr-materials.ts — procedural PBR for the King's Hall / palace
 * (Open World Overhaul, board items 7, 9, 11, 12).
 *
 * What the shipped world had before this module (audit textures
 * T3/T6/T7/T10): ONE colour JPEG per theme, its "relief" faked by
 * feeding the colour map back in as its own bumpMap (veins embossed
 * as grooves, JPEG artefacts became relief), texture repeats chosen
 * per material rather than per metre (a 1 m lintel and a 28.8 m wall
 * shared a 5×1.4 repeat), non-seamless sources under mirrored
 * wrapping (a kaleidoscope of Rorschach veins every ~7–9 m), and
 * flat-colour gold that read as yellow plastic.
 *
 * What this module does instead — all procedural, at load time,
 * from the assets already on disk ($0, no new binary art):
 *
 *  7  `repeatForSize` — repeats derive from a surface's size in
 *     metres, so every marble surface shows the same texel density
 *     no matter how big the mesh is.
 *  9  `derivePbrMaps` — a real heightfield is estimated from the
 *     colour map with VEIN-AWARE rules (a vein is a thin feature
 *     that departs from its local surroundings, in either polarity:
 *     dark veins in cream marble, gold veins in black marble — both
 *     sit slightly RECESSED in polished stone), then a tangent-space
 *     normal map is integrated from that heightfield (Sobel), a
 *     roughness map is painted from it (polished field, rougher
 *     veins), and an AO map is baked from the recess depth. No map
 *     is the colour map in a costume.
 *  11 `makeTileable` — the colour pixels are edge-blended into a
 *     genuinely tileable variant BEFORE the maps are derived, and
 *     every derivation step wraps, so colour, normal, roughness and
 *     AO all tile with plain RepeatWrapping. The blend mixes each
 *     edge with the half-tile-offset copy under a periodic cosine
 *     mask that is exactly 1 at the border and exactly 0 at the
 *     centre (where the shifted copy's own seam lands) — the seam
 *     jump across a tile border becomes an ordinary interior step
 *     of the source image, by construction.
 *  12 `brushedMetalMaps` — gold gets procedural brushed-metal maps:
 *     anisotropic streak noise (long horizontal correlation, fine
 *     vertical grain) driving a roughness map that actually varies
 *     (bright gold ≈ 0.14–0.34, deep gold ≈ 0.30–0.54) and a subtle
 *     normal map, so under the sky environment (sky-env.ts) it
 *     reflects like metal instead of sitting there as flat yellow.
 *
 * The pixel core is pure (typed arrays in, typed arrays out, no DOM,
 * no three.js) so it is unit-testable in node. The three.js-facing
 * half at the bottom turns derived pixels into DataTextures and
 * fills them in when the source image for a URL finishes loading.
 */
import * as THREE from "three";

/* ── Per-metre repeats (item 7) ───────────────────────────────────── */

/** One tile of the marble source covers this many metres of world.
 *  The source's veining reads at palace scale at ~4 m per tile;
 *  what matters is that EVERY surface agrees on it. */
export const MARBLE_METRES_PER_TILE = 4;
/** One tile of the throne-fabric source (brocade / velvet). */
export const FABRIC_METRES_PER_TILE = 1.2;
/** One tile of the plaza paving source (Stage C item 6). The art
 *  lane's sett pattern reads at courtyard scale at ~4 m per tile;
 *  the manifest asks for INTEGRAL repeat counts on paving/stone so
 *  the joints stay even — the grounds' floor rects are sized to
 *  whole tiles (palace-grounds.ts), so repeats come out whole. */
export const PAVING_METRES_PER_TILE = 4;
/** One tile of the lawn source (Stage C item 8): grass detail is
 *  fine-grained, so its tile is smaller — 3 m. */
export const LAWN_METRES_PER_TILE = 3;
/** One tile of the ashlar stone source (façade + grounds edging,
 *  Stage C items 1/8): block courses at ~3 m per tile, integral
 *  repeats wherever the surface size allows. */
export const STONE_METRES_PER_TILE = 3;

/** Texture repeat for a surface `widthM` × `heightM` metres, given
 *  the world size one texture tile represents. Texel density is
 *  widthM/metresPerTile per metre on every surface — a 1 m lintel
 *  gets 0.25 of a tile, a 28.8 m wall gets 7.2, and the veins are
 *  the same size on both. */
export function repeatForSize(
  widthM: number,
  heightM: number,
  metresPerTile: number,
): { x: number; y: number } {
  const tile = metresPerTile > 0 ? metresPerTile : 1;
  const w = Number.isFinite(widthM) && widthM > 0 ? widthM : tile;
  const h = Number.isFinite(heightM) && heightM > 0 ? heightM : tile;
  return { x: w / tile, y: h / tile };
}

/* ── Pixel helpers (all wrapped / toroidal — maps must tile) ─────── */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Luminance per pixel (Rec. 709), 0..1. */
export function luminanceOf(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    out[i] = (0.2126 * rgba[o]! + 0.7152 * rgba[o + 1]! + 0.0722 * rgba[o + 2]!) / 255;
  }
  return out;
}

/** Separable box blur with wrapped edges (the field is a torus —
 *  a blur that fell off the edge would paint a seam into every
 *  derived map). */
export function boxBlurWrapped(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(1, Math.floor(radius));
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[y * width + wrapIndex(x + k, width)]!;
      tmp[y * width + x] = sum / span;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[wrapIndex(y + k, height) * width + x]!;
      out[y * width + x] = sum / span;
    }
  }
  return out;
}

/* ── Seamless tiling (item 11) ────────────────────────────────────── */

/** Periodic blend mask: exactly 1 at the tile border, exactly 0 at
 *  the centre, smooth in between. Because the mask is itself
 *  periodic, mixing under it cannot introduce a new seam. */
export function tileBlendMask(i: number, n: number): number {
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * i) / n);
}

/** Make an RGBA image tileable: blend each pixel with the copy
 *  half a tile away, weighted by the periodic mask — full weight at
 *  the borders (so border pixels ARE the half-offset interior,
 *  and stepping across the border steps to a neighbouring interior
 *  pixel), zero at the centre (where the shifted copy's own border
 *  would otherwise land). Horizontal pass first, then vertical;
 *  each pass preserves the other axis's continuity. */
export function makeTileable(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const halfX = Math.floor(width / 2);
  const halfY = Math.floor(height / 2);
  const horiz = new Float32Array(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = tileBlendMask(x, width);
      const i = (y * width + x) * 4;
      const j = (y * width + wrapIndex(x + halfX, width)) * 4;
      for (let c = 0; c < 4; c++) horiz[i + c] = rgba[i + c]! * (1 - a) + rgba[j + c]! * a;
    }
  }
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) {
    const a = tileBlendMask(y, height);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const j = (wrapIndex(y + halfY, height) * width + x) * 4;
      for (let c = 0; c < 4; c++) out[i + c] = Math.round(horiz[i + c]! * (1 - a) + horiz[j + c]! * a);
    }
  }
  return out;
}

/** The worst per-channel step across the tile border vs the worst
 *  step between horizontally neighbouring interior pixels — the
 *  seam metric the tests pin (a tileable image's seam step is an
 *  ordinary interior step, ratio ≈ 1, never the source's raw jump). */
export function seamStepRatio(rgba: Uint8ClampedArray, width: number, height: number): number {
  let seam = 0;
  let interior = 0;
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 3; c++) {
      const a = rgba[(y * width) * 4 + c]!;
      const b = rgba[(y * width + (width - 1)) * 4 + c]!;
      seam = Math.max(seam, Math.abs(a - b));
    }
    for (let x = 0; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const a = rgba[(y * width + x) * 4 + c]!;
        const b = rgba[(y * width + x + 1) * 4 + c]!;
        interior = Math.max(interior, Math.abs(a - b));
      }
    }
  }
  return interior === 0 ? seam : seam / interior;
}

/* ── Heightfield, normal, roughness, AO (item 9) ──────────────────── */

export type PbrKind =
  | "marble" | "marble-rough" | "marble-floor" | "fabric"
  /* Stage C grounds kinds: paving setts (matte, joint-led relief),
   * lawn grass (fully matte, soft relief) and ashlar stone. */
  | "paving" | "lawn" | "stone";

export interface PbrKindParams {
  /** Roughness of the polished field (encoded into the map). */
  baseRoughness: number;
  /** Extra roughness inside the veins / pattern recesses. */
  veinRoughnessBoost: number;
  /** Sobel strength for the normal map. */
  normalStrength: number;
  /** How hard recesses darken the AO map. */
  aoStrength: number;
  /** Lowest AO value (recesses shade, they never go black). */
  aoFloor: number;
}

export const PBR_KIND_PARAMS: Record<PbrKind, PbrKindParams> = {
  marble: { baseRoughness: 0.34, veinRoughnessBoost: 0.3, normalStrength: 2.4, aoStrength: 1.7, aoFloor: 0.55 },
  "marble-rough": { baseRoughness: 0.52, veinRoughnessBoost: 0.18, normalStrength: 1.7, aoStrength: 1.4, aoFloor: 0.6 },
  "marble-floor": { baseRoughness: 0.1, veinRoughnessBoost: 0.2, normalStrength: 1.8, aoStrength: 1.5, aoFloor: 0.6 },
  fabric: { baseRoughness: 0.78, veinRoughnessBoost: 0.12, normalStrength: 1.3, aoStrength: 1.1, aoFloor: 0.65 },
  /* Paving: matte stone setts — the "veins" here are the joints
   * between setts, which the vein-aware heightfield reads as
   * recesses exactly as it should: joints sit lower and rougher. */
  paving: { baseRoughness: 0.82, veinRoughnessBoost: 0.16, normalStrength: 2.0, aoStrength: 1.5, aoFloor: 0.6 },
  /* Lawn: grass is matte end to end; the relief is a soft mow-tone
   * undulation, never a groove. */
  lawn: { baseRoughness: 0.95, veinRoughnessBoost: 0.04, normalStrength: 1.1, aoStrength: 0.9, aoFloor: 0.7 },
  /* Ashlar stone: cut blocks, mid-matte, joints recessed. */
  stone: { baseRoughness: 0.68, veinRoughnessBoost: 0.2, normalStrength: 1.9, aoStrength: 1.5, aoFloor: 0.6 },
};

/** Vein-aware heightfield from a colour image.
 *
 *  A vein — of either polarity — is where a pixel departs from its
 *  LOCAL surroundings: dark veins cross cream marble, gold veins
 *  cross black marble. Polished stone wears its veins slightly
 *  recessed (the vein mineral takes a different polish and erodes
 *  a hair faster), so height falls with local deviation, on top of
 *  a gentle broad undulation from the low-pass luminance. This is
 *  the opposite of the old bumpMap=colour trick, under which a
 *  dark vein on cream EMBOSSED as a ridge of JPEG noise. */
export function heightFromColour(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const lum = luminanceOf(rgba, width, height);
  const blurRadius = Math.max(2, Math.round(width / 48));
  const local = boxBlurWrapped(lum, width, height, blurRadius);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const deviation = Math.abs(lum[i]! - local[i]!);
    // Veins are thin and high-contrast: x5 saturates a real vein
    // while broad shading (deviation ~0.02) barely registers.
    const vein = clamp01(deviation * 5);
    out[i] = clamp01(0.62 + (local[i]! - 0.5) * 0.3 - vein * 0.5);
  }
  return out;
}

/** Tangent-space normal map (RGBA bytes) from a heightfield, Sobel
 *  gradients with wrapped sampling — the map tiles because the
 *  heightfield does. A flat heightfield gives the neutral normal
 *  (128, 128, 255). */
export function normalFromHeight(heightField: Float32Array, width: number, height: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const at = (x: number, y: number) => heightField[wrapIndex(y, height) * width + wrapIndex(x, width)]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const o = (y * width + x) * 4;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Roughness map (grayscale RGBA): the polished field at the kind's
 *  base roughness, veins rougher by the boost, plus a whisper of
 *  variation from the broad luminance so no two tiles polish alike. */
export function roughnessFromHeightAndColour(
  rgba: Uint8ClampedArray,
  heightField: Float32Array,
  width: number,
  height: number,
  params: PbrKindParams,
): Uint8ClampedArray {
  const lum = luminanceOf(rgba, width, height);
  // The local window must be WIDER than a vein's height footprint
  // (the heightfield's own blur spreads a vein ±width/48) or the
  // recess measures itself and reads ~0.
  const local = boxBlurWrapped(heightField, width, height, Math.max(3, Math.round(width / 16)));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    // Recess depth relative to the local surface = "how veiny".
    const recess = clamp01((local[i]! - heightField[i]!) * 4);
    const rough = clamp01(
      params.baseRoughness + recess * params.veinRoughnessBoost + (lum[i]! - 0.5) * 0.05,
    );
    const v = Math.round(rough * 255);
    const o = i * 4;
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
  }
  return out;
}

/** AO approximation baked from the heightfield: a pixel recessed
 *  below its neighbourhood (a vein, a brocade groove) catches less
 *  ambient light. Broad blur, soft floor — shading, not dirt. */
export function aoFromHeight(heightField: Float32Array, width: number, height: number, params: PbrKindParams): Uint8ClampedArray {
  const local = boxBlurWrapped(heightField, width, height, Math.max(3, Math.round(width / 12)));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const recess = Math.max(0, local[i]! - heightField[i]!);
    const ao = clamp01(1 - recess * params.aoStrength);
    const v = Math.round((params.aoFloor + (1 - params.aoFloor) * ao) * 255);
    const o = i * 4;
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
  }
  return out;
}

export interface DerivedPbrMaps {
  /** The tileable colour pixels every map below was derived from. */
  color: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  roughness: Uint8ClampedArray;
  ao: Uint8ClampedArray;
  heightField: Float32Array;
  width: number;
  height: number;
}

/** The full derivation pipeline: tileable colour FIRST (so every
 *  derived map inherits the seamlessness), then height → normal /
 *  roughness / AO. */
export function derivePbrMaps(rgba: Uint8ClampedArray, width: number, height: number, kind: PbrKind): DerivedPbrMaps {
  const params = PBR_KIND_PARAMS[kind];
  const color = makeTileable(rgba, width, height);
  const heightField = heightFromColour(color, width, height);
  return {
    color,
    normal: normalFromHeight(heightField, width, height, params.normalStrength),
    roughness: roughnessFromHeightAndColour(color, heightField, width, height, params),
    ao: aoFromHeight(heightField, width, height, params),
    heightField,
    width,
    height,
  };
}

/* ── Brushed gold (item 12) ───────────────────────────────────────── */

/** Deterministic PRNG (mulberry32) — the gold's brushing is the
 *  same on every visit, every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type GoldVariant = "bright" | "dark";

export const GOLD_ROUGHNESS_RANGE: Record<GoldVariant, { min: number; max: number }> = {
  bright: { min: 0.14, max: 0.34 },
  dark: { min: 0.3, max: 0.54 },
};

/** Brushed-metal maps for the palace golds. The brushing is
 *  ANISOTROPIC: streak noise is smoothed hard along X (a long
 *  horizontal correlation — the brush direction) and left fine
 *  across Y, then a whisper of per-pixel grain. Roughness rides
 *  the streaks inside the variant's range, so highlights smear
 *  along the brush the way real brushed gold's do. */
export function brushedMetalMaps(
  size: number,
  seed: number,
  variant: GoldVariant,
): { normal: Uint8ClampedArray; roughness: Uint8ClampedArray; height: Float32Array } {
  const rand = mulberry32(seed);
  const range = GOLD_ROUGHNESS_RANGE[variant];
  // One streak profile per row, random-walked, then blurred along X.
  const raw = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    let v = rand();
    for (let x = 0; x < size; x++) {
      v += (rand() - 0.5) * 0.22;
      v = clamp01(v);
      raw[y * size + x] = v;
    }
  }
  const streaks = new Float32Array(size * size);
  const blurR = Math.max(4, Math.floor(size / 10));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -blurR; k <= blurR; k++) sum += raw[y * size + wrapIndex(x + k, size)]!;
      streaks[y * size + x] = sum / (2 * blurR + 1);
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of streaks) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const height = new Float32Array(size * size);
  const roughness = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const s = (streaks[i]! - lo) / span;
    const grain = (rand() - 0.5) * 0.1;
    height[i] = clamp01(s * 0.7 + 0.15 + grain * 0.3);
    const rough = clamp01(range.min + (range.max - range.min) * s + grain * 0.35);
    const o = i * 4;
    const v = Math.round(rough * 255);
    roughness[o] = v; roughness[o + 1] = v; roughness[o + 2] = v; roughness[o + 3] = 255;
  }
  return { normal: normalFromHeight(height, size, size, 0.55), roughness, height };
}

/* ── Ripple normals (Stack-100 #2 water round 2) ──────────────────
 * The water surfaces wore a colour map and nothing else: their
 * "shimmer" was a sliding picture. A tileable ripple normal map
 * — a periodic sum of travelling sine waves, integrated through
 * the same normalFromHeight the stone uses — lets the ONE water
 * model (plaza-life's waterSurfaceAt) bend light for real: the
 * scene counter-scrolls this layer against the colour layer. */

/** A tileable ripple heightfield: three periodic wave trains at
 *  palace-water wavelengths. Every frequency is an integer count
 *  per tile, so the field wraps exactly — no seam, ever. */
export function rippleHeightField(size: number): Float32Array {
  const out = new Float32Array(size * size);
  const waves: Array<{ fx: number; fy: number; amp: number; phase: number }> = [
    { fx: 3, fy: 1, amp: 0.4, phase: 0.0 },
    { fx: -2, fy: 4, amp: 0.3, phase: 1.7 },
    { fx: 5, fy: -3, amp: 0.2, phase: 3.9 },
    { fx: 1, fy: 7, amp: 0.12, phase: 5.3 },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0.5;
      for (const w of waves) {
        h += w.amp * 0.25 * Math.sin(((x * w.fx + y * w.fy) / size) * Math.PI * 2 + w.phase);
      }
      out[y * size + x] = clamp01(h);
    }
  }
  return out;
}

const RIPPLE_NORMAL_SIZE = 256;
let rippleNormalTex: THREE.DataTexture | null = null;

/** The shared ripple normal DataTexture (generated once). Scene
 *  water materials clone it per surface — a clone shares the
 *  pixels but carries its own offset, which is exactly what the
 *  water model animates. */
export function rippleNormalTexture(): THREE.DataTexture {
  if (rippleNormalTex) return rippleNormalTex;
  const height = rippleHeightField(RIPPLE_NORMAL_SIZE);
  const normal = normalFromHeight(height, RIPPLE_NORMAL_SIZE, RIPPLE_NORMAL_SIZE, 1.4);
  const tex = new THREE.DataTexture(normal, RIPPLE_NORMAL_SIZE, RIPPLE_NORMAL_SIZE);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  rippleNormalTex = tex;
  return tex;
}

/* ── three.js-facing half ───────────────────────────────────────────
 * Derived DataTextures are created as 1×1 placeholders carrying the
 * kind's neutral values (so a material is honest before its source
 * lands), registered per (url, kind, repeat), and filled in by
 * enhanceLoadedTexture when the colour source for that URL loads.
 * Pixel derivation runs ONCE per (url, kind) at ≤512² — the maps
 * repeat, they don't need the colour map's full resolution. */

export interface DerivedPbrTextures {
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  aoMap: THREE.DataTexture;
}

interface DerivedEntry extends DerivedPbrTextures {
  url: string;
  kind: PbrKind;
}

const derivedEntries = new Map<string, DerivedEntry>();
const derivedPixels = new Map<string, DerivedPbrMaps>();
const tileableCanvases = new Map<string, HTMLCanvasElement>();

function placeholderTexture(r: number, g: number, b: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function fillDataTexture(tex: THREE.DataTexture, data: Uint8ClampedArray, width: number, height: number): void {
  tex.image = { data, width, height };
  tex.needsUpdate = true;
}

/** The derived-map set for one (url, kind, repeat). Repeat lives on
 *  the texture in three.js, so differently-repeated surfaces get
 *  their own texture objects over the same derived pixels. */
export function derivedPbrTextures(url: string, kind: PbrKind, repeatX: number, repeatY: number): DerivedPbrTextures {
  const key = `${url}|${kind}|${repeatX}x${repeatY}`;
  const hit = derivedEntries.get(key);
  if (hit) return hit;
  const params = PBR_KIND_PARAMS[kind];
  const roughV = Math.round(params.baseRoughness * 255);
  const entry: DerivedEntry = {
    url,
    kind,
    normalMap: placeholderTexture(128, 128, 255),
    roughnessMap: placeholderTexture(roughV, roughV, roughV),
    aoMap: placeholderTexture(255, 255, 255),
  };
  // aoMap reads UV channel 0 here — palace geometry carries one UV
  // set, and the AO was derived from the same pixels as the colour
  // map, so channel 0 is exactly right.
  entry.aoMap.channel = 0;
  for (const tex of [entry.normalMap, entry.roughnessMap, entry.aoMap]) {
    tex.repeat.set(repeatX, repeatY);
    // Match the colour texture's orientation (TextureLoader maps
    // flip Y; DataTextures default to not flipping).
    tex.flipY = true;
  }
  derivedEntries.set(key, entry);
  const pixels = derivedPixels.get(`${url}|${kind}`);
  if (pixels) {
    fillDataTexture(entry.normalMap, pixels.normal, pixels.width, pixels.height);
    fillDataTexture(entry.roughnessMap, pixels.roughness, pixels.width, pixels.height);
    fillDataTexture(entry.aoMap, pixels.ao, pixels.width, pixels.height);
  }
  return entry;
}

const GOLD_TEXTURE_SIZE = 256;
const goldTextureCache = new Map<string, { normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture }>();

/** Brushed-gold DataTextures for a variant at a repeat — generated
 *  once per (variant, repeat), shared by every gold surface. */
export function brushedGoldTextures(
  variant: GoldVariant,
  repeatX: number,
  repeatY: number,
): { normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } {
  const key = `${variant}|${repeatX}x${repeatY}`;
  const hit = goldTextureCache.get(key);
  if (hit) return hit;
  const maps = brushedMetalMaps(GOLD_TEXTURE_SIZE, variant === "bright" ? 0x901d : 0xda2c, variant);
  const normalMap = new THREE.DataTexture(maps.normal, GOLD_TEXTURE_SIZE, GOLD_TEXTURE_SIZE);
  const roughnessMap = new THREE.DataTexture(maps.roughness, GOLD_TEXTURE_SIZE, GOLD_TEXTURE_SIZE);
  for (const tex of [normalMap, roughnessMap]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.needsUpdate = true;
  }
  const entry = { normalMap, roughnessMap };
  goldTextureCache.set(key, entry);
  return entry;
}

/** Called from hall-scene's texture loader when a colour source
 *  lands: swap the texture's image for its tileable variant and
 *  fill every registered derived-map set for the URL. Runs the
 *  pixel derivation once per (url, kind); later textures for the
 *  same URL reuse the canvas and the pixels. */
export function enhanceLoadedTexture(url: string, tex: THREE.Texture): void {
  const img = tex.image as HTMLImageElement | HTMLCanvasElement | undefined;
  if (!img) return;
  let tileCanvas = tileableCanvases.get(url);
  if (!tileCanvas) {
    const srcW = (img as HTMLImageElement).naturalWidth || img.width || 0;
    const srcH = (img as HTMLImageElement).naturalHeight || img.height || 0;
    if (!srcW || !srcH) return;
    const scale = Math.min(1, 1024 / Math.max(srcW, srcH));
    const w = Math.max(2, Math.round(srcW * scale));
    const h = Math.max(2, Math.round(srcH * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.drawImage(img, 0, 0, w, h);
    const pixels = g.getImageData(0, 0, w, h);
    const tileable = makeTileable(pixels.data, w, h);
    pixels.data.set(tileable);
    g.putImageData(pixels, 0, 0);
    tileCanvas = canvas;
    tileableCanvases.set(url, canvas);

    // Derived pixels at ≤512², once per registered kind.
    const kinds = new Set<PbrKind>();
    for (const entry of derivedEntries.values()) if (entry.url === url) kinds.add(entry.kind);
    if (kinds.size > 0) {
      const dScale = Math.min(1, 512 / Math.max(w, h));
      const dw = Math.max(2, Math.round(w * dScale));
      const dh = Math.max(2, Math.round(h * dScale));
      const dCanvas = document.createElement("canvas");
      dCanvas.width = dw;
      dCanvas.height = dh;
      const dg = dCanvas.getContext("2d");
      if (dg) {
        dg.drawImage(canvas, 0, 0, dw, dh);
        const dPixels = dg.getImageData(0, 0, dw, dh).data;
        for (const kind of kinds) {
          const maps = derivePbrMaps(dPixels, dw, dh, kind);
          derivedPixels.set(`${url}|${kind}`, maps);
          for (const entry of derivedEntries.values()) {
            if (entry.url === url && entry.kind === kind) {
              fillDataTexture(entry.normalMap, maps.normal, dw, dh);
              fillDataTexture(entry.roughnessMap, maps.roughness, dw, dh);
              fillDataTexture(entry.aoMap, maps.ao, dw, dh);
            }
          }
        }
      }
    }
  }
  tex.image = tileCanvas;
  tex.needsUpdate = true;
}
