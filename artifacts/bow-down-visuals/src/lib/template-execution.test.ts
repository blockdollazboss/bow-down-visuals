/**
 * Turbo executes the template — execution semantics for
 * executeVideoTemplate (lib/template-execution.ts).
 *
 * Before this lane, picking a template in the editor set only the export
 * format + caption style preset (video-editor.tsx applyTemplate); the
 * creator sequenced clips, transitions, effects, caption animation and
 * title/hook by hand. These tests pin the executed timeline: clips in
 * scene order with the template's transitions cycled in spec order,
 * effects + AI-edit style from the spec, caption style AND animation
 * applied, title/hook overlay steps placed in spec order from project
 * content (and honestly skipped — never invented — when the project
 * carries none).
 */
import { describe, it, expect } from "vitest";
import {
  CAPTION_ANIMATIONS,
  defaultClipEdit,
  defaultEditorSettings,
  type EditorSettings,
} from "./editor-settings";
import { VIDEO_TEMPLATES, getVideoTemplate } from "./video-templates";
import { executeVideoTemplate } from "./template-execution";
import type { SceneData } from "./scene-parser";

function scene(id: string, n: number, lyricLine = ""): SceneData {
  return {
    id,
    sceneNumber: n,
    timestamp: `0:${String((n - 1) * 5).padStart(2, "0")} - 0:${String(n * 5).padStart(2, "0")}`,
    section: "",
    lyricLine,
    location: "",
    action: "",
    cameraMovement: "",
    lighting: "",
    mood: "",
    aiVideoPrompt: "",
    negativePrompt: "",
    approved: true,
    demoClipUrl: `https://cdn.example/${id}.mp4`,
    thumbnailUrl: null,
    clipId: null,
    runwayJobId: null,
    provider: null,
    generationStatus: "completed",
    promptUsed: null,
    generatedAt: null,
  };
}

function scenes(n: number, lyrics: string[] = []): SceneData[] {
  return Array.from({ length: n }, (_, i) => scene(`s${i + 1}`, i + 1, lyrics[i] ?? ""));
}

describe("executeVideoTemplate — format, captions, effects, AI-edit style", () => {
  it("applies format + caption preset + caption animation + effects + aiEdit style (music-video)", () => {
    const tpl = getVideoTemplate("music-video");
    const { settings, report } = executeVideoTemplate(
      defaultEditorSettings(),
      tpl,
      scenes(3),
      { title: "Midnight Crown" },
    );
    expect(settings.export.format).toBe("16:9");
    expect(settings.captions.stylePreset).toBe("karaoke-word");
    expect(settings.captions.animation).toBe("word-pop");
    expect(settings.captions.enabled).toBe(true);
    expect(settings.effects).toEqual(tpl.effects);
    expect(settings.aiEdit.style).toBe("clean-music-video");
    expect(report.formatApplied).toBe("16:9");
    expect(report.captionAnimation).toBe("word-pop");
    expect(report.effectsApplied).toBe(tpl.effects.length);
  });

  it("applies the vertical format + pop animation for promo-ad", () => {
    const { settings } = executeVideoTemplate(
      defaultEditorSettings(),
      getVideoTemplate("promo-ad"),
      scenes(2),
    );
    expect(settings.export.format).toBe("9:16");
    expect(settings.captions.stylePreset).toBe("pill-pop");
    expect(settings.captions.animation).toBe("pop");
  });
});

describe("executeVideoTemplate — clip sequencing + transitions", () => {
  it("places clips in scene order: opening Cut, then the template's transitions in spec order", () => {
    const list = scenes(4);
    const { settings, report } = executeVideoTemplate(
      defaultEditorSettings(),
      getVideoTemplate("music-video"),
      list,
      { title: "T" },
    );
    expect(settings.clips["s1"]!.transition).toBe("Cut");
    expect(settings.clips["s1"]!.transitionDuration).toBe(0);
    expect(settings.clips["s2"]!.transition).toBe("Crossfade");
    expect(settings.clips["s3"]!.transition).toBe("Flash");
    expect(settings.clips["s4"]!.transition).toBe("Zoom");
    for (const id of ["s2", "s3", "s4"]) {
      expect(settings.clips[id]!.transitionDuration).toBe(0.5);
    }
    expect(report.clipsSequenced).toBe(4);
    expect(report.transitionsApplied).toBe(3);
  });

  it("rebuilds the structured transitions for the same pairs, timed from scene durations", () => {
    const { settings } = executeVideoTemplate(
      defaultEditorSettings(),
      getVideoTemplate("music-video"),
      scenes(4),
      { title: "T" },
    );
    expect(settings.transitions.map((tr) => [tr.fromSceneId, tr.toSceneId, tr.type, tr.timelineStart, tr.duration, tr.enabled])).toEqual([
      ["s1", "s2", "Crossfade", 5, 0.5, true],
      ["s2", "s3", "Flash", 10, 0.5, true],
      ["s3", "s4", "Zoom", 15, 0.5, true],
    ]);
  });

  it("cycles the transition list when there are more junctions than transitions", () => {
    const { settings } = executeVideoTemplate(
      defaultEditorSettings(),
      getVideoTemplate("music-video"), // 5 transitions
      scenes(7),
      { title: "T" },
    );
    expect(settings.clips["s6"]!.transition).toBe("Light Leak"); // transitions[4]
    expect(settings.clips["s7"]!.transition).toBe("Crossfade"); // wraps to transitions[0]
  });

  it("preserves each clip's other edits while writing its transition", () => {
    const base = defaultEditorSettings();
    base.clips["s2"] = { ...defaultClipEdit(), muted: true, volume: 42, effect: "Glow" };
    const { settings } = executeVideoTemplate(base, getVideoTemplate("music-video"), scenes(2), { title: "T" });
    expect(settings.clips["s2"]!.muted).toBe(true);
    expect(settings.clips["s2"]!.volume).toBe(42);
    expect(settings.clips["s2"]!.effect).toBe("Glow");
    expect(settings.clips["s2"]!.transition).toBe("Crossfade");
  });
});

