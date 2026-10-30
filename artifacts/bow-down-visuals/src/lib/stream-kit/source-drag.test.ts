/**
 * source-drag.test.ts — stack1000 M5, surface 4 (BroadcastStudio preview).
 *
 * applySourceDrag is the preview-drag step shared by BroadcastStudio's
 * pointer drag closure and its keyboard frame path. Pinned against the
 * closure's original clamps: a 5% sliver of the source always stays on
 * stage when moving; resizing floors at 5% size and caps at the stage
 * edge measured from the source's own origin.
 */
import { describe, expect, it } from "vitest";
import { applySourceDrag } from "./scenes";

const orig = { x: 0.2, y: 0.3, w: 0.4, h: 0.25 };

/** Field-wise approximate equality (0.1 + 0.2 float dust is not a diff). */
function expectRect(actual: unknown, expected: Record<string, number>) {
  const a = actual as Record<string, number>;
  expect(Object.keys(a).sort()).toEqual(Object.keys(expected).sort());
  for (const [k, v] of Object.entries(expected)) expect(a[k], k).toBeCloseTo(v, 10);
}

describe("applySourceDrag — move", () => {
  it("applies the delta plainly inside the stage", () => {
    expectRect(applySourceDrag(orig, "move", 0.1, -0.05), { x: 0.3, y: 0.25 });
  });
  it("keeps a 5% sliver on stage: floor is -size + 0.05", () => {
    expectRect(applySourceDrag(orig, "move", -10, 0), { x: -0.35, y: 0.3 });
    expectRect(applySourceDrag(orig, "move", 0, -10), { x: 0.2, y: -0.2 });
  });
  it("caps the origin at 0.95 in both axes", () => {
    expectRect(applySourceDrag(orig, "move", 10, 10), { x: 0.95, y: 0.95 });
  });
});

describe("applySourceDrag — resize", () => {
  it("grows and shrinks from the origin corner", () => {
    expectRect(applySourceDrag(orig, "resize", 0.1, 0.05), { w: 0.5, h: 0.3 });
    expectRect(applySourceDrag(orig, "resize", -0.1, -0.05), { w: 0.3, h: 0.2 });
  });
  it("floors size at 0.05", () => {
    expectRect(applySourceDrag(orig, "resize", -10, -10), { w: 0.05, h: 0.05 });
  });
  it("caps size at the stage edge from the source's origin (1 - x / 1 - y)", () => {
    expectRect(applySourceDrag(orig, "resize", 10, 10), { w: 0.8, h: 0.7 });
  });
  it("a keyboard step of 0.01 lands exactly like a 1% drag", () => {
    expectRect(applySourceDrag(orig, "move", 0.01, 0), { x: 0.21, y: 0.3 });
    expectRect(applySourceDrag(orig, "resize", 0, -0.01), { w: 0.4, h: 0.24 });
  });
});
