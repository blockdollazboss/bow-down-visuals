/**
 * Beat automation tests (W3a) — the wave's proof surface:
 *  - lane normalization is defensive and clamping (never throws)
 *  - the evaluation curve holds + interpolates exactly as documented
 *  - LIVE ≡ EXPORT: the per-step event slices the live scheduler
 *    writes and the bulk event list the offline render writes produce
 *    the IDENTICAL parameter curve under Web Audio automation
 *    semantics (simulated here) — across pattern loops and song-mode
 *    chains of mixed-length patterns, with swing
 *  - BACKWARD COMPATIBILITY: a project saved before W3a (no
 *    automation field, no sends, no buses) loads with empty lanes and
 *    neutral sends, and therefore schedules ZERO automation events —
 *    the pre-W3a sound by construction
 *  - STEMS: a stem's event list carries only its own channel's lanes,
 *    and a volume lane over a stem's zeroed base stays zero
 */
import { describe, it, expect } from "vitest";
import {
  automationEventsForPlays,
  automationLaneValueAt,
  automationStepEvents,
  automationValueAt,
  beatAutomationStepTimeSec,
  clearBeatAutomationLane,
  filterBeatAutomationEvents,
  findBeatAutomationLane,
  normalizeBeatAutomation,
  removeBeatAutomationPoint,
  resizeBeatAutomation,
  scaleBeatAutomationEvents,
  setBeatAutomationPoint,
  writeBeatAutomationEvents,
  type BeatAutomationEvent,
  type BeatAutomationLane,
  type BeatAutomationParamTarget,
} from "./beat-automation";
import {
  cloneBeatPattern,
  defaultBeatProject,
  deserializeBeatProject,
  emptyBeatPattern,
  isEmptyBeatPattern,
  normalizeBeatProject,
  serializeBeatProject,
  setPatternBars,
} from "./beat-project";
import { isDefaultBeatMixerFxState } from "./beat-mixer";

const CHANNELS = ["kick", "snare", "clap", "chat", "ohat", "b808", "perc", "shk", "crash", "bass"];

/* ─── Normalization ────────────────────────────────────────────────────── */

describe("normalizeBeatAutomation", () => {
  it("returns [] for anything that is not a lane list", () => {
    expect(normalizeBeatAutomation(undefined, 16)).toEqual([]);
    expect(normalizeBeatAutomation(null, 16)).toEqual([]);
    expect(normalizeBeatAutomation("lanes", 16)).toEqual([]);
    expect(normalizeBeatAutomation([{ channel: 42, param: "volume", points: [] }], 16)).toEqual([]);
    expect(normalizeBeatAutomation([{ channel: "kick", param: "loudness", points: [{ step: 0, value: 1 }] }], 16)).toEqual([]);
  });

  it("clamps values into the parameter range and steps into the pattern", () => {
    const lanes = normalizeBeatAutomation(
      [
        {
          channel: "kick",
          param: "volume",
          points: [
            { step: 0, value: 2 },
            { step: 15, value: -1 },
            { step: 16, value: 0.5 },
            { step: -2, value: 0.5 },
          ],
        },
        { channel: "snare", param: "pan", points: [{ step: 3, value: -7 }] },
      ],
      16,
    );
    expect(lanes).toHaveLength(2);
    expect(lanes[0]!.points).toEqual([
      { step: 0, value: 1 },
      { step: 15, value: 0 },
    ]);
    expect(lanes[1]!.points).toEqual([{ step: 3, value: -1 }]);
  });

  it("sorts points, keeps the LAST value on a duplicate step, and replaces a duplicate lane", () => {
    const lanes = normalizeBeatAutomation(
      [
        { channel: "kick", param: "volume", points: [{ step: 8, value: 0.2 }, { step: 0, value: 0.4 }, { step: 8, value: 0.9 }] },
        { channel: "kick", param: "volume", points: [{ step: 4, value: 0.5 }] },
      ],
      16,
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.points).toEqual([{ step: 4, value: 0.5 }]);
    const deduped = normalizeBeatAutomation(
      [{ channel: "kick", param: "volume", points: [{ step: 8, value: 0.2 }, { step: 0, value: 0.4 }, { step: 8, value: 0.9 }] }],
      16,
    );
    expect(deduped[0]!.points).toEqual([
      { step: 0, value: 0.4 },
      { step: 8, value: 0.9 },
    ]);
  });

  it("drops channels outside the allowed set and empty lanes", () => {
    const lanes = normalizeBeatAutomation(
      [
        { channel: "melody", param: "volume", points: [{ step: 0, value: 1 }] },
        { channel: "kick", param: "volume", points: [] },
        { channel: "bass", param: "reverb", points: [{ step: 0, value: 0.3 }] },
      ],
      16,
      CHANNELS,
    );
    expect(lanes).toEqual([{ channel: "bass", param: "reverb", points: [{ step: 0, value: 0.3 }] }]);
  });
});

