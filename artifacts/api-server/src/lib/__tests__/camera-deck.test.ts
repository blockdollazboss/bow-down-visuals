/**
 * Tests for the Director's Camera Deck (lib/camera-deck.ts).
 *
 * The contract pinned here:
 *  - the deck holds 47 named presets, each a substantive prompt
 *    construction (never a bare label), all ids/directions unique;
 *  - the original Wave 9D five keep their direction text BYTE-IDENTICAL
 *    to the pre-deck route constants;
 *  - stacking validates: ≤3, no duplicates, no unknown ids, and the
 *    physical conflict rules (opposites, locked statics, rig clashes,
 *    time-treatment clashes) refuse with a stated reason;
 *  - the stack block composes the moves numbered, in order;
 *  - the designer sanitizer drops illegal proposal entries openly,
 *    with notes.
 */
import { describe, it, expect } from "vitest";
import {
  CAMERA_PRESETS,
  LEGACY_MOVE_IDS,
  MAX_STACK,
  buildStackBlock,
  cameraConflictWhy,
  conflictsWith,
  getCameraPreset,
  resolveCameraStack,
  sanitizeDesignerStack,
} from "../camera-deck";

/* The pre-deck route constants, copied verbatim from the original
   wave9d-camera.ts — a legacy single pick must weave byte-identically. */
const LEGACY_DIRECTIONS: Record<string, string> = {
  "dolly-in": "DOLLY IN — the camera glides steadily toward the subject, closing distance with smooth, cinematic intent.",
  orbit: "ORBIT — the camera arcs in a slow circle around the subject, revealing them in three dimensions.",
  "crane-up": "CRANE UP — the camera rises and tilts down, swelling from intimate framing to an epic wide reveal.",
  handheld: "HANDHELD — intimate, imperfect, alive: subtle shake and drift like an operator's shoulder rig. Never nauseating.",
  "static-wide": "STATIC WIDE — the camera never moves. Locked-off master shot; all motion comes from the subject and the world.",
};

describe("camera deck — the catalog", () => {
  it("holds 47 named presets with unique ids", () => {
    expect(CAMERA_PRESETS.length).toBe(47);
    expect(new Set(CAMERA_PRESETS.map((p) => p.id)).size).toBe(47);
  });

  it("every preset is a real prompt construction, not a label", () => {
    for (const p of CAMERA_PRESETS) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.blurb.length).toBeGreaterThan(8);
      // A construction: a named move + a concrete camera instruction.
      expect(p.direction.length).toBeGreaterThanOrEqual(60);
      expect(p.direction).toMatch(/^[A-Z][A-Z ()-]+— /);
      // New constructions must speak to the camera explicitly; the legacy
      // five are exempt — their text is byte-pinned by the test below.
      if (!(p.id in LEGACY_DIRECTIONS)) {
        expect(p.direction.toLowerCase()).toContain("camera");
      }
    }
    // No two presets weave the same instruction.
    expect(new Set(CAMERA_PRESETS.map((p) => p.direction)).size).toBe(47);
  });

  it("the legacy five keep their direction text byte-identical", () => {
    for (const id of LEGACY_MOVE_IDS) {
      expect(getCameraPreset(id)?.direction).toBe(LEGACY_DIRECTIONS[id]);
    }
  });
});

describe("camera deck — conflict rules", () => {
  it("opposite directions conflict, symmetrically, with a reason", () => {
    for (const [a, b] of [
      ["dolly-in", "dolly-out"],
      ["crane-up", "crane-down"],
      ["pedestal-up", "pedestal-down"],
      ["tilt-up", "tilt-down"],
      ["pan-left", "pan-right"],
      ["tracking-left", "tracking-right"],
      ["snap-zoom", "zoom-out"],
      ["drone-rise", "fpv-dive"],
    ] as const) {
      const why = cameraConflictWhy(a, b);
      expect(why, `${a}/${b}`).toBeTruthy();
      expect(cameraConflictWhy(b, a)).toBe(why);
      expect(conflictsWith(a)).toContain(b);
      expect(conflictsWith(b)).toContain(a);
    }
  });

  it("a locked-off static conflicts with everything, including the other static", () => {
    for (const p of CAMERA_PRESETS) {
      if (p.id === "static-wide") continue;
      expect(cameraConflictWhy("static-wide", p.id), p.id).toContain("never moves");
    }
    expect(cameraConflictWhy("static-close", "dolly-in")).toContain("never moves");
  });

  it("rig and time clashes conflict; honest combos compose", () => {
    expect(cameraConflictWhy("snorricam", "orbit")).toBeTruthy();
    expect(cameraConflictWhy("bullet-time", "hyperlapse")).toBeTruthy();
    expect(cameraConflictWhy("bullet-time", "handheld")).toBeTruthy();
    // The classic combos must stay legal:
    expect(cameraConflictWhy("dolly-in", "crane-up")).toBeNull();
    expect(cameraConflictWhy("snap-zoom", "orbit")).toBeNull();
    expect(cameraConflictWhy("dolly-in", "dolly-zoom")).toBeNull();
    expect(cameraConflictWhy("orbit", "crane-up")).toBeNull();
    expect(cameraConflictWhy("follow-behind", "chase")).toBeNull();
    expect(cameraConflictWhy("rack-focus", "slow-creep")).toBeNull();
  });
});

