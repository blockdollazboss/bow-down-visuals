/**
 * sky-env.ts — the palace's environment reflections, baked from an
 * actual sky (Open World Overhaul, board item 21; audit lighting C3).
 *
 * Before this module, scene.environment was a PMREM of a fake
 * INDOOR room — a box with a bright "window wall" slab and, at
 * night, seven candle-glows floating in a black box. Gold and
 * marble outdoors reflected a room that doesn't exist: no sun
 * glint, no sky gradient, nothing that matched the light falling
 * on the plaza.
 *
 * Now the environment is generated from a small procedural SKY
 * scene, per look:
 *   LIGHT → a golden-hour sky: warm blue-to-cream gradient dome,
 *           a real sun disc + halo placed where the plaza sun
 *           stands (aimSun's day position, normalised), and a warm
 *           ground bounce below the horizon.
 *   DARK  → a night sky: deep indigo gradient, a pale moon disc +
 *           halo where the moonlight stands, faint stars, and a
 *           near-black ground with the faintest warm tinge (the
 *           braziers' world, not a void).
 * PMREM blurs that sky into the reflection probe three.js samples —
 * reflections now come from a sky, in both themes, and the gold
 * (pbr-materials' brushed maps) has a sun/moon to glint with.
 *
 * Stage C update (items 3/4, the owner's Gate-1 pick — Living
 * Night Palace): the SAME sky definition now also builds the
 * VISIBLE dome the walked scene wears (buildVisibleSky), so the
 * sky you see and the sky the gold reflects are one sky by
 * construction — one palette, one shader, two radii. The day dome
 * carries the sun disc + drifting cloud sprites; the night dome
 * carries the star field + moon disc the shader already paints.
 */
import * as THREE from "three";
import type { HallLook } from "./hall-looks";

export interface SkyPalette {
  /** Zenith colour (linear-ish RGB, values may exceed 1 for the sun). */
  top: THREE.Color;
  /** Horizon colour — the band reflections lean on most. */
  horizon: THREE.Color;
  /** Below-horizon ground bounce colour. */
  ground: THREE.Color;
  /** The sun (day) or moon (night) disc colour, HDR. */
  disc: THREE.Color;
  /** Normalised direction TOWARD the sun/moon, matching aimSun. */
  discDirection: THREE.Vector3;
  /** Disc angular size (cosine threshold start for the disc edge). */
  discCos: number;
  /** Halo strength around the disc. */
  haloIntensity: number;
  /** Star field amount (0 by day, >0 at night). */
  stars: number;
  /** Warm sun-scatter amount (day only): a broad warm wash around
   *  the sun disc and its horizon, so the day dome glows where
   *  the light comes from instead of reading as flat gradient. */
  scatter: number;
  /** Milky-way band amount (night only): a faint dense star band
   *  across the dome, the night sky's large-scale structure. */
  milkyWay: number;
}

function rgb(r: number, g: number, b: number): THREE.Color {
  return new THREE.Color(r, g, b);
}

/** The sky each look's reflections are baked from. Colours derive
 *  from the look's own palette (hemisphere sky / fog / background /
 *  sun) so the env can never drift away from the light rig it
 *  feeds; the disc direction is aimSun's plaza position for the
 *  theme (day sun from the south sky, night moon opposed) so a
 *  glint lands where the shadows say the light is. */
export function skyPaletteFor(look: HallLook): SkyPalette {
  if (look.theme === "light") {
    return {
      // Golden hour: soft blue zenith warming to cream at the horizon.
      top: rgb(0.36, 0.52, 0.78),
      horizon: rgb(1.05, 0.9, 0.66),
      ground: rgb(0.42, 0.34, 0.22),
      // The sun itself — HDR warm, the look's sun colour pushed hot.
      disc: new THREE.Color(look.sun.color).multiplyScalar(7),
      discDirection: new THREE.Vector3(16, 25, 47).normalize(),
      discCos: 0.9993,
      haloIntensity: 0.55,
      stars: 0,
      scatter: 1,
      milkyWay: 0,
    };
  }
  return {
    // Midnight: deep indigo zenith, a horizon that keeps a breath
    // of the palace's warmth, near-black ground.
    top: rgb(0.012, 0.016, 0.045),
    horizon: rgb(0.05, 0.045, 0.09),
    ground: rgb(0.02, 0.014, 0.008),
    // The moon — pale blue-white, HDR but far cooler than the sun.
    disc: rgb(2.6, 2.9, 3.6),
    discDirection: new THREE.Vector3(-14, 27, 42).normalize(),
    discCos: 0.99965,
    haloIntensity: 0.3,
    stars: 0.55,
    scatter: 0,
    milkyWay: 0.9,
  };
}

