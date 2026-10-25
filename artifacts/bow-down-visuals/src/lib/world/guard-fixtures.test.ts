import { describe, expect, it } from "vitest";
import {
  FIXTURE_BODIES,
  KING_FIXTURE_HEIGHT,
  WORLD_FIXTURES,
  bodyTexturesLanded,
  fixtureFallbackFor,
  fixtureNormalization,
  fixtureRotY,
  fixtureSway,
  fixtureSwayPhase,
} from "./guard-fixtures";
import {
  DEFAULT_CHARACTER_FEMALE_PATH,
  DEFAULT_CHARACTER_PATH,
  DEFAULT_FIGURE_HEIGHT,
} from "./figure";

describe("WORLD_FIXTURES — the court's posts", () => {
  it("stands five figures: the King + two guards in the hall, two on the plaza steps", () => {
    expect(WORLD_FIXTURES).toHaveLength(5);
    const hall = WORLD_FIXTURES.filter((f) => f.area === "hall");
    const plaza = WORLD_FIXTURES.filter((f) => f.area === "plaza");
    expect(hall.map((f) => f.body).sort()).toEqual(["guard-female", "guard-male", "king"]);
    expect(plaza.map((f) => f.body).sort()).toEqual(["guard-female", "guard-male"]);
    const ids = WORLD_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts the King centred at the dais foot, on the floor, facing his court", () => {
    const king = WORLD_FIXTURES.find((f) => f.body === "king");
    expect(king).toBeDefined();
    expect(king!.position.x).toBe(0);
    expect(king!.position.y).toBe(0);
    /* Dais front edge is z=-13.5; the stage seats ring sits at
     * z≈-9.6. The King stands between them, clear of both. */
    expect(king!.position.z).toBeGreaterThan(-13.5);
    expect(king!.position.z).toBeLessThan(-9.6);
    expect(king!.postRotY).toBe(0);
  });

  it("flanks the dais with the hall guards, outside its 6 m half-width", () => {
    const guards = WORLD_FIXTURES.filter((f) => f.area === "hall" && f.body !== "king");
    expect(guards).toHaveLength(2);
    for (const g of guards) {
      expect(Math.abs(g.position.x)).toBeGreaterThan(6);
      expect(g.position.y).toBe(0);
    }
    expect(guards.map((g) => Math.sign(g.position.x)).sort()).toEqual([-1, 1]);
  });

  it("stands the plaza guards ON the step platforms (palace-grounds HALL_STEPS)", () => {
    const guards = WORLD_FIXTURES.filter((f) => f.area === "plaza");
    for (const g of guards) {
      expect(g.position.y).toBeCloseTo(0.36, 5);
      expect(Math.abs(g.position.x)).toBeCloseTo(3.85, 5);
      /* Platform band z 15.16..16.4. */
      expect(g.position.z).toBeGreaterThan(15.16);
      expect(g.position.z).toBeLessThan(16.4);
    }
  });
});

describe("FIXTURE_BODIES — the live slots and facing", () => {
  it("points at the real public/world slots the scene serves", () => {
    expect(FIXTURE_BODIES["guard-male"].glbPath).toBe("/world/guard-gen.glb");
    expect(FIXTURE_BODIES["guard-female"].glbPath).toBe("/world/guard-gen-female.glb");
    expect(FIXTURE_BODIES.king.glbPath).toBe("/world/king-gen.glb");
  });

  it("guards stand at the house figure height; the King stands taller", () => {
    expect(FIXTURE_BODIES["guard-male"].height).toBe(DEFAULT_FIGURE_HEIGHT);
    expect(FIXTURE_BODIES["guard-female"].height).toBe(DEFAULT_FIGURE_HEIGHT);
    expect(FIXTURE_BODIES.king.height).toBe(KING_FIXTURE_HEIGHT);
    expect(KING_FIXTURE_HEIGHT).toBeGreaterThan(DEFAULT_FIGURE_HEIGHT);
  });

  it("carries the LIVE scene's facing verdict (every body's front is +Z)", () => {
    /* Settled by the first rig capture, Oct 24: at the proof stage's
     * claimed -90° the female stood in full profile in the live
     * plaza; the male at 0° faced the camera. See guard-fixtures.ts. */
    expect(FIXTURE_BODIES["guard-male"].rawRotY).toBe(0);
    expect(FIXTURE_BODIES["guard-female"].rawRotY).toBe(0);
    expect(FIXTURE_BODIES.king.rawRotY).toBe(0);
  });

  it("composes post + raw rotation", () => {
    const female = WORLD_FIXTURES.find((f) => f.id === "hall-guard-female")!;
    const male = WORLD_FIXTURES.find((f) => f.id === "hall-guard-male")!;
    expect(fixtureRotY(female)).toBe(0);
    expect(fixtureRotY(male)).toBe(0);
  });
});

