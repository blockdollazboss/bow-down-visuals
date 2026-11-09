/**
 * wave9-benches — Stack 400 world parity (census B-18) seam
 * pins. Every Wave9 bench must ride its twin's own rail at
 * the registry's price, shape the payload exactly as the
 * twin shapes it, and hold every answer to the twin's real
 * response shape — a drifted payload parses to null, never
 * to a dressed-up result.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  WAVE9_BG_PRESET_KEYS,
  WAVE9_CAMERA_FALLBACK_MOVES,
  WAVE9_RAILS,
  WAVE9_RECIPE_IDS,
  WAVE9_SECTION_DEFAULT_BARS,
  WAVE9_SECTION_TYPES,
  buildWave9BeatsPayload,
  buildWave9BgChargePayload,
  buildWave9CameraPayload,
  buildWave9DirectPayload,
  buildWave9DirectorPayload,
  buildWave9LyricsPayload,
  buildWave9StructurePayload,
  buildWave9TemplatesPayload,
  wave9ArrangementOf,
  wave9BeatsCost,
  wave9BeatsOf,
  wave9BgChargeCost,
  wave9BgChargeOf,
  wave9CameraCost,
  wave9CameraDeckOf,
  wave9CameraPromptOf,
  wave9CameraStackConflict,
  wave9DirectCost,
  wave9DirectPlanOf,
  wave9DirectorCost,
  wave9DirectorResultOf,
  wave9FormatClock,
  wave9LyricsCost,
  wave9OpsOf,
  wave9StructureCost,
  wave9TemplatesCost,
  wave9TimedLinesOf,
  type Wave9CameraPreset,
} from "./wave9-benches";
import { getCreditCost } from "../credit-costs";

describe("the eight rails + the registry prices (census B-18)", () => {
  it("pins every rail's path and registry cost", () => {
    const expected: Array<[string, number]> = [
      ["/api/wave9a/lyrics/timing", 50],
      ["/api/wave9a/structure/generate", 200],
      ["/api/wave9b/beats/detect", 150],
      ["/api/wave9b/bg/charge", 200],
      ["/api/wave9b/templates/apply", 100],
      ["/api/wave9c/direct/edit", 150],
      ["/api/wave9d/camera/prompt", 100],
      ["/api/wave9d/director/plan", 150],
    ];
    expect(WAVE9_RAILS.map((r) => [r.path, r.cost()])).toEqual(expected);
    for (const [path, cost] of expected) {
      expect(getCreditCost(path)?.cost, path).toBe(cost);
    }
    expect(wave9StructureCost()).toBe(200);
    expect(wave9LyricsCost()).toBe(50);
    expect(wave9BeatsCost()).toBe(150);
    expect(wave9TemplatesCost()).toBe(100);
    expect(wave9BgChargeCost()).toBe(200);
    expect(wave9DirectCost()).toBe(150);
    expect(wave9CameraCost()).toBe(100);
    expect(wave9DirectorCost()).toBe(150);
  });
});

describe("structure generate — the SongStructureBuilder's own shapes", () => {
  it("shapes the payload field for field (label defaults to \"\")", () => {
    expect(
      buildWave9StructurePayload({
        sections: [
          { type: "Intro", bars: 4 },
          { type: "Verse", bars: 16, label: "first" },
        ],
        lyrics: "  la la  ",
        vibe: " dark trap ",
        title: " My Song ",
      }),
    ).toEqual({
      sections: [
        { type: "Intro", bars: 4, label: "" },
        { type: "Verse", bars: 16, label: "first" },
      ],
      lyrics: "la la",
      vibe: "dark trap",
      title: "My Song",
    });
    expect(WAVE9_SECTION_TYPES).toEqual(["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro"]);
    expect(WAVE9_SECTION_DEFAULT_BARS).toEqual({ Intro: 4, Verse: 16, "Pre-Chorus": 8, Chorus: 16, Bridge: 8, Outro: 8 });
  });

  it("reads an arrangement and refuses drift", () => {
    expect(
      wave9ArrangementOf({
        arrangement: [{ type: "Verse", bars: 16, startsAtBar: 4, energy: "high", direction: "build", lyricMap: "lines 1–4" }],
        totalBars: 20,
        notes: "tight",
        creditsRemaining: 800,
      }),
    ).toEqual({
      arrangement: [{ type: "Verse", bars: 16, startsAtBar: 4, energy: "high", direction: "build", lyricMap: "lines 1–4" }],
      totalBars: 20,
      notes: "tight",
      creditsRemaining: 800,
    });
    expect(wave9ArrangementOf({ arrangement: [] })).toBeNull();
    expect(wave9ArrangementOf({ arrangement: [{ bars: 16 }] })).toBeNull();
    expect(wave9ArrangementOf(null)).toBeNull();
  });
});

describe("lyrics timing — the LyricsToTimeline shapes", () => {
  it("shapes the payload and reads timed lines", () => {
    expect(buildWave9LyricsPayload({ lyrics: " one\ntwo ", durationSec: 95, title: " T " })).toEqual({
      lyrics: "one\ntwo",
      durationSec: 95,
      title: "T",
    });
    expect(
      wave9TimedLinesOf({ lines: [{ text: "one", start: 0, end: 2.5 }] }),
    ).toEqual([{ text: "one", start: 0, end: 2.5 }]);
    expect(wave9TimedLinesOf({ lines: [] })).toBeNull();
    expect(wave9TimedLinesOf({ lines: [{ text: "one" }] })).toBeNull();
    expect(wave9TimedLinesOf("nope")).toBeNull();
  });
});

describe("beats detect — the BeatSyncSection shapes", () => {
  it("shapes the payload and filters beats exactly as the section does", () => {
    expect(buildWave9BeatsPayload("https://x/track.mp3")).toEqual({ mediaUrl: "https://x/track.mp3" });
    expect(
      wave9BeatsOf({ beats: [0, 0.501, -1, Number.NaN, 2.005, "3"], bpm: 120, method: "onset", creditsRemaining: 42 }),
    ).toEqual({ beats: [0, 0.5, 2.01], bpm: 120, method: "onset", creditsRemaining: 42 });
    expect(wave9BeatsOf({ beats: "nope" })).toBeNull();
    expect(wave9BeatsOf({})).toBeNull();
  });
});

describe("templates apply — the TimelineTemplatesSection shapes", () => {
  it("carries the beat grid only for jumpcut-vlog, capped at 600", () => {
    expect(
      buildWave9TemplatesPayload({ recipeId: "lyric-video", mediaUrl: null, durationSec: null, beatGrid: [1, 2] }),
    ).toEqual({ recipeId: "lyric-video", mediaUrl: undefined, durationSec: 0, beatGrid: [] });
    const grid = Array.from({ length: 700 }, (_, i) => i);
    const payload = buildWave9TemplatesPayload({ recipeId: "jumpcut-vlog", mediaUrl: "https://x/a.mp3", durationSec: 30, beatGrid: grid });
    expect(payload.beatGrid).toHaveLength(600);
    expect(payload.mediaUrl).toBe("https://x/a.mp3");
    expect(WAVE9_RECIPE_IDS).toEqual(["jumpcut-vlog", "lyric-video", "talking-head"]);
  });

  it("reads the compiled ops and refuses drift", () => {
    expect(
      wave9OpsOf({ ops: [{ op: "setCaptions", params: { preset: "karaoke" }, label: "Captions on", reversible: true }] }),
    ).toEqual([{ op: "setCaptions", params: { preset: "karaoke" }, label: "Captions on", reversible: true }]);
    expect(wave9OpsOf({ ops: [{ label: "no op kind" }] })).toBeNull();
    expect(wave9OpsOf({ ops: "nope" })).toBeNull();
  });
});

describe("bg charge — the BackgroundReplaceSection shapes", () => {
  it("shapes the charge body and reads the route's { ok, remaining }", () => {
    expect(buildWave9BgChargePayload("scene-9")).toEqual({ sceneId: "scene-9" });
    expect(buildWave9BgChargePayload("")).toEqual({ sceneId: "" });
    expect(wave9BgChargeOf({ ok: true, remaining: 300 })).toEqual({ ok: true, remaining: 300 });
    expect(wave9BgChargeOf({ ok: false })).toBeNull();
    expect(wave9BgChargeOf({ remaining: 300 })).toBeNull();
    expect(WAVE9_BG_PRESET_KEYS).toEqual(["presetStudio", "presetStage", "presetCityNight", "presetAbstractGold"]);
  });
});

describe("direct edit — the VoiceDirectedEditsSection shapes", () => {
  it("builds the timeline cumulatively with tenths rounding, like computeSceneTimings", () => {
    expect(
      buildWave9DirectPayload({
        command: " cut the pauses ",
        clips: [
          { id: "a", section: "Verse", durationSec: 10.04, volume: 90 },
          { id: "b", durationSec: 5 },
        ],
        projectTitle: "Demo",
      }),
    ).toEqual({
      command: "cut the pauses",
      timeline: [
        { id: "a", index: 0, section: "Verse", startSec: 0, endSec: 10, volume: 90 },
        { id: "b", index: 1, section: "", startSec: 10, endSec: 15, volume: 100 },
      ],
      totalDurationSec: 15,
      projectTitle: "Demo",
    });
  });

  it("reads a plan of the six known op kinds and refuses drift", () => {
    expect(
      wave9DirectPlanOf({
        planSummary: "Tighten it",
        ops: [
          { op: "split", sceneId: "a", atSec: 4, reason: "hook" },
          { op: "set-volume", sceneId: "b", volume: 70, reason: "" },
        ],
      }),
    ).toEqual({
      planSummary: "Tighten it",
      ops: [
        { op: "split", sceneId: "a", atSec: 4, reason: "hook" },
        { op: "set-volume", sceneId: "b", volume: 70, reason: "" },
      ],
    });
    expect(wave9DirectPlanOf({ planSummary: "x", ops: [] })).toBeNull();
    expect(wave9DirectPlanOf({ planSummary: "x", ops: [{ op: "explode", sceneId: "a" }] })).toBeNull();
    expect(wave9DirectPlanOf({ ops: [{ op: "split", sceneId: "a", atSec: 1 }] })).toBeNull();
    expect(wave9FormatClock(65.5)).toBe("1:05.5");
    expect(wave9FormatClock(0)).toBe("0:00.0");
  });
});

describe("camera prompt — the CameraMovePlanner shapes", () => {
  const deck = {
    presets: [
      { id: "static-wide", name: "Static Wide", category: "static", blurb: "", locked: true, conflictsWith: [] },
      { id: "dolly-in", name: "Dolly In", category: "dolly", blurb: "", locked: false, conflictsWith: ["zoom-out"] },
      { id: "zoom-out", name: "Zoom Out", category: "zoom", blurb: "", locked: false, conflictsWith: [] },
    ],
    maxStack: 3,
    buildCredits: 100,
  };

  it("shapes the build body (per-move intensity only when set)", () => {
    expect(
      buildWave9CameraPayload({
        stack: [{ preset: "dolly-in", intensity: "subtle" }, { preset: "orbit" }],
        intensity: "natural",
        basePrompt: "a singer on stage",
        sceneContext: "rooftop — dusk",
      }),
    ).toEqual({
      moves: [{ preset: "dolly-in", intensity: "subtle" }, { preset: "orbit" }],
      intensity: "natural",
      basePrompt: "a singer on stage",
      sceneContext: "rooftop — dusk",
    });
    expect(WAVE9_CAMERA_FALLBACK_MOVES).toEqual(["static-wide", "dolly-in", "crane-up", "orbit", "handheld"]);
  });

  it("reads the deck + the enriched prompt; refuses drift", () => {
    expect(wave9CameraDeckOf(deck)?.presets).toHaveLength(3);
    expect(wave9CameraDeckOf({ presets: [] })).toBeNull();
    expect(wave9CameraPromptOf({ enrichedPrompt: "weave…" })).toBe("weave…");
    expect(wave9CameraPromptOf({ enrichedPrompt: "" })).toBeNull();
    expect(wave9CameraPromptOf({})).toBeNull();
  });

  it("mirrors the server's stack rules: locked stands alone, conflicts refused", () => {
    const presets = wave9CameraDeckOf(deck)!.presets as Wave9CameraPreset[];
    expect(wave9CameraStackConflict([{ preset: "dolly-in" }], presets)).toBeNull();
    expect(wave9CameraStackConflict([{ preset: "static-wide" }, { preset: "dolly-in" }], presets)?.locked).toBe(true);
    expect(wave9CameraStackConflict([{ preset: "dolly-in" }, { preset: "zoom-out" }], presets)).toEqual({
      a: "Dolly In",
      b: "Zoom Out",
      locked: false,
    });
  });
});

describe("director plan — the CharacterDirector shapes", () => {
  it("shapes the plan body (blank name/style omitted, shots indexed from 1)", () => {
    expect(
      buildWave9DirectorPayload({
        name: "  ",
        sceneStyle: " neon-noir ",
        cast: [
          { vaultId: "", name: "Ava", description: "lead" },
          { vaultId: "v2", name: "Bo", description: "" },
        ],
        shots: [{ characters: ["Ava"], action: " steps out ", cameraNote: " push-in " }],
      }),
    ).toEqual({
      name: undefined,
      sceneStyle: "neon-noir",
      cast: [
        { vaultId: "", name: "Ava", description: "lead" },
        { vaultId: "v2", name: "Bo", description: "" },
      ],
      shots: [{ index: 1, characters: ["Ava"], action: "steps out", cameraNote: "push-in" }],
    });
  });

  it("reads the merged shots and refuses drift", () => {
    expect(
      wave9DirectorResultOf({
        planId: "p1",
        shots: [{ index: 1, characters: ["Ava"], action: "steps out", cameraNote: "", generatedPrompt: "cinematic…" }],
        creditsRemaining: 55,
      }),
    ).toEqual({
      planId: "p1",
      shots: [{ index: 1, characters: ["Ava"], action: "steps out", cameraNote: "", generatedPrompt: "cinematic…" }],
      creditsRemaining: 55,
    });
    expect(wave9DirectorResultOf({ shots: [] })).toBeNull();
    expect(wave9DirectorResultOf(null)).toBeNull();
  });
});

describe("the copy — the twins' namespaces + the bench namespace, in every catalog", () => {
  it("the wave9.* keys the benches render resolve in en", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    expect(en.wave9.structure.title).toBe("Song Structure Builder");
    expect(en.wave9.timeline.title).toBe("Lyrics-to-Timeline");
    expect(en.wave9.beatSync.title).toBe("Beat-Sync Cuts");
    expect(en.wave9.templates.title).toBe("Timeline Edit Recipes");
    expect(en.wave9.bgReplace.title).toBe("Background Replace");
    expect(en.wave9.directEdit.title).toBe("Voice-Directed Edits");
    expect(en.wave9.cameraMovePlanner.title).toBe("Director's Camera Deck");
    expect(en.wave9.characterDirector.title).toBe("Character Director");
    for (const key of ["bgDeskNote", "audioUrlLabel", "timelineLabel", "castNameLabel", "shotCharactersLabel"]) {
      expect(typeof en.worldWave9Bench[key], key).toBe("string");
    }
  });

  it("the bench namespace rides all ten catalogs (English verbatim outside en — house law)", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.worldWave9Bench, loc).toEqual(en.worldWave9Bench);
      expect(cat.wave9.structure.title, loc).toBeTruthy();
    }
  });
});
