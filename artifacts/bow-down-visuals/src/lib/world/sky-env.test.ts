/**
 * The World — sky environment tests (lib/world/sky-env).
 *
 * Overhaul board item 21 / audit C3: environment reflections are
 * PMREM-baked from a procedural SKY scene per look — never again
 * the fake indoor room (window-wall slab by day, candle glows in a
 * black box by night) that gold and marble used to reflect. The
 * PMREM itself needs a GL context, so these tests pin the sky's
 * construction: palettes, disc placement against aimSun's real
 * light positions, and the dome shader's ingredients.
 */
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { hallLookFor } from "./hall-looks";
import {
  skyPaletteFor,
  buildSkyScene,
  buildVisibleSkyDome,
  SKY_DOME_RADIUS,
  SKY_CLOUDS,
  CLOUD_WRAP_X,
  cloudDriftX,
  skyHasClouds,
  SKY_DOME_FRAGMENT_SHADER,
  SKY_DOME_VERTEX_SHADER,
  STAR_DRIFT_RAD_PER_SEC,
  starTwinkleAt,
  starMagnitudeAt,
  milkyWayBandAt,
  MILKY_WAY_NORMAL,
  cloudShadeAt,
} from "./sky-env";
import { readFileSync } from "node:fs";

const sceneSrc = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");

function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

describe("sky palettes (item 21)", () => {
  it("the day sky is a bright warm gradient with no stars", () => {
    const p = skyPaletteFor(hallLookFor("light"));
    expect(p.stars).toBe(0);
    expect(luminance(p.horizon)).toBeGreaterThan(0.6);
    expect(luminance(p.top)).toBeGreaterThan(0.3);
    expect(luminance(p.top)).toBeLessThan(luminance(p.horizon));
  });

  it("the night sky is deep and dark, with stars and a dim ground", () => {
    const p = skyPaletteFor(hallLookFor("dark"));
    expect(p.stars).toBeGreaterThan(0);
    expect(luminance(p.top)).toBeLessThan(0.05);
    expect(luminance(p.horizon)).toBeLessThan(0.1);
    expect(luminance(p.ground)).toBeLessThan(luminance(p.horizon));
  });

  it("the day disc is the look's sun colour, pushed HDR", () => {
    const look = hallLookFor("light");
    const p = skyPaletteFor(look);
    const sun = new THREE.Color(look.sun.color);
    expect(p.disc.r).toBeCloseTo(sun.r * 7);
    expect(p.disc.g).toBeCloseTo(sun.g * 7);
    expect(luminance(p.disc)).toBeGreaterThan(3); // HDR: it must glint
  });

  it("the night disc is a pale moon, cooler and dimmer than the sun", () => {
    const day = skyPaletteFor(hallLookFor("light"));
    const night = skyPaletteFor(hallLookFor("dark"));
    expect(night.disc.b).toBeGreaterThan(night.disc.r); // blue-pale
    expect(luminance(night.disc)).toBeLessThan(luminance(day.disc));
    expect(night.discCos).toBeGreaterThan(day.discCos); // smaller disc
  });

  it("disc directions match aimSun's plaza light positions", () => {
    // hall-scene.aimSun: day sun at (16, 25, 47), moon at (-14, 27, 42).
    const day = skyPaletteFor(hallLookFor("light"));
    const expectedDay = new THREE.Vector3(16, 25, 47).normalize();
    expect(day.discDirection.distanceTo(expectedDay)).toBeLessThan(1e-6);
    const night = skyPaletteFor(hallLookFor("dark"));
    const expectedNight = new THREE.Vector3(-14, 27, 42).normalize();
    expect(night.discDirection.distanceTo(expectedNight)).toBeLessThan(1e-6);
    expect(day.discDirection.length()).toBeCloseTo(1);
  });
});

