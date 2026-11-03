/**
 * Length-based transcription pricing (owner ruling 2026-11-02, by
 * delegation): 100 VB flat up to 5 minutes, then +20 VB per
 * additional minute, rounded up.
 *
 * Two layers pinned here:
 *  1. The pure price function — the ruled examples (5 min = 100,
 *     6 min = 120, 11 min = 220) plus the rounding boundaries and
 *     the documented flat-base fallback for an unmeasurable duration.
 *  2. The server-side duration probe — REAL ffprobe over REAL audio
 *     generated with ffmpeg in the test (never a client-supplied
 *     number): a generated 330-second tone (5½ minutes) must probe
 *     ≈330 s and price at 120, and garbage bytes must probe null
 *     (fallback), not throw.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  transcribeCreditCost,
  probeAudioDurationSeconds,
  TRANSCRIBE_BASE_CREDIT_COST,
} from "../transcription-pricing";

const execFileAsync = promisify(execFile);

describe("transcribeCreditCost — the ruled schedule", () => {
  it("5 minutes costs the flat 100 VB", () => {
    expect(transcribeCreditCost(5 * 60)).toBe(100);
  });

  it("6 minutes costs 120 VB", () => {
    expect(transcribeCreditCost(6 * 60)).toBe(120);
  });

  it("11 minutes costs 220 VB", () => {
    expect(transcribeCreditCost(11 * 60)).toBe(220);
  });

  it("anything up to 5 minutes is the flat base", () => {
    expect(transcribeCreditCost(1)).toBe(100);
    expect(transcribeCreditCost(60)).toBe(100);
    expect(transcribeCreditCost(299)).toBe(100);
    expect(transcribeCreditCost(300)).toBe(100);
  });

  it("additional minutes round UP: 5m01s already costs 120", () => {
    expect(transcribeCreditCost(301)).toBe(120);
    expect(transcribeCreditCost(359)).toBe(120);
    expect(transcribeCreditCost(360)).toBe(120);
    expect(transcribeCreditCost(361)).toBe(140);
    expect(transcribeCreditCost(601)).toBe(220);
  });

  it("an unmeasurable duration falls back to the flat base — never a guessed length price", () => {
    expect(transcribeCreditCost(null)).toBe(TRANSCRIBE_BASE_CREDIT_COST);
    expect(transcribeCreditCost(undefined)).toBe(TRANSCRIBE_BASE_CREDIT_COST);
    expect(transcribeCreditCost(0)).toBe(TRANSCRIBE_BASE_CREDIT_COST);
    expect(transcribeCreditCost(-30)).toBe(TRANSCRIBE_BASE_CREDIT_COST);
    expect(transcribeCreditCost(Number.NaN)).toBe(TRANSCRIBE_BASE_CREDIT_COST);
  });
});

describe("probeAudioDurationSeconds — real ffprobe on real audio", () => {
  let tone330s: Buffer;

  beforeAll(async () => {
    /* Generate a real 330-second (5½-minute) WAV tone with ffmpeg to
       a scratch file — 8 kHz keeps the fixture small. */
    const tonePath = join(tmpdir(), "transcription-pricing-tone-330s.wav");
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-v", "error",
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=330",
        "-ar", "8000",
        tonePath,
      ]);
      tone330s = await readFile(tonePath);
    } finally {
      await unlink(tonePath).catch(() => {});
    }
    expect(tone330s.length).toBeGreaterThan(1_000_000);
    /* Generating 5½ minutes of real audio can exceed the default 10 s
       hook timeout on a loaded box — the fixture is real by design. */
  }, 60_000);

  it("measures the real duration of the actual bytes", async () => {
    const secs = await probeAudioDurationSeconds(tone330s, "tone.wav");
    expect(secs).not.toBeNull();
    expect(secs!).toBeGreaterThan(329);
    expect(secs!).toBeLessThan(331);
  });

  it("a measured 5½-minute file prices at 120 VB end to end (6 rounded-up minutes)", async () => {
    const secs = await probeAudioDurationSeconds(tone330s, "tone.wav");
    expect(transcribeCreditCost(secs)).toBe(120);
  });

  it("garbage bytes probe as null (the flat-base fallback), never a throw", async () => {
    const secs = await probeAudioDurationSeconds(
      Buffer.from("this is not audio at all"),
      "clip.mp3",
    );
    expect(secs).toBeNull();
    expect(transcribeCreditCost(secs)).toBe(100);
  });
});