/* ── Night-sky life (Stack-100 #2 item 1) ──────────────────────────
 * The shipped dome painted its stars once: a static hash field,
 * one brightness per cell, no motion of any kind for a whole
 * session. The dome shader now takes a uTime uniform and the
 * star layer LIVES: each star twinkles on its own hash-driven
 * rate, stars carry magnitude classes (a few bright, most dim),
 * a milky-way band crosses the dome, and the whole star layer
 * drifts very slowly around the zenith. The disc does NOT move:
 * it stands where aimSun puts the moonlight, so the sky can
 * never disagree with the shadows. The PMREM capture keeps
 * uTime = 0 — reflections are a blurred average by construction,
 * and the visible dome is the one that breathes. Under reduced
 * motion the scene never advances uTime and the sky rests. */

/** Star-layer drift around the zenith, rad/s — a full turn takes
 *  ~42 minutes: present across a long session, invisible per
 *  glance. */
export const STAR_DRIFT_RAD_PER_SEC = 0.0025;

/** One star's twinkle multiplier at one moment, from its cell
 *  hash (0..1). Mirrors the dome shader's formula exactly: a
 *  0.72 base with a ±0.28 swing at a hash-driven rate, so stars
 *  shimmer independently and the field never pulses in unison. */
export function starTwinkleAt(hash01: number, tSec: number): number {
  const h = Math.min(1, Math.max(0, hash01));
  return 0.72 + 0.28 * Math.sin(tSec * (1.2 + h * 2.6) + h * 43.7);
}

/** A star's magnitude class from its cell hash: most stars are
 *  dim, a few carry the sky. Mirrors the shader's classes. */
export function starMagnitudeAt(hash01: number): number {
  const h = Math.min(1, Math.max(0, hash01));
  return h > 0.93 ? 1.7 : h > 0.75 ? 1.15 : 0.7;
}

/** The milky-way band's normal (unit): the band is the great
 *  circle perpendicular to this direction, tilted across the
 *  dome so it reads as a sweep, not a halo. */
export const MILKY_WAY_NORMAL = { x: 0.42, y: 0.3, z: 0.86 } as const;

/** Milky-way band strength (0..1) for a unit direction: a soft
 *  gaussian falloff from the band plane. Mirrors the shader. */
export function milkyWayBandAt(dir: { x: number; y: number; z: number }): number {
  const n = MILKY_WAY_NORMAL;
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const d = (dir.x * n.x + dir.y * n.y + dir.z * n.z) / len;
  const norm = Math.hypot(n.x, n.y, n.z);
  const dd = d * norm;
  return Math.exp(-dd * dd * 22);
}

/* ── Day-sky parity (Stack-100 #2 item 2) ─────────────────────────
 * The day dome's clouds are VISIBLE-SKY ONLY, admitted plainly:
 * they are sprites on the walked dome and are NOT in the PMREM
 * capture (buildSkyScene is the dome alone) — a blurred capture
 * would smear a sprite into a grey blob and the reflections
 * would lie. What the day sky gains instead is shading truth:
 * the dome shader washes warm scatter around the sun, and each
 * cloud sprite is tinted by where it rides relative to the sun
 * side of the sky (cloudShadeAt), so clouds are lit bodies, not
 * white decals. */

/** A cloud's tint multipliers at one moment: the sun stands on
 *  the dome's +X side (aimSun's day position), so a cloud riding
 *  the sun side warms and brightens; the far side cools and dims
 *  a touch. Smooth in the drifted position — never a pop. */
export function cloudShadeAt(def: SkyCloudDef, tSec: number): { r: number; g: number; b: number } {
  const x = cloudDriftX(def, tSec);
  const sunSide = Math.min(1, Math.max(0, (x + CLOUD_WRAP_X) / (CLOUD_WRAP_X * 2)));
  return {
    r: 0.9 + 0.16 * sunSide,
    g: 0.92 + 0.1 * sunSide,
    b: 1.04 - 0.12 * sunSide,
  };
}

