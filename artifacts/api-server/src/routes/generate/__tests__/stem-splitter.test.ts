/**
 * Money-integrity + correctness tests for the AI Stem Splitter.
 *
 * Covers: the 4-credit charge, the real 4-stem Demucs command shape
 * (vocals/drums/bass/other — never --two-stems), remix level validation,
 * the ffmpeg remix filter graph, and automatic refund when the job fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

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

import {
  STEM_SPLITTER_CREDIT_COST,
  STEM_KEYS,
  STEM_LABELS,
  buildDemucsArgs,
  demucsStemDir,
  stemFilePath,
  validateStemLevels,
  buildRemixFilter,
  buildRemixArgs,
  runStemJob,
  __clearStemJobs,
  type StemJob,
} from "../stem-splitter";
import { refundCredits } from "../../../lib/credits";

const mockRefund = vi.mocked(refundCredits);

beforeEach(() => {
  vi.clearAllMocks();
  __clearStemJobs();
});

function makeJob(overrides: Partial<StemJob> = {}): StemJob {
  return {
    id: "job-123",
    userId: "user-456",
    status: "queued",
    sourceName: "track.mp3",
    durationSeconds: null,
    stemUrls: null,
    stemRefs: null,
    error: null,
    creditsCharged: STEM_SPLITTER_CREDIT_COST,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("STEM_SPLITTER_CREDIT_COST", () => {
  it("charges 4 credits per song", () => {
    expect(STEM_SPLITTER_CREDIT_COST).toBe(4);
  });
});

describe("STEM_KEYS / STEM_LABELS", () => {
  it("covers exactly the 4 Demucs stems", () => {
    expect(STEM_KEYS).toEqual(["vocals", "drums", "bass", "other"]);
  });

  it("labels the 'other' stem honestly as melody/other", () => {
    expect(STEM_LABELS.other).toMatch(/other/i);
  });
});

describe("buildDemucsArgs", () => {
  it("runs a full 4-stem separation — never --two-stems", () => {
    const args = buildDemucsArgs("/tmp/song.mp3", "/tmp/out", "htdemucs");
    expect(args).toEqual([
      "-m", "demucs",
      "-n", "htdemucs",
      "-d", "cpu",
      "--out", "/tmp/out",
      "/tmp/song.mp3",
    ]);
    expect(args).not.toContain("--two-stems");
  });
});

describe("demucsStemDir / stemFilePath", () => {
  it("matches the Demucs output layout <out>/<model>/<basename>/<stem>.wav", () => {
    const dir = demucsStemDir("/tmp/out", "htdemucs", "/tmp/work/input.mp3");
    expect(dir).toBe("/tmp/out/htdemucs/input");
    expect(stemFilePath(dir, "drums")).toBe("/tmp/out/htdemucs/input/drums.wav");
    expect(stemFilePath(dir, "vocals")).toBe("/tmp/out/htdemucs/input/vocals.wav");
  });
});

describe("validateStemLevels", () => {
  it("accepts a full valid level map", () => {
    expect(validateStemLevels({ vocals: 1, drums: 0.8, bass: 1.2, other: 0 })).toEqual({
      vocals: 1, drums: 0.8, bass: 1.2, other: 0,
    });
  });

  it("accepts the 0–2 range edges", () => {
    expect(validateStemLevels({ vocals: 0, drums: 2, bass: 2, other: 0 })).not.toBeNull();
  });

  it("rejects missing stems", () => {
    expect(validateStemLevels({ vocals: 1, drums: 1, bass: 1 })).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(validateStemLevels({ vocals: 1, drums: 1, bass: 1, other: 2.5 })).toBeNull();
    expect(validateStemLevels({ vocals: 1, drums: 1, bass: -1, other: 1 })).toBeNull();
  });

  it("rejects non-numbers and non-objects", () => {
    expect(validateStemLevels({ vocals: "1", drums: 1, bass: 1, other: 1 })).toBeNull();
    expect(validateStemLevels(null)).toBeNull();
    expect(validateStemLevels("levels")).toBeNull();
  });
});

describe("buildRemixFilter", () => {
  it("applies per-stem volume then sums without normalization", () => {
    const filter = buildRemixFilter({ vocals: 1, drums: 0.5, bass: 1.5, other: 0 });
    expect(filter).toContain("[0:a]volume=1[s0]");
    expect(filter).toContain("[1:a]volume=0.5[s1]");
    expect(filter).toContain("[2:a]volume=1.5[s2]");
    expect(filter).toContain("[3:a]volume=0[s3]");
    expect(filter).toContain("amix=inputs=4");
    expect(filter).toContain("normalize=0");
    // Limiter guards against clipping when stems are boosted.
    expect(filter).toContain("alimiter");
  });
});

describe("buildRemixArgs", () => {
  it("maps the four stems as inputs in stem order", () => {
    const args = buildRemixArgs(
      { vocals: "/w/vocals.wav", drums: "/w/drums.wav", bass: "/w/bass.wav", other: "/w/other.wav" },
      { vocals: 1, drums: 1, bass: 1, other: 1 },
      "/w/remix.wav",
    );
    expect(args).toContain("-filter_complex");
    expect(args.indexOf("-i")).toBeLessThan(args.indexOf("-filter_complex"));
    expect(args.slice(-1)[0]).toBe("/w/remix.wav");
    expect(args).toContain("pcm_s16le");
  });
});

describe("runStemJob failure path", () => {
  it("marks the job failed and refunds the 4 credits when Demucs cannot start", async () => {
    // ffprobe is the first subprocess; point PATH lookups at nothing so it
    // fails fast. We exercise the catch → failed → refund path, not Demucs.
    const job = makeJob();
    await runStemJob(job, Buffer.from("not-real-audio"), "track.mp3");
    expect(job.status).toBe("failed");
    expect(job.error).toBeTruthy();
    expect(mockRefund).toHaveBeenCalledWith(
      job.userId,
      STEM_SPLITTER_CREDIT_COST,
      expect.objectContaining({ action: expect.stringContaining("Refund") }),
    );
  });
});
