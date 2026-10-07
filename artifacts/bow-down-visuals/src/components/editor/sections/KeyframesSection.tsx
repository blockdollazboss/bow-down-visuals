import { useMemo, useState } from "react";
import { Plus, Trash2, Diamond } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  getClipEdit,
  type ClipEdit,
  type EditorSettings,
  type Keyframe,
  keyframeAt,
} from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";

interface Props {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
}

function newKeyframeId(): string {
  return `kf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function KeyframesSection({ scenes, settings, setSettings }: Props) {
  const { toast } = useToast();
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const clips = useMemo(() => scenes.filter((s) => s.demoClipUrl), [scenes]);
  const activeScene = clips.find((s) => s.id === sceneId) ?? clips[0] ?? null;
  const clip: ClipEdit | null = activeScene ? getClipEdit(settings, activeScene.id) : null;

  // Clip duration: default to 10s (keyframes are relative, user can adjust).
  const clipDuration = 10;
  // Current time: use 0 for now (playhead integration can come later).
  const currentTime = 0;

  const keyframes = [...(clip?.keyframes ?? [])].sort((a, b) => a.time - b.time);
  const selected = keyframes.find((k) => k.id === selectedId) ?? null;

  // Live interpolated values at the playhead (for the preview readout).
  const live = keyframeAt(keyframes, currentTime);

  function patchKeyframes(kfs: Keyframe[]) {
    if (!activeScene || !clip) return;
    setSettings({
      ...settings,
      clips: {
        ...settings.clips,
        [activeScene.id]: { ...clip, keyframes: kfs },
      },
    });
  }

  function addKeyframe() {
    const t = Math.min(clipDuration, Math.max(0, currentTime));
    // Start from the current interpolated values so the new keyframe doesn't cause a jump.
    const base = keyframeAt(keyframes, t);
    const kf: Keyframe = {
      id: newKeyframeId(),
      time: Math.round(t * 100) / 100,
      x: base.x,
      y: base.y,
      scale: base.scale,
      rotation: base.rotation,
      opacity: base.opacity,
    };
    patchKeyframes([...keyframes, kf]);
    setSelectedId(kf.id);
    toast({ title: "Keyframe added", description: `At ${kf.time.toFixed(2)}s` });
  }

  function deleteKeyframe(id: string) {
    patchKeyframes(keyframes.filter((k) => k.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function updateSelected(patch: Partial<Keyframe>) {
    if (!selected) return;
    patchKeyframes(keyframes.map((k) => (k.id === selected.id ? { ...k, ...patch } : k)));
  }

  if (!activeScene || !clip) {
    return (
      <EditorCard
        title="Keyframes"
        subtitle="Animate position, scale, rotation & opacity over time"
        icon={<Diamond className="h-4 w-4" />}
      >
        <p className="text-xs text-white/40">Add a clip to start animating.</p>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      title="Keyframes"
      subtitle="Animate position, scale, rotation & opacity over time"
      icon={<Diamond className="h-4 w-4" />}
      data-testid="keyframes-card"
    >
      {/* Clip picker */}
      {clips.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {clips.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setSceneId(s.id); setSelectedId(null); }}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                activeScene.id === s.id
                  ? "bg-primary/20 border-primary text-primary"
                  : "border-white/15 text-white/50 hover:border-white/30"
              }`}
            >
              Clip {i + 1}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-4">
        {/* Timeline track */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-bold text-white/60">
              {keyframes.length} keyframe{keyframes.length === 1 ? "" : "s"}
            </p>
            <button
              type="button"
              onClick={addKeyframe}
              className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add at playhead ({currentTime.toFixed(1)}s)
            </button>
          </div>
          <div
            className="relative h-10 rounded bg-white/5 border border-white/10 cursor-pointer"
              onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const f = (e.clientX - rect.left) / rect.width;
              const t = Math.min(clipDuration, Math.max(0, f * clipDuration));
              const base = keyframeAt(keyframes, t);
              const kf: Keyframe = {
                id: newKeyframeId(),
                time: Math.round(t * 100) / 100,
                x: base.x, y: base.y, scale: base.scale,
                rotation: base.rotation, opacity: base.opacity,
              };
              patchKeyframes([...keyframes, kf]);
              setSelectedId(kf.id);
            }}
            data-testid="keyframes-track"
          >
            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none"
              style={{ left: `${(currentTime / (clipDuration || 1)) * 100}%` }}
            />
            {/* Keyframe diamonds */}
            {keyframes.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={(e) => { e.stopPropagation(); setSelectedId(k.id); }}
                onDoubleClick={(e) => { e.stopPropagation(); deleteKeyframe(k.id); }}
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rotate-45 border-2 transition-colors ${
                  selectedId === k.id
                    ? "bg-primary border-primary"
                    : "bg-black/60 border-white/50 hover:border-primary"
                }`}
                style={{ left: `${(k.time / (clipDuration || 1)) * 100}%` }}
                title={`${k.time.toFixed(2)}s — double-click to delete`}
              />
            ))}
            {keyframes.length === 0 && (
              <p className="absolute inset-0 flex items-center justify-center text-[11px] text-white/30 pointer-events-none">
                Click to add your first keyframe
              </p>
            )}
          </div>
          <p className="text-[10px] text-white/30 mt-1">
            Click the track to add • Click a diamond to edit • Double-click to delete
          </p>
        </div>

        {/* Selected keyframe editor */}
        {selected && (
          <div className="space-y-3 rounded border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-white/80">
                Keyframe at {selected.time.toFixed(2)}s
              </p>
              <button
                type="button"
                onClick={() => deleteKeyframe(selected.id)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-red-400 hover:underline"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>

            <label className="block">
              <span className="text-[11px] text-white/60">Time: {selected.time.toFixed(2)}s</span>
              <input
                type="range" min={0} max={clipDuration} step={0.05} value={selected.time}
                onChange={(e) => updateSelected({ time: Number(e.target.value) })}
                className="w-full h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-white/60">X: {(selected.x * 100).toFixed(0)}%</span>
                <input type="range" min={0} max={1} step={0.01} value={selected.x}
                  onChange={(e) => updateSelected({ x: Number(e.target.value) })}
                  className="w-full h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
              </label>
              <label className="block">
                <span className="text-[11px] text-white/60">Y: {(selected.y * 100).toFixed(0)}%</span>
                <input type="range" min={0} max={1} step={0.01} value={selected.y}
                  onChange={(e) => updateSelected({ y: Number(e.target.value) })}
                  className="w-full h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
              </label>
              <label className="block">
                <span className="text-[11px] text-white/60">Scale: {selected.scale.toFixed(2)}×</span>
                <input type="range" min={0.1} max={3} step={0.05} value={selected.scale}
                  onChange={(e) => updateSelected({ scale: Number(e.target.value) })}
                  className="w-full h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
              </label>
              <label className="block">
                <span className="text-[11px] text-white/60">Rotation: {selected.rotation.toFixed(0)}°</span>
                <input type="range" min={-180} max={180} step={1} value={selected.rotation}
                  onChange={(e) => updateSelected({ rotation: Number(e.target.value) })}
                  className="w-full h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] text-white/60">Opacity: {(selected.opacity * 100).toFixed(0)}%</span>
              <input type="range" min={0} max={1} step={0.01} value={selected.opacity}
                onChange={(e) => updateSelected({ opacity: Number(e.target.value) })}
                className="w-full h-1 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
            </label>
          </div>
        )}

        {/* Live readout */}
        {keyframes.length > 0 && (
          <p className="text-[11px] text-white/40">
            At playhead: x {(live.x * 100).toFixed(0)}% · y {(live.y * 100).toFixed(0)}% ·
            scale {live.scale.toFixed(2)}× · rot {live.rotation.toFixed(0)}° ·
            opacity {(live.opacity * 100).toFixed(0)}%
          </p>
        )}
      </div>
    </EditorCard>
  );
}
