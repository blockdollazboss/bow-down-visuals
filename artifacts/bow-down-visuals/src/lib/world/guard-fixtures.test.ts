import { describe, expect, it } from "vitest";
import {
  FIXTURE_BODIES,
  FIXTURE_HEAL_VISIBILITY_RECHECK_MS,
  FixtureBeaconLedger,
  FixtureHealLoop,
  HALL_STAGE_TOP_Y,
  KING_FIXTURE_HEIGHT,
  PLAZA_SPAWN,
  WORLD_FIXTURES,
  attemptLoadPlan,
  bodyTexturesLanded,
  buildFixtureFailureReport,
  fixtureBodyLoadOrder,
  fixtureFallbackFor,
  fixtureHealDelayMs,
  fixtureLoadPlan,
  fixtureNormalization,
  fixturePortraitPanelSize,
  fixtureStandinArtPlan,
  fixtureRetryDelayMs,
  fixtureRotY,
  fixtureSway,
  fixtureSwayPhase,
  type WorldFixtureDef,
} from "./guard-fixtures";
import {
  DEFAULT_CHARACTER_FEMALE_PATH,
  DEFAULT_CHARACTER_PATH,
  DEFAULT_FIGURE_HEIGHT,
  KING_PORTRAIT_PATH,
} from "./figure";
import { COURTYARD_ID, PALACE_LAYOUT, groundHeightAt, pointInRect } from "./palace-layout";