/* ─── Evaluation ───────────────────────────────────────────────────────── */

describe("automationValueAt", () => {
  const lane: BeatAutomationLane = {
    channel: "kick",
    param: "volume",
    points: [
      { step: 0, value: 0 },
      { step: 8, value: 1 },
      { step: 12, value: 0.5 },
    ],
  };

  it("holds the first value before it and the last value after it", () => {
    expect(automationValueAt(lane, -3)).toBe(0);
    expect(automationValueAt(lane, 15)).toBe(0.5);
    expect(automationValueAt(lane, 99)).toBe(0.5);
  });

  it("interpolates linearly between breakpoints, including fractional steps", () => {
    expect(automationValueAt(lane, 4)).toBeCloseTo(0.5, 10);
    expect(automationValueAt(lane, 2)).toBeCloseTo(0.25, 10);
    expect(automationValueAt(lane, 10)).toBeCloseTo(0.75, 10);
    expect(automationValueAt(lane, 8)).toBe(1);
  });

  it("a lane-less channel+param reads null, not a default", () => {
    expect(automationLaneValueAt([lane], "snare", "volume", 0)).toBeNull();
    expect(automationLaneValueAt([lane], "kick", "pan", 0)).toBeNull();
    expect(automationLaneValueAt([lane], "kick", "volume", 4)).toBeCloseTo(0.5, 10);
  });
});

/* ─── Edit ops ─────────────────────────────────────────────────────────── */

describe("edit ops", () => {
  it("set creates lanes, replaces a step's point, and never mutates the input", () => {
    const a0: BeatAutomationLane[] = [];
    const a1 = setBeatAutomationPoint(a0, "kick", "volume", 0, 0.5);
    const a2 = setBeatAutomationPoint(a1, "kick", "volume", 0, 0.25);
    const a3 = setBeatAutomationPoint(a2, "kick", "volume", 8, 2); // clamped to 1
    expect(a0).toEqual([]);
    expect(a1[0]!.points).toEqual([{ step: 0, value: 0.5 }]);
    expect(a2[0]!.points).toEqual([{ step: 0, value: 0.25 }]);
    expect(a3[0]!.points).toEqual([
      { step: 0, value: 0.25 },
      { step: 8, value: 1 },
    ]);
  });

  it("remove drops the point, and the lane when its last point goes", () => {
    let a = setBeatAutomationPoint([], "kick", "pan", 4, -0.5);
    a = setBeatAutomationPoint(a, "kick", "pan", 8, 0.5);
    a = removeBeatAutomationPoint(a, "kick", "pan", 4);
    expect(a[0]!.points).toEqual([{ step: 8, value: 0.5 }]);
    a = removeBeatAutomationPoint(a, "kick", "pan", 8);
    expect(a).toEqual([]);
  });

  it("clear removes only the named lane", () => {
    let a = setBeatAutomationPoint([], "kick", "volume", 0, 0.5);
    a = setBeatAutomationPoint(a, "kick", "pan", 0, 0.5);
    a = setBeatAutomationPoint(a, "snare", "volume", 0, 0.5);
    a = clearBeatAutomationLane(a, "kick", "volume");
    expect(a.map((l) => `${l.channel}:${l.param}`).sort()).toEqual(["kick:pan", "snare:volume"]);
  });

  it("resize keeps only the points inside the new pattern length", () => {
    const a: BeatAutomationLane[] = [
      { channel: "kick", param: "volume", points: [{ step: 4, value: 0.5 }, { step: 40, value: 0.5 }] },
      { channel: "snare", param: "volume", points: [{ step: 40, value: 0.5 }] },
    ];
    expect(resizeBeatAutomation(a, 16)).toEqual([
      { channel: "kick", param: "volume", points: [{ step: 4, value: 0.5 }] },
    ]);
  });
});

/* ─── Events + the live≡export curve parity proof ──────────────────────── */

type SimEvent = { timeSec: number; value: number; anchor: boolean };

/** A minimal Web Audio automation-semantics simulator: given an event
 *  list (anchors = setValueAtTime, ramps = linearRampToValueAtTime),
 *  the parameter's value at any time. Ramps interpolate from the
 *  previous event's (time, value); anchors step. */
