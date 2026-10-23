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
} from "./sky-env";

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
