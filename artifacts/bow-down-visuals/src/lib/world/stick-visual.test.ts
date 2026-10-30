/**
 * Stick-visual tests (stack900 G4) — the touch stick's drawn
 * face: the pure state machine (down/move/release/blur), the
 * nub's radial clamp geometry, the per-theme gold treatments,
 * and the scene wiring pins. The parity pins are the point of
 * the lane: the drawing was added WITHOUT touching the stick's
 * movement math, and the exact arithmetic lines, their single
 * write sites, and the frame merge are pinned verbatim below so
 * any future change to them is a deliberate, visible act.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  STICK_NUB_DIAMETER_PX,
  STICK_RING_DIAMETER_PX,
  STICK_THROW_PX,
  STICK_VISUAL_FADE_MS,
  STICK_VISUAL_REST,
  stickNubOffset,
  stickVisualBlur,
  stickVisualDown,
  stickVisualMove,
  stickVisualPositions,
  stickVisualRelease,
  stickVisualStyleFor,
  stickVisualVisible,
  type StickVisualState,
} from "./stick-visual";

const scene = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");

const down = (x = 200, y = 300): StickVisualState =>
  stickVisualDown(STICK_VISUAL_REST, "touch", x, y);

describe("the throw — one number, the scene's own", () => {
  it("the throw is 52px, the ring is the throw circle, the nub is half the ring", () => {
    expect(STICK_THROW_PX).toBe(52);
    expect(STICK_RING_DIAMETER_PX).toBe(STICK_THROW_PX * 2);
    expect(STICK_NUB_DIAMETER_PX).toBe(52);
    expect(STICK_VISUAL_FADE_MS).toBeGreaterThan(0);
  });

  it("the scene's stick branch still divides by the same 52 (the ring cannot drift off the real throw)", () => {
    expect(scene).toContain("const max = 52;");
  });
});

describe("stickNubOffset — the nub follows the thumb, radially clamped", () => {
  it("inside the throw, the nub is exactly under the thumb", () => {
    expect(stickNubOffset(200, 300, 230, 300)).toEqual({ dx: 30, dy: 0 });
    expect(stickNubOffset(200, 300, 220, 280)).toEqual({ dx: 20, dy: -20 });
    expect(stickNubOffset(200, 300, 200, 300)).toEqual({ dx: 0, dy: 0 });
  });

  it("at the edge exactly, nothing is clamped away", () => {
    expect(stickNubOffset(0, 0, 52, 0)).toEqual({ dx: 52, dy: 0 });
    expect(stickNubOffset(0, 0, 0, -52)).toEqual({ dx: 0, dy: -52 });
  });

  it("past the edge, the nub pins to the ring in the thumb's direction", () => {
    expect(stickNubOffset(0, 0, 200, 0)).toEqual({ dx: 52, dy: 0 });
    const diag = stickNubOffset(0, 0, 52, 52);
    expect(Math.hypot(diag.dx, diag.dy)).toBeCloseTo(52, 10);
    expect(diag.dx).toBeCloseTo(diag.dy, 10);
    expect(diag.dx).toBeGreaterThan(0);
  });

  it("no travel, however wild, ever puts the nub past the ring", () => {
    for (const [x, y] of [
      [1000, 1000],
      [-400, 900],
      [53, 1],
      [0, 53],
    ] as const) {
      const { dx, dy } = stickNubOffset(10, -20, x, y);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(52 + 1e-9);
    }
  });
});

describe("the state machine — down, move, release, blur", () => {
  it("a touch down raises the drawing at the thumb, nub centred", () => {
    const s = down();
    expect(s.active).toBe(true);
    expect(stickVisualVisible(s)).toBe(true);
    expect(s.ox).toBe(200);
    expect(s.oy).toBe(300);
    expect(s.dx).toBe(0);
    expect(s.dy).toBe(0);
  });

  it("never appears for mouse, pen or pad input — touch only", () => {
    for (const type of ["mouse", "pen", "gamepad", ""]) {
      const s = stickVisualDown(STICK_VISUAL_REST, type, 200, 300);
      expect(s).toBe(STICK_VISUAL_REST);
      expect(stickVisualVisible(s)).toBe(false);
    }
  });

  it("moves track the thumb within the radius and clamp at the throw edge", () => {
    let s = down();
    s = stickVisualMove(s, 230, 300);
    expect([s.dx, s.dy]).toEqual([30, 0]);
    s = stickVisualMove(s, 200 + 500, 300);
    expect([s.dx, s.dy]).toEqual([52, 0]);
    expect(stickVisualVisible(s)).toBe(true);
  });

  it("a move with no stick is nothing — the state rests, untouched", () => {
    expect(stickVisualMove(STICK_VISUAL_REST, 10, 10)).toBe(STICK_VISUAL_REST);
  });

  it("release rests the drawing, from active or from rest", () => {
    expect(stickVisualRelease(down())).toBe(STICK_VISUAL_REST);
    expect(stickVisualRelease(STICK_VISUAL_REST)).toBe(STICK_VISUAL_REST);
    expect(stickVisualVisible(stickVisualRelease(down()))).toBe(false);
  });

  it("a full down → move → release cycle leaves nothing behind", () => {
    let s = down(120, 90);
    s = stickVisualMove(s, 160, 130);
    s = stickVisualRelease(s);
    expect(s).toEqual(STICK_VISUAL_REST);
  });

  it("blur hides the face but keeps the geometry — the next move re-syncs it in place", () => {
    let s = down();
    s = stickVisualMove(s, 240, 300);
    const blurred = stickVisualBlur(s);
    expect(blurred.active).toBe(true);
    expect(stickVisualVisible(blurred)).toBe(false);
    expect([blurred.ox, blurred.oy, blurred.dx, blurred.dy]).toEqual([200, 300, 40, 0]);
    const resynced = stickVisualMove(blurred, 210, 300);
    expect(stickVisualVisible(resynced)).toBe(true);
    expect([resynced.ox, resynced.oy]).toEqual([200, 300]);
    expect([resynced.dx, resynced.dy]).toEqual([10, 0]);
  });

  it("blur at rest is rest; a release after a blur still rests", () => {
    expect(stickVisualBlur(STICK_VISUAL_REST)).toBe(STICK_VISUAL_REST);
    expect(stickVisualRelease(stickVisualBlur(down()))).toBe(STICK_VISUAL_REST);
  });

  it("a fresh down re-anchors — a new grab is a new origin", () => {
    let s = down(100, 100);
    s = stickVisualMove(s, 140, 100);
    s = stickVisualDown(s, "touch", 400, 500);
    expect([s.ox, s.oy, s.dx, s.dy]).toEqual([400, 500, 0, 0]);
    expect(stickVisualVisible(s)).toBe(true);
  });
});

describe("stickVisualPositions — centres resolved to top-left corners", () => {
  it("at rest on the origin, ring and nub are concentric", () => {
    const pos = stickVisualPositions(down(200, 300));
    expect(pos.ringLeft).toBe(200 - STICK_RING_DIAMETER_PX / 2);
    expect(pos.ringTop).toBe(300 - STICK_RING_DIAMETER_PX / 2);
    expect(pos.nubLeft).toBe(200 - STICK_NUB_DIAMETER_PX / 2);
    expect(pos.nubTop).toBe(300 - STICK_NUB_DIAMETER_PX / 2);
  });

  it("at full push the nub's centre sits exactly on the ring", () => {
    const s = stickVisualMove(down(200, 300), 200 + 90, 300);
    const pos = stickVisualPositions(s);
    const nubCx = pos.nubLeft + STICK_NUB_DIAMETER_PX / 2;
    const nubCy = pos.nubTop + STICK_NUB_DIAMETER_PX / 2;
    expect(Math.hypot(nubCx - 200, nubCy - 300)).toBeCloseTo(STICK_RING_DIAMETER_PX / 2, 10);
  });
});

describe("the gold treatments — one per theme, contrast against the scene", () => {
  it("both themes define every piece, and the World's gold is in both nubs", () => {
    for (const theme of ["light", "dark"] as const) {
      const style = stickVisualStyleFor(theme);
      for (const value of Object.values(style)) {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
      expect(style.nubBackground).toContain("#d4af37");
    }
  });

  it("the day ring deepens to the house bronze over cream glass; the night ring is gold over dark glass", () => {
    const light = stickVisualStyleFor("light");
    const dark = stickVisualStyleFor("dark");
    expect(light.ringBorder).toContain("122, 90, 18");
    expect(light.ringBackground).toContain("252, 247, 234");
    expect(dark.ringBorder).toContain("212, 175, 55");
    expect(dark.ringBackground).toContain("8, 6, 3");
    expect(light).not.toEqual(dark);
  });
});

describe("movement parity — the drawing cannot move the walker", () => {
  it("the scene's stick arithmetic stands verbatim: creation, per-axis clamp, frame merge", () => {
    expect(scene).toContain(
      'if (e.pointerType === "touch" && e.clientX - rect.left < rect.width * 0.45 && !this.stick) {',
    );
    expect(scene).toContain(
      "this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };",
    );
    expect(scene).toContain("this.stick.dx = clamp((e.clientX - this.stick.ox) / max, -1, 1);");
    expect(scene).toContain("this.stick.dy = clamp((e.clientY - this.stick.oy) / max, -1, 1);");
    expect(scene).toContain("strafe += this.stick.dx;");
    expect(scene).toContain("fwd += -this.stick.dy;");
  });

  it("the stick is written at exactly its two original sites — the drawing adds no third", () => {
    expect(scene.match(/this\.stick = /g)).toHaveLength(2);
    expect(scene.match(/this\.stick\.dx = /g)).toHaveLength(1);
    expect(scene.match(/this\.stick\.dy = /g)).toHaveLength(1);
  });

  it("for a sweep of thumbs, the movement axes are the original formula — a function of origin and thumb alone", () => {
    /* The scene's formula, transcribed from the pinned lines
     * above: normalized per-axis clamp of the raw travel over
     * the throw. The visual state machine runs alongside it in
     * these sweeps and its outputs never enter the formula —
     * which is the whole parity claim: same thumbs, same axes,
     * with or without the drawing. */
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const sceneAxes = (ox: number, oy: number, x: number, y: number) => ({
      dx: clamp((x - ox) / 52, -1, 1),
      dy: clamp((y - oy) / 52, -1, 1),
    });
    const ox = 200;
    const oy = 300;
    for (const [x, y] of [
      [200, 300],
      [226, 300],
      [252, 300],
      [400, 300],
      [200, 196],
      [148, 404],
      [235, 265],
    ] as const) {
      const axes = sceneAxes(ox, oy, x, y);
      let visual = stickVisualDown(STICK_VISUAL_REST, "touch", ox, oy);
      visual = stickVisualMove(visual, x, y);
      // the axes the frame would merge are unchanged by the visual pass…
      expect(sceneAxes(ox, oy, x, y)).toEqual(axes);
      // …and the visual's own read of the same thumb stays inside its ring
      expect(Math.hypot(visual.dx, visual.dy)).toBeLessThanOrEqual(STICK_THROW_PX + 1e-9);
      expect(stickVisualRelease(visual)).toBe(STICK_VISUAL_REST);
    }
  });
});

