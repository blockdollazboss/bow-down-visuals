/**
 * A-09 (Stack-100 #3) — the lip-sync Strength control reaches the
 * provider call.
 *
 * Strength (low/medium/high) maps to Sync.so's documented v2 generation
 * option `options.temperature` (expressiveness 0–1). No strength (or an
 * unknown value) sends NO options block, keeping the payload identical
 * to the pre-A-09 shape — and the historically-422ing fields
 * (synergize, pads) are never sent.
 */
import { describe, it, expect } from "vitest";

import {
  buildSyncLabsPayload,
  lipSyncTemperatureForStrength,
} from "../sync-labs";

describe("lipSyncTemperatureForStrength", () => {
  it("maps the three editor strengths onto the expressiveness range", () => {
    expect(lipSyncTemperatureForStrength("low")).toBe(0.25);
    expect(lipSyncTemperatureForStrength("medium")).toBe(0.5);
    expect(lipSyncTemperatureForStrength("high")).toBe(0.85);
  });

  it("is case/space tolerant and returns null for anything else", () => {
    expect(lipSyncTemperatureForStrength(" High ")).toBe(0.85);
    expect(lipSyncTemperatureForStrength("extreme")).toBeNull();
    expect(lipSyncTemperatureForStrength("")).toBeNull();
    expect(lipSyncTemperatureForStrength(null)).toBeNull();
    expect(lipSyncTemperatureForStrength(undefined)).toBeNull();
  });
});

describe("buildSyncLabsPayload", () => {
  it("without a strength the payload is the historical shape — no options block", () => {
    const p = buildSyncLabsPayload("https://x/clip.mp4", "https://x/audio.mp3");
    expect(p.input).toEqual([
      { type: "video", url: "https://x/clip.mp4" },
      { type: "audio", url: "https://x/audio.mp3" },
    ]);
    expect("options" in p).toBe(false);
    expect(JSON.stringify(p)).not.toMatch(/synergize|pads/);
  });

  it("with a strength the payload carries options.temperature and nothing else extra", () => {
    const p = buildSyncLabsPayload("https://x/clip.mp4", "https://x/audio.mp3", "high");
    expect(p.options).toEqual({ temperature: 0.85 });
    expect(JSON.stringify(p)).not.toMatch(/synergize|pads/);
  });
});
