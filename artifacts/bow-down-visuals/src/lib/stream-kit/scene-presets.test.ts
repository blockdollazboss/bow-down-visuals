/**
 * Scene preset tests (scene-presets.ts):
 *  (a) every key a preset sets is a real SceneSource field — the union
 *      of keys createSource() produces for every source type — and
 *      every preset builds into sources the stage can draw (valid
 *      geometry, valid per-type settings);
 *  (b) applying a preset writes through the existing Stage state path
 *      (addScene / addSource / updateSource / setPreview on a real
 *      Stage), lands in Preview with Program untouched, and the scene
 *      the stage holds matches the preset exactly;
 *  (c) neighbours: the registry does not disturb the default scene,
 *      and building twice never shares ids or nested settings.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  SCENE_PRESETS,
  scenePresetById,
  scenePresetHasSourceType,
  buildSceneFromPreset,
  applyScenePreset,
  type ScenePresetStage,
} from "./scene-presets";
import { createSource, SOURCE_TYPE_LABELS, type SourceType } from "./scenes";
import { Stage } from "./stage";

class FakeCtx {
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  lineWidth = 1;
  lineJoin = "";
  save(): void {}
  restore(): void {}
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  drawImage(): void {}
  fillText(): void {}
  strokeText(): void {}
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
}

class FakeCanvas {
  width = 1280;
  height = 720;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
  captureStream(): object {
    return { fake: "stream" };
  }
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return new FakeCanvas();
      throw new Error(`unexpected element ${tag}`);
    },
  };
});

/** Every field name that exists on any real SceneSource. */
function realSourceKeys(): Set<string> {
  const keys = new Set<string>();
  (Object.keys(SOURCE_TYPE_LABELS) as SourceType[]).forEach((t) => {
    Object.keys(createSource(t)).forEach((k) => keys.add(k));
  });
  return keys;
}