describe("executeVideoTemplate — overlay sequence (title / hook)", () => {
  it("places the title as a timed text overlay from the project title, in spec position", () => {
    const { settings, report } = executeVideoTemplate(
      defaultEditorSettings(),
      getVideoTemplate("music-video"),
      scenes(2),
      { title: "Midnight Crown" },
    );
    const item = settings.overlayItems.find((o) => o.id === "template-title-music-video");
    expect(item).toMatchObject({
      type: "text",
      content: "Midnight Crown",
      startTime: 0,
      endTime: 3,
      position: "top-center",
      animation: "fade-in-out",
      sceneId: null,
    });
    expect(report.overlaysPlaced).toBe(1);
  });

  it("falls back to captions.titleText for the title when no title is passed", () => {
    const base = defaultEditorSettings();
    base.captions.titleText = "Saved Title";
    const { settings } = executeVideoTemplate(base, getVideoTemplate("vlog"), scenes(1));
    expect(settings.overlayItems.find((o) => o.id === "template-title-vlog")?.content).toBe("Saved Title");
  });

  it("applies the hook step as the editor's hook caption, seeded from the first lyric line", () => {
    const { settings, report } = executeVideoTemplate(
      defaultEditorSettings(),
      getVideoTemplate("music-video"),
      scenes(2, ["we came from nothing", "second line"]),
      { title: "T" },
    );
    expect(report.hookApplied).toBe(true);
    expect(settings.captions.mode).toBe("hook");
    expect(settings.captions.hookText).toBe("we came from nothing");
    expect(settings.captions.lines[0]).toMatchObject({ id: "opening-hook", startSec: 0, endSec: 3, text: "we came from nothing" });
  });

  it("an explicit hookText beats the lyric fallback; captions.hookText beats lyrics too", () => {
    const tpl = getVideoTemplate("social-short");
    const a = executeVideoTemplate(defaultEditorSettings(), tpl, scenes(1, ["lyric hook"]), { hookText: "explicit hook" });
    expect(a.settings.captions.hookText).toBe("explicit hook");

    const base = defaultEditorSettings();
    base.captions.hookText = "saved hook";
    const b = executeVideoTemplate(base, tpl, scenes(1, ["lyric hook"]));
    expect(b.settings.captions.hookText).toBe("saved hook");
  });

  it("skips steps the project has no content for — never invents text", () => {
    const { settings, report } = executeVideoTemplate(
      defaultEditorSettings(),
      getVideoTemplate("music-video"), // title + hook steps
      scenes(2), // no lyrics, no title anywhere
    );
    expect(report.overlaysPlaced).toBe(0);
    expect(report.overlaysSkipped).toBe(2);
    expect(report.hookApplied).toBe(false);
    expect(settings.overlayItems).toEqual([]);
    expect(settings.captions.hookText).toBe("");
  });

  it("re-running execution replaces the title overlay instead of stacking it", () => {
    const tpl = getVideoTemplate("music-video");
    const first = executeVideoTemplate(defaultEditorSettings(), tpl, scenes(1), { title: "One" });
    const second = executeVideoTemplate(first.settings, tpl, scenes(1), { title: "Two" });
    const items = second.settings.overlayItems.filter((o) => o.id === "template-title-music-video");
    expect(items.length).toBe(1);
    expect(items[0]!.content).toBe("Two");
  });
});

describe("executeVideoTemplate — Blank Canvas stays a no-op beyond today's defaults", () => {
  it("sets format + preset only: no animation, no effects, no transitions, no overlays", () => {
    const base: EditorSettings = defaultEditorSettings();
    base.effects = ["VHS"];
    base.clips["s2"] = { ...defaultClipEdit(), transition: "Spin", transitionDuration: 1.2 };
    const { settings, report } = executeVideoTemplate(base, getVideoTemplate("blank-canvas"), scenes(2));
    expect(settings.export.format).toBe("16:9");
    expect(settings.captions.stylePreset).toBe("clean-white");
    expect(settings.captions.animation).toBe("none");
    expect(settings.captions.enabled).toBe(base.captions.enabled);
    expect(settings.effects).toEqual(["VHS"]);
    expect(settings.clips["s2"]!.transition).toBe("Spin");
    expect(report.transitionsApplied).toBe(0);
    expect(report.overlaysPlaced).toBe(0);
    expect(report.overlaysSkipped).toBe(0);
  });
});

describe("executeVideoTemplate — purity + spec census", () => {
  it("does not mutate the input settings", () => {
    const base = defaultEditorSettings();
    const snapshot = JSON.stringify(base);
    executeVideoTemplate(base, getVideoTemplate("music-video"), scenes(3), { title: "T" });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("every template carries a well-formed execution spec", () => {
    const animIds = new Set(CAPTION_ANIMATIONS.map((a) => a.id));
    for (const tpl of VIDEO_TEMPLATES) {
      expect(animIds.has(tpl.captionAnimation), tpl.id).toBe(true);
      expect(tpl.transitionDurationSec, tpl.id).toBeGreaterThan(0);
      for (const step of tpl.overlaySequence) {
        expect(["title", "hook"], tpl.id).toContain(step.role);
        expect(step.durationSec, tpl.id).toBeGreaterThan(0);
        expect(step.startSec, tpl.id).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
