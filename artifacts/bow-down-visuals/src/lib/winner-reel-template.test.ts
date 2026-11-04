/**
 * Winner Reel (Stack 100 item 32 [A15]) — the 9th editor template.
 *
 * The challenge loop ended at fame: winners got share cards and nothing
 * to BUILD with. winner-reel is a first-class entry in the SAME editor
 * registry the other templates live in (lib/video-templates.ts), with
 * the family's exact contract shape, executed by the same executor
 * (lib/template-execution.ts), picked up by the picker by construction,
 * and opened pre-executed from the winners' circle via the "Build
 * Winner Reel" door (?make= deep link → applyTemplate).
 *
 * Pricing truth pinned here: editor templates are FREE starting points —
 * picking/executing one never charges (applyTemplate's body carries no
 * charge path). The 250 VB /api/video-template/apply row in
 * credit-costs.ts belongs to the SEPARATE server render-recipe family
 * (src/data/video-templates.ts metas, 18 keys) — not this registry.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { defaultEditorSettings } from "./editor-settings";
import {
  VIDEO_TEMPLATES,
  getVideoTemplate,
  isVideoTemplateId,
  buildWinnerReelHref,
  getTemplateOrder,
  type VideoTemplate,
} from "./video-templates";
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

function scenes(n: number): SceneData[] {
  return Array.from({ length: n }, (_, i) => scene(`s${i + 1}`, i + 1));
}

const winner = getVideoTemplate("winner-reel");
const sibling = getVideoTemplate("music-video");
const others = VIDEO_TEMPLATES.filter((t) => t.id !== "winner-reel");

function unionOf(pick: (t: VideoTemplate) => string[]): Set<string> {
  return new Set(others.flatMap(pick));
}

describe("winner-reel — registered in the editor template registry", () => {
  it("is a real registry entry, not the fallback", () => {
    expect(winner.id).toBe("winner-reel");
    expect(winner.name).toBe("Winner Reel");
    expect(VIDEO_TEMPLATES.some((t) => t.id === "winner-reel")).toBe(true);
    expect(isVideoTemplateId("winner-reel")).toBe(true);
    expect(isVideoTemplateId("no-such-template")).toBe(false);
    expect(isVideoTemplateId(null)).toBe(false);
  });

  it("the registry now carries 9 unique templates, Blank Canvas still last", () => {
    expect(VIDEO_TEMPLATES.length).toBe(9);
    const ids = VIDEO_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[ids.length - 1]).toBe("blank-canvas");
  });

  it("unknown ids still fall back to Blank Canvas BY ID (not by array index)", () => {
    expect(getVideoTemplate("nope").id).toBe("blank-canvas");
    expect(getVideoTemplate(null).id).toBe("blank-canvas");
    expect(getVideoTemplate(undefined).id).toBe("blank-canvas");
  });

  it("the picker order includes winner-reel by construction", () => {
    expect(getTemplateOrder()).toContain("winner-reel");
    expect(getTemplateOrder().length).toBe(9);
  });
});

describe("winner-reel — the family's exact contract shape", () => {
  it("carries exactly the same fields as a sibling template", () => {
    expect(Object.keys(winner).sort()).toEqual(Object.keys(sibling).sort());
    for (const key of Object.keys(sibling) as (keyof VideoTemplate)[]) {
      expect(typeof winner[key], key).toBe(typeof sibling[key]);
    }
  });

  it("draws every preset/effect/transition/grade from the sibling vocabulary — nothing invented", () => {
    for (const p of winner.captionPresets) {
      expect(unionOf((t) => t.captionPresets), p).toContain(p);
    }
    /* The default must be a preset the family already knows (it appears
       in sibling preset lists — gold-hiphop is music-video's, promo-ad's
       and intro-outro's). No sibling happens to DEFAULT to it; that is a
       choice, not an invented preset. */
    expect(unionOf((t) => t.captionPresets)).toContain(winner.defaultCaptionPreset);
    for (const e of winner.effects) expect(unionOf((t) => t.effects), e).toContain(e);
    for (const tr of winner.transitions) expect(unionOf((t) => t.transitions), tr).toContain(tr);
    for (const g of winner.colorGrades) expect(unionOf((t) => t.colorGrades), g).toContain(g);
    expect(unionOf((t) => [t.aiEditStyle])).toContain(winner.aiEditStyle);
    expect(unionOf((t) => [t.captionAnimation])).toContain(winner.captionAnimation);
    expect(unionOf((t) => [t.defaultFormat])).toContain(winner.defaultFormat);
  });

  it("is the celebration spec: vertical, gold captions, branding tab up front (the watermark surface)", () => {
    expect(winner.defaultFormat).toBe("9:16");
    expect(winner.defaultCaptionPreset).toBe("gold-hiphop");
    expect(winner.colorGrades[0]).toBe("Luxury Gold");
    expect(winner.priorityTabs).toContain("branding");
    expect(winner.overlaySequence.map((s) => s.role)).toEqual(["title", "hook"]);
  });

  it("the picker renders an icon for it (trophy added to the icon map)", () => {
    const picker = readFileSync(
      new URL("../components/TemplatePicker.tsx", import.meta.url),
      "utf8",
    );
    expect(winner.icon).toBe("trophy");
    expect(picker).toContain("trophy:");
    expect(picker).toContain("Trophy");
  });
});