/** The dome's gradient + disc shader. Exported as a constant so
 *  the construction is pinnable in tests: gradient by world-space
 *  height, disc by dot(dir, discDir), halo by a wider power falloff,
 *  stars by a hash of the direction (night only, via uniform). */
export const SKY_DOME_VERTEX_SHADER = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

export const SKY_DOME_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 discColor;
  uniform vec3 discDirection;
  uniform float discCos;
  uniform float haloIntensity;
  uniform float stars;
  uniform float uTime;
  uniform float scatter;
  uniform float milkyWay;
  varying vec3 vDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 col;
    if (dir.y >= 0.0) {
      float t = pow(1.0 - dir.y, 2.2);
      col = mix(topColor, horizonColor, t);
    } else {
      float t = pow(1.0 + dir.y, 1.6);
      col = mix(horizonColor, groundColor, t);
    }
    float d = dot(dir, normalize(discDirection));
    float halo = pow(max(d, 0.0), 90.0) * haloIntensity;
    float disc = smoothstep(discCos, discCos + 0.0006, d);
    col += discColor * (halo + disc);
    if (scatter > 0.0) {
      // Warm scatter around the sun: a broad glow that falls off
      // with angle from the disc and hugs the horizon on the
      // sun's side (item 2: the day sky lit from its sun).
      float wide = pow(max(d, 0.0), 6.0);
      vec2 dirH = normalize(dir.xz + vec2(1e-5));
      vec2 sunH = normalize(discDirection.xz + vec2(1e-5));
      float az = max(dot(dirH, sunH), 0.0);
      float horizonWarm = pow(az, 3.0) * pow(1.0 - abs(dir.y), 3.0);
      col += vec3(1.0, 0.72, 0.42) * (wide * 0.16 + horizonWarm * 0.13) * scatter;
    }
    if (stars > 0.0 && dir.y > 0.02) {
      // The star layer drifts very slowly around the zenith
      // (item 1); the disc above does not move with it.
      float ang = uTime * 0.0025;
      float ca = cos(ang);
      float sa = sin(ang);
      vec3 sdir = vec3(dir.x * ca - dir.z * sa, dir.y, dir.x * sa + dir.z * ca);
      vec3 cell = floor(sdir * 220.0);
      float h1 = hash13(cell);
      float h2 = hash13(cell + 7.0);
      // Magnitude classes: a few bright carriers, most dim.
      float mag = h2 > 0.93 ? 1.7 : h2 > 0.75 ? 1.15 : 0.7;
      // Twinkle: each star shimmers on its own hash-driven rate.
      float twinkle = 0.72 + 0.28 * sin(uTime * (1.2 + h2 * 2.6) + h2 * 43.7);
      float s = step(0.9985, h1) * stars * mag * twinkle;
      col += vec3(s * (0.35 + 0.65 * h2));
      if (milkyWay > 0.0) {
        // The milky-way band: faint dense star-dust along a
        // great circle, grainy at a coarser cell scale.
        float bd = dot(sdir, normalize(vec3(0.42, 0.30, 0.86)));
        float band = exp(-bd * bd * 22.0);
        float grain = 0.55 + 0.45 * hash13(floor(sdir * 36.0));
        col += vec3(0.55, 0.62, 0.85) * band * grain * stars * milkyWay * 0.16;
        float dust = step(0.992, hash13(floor(sdir * 160.0))) * band;
        col += vec3(dust * stars * milkyWay * 0.12 * twinkle);
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** One dome mesh from a palette — THE sky construction, shared by
 *  the PMREM capture scene and the visible sky so the two can
 *  never diverge (items 3/4 + 21). The material never writes depth
 *  and never takes fog: it is the background of the world, and a
 *  fogged dome would read as a wall of flat colour at the fog
 *  distance. (ShaderMaterial ignores scene.fog unless built with
 *  fog support — this one is not.) */
export function buildSkyDomeMesh(palette: SkyPalette, radius: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: palette.top },
        horizonColor: { value: palette.horizon },
        groundColor: { value: palette.ground },
        discColor: { value: palette.disc },
        discDirection: { value: palette.discDirection },
        discCos: { value: palette.discCos },
        haloIntensity: { value: palette.haloIntensity },
        stars: { value: palette.stars },
        uTime: { value: 0 },
        scatter: { value: palette.scatter },
        milkyWay: { value: palette.milkyWay },
      },
      vertexShader: SKY_DOME_VERTEX_SHADER,
      fragmentShader: SKY_DOME_FRAGMENT_SHADER,
    }),
  );
}

