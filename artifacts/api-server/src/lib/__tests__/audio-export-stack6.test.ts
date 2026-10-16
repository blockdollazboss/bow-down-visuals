/* Stack 6 — arrangement render graph tests.
 * Pure builders (automation expressions, parametric FX graph, pan graph,
 * ducking mapping) plus one REAL ffmpeg render through runMixExport with
 * the network stubbed, proving the assembled graph actually renders. */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  buildAutomationExpression,
  buildVolumeAutomationFilter,
  buildParametricFxGraph,
  buildPanAutomationGraph,
  arrangementDuckingParams,
  runMixExport,
  isFfmpegAvailable,
  isAllowedStemUrl,
  type ExportStemInput,
} from "../audioExport";
import { duckingParamsFromSimple } from "../../routes/generate/ducking-filter";

describe("buildAutomationExpression", () => {
  it("empty lane is unity", () => {
    expect(buildAutomationExpression([])).toBe("1");
  });
  it("single point is a constant", () => {
    expect(buildAutomationExpression([{ time: 2, value: 0.5 }])).toBe("0.5");
  });
  it("two points hold, lerp, hold", () => {
    const expr = buildAutomationExpression([
      { time: 1, value: 0 },
      { time: 3, value: 1 },
    ]);
    expect(expr).toContain("if(lt(t,1),0,");
    expect(expr).toContain("(t-1)/2");
    expect(expr.endsWith(",1))")).toBe(true);
  });
  it("sorts and de-duplicates times", () => {
    const expr = buildAutomationExpression([
      { time: 3, value: 1 },
      { time: 1, value: 0 },
      { time: 1, value: 0.25 },
    ]);
    /* duplicate time: the later-in-input point wins by sort stability —
       either way exactly one t=1 segment start exists */
    expect(expr.match(/lt\(t,1\)/g)).toHaveLength(1);
    expect(expr).toContain("if(lt(t,3),");
  });
});

