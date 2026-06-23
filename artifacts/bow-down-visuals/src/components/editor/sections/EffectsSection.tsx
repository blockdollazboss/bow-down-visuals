import { Wand2, Film, ArrowLeftRight } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  TRANSITIONS, EFFECTS, COLOR_GRADES, OVERLAYS,
  getClipEdit,
  type EditorSettings, type ClipEdit,
} from "@/lib/editor-settings";
import { EditorCard, Chip, Dropdown, Collapsible } from "@/components/editor/controls";
import { PlanNote, EmptyScenes } from "@/components/editor/sections/shared";

interface EffectsSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
}

function toggleListItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function EffectsSection({ scenes, settings, setSettings }: EffectsSectionProps) {
  function patchClip(sceneId: string, patch: Partial<ClipEdit>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
  }

  return (
    <div className="space-y-5">
      <EditorCard title="Global Effects" subtitle="Applied across the whole video" icon={<Wand2 className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {EFFECTS.map((fx) => (
            <Chip key={fx} active={settings.effects.includes(fx)} onClick={() => setSettings({ ...settings, effects: toggleListItem(settings.effects, fx) })}>{fx}</Chip>
          ))}
        </div>
      </EditorCard>

      <EditorCard title="Color Grade" subtitle="Pick a cinematic color look" icon={<Wand2 className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {COLOR_GRADES.map((grade) => (
            <Chip key={grade} active={settings.effects.includes(grade)} onClick={() => setSettings({ ...settings, effects: toggleListItem(settings.effects, grade) })}>{grade}</Chip>
          ))}
        </div>
      </EditorCard>

      <EditorCard title="Overlays" subtitle="Branding and on-screen elements" icon={<Film className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {OVERLAYS.map((ov) => (
            <Chip key={ov} active={settings.overlays.includes(ov)} onClick={() => setSettings({ ...settings, overlays: toggleListItem(settings.overlays, ov) })}>{ov}</Chip>
          ))}
        </div>
      </EditorCard>

      <EditorCard title="Transitions" subtitle="Set the transition into each clip" icon={<ArrowLeftRight className="h-4 w-4" />}>
        {scenes.length === 0 ? <EmptyScenes /> : (
          <div className="space-y-2.5">
            {scenes.map((scene, i) => {
              const edit = getClipEdit(settings, scene.id);
              return (
                <div key={scene.id} className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 text-[10px] font-black text-white/40">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-xs text-white/55 truncate">{scene.section || scene.lyricLine || `Scene ${i + 1}`}</span>
                  <div className="w-44 shrink-0">
                    <Dropdown
                      value={edit.transition}
                      options={i === 0 ? ["Cut"] : TRANSITIONS}
                      onChange={(v) => patchClip(scene.id, { transition: v })}
                      testId={`transition-${i}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </EditorCard>

      <Collapsible title="Per-Clip Effects">
        {scenes.length === 0 ? <EmptyScenes /> : (
          <div className="space-y-2.5">
            {scenes.map((scene, i) => {
              const edit = getClipEdit(settings, scene.id);
              return (
                <div key={scene.id} className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 text-[10px] font-black text-white/40">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-xs text-white/55 truncate">{scene.section || scene.lyricLine || `Scene ${i + 1}`}</span>
                  <div className="w-44 shrink-0">
                    <Dropdown value={edit.effect} options={["None", ...EFFECTS]} onChange={(v) => patchClip(scene.id, { effect: v })} testId={`effect-${i}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Collapsible>
      <PlanNote />
    </div>
  );
}
