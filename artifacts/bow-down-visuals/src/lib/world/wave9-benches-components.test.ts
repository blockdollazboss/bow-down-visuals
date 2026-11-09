/**
 * wave9-benches-components — Stack 400 world parity (census
 * B-18) source-contract pins. The eight Wave9 benches must
 * stack at the Song Desk (structure, lyrics) and the Video
 * Desk (beats, recipes, background charge, direct, camera,
 * director) in StationPanel as ({ isLight }) benches, run
 * every charged rail through the confirmed-spend seam at
 * the registry price, and wire the NativeStates trio —
 * with light/dark parity via their isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const songBenches = read("../../components/world/native/Wave9SongBenches.tsx");
const videoBenches = read("../../components/world/native/Wave9VideoBenches.tsx");
const panel = read("../../components/world/StationPanel.tsx");

const BENCHES: Array<{
  name: string;
  source: string;
  testId: string;
  path: string;
  costFn: string;
  /** The twin's overrideFeature, where the twin passes one. */
  feature?: string;
  /** The feature named in the out-of-Bucs line (defaults to feature). */
  noticesFeature?: string;
  /** The run control's testid when it isn't the shared run button
   *  (the recipes bench runs from its recipe chips). */
  runTestId?: string;
}> = [
  { name: "Wave9StructureBench", source: songBenches, testId: "world-wave9-structure-bench", path: "/api/wave9a/structure/generate", costFn: "wave9StructureCost()", feature: "Song Structure Builder" },
  { name: "Wave9LyricsBench", source: songBenches, testId: "world-wave9-lyrics-bench", path: "/api/wave9a/lyrics/timing", costFn: "wave9LyricsCost()", feature: "Lyrics-to-Timeline" },
  { name: "Wave9BeatsBench", source: videoBenches, testId: "world-wave9-beats-bench", path: "/api/wave9b/beats/detect", costFn: "wave9BeatsCost()" },
  { name: "Wave9TemplatesBench", source: videoBenches, testId: "world-wave9-templates-bench", path: "/api/wave9b/templates/apply", costFn: "wave9TemplatesCost()", runTestId: "world-wave9-templates-run-jumpcut-vlog" },
  { name: "Wave9BgChargeBench", source: videoBenches, testId: "world-wave9-bg-bench", path: "/api/wave9b/bg/charge", costFn: "wave9BgChargeCost()" },
  { name: "Wave9DirectBench", source: videoBenches, testId: "world-wave9-direct-bench", path: "/api/wave9c/direct/edit", costFn: "wave9DirectCost()", feature: "Voice-Directed Edits" },
  { name: "Wave9CameraBench", source: videoBenches, testId: "world-wave9-camera-bench", path: "/api/wave9d/camera/prompt", costFn: "wave9CameraCost()", feature: "Camera Move Planner" },
  { name: "Wave9DirectorBench", source: videoBenches, testId: "world-wave9-director-bench", path: "/api/wave9d/director/plan", costFn: "wave9DirectorCost()", feature: "Character Director — Shot Plan", noticesFeature: "Character Director" },
];

describe("the bench shapes", () => {
  it("every bench is a named ({ isLight }) export rooted at its testid", () => {
    // The shared shell renders the root data-testid from its testId prop.
    expect(songBenches).toContain("data-testid={testId}");
    for (const b of BENCHES) {
      expect(b.source, b.name).toContain(`export function ${b.name}({ isLight }: { isLight: boolean })`);
      expect(b.source, b.name).toContain(`testId="${b.testId}"`);
      // The run control's testid: the shared chrome's prop, or the
      // bench's own run control where it has one.
      expect(b.source, b.name).toContain(
        b.runTestId ? `data-testid={\`world-wave9-templates-run-\${id}\`}` : `testId="${b.testId.replace("-bench", "-run")}"`,
      );
      if (b.runTestId) expect(b.source, b.name).toContain("world-wave9-templates-run-");
    }
  });

  it("the shared chrome lives in the Song benches file and both files use it", () => {
    expect(songBenches).toContain("export function BenchShell(");
    expect(songBenches).toContain("export function BenchRunButton(");
    expect(songBenches).toContain("export function BenchNotices(");
    expect(videoBenches).toContain('from "./Wave9SongBenches"');
  });
});

