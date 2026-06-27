import { Wand2, Film, ArrowLeftRight, FlaskConical, RotateCcw } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  TRANSITIONS, EFFECTS, COLOR_GRADES, OVERLAYS, OVERLAY_DEFAULT_INTENSITY,
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
  /** Transition type currently rendering in the master player (live), or null. */
  activeTransitionType?: string | null;
  /** Jump the master player to ~1s before a scene's transition and play through it. */
  onPreviewTransition?: (sceneIndex: number) => void;
}

function toggleListItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/* ── Intensity slider ─────────────────────────────────────────────────────── */
function IntensityRow({
  label,
  value,
  onChange,
  onRemove,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 w-full min-w-0 py-0.5">
      <span className="text-[11px] font-semibold text-white/60 w-28 shrink-0 truncate">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 min-w-0 cursor-pointer"
        style={{ accentColor: "#C9A84C" }}
      />
      <span className="text-[10px] font-mono text-white/40 w-8 text-right shrink-0">{value}%</span>
      <button
        onClick={onRemove}
        className="shrink-0 text-white/25 hover:text-white/60 transition-colors text-xs leading-none px-0.5"
        title={`Remove ${label}`}
      >
        ×
      </button>
    </div>
  );
}

export function EffectsSection({ scenes, settings, setSettings, audioUrl, onTestEffect, onTestTransition, onTestOverlay, activeTransitionType, onPreviewTransition }: EffectsSectionProps) {
  function patchClip(sceneId: string, patch: Partial<ClipEdit>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
  }

  function setIntensity(name: string, v: number) {
    setSettings({ ...settings, overlayIntensity: { ...settings.overlayIntensity, [name]: v } });
  }

  function removeOverlay(name: string) {
    const overlays = settings.overlays.filter((x) => x !== name);
    const { [name]: _, ...rest } = settings.overlayIntensity;
    setSettings({ ...settings, overlays, overlayIntensity: rest });
  }

  function resetAllEffects() {
    setSettings({ ...settings, effects: [], overlays: [], overlayIntensity: {} });
  }

  const hasAnyEffect = settings.effects.length > 0 || settings.overlays.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Auto AI Edit ── */}
      <AutoAiEditSection
        scenes={scenes}
        settings={settings}
        setSettings={setSettings}
        audioUrl={audioUrl}
        onTestEffect={onTestEffect}
        activeTransitionType={activeTransitionType}
        onPreviewTransition={onPreviewTransition}
      />

      {/* ── Global Effects ── */}
      <EditorCard title="Global Effects" subtitle="Applied across the whole video" icon={<Wand2 className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {EFFECTS.map((fx) => (
            <Chip
              key={fx}
              active={settings.effects.includes(fx)}
              onClick={() => setSettings({ ...settings, effects: toggleListItem(settings.effects, fx) })}
            >
              {fx}
            </Chip>
          ))}
        </div>
      </EditorCard>

      {/* ── Color Grade ── */}
      <EditorCard title="Color Grade" subtitle="Pick a cinematic look — one at a time" icon={<Wand2 className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {COLOR_GRADES.map((grade) => {
            const active = settings.effects.includes(grade);
            return (
              <Chip
                key={grade}
                active={active}
                onClick={() => {
                  /* Radio behaviour: selecting a grade removes all other grades */
                  const withoutGrades = settings.effects.filter(
                    (e) => !(COLOR_GRADES as readonly string[]).includes(e),
                  );
                  setSettings({
                    ...settings,
                    effects: active ? withoutGrades : [...withoutGrades, grade],
                  });
                }}
              >
                {grade}
              </Chip>
            );
          })}
        </div>
      </EditorCard>

      {/* ── Overlays ── */}
      <EditorCard
        title="Overlays"
        subtitle="Animated visual effects — visible immediately in the player"
        icon={<Film className="h-4 w-4" />}
      >
        {/* Chip row */}
        <div className="flex flex-wrap gap-2 mb-3">
          {OVERLAYS.map((ov) => {
            const active = settings.overlays.includes(ov);
            return (
              <Chip
                key={ov}
                active={active}
                onClick={() => {
                  const wasActive = settings.overlays.includes(ov);
                  const newOverlays = toggleListItem(settings.overlays, ov);
                  const newIntensity = { ...settings.overlayIntensity };
                  if (!wasActive && !(ov in newIntensity)) {
                    newIntensity[ov] = OVERLAY_DEFAULT_INTENSITY[ov] ?? 20;
                  }
                  setSettings({ ...settings, overlays: newOverlays, overlayIntensity: newIntensity });
                }}
              >
                {ov}
              </Chip>
            );
          })}
        </div>

        {/* Per-overlay intensity sliders */}
        {settings.overlays.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-white/[0.06] pt-3">
            <p className="text-[10px] text-white/30 mb-2 uppercase tracking-wide font-semibold">
              Effect Intensity
            </p>
            {settings.overlays.map((ov) => (
              <IntensityRow
                key={ov}
                label={ov}
                value={settings.overlayIntensity[ov] ?? OVERLAY_DEFAULT_INTENSITY[ov] ?? 20}
                onChange={(v) => setIntensity(ov, v)}
                onRemove={() => removeOverlay(ov)}
              />
            ))}
          </div>
        )}

        {settings.overlays.length === 0 && (
          <p className="text-[11px] text-white/25 mt-1">
            Click a chip above to add a live overlay effect to the master player.
          </p>
        )}

        {/* ── Watermark text ── */}
        {settings.overlays.includes("Logo / Watermark") && (
          <div className="mt-3 pt-2 border-t border-white/[0.06]">
            <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
              Watermark Text
            </label>
            <input
              type="text"
              value={settings.watermarkText ?? "Bow Down Visuals"}
              onChange={(e) => setSettings({ ...settings, watermarkText: e.target.value })}
              placeholder="Bow Down Visuals"
              className="w-full bg-white/[0.04] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-[#C9A84C]/40"
            />
          </div>
        )}

        {/* ── Waveform position ── */}
        {settings.overlays.includes("Animated Waveform") && (
          <div className="mt-3 pt-2 border-t border-white/[0.06]">
            <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
              Waveform Position
            </label>
            <Dropdown
              value={settings.waveformPosition ?? "bottom-safe"}
              options={["bottom-safe", "top", "bottom", "hidden"]}
              onChange={(v) => setSettings({ ...settings, waveformPosition: v })}
            />
            <p className="text-[10px] text-white/25 mt-1">
              "bottom-safe" keeps the waveform above the caption area.
            </p>
          </div>
        )}

        {/* ── Overlay preview status ── */}
        {settings.overlays.length > 0 && (() => {
          const VISUAL = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform"];
          const vCount = settings.overlays.filter((o) => VISUAL.includes(o)).length;
          const stackSafe = vCount <= 3;
          const wfPos = settings.waveformPosition ?? "bottom-safe";
          const captionsReadable =
            !settings.overlays.includes("Animated Waveform") ||
            ["bottom-safe", "top", "hidden"].includes(wfPos);
          const rows: [string, string, boolean][] = [
            ["overlay preview active", "yes", true],
            ["overlay stack safe", stackSafe ? "yes" : `${vCount} overlays — opacity reduced`, stackSafe],
            ["captions readable", captionsReadable ? "yes" : "waveform may cover captions", captionsReadable],
          ];
          return (
            <div className="mt-3 pt-2 border-t border-white/[0.06] space-y-1">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-wide mb-1">Overlay Preview Status</p>
              {rows.map(([label, val, ok]) => (
                <div key={label} className="flex items-center justify-between gap-2 text-[10px] font-mono">
                  <span className="text-white/35">{label}</span>
                  <span className={`font-bold ${ok ? "text-green-400" : "text-amber-400"}`}>{val}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </EditorCard>

      {/* ── Transitions ── */}
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

      {/* ── Preview Tests ── */}
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
                Test Overlay Render
              </button>
            )}
          </div>
          <p className="text-[10px] text-white/30 mt-2">
            "Test Overlay Render" fires Rain + Sparks + Lens Flare + OVERLAY TEST ACTIVE for 3 s. If nothing shows in the player, overlays are not connected.
          </p>
        </EditorCard>
      )}

      {/* ── Reset button ── */}
      {hasAnyEffect && (
        <button
          onClick={resetAllEffects}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-red-500/20 bg-red-500/[0.06] hover:bg-red-500/[0.14] text-red-400/70 hover:text-red-400 transition-colors w-full"
          data-testid="btn-reset-effects"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset All Effects
        </button>
      )}

      {/* ── Per-Clip Effects ── */}
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
