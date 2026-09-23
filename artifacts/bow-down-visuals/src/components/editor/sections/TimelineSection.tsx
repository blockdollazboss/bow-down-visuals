import { Play, Pause, CheckCircle2, Clapperboard, Film, SkipBack } from "lucide-react";
import { TRANSITIONS, defaultClipEdit, type EditorSettings } from "@/lib/editor-settings";
import type { SceneData } from "@/lib/scene-parser";
import type { SharedPreviewState } from "@/components/TimelinePreviewPlayer";
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
  /* ── Master-player connection: the same playback engine + transport that
   *  drives the master preview player, so this timeline mirrors and controls it. */
  engineState?: SharedPreviewState | null;
  /** Fallback total duration when the engine hasn't reported one yet. */
  duration?: number | null;
  onSeek?: (sec: number) => void;
  onTogglePlay?: () => void;
  onRestart?: () => void;
}

const TRANSITION_OPTIONS = ["Cut", ...TRANSITIONS.filter(t => t !== "Cut")];

function fmtSecs(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Scene start offsets — mirrors the master player's even distribution over the
 *  total duration, over the FULL scene list so indices match the engine. */
function buildSceneOffsets(count: number, totalDuration: number): number[] {
  if (count === 0 || totalDuration <= 0) return Array(count).fill(0);
  const d = totalDuration / count;
  return Array.from({ length: count }, (_, i) => i * d);
}

export function TimelineSection({
  scenes,
  settings,
  setSettings,
  onPreviewTransition,
  onGoToClips,
  onGoToEffects,
  isSimple = false,
  engineState = null,
  duration = null,
  onSeek,
  onTogglePlay,
  onRestart,
}: TimelineSectionProps) {
  const approvedScenes = scenes.filter(s => s.approved && s.demoClipUrl);

  /* ── Master-player connection state ── */
  const isPlaying = engineState?.isPlaying ?? false;
  const currentTime = engineState?.currentTime ?? 0;
  const totalDuration = engineState?.audioDuration ?? duration ?? 0;
  const activeSceneIndex = engineState?.activeSceneIndex ?? -1;
  const sceneOffsets = buildSceneOffsets(scenes.length, totalDuration);
  const progress = totalDuration > 0 ? Math.min(1, Math.max(0, currentTime / totalDuration)) : 0;

  function seekToScene(fullIndex: number) {
    if (!onSeek) return;
    onSeek(sceneOffsets[fullIndex] ?? 0);
  }

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

  const transportButton =
    "flex items-center justify-center h-7 w-7 rounded-md border border-white/[0.08] bg-white/[0.03] text-white/55 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 disabled:opacity-30";

  return (
    <div className="space-y-5">

      <FormatSection settings={settings} setSettings={setSettings} />

      <EditorCard
        title="Scene Timeline"
        subtitle={
          engineState
            ? `${approvedScenes.length} clip${approvedScenes.length === 1 ? "" : "s"} in sequence · synced to master player`
            : `${approvedScenes.length} clip${approvedScenes.length === 1 ? "" : "s"} in sequence`
        }
        icon={<Clapperboard className="h-4 w-4" />}
        className="!bg-black !border-white/10"
        right={
          onTogglePlay ? (
            <div className="flex items-center gap-1.5 shrink-0">
              {onRestart && (
                <button
                  type="button"
                  onClick={onRestart}
                  disabled={approvedScenes.length === 0}
                  className={transportButton}
                  title="Restart (Home)"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={onTogglePlay}
                disabled={approvedScenes.length === 0}
                className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 transition-colors text-primary disabled:opacity-30 shrink-0"
                title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : undefined
        }
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
            {/* ── Master-player transport strip: playhead mirror ── */}
            {engineState && (
              <div className="px-1 pt-1 pb-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono text-white/40 tabular-nums">
                    {fmtSecs(currentTime)} / {fmtSecs(totalDuration)}
                  </span>
                  <span className={`text-[10px] font-bold ${isPlaying ? "text-primary" : "text-white/30"}`}>
                    {isPlaying ? "● Playing" : "Paused"}
                  </span>
                </div>
                <div
                  className="relative h-2 rounded-full bg-white/[0.08] cursor-pointer group"
                  onClick={(e) => {
                    if (!onSeek || totalDuration <= 0) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    onSeek(frac * totalDuration);
                  }}
                  title="Click to seek the master player"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-primary/70 rounded-full pointer-events-none"
                    style={{ width: `${progress * 100}%` }}
                  />
                  {/* Scene boundary ticks */}
                  {sceneOffsets.slice(1).map((off, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 w-px bg-black/60 pointer-events-none"
                      style={{ left: `${totalDuration > 0 ? (off / totalDuration) * 100 : 0}%` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {approvedScenes.map((scene, i) => {
              const clipEdit = settings.clips[scene.id] ?? defaultClipEdit();
              const transition = clipEdit.transition ?? "Cut";
              const transitionDuration = clipEdit.transitionDuration ?? 1.0;
              const originalIndex = scenes.findIndex(s => s.id === scene.id);
              const isLast = i === approvedScenes.length - 1;
              const isActive = originalIndex >= 0 && originalIndex === activeSceneIndex;

              return (
                <div key={scene.id}>
                  {/* Scene row — click seeks the master player to this scene */}
                  <button
                    type="button"
                    onClick={() => originalIndex >= 0 && seekToScene(originalIndex)}
                    disabled={!onSeek}
                    title={onSeek ? "Seek master player to this scene" : undefined}
                    className={`w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border transition-colors text-left ${
                      isActive
                        ? "border-primary/40 bg-primary/[0.08]"
                        : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.14] hover:bg-white/[0.05]"
                    } ${onSeek ? "cursor-pointer" : "cursor-default"}`}
                  >
                    <span className={`text-[10px] font-black font-mono w-5 shrink-0 text-center ${isActive ? "text-primary" : "text-primary/60"}`}>
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
                    {isActive && isPlaying ? (
                      <span className="flex items-center gap-1 shrink-0" title="Now playing in master player">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                        </span>
                      </span>
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </button>

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
                            onClick={e => e.stopPropagation()}
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
                              onClick={e => e.stopPropagation()}
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
