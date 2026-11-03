/* ── Template execution (Turbo executes the template) ──────────────────
   Picking a video template used to set exactly two defaults — the export
   format and the caption style preset (video-editor.tsx applyTemplate) —
   and stop. The creator still sequenced the clips, ordered the
   transitions, applied the effects, set the caption animation, and
   placed the title/hook by hand.

   executeVideoTemplate is the execution path: given the template's own
   spec (lib/video-templates.ts), the current EditorSettings, and the
   project's scenes in timeline order, it returns a NEW EditorSettings
   with the whole template run:

     1. Format        — export.format = template.defaultFormat.
     2. Clips         — every scene's ClipEdit is written in scene order;
                        scene 0 opens on a "Cut" (nothing transitions
                        INTO the first scene — same rule as
                        applyAiTransitionsToClips), later scenes cycle
                        the template's transitions in spec order with
                        the template's transitionDurationSec.
     3. Transitions   — the structured transitions[] list is rebuilt for
                        the same consecutive scene pairs, timelineStart
                        from cumulative scene durations.
     4. Effects       — settings.effects = the template's effect list.
     5. AI-edit style — aiEdit.style = template.aiEditStyle.
     6. Captions      — stylePreset + the template's captionAnimation
                        applied; captions enabled when the template
                        animates them (animation ≠ "none").
     7. Overlays      — the template's overlaySequence runs in order:
                        "title" steps place a timed text OverlayItem
                        (stable id per template — re-running replaces,
                        never stacks); "hook" steps apply the editor's
                        hook caption via withOpeningHook (0–3s opening
                        line). Step content comes from the project —
                        title from opts.title / captions.titleText,
                        hook from opts.hookText / captions.hookText /
                        the first scene lyric line. A step with no
                        content in the project is SKIPPED and named in
                        the report — execution never invents text.

   Everything stays editable afterwards: execution writes the same
   fields the manual (Advanced) surfaces edit. Pure function — no
   storage, no fetch — so the semantics are unit-testable.
------------------------------------------------------------------------ */

import {
  getClipEdit,
  normalizeTransitionName,
  withOpeningHook,
  type CaptionAnimation,
  type EditorSettings,
  type OverlayItem,
  type VideoFormat,
} from "./editor-settings";
import type { VideoTemplate } from "./video-templates";
import type { SceneData } from "./scene-parser";

export interface TemplateExecutionOptions {
  /** Project/video title for the template's title overlay step. */
  title?: string | null;
  /** Hook text for the template's hook step (beats the fallbacks). */
  hookText?: string | null;
}

export interface TemplateExecutionReport {
  /** Scenes whose ClipEdit was (re)written, in timeline order. */
  clipsSequenced: number;
  /** Per-clip transitions applied (excludes the opening Cut). */
  transitionsApplied: number;
  /** Effects written from the template spec. */
  effectsApplied: number;
  /** Title overlay items placed from the overlay sequence. */
  overlaysPlaced: number;
  /** Overlay steps skipped because the project carries no content for them. */
  overlaysSkipped: number;
  /** True when a hook step ran (hook caption applied). */
  hookApplied: boolean;
  /** The caption animation now on the timeline. */
  captionAnimation: CaptionAnimation;
  /** The export format now on the timeline. */
  formatApplied: VideoFormat;
}

/* Scene duration from its "0:00 - 0:05" timestamp — mirrors the private
   parseSceneDuration in editor-settings.ts (same 5s default) so the
   structured transitions land where the AI-transition path puts them. */
function sceneDurationSec(scene: SceneData): number {
  const m = (scene.timestamp ?? "").match(
    /(\d+):(\d{2}(?:\.\d+)?)\s*[-–]\s*(\d+):(\d{2}(?:\.\d+)?)/,
  );
  if (m) {
    const s = +m[1]! * 60 + +m[2]!;
    const e = +m[3]! * 60 + +m[4]!;
    if (e > s) return e - s;
  }
  return 5;
}

