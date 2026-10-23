/**
 * Feel re-walk pins (Stack-100 #2, MOVEMENT-FEEL lane, items
 * 56–60). Facet C's citations were partly fabricated (its line
 * numbers point at unrelated code, and two of its named symbols
 * do not exist), so every claim below was re-verified BY
 * DESCRIPTION against the shipped tree before being pinned:
 *
 *  - Item 56 (camera collision): facet claimed a `collisionStart`
 *    field is never assigned and the camera passes through
 *    everything. There is no such symbol anywhere in the tree.
 *    Camera collision shipped as round-1 item 44: palace-layout's
 *    cameraPointFree / pullInCamera, wired into hall-scene's
 *    third-person applyFlatCamera. PINNED, not rebuilt.
 *  - Item 57 (stride & bob): facet claimed the math is dead code
 *    with no call site. stepMover drives self + peers every frame
 *    and bobY is composed onto every figure — only `stepCount`
 *    was truly unread; that half was BUILT (step-dust.ts) in its
 *    own commit. The wiring pins live here.
 *  - Item 58 (gate semantics): facet claimed gates are called
 *    "passable" while pushing the walker out (enterGate /
 *    settle-figure). No such vocabulary or functions exist. The
 *    shipped vocabulary — kind "gate"|"marker" + `open`, in
 *    palace-layout AND district-gates — already says exactly what
 *    movement does. PINNED at the movement level below.
 *  - Item 59 (gamepad LT/RT): RT was already sprint; LT was the
 *    one dead trigger — BUILT in its own commit (voice-mode step
 *    back). The wiring pins live here.
 *  - Item 60 (touch height): facet claimed phone walkers cannot
 *    climb what pads and keys can. No input has a climb control:
 *    height is resolved by segmentWalkable for every input alike,
 *    and the touch stick merges into the same fwd/strafe the keys
 *    and pad feed. PINNED (input parity + a stick-granularity
 *    climb), not rebuilt — a "step-up button" would be a no-op
 *    control, which is a fake binding by another name.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PLAZA_GATES,
  PALACE_DOORS,
  COURTYARD_ID,
  STAGE_GROUNDS_ID,
  LISTENING_GARDENS_ID,
  CREATION_ROW_ID,
  ATELIERS_ID,
  BOARDWALK_ID,
  HEIGHTS_ID,
  TERRACE_ZONES,
  isWalkable,
  cameraPointFree,
  pullInCamera,
  resolvePalaceMove,
  roomAt,
  groundHeightAt,
} from "./palace-layout";
import { DISTRICT_THRESHOLDS } from "./district-gates";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const hallScene = read("./hall-scene.ts");
const worldPage = read("../../pages/world.tsx");
const palaceLayoutSrc = read("./palace-layout.ts");
const districtGatesSrc = read("./district-gates.ts");

/** The source between two markers — a function-body slice for
 *  wiring pins, so a pin fails if the call moves OUT of the
 *  function that owns it, not merely out of the file. */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`slice markers not found: ${from} → ${to}`);
  return src.slice(a, b);
}

describe("item 56 — camera collision is wired (facet's collisionStart never existed)", () => {
  it("the third-person camera pulls in through the layout's collision, inside applyFlatCamera", () => {
    const body = slice(hallScene, "private applyFlatCamera", "private moveRig");
    expect(body).toContain("pullInCamera(");
    expect(body).toContain("camClamp");
  });

  it("no collisionStart symbol exists in the scene — the facet's named field is fabricated", () => {
    expect(hallScene).not.toContain("collisionStart");
  });

  it("backing toward the monument pulls the camera short of it, into a free point", () => {
    // The monument's heart (0, 19.7) is camera-blocked; a figure
    // south of it backing up must stop the lens on the plaza side.
    expect(cameraPointFree(COURTYARD_ID, 0, 19.7)).toBe(false);
    const pulled = pullInCamera(COURTYARD_ID, { x: 0, z: 24.5 }, { x: 0, z: 19.7 });
    expect(cameraPointFree(COURTYARD_ID, pulled.x, pulled.z)).toBe(true);
    expect(pulled.z).toBeGreaterThan(22);
    expect(pulled.z).toBeLessThan(24.5);
  });

  it("an unobstructed camera spot is returned untouched", () => {
    const desired = { x: 4, z: 26 };
    expect(cameraPointFree(COURTYARD_ID, desired.x, desired.z)).toBe(true);
    expect(pullInCamera(COURTYARD_ID, { x: 4, z: 29 }, desired)).toEqual(desired);
  });
});

