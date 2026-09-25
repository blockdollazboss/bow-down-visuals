/**
 * Sample Pack Generator — pricing, composition, and synthesis-arg tests.
 *
 * Covers: the credit contract (10=5cr / 25=12cr / 50=20cr), pack composition
 * always summing to packSize, type validation, ffmpeg arg builders producing
 * sane output paths, loop prompt construction, and the honesty contract
 * (every type has an explicit synthesized/ai-generated origin).
 */
import { describe, expect, it } from "vitest";

import {
  creditCostForPackSize,
  isSamplePackSize,
  planPackComposition,
  buildSynthArgs,
  buildLoopPrompt,
  fourBarsMs,
  sampleFileName,
  SAMPLE_TYPES,
  SAMPLE_TYPE_KEYS,
  SAMPLE_GENRES,
  isSampleGenre,
  isSampleTypeKey,
  generatePackSchema,
} from "../sample-pack-pricing";

describe("sample pack pricing contract", () => {
  it("10 samples cost 5 credits", () => {
    expect(creditCostForPackSize(10)).toBe(5);
  });

  it("25 samples cost 12 credits", () => {
    expect(creditCostForPackSize(25)).toBe(12);
  });

  it("50 samples cost 20 credits", () => {
    expect(creditCostForPackSize(50)).toBe(20);
  });

  it("rejects unsupported pack sizes", () => {
    expect(() => creditCostForPackSize(15)).toThrow();
    expect(isSamplePackSize(10)).toBe(true);
    expect(isSamplePackSize(25)).toBe(true);
    expect(isSamplePackSize(50)).toBe(true);
    expect(isSamplePackSize(20)).toBe(false);
  });
});

describe("pack composition", () => {
  it("distributes exactly packSize samples across all types by default", () => {
    for (const size of [10, 25, 50] as const) {
      const plan = planPackComposition(size);
      const total = plan.reduce((a, p) => a + p.count, 0);
      expect(total).toBe(size);
      expect(plan.length).toBe(SAMPLE_TYPE_KEYS.length);
    }
    // 25- and 50-packs are large enough that every type appears at least once.
    for (const size of [25, 50] as const) {
      const plan = planPackComposition(size);
      for (const p of plan) expect(p.count).toBeGreaterThanOrEqual(1);
    }
    // A 10-pack has fewer samples than types — at most 10 types are covered.
    const small = planPackComposition(10);
    expect(small.filter((p) => p.count > 0).length).toBeLessThanOrEqual(10);
  });

  it("respects a requested subset of types", () => {
    const plan = planPackComposition(10, ["kick", "snare", "melody"]);
    expect(plan.map((p) => p.type)).toEqual(["kick", "snare", "melody"]);
    expect(plan.reduce((a, p) => a + p.count, 0)).toBe(10);
  });

  it("gives melodies a larger share than risers (weight check)", () => {
    const plan = planPackComposition(50, ["melody", "riser"]);
    const melody = plan.find((p) => p.type === "melody")!.count;
    const riser = plan.find((p) => p.type === "riser")!.count;
    expect(melody).toBeGreaterThan(riser);
  });
});

describe("honesty contract", () => {
  it("every sample type declares an explicit origin", () => {
    for (const key of SAMPLE_TYPE_KEYS) {
      const info = SAMPLE_TYPES[key];
      expect(["synthesized", "ai-generated"]).toContain(info.origin);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.blurb.length).toBeGreaterThan(0);
    }
  });

  it("drums and FX are synthesized, melodies and bass are AI-generated", () => {
    for (const t of ["kick", "snare", "clap", "hihat", "openhat", "perc", "riser", "impact", "downlifter"] as const) {
      expect(SAMPLE_TYPES[t].origin).toBe("synthesized");
    }
    expect(SAMPLE_TYPES.melody.origin).toBe("ai-generated");
    expect(SAMPLE_TYPES.bass.origin).toBe("ai-generated");
  });
});