describe("registry shape", () => {
  it("has unique ids and names, a blurb, and at least one source per preset", () => {
    expect(SCENE_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(new Set(SCENE_PRESETS.map((p) => p.id)).size).toBe(SCENE_PRESETS.length);
    expect(new Set(SCENE_PRESETS.map((p) => p.name)).size).toBe(SCENE_PRESETS.length);
    for (const preset of SCENE_PRESETS) {
      expect(preset.blurb.trim().length).toBeGreaterThan(10);
      expect(preset.sources.length).toBeGreaterThanOrEqual(1);
      expect(scenePresetById(preset.id)).toBe(preset);
    }
    expect(scenePresetById("no-such-preset")).toBeNull();
  });

  it("(a) every preset key maps to a real SceneSource field consumed by the surface", () => {
    const real = realSourceKeys();
    // The id a build generates is the only key a spec may not set.
    for (const preset of SCENE_PRESETS) {
      for (const spec of preset.sources) {
        for (const key of Object.keys(spec)) {
          expect(real.has(key), `${preset.id}: unknown source field "${key}"`).toBe(true);
          expect(key).not.toBe("id");
        }
        // Per-type settings only ride on the type that consumes them:
        // stage.ts drawSource reads text only for text sources, fill
        // only for color, widget only for widget, avatar only for
        // avatar, cameraMode/chroma only for camera.
        if (spec.text) expect(spec.type).toBe("text");
        if (spec.fill) expect(spec.type).toBe("color");
        if (spec.widget) expect(spec.type).toBe("widget");
        if (spec.avatar) expect(spec.type).toBe("avatar");
        if (spec.guest) expect(spec.type).toBe("guest");
        if (spec.cameraMode || spec.chroma) expect(spec.type).toBe("camera");
        if (spec.imageUrl) expect(spec.type).toBe("image");
        if (spec.mediaUrl) expect(spec.type).toBe("media");
      }
    }
  });

  it("(a) built scenes carry only real fields, in-bounds geometry, and drawable defaults", () => {
    const real = realSourceKeys();
    for (const preset of SCENE_PRESETS) {
      const scene = buildSceneFromPreset(preset);
      expect(scene.name).toBe(preset.name);
      expect(scene.sources.map((s) => s.type)).toEqual(preset.sources.map((s) => s.type));
      for (const source of scene.sources) {
        for (const key of Object.keys(source)) {
          expect(real.has(key), `${preset.id}: built source has unknown field "${key}"`).toBe(true);
        }
        expect(source.visible).toBe(true);
        expect(source.opacity).toBeGreaterThan(0);
        expect(source.opacity).toBeLessThanOrEqual(1);
        expect(source.x).toBeGreaterThanOrEqual(0);
        expect(source.y).toBeGreaterThanOrEqual(0);
        expect(source.w).toBeGreaterThan(0);
        expect(source.h).toBeGreaterThan(0);
        expect(source.x + source.w).toBeLessThanOrEqual(1.001);
        expect(source.y + source.h).toBeLessThanOrEqual(1.001);
        // A built source equals createSource's defaults merged with
        // the spec — i.e. every unset field is a working default.
        const spec = preset.sources[scene.sources.indexOf(source)]!;
        const defaults = createSource(spec.type, spec.name);
        for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
          if (key === "id") continue;
          if (!(key in spec)) expect(source[key]).toEqual(defaults[key]);
        }
      }
    }
  });

  it("presets name their sources honestly (screen presets really hold a screen source)", () => {
    expect(scenePresetHasSourceType(scenePresetById("screen-and-you")!, "screen")).toBe(true);
    expect(scenePresetHasSourceType(scenePresetById("screen-and-you")!, "camera")).toBe(true);
    expect(scenePresetHasSourceType(scenePresetById("screen-only")!, "camera")).toBe(false);
    expect(scenePresetHasSourceType(scenePresetById("just-you")!, "camera")).toBe(true);
    expect(scenePresetHasSourceType(scenePresetById("starting-soon")!, "camera")).toBe(false);
    expect(scenePresetHasSourceType(scenePresetById("avatar-stage")!, "avatar")).toBe(true);
    expect(scenePresetHasSourceType(scenePresetById("guest-interview")!, "camera")).toBe(true);
    expect(scenePresetHasSourceType(scenePresetById("guest-interview")!, "guest")).toBe(true);
    expect(scenePresetHasSourceType(scenePresetById("end-screen")!, "camera")).toBe(false);
    expect(scenePresetHasSourceType(scenePresetById("end-screen")!, "guest")).toBe(false);
  });

  it("the stack300 scenes serve the jobs they name", () => {
    // chroma-stage: the camera really is in chroma mode, over a color
    // backdrop, and its key settings are createSource's defaults.
    const chroma = scenePresetById("chroma-stage")!;
    expect(scenePresetHasSourceType(chroma, "color")).toBe(true);
    const keyed = buildSceneFromPreset(chroma).sources.find((s) => s.type === "camera")!;
    expect(keyed.cameraMode).toBe("chroma");
    expect(keyed.chroma).toEqual(createSource("camera").chroma);
    // goal-push: both money-goal widget kinds ride along, and both
    // draw only from real stream data (widget sources, nothing else).
    const goal = scenePresetById("goal-push")!;
    const kinds = goal.sources.filter((s) => s.type === "widget").map((s) => s.widget?.kind);
    expect(kinds).toEqual(["goal-bar", "tip-ticker"]);
    // media-premiere: a media source carries the scene (no camera),
    // with no URL preset — the stage draws its honest placeholder.
    const premiere = scenePresetById("media-premiere")!;
    expect(scenePresetHasSourceType(premiere, "media")).toBe(true);
    expect(scenePresetHasSourceType(premiere, "camera")).toBe(false);
    expect(premiere.sources.find((s) => s.type === "media")!.mediaUrl).toBeUndefined();
    // panel-talk: exactly two guest tiles beside the host camera.
    const panel = buildSceneFromPreset(scenePresetById("panel-talk")!);
    expect(panel.sources.filter((s) => s.type === "guest")).toHaveLength(2);
    expect(panel.sources.filter((s) => s.type === "camera")).toHaveLength(1);
  });

  it("(c) building twice gives fresh ids and never shares nested settings with the registry", () => {
    const preset = scenePresetById("camera-live-overlay")!;
    const a = buildSceneFromPreset(preset);
    const b = buildSceneFromPreset(preset);
    expect(a.id).not.toBe(b.id);
    expect(a.sources.map((s) => s.id)).not.toEqual(b.sources.map((s) => s.id));
    const textA = a.sources.find((s) => s.type === "text")!;
    textA.text!.content = "EDITED";
    const textSpec = preset.sources.find((s) => s.type === "text")!;
    expect(textSpec.text?.content).not.toBe("EDITED");
    expect(buildSceneFromPreset(preset).sources.find((s) => s.type === "text")!.text?.content).not.toBe("EDITED");
  });
});

