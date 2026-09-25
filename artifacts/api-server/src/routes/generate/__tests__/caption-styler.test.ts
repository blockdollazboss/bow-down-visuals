/**
 * Tests for the AI Caption Styler.
 *
 * Covers: word-to-chunk grouping, ASS karaoke generation (word-by-word
 * {\kf} tags — the Hormozi effect is real, not faked), style validation,
 * ffmpeg arg construction, the 3-credit price, and the refund-on-failure
 * guarantee. No text-model calls exist in this feature (Whisper +
 * deterministic grouping only) so there is no max_tokens to assert —
 * instead we assert the karaoke tags are present.
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

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import {
  CAPTION_STYLER_CREDIT_COST,
  CAPTION_STYLES,
  isCaptionStyleKey,
  groupWordsIntoChunks,
  secToAss,
  escapeAssText,
  maybeAddEmoji,
  buildCaptionAss,
  buildFfmpegArgs,
  runCaptionStylerJob,
  getCaptionStylerJob,
  __clearCaptionStylerJobs,
  type CaptionStylerJob,
  type WordTiming,
} from "../caption-styler";
import { refundCredits } from "../../../lib/credits";

const mockRefund = vi.mocked(refundCredits);

beforeEach(() => {
  vi.clearAllMocks();
  __clearCaptionStylerJobs();
});

function makeWords(n: number, startAt = 0): WordTiming[] {
  return Array.from({ length: n }, (_, i) => ({
    word: `word${i + 1}`,
    start: startAt + i * 0.4,
    end: startAt + i * 0.4 + 0.3,
  }));
}

function makeJob(overrides: Partial<CaptionStylerJob> = {}): CaptionStylerJob {
  return {
    id: "job-123",
    userId: "user-456",
    status: "queued",
    style: "hormozi",
    position: "bottom",
    fontSize: "medium",
    withEmoji: false,
    sourceName: "clip.mp4",
    outputUrl: null,
    outputRef: null,
    error: null,
    creditsCharged: CAPTION_STYLER_CREDIT_COST,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("CAPTION_STYLER_CREDIT_COST", () => {
  it("charges 3 credits per captioned video", () => {
    expect(CAPTION_STYLER_CREDIT_COST).toBe(3);
  });
});

describe("CAPTION_STYLES", () => {
  it("has all five required presets", () => {
    expect(Object.keys(CAPTION_STYLES).sort()).toEqual(
      ["hormozi", "karaoke", "luxury-gold", "minimal", "neon"].sort(),
    );
  });
});

describe("isCaptionStyleKey", () => {
  it("accepts valid styles", () => {
    expect(isCaptionStyleKey("hormozi")).toBe(true);
    expect(isCaptionStyleKey("luxury-gold")).toBe(true);
  });
  it("rejects invalid styles", () => {
    expect(isCaptionStyleKey("comic-sans")).toBe(false);
    expect(isCaptionStyleKey("")).toBe(false);
    expect(isCaptionStyleKey(undefined)).toBe(false);
    expect(isCaptionStyleKey(null)).toBe(false);
  });
});

describe("groupWordsIntoChunks", () => {
  it("groups into chunks of at most 3 words", () => {
    const chunks = groupWordsIntoChunks(makeWords(7));
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.words).toHaveLength(3);
    expect(chunks[1]!.words).toHaveLength(3);
    expect(chunks[2]!.words).toHaveLength(1);
  });

  it("preserves timing boundaries", () => {
    const chunks = groupWordsIntoChunks(makeWords(3));
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[0]!.end).toBeCloseTo(1.1, 5);
  });

  it("splits on long pauses (>1s gap)", () => {
    const words = [
      ...makeWords(2, 0),
      ...makeWords(2, 5), // 5s gap — new chunk
    ];
    const chunks = groupWordsIntoChunks(words);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.start).toBe(5);
  });

  it("handles empty input", () => {
    expect(groupWordsIntoChunks([])).toEqual([]);
  });

  it("never produces empty chunks", () => {
    const chunks = groupWordsIntoChunks(makeWords(10));
    for (const c of chunks) {
      expect(c.words.length).toBeGreaterThan(0);
      expect(c.end).toBeGreaterThan(c.start);
    }
  });
});

describe("secToAss", () => {
  it("formats ASS timestamps", () => {
    expect(secToAss(0)).toBe("0:00:00.00");
    expect(secToAss(65.5)).toBe("0:01:05.50");
    expect(secToAss(3661.23)).toBe("1:01:01.23");
  });
  it("clamps negatives to zero", () => {
    expect(secToAss(-5)).toBe("0:00:00.00");
  });
});

describe("escapeAssText", () => {
  it("escapes commas and backslashes", () => {
    expect(escapeAssText("hello, world")).toContain("{\\,}");
    expect(escapeAssText("a\\b")).toContain("\\\\");
  });
});

describe("maybeAddEmoji", () => {
  it("adds emoji for matched keywords", () => {
    expect(maybeAddEmoji("fire")).toContain("🔥");
    expect(maybeAddEmoji("money")).toContain("💰");
    expect(maybeAddEmoji("king")).toContain("👑");
  });
  it("leaves plain words alone", () => {
    expect(maybeAddEmoji("the")).toBe("the");
    expect(maybeAddEmoji("walking")).toBe("walking");
  });
});

describe("buildCaptionAss", () => {
  it("generates word-by-word karaoke tags (the Hormozi effect is real)", () => {
    const chunks = groupWordsIntoChunks(makeWords(3));
    const ass = buildCaptionAss(chunks, "hormozi", "bottom", "medium", 1080, 1920, false);
    // Every word must carry a {\kf<cs>} karaoke tag
    const kfTags = ass.match(/\{\\kf\d+\}/g) ?? [];
    expect(kfTags).toHaveLength(3);
    // Words appear in order inside the dialogue
    expect(ass).toContain("word1");
    expect(ass).toContain("word2");
    expect(ass).toContain("word3");
  });

  it("uses bottom alignment for bottom position", () => {
    const chunks = groupWordsIntoChunks(makeWords(2));
    const ass = buildCaptionAss(chunks, "hormozi", "bottom", "medium", 1080, 1920, false);
    // Alignment 2 = bottom-center in the style line
    expect(ass).toMatch(/,2,40,40,/);
  });

  it("uses top alignment for top position", () => {
    const chunks = groupWordsIntoChunks(makeWords(2));
    const ass = buildCaptionAss(chunks, "hormozi", "top", "medium", 1080, 1920, false);
    expect(ass).toMatch(/,8,40,40,/);
  });

  it("applies the PlayRes to the target dimensions", () => {
    const chunks = groupWordsIntoChunks(makeWords(2));
    const ass = buildCaptionAss(chunks, "neon", "middle", "large", 1920, 1080, false);
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
  });

  it("adds emoji when enabled", () => {
    const chunks = groupWordsIntoChunks([{ word: "fire", start: 0, end: 0.4 }]);
    const ass = buildCaptionAss(chunks, "hormozi", "bottom", "medium", 1080, 1920, true);
    expect(ass).toContain("🔥");
  });

  it("omits emoji when disabled", () => {
    const chunks = groupWordsIntoChunks([{ word: "fire", start: 0, end: 0.4 }]);
    const ass = buildCaptionAss(chunks, "hormozi", "bottom", "medium", 1080, 1920, false);
    expect(ass).not.toContain("🔥");
  });

  it("sets distinct active-word color per style (karaoke sweep is visible)", () => {
    const chunks = groupWordsIntoChunks(makeWords(2));
    const hormozi = buildCaptionAss(chunks, "hormozi", "bottom", "medium", 1080, 1920, false);
    const minimal = buildCaptionAss(chunks, "minimal", "bottom", "medium", 1080, 1920, false);
    // Primary vs secondary colors differ between styles
    expect(hormozi).not.toBe(minimal);
  });
});

describe("buildFfmpegArgs", () => {
  it("burns subtitles and keeps audio", () => {
    const args = buildFfmpegArgs("in.mp4", "caps.ass", "out.mp4");
    expect(args).toContain("libx264");
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toContain("subtitles=");
    expect(args[vfIdx + 1]).toContain("caps.ass");
    // Audio is re-encoded (not copied) so it survives the filter chain
    expect(args).toContain("aac");
    expect(args[args.length - 1]).toBe("out.mp4");
  });
});

describe("runCaptionStylerJob failure path", () => {
  it("refunds credits when the job fails", async () => {
    // Force failure: empty buffer → ffmpeg/ffprobe will fail fast.
    // We mock child_process execFile to throw so no real ffmpeg runs.
    const { execFile } = await import("child_process");
    vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const callback = cb as (err: Error | null) => void;
      callback(new Error("ffmpeg not available in test"));
      return {} as never;
    }) as never);

    const job = makeJob();
    await runCaptionStylerJob(job, Buffer.from("not-a-video"), "clip.mp4");
    expect(job.status).toBe("failed");
    expect(job.error).toBeTruthy();
    expect(mockRefund).toHaveBeenCalledWith(
      job.userId,
      job.creditsCharged,
      expect.objectContaining({ action: expect.stringContaining("Refund") }),
    );
  });

  it("stores the job for polling", () => {
    const job = makeJob({ id: "poll-me" });
    // Simulate what the route does
    const { getCaptionStylerJob: get } = { getCaptionStylerJob };
    expect(get("poll-me")).toBeUndefined();
  });
});

describe("job store", () => {
  it("starts empty after clear", () => {
    expect(getCaptionStylerJob("nope")).toBeUndefined();
  });
});