describe("buildVolumeAutomationFilter", () => {
  it("maps % to gain and shifts to clip-local time", () => {
    const f = buildVolumeAutomationFilter(
      [
        { time: 5, value: 100 },
        { time: 7, value: 50 },
      ],
      5,
    );
    expect(f).toMatch(/^volume='/);
    expect(f).toContain(":eval=frame");
    /* shifted: first point at t=0 with gain 1, second at t=2 with 0.5 */
    expect(f).toContain("if(lt(t,0),1,");
    expect(f).toContain("(t-0)/2");
  });
  it("no lane → null", () => {
    expect(buildVolumeAutomationFilter(undefined, 0)).toBeNull();
    expect(buildVolumeAutomationFilter([], 0)).toBeNull();
  });
});

describe("buildParametricFxGraph", () => {
  it("EQ band renders as a q-factor equalizer; flat bands are skipped", () => {
    const g = buildParametricFxGraph({
      inputLabel: "in",
      startTime: 0,
      labelPrefix: "x",
      chain: [
        {
          type: "eq",
          enabled: true,
          bands: [
            { freq: 100, gain: 3, q: 1 },
            { freq: 1000, gain: 0, q: 1 },
            { freq: 8000, gain: -2, q: 2 },
          ],
        },
      ],
    });
    const joined = g.parts.join(";");
    expect(joined).toContain("equalizer=f=100:t=q:w=1:g=3");
    expect(joined).toContain("equalizer=f=8000:t=q:w=2:g=-2");
    expect(joined).not.toContain("f=1000");
    expect(joined.startsWith("[in]")).toBe(true);
    expect(g.outLabel).toBeTruthy();
  });

  it("compressor threshold converts dB to linear", () => {
    const g = buildParametricFxGraph({
      inputLabel: "in",
      startTime: 0,
      labelPrefix: "x",
      chain: [{ type: "compressor", enabled: true, thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 120 }],
    });
    expect(g.parts.join(";")).toContain("acompressor=threshold=0.1:ratio=4:attack=5:release=120");
  });

  it("chain order is the user's order", () => {
    const g = buildParametricFxGraph({
      inputLabel: "in",
      startTime: 0,
      labelPrefix: "x",
      chain: [
        { type: "compressor", enabled: true, thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150 },
        { type: "eq", enabled: true, bands: [{ freq: 200, gain: 2, q: 1 }] },
      ],
    });
    const joined = g.parts.join(";");
    expect(joined.indexOf("acompressor")).toBeLessThan(joined.indexOf("equalizer"));
  });

  it("disabled steps are skipped entirely", () => {
    const g = buildParametricFxGraph({
      inputLabel: "in",
      startTime: 0,
      labelPrefix: "x",
      chain: [{ type: "saturation", enabled: false, drive: 2.5 }],
    });
    expect(g.parts).toHaveLength(0);
    expect(g.outLabel).toBe("in");
  });

  it("reverb becomes a wet/dry split; automation drives the wet gain", () => {
    const g = buildParametricFxGraph({
      inputLabel: "in",
      startTime: 2,
      labelPrefix: "x",
      chain: [{ type: "reverb", enabled: true, mix: 25 }],
      automation: {
        reverbMix: [
          { time: 2, value: 10 },
          { time: 6, value: 80 },
        ],
      },
    });
    const joined = g.parts.join(";");
    expect(joined).toContain("asplit=2");
    expect(joined).toContain("aecho=0.8:0.9:60:0.4");
    expect(joined).toContain(":eval=frame");
    /* shifted clip-local: 0 → 0.1 gain, 4 → 0.8 gain */
    expect(joined).toContain("if(lt(t,0),0.1,");
    expect(joined).toContain("amix=inputs=2:duration=first:normalize=0");
  });

  it("reverb without automation uses the static mix", () => {
    const g = buildParametricFxGraph({
      inputLabel: "in",
      startTime: 0,
      labelPrefix: "x",
      chain: [{ type: "reverb", enabled: true, mix: 40 }],
    });
    expect(g.parts.join(";")).toContain("volume=0.4");
  });
});

describe("buildPanAutomationGraph", () => {
  it("hard-left point maps to L=1 R=0 at the breakpoint", () => {
    const g = buildPanAutomationGraph({
      inputLabel: "in",
      startTime: 0,
      labelPrefix: "x",
      points: [
        { time: 0, value: -100 },
        { time: 4, value: 100 },
      ],
    });
    const joined = g.parts.join(";");
    expect(joined).toContain("channelsplit=channel_layout=stereo");
    expect(joined).toContain("join=inputs=2:channel_layout=stereo");
    /* left gain expression starts at 1 (constant head), right at 0 */
    expect(joined).toContain("if(lt(t,0),1,");
    expect(joined).toContain("if(lt(t,0),0,");
  });
});

describe("isAllowedStemUrl — own storage hosts only", () => {
  const prevSupabase = process.env["SUPABASE_URL"];
  const prevR2 = process.env["R2_PUBLIC_URL"];
  beforeAll(() => {
    process.env["SUPABASE_URL"] = "https://proj.supabase.co";
    process.env["R2_PUBLIC_URL"] = "https://media.example.com";
  });
  afterAll(() => {
    if (prevSupabase === undefined) delete process.env["SUPABASE_URL"];
    else process.env["SUPABASE_URL"] = prevSupabase;
    if (prevR2 === undefined) delete process.env["R2_PUBLIC_URL"];
    else process.env["R2_PUBLIC_URL"] = prevR2;
  });
  it("allows Supabase and R2 public hosts over https", () => {
    expect(isAllowedStemUrl("https://proj.supabase.co/storage/v1/object/public/x.wav")).toBe(true);
    expect(isAllowedStemUrl("https://media.example.com/audio-stems/u/x.wav")).toBe(true);
  });
  it("rejects arbitrary hosts, http, and lookalike subdomains", () => {
    expect(isAllowedStemUrl("https://evil.example.com/x.wav")).toBe(false);
    expect(isAllowedStemUrl("http://media.example.com/x.wav")).toBe(false);
    expect(isAllowedStemUrl("https://media.example.com.evil.com/x.wav")).toBe(false);
    expect(isAllowedStemUrl("not a url")).toBe(false);
  });
});

describe("arrangementDuckingParams", () => {
  it("matches the shared ducking-filter mapping exactly", () => {
    for (const [amount, sensitivity] of [
      [0, 0],
      [60, 50],
      [100, 100],
      [35, 80],
    ] as const) {
      expect(arrangementDuckingParams(amount, sensitivity)).toEqual(
        duckingParamsFromSimple(amount, sensitivity),
      );
    }
  });
});

/* ── Real render: stub the network, keep ffmpeg real ─────────────────── */

function sineWav(seconds: number, freq: number, sampleRate = 8000): Buffer {
  const n = Math.floor(seconds * sampleRate);
  const data = Buffer.alloc(44 + n * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono (aformat upmixes)
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000);
    data.writeInt16LE(v, 44 + i * 2);
  }
  return data;
}

