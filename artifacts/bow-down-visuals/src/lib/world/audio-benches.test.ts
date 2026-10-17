/**
 * audio-benches — Ring 2 (2.6 + 2.7) pins.
 * (a) Every bench's displayed price equals its pricing source:
 *     the registry, the panels' pinned constants, the rate-my-mix
 *     server charge, or lib/voiceover's estimator.
 * (b) Form/JSON builders mirror the hub panels field for field.
 * (c) Result interpreters speak each bench's own response shape —
 *     and a done-with-no-output reads as an honest failure.
 * (d) Peaks shaping buckets samples like the A/B panels compute.
 */
import { describe, it, expect } from "vitest";
import {
  AUDIO_BENCHES,
  audioBenchOf,
  audioBenchJobIdOf,
  buildHarmonyPayload,
  buildPodcastPayload,
  buildSingingVoicePayload,
  buildVocalPolishPayload,
  buildVoiceoverPayload,
  interpretAudioBenchResponse,
  lufsNormalizeFields,
  masterFields,
  mixFields,
  peaksFromChannelData,
  quickMasterFields,
  rateMyMixFields,
  RATE_MY_MIX_COST_VB,
  stemsFields,
  vocalTuneFields,
} from "./audio-benches";
import { getCreditCost } from "../credit-costs";
import { estimateVoiceoverCost } from "../voiceover";

describe("audio bench prices — from each bench's own source (pin a)", () => {
  it("registry benches equal getCreditCost for their endpoint", () => {
    const byEndpoint: Record<string, string> = {
      master: "/api/mix-master/master",
      "quick-master": "/api/mastering",
      mix: "/api/mix-master/mix",
      stems: "/api/stems",
      "vocal-removal": "/api/vocal-removal",
      "vocal-polish": "/api/vocal-polish",
      harmony: "/api/generate-harmony",
      "singing-voice": "/api/singing-voice",
      "vocal-tune": "/api/vocal-tune",
      "lufs-normalize": "/api/lufs/normalize",
      podcast: "/api/podcast/generate",
      hum: "/api/hum-to-song",
    };
    for (const [id, endpoint] of Object.entries(byEndpoint)) {
      const def = AUDIO_BENCHES.find((b) => b.id === id)!;
      expect(def.cost(), id).toBe(getCreditCost(endpoint)!.cost);
    }
  });

  it("rate-my-mix displays the server's 100 VB charge; LUFS analyze + arrangement editing are free", () => {
    expect(audioBenchOf("rate-my-mix").cost()).toBe(RATE_MY_MIX_COST_VB);
    expect(RATE_MY_MIX_COST_VB).toBe(100);
    expect(audioBenchOf("lufs-analyze").cost()).toBe(0);
    expect(audioBenchOf("arrangement").cost()).toBe(0);
  });

  it("voiceover's price is the page estimator's (200 per billable minute)", () => {
    const script = Array.from({ length: 300 }, () => "word").join(" ");
    expect(audioBenchOf("voiceover").cost(script)).toBe(estimateVoiceoverCost(script).credits);
    expect(audioBenchOf("voiceover").cost("short")).toBe(200);
  });

  it("every hub bench from the brief is present exactly once", () => {
    expect(AUDIO_BENCHES.map((b) => b.id).sort()).toEqual([
      "arrangement", "harmony", "hum", "lufs-analyze", "lufs-normalize", "master", "mix", "podcast",
      "quick-master", "rate-my-mix", "singing-voice", "stems", "vocal-polish", "vocal-removal",
      "vocal-tune", "voiceover",
    ]);
  });
});