function simulateParam(events: readonly SimEvent[], initial: number) {
  const sorted = [...events].sort((a, b) => a.timeSec - b.timeSec);
  return (t: number): number => {
    let lastTime = Number.NEGATIVE_INFINITY;
    let lastValue = initial;
    let result = initial;
    for (const e of sorted) {
      if (e.timeSec > t) {
        if (!e.anchor && Number.isFinite(lastTime)) {
          const span = e.timeSec - lastTime;
          return span > 0 ? lastValue + (e.value - lastValue) * ((t - lastTime) / span) : e.value;
        }
        return result;
      }
      result = e.value;
      lastValue = e.value;
      lastTime = e.timeSec;
    }
    return result;
  };
}

/** A recording AudioParam double with REAL Web Audio write semantics:
 *  cancelScheduledValues drops events at/after the cancel time. The
 *  parity tests drive it through the production write function itself,
 *  once with the bulk list (the export path) and once step by step
 *  (the live path), then compare the resulting curves. */
class FakeAutoParam implements BeatAutomationParamTarget {
  value = 0;
  events: SimEvent[] = [];
  constructor(private initial: number) {}
  setValueAtTime(v: number, t: number) {
    this.events.push({ timeSec: t, value: v, anchor: true });
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ timeSec: t, value: v, anchor: false });
  }
  cancelScheduledValues(t: number) {
    this.events = this.events.filter((e) => e.timeSec < t);
  }
  valueAt(t: number): number {
    return simulateParam(this.events, this.initial)(t);
  }
}

interface PlayShape {
  automation: BeatAutomationLane[];
  steps: number;
}

type ParamBook = Map<string, FakeAutoParam>;
const bookKey = (channel: string, param: string) => `${channel}:${param}`;

/** The EXPORT path: one bulk write per channel+param, exactly like the
 *  page's renderBeat. */
function offlineParams(plays: PlayShape[], stepDur: number, swing: number): ParamBook {
  const book: ParamBook = new Map();
  const bulk = automationEventsForPlays(plays, stepDur, swing);
  for (const key of new Set(bulk.map((e) => bookKey(e.channel, e.param)))) {
    const [channel, param] = key.split(":") as [string, BeatAutomationEvent["param"]];
    const target = new FakeAutoParam(0);
    writeBeatAutomationEvents(target, filterBeatAutomationEvents(bulk, channel, param));
    book.set(key, target);
  }
  return book;
}

/** The LIVE path: walk the plays step by step like the scheduler,
 *  computing each step's swung time with the shared step clock and
 *  writing that step's slice per lane (cancel only at step 0), exactly
 *  like the page's applyAutomationStepLive. */
function liveParams(plays: PlayShape[], stepDur: number, swing: number): ParamBook {
  const book: ParamBook = new Map();
  const targetFor = (channel: string, param: string) => {
    const key = bookKey(channel, param);
    let target = book.get(key);
    if (!target) {
      target = new FakeAutoParam(0);
      book.set(key, target);
    }
    return target;
  };
  let global = 0;
  for (const play of plays) {
    for (let s = 0; s < play.steps; s++, global++) {
      const when = beatAutomationStepTimeSec(global, s, stepDur, swing);
      for (const lane of play.automation) {
        const evs = automationStepEvents(lane, s, play.steps, when, stepDur, swing);
        writeBeatAutomationEvents(targetFor(lane.channel, lane.param), evs, { cancel: s === 0 });
      }
    }
  }
  return book;
}

function expectSameCurves(a: ParamBook, b: ParamBook, totalSec: number) {
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  for (const [key, pa] of a) {
    const pb = b.get(key)!;
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * totalSec;
      expect(pb.valueAt(t)).toBeCloseTo(pa.valueAt(t), 9);
    }
  }
}

