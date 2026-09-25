/**
 * Money-integrity and pipeline tests for the AI Video Translator.
 *
 * Covers: per-minute-per-language pricing, supported language validation,
 * SRT generation, translation prompt construction + response parsing,
 * cost estimation, and automatic refund when the job fails.
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

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: () => "gpt-6-sol",
}));

import {
  VIDEO_TRANSLATOR_CREDITS_PER_MINUTE,
  TARGET_LANGUAGES,
  isSupportedLanguage,
  languageLabel,
  estimateTranslateCost,
  buildSrt,
  buildTranslationPrompt,
  parseTranslatedLines,
  runTranslateJob,
  __clearTranslateJobs,
  type TranslateJob,
  type TranscriptSegment,
} from "../video-translator";
import { refundCredits } from "../../../lib/credits";

const mockRefund = vi.mocked(refundCredits);

beforeEach(() => {
  vi.clearAllMocks();
  __clearTranslateJobs();
});

function makeJob(overrides: Partial<TranslateJob> = {}): TranslateJob {
  return {
    id: "job-123",
    userId: "user-456",
    status: "queued",
    languages: ["es", "fr"],
    sourceName: "clip.mp4",
    durationSec: null,
    outputs: ["es", "fr"].map((language) => ({
      language,
      label: languageLabel(language),
      videoUrl: null,
      videoRef: null,
      srtUrl: null,
      srtRef: null,
      error: null,
    })),
    error: null,
    creditsCharged: 20,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("pricing", () => {
  it("charges 5 credits per minute per language by default", () => {
    expect(VIDEO_TRANSLATOR_CREDITS_PER_MINUTE).toBe(5);
  });

  it("estimates cost as billable minutes × languages × rate", () => {
    // 90s video, 2 languages → 2 billable minutes × 2 × 5 = 20
    expect(estimateTranslateCost(90, 2)).toEqual({
      billableMinutes: 2,
      languageCount: 2,
      credits: 20,
    });
  });

  it("floors at 1 billable minute", () => {
    expect(estimateTranslateCost(10, 1).credits).toBe(5);
    expect(estimateTranslateCost(10, 1).billableMinutes).toBe(1);
  });

  it("rounds partial minutes up", () => {
    // 61s → 2 minutes
    expect(estimateTranslateCost(61, 1).billableMinutes).toBe(2);
  });
});

describe("language catalog", () => {
  it("includes the core creator languages", () => {
    for (const code of ["es", "fr", "pt", "de"]) {
      expect(isSupportedLanguage(code)).toBe(true);
    }
  });

  it("rejects unknown codes", () => {
    expect(isSupportedLanguage("xx")).toBe(false);
    expect(isSupportedLanguage("")).toBe(false);
  });

  it("labels fall back to the code when unknown", () => {
    expect(languageLabel("es")).toBe("Spanish");
    expect(languageLabel("xx")).toBe("xx");
  });

  it("every language has an ElevenLabs BCP-47 hint", () => {
    for (const lang of TARGET_LANGUAGES) {
      expect(lang.elevenLabsCode.length).toBeGreaterThan(0);
    }
  });
});

describe("SRT generation", () => {
  const segments: TranscriptSegment[] = [
    { start: 0.5, end: 2.25, text: "Hello world" },
    { start: 65.1, end: 67.891, text: "Second line" },
  ];

  it("builds numbered cues with correct timestamps", () => {
    const srt = buildSrt(segments);
    expect(srt).toContain("1\n00:00:00,500 --> 00:00:02,250\nHello world");
    expect(srt).toContain("2\n00:01:05,100 --> 00:01:07,891\nSecond line");
  });

  it("returns an empty string for no segments", () => {
    expect(buildSrt([])).toBe("");
  });
});

describe("translation prompt + parsing", () => {
  const segments: TranscriptSegment[] = [
    { start: 0, end: 1, text: "Welcome back" },
    { start: 1, end: 2, text: "Let's get into it" },
  ];

  it("builds a numbered prompt naming the target language", () => {
    const prompt = buildTranslationPrompt(segments, "Spanish");
    expect(prompt).toContain("Spanish");
    expect(prompt).toContain("1. Welcome back");
    expect(prompt).toContain("2. Let's get into it");
  });

  it("parses numbered model output back to plain lines", () => {
    const out = parseTranslatedLines("1. Bienvenidos de nuevo\n2. Vamos a ello", 2);
    expect(out).toEqual(["Bienvenidos de nuevo", "Vamos a ello"]);
  });

  it("falls back to raw lines when numbering is missing", () => {
    const out = parseTranslatedLines("Bienvenidos\nVamos", 2);
    expect(out).toEqual(["Bienvenidos", "Vamos"]);
  });

  it("pads shortfalls so segment alignment stays positional", () => {
    const out = parseTranslatedLines("1. Solo una", 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("Solo una");
    expect(out[2]).toBe("");
  });

  it("never returns more lines than segments", () => {
    const out = parseTranslatedLines("1. a\n2. b\n3. c", 2);
    expect(out).toHaveLength(2);
  });
});

describe("token parameter guard", () => {
  it("never uses max_tokens (GPT-6 rejects it)", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync(
        new URL("../video-translator.ts", import.meta.url),
        "utf-8",
      ),
    );
    expect(src).toContain("max_completion_tokens");
    expect(src).not.toMatch(/[^_]max_tokens[^_]/);
  });
});

describe("job failure refunds", () => {
  it("refunds the full charge when the job fails before any output", async () => {
    // Force ffprobe to fail so the job errors out immediately.
    const { execFile } = await import("child_process");
    vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, opts: unknown, cb: unknown) => {
      const callback = (typeof opts === "function" ? opts : cb) as (e: Error) => void;
      callback(new Error("ffprobe exploded"));
      return {} as never;
    }) as never);

    const job = makeJob();
    await runTranslateJob(job, Buffer.from("not-a-real-video"), "clip.mp4", "voice-1");

    expect(job.status).toBe("failed");
    expect(job.error).toBeTruthy();
    expect(mockRefund).toHaveBeenCalledWith(
      "user-456",
      20,
      expect.objectContaining({ action: expect.stringContaining("Refund") }),
    );
  });
});
