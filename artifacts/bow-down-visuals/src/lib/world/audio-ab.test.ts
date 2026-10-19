/**
 * audio-ab — STACK-20 R2 #9 (UPGRADE-PROGRAM 2.7) seam + source
 * tests. The before/after A/B player existed at the quick bench
 * for cleanup/de-reverb only (Ring 2, 2.7); this round extends
 * it to the finish tool and the full workbench's comparable
 * benches, and makes a missing original an honest, spoken state.
 * The seam tests pin the toggle state machine, the
 * position-preservation math, and the availability gating; the
 * source pins fail if the desks stop pairing results against
 * the source captured at run time, if the player grows a second
 * audio element, or if the honest-gone note disappears.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AB_COMPARABLE_BENCHES,
  abAfterLabelForBench,
  abAvailability,
  abComparableOutput,
  abResumePosition,
  abSettledSide,
  abSideAfterFlip,
} from "./audio-ab";
import type { AudioBenchResult } from "./audio-benches";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const shared = read("../../components/world/native/CreateDeskShared.tsx");
const audioDesk = read("../../components/world/native/AudioDesk.tsx");

const result = (urls: Array<{ label: string; url: string }>): AudioBenchResult => ({
  done: true,
  failed: false,
  urls,
  text: null,
  error: null,
});

describe("availability gating — a side exists only when its source is really there", () => {
  const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });

  it("a File in hand and a hosted URL both count", () => {
    expect(abAvailability({ beforeSource: file, afterUrl: "https://x/out.mp3" })).toEqual({ before: true, after: true });
    expect(abAvailability({ beforeSource: "https://x/in.mp3", afterUrl: "https://x/out.mp3" })).toEqual({ before: true, after: true });
  });

  it("null, missing and blank sources read unavailable — never present-but-broken", () => {
    expect(abAvailability({ beforeSource: null, afterUrl: "https://x/out.mp3" })).toEqual({ before: false, after: true });
    expect(abAvailability({ beforeSource: undefined, afterUrl: "" })).toEqual({ before: false, after: false });
    expect(abAvailability({ beforeSource: "   ", afterUrl: null })).toEqual({ before: false, after: false });
  });
});

describe("position preservation — the swap resumes where the ear was", () => {
  it("keeps the position when the target is longer", () => {
    expect(abResumePosition(30, 200)).toBe(30);
    expect(abResumePosition(12.5, 12.5)).toBe(12.5);
  });

  it("clamps to the target's end when the treated version is shorter", () => {
    expect(abResumePosition(30, 20)).toBe(20);
  });

  it("falls back to the position itself when the length is unreadable", () => {
    /* DeverbPanel's `duration || t`: NaN / 0 / negative all mean
       "length unknown yet", never "jump to zero". */
    expect(abResumePosition(30, Number.NaN)).toBe(30);
    expect(abResumePosition(30, 0)).toBe(30);
    expect(abResumePosition(30, -4)).toBe(30);
    expect(abResumePosition(30, null)).toBe(30);
    expect(abResumePosition(30, undefined)).toBe(30);
  });

  it("an unusable position reads as the start, never NaN into the element", () => {
    expect(abResumePosition(Number.NaN, 100)).toBe(0);
    expect(abResumePosition(-3, 100)).toBe(0);
    expect(abResumePosition(Number.POSITIVE_INFINITY, 100)).toBe(0);
    expect(abResumePosition(0, 100)).toBe(0);
  });
});

describe("the toggle state machine", () => {
  const both = { before: true, after: true };
  const noBefore = { before: false, after: true };

  it("flips land on sides that exist", () => {
    expect(abSideAfterFlip("after", "before", both)).toBe("before");
    expect(abSideAfterFlip("before", "after", both)).toBe("after");
  });

  it("a flip to a missing side is refused — the showing side stands", () => {
    expect(abSideAfterFlip("after", "before", noBefore)).toBe("after");
  });

  it("asking for the showing side is a no-op", () => {
    expect(abSideAfterFlip("before", "before", both)).toBe("before");
    expect(abSideAfterFlip("after", "after", noBefore)).toBe("after");
  });

  it("the settled side never shows a face whose audio isn't there", () => {
    expect(abSettledSide("before", both)).toBe("before");
    /* The original vanished while "before" was chosen: the face
       settles on the finished side instead of playing it under
       a Before label. */
    expect(abSettledSide("before", noBefore)).toBe("after");
    expect(abSettledSide("after", { before: true, after: false })).toBe("before");
    expect(abSettledSide("before", { before: false, after: false })).toBe("before");
  });
});

