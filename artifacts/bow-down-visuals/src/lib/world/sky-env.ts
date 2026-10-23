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
 * Scope note: this is the ENV REFLECTION source only. The visible
 * sky dome art (board items 3/4) is the owner's Gate-1 pick and is
 * NOT built here — scene.background stays the look's flat colour
 * until that pick lands. The dome below exists inside the PMREM
 * capture, not in the walked scene.
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
    if (stars > 0.0 && dir.y > 0.02) {
      vec3 cell = floor(dir * 220.0);
      float s = step(0.9985, hash13(cell)) * stars;
      col += vec3(s * (0.35 + 0.65 * hash13(cell + 7.0)));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Build the small sky scene the PMREM is captured from: the
 *  gradient dome alone (it wraps the capture camera completely —
 *  below-horizon directions read the dome's ground band, so no
 *  separate ground mesh is needed). */
export function buildSkyScene(look: HallLook): THREE.Scene {
  const palette = skyPaletteFor(look);
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
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
      },
      vertexShader: SKY_DOME_VERTEX_SHADER,
      fragmentShader: SKY_DOME_FRAGMENT_SHADER,
    }),
  );
  scene.add(dome);
  return scene;
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
