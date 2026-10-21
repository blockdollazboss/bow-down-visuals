/**
 * Smoke tests for the AI Filler-Word Remover.
 *
 * Covers: filler-word detection (singles, multi-word phrases,
 * normalization), cut merging, keep-segment building, silencedetect
 * output parsing, ffmpeg concat arg construction, and an end-to-end
 * ffmpeg cut-assembly run on SYNTHETIC media with a FAKE transcript
 * (no paid provider calls — Whisper is never hit here).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, writeFile, readFile, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
}));

vi.mock("../../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
}));

import {
  detectFillerCuts,
  mergeCuts,
  buildKeepSegments,
  parseSilenceDetect,
  compileFillerList,
  buildConcatArgs,
  FILLER_REMOVAL_CREDIT_COST,
  __clearFillerRemovalJobs,
} from "../filler-removal";

const execFileAsync = promisify(execFile);

beforeEach(() => {
  __clearFillerRemovalJobs();
});

describe("pricing", () => {
  it("costs 200 Visual Bucs", () => {
    expect(FILLER_REMOVAL_CREDIT_COST).toBe(200);
  });
});

describe("compileFillerList", () => {
  it("splits singles and phrases, normalizes case/punctuation", () => {
    const c = compileFillerList(["Um", "UH,", "you know", "I MEAN!", "  "]);
    expect(c.singles.has("um")).toBe(true);
    expect(c.singles.has("uh")).toBe(true);
    expect(c.phrases).toEqual([
      ["you", "know"],
      ["i", "mean"],
    ]);
  });
});

describe("detectFillerCuts", () => {
  const words = [
    { word: "So", start: 0.0, end: 0.3 },
    { word: "um,", start: 0.4, end: 0.7 },
    { word: "welcome", start: 0.8, end: 1.2 },
    { word: "you", start: 1.3, end: 1.5 },
    { word: "know", start: 1.55, end: 1.9 },
    { word: "everyone", start: 2.0, end: 2.6 },
  ];

  it("finds single fillers and multi-word phrases with padding", () => {
    const cuts = detectFillerCuts(words, ["um", "you know"]);
    expect(cuts).toHaveLength(2);
    const um = cuts.find((c) => c.label === "um")!;
    expect(um.kind).toBe("filler");
    // 0.15s padding, clamped at 0
    expect(um.start).toBeCloseTo(0.25, 2);
    expect(um.end).toBeCloseTo(0.85, 2);
    const phrase = cuts.find((c) => c.label === "you know")!;
    expect(phrase.start).toBeCloseTo(1.15, 2);
    expect(phrase.end).toBeCloseTo(2.05, 2);
  });

  it("does not cut words that merely contain a filler", () => {
    const cuts = detectFillerCuts(
      [{ word: "umbrella", start: 0, end: 0.5 }],
      ["um"],
    );
    expect(cuts).toHaveLength(0);
  });

  it("merges adjacent filler cuts", () => {
    const cuts = detectFillerCuts(
      [
        { word: "um", start: 1.0, end: 1.3 },
        { word: "uh", start: 1.35, end: 1.6 },
      ],
      ["um", "uh"],
    );
    expect(cuts).toHaveLength(1);
    expect(cuts[0].label).toContain("um");
    expect(cuts[0].label).toContain("uh");
  });

  it("returns no cuts for an empty filler list", () => {
    expect(detectFillerCuts(words, [])).toHaveLength(0);
  });
});

describe("mergeCuts", () => {
  it("merges overlapping cuts and keeps disjoint ones", () => {
    const merged = mergeCuts([
      { id: "a", start: 1, end: 2, kind: "filler", label: "um" },
      { id: "b", start: 1.9, end: 3, kind: "filler", label: "uh" },
      { id: "c", start: 10, end: 11, kind: "silence", label: "silence · 1.0s" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].start).toBe(1);
    expect(merged[0].end).toBe(3);
    expect(merged[1].kind).toBe("silence");
  });
});

describe("buildKeepSegments", () => {
  it("inverts cuts into keep-segments and absorbs slivers", () => {
    const keeps = buildKeepSegments(10, [
      { id: "a", start: 2, end: 3, kind: "filler", label: "um" },
      // This cut leaves only a 0.1s keep between 3.0 and 3.1 → absorbed
      { id: "b", start: 3.1, end: 4, kind: "filler", label: "uh" },
    ]);
    expect(keeps).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 10 },
    ]);
  });

  it("returns the whole duration when there are no cuts", () => {
    expect(buildKeepSegments(5, [])).toEqual([{ start: 0, end: 5 }]);
  });
});

describe("parseSilenceDetect", () => {
  it("parses silence_start/silence_end pairs", () => {
    const stderr = [
      "[silencedetect @ 0x123] silence_start: 1.234",
      "[silencedetect @ 0x123] silence_end: 2.846 | silence_duration: 1.612",
      "[silencedetect @ 0x123] silence_start: 9.0",
      "[silencedetect @ 0x123] silence_end: 9.9 | silence_duration: 0.9",
    ].join("\n");
    expect(parseSilenceDetect(stderr)).toEqual([
      { start: 1.234, end: 2.846 },
      { start: 9.0, end: 9.9 },
    ]);
  });
});

describe("buildConcatArgs", () => {
  it("builds a valid multi-input concat command", () => {
    const args = buildConcatArgs(
      "/tmp/in.mp4",
      [
        { start: 0, end: 5 },
        { start: 8, end: 12 },
      ],
      "/tmp/out.mp4",
      true,
    );
    expect(args).toContain("-filter_complex");
    const fc = args[args.indexOf("-filter_complex") + 1];
    expect(fc).toBe("[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]");
    expect(args).toContain("libx264");
    // two -ss/-t input pairs
    expect(args.filter((a) => a === "-ss")).toHaveLength(2);
    expect(args.filter((a) => a === "/tmp/in.mp4")).toHaveLength(2);
  });
});

describe("ffmpeg cut assembly (synthetic media, fake transcript)", () => {
  it("reassembles a video with filler segments removed", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "filler-smoke-"));
    try {
      const input = join(workDir, "input.mp4");
      const output = join(workDir, "cleaned.mp4");

      // 20s synthetic talking-head stand-in: test pattern + tone.
      await execFileAsync("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=20",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=20",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest",
        input,
      ]);

      // Fake transcript: "um" at ~2s, "you know" at ~10s, long pause 14→16s.
      const words = [
        { word: "hello", start: 0.5, end: 1.0 },
        { word: "um", start: 2.0, end: 2.4 },
        { word: "world", start: 3.0, end: 3.5 },
        { word: "you", start: 10.0, end: 10.3 },
        { word: "know", start: 10.35, end: 10.7 },
        { word: "bye", start: 17.0, end: 17.5 },
      ];
      const fillerCuts = detectFillerCuts(words, ["um", "you know"]);
      const silenceCuts = mergeCuts([
        { id: "silence-14", start: 14.08, end: 15.92, kind: "silence", label: "silence · 2.0s" },
      ]);
      const cuts = mergeCuts([...fillerCuts, ...silenceCuts]);
      expect(cuts.length).toBeGreaterThanOrEqual(3);

      const keeps = buildKeepSegments(20, cuts);
      expect(keeps.length).toBeGreaterThanOrEqual(3);

      const args = buildConcatArgs(input, keeps, output, true);
      await execFileAsync("ffmpeg", args, { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });

      const st = await stat(output);
      expect(st.size).toBeGreaterThan(10_000);

      // Output duration ≈ 20s minus cut time (within 1s tolerance for
      // seek granularity).
      const { stderr } = await execFileAsync("ffmpeg", ["-hide_banner", "-i", output]).catch(
        (e: unknown) => e as { stderr: string },
      );
      const m = /Duration:\s*(\d+):(\d+):([0-9.]+)/.exec(stderr);
      expect(m).not.toBeNull();
      const dur = Number(m![1]) * 3600 + Number(m![2]) * 60 + Number(m![3]);
      const cutTotal = cuts.reduce((s, c) => s + (c.end - c.start), 0);
      expect(dur).toBeGreaterThan(20 - cutTotal - 1.5);
      expect(dur).toBeLessThan(20 - cutTotal + 1.5);
      // Sanity: the output actually lost time (cuts were applied).
      expect(dur).toBeLessThan(19);

      // Both streams survived the concat.
      expect(/Stream #\d+:\d+.*Video:/.test(stderr)).toBe(true);
      expect(/Stream #\d+:\d+.*Audio:/.test(stderr)).toBe(true);

      // Keep the artifact path discoverable in the test output.
      await writeFile(join(workDir, "cuts.json"), JSON.stringify({ cuts, keeps }, null, 2));
      const saved = await readFile(join(workDir, "cuts.json"), "utf8");
      expect(saved).toContain("silence");
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 120_000);
});
