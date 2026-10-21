import { describe, it, expect } from "vitest";
import { duckingParamsFromSimple, buildDuckAudioPayload, buildExportDucking, defaultDuckingSettings } from "./ducking";

describe("ducking simple-terms mapping (mirrors server ducking-filter.ts)", () => {
  it("extremes match the server mapping", () => {
    expect(duckingParamsFromSimple(0, 0)).toMatchObject({ threshold: 0.08, ratio: 2, musicLevel: 1 });
    expect(duckingParamsFromSimple(100, 100)).toMatchObject({ threshold: 0.01, ratio: 20, musicLevel: 0.6 });
  });
  it("payload carries the mapped threshold/ratio to /duck-audio", () => {
    const payload = buildDuckAudioPayload({ enabled: true, amount: 50, sensitivity: 50, voiceUrl: "https://x/voice.mp3" }, "https://x/song.mp3");
    expect(payload).toMatchObject({ threshold: 0.045, ratio: 11, musicLevel: 0.8, voiceUrl: "https://x/voice.mp3", musicUrl: "https://x/song.mp3" });
  });
  it("export block is null when disabled", () => {
    expect(buildExportDucking(defaultDuckingSettings())).toBeNull();
    expect(buildExportDucking({ ...defaultDuckingSettings(), enabled: true })).toMatchObject({ enabled: true, amount: 60 });
  });
});
