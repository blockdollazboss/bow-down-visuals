import { Play, CheckCircle2, Circle, Clapperboard, Film } from "lucide-react";
import { TRANSITIONS, defaultClipEdit, type EditorSettings } from "@/lib/editor-settings";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard } from "@/components/editor/controls";
import { FormatSection } from "@/components/editor/sections/FormatSection";

interface TimelineSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  onPreviewTransition: (sceneIndex: number) => void;
  onGoToClips: () => void;
  onGoToEffects: () => void;
  /** Simple mode hides transition type/duration tuning — the automatic AI
   *  edit already picked transitions, so this stays a read-only summary. */
  isSimple?: boolean;
}

const TRANSITION_OPTIONS = ["Cut", ...TRANSITIONS.filter(t => t !== "Cut")];

export function TimelineSection({
  scenes,
  settings,
  setSettings,
  onPreviewTransition,
  onGoToClips,
  onGoToEffects,
  isSimple = false,
}: TimelineSectionProps) {
  const approvedScenes = scenes.filter(s => s.approved && s.demoClipUrl);

  function setClipTransition(sceneId: string, transition: string) {
    const existing = settings.clips[sceneId] ?? defaultClipEdit();
    setSettings({
      ...settings,
      clips: { ...settings.clips, [sceneId]: { ...existing, transition } },
    });
  }

  function setClipTransitionDuration(sceneId: string, dur: number) {
    const existing = settings.clips[sceneId] ?? defaultClipEdit();
    setSettings({
      ...settings,
      clips: { ...settings.clips, [sceneId]: { ...existing, transitionDuration: dur } },
    });
  }

  return (
    <div className="space-y-5">

      <FormatSection settings={settings} setSettings={setSettings} />

      <EditorCard
        title="Scene Timeline"
        subtitle={`${approvedScenes.length} clip${approvedScenes.length === 1 ? "" : "s"} in sequence`}
        icon={<Clapperboard className="h-4 w-4" />}
        className="!bg-black !border-white/10"
      >
        {approvedScenes.length === 0 ? (
          <div className="py-8 text-center space-y-3">
            <div className="flex justify-center">
              <Film className="h-8 w-8 text-white/15" />
            </div>
            <p className="text-sm text-white/40">No approved clips yet.</p>
            <p className="text-[11px] text-white/25">Approve clips in the Clips tab to build your timeline.</p>
            <button
              type="button"
              onClick={onGoToClips}
              className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-black bg-primary hover:bg-primary/80 transition-colors"
            >
              <Film className="h-3.5 w-3.5" />
              Go to Clips
            </button>
          </div>
        ) : (
          <div className="space-y-0">
            {approvedScenes.map((scene, i) => {
              const clipEdit = settings.clips[scene.id] ?? defaultClipEdit();
              const transition = clipEdit.transition ?? "Cut";
              const transitionDuration = clipEdit.transitionDuration ?? 1.0;
              const originalIndex = scenes.findIndex(s => s.id === scene.id);
              const isLast = i === approvedScenes.length - 1;

              return (
                <div key={scene.id}>
                  {/* Scene row */}
                  <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl border border-white/[0.06] bg-white/[0.025]">
                    <span className="text-[10px] font-black font-mono text-primary/60 w-5 shrink-0 text-center">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-white/80 truncate">
                        {scene.section || `Scene ${scene.sceneNumber}`}
                      </p>
                      {scene.lyricLine && (
                        <p className="text-[10px] text-white/30 truncate mt-0.5">
                          {scene.lyricLine}
                        </p>
                      )}
                    </div>
                    <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                  </div>

                  {/* Transition connector between clips */}
                  {!isLast && (
                    <div className="flex items-center gap-2 py-2 pl-8 pr-3">
                      <div className="h-px flex-1 bg-white/[0.06]" />

                      {isSimple ? (
                        /* Simple mode: read-only summary — AI already picked
                         * the transition, no tuning controls exposed. */
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-white/40 font-mono px-1.5 py-1">
                            {transition}
                            {transition !== "Cut" ? ` · ${transitionDuration}s` : ""}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <select
                            value={transition}
                            onChange={e => setClipTransition(scene.id, e.target.value)}
                            className="text-[10px] text-white/60 bg-black/50 border border-white/[0.10] rounded-md px-1.5 py-1 focus:outline-none focus:border-primary/40"
                          >
                            {TRANSITION_OPTIONS.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>

                          {transition !== "Cut" && (
                            <select
                              value={String(transitionDuration)}
                              onChange={e => setClipTransitionDuration(scene.id, Number(e.target.value))}
                              className="text-[10px] text-white/40 bg-black/50 border border-white/[0.08] rounded-md px-1.5 py-1 focus:outline-none focus:border-primary/40"
                            >
                              {["0.5", "1.0", "1.5", "2.0", "2.5", "3.0"].map(v => (
                                <option key={v} value={v}>{v}s</option>
                              ))}
                            </select>
                          )}

                          {transition !== "Cut" && originalIndex >= 0 && (
                            <button
                              type="button"
                              onClick={() => onPreviewTransition(originalIndex)}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-primary/60 hover:text-primary px-2 py-1 rounded-md border border-primary/20 hover:border-primary/50 bg-primary/[0.03] hover:bg-primary/[0.08] transition-all"
                            >
                              <Play className="h-2.5 w-2.5" />
                              Preview
                            </button>
                          )}
                        </div>
                      )}

                      <div className="h-px flex-1 bg-white/[0.06]" />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Summary footer */}
            <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-[10px] text-white/30 font-mono">
                {approvedScenes.length} clips · {approvedScenes.length - 1} transitions
              </span>
              <button
                type="button"
                onClick={onGoToEffects}
                className="text-[10px] text-primary/60 hover:text-primary font-bold transition-colors"
              >
                Edit all in Effects →
              </button>
            </div>
          </div>
        )}
      </EditorCard>
    </div>
  );
}
