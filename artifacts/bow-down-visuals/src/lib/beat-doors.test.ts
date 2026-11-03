/* W2-L4 — small doors: metronome scheduling math, the shared rendered-
 * beat upload, the make-song door contract, and the marketplace sell
 * prefill parse/build round-trip. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  METRONOME_STEPS_PER_BAR,
  beatsSellRoute,
  countInBeatNumber,
  initialGlobalStep,
  isCountInStep,
  makeSongRouteForBeat,
  metronomeTickForBarStep,
  parseBeatSellPrefill,
  resolveMetronomeTick,
  uploadRenderedBeat,
} from "@/lib/beat-doors";

describe("metronome ticks — pattern/song steps", () => {
  it("ticks on every beat (steps 0, 4, 8, 12) and nowhere else", () => {
    const ticked: number[] = [];
    for (let s = 0; s < METRONOME_STEPS_PER_BAR; s++) {
      if (metronomeTickForBarStep(s).tick) ticked.push(s);
    }
    expect(ticked).toEqual([0, 4, 8, 12]);
  });

  it("accents only step 0 of the bar", () => {
    for (let s = 0; s < METRONOME_STEPS_PER_BAR; s++) {
      expect(metronomeTickForBarStep(s).accent).toBe(s === 0);
    }
  });

  it("normal steps are never flagged count-in, and the accent follows the pattern position (song-mode chain crossings)", () => {
    // Global step 37 lands on pattern step 5 in pattern mode terms, but
    // the scheduler passes the RESOLVED step-in-pattern: a chain entry
    // boundary at global step 32 means global 36 is a downbeat.
    expect(resolveMetronomeTick(36, 0)).toEqual({ tick: true, accent: true, countIn: false });
    expect(resolveMetronomeTick(37, 1).tick).toBe(false);
    expect(resolveMetronomeTick(40, 4)).toEqual({ tick: true, accent: false, countIn: false });
  });

  it("wraps bar positions defensively", () => {
    expect(metronomeTickForBarStep(16)).toEqual({ tick: true, accent: true, countIn: false });
    expect(metronomeTickForBarStep(-16)).toEqual({ tick: true, accent: true, countIn: false });
  });
});

describe("metronome count-in — one bar of negative global steps", () => {
  it("starts at -16 with count-in, 0 without", () => {
    expect(initialGlobalStep(true)).toBe(-16);
    expect(initialGlobalStep(false)).toBe(0);
  });

  it("count-in steps tick on the beats, accent the first, and play nothing else (flagged countIn)", () => {
    const ticks: Array<[number, boolean]> = [];
    for (let g = -16; g < 0; g++) {
      const t = resolveMetronomeTick(g, 0);
      expect(t.countIn).toBe(true);
      if (t.tick) ticks.push([g, t.accent]);
    }
    expect(ticks).toEqual([[-16, true], [-12, false], [-8, false], [-4, false]]);
  });

  it("off-beat count-in steps do not tick", () => {
    expect(resolveMetronomeTick(-15, 0).tick).toBe(false);
    expect(resolveMetronomeTick(-1, 0).tick).toBe(false);
  });

  it("count-in beat numbers run 1..4 across the bar, 0 outside it", () => {
    expect(countInBeatNumber(-16)).toBe(1);
    expect(countInBeatNumber(-13)).toBe(1);
    expect(countInBeatNumber(-12)).toBe(2);
    expect(countInBeatNumber(-8)).toBe(3);
    expect(countInBeatNumber(-4)).toBe(4);
    expect(countInBeatNumber(-1)).toBe(4);
    expect(countInBeatNumber(0)).toBe(0);
    expect(isCountInStep(-1)).toBe(true);
    expect(isCountInStep(0)).toBe(false);
  });

  it("step 0 right after the count-in is the pattern's accented downbeat, not count-in", () => {
    expect(resolveMetronomeTick(0, 0)).toEqual({ tick: true, accent: true, countIn: false });
  });
});

describe("uploadRenderedBeat — the shared door upload", () => {
  function okFetch(url: string) {
    return vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url }) }));
  }

  it("posts the WAV as multipart field 'file' to /api/publish/upload with the bearer token", async () => {
    const fetchFn = okFetch("https://storage.example/beat.wav");
    const blob = new Blob(["riff"], { type: "audio/wav" });
    const url = await uploadRenderedBeat(blob, 142, async () => "tok-1", fetchFn as never);
    expect(url).toBe("https://storage.example/beat.wav");
    const [input, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe("/api/publish/upload");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    const body = init.body as FormData;
    const file = body.get("file") as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("beat-142bpm.wav");
    expect(file.type).toBe("audio/wav");
  });

  it("throws the server's message on failure (the door stays shut, honestly)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ error: "Sign in required" }),
    }));
    await expect(
      uploadRenderedBeat(new Blob(["x"]), 120, async () => null, fetchFn as never),
    ).rejects.toThrow("Sign in required");
  });
});

describe("make-song door contract", () => {
  it("builds /make-song?audioUrl=… with the hosted URL encoded", () => {
    const route = makeSongRouteForBeat("https://storage.example/a b.wav?x=1&y=2");
    expect(route.startsWith("/make-song?audioUrl=")).toBe(true);
    const parsed = new URLSearchParams(route.slice(route.indexOf("?")));
    expect(parsed.get("audioUrl")).toBe("https://storage.example/a b.wav?x=1&y=2");
  });

  it("matches what make-song.tsx actually accepts (audioUrl → uploaded song slot)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../pages/make-song.tsx"), "utf8");
    expect(src).toContain('params.get("audioUrl")');
    expect(src).toContain("setUploadedSongUrl(audioUrl)");
  });
});

describe("marketplace sell prefill", () => {
  it("round-trips: route → parse returns the same fields", () => {
    const route = beatsSellRoute({
      wantsSell: true,
      audioUrl: "https://storage.example/beat.wav",
      title: "Midnight Trap",
      bpm: 140,
      genre: "trap",
      musicalKey: "F#",
    });
    const prefill = parseBeatSellPrefill(route.slice(route.indexOf("?")));
    expect(prefill).toEqual({
      wantsSell: true,
      audioUrl: "https://storage.example/beat.wav",
      title: "Midnight Trap",
      bpm: 140,
      genre: "trap",
      musicalKey: "F#",
    });
  });

  it("returns null when no prefill params are present (the bare /beats door is unchanged)", () => {
    expect(parseBeatSellPrefill("")).toBeNull();
    expect(parseBeatSellPrefill("?session_id=abc")).toBeNull();
  });

  it("refuses a blob: audioUrl — it can never play or sell from another session", () => {
    const p = parseBeatSellPrefill("?sell=1&audioUrl=blob:https://site/1234&title=X");
    expect(p?.wantsSell).toBe(true);
    expect(p?.audioUrl).toBeUndefined();
    expect(p?.title).toBe("X");
  });

  it("drops an out-of-range or non-numeric bpm instead of clamping it wrong", () => {
    expect(parseBeatSellPrefill("?sell=1&bpm=999")?.bpm).toBeUndefined();
    expect(parseBeatSellPrefill("?sell=1&bpm=fast")?.bpm).toBeUndefined();
    expect(parseBeatSellPrefill("?sell=1&bpm=92")?.bpm).toBe(92);
  });

  it("caps an over-long title", () => {
    const p = parseBeatSellPrefill(`?sell=1&title=${"a".repeat(300)}`);
    expect(p?.title).toHaveLength(200);
  });

  it("beats.tsx applies the intake through this parser (source contract)", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../pages/beats.tsx"), "utf8");
    expect(src).toContain("parseBeatSellPrefill");
  });
});