export function executeVideoTemplate(
  settings: EditorSettings,
  template: VideoTemplate,
  scenes: SceneData[],
  opts: TemplateExecutionOptions = {},
): { settings: EditorSettings; report: TemplateExecutionReport } {
  const report: TemplateExecutionReport = {
    clipsSequenced: 0,
    transitionsApplied: 0,
    effectsApplied: 0,
    overlaysPlaced: 0,
    overlaysSkipped: 0,
    hookApplied: false,
    captionAnimation: template.captionAnimation,
    formatApplied: template.defaultFormat,
  };

  let next: EditorSettings = {
    ...settings,
    export: { ...settings.export, format: template.defaultFormat },
    captions: {
      ...settings.captions,
      stylePreset: template.defaultCaptionPreset,
      animation: template.captionAnimation,
      enabled:
        settings.captions.enabled || template.captionAnimation !== "none",
    },
    aiEdit: { ...settings.aiEdit, style: template.aiEditStyle },
  };

  /* Effects — the template's list replaces the gallery selection (the
     manual Effects tab can still change it afterwards). Blank Canvas
     declares no effects and leaves the project's untouched. */
  if (template.effects.length > 0) {
    next = { ...next, effects: [...template.effects] };
    report.effectsApplied = template.effects.length;
  }

  /* Clips + structured transitions, in scene order. */
  if (scenes.length > 0) {
    const clips = { ...next.clips };
    const starts: number[] = [];
    let acc = 0;
    for (const scene of scenes) {
      starts.push(acc);
      acc += sceneDurationSec(scene);
    }

    const structured: EditorSettings["transitions"] = [];
    scenes.forEach((scene, i) => {
      const base = getClipEdit(next, scene.id);
      if (i === 0) {
        clips[scene.id] = { ...base, transition: "Cut", transitionDuration: 0 };
      } else if (template.transitions.length === 0) {
        /* No transition spec (Blank Canvas): the clip's existing entry —
           already carried by the clips spread — stays exactly as-is. */
      } else {
        const type = normalizeTransitionName(
          template.transitions[(i - 1) % template.transitions.length]!,
        );
        clips[scene.id] = {
          ...base,
          transition: type,
          transitionDuration:
            type === "Cut" ? 0 : template.transitionDurationSec,
        };
        report.transitionsApplied++;
        structured.push({
          fromSceneId: scenes[i - 1]!.id,
          toSceneId: scene.id,
          type,
          duration: type === "Cut" ? 0 : template.transitionDurationSec,
          timelineStart: starts[i]!,
          enabled: true,
        });
      }
      report.clipsSequenced++;
    });
    next = {
      ...next,
      clips,
      transitions:
        template.transitions.length > 0 ? structured : next.transitions,
    };
  }

  /* Overlay sequence — in spec order. */
  const titleText = (opts.title ?? "").trim() || next.captions.titleText.trim();
  const hookText =
    (opts.hookText ?? "").trim() ||
    next.captions.hookText.trim() ||
    scenes.find((s) => s.lyricLine?.trim())?.lyricLine?.trim() ||
    "";

  for (const step of template.overlaySequence) {
    if (step.role === "title") {
      if (!titleText) {
        report.overlaysSkipped++;
        continue;
      }
      const item: OverlayItem = {
        id: `template-title-${template.id}`,
        sceneId: null,
        startTime: step.startSec,
        endTime: step.startSec + step.durationSec,
        type: "text",
        content: titleText,
        source: null,
        position: step.position,
        size: 140,
        opacity: 100,
        animation: step.animation ?? "fade-in-out",
        zIndex: 50,
        color: "",
        textColor: "#FFFFFF",
      };
      next = {
        ...next,
        overlayItems: [
          ...next.overlayItems.filter((o) => o.id !== item.id),
          item,
        ],
      };
      report.overlaysPlaced++;
    } else {
      /* hook — the editor's hook caption IS the timed text track. */
      if (!hookText) {
        report.overlaysSkipped++;
        continue;
      }
      next = withOpeningHook(next, hookText);
      report.hookApplied = true;
    }
  }

  return { settings: next, report };
}
