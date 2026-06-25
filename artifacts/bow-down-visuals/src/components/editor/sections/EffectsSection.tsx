import { Wand2, Film, ArrowLeftRight, FlaskConical } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  TRANSITIONS, EFFECTS, COLOR_GRADES, OVERLAYS,
  getClipEdit,
  type EditorSettings, type ClipEdit,
} from "@/lib/editor-settings";
import { EditorCard, Chip, Dropdown, Collapsible } from "@/components/editor/controls";
import { PlanNote, EmptyScenes } from "@/components/editor/sections/shared";
import { AutoAiEditSection } from "@/components/editor/sections/AutoAiEditSection";

interface EffectsSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  audioUrl?: string | null;
  onTestEffect?: () => void;
  onTestTransition?: () => void;
  onTestOverlay?: () => void;
}

function toggleListItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function EffectsSection({ scenes, settings, setSettings, audioUrl, onTestEffect, onTestTransition, onTestOverlay }: EffectsSectionProps) {
  function patchClip(sceneId: string, patch: Partial<ClipEdit>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
  }

  return (
    <div className="space-y-5">
      {/* ── Auto AI Edit — top of Effects tab ── */}
      <AutoAiEditSection
        scenes={scenes}
        settings={settings}
        setSettings={setSettings}
        audioUrl={audioUrl}
        onTestEffect={onTestEffect}
      />

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

      {/* ── Live Preview Tests ── */}
      {(onTestTransition || onTestOverlay) && (
        <EditorCard title="Preview Tests" subtitle="Fire a transition or overlay in the master player" icon={<FlaskConical className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            {onTestTransition && (
              <button
                onClick={onTestTransition}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white transition-colors"
                data-testid="btn-test-transition"
              >
                Test Transition
              </button>
            )}
            {onTestOverlay && (
              <button
                onClick={onTestOverlay}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#C9A84C]/30 bg-[#C9A84C]/10 hover:bg-[#C9A84C]/20 text-[#C9A84C] transition-colors"
                data-testid="btn-test-overlay"
              >
                Test Overlay
              </button>
            )}
          </div>
          <p className="text-[10px] text-white/30 mt-2">
            Tests play in the live preview on the right. "Test Transition" crossfades scenes 1→2 for 1 s; "Test Overlay" shows a gold label for 3 s.
          </p>
        </EditorCard>
      )}

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