describe("the sky dome construction", () => {
  it("the fragment shader has the gradient, the disc and the halo", () => {
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("topColor");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("horizonColor");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("groundColor");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("smoothstep(discCos");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("discDirection");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("stars");
    expect(SKY_DOME_VERTEX_SHADER).toContain("vDir");
  });

  it("buildSkyScene makes one back-side shader dome per look", () => {
    for (const theme of ["light", "dark"] as const) {
      const scene = buildSkyScene(hallLookFor(theme));
      expect(scene.children.length).toBe(1);
      const dome = scene.children[0] as THREE.Mesh;
      const mat = dome.material as THREE.ShaderMaterial;
      expect(mat.side).toBe(THREE.BackSide);
      expect(mat.uniforms.topColor).toBeDefined();
      expect(mat.uniforms.discDirection).toBeDefined();
      if (theme === "light") expect(mat.uniforms.stars!.value).toBe(0);
      else expect(mat.uniforms.stars!.value).toBeGreaterThan(0);
    }
  });

  it("the VISIBLE dome is the same sky the PMREM bakes (items 3/4 + 21)", () => {
    for (const theme of ["light", "dark"] as const) {
      const look = hallLookFor(theme);
      const palette = skyPaletteFor(look);
      const visible = buildVisibleSkyDome(look);
      const baked = buildSkyScene(look).children[0] as THREE.Mesh;
      const vm = visible.material as THREE.ShaderMaterial;
      const bm = baked.material as THREE.ShaderMaterial;
      // Same shader, same uniforms — one sky, two radii.
      expect(vm.fragmentShader).toBe(bm.fragmentShader);
      expect(vm.vertexShader).toBe(bm.vertexShader);
      for (const key of ["topColor", "horizonColor", "groundColor", "discColor", "discDirection"] as const) {
        const a = vm.uniforms[key]!.value as THREE.Color | THREE.Vector3;
        const b = bm.uniforms[key]!.value as THREE.Color | THREE.Vector3;
        if (a instanceof THREE.Color) expect(a.getHex()).toBe((b as THREE.Color).getHex());
        else expect(a.distanceTo(b as THREE.Vector3)).toBeLessThan(1e-9);
      }
      expect(vm.uniforms.discCos!.value).toBeCloseTo(palette.discCos);
      expect(vm.uniforms.stars!.value).toBeCloseTo(palette.stars);
      // The visible dome is background: no depth write, no fog,
      // never frustum-culled, sized inside the camera's far plane.
      expect(vm.depthWrite).toBe(false);
      expect(vm.fog).toBe(false);
      expect(visible.frustumCulled).toBe(false);
      expect(visible.renderOrder).toBeLessThan(0);
      const geo = visible.geometry as THREE.SphereGeometry;
      expect(geo.parameters.radius).toBe(SKY_DOME_RADIUS);
      expect(SKY_DOME_RADIUS).toBeLessThan(120); // hall-scene camera far
    }
  });

  it("day wears clouds, night does not; the drift wraps without popping", () => {
    expect(skyHasClouds(hallLookFor("light"))).toBe(true);
    expect(skyHasClouds(hallLookFor("dark"))).toBe(false);
    expect(SKY_CLOUDS.length).toBeGreaterThanOrEqual(5);
    for (const def of SKY_CLOUDS) {
      expect(def.speed).toBeGreaterThan(0);
      expect(Math.abs(def.baseX)).toBeLessThan(CLOUD_WRAP_X);
      for (const t of [0, 37, 500, 5000]) {
        const x = cloudDriftX(def, t);
        expect(x).toBeGreaterThanOrEqual(-CLOUD_WRAP_X);
        expect(x).toBeLessThan(CLOUD_WRAP_X);
      }
      // It actually drifts.
      expect(cloudDriftX(def, 10)).not.toBeCloseTo(cloudDriftX(def, 0), 3);
    }
  });

  it("the two looks bake different skies", () => {
    const a = (buildSkyScene(hallLookFor("light")).children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const b = (buildSkyScene(hallLookFor("dark")).children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
    const topA = a.uniforms.topColor!.value as THREE.Color;
    const topB = b.uniforms.topColor!.value as THREE.Color;
    expect(luminance(topA)).toBeGreaterThan(luminance(topB));
  });
});

describe("night-sky life (Stack-100 #2 item 1) [PICK: Living Night Palace, built in-direction]", () => {
  it("the dome shader takes time and works it: twinkle, magnitude, milky way, drift", () => {
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("uniform float uTime");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("twinkle");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("milkyWay");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("0.0025");
    // The disc is NOT in the rotating star layer — the sky can
    // never disagree with aimSun's moonlight/shadows.
    const discIdx = SKY_DOME_FRAGMENT_SHADER.indexOf("float disc =");
    const driftIdx = SKY_DOME_FRAGMENT_SHADER.indexOf("float ang = uTime");
    expect(discIdx).toBeGreaterThan(-1);
    expect(driftIdx).toBeGreaterThan(discIdx);
  });

  it("palettes split the new life by look: scatter by day, milky way by night", () => {
    expect(skyPaletteFor(hallLookFor("light")).scatter).toBeGreaterThan(0);
    expect(skyPaletteFor(hallLookFor("light")).milkyWay).toBe(0);
    expect(skyPaletteFor(hallLookFor("dark")).scatter).toBe(0);
    expect(skyPaletteFor(hallLookFor("dark")).milkyWay).toBeGreaterThan(0);
    const dome = buildVisibleSkyDome(hallLookFor("dark"));
    const mat = dome.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uTime!.value).toBe(0); // born still; the tick advances it
    expect(mat.uniforms.milkyWay!.value).toBeGreaterThan(0);
  });

  it("twinkle stays a shimmer (never off, never strobing) and varies per star", () => {
    for (const h of [0, 0.31, 0.77, 1]) {
      let min = Infinity;
      let max = -Infinity;
      for (let t = 0; t < 20; t += 0.13) {
        const v = starTwinkleAt(h, t);
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      expect(min).toBeGreaterThanOrEqual(0.43);
      expect(max).toBeLessThanOrEqual(1.01);
      expect(max - min).toBeGreaterThan(0.3); // it actually lives
    }
    expect(starTwinkleAt(0.1, 3)).not.toBeCloseTo(starTwinkleAt(0.9, 3), 2);
    // Slow drift: a full turn takes tens of minutes, not seconds.
    expect(STAR_DRIFT_RAD_PER_SEC).toBeGreaterThan(0);
    expect((Math.PI * 2) / STAR_DRIFT_RAD_PER_SEC).toBeGreaterThan(1200);
  });

  it("magnitudes: a few bright carriers over a dim field", () => {
    expect(starMagnitudeAt(0.99)).toBeGreaterThan(starMagnitudeAt(0.8));
    expect(starMagnitudeAt(0.8)).toBeGreaterThan(starMagnitudeAt(0.2));
  });

  it("the milky-way band peaks on its plane and dies away from it", () => {
    const n = MILKY_WAY_NORMAL;
    // A direction IN the band plane (perpendicular to the normal).
    const inBand = { x: -n.z, y: 0, z: n.x };
    expect(milkyWayBandAt(inBand)).toBeGreaterThan(0.95);
    // The normal itself is the band's emptiest direction.
    expect(milkyWayBandAt(n)).toBeLessThan(0.2);
  });

  it("the scene advances the VISIBLE dome's uTime in the tick, never under reduced motion", () => {
    expect(sceneSrc).toContain("skyDomeMaterial.uniforms.uTime");
    expect(sceneSrc).toContain("!this.reducedMotion");
  });
});

describe("day-sky parity (Stack-100 #2 item 2)", () => {
  it("the day dome shader washes warm scatter around the sun", () => {
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("scatter");
    expect(SKY_DOME_FRAGMENT_SHADER).toContain("horizonWarm");
  });

  it("clouds are admitted sky-only: the PMREM capture scene is the dome alone", () => {
    const scene = buildSkyScene(hallLookFor("light"));
    expect(scene.children).toHaveLength(1);
  });

  it("cloud shade warms toward the sun side and cools away, smoothly", () => {
    const def = SKY_CLOUDS[0]!;
    const samples = [0, 40, 90, 160, 300].map((t) => cloudShadeAt(def, t));
    for (const s of samples) {
      expect(s.r).toBeGreaterThanOrEqual(0.89);
      expect(s.r).toBeLessThanOrEqual(1.07);
      expect(s.b).toBeGreaterThanOrEqual(0.91);
      expect(s.b).toBeLessThanOrEqual(1.05);
    }
    // Sun side (+X drift extreme) is warmer/redder than the far side.
    const sunward = cloudShadeAt({ ...def, baseX: 100, speed: 0 }, 0);
    const farward = cloudShadeAt({ ...def, baseX: -100, speed: 0 }, 0);
    expect(sunward.r).toBeGreaterThan(farward.r);
    expect(sunward.b).toBeLessThan(farward.b);
    // The scene applies the tint to the sprites.
    expect(sceneSrc).toContain("cloudShadeAt(c.def, t)");
  });
});