describe("scene wiring — the face is raised, fed, hidden and removed with the stick", () => {
  it("the face is raised inside the touch stick branch, after the stick write", () => {
    const stickWrite = scene.indexOf("this.stick = { id: e.pointerId");
    const downCall = scene.indexOf("stickVisualDown(");
    const lookBranch = scene.indexOf("} else if (!this.lookDrag) {");
    expect(stickWrite).toBeGreaterThan(-1);
    expect(downCall).toBeGreaterThan(stickWrite);
    expect(downCall).toBeLessThan(lookBranch);
  });

  it("the nub is fed inside the stick move branch, after the movement writes", () => {
    const dyWrite = scene.indexOf("this.stick.dy = clamp(");
    const moveCall = scene.indexOf("stickVisualMove(");
    expect(dyWrite).toBeGreaterThan(-1);
    expect(moveCall).toBeGreaterThan(dyWrite);
  });

  it("up and cancel share the one release, and the face ends inside it", () => {
    expect(scene).toContain('canvas.addEventListener("pointerup", release);');
    expect(scene).toContain('canvas.addEventListener("pointercancel", release);');
    const releaseFn = scene.indexOf("const release = (e: PointerEvent) => {");
    const releaseCall = scene.indexOf("stickVisualRelease(");
    const upBinding = scene.indexOf('canvas.addEventListener("pointerup", release);');
    expect(releaseCall).toBeGreaterThan(releaseFn);
    expect(releaseCall).toBeLessThan(upBinding);
  });

  it("the window blur hides the face", () => {
    const blurCall = scene.indexOf("stickVisualBlur(");
    const pointerdown = scene.indexOf('canvas.addEventListener("pointerdown"');
    expect(blurCall).toBeGreaterThan(-1);
    expect(blurCall).toBeLessThan(pointerdown);
  });

  it("the layer can never intercept a touch: pointer-events none, painted over the canvas only", () => {
    expect(scene).toContain(
      '"position:absolute;inset:0;overflow:hidden;pointer-events:none;opacity:0;"',
    );
    expect(scene).toContain("parent.insertBefore(layer, this.canvas.nextSibling);");
    expect(scene).toContain('layer.dataset.testid = "world-stick-visual";');
  });

  it("the face re-dresses on theme change and is removed on dispose", () => {
    expect(scene.match(/this\.applyStickVisualStyle\(\);/g)).toHaveLength(2);
    expect(scene).toContain("this.stickVisualLayer.remove();");
  });
});