describe("applyScenePreset — through the existing Stage state path", () => {
  function newStage(): Stage {
    return new Stage(new FakeCanvas() as never);
  }

  it("(b) calls addScene/addSource/updateSource/setPreview and nothing else mutates the stage", () => {
    const stage = newStage();
    const calls: string[] = [];
    const spy: ScenePresetStage = {
      addScene: (name?: string) => {
        calls.push("addScene");
        return stage.addScene(name);
      },
      addSource: (sceneId: string, type: SourceType) => {
        calls.push(`addSource:${type}`);
        return stage.addSource(sceneId, type);
      },
      updateSource: (sceneId, sourceId, patch) => {
        calls.push("updateSource");
        stage.updateSource(sceneId, sourceId, patch);
      },
      setPreview: (id: string) => {
        calls.push("setPreview");
        stage.setPreview(id);
      },
      sceneById: (id: string) => stage.sceneById(id),
    };
    const before = stage.scenes.length;
    const applied = applyScenePreset(spy, "screen-and-you");
    expect(applied).toBeTruthy();
    expect(calls[0]).toBe("addScene");
    expect(calls.filter((c) => c.startsWith("addSource"))).toEqual(["addSource:screen", "addSource:camera"]);
    expect(calls.filter((c) => c === "updateSource")).toHaveLength(2);
    expect(calls[calls.length - 1]).toBe("setPreview");
    expect(stage.scenes).toHaveLength(before + 1);
  });

  it("(b) the applied scene matches the preset exactly, lands in Preview, Program untouched", () => {
    const stage = newStage();
    const programBefore = stage.programId;
    for (const preset of SCENE_PRESETS) {
      const applied = applyScenePreset(stage, preset.id);
      expect(applied, preset.id).toBeTruthy();
      expect(applied!.name).toBe(preset.name);
      expect(stage.previewId).toBe(applied!.id);
      expect(stage.programId).toBe(programBefore); // never straight to Program
      const expected = buildSceneFromPreset(preset);
      expect(applied!.sources).toHaveLength(expected.sources.length);
      applied!.sources.forEach((source, i) => {
        const want = expected.sources[i]!;
        const { id: _a, ...gotRest } = source;
        const { id: _b, ...wantRest } = want;
        expect(gotRest).toEqual(wantRest);
      });
    }
  });

  it("(b) applying the same preset twice stacks two independent scenes", () => {
    const stage = newStage();
    const first = applyScenePreset(stage, "starting-soon")!;
    const second = applyScenePreset(stage, "starting-soon")!;
    expect(first.id).not.toBe(second.id);
    expect(stage.scenes.filter((s) => s.name === "Starting Soon")).toHaveLength(2);
    expect(stage.previewId).toBe(second.id);
  });

  it("(b) an unknown preset changes nothing", () => {
    const stage = newStage();
    const before = stage.scenes.map((s) => s.id);
    expect(applyScenePreset(stage, "no-such-preset")).toBeNull();
    expect(stage.scenes.map((s) => s.id)).toEqual(before);
  });

  it("(c) the default scene and its neighbours survive preset applies", () => {
    const stage = newStage();
    const main = stage.scenes[0]!;
    applyScenePreset(stage, "just-you");
    applyScenePreset(stage, "be-right-back");
    expect(stage.sceneById(main.id)?.name).toBe("Main");
    expect(stage.sceneById(main.id)?.sources[0]?.type).toBe("camera");
    expect(stage.programId).toBe(main.id);
    // And a preset scene behaves like any other scene afterwards:
    // it can be taken to Program and deleted through the same path.
    const applied = stage.previewScene();
    stage.cutTo(applied.id);
    expect(stage.programId).toBe(applied.id);
    stage.deleteScene(applied.id);
    expect(stage.sceneById(applied.id)).toBeNull();
  });
});