describe("live ≡ export automation curves", () => {
  const stepDur = 60 / 132 / 4;
  const swing = 0.15;
  const plays: PlayShape[] = [
    {
      steps: 16,
      automation: [
        { channel: "kick", param: "volume", points: [{ step: 0, value: 1 }, { step: 8, value: 0.2 }, { step: 15, value: 0.9 }] },
        { channel: "snare", param: "pan", points: [{ step: 4, value: -0.8 }, { step: 12, value: 0.8 }] },
      ],
    },
    {
      steps: 32,
      automation: [
        { channel: "kick", param: "volume", points: [{ step: 0, value: 0.3 }, { step: 31, value: 1 }] },
        { channel: "bass", param: "reverb", points: [{ step: 16, value: 0.7 }] },
      ],
    },
    {
      steps: 16,
      automation: [
        { channel: "kick", param: "volume", points: [{ step: 0, value: 1 }, { step: 8, value: 0.2 }, { step: 15, value: 0.9 }] },
      ],
    },
  ];
  const totalSec = plays.reduce((n, p) => n + p.steps, 0) * stepDur;

  it("the bulk (export) write and the per-step (live) writes trace the same curve on every lane", () => {
    expectSameCurves(offlineParams(plays, stepDur, swing), liveParams(plays, stepDur, swing), totalSec);
  });

  it("pattern mode (the same pattern looping) matches too", () => {
    const loop = [plays[0]!, plays[0]!, plays[0]!, plays[0]!];
    expectSameCurves(offlineParams(loop, stepDur, 0), liveParams(loop, stepDur, 0), 64 * stepDur);
  });

  it("event times carry the swing offset on odd steps, like the hit scheduler", () => {
    const lane: BeatAutomationLane = { channel: "kick", param: "volume", points: [{ step: 0, value: 1 }, { step: 3, value: 0 }] };
    const evs = automationEventsForPlays([{ automation: [lane], steps: 4 }], 0.125, 0.2);
    const at = (step: number) => evs.find((e) => Math.abs(e.timeSec - beatAutomationStepTimeSec(step, step, 0.125, 0.2)) < 1e-12);
    expect(at(0)!.anchor).toBe(true);
    expect(at(1)!.timeSec).toBeCloseTo(0.125 + 0.025, 12);
    expect(at(2)!.timeSec).toBeCloseTo(0.25, 12);
    /* The closing hold lands on the unswung play end. */
    expect(evs[evs.length - 1]!.timeSec).toBeCloseTo(0.5, 12);
  });

  it("writeBeatAutomationEvents cancels once, then anchors set and ramps glide in order", () => {
    const calls: string[] = [];
    const target: BeatAutomationParamTarget = {
      value: 0,
      setValueAtTime: (v, t) => calls.push(`set ${v}@${t}`),
      linearRampToValueAtTime: (v, t) => calls.push(`ramp ${v}@${t}`),
      cancelScheduledValues: (t) => calls.push(`cancel@${t}`),
    };
    writeBeatAutomationEvents(target, [
      { channel: "kick", param: "volume", timeSec: 0, value: 1, anchor: true },
      { channel: "kick", param: "volume", timeSec: 0.5, value: 0.2, anchor: false },
      { channel: "kick", param: "volume", timeSec: 1, value: 0.9, anchor: false },
    ]);
    expect(calls).toEqual(["cancel@0", "set 1@0", "ramp 0.2@0.5", "ramp 0.9@1"]);
    /* cancel:false (the live mid-play write) never cancels — the glide
     * the previous step aimed must survive. */
    calls.length = 0;
    writeBeatAutomationEvents(
      target,
      [{ channel: "kick", param: "volume", timeSec: 1.5, value: 0.4, anchor: false }],
      { cancel: false },
    );
    expect(calls).toEqual(["ramp 0.4@1.5"]);
    /* Empty lists write nothing (the no-lane fast path). */
    calls.length = 0;
    writeBeatAutomationEvents(target, []);
    expect(calls).toEqual([]);
  });
});

/* ─── Project composition + backward compatibility ─────────────────────── */

