import { useState } from "react";
import { Sparkles, Loader2, Wand2, Check, Clapperboard, ArrowRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";
import {
  AUTO_EDIT_PRESETS,
  VIDEO_FORMATS,
  CAPTION_STYLES,
  INTENSITIES,
  sceneHasClip,
  type EditorSettings,
  type AutoEditOptions,
  type AutoEditPlan,
  type AutoEditPresetId,
  type VideoFormat,
  type Intensity,
} from "@/lib/editor-settings";
import { EditorCard, Segmented, Field, Dropdown, Collapsible } from "@/components/editor/controls";

interface AutoEditPanelProps {
  scenes: SceneData[];
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  artistName?: string;
  songTitle?: string;
}

export function AutoEditPanel({ scenes, settings, onChange, artistName, songTitle }: AutoEditPanelProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  const opts = settings.autoEdit;
  const plan = settings.autoEditPlan;
  const clipCount = scenes.filter(sceneHasClip).length;

  function patchOpts(patch: Partial<AutoEditOptions>) {
    onChange({ ...settings, autoEdit: { ...opts, ...patch } });
  }

  function selectPreset(id: AutoEditPresetId) {
    const preset = AUTO_EDIT_PRESETS.find((p) => p.id === id);
    patchOpts({
      preset: id,
      beatCutIntensity: preset?.defaultBeatCut ?? opts.beatCutIntensity,
      transitionIntensity: preset?.defaultTransition ?? opts.transitionIntensity,
    });
  }

  async function handleGenerate() {
    if (scenes.length === 0) {
      toast({ title: "No scenes", description: "This project has no scenes to edit.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const token = await getAccessToken();
      const presetName = AUTO_EDIT_PRESETS.find((p) => p.id === opts.preset)?.name ?? opts.preset;
      const res = await fetch("/api/auto-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          preset: opts.preset,
          presetName,
          format: opts.format,
          captionStyle: opts.captionStyle,
          intro: opts.intro,
          outro: opts.outro,
          watermark: opts.watermark,
          beatCutIntensity: opts.beatCutIntensity,
          transitionIntensity: opts.transitionIntensity,
          artistName: artistName ?? "",
          songTitle: songTitle ?? "",
          scenes: scenes.map((s) => ({
            id: s.id,
            section: s.section,
            lyricLine: s.lyricLine,
            action: s.action,
            location: s.location,
            mood: s.mood,
            timestamp: s.timestamp,
            hasClip: sceneHasClip(s),
          })),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Generation failed" }))) as { error?: string };
        throw new Error(err.error ?? "Generation failed");
      }
      const generatedPlan = (await res.json()) as AutoEditPlan;
      onChange({ ...settings, autoEditPlan: generatedPlan });
      toast({
        title: "AI Edit Plan ready",
        description: generatedPlan.fallback
          ? "Generated an offline plan — AI was unavailable."
          : `${generatedPlan.clips?.length ?? 0} clips arranged for ${presetName}.`,
      });
    } catch (err) {
      toast({
        title: "Edit plan failed",
        description: err instanceof Error ? err.message : "Could not generate plan.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }

  const intensityOpts = INTENSITIES.map((i) => ({ value: i as Intensity, label: i }));

  return (
    <div className="space-y-5">
      {/* Preset gallery */}
      <EditorCard title="Choose a Style" subtitle="Pick the edit vibe — it sets pacing and transitions" icon={<Wand2 className="h-4 w-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AUTO_EDIT_PRESETS.map((preset) => {
            const active = opts.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => selectPreset(preset.id)}
                data-testid={`preset-${preset.id}`}
                className={`relative text-left rounded-xl border p-4 transition-all overflow-hidden ${
                  active
                    ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_24px_rgba(234,179,8,0.08)]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${preset.accent} opacity-60 pointer-events-none`} />
                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <h4 className="text-sm font-black text-white">{preset.name}</h4>
                    {active && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </div>
                  <p className="text-[10px] font-bold text-primary/70 uppercase tracking-wider mb-1.5">{preset.tagline}</p>
                  <p className="text-[11px] text-white/45 leading-relaxed">{preset.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </EditorCard>

      {/* Core options */}
      <EditorCard title="Output" subtitle="Format and captions" icon={<Clapperboard className="h-4 w-4" />}>
        <div className="space-y-5">
          <Field label="Format">
            <div className="flex flex-wrap gap-2">
              {VIDEO_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => patchOpts({ format: f.id as VideoFormat })}
                  data-testid={`format-${f.id}`}
                  className={`flex flex-col items-start px-3.5 py-2 rounded-xl border transition-colors ${
                    opts.format === f.id
                      ? "border-primary/50 bg-primary/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <span className={`text-sm font-black ${opts.format === f.id ? "text-primary" : "text-white/70"}`}>{f.label}</span>
                  <span className="text-[10px] text-white/35">{f.note}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Caption Style">
            <Dropdown
              value={opts.captionStyle}
              options={CAPTION_STYLES}
              onChange={(v) => patchOpts({ captionStyle: v })}
              testId="auto-caption-style"
            />
          </Field>
        </div>
      </EditorCard>

      {/* Advanced */}
      <Collapsible title="Advanced Controls">
        <div className="space-y-5">
          <Field label="Beat-Cut Intensity" hint="How tightly cuts lock to the beat">
            <Segmented value={opts.beatCutIntensity} options={intensityOpts} onChange={(v) => patchOpts({ beatCutIntensity: v })} />
          </Field>
          <Field label="Transition Intensity" hint="How aggressive transitions are">
            <Segmented value={opts.transitionIntensity} options={intensityOpts} onChange={(v) => patchOpts({ transitionIntensity: v })} />
          </Field>

          <div className="space-y-3 pt-1">
            <ToggleRow label="Intro card" desc="Open with an artist / title card" checked={opts.intro} onChange={(v) => patchOpts({ intro: v })} testId="toggle-intro" />
            <ToggleRow label="Outro card" desc="Close with a call-to-action card" checked={opts.outro} onChange={(v) => patchOpts({ outro: v })} testId="toggle-outro" />
            <ToggleRow label="Watermark" desc="Overlay a watermark on the export" checked={opts.watermark} onChange={(v) => patchOpts({ watermark: v })} testId="toggle-watermark" />
          </div>
        </div>
      </Collapsible>

      {/* Generate */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <Button
          onClick={handleGenerate}
          disabled={generating || scenes.length === 0}
          className="gold-glow font-bold gap-2 h-12 px-8 text-base"
          data-testid="btn-create-auto-edit"
        >
          {generating ? <><Loader2 className="h-5 w-5 animate-spin" /> Building plan…</> : <><Sparkles className="h-5 w-5" /> Create AI Auto Edit</>}
        </Button>
        <p className="text-xs text-white/40">
          {clipCount > 0 ? `${clipCount} clip${clipCount !== 1 ? "s" : ""} ready · ` : ""}
          {scenes.length} scene{scenes.length !== 1 ? "s" : ""} in this project
        </p>
      </div>

      {/* Plan output */}
      {plan && <PlanView plan={plan} scenes={scenes} />}
    </div>
  );
}

function ToggleRow({
  label, desc, checked, onChange, testId,
}: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void; testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white/80">{label}</p>
        <p className="text-[11px] text-white/35">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
    </div>
  );
}

function PlanView({ plan, scenes }: { plan: AutoEditPlan; scenes: SceneData[] }) {
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  return (
    <EditorCard
      title="AI Edit Plan"
      subtitle={`${plan.template} · ${plan.format} · ~${plan.estimatedDuration}`}
      icon={<Sparkles className="h-4 w-4" />}
      right={
        plan.fallback ? (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300">Offline</span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full border border-green-500/30 bg-green-500/10 text-green-400">AI</span>
        )
      }
    >
      <div className="space-y-4" data-testid="auto-edit-plan">
        {(plan.introText || plan.outroText) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {plan.introText && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] font-black text-white/35 uppercase tracking-widest mb-0.5">Intro Card</p>
                <p className="text-sm text-white/75">{plan.introText}</p>
              </div>
            )}
            {plan.outroText && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] font-black text-white/35 uppercase tracking-widest mb-0.5">Outro Card</p>
                <p className="text-sm text-white/75">{plan.outroText}</p>
              </div>
            )}
          </div>
        )}

        {/* Clip order list */}
        <div className="rounded-xl border border-white/[0.07] overflow-hidden">
          <div className="grid grid-cols-[28px_1fr_96px_96px_56px] gap-2 px-3 py-2 bg-white/[0.03] border-b border-white/[0.05]">
            <span className="text-[9px] font-black text-white/30 uppercase">#</span>
            <span className="text-[9px] font-black text-white/30 uppercase">Scene</span>
            <span className="text-[9px] font-black text-white/30 uppercase">Transition</span>
            <span className="text-[9px] font-black text-white/30 uppercase">Effect</span>
            <span className="text-[9px] font-black text-white/30 uppercase text-right">Dur.</span>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {(plan.clips ?? []).map((c) => {
              const scene = sceneById.get(c.sceneId);
              return (
                <div key={`${c.sceneId}-${c.order}`} className="grid grid-cols-[28px_1fr_96px_96px_56px] gap-2 items-center px-3 py-2.5">
                  <span className="text-[11px] font-black text-primary/60">{c.order}</span>
                  <div className="min-w-0">
                    <p className="text-[12px] text-white/75 truncate">{c.label}</p>
                    {scene?.section && <p className="text-[10px] text-white/30 truncate">{scene.section}</p>}
                  </div>
                  <span className="text-[11px] text-white/55 truncate">{c.transition}</span>
                  <span className="text-[11px] text-white/55 truncate">{c.effect}</span>
                  <span className="text-[11px] text-white/40 text-right tabular-nums">{c.durationSec}s</span>
                </div>
              );
            })}
          </div>
        </div>

        {plan.notes && (
          <div className="flex items-start gap-2 text-[12px] text-white/50 leading-relaxed">
            <ArrowRight className="h-3.5 w-3.5 text-primary/50 shrink-0 mt-0.5" />
            <p>{plan.notes}</p>
          </div>
        )}

        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-500/[0.07] border border-blue-500/15">
          <Info className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-200/80 leading-relaxed">
            This is an edit plan — transitions and effects describe how the final render should look and aren't burned into clips until final rendering is enabled.
          </p>
        </div>
      </div>
    </EditorCard>
  );
}