describe("fixtureNormalization — the proof loader's math", () => {
  it("scales the raw height to the target and grounds + centres the body", () => {
    const bounds = { min: { x: -1, y: 0.2, z: -0.5 }, max: { x: 1, y: 2.2, z: 0.5 } };
    const norm = fixtureNormalization(bounds, 1.92);
    expect(norm).not.toBeNull();
    expect(norm!.scale).toBeCloseTo(0.96, 10);
    expect(norm!.offset).toEqual({ x: 0, y: -0.2, z: 0 });
    /* Applying it: feet land exactly on y=0, centre on the post. */
    expect((bounds.min.y + norm!.offset.y) * norm!.scale).toBe(0);
    expect((bounds.max.y + norm!.offset.y) * norm!.scale).toBeCloseTo(1.92, 10);
    expect(((bounds.min.x + bounds.max.x) / 2 + norm!.offset.x) * norm!.scale).toBe(0);
  });

  it("refuses degenerate bounds instead of dividing by zero", () => {
    const flat = { min: { x: 0, y: 1, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    expect(fixtureNormalization(flat, 1.92)).toBeNull();
    const nan = { min: { x: 0, y: Number.NaN, z: 0 }, max: { x: 1, y: 2, z: 1 } };
    expect(fixtureNormalization(nan, 1.92)).toBeNull();
    const ok = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 2, z: 1 } };
    expect(fixtureNormalization(ok, 0)).toBeNull();
  });
});

describe("fixtureFallbackFor — a post is never empty", () => {
  it("guards fall back to the presence figures' own mattes", () => {
    expect(fixtureFallbackFor("guard-male")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_PATH });
    expect(fixtureFallbackFor("guard-female")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_FEMALE_PATH });
  });

  it("the King falls back to the gold house capsule (he has no matte)", () => {
    const fb = fixtureFallbackFor("king");
    expect(fb.kind).toBe("capsule");
  });
});

describe("fixtureSway — statues barely breathe", () => {
  it("stays within its whisper bounds at any time", () => {
    for (const t of [0, 1_000, 12_345, 999_999]) {
      const s = fixtureSway("hall-king", t);
      expect(Math.abs(s.rotY)).toBeLessThanOrEqual(0.012);
      expect(Math.abs(s.rotZ)).toBeLessThanOrEqual(0.004);
    }
  });

  it("is deterministic per fixture and phased apart", () => {
    expect(fixtureSway("hall-king", 5_000)).toEqual(fixtureSway("hall-king", 5_000));
    expect(fixtureSwayPhase("hall-king")).not.toBe(fixtureSwayPhase("plaza-guard-male"));
    const p = fixtureSwayPhase("hall-king");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(Math.PI * 2);
  });
});

describe("bodyTexturesLanded — a white statue is a failed load", () => {
  it("a body that declares no textures is honest as-is", () => {
    expect(bodyTexturesLanded(0, [])).toBe(true);
    expect(bodyTexturesLanded(0, [{}])).toBe(true);
  });

  it("declared textures with a landed map pass", () => {
    expect(bodyTexturesLanded(2, [{ map: {} }, {}])).toBe(true);
    expect(bodyTexturesLanded(2, [{ metallicRoughnessMap: {} }])).toBe(true);
  });

  it("declared textures with NO landed map fail — the white-statue parse", () => {
    expect(bodyTexturesLanded(2, [{}, {}])).toBe(false);
    expect(bodyTexturesLanded(1, [])).toBe(false);
  });
});