describe("WORLD_FIXTURES — the court's posts", () => {
  it("stands six figures: the King + two guards in the hall, two guards on the plaza steps, and the King greeting on the plaza", () => {
    expect(WORLD_FIXTURES).toHaveLength(6);
    const hall = WORLD_FIXTURES.filter((f) => f.area === "hall");
    const plaza = WORLD_FIXTURES.filter((f) => f.area === "plaza");
    expect(hall.map((f) => f.body).sort()).toEqual(["guard-female", "guard-male", "king"]);
    expect(plaza.map((f) => f.body).sort()).toEqual(["guard-female", "guard-male", "king"]);
    const ids = WORLD_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the King greets arrivals on the plaza, off the spine, in the first frame from spawn", () => {
    const greeter = WORLD_FIXTURES.find((f) => f.id === "plaza-king");
    expect(greeter).toBeDefined();
    expect(greeter!.body).toBe("king");
    expect(greeter!.area).toBe("plaza");
    /* Flat plaza floor — no platform stands on the arrival court. */
    expect(greeter!.position.y).toBe(0);
    /* The walk spine (|x| ≤ 1.8, plaza-life) stays clear, with the
     * body's own half-width east of its edge. */
    expect(Math.abs(greeter!.position.x)).toBeGreaterThan(1.8);
    /* Between the monument (z 19.7) and the spawn stance (z 31.5),
     * south of the monument's furniture line (lamps z 24.2, benches
     * z 23.2) and north of the spawn cluster — and nearer the
     * arriving visitor than the monument is, so he is met first. */
    expect(greeter!.position.z).toBeGreaterThan(24.2);
    expect(greeter!.position.z).toBeLessThan(31.5);
    const fromSpawn = Math.hypot(greeter!.position.x - 0, greeter!.position.z - 31.5);
    expect(fromSpawn).toBeLessThan(31.5 - 19.7);
    /* Facing the arriving visitor, the plaza posts' convention. */
    expect(greeter!.postRotY).toBe(0);
    expect(fixtureRotY(greeter!)).toBe(0);
  });

  it("puts the King centred at the dais foot, ON THE STAGE, facing his court", () => {
    const king = WORLD_FIXTURES.find((f) => f.body === "king");
    expect(king).toBeDefined();
    expect(king!.position.x).toBe(0);
    /* #89 audit: the stage slab (hall-scene buildStage) tops out
     * at y = 0.7 and spans z -18..-12.2 — a post at this z stands
     * on the stage, never on the y = 0 floor. At y = 0 the King's
     * lower 0.7 m was inside the slab. */
    expect(king!.position.y).toBe(HALL_STAGE_TOP_Y);
    expect(HALL_STAGE_TOP_Y).toBe(0.7);
    /* Dais front edge is z=-13.5; the stage's front lip is
     * z=-12.2. The King stands on the stage between them, clear
     * of both. */
    expect(king!.position.z).toBeGreaterThan(-13.5);
    expect(king!.position.z).toBeLessThan(-12.2);
    expect(king!.postRotY).toBe(0);
  });

  it("flanks the dais with the hall guards, outside its 6 m half-width", () => {
    const guards = WORLD_FIXTURES.filter((f) => f.area === "hall" && f.body !== "king");
    expect(guards).toHaveLength(2);
    for (const g of guards) {
      expect(Math.abs(g.position.x)).toBeGreaterThan(6);
      /* On the stage like the King (their z is stage ground too),
       * and inside the stage's x span (±11). */
      expect(g.position.y).toBe(HALL_STAGE_TOP_Y);
      expect(Math.abs(g.position.x)).toBeLessThan(11);
      expect(g.position.z).toBeGreaterThan(-18);
      expect(g.position.z).toBeLessThan(-12.2);
    }
    expect(guards.map((g) => Math.sign(g.position.x)).sort()).toEqual([-1, 1]);
  });

  it("stands the plaza guards ON the step platforms (palace-grounds HALL_STEPS)", () => {
    const guards = WORLD_FIXTURES.filter((f) => f.area === "plaza" && f.body !== "king");
    expect(guards).toHaveLength(2);
    for (const g of guards) {
      expect(g.position.y).toBeCloseTo(0.36, 5);
      expect(Math.abs(g.position.x)).toBeCloseTo(3.85, 5);
      /* Platform band z 15.16..16.4. */
      expect(g.position.z).toBeGreaterThan(15.16);
      expect(g.position.z).toBeLessThan(16.4);
    }
  });

  /* #89 audit: a post must stand on CLEAR ground at its own
   * height — the plaza posts failed both halves: a bench pair
   * shared their platforms (its blocked rect covered the posts,
   * which also nullified the platform's step zone, so the layout
   * read the ground under the guards as y = 0, not 0.36). */
  it("every plaza post stands clear of every solid, on ground at its own height", () => {
    const blocked = PALACE_LAYOUT[COURTYARD_ID]!.blocked ?? [];
    for (const f of WORLD_FIXTURES.filter((f) => f.area === "plaza")) {
      for (const b of blocked) {
        expect(pointInRect(f.position.x, f.position.z, b), `${f.id} inside ${JSON.stringify(b)}`).toBe(false);
      }
      expect(groundHeightAt(f.position.x, f.position.z)).toBeCloseTo(f.position.y, 5);
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

describe("fixtureBodyLoadOrder — plaza bodies start first, the greeter ahead", () => {
  it("PLAZA_SPAWN is the layout's pinned courtyard spawn", () => {
    expect(PLAZA_SPAWN).toEqual(PALACE_LAYOUT[COURTYARD_ID]!.spawn);
  });

  it("starts the King's body first (his greeter stands 5.2 m from spawn), then the guards'", () => {
    expect(fixtureBodyLoadOrder()).toEqual(["king", "guard-male", "guard-female"]);
  });

  it("names every body exactly once", () => {
    const order = fixtureBodyLoadOrder();
    expect(new Set(order).size).toBe(order.length);
    expect([...order].sort()).toEqual(Object.keys(FIXTURE_BODIES).sort());
  });

  it("a hall-only body loads after every plaza body, however close to the hall it stands", () => {
    const defs: WorldFixtureDef[] = [
      { id: "hall-only", body: "guard-male", area: "hall", position: { x: 0, y: 0.7, z: -13 }, postRotY: 0 },
      { id: "plaza-far", body: "guard-female", area: "plaza", position: { x: 3.85, y: 0.36, z: 15.7 }, postRotY: 0 },
      { id: "plaza-near", body: "king", area: "plaza", position: { x: 2.6, y: 0, z: 27 }, postRotY: 0 },
    ];
    expect(fixtureBodyLoadOrder(defs)).toEqual(["king", "guard-female", "guard-male"]);
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

describe("fixtureFallbackFor — a post is never empty, and never a bare capsule by plan", () => {
  it("guards fall back to the presence figures' own mattes", () => {
    expect(fixtureFallbackFor("guard-male")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_PATH });
    expect(fixtureFallbackFor("guard-female")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_FEMALE_PATH });
  });

  it("the King falls back to his portrait figure — NOT the gold capsule", () => {
    /* Oct 27: the bare gold capsule is what the owner got for a
     * whole session. His post's planned fallback is now his
     * portrait on the easel, the presence system's portrait art. */
    expect(fixtureFallbackFor("king")).toEqual({ kind: "portrait", src: KING_PORTRAIT_PATH });
  });

  it("every post in the table resolves to its body's dignified fallback", () => {
    const byPost = new Map(WORLD_FIXTURES.map((f) => [f.id, fixtureFallbackFor(f.body)]));
    expect(byPost.get("hall-king")).toEqual({ kind: "portrait", src: KING_PORTRAIT_PATH });
    expect(byPost.get("hall-guard-male")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_PATH });
    expect(byPost.get("hall-guard-female")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_FEMALE_PATH });
    expect(byPost.get("plaza-guard-male")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_PATH });
    expect(byPost.get("plaza-guard-female")).toEqual({ kind: "matte", src: DEFAULT_CHARACTER_FEMALE_PATH });
    /* No post anywhere resolves to the capsule as its plan. */
    for (const fb of byPost.values()) expect(fb.kind).not.toBe("capsule");
  });
});

describe("fixturePortraitPanelSize — the easel panel fits the art, never stretches it", () => {
  it("the King's portrait aspect (938×841) fits by height inside the box", () => {
    const s = fixturePortraitPanelSize(938 / 841);
    expect(s.h).toBeCloseTo(1.5, 10);
    expect(s.w).toBeCloseTo(1.5 * (938 / 841), 10);
    expect(s.w / s.h).toBeCloseTo(938 / 841, 10);
  });

  it("a wide aspect is width-bound; a tall aspect is height-bound", () => {
    const wide = fixturePortraitPanelSize(3);
    expect(wide.w).toBeCloseTo(1.7, 10);
    expect(wide.h).toBeCloseTo(1.7 / 3, 10);
    const tall = fixturePortraitPanelSize(0.5);
    expect(tall.h).toBeCloseTo(1.5, 10);
    expect(tall.w).toBeCloseTo(0.75, 10);
  });

  it("a degenerate aspect falls back to the box's own shape", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const s = fixturePortraitPanelSize(bad);
      expect(s.w).toBeCloseTo(1.7, 10);
      expect(s.h).toBeCloseTo(1.5, 10);
    }
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

describe("fixtureLoadPlan — a body load is a bounded retry, not one shot", () => {
  const cdn = "https://cdn.example/world/king-gen.glb";
  const origin = "/world/king-gen.glb";

  it("alternates CDN and origin for four attempts, CDN first", () => {
    expect(fixtureLoadPlan(cdn, origin)).toEqual([cdn, origin, cdn, origin]);
  });

  it("with no CDN (mediaUrl returned the path itself) it retries the origin", () => {
    expect(fixtureLoadPlan(origin, origin)).toEqual([origin, origin, origin]);
  });

  it("backoff is immediate first, then grows, and is capped", () => {
    expect(fixtureRetryDelayMs(0)).toBe(0);
    expect(fixtureRetryDelayMs(1)).toBeGreaterThan(0);
    expect(fixtureRetryDelayMs(2)).toBeGreaterThan(fixtureRetryDelayMs(1));
    expect(fixtureRetryDelayMs(3)).toBeGreaterThan(fixtureRetryDelayMs(2));
    expect(fixtureRetryDelayMs(99)).toBe(fixtureRetryDelayMs(3));
  });
});

describe("fixtureStandinArtPlan — the fallback art walks the same plan as the bodies", () => {
  const cdn = "https://cdn.example/world/default-character.png";
  const origin = "/world/default-character.png";

  it("alternates CDN and origin, CDN first — the art has an origin leg", () => {
    /* Regression pin (Oct 28): the stand-in art used to load from
     * the CDN alone, one shot — with the CDN leg down, every post
     * degraded to the bare gold capsule even though the same art
     * sits on the origin and the bodies themselves landed via it. */
    expect(fixtureStandinArtPlan(cdn, origin)).toEqual([cdn, origin, cdn, origin]);
    expect(fixtureStandinArtPlan(cdn, origin)).toEqual(fixtureLoadPlan(cdn, origin));
  });

  it("with no CDN it retries the origin, like the bodies", () => {
    expect(fixtureStandinArtPlan(origin, origin)).toEqual([origin, origin, origin]);
  });

  it("walked with attemptLoadPlan, a dead CDN still lands the art from the origin", async () => {
    const seen: string[] = [];
    const out = await attemptLoadPlan(fixtureStandinArtPlan(cdn, origin), async (url) => {
      seen.push(url);
      if (url === cdn) throw new Error("CDN leg down");
      return `texture:${url}`;
    }, async () => {});
    expect(out).toBe(`texture:${origin}`);
    expect(seen).toEqual([cdn, origin]);
  });
});

describe("attemptLoadPlan — the retry walk itself", () => {
  const noSleep = async () => {};

  it("returns the first success and stops walking", async () => {
    const seen: string[] = [];
    const out = await attemptLoadPlan(["a", "b", "c"], async (url) => {
      seen.push(url);
      return `ok:${url}`;
    }, noSleep);
    expect(out).toBe("ok:a");
    expect(seen).toEqual(["a"]);
  });

  it("a transient failure on the first sources does not strand the load", async () => {
    const seen: string[] = [];
    const out = await attemptLoadPlan(["cdn", "origin", "cdn", "origin"], async (url) => {
      seen.push(url);
      if (seen.length < 3) throw new Error(`shed: ${url}`);
      return "body";
    }, noSleep);
    expect(out).toBe("body");
    expect(seen).toEqual(["cdn", "origin", "cdn"]);
  });

  it("sleeps the scheduled backoff before each retry, never before attempt one", async () => {
    const slept: number[] = [];
    await expect(
      attemptLoadPlan(
        ["a", "b", "c", "d"],
        async () => {
          throw new Error("down");
        },
        async (ms) => {
          slept.push(ms);
        },
      ),
    ).rejects.toThrow("down");
    expect(slept).toEqual([fixtureRetryDelayMs(1), fixtureRetryDelayMs(2), fixtureRetryDelayMs(3)]);
  });

  it("rejects with the LAST attempt's error after the plan runs out", async () => {
    let n = 0;
    await expect(
      attemptLoadPlan(["a", "b"], async () => {
        n += 1;
        throw new Error(`fail-${n}`);
      }, noSleep),
    ).rejects.toThrow("fail-2");
  });
});

describe("fixtureHealDelayMs — the slow ring's cadence", () => {
  it("ramps 1m → 3m → 10m, then holds a 15-minute cadence", () => {
    expect(fixtureHealDelayMs(0)).toBe(60_000);
    expect(fixtureHealDelayMs(1)).toBe(180_000);
    expect(fixtureHealDelayMs(2)).toBe(600_000);
    expect(fixtureHealDelayMs(3)).toBe(900_000);
    expect(fixtureHealDelayMs(99)).toBe(900_000);
  });

  it("caps the steady state at four attempts per hour", () => {
    expect(3_600_000 / fixtureHealDelayMs(3)).toBeLessThanOrEqual(4);
  });
});

describe("FixtureHealLoop — a failed load is not final for the session", () => {
  interface Armed {
    fn: () => void;
    ms: number;
  }
  function manualClock() {
    const armed: Armed[] = [];
    return {
      armed,
      setTimer: (fn: () => void, ms: number) => {
        const t: Armed = { fn, ms };
        armed.push(t);
        return t;
      },
      clearTimer: (h: unknown) => {
        const i = armed.indexOf(h as Armed);
        if (i >= 0) armed.splice(i, 1);
      },
      fireNext: () => {
        const t = armed.shift();
        if (!t) throw new Error("no timer armed");
        t.fn();
        return t.ms;
      },
    };
  }
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it("keeps retrying on the ramp until the body lands, then stops and reports the heal", async () => {
    const clock = manualClock();
    let calls = 0;
    let healed = 0;
    const loop = new FixtureHealLoop({
      attempt: async () => {
        calls += 1;
        return calls >= 3;
      },
      isVisible: () => true,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onHealed: () => {
        healed += 1;
      },
    });
    loop.start();
    expect(clock.armed.map((t) => t.ms)).toEqual([60_000]);
    expect(clock.fireNext()).toBe(60_000);
    await flush();
    expect(clock.armed.map((t) => t.ms)).toEqual([180_000]);
    expect(clock.fireNext()).toBe(180_000);
    await flush();
    expect(clock.armed.map((t) => t.ms)).toEqual([600_000]);
    expect(clock.fireNext()).toBe(600_000);
    await flush();
    expect(calls).toBe(3);
    expect(loop.attemptCount).toBe(3);
    expect(healed).toBe(1);
    expect(loop.isStopped).toBe(true);
    expect(clock.armed).toHaveLength(0);
  });

  it("never attempts while the tab is hidden — a re-check is not an attempt", async () => {
    const clock = manualClock();
    let visible = false;
    let calls = 0;
    const loop = new FixtureHealLoop({
      attempt: async () => {
        calls += 1;
        return false;
      },
      isVisible: () => visible,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    loop.start();
    expect(clock.fireNext()).toBe(60_000);
    expect(calls).toBe(0);
    expect(loop.attemptCount).toBe(0);
    expect(clock.armed.map((t) => t.ms)).toEqual([FIXTURE_HEAL_VISIBILITY_RECHECK_MS]);
    visible = true;
    expect(clock.fireNext()).toBe(FIXTURE_HEAL_VISIBILITY_RECHECK_MS);
    await flush();
    expect(calls).toBe(1);
    expect(loop.attemptCount).toBe(1);
    /* The failed visible attempt re-arms on the ramp's NEXT step —
     * the hidden re-checks in between spent nothing. */
    expect(clock.armed.map((t) => t.ms)).toEqual([180_000]);
    loop.stop();
  });

  it("stop() disarms the ring for good", async () => {
    const clock = manualClock();
    let calls = 0;
    const loop = new FixtureHealLoop({
      attempt: async () => {
        calls += 1;
        return false;
      },
      isVisible: () => true,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    loop.start();
    loop.stop();
    expect(clock.armed).toHaveLength(0);
    expect(loop.isStopped).toBe(true);
    await flush();
    expect(calls).toBe(0);
  });

  it("a rejecting attempt counts as a failed attempt, not a dead loop", async () => {
    const clock = manualClock();
    let calls = 0;
    const loop = new FixtureHealLoop({
      attempt: async () => {
        calls += 1;
        if (calls === 1) throw new Error("contract violation");
        return true;
      },
      isVisible: () => true,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    loop.start();
    clock.fireNext();
    await flush();
    expect(clock.armed.map((t) => t.ms)).toEqual([180_000]);
    clock.fireNext();
    await flush();
    expect(loop.isStopped).toBe(true);
    expect(loop.attemptCount).toBe(2);
  });
});

describe("buildFixtureFailureReport — the beacon payload", () => {
  it("flattens an Error to name + message and carries the post facts", () => {
    const err = new Error("textures did not land for https://cdn.example/world/king-gen.glb");
    err.name = "FixtureTextureError";
    const report = buildFixtureFailureReport({
      postId: "hall-king",
      body: "king",
      attempts: 4,
      err,
      userAgent: "Mozilla/5.0 (Test)",
    });
    expect(report).toEqual({
      postId: "hall-king",
      body: "king",
      attempts: 4,
      errorName: "FixtureTextureError",
      errorMessage: "textures did not land for https://cdn.example/world/king-gen.glb",
      userAgent: "Mozilla/5.0 (Test)",
    });
  });

  it("survives non-Error failures and clamps every field", () => {
    const report = buildFixtureFailureReport({
      postId: "p".repeat(100),
      body: "guard-male",
      attempts: 0,
      err: "x".repeat(900),
      userAgent: "u".repeat(400),
    });
    expect(report.postId).toHaveLength(64);
    expect(report.attempts).toBe(1);
    expect(report.errorName).toBe("Error");
    expect(report.errorMessage).toHaveLength(500);
    expect(report.userAgent).toHaveLength(300);
  });

  it("an absent error still reports a message", () => {
    const report = buildFixtureFailureReport({
      postId: "plaza-guard-female",
      body: "guard-female",
      attempts: Number.NaN,
      err: undefined,
      userAgent: "",
    });
    expect(report.attempts).toBe(1);
    expect(report.errorMessage.length).toBeGreaterThan(0);
  });
});

describe("FixtureBeaconLedger — once per post per session", () => {
  it("the first claim wins, every repeat is refused, posts are independent", () => {
    const ledger = new FixtureBeaconLedger();
    expect(ledger.claim("hall-king")).toBe(true);
    expect(ledger.claim("hall-king")).toBe(false);
    expect(ledger.claim("hall-king")).toBe(false);
    expect(ledger.claim("hall-guard-male")).toBe(true);
    expect(ledger.claim("hall-guard-male")).toBe(false);
  });
});