describe("camera deck — stack resolution", () => {
  it("accepts a 3-stack and preserves performance order", () => {
    const r = resolveCameraStack([
      { preset: "snap-zoom" },
      { preset: "orbit" },
      { preset: "crane-up", intensity: "dramatic" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.entries.map((e) => e.preset.id)).toEqual(["snap-zoom", "orbit", "crane-up"]);
      expect(r.entries[2].intensity).toBe("dramatic");
      expect(r.entries[0].intensity).toBeNull();
    }
  });

  it("refuses a 4-stack, duplicates, unknown ids — each with its reason", () => {
    const four = resolveCameraStack([
      { preset: "dolly-in" }, { preset: "orbit" }, { preset: "crane-up" }, { preset: "pan-left" },
    ]);
    expect(four.ok).toBe(false);
    if (!four.ok) expect(four.error).toContain(String(MAX_STACK));

    const dup = resolveCameraStack([{ preset: "orbit" }, { preset: "orbit" }]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain("already in the stack");

    const unknown = resolveCameraStack([{ preset: "moonwalk-cam" }]);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toContain("Unknown camera move");
  });

  it("refuses a conflicting pair naming both moves and the rule", () => {
    const r = resolveCameraStack([{ preset: "dolly-in" }, { preset: "dolly-out" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Dolly In");
      expect(r.error).toContain("Dolly Out");
      expect(r.error).toContain("opposite directions");
    }
    const stat = resolveCameraStack([{ preset: "static-wide" }, { preset: "orbit" }]);
    expect(stat.ok).toBe(false);
    if (!stat.ok) expect(stat.error).toContain("never moves");
  });
});

describe("camera deck — stack composition", () => {
  it("numbers the moves in order under one continuous-path instruction", () => {
    const r = resolveCameraStack([
      { preset: "snap-zoom" },
      { preset: "orbit" },
      { preset: "crane-up" },
    ]);
    if (!r.ok) throw new Error("stack should resolve");
    const block = buildStackBlock(r.entries, "natural");
    expect(block).toContain("ONE continuous camera path");
    const i1 = block.indexOf("1. SNAP ZOOM");
    const i2 = block.indexOf("2. ORBIT");
    const i3 = block.indexOf("3. CRANE UP");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(block).toContain("Stack intensity: NATURAL");
  });

  it("marks a per-move intensity override on its own line only", () => {
    const r = resolveCameraStack([
      { preset: "slow-creep", intensity: "subtle" },
      { preset: "snap-zoom", intensity: "dramatic" },
    ]);
    if (!r.ok) throw new Error("stack should resolve");
    const block = buildStackBlock(r.entries, "natural");
    expect(block).toContain("(This move's intensity: SUBTLE");
    expect(block).toContain("(This move's intensity: DRAMATIC");
    const plain = resolveCameraStack([{ preset: "orbit" }, { preset: "crane-up" }]);
    if (!plain.ok) throw new Error("stack should resolve");
    expect(buildStackBlock(plain.entries, "natural")).not.toContain("This move's intensity");
  });
});

describe("camera deck — designer sanitizer", () => {
  it("keeps a legal proposal untouched, in order", () => {
    const { entries, notes } = sanitizeDesignerStack([
      { preset: "slow-creep", intensity: "subtle" },
      { preset: "snap-zoom", intensity: "dramatic" },
    ]);
    expect(entries.map((e) => e.preset.id)).toEqual(["slow-creep", "snap-zoom"]);
    expect(notes).toEqual([]);
  });

  it("drops unknown, duplicate, conflicting, and overflow entries — with notes", () => {
    const { entries, notes } = sanitizeDesignerStack([
      { preset: "dolly-in" },
      { preset: "warp-drive" },
      { preset: "dolly-in" },
      { preset: "dolly-out" },
      { preset: "orbit" },
      { preset: "crane-up" },
      { preset: "pan-left" },
    ]);
    expect(entries.map((e) => e.preset.id)).toEqual(["dolly-in", "orbit", "crane-up"]);
    expect(notes.length).toBe(4);
    expect(notes.join(" ")).toContain("unknown");
    expect(notes.join(" ")).toContain("Dolly Out");
    expect(notes.join(" ")).toContain("Pan Left");
  });
});