describe("winner-reel — execution builds the same job shape as a sibling apply", () => {
  const opts = { title: "Neon Skyline (Winning Entry)", hookText: "🏆 Thy Cheat Code took 1st place" };

  it("report shape is field-for-field the sibling's report shape", () => {
    const w = executeVideoTemplate(defaultEditorSettings(), winner, scenes(4), opts);
    const m = executeVideoTemplate(defaultEditorSettings(), sibling, scenes(4), opts);
    expect(Object.keys(w.report).sort()).toEqual(Object.keys(m.report).sort());
    expect(Object.keys(w.settings).sort()).toEqual(Object.keys(m.settings).sort());
  });

  it("applies its own spec: 9:16, gold-hiphop + pop captions, its effects, AI style", () => {
    const { settings, report } = executeVideoTemplate(defaultEditorSettings(), winner, scenes(4), opts);
    expect(settings.export.format).toBe("9:16");
    expect(settings.captions.stylePreset).toBe("gold-hiphop");
    expect(settings.captions.animation).toBe("pop");
    expect(settings.captions.enabled).toBe(true);
    expect(settings.effects).toEqual(winner.effects);
    expect(settings.aiEdit.style).toBe("gold-luxury-brand");
    expect(report.formatApplied).toBe("9:16");
    expect(report.effectsApplied).toBe(winner.effects.length);
  });

  it("sequences clips with its own transitions at its own duration", () => {
    const { settings, report } = executeVideoTemplate(defaultEditorSettings(), winner, scenes(4), opts);
    expect(settings.clips["s1"]!.transition).toBe("Cut");
    expect(settings.clips["s2"]!.transition).toBe("Flash");
    expect(settings.clips["s3"]!.transition).toBe("Zoom");
    expect(settings.clips["s4"]!.transition).toBe("Light Leak");
    for (const id of ["s2", "s3", "s4"]) {
      expect(settings.clips[id]!.transitionDuration).toBe(0.4);
    }
    expect(report.clipsSequenced).toBe(4);
    expect(report.transitionsApplied).toBe(3);
  });

  it("places the title overlay + hook from the door's real content, shaped like a sibling's", () => {
    const w = executeVideoTemplate(defaultEditorSettings(), winner, scenes(2), opts);
    const m = executeVideoTemplate(defaultEditorSettings(), sibling, scenes(2), opts);
    const wItem = w.settings.overlayItems.find((o) => o.id === "template-title-winner-reel");
    const mItem = m.settings.overlayItems.find((o) => o.id === "template-title-music-video");
    expect(wItem).toBeDefined();
    expect(Object.keys(wItem!).sort()).toEqual(Object.keys(mItem!).sort());
    expect(wItem).toMatchObject({
      type: "text",
      content: "Neon Skyline (Winning Entry)",
      position: "center",
      startTime: 0,
      endTime: 3,
      animation: "fade-in-out",
    });
    expect(w.report.overlaysPlaced).toBe(1);
    expect(w.report.hookApplied).toBe(true);
    expect(w.settings.captions.hookText).toBe("🏆 Thy Cheat Code took 1st place");
  });

  it("with no content anywhere, its steps skip honestly — never invented", () => {
    const { report } = executeVideoTemplate(defaultEditorSettings(), winner, scenes(2));
    expect(report.overlaysPlaced).toBe(0);
    expect(report.overlaysSkipped).toBe(2);
    expect(report.hookApplied).toBe(false);
  });
});

describe("winner-reel — pricing treatment matches the editor family: free", () => {
  it("no credit-cost row exists for editor templates or winner-reel", () => {
    const costs = readFileSync(new URL("./credit-costs.ts", import.meta.url), "utf8");
    expect(costs).not.toContain("winner-reel");
    expect(costs).not.toContain("music-video");
    // The 250 VB row that DOES exist is the server render-recipe rail —
    // a different family (src/data/video-templates.ts), pinned here so
    // nobody "fixes" the editor family onto it by mistake.
    expect(costs).toContain('"/api/video-template/apply": { cost: 250');
  });

  it("the editor's apply path carries no charge call", () => {
    const page = readFileSync(new URL("../pages/video-editor.tsx", import.meta.url), "utf8");
    const start = page.indexOf("function applyTemplate(");
    const body = page.slice(start, page.indexOf("\n  }", start));
    expect(body).toContain("executeVideoTemplate(");
    expect(body).not.toContain("chargeCredits");
    expect(body).not.toContain("confirmedFetch");
    expect(body).not.toContain("fetch(");
  });
});

describe("winner-reel — the Build Winner Reel door", () => {
  it("builds the editor deep link with the template executed on arrival", () => {
    const href = buildWinnerReelHref({ title: "Neon Skyline", hook: "🏆 Thy Cheat Code took 1st place" });
    const url = new URL(href, "https://bowdownvisuals.com");
    expect(url.pathname).toBe("/video-editor");
    expect(url.searchParams.get("make")).toBe("winner-reel");
    expect(url.searchParams.get("title")).toBe("Neon Skyline");
    expect(url.searchParams.get("hook")).toBe("🏆 Thy Cheat Code took 1st place");
  });

  it("omits empty content fields instead of sending blanks", () => {
    const url = new URL(buildWinnerReelHref({ title: "  ", hook: "" }), "https://bowdownvisuals.com");
    expect(url.searchParams.get("make")).toBe("winner-reel");
    expect(url.searchParams.has("title")).toBe(false);
    expect(url.searchParams.has("hook")).toBe(false);
  });

  it("the winners' circle card carries the door, fed by the winner's own record", () => {
    const page = readFileSync(new URL("../pages/winners.tsx", import.meta.url), "utf8");
    expect(page).toContain("Build Winner Reel");
    expect(page).toContain("buildWinnerReelHref({ title: w.video.title, hook: shareText })");
  });

  it("the editor consumes ?make= through applyTemplate, guarded by the id check", () => {
    const page = readFileSync(new URL("../pages/video-editor.tsx", import.meta.url), "utf8");
    expect(page).toContain('params.get("make")');
    expect(page).toContain("isVideoTemplateId(make)");
    expect(page).toContain("applyTemplate(make, {");
  });
});