describe("runMixExport — arrangement graph (real ffmpeg)", () => {
  let ffmpegOk = false;
  const prevEnv = process.env["SUPABASE_URL"];

  beforeAll(async () => {
    ffmpegOk = await isFfmpegAvailable();
    process.env["SUPABASE_URL"] = "https://stems.example.test";
    const vocal = sineWav(1.5, 220);
    const music = sineWav(1.5, 440);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = String(url).includes("vocal") ? vocal : music;
        return new Response(body, {
          status: 200,
          headers: { "content-length": String(body.length) },
        });
      }),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    if (prevEnv === undefined) delete process.env["SUPABASE_URL"];
    else process.env["SUPABASE_URL"] = prevEnv;
  });

  it("renders placement + parametric FX + automation + ducking together", async () => {
    if (!ffmpegOk) return; // environment without ffmpeg: builders above still cover the graph strings
    const stems: ExportStemInput[] = [
      {
        id: "vocal-1",
        name: "Vocal",
        type: "Lead Vocal",
        url: "https://stems.example.test/vocal.wav",
        volume: 100,
        muted: false,
        trimStart: 0,
        trimEnd: 0,
        durationSec: 1.5,
      },
      {
        id: "music-1",
        name: "Music",
        type: "Beat",
        url: "https://stems.example.test/music.wav",
        volume: 90,
        muted: false,
        trimStart: 0,
        trimEnd: 0,
        durationSec: 1.5,
        startTime: 0.25,
        fxChain: [
          { type: "eq", enabled: true, bands: [{ freq: 200, gain: 3, q: 1 }] },
          { type: "compressor", enabled: true, thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150 },
          { type: "reverb", enabled: true, mix: 20 },
        ],
        automation: {
          volume: [
            { time: 0.25, value: 100 },
            { time: 1.5, value: 40 },
          ],
          pan: [
            { time: 0.25, value: -60 },
            { time: 1.5, value: 60 },
          ],
          reverbMix: [
            { time: 0.25, value: 10 },
            { time: 1.5, value: 60 },
          ],
        },
        duck: { sourceStemIds: ["vocal-1"], amount: 60, sensitivity: 50 },
      },
    ];
    const result = await runMixExport({ stems, masterVolume: 100, format: "wav" });
    expect(result.buffer.length).toBeGreaterThan(10000);
    expect(result.ext).toBe("wav");
    /* duration ≈ vocal 1.5s vs music 0.25 + 1.5 = 1.75s → longest wins.
       WAV header: 48kHz stereo 16-bit = 192000 bytes/sec. */
    const audioBytes = result.buffer.length - 44;
    const seconds = audioBytes / 192000;
    expect(seconds).toBeGreaterThan(1.6);
    expect(seconds).toBeLessThan(1.9);
  }, 30000);

  it("legacy stems (no arrangement fields) still render unchanged", async () => {
    if (!ffmpegOk) return;
    const stems: ExportStemInput[] = [
      {
        id: "a",
        name: "Beat",
        type: "Beat",
        url: "https://stems.example.test/music.wav",
        volume: 100,
        muted: false,
        trimStart: 0,
        trimEnd: 0,
        effects: {
          eq: "Warm",
          autotune: "off",
          reverb: "light",
          delay: "none",
          compression: "medium",
          saturation: "off",
          deEsser: false,
          noiseReduction: false,
        },
      },
    ];
    const result = await runMixExport({ stems, masterVolume: 100, format: "mp3" });
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.ext).toBe("mp3");
  }, 30000);
});