describe("project shape (ONE shape, composed)", () => {
  it("lanes round-trip through serialize/deserialize untouched", () => {
    const project = defaultBeatProject();
    project.patterns.B = setPatternBars(project.patterns.B!, 2);
    project.patterns.B.automation = setBeatAutomationPoint([], "snare", "pan", 20, -0.6);
    const back = deserializeBeatProject(serializeBeatProject(project));
    expect(back.patterns.B.automation).toEqual([
      { channel: "snare", param: "pan", points: [{ step: 20, value: -0.6 }] },
    ]);
    expect(back.patterns.A.automation).toEqual([]);
  });

  it("a pre-W3a project (no automation, no sends, no buses anywhere) loads NEUTRAL", () => {
    const legacy = JSON.parse(serializeBeatProject(defaultBeatProject())) as Record<string, unknown>;
    /* Strip every W3a field, exactly like a save written before W3a. */
    const patterns = legacy.patterns as Record<string, Record<string, unknown>>;
    for (const p of Object.values(patterns)) delete p.automation;
    const mixerFx = legacy.mixerFx as { tracks: Record<string, Record<string, unknown>> } & Record<string, unknown>;
    for (const tr of Object.values(mixerFx.tracks)) delete tr.sends;
    delete mixerFx.buses;
    const loaded = deserializeBeatProject(JSON.stringify(legacy));
    for (const p of Object.values(loaded.patterns)) expect(p.automation).toEqual([]);
    for (const tr of Object.values(loaded.mixerFx.tracks)) expect(tr.sends).toEqual({ delay: 0, reverb: 0 });
    expect(loaded.mixerFx.buses).toEqual({ delay: { timeMs: 250, feedback: 30 }, reverb: { durationSec: 1.8, decay: 2.5 } });
    /* Neutral + empty = the pre-W3a sound: no events, default FX state. */
    expect(
      automationEventsForPlays(
        Object.values(loaded.patterns).map((p) => ({ automation: p.automation, steps: 16 })),
        0.125,
        0,
      ),
    ).toEqual([]);
    expect(isDefaultBeatMixerFxState(loaded.mixerFx)).toBe(true);
  });

  it("normalizeBeatProject defensively repairs malformed lanes instead of throwing", () => {
    const raw = JSON.parse(serializeBeatProject(defaultBeatProject())) as Record<string, unknown>;
    (raw.patterns as Record<string, Record<string, unknown>>).A!.automation = [
      { channel: "kick", param: "volume", points: [{ step: "x", value: 1 }, { step: 2, value: 99 }] },
      "garbage",
    ];
    const loaded = normalizeBeatProject(raw)!;
    expect(loaded.patterns.A.automation).toEqual([
      { channel: "kick", param: "volume", points: [{ step: 2, value: 1 }] },
    ]);
  });

  it("shrinking a pattern's bars drops the automation points past the new end", () => {
    const p = setPatternBars(emptyBeatPattern(4), 4);
    p.automation = [
      { channel: "kick", param: "volume", points: [{ step: 10, value: 0.5 }, { step: 50, value: 0.5 }] },
    ];
    const shrunk = setPatternBars(p, 1);
    expect(shrunk.automation).toEqual([
      { channel: "kick", param: "volume", points: [{ step: 10, value: 0.5 }] },
    ]);
  });

  it("a pattern holding only automation is not 'empty', and clones are deep", () => {
    const p = emptyBeatPattern();
    p.automation = setBeatAutomationPoint([], "kick", "volume", 0, 0.5);
    expect(isEmptyBeatPattern(p)).toBe(false);
    const c = cloneBeatPattern(p);
    c.automation[0]!.points[0]!.value = 0.1;
    expect(p.automation[0]!.points[0]!.value).toBe(0.5);
    expect(findBeatAutomationLane(c.automation, "kick", "volume")!.points[0]!.value).toBe(0.1);
  });
});

/* ─── Stem semantics ───────────────────────────────────────────────────── */

describe("stems keep their own channel automation — and only theirs", () => {
  const plays: PlayShape[] = [
    {
      steps: 16,
      automation: [
        { channel: "kick", param: "volume", points: [{ step: 0, value: 1 }, { step: 8, value: 0.25 }] },
        { channel: "snare", param: "pan", points: [{ step: 0, value: -1 }, { step: 8, value: 1 }] },
        { channel: "snare", param: "volume", points: [{ step: 0, value: 0.8 }] },
      ],
    },
  ];

  it("filtering to the stem channel leaves no other channel's events", () => {
    const all = automationEventsForPlays(plays, 0.125, 0);
    const snareOnly = all.filter((e) => e.channel === "snare");
    expect(snareOnly.length).toBeGreaterThan(0);
    expect(snareOnly.every((e) => e.channel === "snare")).toBe(true);
    /* The mix still carries every channel (nothing was lost upstream). */
    expect(new Set(all.map((e) => e.channel))).toEqual(new Set(["kick", "snare"]));
  });

  it("a volume lane over a zeroed stem base (muted/other channel) is identically zero", () => {
    const all = automationEventsForPlays(plays, 0.125, 0);
    const kickVol = filterBeatAutomationEvents(all, "kick", "volume");
    const zeroed = scaleBeatAutomationEvents(kickVol, 0);
    expect(zeroed.length).toBe(kickVol.length);
    expect(zeroed.every((e) => e.value === 0)).toBe(true);
    /* …and over the stem's own base it scales exactly. */
    const halved = scaleBeatAutomationEvents(kickVol, 0.5);
    expect(halved.map((e) => e.value)).toEqual(kickVol.map((e) => e.value * 0.5));
  });
});