describe("item 57 — stride/bob wiring and the step-dust reader", () => {
  it("figures compose the mover's bob, and the first-person camera rides it", () => {
    expect(hallScene).toContain("mover.bobY + rig.poseY");
    expect(hallScene).toContain("this.selfMover.bobY * 0.45");
  });

  it("the scene services step dust off both step counters (self + peers)", () => {
    expect(hallScene).toContain("stepsLanded(this.selfLastStepCount, this.selfMover.stepCount)");
    expect(hallScene).toContain("stepsLanded(rig.lastStepCount, rig.mover.stepCount)");
    expect(hallScene).toContain("spawnStepPuff(this.stepDust");
  });
});

describe("item 58 — gate kinds say what movement does", () => {
  it("no 'passable' vocabulary exists in the collider sources — the facet's term is fabricated", () => {
    expect(palaceLayoutSrc).not.toContain("passable");
    expect(districtGatesSrc).not.toContain("passable");
  });

  it("every district threshold in both lists is an OPEN gate — none is a marker faking a door", () => {
    expect(PLAZA_GATES).toHaveLength(6);
    for (const g of PLAZA_GATES) {
      expect(g.kind).toBe("gate");
      expect(g.open).toBe(true);
    }
    for (const t of DISTRICT_THRESHOLDS) {
      expect(t.kind).toBe("gate");
      expect(t.open).toBe(true);
    }
  });

  const ROOM_BY_GATE: Record<string, string> = {
    "STAGE GROUNDS": STAGE_GROUNDS_ID,
    "THE BOARDWALK": BOARDWALK_ID,
    "LISTENING GARDENS": LISTENING_GARDENS_ID,
    "CREATION ROW": CREATION_ROW_ID,
    "THE ATELIERS": ATELIERS_ID,
    "CREATOR HEIGHTS": HEIGHTS_ID,
  };

  it("walking through each open gate's gap really crosses into its district", () => {
    for (const gate of PLAZA_GATES) {
      const t = DISTRICT_THRESHOLDS.find((d) => d.name === gate.name)!;
      const dir = t.identity.districtDir;
      // The gate's wall normal: an axis-"x" gate spans X, so the
      // passage runs along Z; an axis-"z" gate's passage runs X.
      const start =
        gate.axis === "x" ? { x: gate.x, z: gate.z - 1.3 * dir } : { x: gate.x - 1.3 * dir, z: gate.z };
      const target =
        gate.axis === "x" ? { x: gate.x, z: gate.z + 1.3 * dir } : { x: gate.x + 1.3 * dir, z: gate.z };
      const fromRoom = roomAt(start.x, start.z, COURTYARD_ID);
      const res = resolvePalaceMove({ ...start, room: fromRoom }, target.x, target.z);
      expect({ gate: gate.name, x: res.x, z: res.z }).toEqual({ gate: gate.name, x: target.x, z: target.z });
      expect(res.room).toBe(ROOM_BY_GATE[gate.name]);
      expect(res.entered).toBe(ROOM_BY_GATE[gate.name]);
    }
  });

  it("an open gate's posts still stop a walker — only the gap is a passage", () => {
    for (const gate of PLAZA_GATES) {
      const t = DISTRICT_THRESHOLDS.find((d) => d.name === gate.name)!;
      const dir = t.identity.districtDir;
      const post =
        gate.axis === "x" ? { x: gate.x - 1.1, z: gate.z } : { x: gate.x, z: gate.z - 1.1 };
      expect(isWalkable(post.x, post.z)).toBe(false);
      const start =
        gate.axis === "x" ? { x: post.x, z: post.z - 1.3 * dir } : { x: post.x - 1.3 * dir, z: post.z };
      const target =
        gate.axis === "x" ? { x: post.x, z: post.z + 0.6 * dir } : { x: post.x + 0.6 * dir, z: post.z };
      const res = resolvePalaceMove({ ...start, room: roomAt(start.x, start.z, COURTYARD_ID) }, target.x, target.z);
      expect(Math.hypot(res.x - target.x, res.z - target.z)).toBeGreaterThan(0.01);
    }
  });

  it("every palace door's portal centre is walkable ground", () => {
    expect(PALACE_DOORS.length).toBeGreaterThan(0);
    for (const door of PALACE_DOORS) {
      const cx = (door.portal.minX + door.portal.maxX) / 2;
      const cz = (door.portal.minZ + door.portal.maxZ) / 2;
      expect(isWalkable(cx, cz)).toBe(true);
    }
  });
});

