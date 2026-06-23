import { useState } from "react";
import { Sparkles, Loader2, Check, SlidersHorizontal, ListMusic, Info, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  MIX_PRESETS, INTENSITIES, REVERB_AMOUNTS, AUTOTUNE_STYLES, LOUDNESS_TARGETS,
  applyAiMixToStems,
  type EditorSettings, type AiMixOptions, type AiMixPlan, type MixPresetId,
  type Intensity, type ReverbAmount, type AutotuneStyle, type LoudnessTarget,
} from "@/lib/editor-settings";
import { EditorCard, Field, Segmented, Collapsible } from "@/components/editor/controls";

interface AiAutoMixProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  artistName?: string;
  songTitle?: string;
}

const intensityOpts = INTENSITIES.map((i) => ({ value: i as Intensity, label: i }));
const reverbOpts = REVERB_AMOUNTS.map((r) => ({ value: r as ReverbAmount, label: r }));
const autotuneOpts = AUTOTUNE_STYLES.map((a) => ({ value: a as AutotuneStyle, label: a }));

export function AiAutoMix({ settings, onChange, artistName, songTitle }: AiAutoMixProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [generating, setGenerating] = useState(false);

  const ms = settings.musicStudio;
  const opts = ms.aiMix;
  const plan = ms.aiMixPlan;

  function patch(p: Partial<AiMixOptions>) {
    onChange({ ...settings, musicStudio: { ...ms, aiMix: { ...opts, ...p } } });
  }

  function handleApplyMix() {
    if (ms.stems.length === 0) {
      toast({ title: "No stems to mix", description: "Upload stems in Manual Studio first, then apply the AI mix.", variant: "destructive" });
      return;
    }
    const nextStems = applyAiMixToStems(ms.stems, opts);
    onChange({ ...settings, musicStudio: { ...ms, mode: "manual", stems: nextStems } });
    const locked = ms.stems.filter((s) => s.locked).length;
    toast({
      title: "AI mix settings applied",
      description: locked > 0
        ? `Preview volumes & pan set on your stems (${locked} locked stem${locked > 1 ? "s" : ""} kept). Switched to Manual Studio to preview.`
        : "Preview volumes & pan set on your stems. Switched to Manual Studio so you can preview the mix.",
    });
  }

  async function handleGenerate() {
    setGenerating(true);
    try {
      const token = await getAccessToken();
      const presetName = MIX_PRESETS.find((p) => p.id === opts.preset)?.name ?? opts.preset;
      const res = await fetch("/api/mix-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({
          preset: opts.preset,
          presetName,
          vocalLoudness: opts.vocalLoudness,
          beatLoudness: opts.beatLoudness,
          bassStrength: opts.bassStrength,
          vocalClarity: opts.vocalClarity,
          reverbAmount: opts.reverbAmount,
          autotuneStyle: opts.autotuneStyle,
          masterLoudness: opts.masterLoudness,
          cleanRadioMode: opts.cleanRadioMode,
          artistName: artistName ?? "",
          songTitle: songTitle ?? "",
          stems: ms.stems.map((s) => ({ name: s.name, type: s.type })),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: "Mix plan failed" }))) as { error?: string };
        throw new Error(err.error ?? "Mix plan failed");
      }
      const generatedPlan = (await res.json()) as AiMixPlan;
      onChange({ ...settings, musicStudio: { ...ms, aiMix: opts, aiMixPlan: generatedPlan } });
      toast({
        title: "AI Mix Plan ready",
        description: generatedPlan.fallback
          ? "Generated an offline plan — AI was unavailable."
          : `Mix & master plan built for ${presetName}.`,
      });
    } catch (err) {
      toast({
        title: "Mix plan failed",
        description: err instanceof Error ? err.message : "Could not generate plan.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-5">
      <EditorCard title="Choose a Sound" subtitle="Pick the mix vibe — it sets the whole mix & master chain" icon={<Sparkles className="h-4 w-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MIX_PRESETS.map((preset) => {
            const active = opts.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => patch({ preset: preset.id as MixPresetId })}
                data-testid={`mix-preset-${preset.id}`}
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

      <EditorCard title="Mix Controls" subtitle="Fine-tune the balance" icon={<SlidersHorizontal className="h-4 w-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Vocal loudness"><Segmented value={opts.vocalLoudness} options={intensityOpts} onChange={(v) => patch({ vocalLoudness: v })} /></Field>
          <Field label="Beat loudness"><Segmented value={opts.beatLoudness} options={intensityOpts} onChange={(v) => patch({ beatLoudness: v })} /></Field>
          <Field label="Bass / 808 strength"><Segmented value={opts.bassStrength} options={intensityOpts} onChange={(v) => patch({ bassStrength: v })} /></Field>
          <Field label="Vocal clarity"><Segmented value={opts.vocalClarity} options={intensityOpts} onChange={(v) => patch({ vocalClarity: v })} /></Field>
        </div>
        <div className="mt-5">
          <Collapsible title="Advanced — Reverb · Autotune · Master · Clean">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Reverb amount"><Segmented value={opts.reverbAmount} options={reverbOpts} onChange={(v) => patch({ reverbAmount: v })} /></Field>
              <Field label="Autotune style"><Segmented value={opts.autotuneStyle} options={autotuneOpts} onChange={(v) => patch({ autotuneStyle: v })} /></Field>
              <Field label="Master loudness">
                <Segmented
                  value={opts.masterLoudness}
                  options={LOUDNESS_TARGETS.map((t) => ({ value: t.id as LoudnessTarget, label: t.label }))}
                  onChange={(v) => patch({ masterLoudness: v })}
                />
              </Field>
              <div className="flex items-center justify-between gap-4 pt-1">
                <div>
                  <p className="text-sm font-semibold text-white/80">Clean radio mode</p>
                  <p className="text-[11px] text-white/35">Strip explicit words in the plan</p>
                </div>
                <Switch checked={opts.cleanRadioMode} onCheckedChange={(v) => patch({ cleanRadioMode: v })} data-testid="toggle-clean-radio" />
              </div>
            </div>
          </Collapsible>
        </div>
      </EditorCard>

      <Button
        onClick={handleGenerate}
        disabled={generating}
        className="w-full h-12 text-sm font-black bg-primary text-black hover:bg-primary/90"
        data-testid="btn-create-mix-plan"
      >
        {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building mix plan…</> : <><Sparkles className="h-4 w-4 mr-2" /> Create AI Mix Plan</>}
      </Button>

      {plan && (
        <EditorCard title="Your Mix & Master Plan" subtitle={plan.fallback ? "Offline plan" : "AI-generated"} icon={<ListMusic className="h-4 w-4" />}>
          <div className="space-y-5">
            <p className="text-sm text-white/65 leading-relaxed">{plan.summary}</p>
            {plan.stemLevels?.length > 0 && (
              <ChainBlock title="Stem Levels" items={plan.stemLevels.map((s) => `${s.name} — ${s.level}`)} />
            )}
            <ChainBlock title="Vocal Chain" items={plan.vocalChain} ordered />
            <ChainBlock title="Beat Chain" items={plan.beatChain} ordered />
            <ChainBlock title="Master Chain" items={plan.masterChain} ordered />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoTile label="Loudness target" value={plan.loudnessTarget} />
              <InfoTile label="Export" value={plan.exportRecommendation} />
            </div>
            {plan.notes && <p className="text-[11px] text-white/40 leading-relaxed">{plan.notes}</p>}
            <Button
              onClick={handleApplyMix}
              className="w-full h-11 text-sm font-black bg-primary text-black hover:bg-primary/90"
              data-testid="btn-apply-ai-mix"
            >
              <Wand2 className="h-4 w-4 mr-2" /> Apply AI Mix Settings
            </Button>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
              <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                Apply sets suggested preview volume &amp; pan on your stems so you can hear the balance in the browser. Final studio-quality rendering/export comes in the next phase.
              </p>
            </div>
          </div>
        </EditorCard>
      )}
    </div>
  );
}

function ChainBlock({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-black text-white/45 uppercase tracking-widest mb-2">{title}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5 text-xs text-white/65 leading-relaxed">
            <span className="h-4 min-w-4 px-1 rounded bg-primary/10 border border-primary/20 text-[9px] font-black text-primary/80 flex items-center justify-center shrink-0 mt-0.5">
              {ordered ? i + 1 : "•"}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[9px] font-black text-white/35 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-xs text-white/70 leading-relaxed">{value}</p>
    </div>
  );
}