/** Build the small sky scene the PMREM is captured from: the
 *  gradient dome alone (it wraps the capture camera completely —
 *  below-horizon directions read the dome's ground band, so no
 *  separate ground mesh is needed). */
export function buildSkyScene(look: HallLook): THREE.Scene {
  const scene = new THREE.Scene();
  scene.add(buildSkyDomeMesh(skyPaletteFor(look), 50));
  return scene;
}

/* ── The visible sky (items 3 + 4) ────────────────────────────────
 * The dome the walker actually sees. Radius 90: inside the
 * camera's 120 m far plane with room to spare, and the scene
 * re-centres the sky group on the camera each frame, so the dome
 * never gets closer on one side than the other. It is pure
 * background: frustumCulled off (it is everywhere), renderOrder
 * first, depthWrite off — it can never occlude the world, and the
 * portal culling / LOD systems never see it (it lives outside
 * every room group). */

export const SKY_DOME_RADIUS = 90;

/** The visible dome for a look — the identical palette + shader
 *  the PMREM bakes from (skyPaletteFor), at the visible radius. */
export function buildVisibleSkyDome(look: HallLook): THREE.Mesh {
  const dome = buildSkyDomeMesh(skyPaletteFor(look), SKY_DOME_RADIUS);
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  return dome;
}

export interface SkyCloudDef {
  /** Rest position on the dome (relative to the sky group's
   *  centre): high, spread around the palace, never near the
   *  sun disc's line at spawn. */
  baseX: number;
  y: number;
  z: number;
  /** Sprite size in metres (soft billboarded puffs). */
  w: number;
  h: number;
  /** Drift speed, m/s — a breath, not weather. */
  speed: number;
  opacity: number;
}

/** The day sky's drifting clouds (item 3). Night wears none — the
 *  moon and stars own it. Positions are fixed data (deterministic
 *  on every visit, like the gold's brushing); the drift wraps
 *  inside ±CLOUD_WRAP_X so a cloud never pops at the dome's edge. */
export const SKY_CLOUDS: readonly SkyCloudDef[] = [
  { baseX: -52, y: 34, z: -38, w: 30, h: 10, speed: 0.55, opacity: 0.5 },
  { baseX: -18, y: 42, z: -64, w: 38, h: 12, speed: 0.4, opacity: 0.42 },
  { baseX: 24, y: 30, z: -52, w: 24, h: 8, speed: 0.7, opacity: 0.55 },
  { baseX: 58, y: 46, z: -20, w: 34, h: 11, speed: 0.35, opacity: 0.38 },
  { baseX: -64, y: 26, z: 30, w: 26, h: 9, speed: 0.6, opacity: 0.45 },
  { baseX: 8, y: 50, z: 44, w: 40, h: 12, speed: 0.3, opacity: 0.35 },
  { baseX: 66, y: 28, z: 52, w: 22, h: 8, speed: 0.65, opacity: 0.48 },
];

export const CLOUD_WRAP_X = 110;

/** A cloud's drifted X at time t: base + speed·t, wrapped into
 *  [−WRAP, +WRAP) so the field circulates forever with no pop. */
export function cloudDriftX(def: SkyCloudDef, tSec: number): number {
  const span = CLOUD_WRAP_X * 2;
  let x = (def.baseX + def.speed * tSec + CLOUD_WRAP_X) % span;
  if (x < 0) x += span;
  return x - CLOUD_WRAP_X;
}

/** Does this look wear clouds? Day only — the night sky's life is
 *  its stars, moon and the braziers below. */
export function skyHasClouds(look: HallLook): boolean {
  return look.theme === "light";
}

/** Bake the sky into the PMREM environment target scene.environment
 *  consumes. Sigma 0.04 keeps the disc's glint readable in polished
 *  gold instead of blurring it into the gradient. */
export function buildSkyEnvironment(renderer: THREE.WebGLRenderer, look: HallLook): THREE.WebGLRenderTarget {
  const sky = buildSkyScene(look);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(sky, 0.04);
  pmrem.dispose();
  const dome = sky.children[0] as THREE.Mesh;
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  return target;
}