describe("bench payload builders mirror the hub panels (pin b)", () => {
  it("master / quick-master / mix / stems / tune / lufs / rate fields", () => {
    expect(masterFields({ genre: "trap", intensity: "balanced", loudness: "streaming", sourceSongId: "s1" })).toEqual([["genre", "trap"], ["intensity", "balanced"], ["loudness", "streaming"], ["sourceSongId", "s1"]]);
    expect(quickMasterFields({ preset: "warm" })).toEqual([["preset", "warm"]]);
    expect(mixFields({ genre: "trap", intensity: "x", loudness: "y", vocalLevelDb: -3 })).toContainEqual(["vocalLevelDb", "-3"]);
    expect(stemsFields({ pro: true })).toEqual([["stems", "pro"]]);
    expect(stemsFields({})).toEqual([]);
    expect(vocalTuneFields({ style: "smooth", keyShift: 2 })).toEqual([["style", "smooth"], ["keyShift", "2"]]);
    expect(lufsNormalizeFields({ targetLufs: -14, format: "mp3" })).toEqual([["targetLufs", "-14"], ["format", "mp3"]]);
    expect(rateMyMixFields({ genre: " trap " })).toEqual([["genre", "trap"]]);
    expect(rateMyMixFields({})).toEqual([]);
  });

  it("vocal / harmony / singing / podcast / voiceover JSON bodies", () => {
    expect(buildVocalPolishPayload({ audioUrl: "u", correctionStrength: 0.5, keyShift: 1, tempoPercent: 110 })).toEqual({ audioUrl: "u", correctionStrength: 0.5, keyShift: 1, tempoFactor: 1.1 });
    expect(buildHarmonyPayload({ audioUrl: "u", style: "classic", mixLevel: 0.4 })).toMatchObject({ mode: "classic", audioUrl: "u" });
    expect(buildSingingVoicePayload({ voiceId: "v", sourceAudioUrl: "u", strength: 0.8, keepInstrumental: true })).toEqual({ voiceId: "v", sourceAudioUrl: "u", strength: 0.8, keepInstrumental: true });
    expect(buildPodcastPayload({ mode: "script", script: " hi ", title: " T ", format: "mp3", musicBed: false })).toMatchObject({ mode: "script", script: "hi", title: "T" });
    expect(buildVoiceoverPayload({ script: " hi ", voiceId: "v", emotion: "calm", format: "mp3", speed: 1 })).toEqual({ script: "hi", voiceId: "v", emotion: "calm", format: "mp3", speed: 1 });
  });
});

describe("result interpreters speak each bench's shape (pin c)", () => {
  it("job benches: running reads as not-done; done reads its own output field", () => {
    expect(interpretAudioBenchResponse("master", { status: "processing" }).done).toBe(false);
    expect(interpretAudioBenchResponse("master", { status: "done", mp3Url: "m.mp3" }).urls).toEqual([{ label: "Your finished audio", url: "m.mp3" }]);
    expect(interpretAudioBenchResponse("vocal-polish", { status: "done", outputUrl: "p.mp3" }).urls[0]!.url).toBe("p.mp3");
    expect(interpretAudioBenchResponse("master", { status: "failed", error: "boom" })).toMatchObject({ done: true, failed: true, error: "boom" });
    /* Done with no output is an honest failure, never a blank win. */
    expect(interpretAudioBenchResponse("master", { status: "done" }).failed).toBe(true);
  });

  it("stems + vocal-removal return every stem/output", () => {
    const stems = interpretAudioBenchResponse("stems", { status: "done", stems: { vocals: "v.mp3", drums: "d.mp3", bass: null } });
    expect(stems.urls.map((u) => u.url)).toEqual(["v.mp3", "d.mp3"]);
    const vr = interpretAudioBenchResponse("vocal-removal", { status: "done", instrumentalUrl: "i.mp3", acapellaUrl: "a.mp3" });
    expect(vr.urls.map((u) => u.label)).toEqual(["Instrumental", "Vocals only"]);
  });

  it("sync benches: harmony / podcast / voiceover / lufs / rate-my-mix", () => {
    expect(interpretAudioBenchResponse("harmony", { mixedPreviewUrl: "h.mp3" }).urls[0]!.url).toBe("h.mp3");
    expect(interpretAudioBenchResponse("podcast", { audioUrl: "p.mp3", rssXml: "<rss/>" })).toMatchObject({ done: true, text: "<rss/>" });
    expect(interpretAudioBenchResponse("voiceover", { audioUrl: "v.mp3" }).done).toBe(true);
    const lufs = interpretAudioBenchResponse("lufs-analyze", { integratedLufs: -14.2, truePeakDb: -1 });
    expect(lufs.text).toContain("-14.2 LUFS");
    expect(interpretAudioBenchResponse("rate-my-mix", { notes: "Tight low end." }).text).toContain("Tight low end.");
    expect(audioBenchJobIdOf({ jobId: "j1" })).toBe("j1");
    expect(audioBenchJobIdOf({})).toBeNull();
  });
});

describe("peaks shaping (pin d)", () => {
  it("buckets samples into bars in [0,1], silence stays low, empty stays empty", () => {
    const loud = new Float32Array(1000).fill(0.5);
    const peaks = peaksFromChannelData(loud, 10);
    expect(peaks).toHaveLength(10);
    expect(peaks.every((p) => p > 0.5 && p <= 1)).toBe(true);
    expect(peaksFromChannelData(new Float32Array(0))).toEqual([]);
    expect(peaksFromChannelData(new Float32Array(100).fill(0), 5).every((p) => p === 0)).toBe(true);
  });
});