describe("every run rides the confirmed-spend seam at the registry price", () => {
  it("each bench confirmedFetches its own rail with its registry cost", () => {
    for (const b of BENCHES) {
      expect(b.source, b.name).toContain(`confirmedFetch("${b.path}", {`);
      expect(b.source, b.name).toContain(b.costFn);
      expect(b.source, b.name).toContain("overrideCost: cost");
      expect(b.source, b.name).toContain("res.status === 402");
      if (b.feature) {
        expect(b.source, b.name).toContain(`overrideFeature: "${b.feature}"`);
        expect(b.source, b.name).toContain(`feature="${b.noticesFeature ?? b.feature}"`);
      }
    }
  });

  it("payloads are shaped by the seam builders, never hand-rolled in the components", () => {
    expect(songBenches).toContain("buildWave9StructurePayload({ sections, lyrics, vibe, title })");
    expect(songBenches).toContain("buildWave9LyricsPayload({ lyrics, durationSec, title })");
    expect(videoBenches).toContain("buildWave9BeatsPayload(audioUrl.trim())");
    expect(videoBenches).toContain("buildWave9TemplatesPayload({");
    expect(videoBenches).toContain("buildWave9BgChargePayload(sceneId.trim())");
    expect(videoBenches).toContain("buildWave9DirectPayload({");
    expect(videoBenches).toContain("buildWave9CameraPayload({ stack, intensity, basePrompt, sceneContext })");
    expect(videoBenches).toContain("buildWave9DirectorPayload({");
  });

  it("results flow into the hub project as script assets", () => {
    for (const src of [songBenches, videoBenches]) {
      expect(src).toContain('kind: "script"');
      expect(src).toContain("addAsset({");
    }
    expect(songBenches).toContain('data-testid="world-wave9-structure-result"');
    expect(songBenches).toContain('data-testid="world-wave9-lyrics-result"');
    expect(videoBenches).toContain('data-testid="world-wave9-beats-result"');
    expect(videoBenches).toContain('data-testid="world-wave9-templates-result"');
    expect(videoBenches).toContain('data-testid="world-wave9-bg-result"');
    expect(videoBenches).toContain('data-testid="world-wave9-direct-result"');
    expect(videoBenches).toContain('data-testid="world-wave9-camera-result"');
    expect(videoBenches).toContain('data-testid="world-wave9-director-result"');
  });
});

describe("the NativeStates trio is wired", () => {
  it("loading, empty and error states render through NativeStates", () => {
    expect(songBenches).toContain("NativeLoadingState");
    expect(songBenches).toContain("NativeEmptyState");
    expect(songBenches).toContain("NativeErrorState");
    expect(videoBenches).toContain("NativeLoadingState");
    expect(videoBenches).toContain("NativeEmptyState");
  });

  it("the camera deck read is a plain free fetch — never the confirm rail", () => {
    expect(videoBenches).toContain('fetch("/api/wave9d/camera/presets"');
    expect(videoBenches).not.toContain('confirmedFetch("/api/wave9d/camera/presets"');
  });
});

describe("the StationPanel mounts [STATION MOUNT ○]", () => {
  it("lazy-imports all eight benches", () => {
    for (const b of BENCHES) {
      expect(panel, b.name).toContain(`const ${b.name} = lazy(() => import("@/components/world/native/`);
      expect(panel, b.name).toContain(`<${b.name} isLight={isLight} />`);
    }
  });

  it("stacks structure + lyrics at the song-desk, the other six at the video-desk", () => {
    expect(panel).toContain('station.id === "song-desk"');
    expect(panel).toContain('station.id === "video-desk"');
    expect(panel).toContain('resetKey={`${station.id}:wave9-structure`}');
    expect(panel).toContain('resetKey={`${station.id}:wave9-lyrics`}');
    for (const key of ["wave9-beats", "wave9-templates", "wave9-bg", "wave9-direct", "wave9-camera", "wave9-director"]) {
      expect(panel, key).toContain(`resetKey={\`\${station.id}:${key}\`}`);
    }
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("both bench files branch their surfaces on isLight", () => {
    for (const src of [songBenches, videoBenches]) {
      expect(src).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
      expect(src).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
    }
  });
});

describe("owned desk files stay untouched by this lane", () => {
  it("neither bench file imports or edits AudioDesk / CreateDesks", () => {
    for (const src of [songBenches, videoBenches]) {
      expect(src).not.toContain("AudioDesk");
      expect(src).not.toContain("CreateDesks");
      expect(src).not.toContain("hook-desk");
      expect(src).not.toContain("scheduler-desk");
    }
  });
});