describe("ffmpeg synth args", () => {
  const synthTypes = SAMPLE_TYPE_KEYS.filter((t) => t !== "melody" && t !== "bass") as Array<
    Exclude<(typeof SAMPLE_TYPE_KEYS)[number], "melody" | "bass">
  >;

  it("builds args for every synthesized type with the output path embedded", () => {
    for (const t of synthTypes) {
      const { args, durationSec } = buildSynthArgs(t, "/tmp/out.wav", 0);
      expect(args.length).toBeGreaterThan(4);
      expect(args[args.length - 1]).toBe("/tmp/out.wav");
      expect(durationSec).toBeGreaterThan(0);
      expect(durationSec).toBeLessThanOrEqual(3.5);
      // 44.1kHz mono 16-bit WAV output.
      expect(args).toContain("44100");
      expect(args).toContain("pcm_s16le");
    }
  });

  it("variants produce different args (packs don't sound identical)", () => {
    const a = buildSynthArgs("kick", "/tmp/a.wav", 0).args.join(" ");
    const b = buildSynthArgs("kick", "/tmp/b.wav", 1).args.join(" ");
    expect(a).not.toBe(b);
  });

  it("one-shots are short, risers are long", () => {
    expect(buildSynthArgs("hihat", "/tmp/x.wav", 0).durationSec).toBeLessThan(0.2);
    expect(buildSynthArgs("riser", "/tmp/x.wav", 0).durationSec).toBe(3);
  });
});

describe("AI loop helpers", () => {
  it("builds a loop prompt mentioning genre, bpm, and key", () => {
    const p = buildLoopPrompt("melody", "trap", 140, "A");
    expect(p).toContain("trap");
    expect(p).toContain("140");
    expect(p).toContain("A");
    expect(p).toContain("loop");
  });

  it("bass and melody prompts differ", () => {
    expect(buildLoopPrompt("melody", "trap", 140, "A")).not.toBe(
      buildLoopPrompt("bass", "trap", 140, "A"),
    );
  });

  it("four bars at 120 BPM is 8000ms", () => {
    expect(fourBarsMs(120)).toBe(8000);
    expect(fourBarsMs(140)).toBe(Math.round((240 / 140) * 4 * 1000));
  });

  it("file names are clean and zero-padded", () => {
    expect(sampleFileName("trap", "kick", 0)).toBe("trap-kick-01.wav");
    expect(sampleFileName("drill", "melody", 9)).toBe("drill-melody-10.wav");
  });
});

describe("request validation", () => {
  it("accepts a valid pack request", () => {
    const r = generatePackSchema.safeParse({
      genre: "trap", bpm: 140, musicalKey: "A", packSize: 10,
    });
    expect(r.success).toBe(true);
  });

  it("rejects bad genre, bpm, key, and size", () => {
    expect(generatePackSchema.safeParse({ genre: "polka", bpm: 140, musicalKey: "A", packSize: 10 }).success).toBe(false);
    expect(generatePackSchema.safeParse({ genre: "trap", bpm: 40, musicalKey: "A", packSize: 10 }).success).toBe(false);
    expect(generatePackSchema.safeParse({ genre: "trap", bpm: 140, musicalKey: "H", packSize: 10 }).success).toBe(false);
    expect(generatePackSchema.safeParse({ genre: "trap", bpm: 140, musicalKey: "A", packSize: 15 }).success).toBe(false);
  });

  it("rejects unknown sample types", () => {
    expect(isSampleTypeKey("kick")).toBe(true);
    expect(isSampleTypeKey("laser")).toBe(false);
    expect(isSampleGenre("trap")).toBe(true);
    expect(isSampleGenre("polka")).toBe(false);
  });

  it("the route charges before generating (documents the 402 contract)", () => {
    // POST /api/sample-pack/generate checks req.userCredits < creditCost → 402
    // before any synthesis or provider call. Pin the thresholds.
    expect(4 < creditCostForPackSize(10)).toBe(true); // 4cr → 402 on a 10-pack
    expect(5 < creditCostForPackSize(10)).toBe(false); // exact balance → allowed
  });
});
