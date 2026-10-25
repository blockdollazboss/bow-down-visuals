/**
 * Typing keeps its letters — BOTH key families (owner interaction
 * pass, 2026-10-25).
 *
 * The world page's verb handler (E / digits / Q / C / P) has always
 * skipped keystrokes aimed at a field. The scene's movement set
 * (WASD / arrows, read straight off window keydown) did not: typing
 * a message containing W/A/S/D in the say box walked the figure
 * while its owner typed. The scene handler now mirrors the page's
 * guard exactly. These pins keep the pair from drifting apart
 * again — a guard on only one family is the bug.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const GUARD = 't.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable';

describe("both world key families skip typing targets", () => {
  it("the page verb handler keeps its typing guard", () => {
    const page = read("../../pages/world.tsx");
    expect(page).toContain(GUARD);
  });

  it("the scene movement handler carries the same guard", () => {
    const scene = read("./hall-scene.ts");
    expect(scene).toContain(GUARD);
  });

  it("the scene guard drops the key instead of holding it", () => {
    const scene = read("./hall-scene.ts");
    const at = scene.indexOf(GUARD);
    expect(at).toBeGreaterThan(-1);
    expect(scene.slice(at, at + 200)).toContain("this.keys.delete(e.code)");
  });
});