describe("which bench results carry an honest A/B", () => {
  it("the comparable set is exactly the single-source transform benches", () => {
    expect([...AB_COMPARABLE_BENCHES].sort()).toEqual(
      ["harmony", "lufs-normalize", "master", "quick-master", "singing-voice", "vocal-polish", "vocal-tune"].sort(),
    );
  });

  it("single-output transforms compare their one output, named per bench", () => {
    const out = { label: "Your finished audio", url: "https://x/out.mp3" };
    for (const [bench, label] of [
      ["master", "Mastered"],
      ["quick-master", "Mastered"],
      ["vocal-tune", "Tuned"],
      ["lufs-normalize", "Normalized"],
      ["vocal-polish", "Polished"],
      ["singing-voice", "New voice"],
    ] as const) {
      expect(abComparableOutput(bench, result([out]))).toEqual(out);
      expect(abAfterLabelForBench(bench)).toBe(label);
    }
  });

  it("harmony compares the mixed preview — picked by label, never the stem", () => {
    const mixed = { label: "Your song with harmony", url: "https://x/mix.mp3" };
    const stem = { label: "Harmony stem", url: "https://x/stem.mp3" };
    expect(abComparableOutput("harmony", result([mixed, stem]))).toEqual(mixed);
    expect(abComparableOutput("harmony", result([stem, mixed]))).toEqual(mixed);
    expect(abAfterLabelForBench("harmony")).toBe("With harmony");
    /* A result without the mixed preview fails closed. */
    expect(abComparableOutput("harmony", result([stem]))).toBeNull();
  });

  it("parts, creations and text answers carry no comparison", () => {
    const out = { label: "Stem — drums", url: "https://x/drums.mp3" };
    for (const bench of [
      "stems",
      "vocal-removal",
      "mix",
      "podcast",
      "voiceover",
      "hum",
      "lufs-analyze",
      "rate-my-mix",
      "arrangement",
    ] as const) {
      expect(abComparableOutput(bench, result([out]))).toBeNull();
      expect(abAfterLabelForBench(bench)).toBeNull();
    }
  });

  it("a comparable bench with no output compares nothing", () => {
    expect(abComparableOutput("master", result([]))).toBeNull();
  });
});

describe("source pins — the player and the desks stay honest", () => {
  it("the A/B player is ONE audio element, driven by the seam", () => {
    const player = shared.slice(shared.indexOf("export function ABAudioPlayer"));
    expect(player.match(/<audio/g)?.length).toBe(1);
    expect(player).toContain("abResumePosition(");
    expect(player).toContain("abSideAfterFlip(");
    expect(player).toContain("abSettledSide(");
    /* The position math lives in the seam now — no inline copy. */
    expect(player).not.toContain("Math.min(t,");
  });

  it("a missing original is said out loud, in the player's own note", () => {
    const player = shared.slice(shared.indexOf("export function ABAudioPlayer"));
    expect(player).toContain('data-testid="world-audio-ab-before-gone"');
    expect(player).toContain("isn&rsquo;t at this desk anymore");
    expect(player).toContain("!availability.before");
  });

  it("the quick bench pairs against the snapshot taken when the job started", () => {
    expect(audioDesk).toContain("setResultSourceFile(isFileTool ? file : null)");
    expect(audioDesk).toContain("beforeSource={resultSourceFile}");
    /* Never the live picker — re-picking a song must not re-pair
       a landed result with a new "original". */
    expect(audioDesk).not.toContain("beforeSource={file}");
  });

  it("the finish tool gets the A/B too — a demo and its finished song both exist", () => {
    expect(audioDesk).toContain('tool === "cleanup" || tool === "deverb" || tool === "finish"');
    expect(audioDesk).toContain('tool === "finish" ? "Your demo" : "Original"');
  });

  it("the full workbench pairs against the source captured at Run, through the seam", () => {
    expect(audioDesk).toContain('runSourceRef.current = def.input === "url" ? sourceUrl || null : def.input === "file" ? props.file : null');
    expect(audioDesk).toContain("setResultSource(runSourceRef.current)");
    expect(audioDesk).toContain("abComparableOutput(benchId, result)");
    expect(audioDesk).toContain("beforeSource={resultSource}");
    expect(audioDesk).toContain("afterUrl={comparable.url}");
    /* Non-comparable outputs keep their plain players beside it. */
    expect(audioDesk).toContain("restUrls.map(");
  });
});