describe("item 59 — LT wiring (built in its own commit; pinned here)", () => {
  it("the flat tick consumes the pad's voice-back edge through the scene callback", () => {
    const body = slice(hallScene, "private tickFlatMove", "private tickXrMove");
    expect(body).toContain("intent.voiceBack");
    expect(body).toContain("this.onPadVoiceBack?.()");
  });

  it("the page lands LT on the same voice control as A, stepped backward", () => {
    expect(worldPage).toContain("scene.onPadVoiceBack");
    expect(worldPage).toContain("prevVoiceMode(voiceSwitchRef.current.mode)");
  });
});

describe("item 60 — touch climbs what keys and pads climb: one resolve for every input", () => {
  it("the touch stick merges into the same fwd/strafe as keys and pad", () => {
    const body = slice(hallScene, "private tickFlatMove", "private tickXrMove");
    expect(body).toContain("strafe += this.stick.dx");
    expect(body).toContain("fwd += -this.stick.dy");
    expect(body).toContain("pollGamepad(");
    expect(body).toContain("KeyW");
  });

  it("the move resolve itself reads no input source — height is input-agnostic", () => {
    const body = slice(hallScene, "private moveRig", "private tickFlatMove");
    expect(body).toContain("resolvePalaceMove(");
    expect(body).not.toContain("this.stick");
    expect(body).not.toContain("this.keys");
    expect(body).not.toContain("pollGamepad");
  });

  it("a stick-granularity walk (6 cm steps) climbs the west terraces tier by tier", () => {
    const west = TERRACE_ZONES.filter((z) => z.rect.maxX < 0).sort((a, b) => a.topY - b.topY);
    expect(west.map((z) => z.topY)).toEqual([0.3, 0.62, 0.95]);
    const low = west[0]!;
    const high = west[west.length - 1]!;
    // The z 14.2 lane: the terrace band's clear run — a planter
    // stands on the tiers at (-27.3, 15.8) and its solid footprint
    // rightly refuses that lane (a solid inside a zone wins).
    let pos = { x: low.rect.maxX + 0.8, z: 14.2 };
    // The approach stands below the first tread (plaza floor or a
    // 0.05 lawn panel); from there the first tread is one rise
    // inside STEP_UP_MAX.
    expect(groundHeightAt(pos.x, pos.z)).toBeLessThan(0.3);
    const endX = (high.rect.minX + high.rect.maxX) / 2;
    let room = roomAt(pos.x, pos.z, COURTYARD_ID);
    let steps = 0;
    while (pos.x > endX && steps < 200) {
      const res = resolvePalaceMove({ ...pos, room }, pos.x - 0.06, pos.z);
      // Every small step moves: no tier face is a wall to a walker
      // arriving by the treads, whatever device drives the walk.
      expect(res.x).toBeLessThan(pos.x);
      pos = { x: res.x, z: res.z };
      room = res.room;
      steps += 1;
    }
    expect(pos.x).toBeLessThanOrEqual(endX + 0.06);
    expect(groundHeightAt(pos.x, pos.z)).toBe(0.95);
  });
});
