/**
 * Money-integrity tests for the AI vocal remover.
 *
 * Covers: the 3-credit charge, the ffmpeg stem MP3 transcode args
 * (256k MP3, no resampling tricks that would shift key/tempo), karaoke
 * word-list normalization, and automatic refund when the job fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { promises as fsPromises } from "fs";

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

vi.mock("../../../lib/stem-separation", () => ({
  separateVocalStems: vi.fn(),
  cleanupWorkdir: vi.fn(),
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "child_process";
import {
  VOCAL_REMOVAL_CREDIT_COST,
  buildStemMp3Args,
  buildKaraokeWords,
  runVocalRemovalJob,
  __clearVocalRemovalJobs,
  type VocalRemovalJob,
} from "../vocal-removal";
import { refundCredits } from "../../../lib/credits";
import { separateVocalStems } from "../../../lib/stem-separation";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../../lib/objectStorage";

const mockRefund = vi.mocked(refundCredits);
const mockExecFile = vi.mocked(execFile);
const mockSeparate = vi.mocked(separateVocalStems);
const mockUpload = vi.mocked(uploadMediaToSupabaseStorage);
const mockRefresh = vi.mocked(refreshSupabaseStorageUrl);

beforeEach(() => {
  vi.clearAllMocks();
  __clearVocalRemovalJobs();
  // execFile is promisified in the module; make the mock thenable.
  mockExecFile.mockImplementation(((_bin: unknown, _args: unknown, opts: unknown, cb?: unknown) => {
    const callback = typeof opts === "function" ? opts : cb;
    if (typeof callback === "function") {
      (callback as (err: null, stdout: string, stderr: string) => void)(null, "", "");
    }
    return undefined as never;
  }) as never);
  // The worker writes/reads temp files — stub the fs surface it touches.
  vi.spyOn(fsPromises, "mkdtemp").mockResolvedValue("/tmp/vocalrem-test" as never);
  vi.spyOn(fsPromises, "writeFile").mockResolvedValue(undefined as never);
  vi.spyOn(fsPromises, "readFile").mockResolvedValue(Buffer.from("mp3-bytes") as never);
  vi.spyOn(fsPromises, "rm").mockResolvedValue(undefined as never);
});

function makeJob(overrides: Partial<VocalRemovalJob> = {}): VocalRemovalJob {
  return {
    id: "job-123",
    userId: "user-456",
    status: "queued",
    sourceName: "song.mp3",
    karaokeRequested: false,
    instrumentalUrl: null,
    instrumentalRef: null,
    acapellaUrl: null,
    acapellaRef: null,
    karaokeUrl: null,
    karaokeRef: null,
    error: null,
    creditsCharged: VOCAL_REMOVAL_CREDIT_COST,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("VOCAL_REMOVAL_CREDIT_COST", () => {
  it("charges 3 credits per song", () => {
    expect(VOCAL_REMOVAL_CREDIT_COST).toBe(3);
  });
});

describe("buildStemMp3Args", () => {
  it("transcodes to 256k MP3 at 44100 Hz", () => {
    const args = buildStemMp3Args("vocals.wav", "acapella.mp3");
    expect(args).toContain("libmp3lame");
    expect(args).toContain("256k");
    expect(args).toContain("44100");
    expect(args[args.length - 1]).toBe("acapella.mp3");
  });

  it("does not time-stretch or pitch-shift (key/tempo preserved)", () => {
    const args = buildStemMp3Args("in.wav", "out.mp3").join(" ");
    expect(args).not.toMatch(/atempo|asetrate|rubberband/);
  });

  it("overwrites and suppresses banner noise", () => {
    const args = buildStemMp3Args("in.wav", "out.mp3");
    expect(args).toContain("-y");
    expect(args).toContain("-hide_banner");
  });
});

describe("buildKaraokeWords", () => {
  it("flattens whisper word segments into a sorted word list", () => {
    const words = buildKaraokeWords([
      { words: [{ word: " hello ", start: 0.5, end: 0.9 }, { word: "world", start: 1.0, end: 1.4 }] },
      { words: [{ word: "again", start: 0.1, end: 0.4 }] },
    ]);
    expect(words).toEqual([
      { word: "again", start: 0.1, end: 0.4 },
      { word: "hello", start: 0.5, end: 0.9 },
      { word: "world", start: 1.0, end: 1.4 },
    ]);
  });

  it("drops empty words and clamps negative starts", () => {
    const words = buildKaraokeWords([
      { words: [{ word: "  ", start: 0, end: 0.2 }, { word: "yo", start: -0.01, end: 0.3 }] },
    ]);
    expect(words).toEqual([{ word: "yo", start: 0, end: 0.3 }]);
  });

  it("handles segments without words", () => {
    expect(buildKaraokeWords([{}, { words: [] }])).toEqual([]);
  });
});

describe("runVocalRemovalJob", () => {
  it("marks the job done with both stem URLs on success", async () => {
    const workdir = "/tmp/stems-test";
    mockSeparate.mockResolvedValue({
      vocalsPath: `${workdir}/vocals.wav`,
      instrumentalPath: `${workdir}/no_vocals.wav`,
      workdir,
    });
    mockUpload
      .mockResolvedValueOnce("ref-instrumental")
      .mockResolvedValueOnce("ref-acapella");
    mockRefresh
      .mockResolvedValueOnce("https://cdn.test/instrumental.mp3")
      .mockResolvedValueOnce("https://cdn.test/acapella.mp3");

    const job = makeJob();
    await runVocalRemovalJob(job, Buffer.from("song-bytes"), "song.mp3");

    expect(job.status).toBe("done");
    expect(job.instrumentalUrl).toBe("https://cdn.test/instrumental.mp3");
    expect(job.acapellaUrl).toBe("https://cdn.test/acapella.mp3");
    expect(mockSeparate).toHaveBeenCalledTimes(1);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("refunds the 3 credits when Demucs fails", async () => {
    mockSeparate.mockRejectedValue(new Error("Demucs timed out after 600000ms"));
    const job = makeJob();
    await runVocalRemovalJob(job, Buffer.from("song-bytes"), "song.mp3");
    expect(job.status).toBe("failed");
    expect(job.error).toContain("Demucs");
    expect(mockRefund).toHaveBeenCalledWith("user-456", 3, {
      action: "Vocal Removal — Refund (job failed)",
    });
  });

  it("does not attempt karaoke upload when not requested", async () => {
    const workdir = "/tmp/stems-test";
    mockSeparate.mockResolvedValue({
      vocalsPath: `${workdir}/vocals.wav`,
      instrumentalPath: `${workdir}/no_vocals.wav`,
      workdir,
    });
    mockUpload.mockResolvedValue("ref");
    mockRefresh.mockResolvedValue("https://cdn.test/x.mp3");

    const job = makeJob({ karaokeRequested: false });
    await runVocalRemovalJob(job, Buffer.from("song-bytes"), "song.mp3");

    expect(job.karaokeUrl).toBeNull();
    // Only the two stem uploads happened — no karaoke JSON upload.
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });

  it("uploads karaoke words when requested and transcription succeeds", async () => {
    const workdir = "/tmp/stems-test";
    mockSeparate.mockResolvedValue({
      vocalsPath: `${workdir}/vocals.wav`,
      instrumentalPath: `${workdir}/no_vocals.wav`,
      workdir,
    });
    mockUpload.mockResolvedValue("ref");
    mockRefresh.mockResolvedValue("https://cdn.test/x.mp3");

    // Mock a successful Whisper word-timing response.
    const { getOpenAI } = await import("../../../lib/ai-clients");
    vi.mocked(getOpenAI).mockReturnValue({
      audio: {
        transcriptions: {
          create: vi.fn().mockResolvedValue({
            segments: [
              { words: [{ word: "hello", start: 0.5, end: 0.9 }] },
            ],
          }),
        },
      },
    } as never);

    const job = makeJob({ karaokeRequested: true });
    await runVocalRemovalJob(job, Buffer.from("song-bytes"), "song.mp3");

    expect(job.status).toBe("done");
    expect(job.karaokeUrl).toBe("https://cdn.test/x.mp3");
    // Two stems + one karaoke JSON upload.
    expect(mockUpload).toHaveBeenCalledTimes(3);
  });
});
