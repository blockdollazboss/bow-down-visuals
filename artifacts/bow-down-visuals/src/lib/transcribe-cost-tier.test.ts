/**
 * transcribe-cost-tier.test.ts — stack1400, owner ruled 2026-11-02.
 *
 * The FE mirror of the server transcription length price: the spend
 * confirmation must quote the amount the server will actually charge
 * for the file's real duration — 100 VB up to 5 minutes, then
 * +20 VB per additional minute, rounded up (5 min → 100, 6 min → 120,
 * 11 min → 220). Server source of truth: transcribeCreditCost in
 * artifacts/api-server/src/lib/transcription-pricing.ts (the server
 * measures the actual bytes with ffprobe before charging; the FE
 * probes the same file in the browser to quote it).
 *
 * Before this lane, NO caller passed overrideCost, so every
 * confirmation fell back to the registry's flat 100 — an 11-minute
 * file was quoted 100 and charged 220. The wiring pins below cover
 * every FE caller of /api/transcribe and /api/transcribe-url found
 * by census.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getCreditCost,
  transcribeCostForDurationSec,
  TRANSCRIBE_BASE_CREDIT_COST,
  TRANSCRIBE_INCLUDED_MINUTES,
  TRANSCRIBE_EXTRA_MINUTE_CREDIT_COST,
} from "./credit-costs";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("transcribeCostForDurationSec — FE mirror of the server length price", () => {
  it("pins the schedule constants", () => {
    expect(TRANSCRIBE_BASE_CREDIT_COST).toBe(100);
    expect(TRANSCRIBE_INCLUDED_MINUTES).toBe(5);
    expect(TRANSCRIBE_EXTRA_MINUTE_CREDIT_COST).toBe(20);
  });

  it("5 minutes shows 100", () => {
    expect(transcribeCostForDurationSec(5 * 60)).toBe(100);
    expect(transcribeCostForDurationSec(60)).toBe(100);
    expect(transcribeCostForDurationSec(299)).toBe(100);
    expect(transcribeCostForDurationSec(300)).toBe(100);
  });

  it("6 minutes shows 120", () => {
    expect(transcribeCostForDurationSec(6 * 60)).toBe(120);
    expect(transcribeCostForDurationSec(359)).toBe(120);
  });

  it("11 minutes shows 220", () => {
    expect(transcribeCostForDurationSec(11 * 60)).toBe(220);
    expect(transcribeCostForDurationSec(601)).toBe(220);
  });

  it("additional minutes round UP, matching the server: 5m01s already shows 120", () => {
    expect(transcribeCostForDurationSec(301)).toBe(120);
    expect(transcribeCostForDurationSec(361)).toBe(140);
  });

  it("an unmeasurable duration falls back to the flat base — the server's own fallback", () => {
    for (const d of [Number.NaN, undefined, null, 0, -30]) {
      expect(transcribeCostForDurationSec(d)).toBe(100);
    }
  });

  it("the registry still records the base price the helper tiers from", () => {
    expect(getCreditCost("/api/transcribe")?.cost).toBe(100);
    expect(getCreditCost("/api/transcribe-url")?.cost).toBe(100);
  });
});

describe("transcription callers — confirmations quote the tiered price", () => {
  it("AudioTranscribe probes the selected file and passes its tier as overrideCost", () => {
    const src = read("../components/AudioTranscribe.tsx");
    expect(src).toContain("probeMediaDurationSec(file)");
    expect(src).toContain("overrideCost: transcribeCostForDurationSec(durationSec)");
  });

  it("song-and-video's simple intake probes the uploaded file and passes its tier", () => {
    const src = read("../pages/song-and-video.tsx");
    expect(src).toContain("probeMediaDurationSec(file)");
    expect(src).toContain("overrideCost: transcribeCostForDurationSec(durationSec)");
  });

  it("SongWorkflow quotes the tier from the song's probed duration", () => {
    const src = read("../components/editor/music/SongWorkflow.tsx");
    expect(src).toContain("songDuration ?? (await probeMediaDurationSec(audioUrl))");
    expect(src).toContain("overrideCost: transcribeCostForDurationSec(durationSec)");
  });

  it("CaptionsSection quotes the tier on BOTH transcribe-url calls (AI Sync + Rebuild)", () => {
    const src = read("../components/editor/sections/CaptionsSection.tsx");
    const hits = src.match(/overrideCost: transcribeCostForDurationSec\(durationSec\)/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it("the World desk label helper states the schedule from the shared constants", async () => {
    const { transcribeCostLabel, transcribeCostForDuration } = await import("./world/create-desks");
    expect(transcribeCostLabel()).toBe("100 Visual Bucs for the first 5 min · +20 per extra min");
    expect(transcribeCostForDuration(11 * 60)).toBe(220);
    expect(transcribeCostForDuration(5 * 60)).toBe(100);
  });

  it("the World desks state the honest schedule on their upload labels, never a lone flat figure", () => {
    const desks = read("../components/world/native/CreateDesks.tsx");
    expect(desks).toContain("transcribeCostLabel()");
    expect(desks).not.toContain("transcribeCost().toLocaleString");
    const bench = read("../components/world/native/StoryboardBench.tsx");
    expect(bench).toContain("transcribeCostLabel()");
    expect(bench).not.toContain("transcribeCost().toLocaleString");
  });
});
