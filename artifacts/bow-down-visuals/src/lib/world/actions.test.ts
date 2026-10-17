/**
 * Avatar actions (lib/world/actions) — the pose math.
 *
 * Pinned: the id set matches the owner's list and the server's
 * relay; every one-shot starts and ends at neutral (no pose pops),
 * completes to null at its duration; toggles pose forever and are
 * the ones a walk clears; a bow actually leans FORWARD (negative
 * tiltX — the figure's front is -Z); a spin turns exactly one full
 * revolution; a sit ends at seat height; a dance never sits still.
 */
import { describe, it, expect } from "vitest";
import {
  WORLD_ACTIONS,
  ACTION_BY_ID,
  NEUTRAL_POSE,
  actionPoseAt,
  actionClearedByMove,
  isWorldActionId,
  type WorldActionId,
} from "./actions";

describe("the action set", () => {
  it("is the owner's seven, with dance and sit as the toggles", () => {
    expect(WORLD_ACTIONS.map((a) => a.id)).toEqual(["bow", "wave", "cheer", "clap", "spin", "dance", "sit"]);
    expect(WORLD_ACTIONS.filter((a) => a.kind === "toggle").map((a) => a.id)).toEqual(["dance", "sit"]);
    for (const a of WORLD_ACTIONS) {
      expect(ACTION_BY_ID.get(a.id)).toBe(a);
      expect(isWorldActionId(a.id)).toBe(true);
    }
    expect(isWorldActionId("backflip")).toBe(false);
    expect(isWorldActionId(null)).toBe(false);
  });

  it("only toggles clear on a walk", () => {
    expect(actionClearedByMove("dance")).toBe(true);
    expect(actionClearedByMove("sit")).toBe(true);
    expect(actionClearedByMove("bow")).toBe(false);
    expect(actionClearedByMove(null)).toBe(false);
  });
});

describe("one-shot poses", () => {
  const onceIds = WORLD_ACTIONS.filter((a) => a.kind === "once").map((a) => a.id);

  it.each(onceIds)("%s starts neutral and ends by settling to null", (id) => {
    const def = ACTION_BY_ID.get(id)!;
    const start = actionPoseAt(id, 0)!;
    expect(Math.abs(start.tiltX)).toBeLessThan(0.02);
    expect(Math.abs(start.tiltZ)).toBeLessThan(0.02);
    expect(Math.abs(start.y)).toBeLessThan(0.02);
    expect(actionPoseAt(id, def.durationMs)).toBeNull();
    expect(actionPoseAt(id, def.durationMs + 500)).toBeNull();
    expect(actionPoseAt(id, def.durationMs - 1)).not.toBeNull();
  });

  it("a bow leans forward, deep — never backward", () => {
    const mid = actionPoseAt("bow", 700)!;
    expect(mid.tiltX).toBeLessThan(-0.4);
    for (let ms = 0; ms < 1500; ms += 75) {
      expect(actionPoseAt("bow", ms)!.tiltX).toBeLessThanOrEqual(0.001);
    }
  });

  it("a spin turns exactly one full revolution", () => {
    const near = actionPoseAt("spin", 949)!;
    expect(near.spinY).toBeGreaterThan(Math.PI * 2 * 0.98);
    const quarter = actionPoseAt("spin", 237)!;
    expect(quarter.spinY).toBeGreaterThan(0);
    expect(quarter.spinY).toBeLessThan(Math.PI);
  });

  it("a cheer leaves the ground and comes back", () => {
    const peak = actionPoseAt("cheer", 312)!;
    expect(peak.y).toBeGreaterThan(0.1);
    const end = actionPoseAt("cheer", 1240)!;
    expect(end.y).toBeLessThan(0.03);
  });
});

describe("toggle poses", () => {
  it("sit settles to seat height and holds it", () => {
    const settled = actionPoseAt("sit", 5000)!;
    expect(settled.y).toBeCloseTo(-0.52, 2);
    const entering = actionPoseAt("sit", 60)!;
    expect(entering.y).toBeGreaterThan(-0.3);
    expect(entering.y).toBeLessThan(0);
  });

  it("dance keeps moving — bounce and sway never flatline", () => {
    const ys = new Set<number>();
    const zs = new Set<number>();
    for (let ms = 0; ms < 3000; ms += 90) {
      const pose = actionPoseAt("dance", ms)!;
      ys.add(Math.round(pose.y * 200));
      zs.add(Math.round(pose.tiltZ * 200));
      expect(pose.y).toBeGreaterThanOrEqual(0);
    }
    expect(ys.size).toBeGreaterThan(4);
    expect(zs.size).toBeGreaterThan(4);
    // Still dancing ten minutes in — a toggle ends by frame, not by clock.
    expect(actionPoseAt("dance", 600_000)).not.toBeNull();
    expect(actionPoseAt("sit", 600_000)).not.toBeNull();
  });

  it("neutral is the resting pose", () => {
    expect(NEUTRAL_POSE).toEqual({ tiltX: 0, tiltZ: 0, spinY: 0, y: 0 });
  });
});
