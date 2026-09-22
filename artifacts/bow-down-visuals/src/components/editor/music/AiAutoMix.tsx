import { useState } from "react";
import { Sparkles, Loader2, Check, SlidersHorizontal, ListMusic, Info, Wand2, Download, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  MIX_PRESETS, INTENSITIES, REVERB_AMOUNTS, AUTOTUNE_STYLES, LOUDNESS_TARGETS,
  applyAiMixToStems,
  type EditorSettings, type AiMixOptions, type AiMixPlan, type MixPresetId,
  type Intensity, type ReverbAmount, type AutotuneStyle, type LoudnessTarget,
  type AudioExportRecord,
} from "@/lib/editor-settings";
import { requestAudioExport, buildExportRecord, AUDIO_EXPORT_BUTTONS } from "@/lib/audio-export";
import { EditorCard, Field, Segmented, Collapsible } from "@/components/editor/controls";
import { OutOfCredits } from "@/components/OutOfCredits";

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
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [generating, setGenerating]       = useState(false);
  const [outOfCredits, setOutOfCredits]   = useState(false);
  const [rendering, setRendering]         = useState(false);
  const [renderError, setRenderError]     = useState<string | null>(null);
  const [renderResult, setRenderResult]   = useState<AudioExportRecord | null>(null);

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

  async function handleRenderMix() {
    if (ms.stems.length === 0) {
      toast({ title: "No stems to render", description: "Upload stems in Manual Studio first.", variant: "destructive" });
      return;
    }
    setRendering(true);
    setRenderError(null);
    setRenderResult(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You need to be signed in to render audio.");
      /* Apply AI mix settings to stems for this render */
      const aiStems = applyAiMixToStems(ms.stems, opts);
      const btn = AUDIO_EXPORT_BUTTONS.find((b) => b.id === "full-mp3")!;
      const resp = await requestAudioExport(token, {
        exportType: btn.id,
        masterVolume: ms.master.volume,
        masterSettings: {
          volume:         ms.master.volume,
          compression:    ms.master.compression,
          stereoWidth:    ms.master.stereoWidth,
          bassBoost:      ms.master.bassBoost,
          eqTone:         ms.master.eqTone,
          loudnessTarget: ms.master.loudnessTarget,
          limiter:        ms.master.limiter,
          fadeIn:         ms.master.fadeIn,
          fadeOut:        ms.master.fadeOut,
        },
        stems: aiStems.map((s) => ({
          id: s.id, name: s.name, type: s.type, url: s.url,
          volume: s.volume, muted: s.muted, solo: s.solo, pan: s.pan,
          trimStart: s.trimStart, trimEnd: s.trimEnd,
          effects: s.effects,
          ...(s.durationSec != null ? { durationSec: s.durationSec } : {}),
        })),
      });
      const record = buildExportRecord(
        { ...btn, label: "AI Mix Render — Full MP3" },
        resp,
        { masterVolume: ms.master.volume, stems: aiStems.map((s) => ({ name: s.name, volume: s.volume, muted: s.muted })) },
      );
      /* Save to exports list + persist result */
      onChange({ ...settings, musicStudio: { ...ms, exports: [record, ...ms.exports].slice(0, 25) } });
      setRenderResult(record);
      if (resp.warnings && resp.warnings.length > 0) {
        toast({ title: "Mix Rendered (with a note)", description: resp.warnings[0] });
      } else {
        toast({ title: "Mix Rendered", description: "Your AI mix is ready to preview and download." });
      }
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : "Render failed. Please try again.");
    } finally {
      setRendering(false);
    }
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
      const msg = err instanceof Error ? err.message : "Could not generate plan.";
      if (msg === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
      } else {
        toast({ title: "Mix plan failed", description: msg, variant: "destructive" });
      }
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

      {outOfCredits && <OutOfCredits />}

      <Button
        onClick={handleGenerate}
        disabled={generating || outOfCredits}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                onClick={handleApplyMix}
                variant="outline"
                className="h-11 text-sm font-bold border-white/12 bg-white/[0.03] hover:bg-white/[0.06] text-white/85"
                data-testid="btn-apply-ai-mix"
              >
                <Wand2 className="h-4 w-4 mr-2" /> Apply to Stems
              </Button>
              <Button
                onClick={handleRenderMix}
                disabled={rendering || ms.stems.length === 0}
                className="h-11 text-sm font-black bg-primary text-black hover:bg-primary/90"
                data-testid="btn-render-ai-mix"
              >
                {rendering
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Rendering…</>
                  : <><Download className="h-4 w-4 mr-2" /> Render Mix MP3</>}
              </Button>
            </div>

            {rendering && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/[0.06] border border-primary/20">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                <p className="text-xs font-bold text-primary">Rendering your AI mix…</p>
              </div>
            )}

            {renderError && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/25">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-200/90 leading-relaxed">{renderError}</p>
              </div>
            )}

            {renderResult && !rendering && (
              <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  <p className="text-xs font-black text-emerald-300">AI Mix Rendered</p>
                  <span className="text-[10px] text-white/40 ml-auto">Full MP3 · {new Date(renderResult.createdAt).toLocaleTimeString()}</span>
                </div>
                <audio controls src={renderResult.url} className="w-full" />
                <a
                  href={renderResult.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 h-10 w-full rounded-lg bg-primary text-black text-sm font-black hover:bg-primary/90 transition-colors"
                >
                  <Download className="h-4 w-4" /> Download AI Mix
                </a>
              </div>
            )}

            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
              <Info className="h-3.5 w-3.5 text-white/40 shrink-0 mt-0.5" />
              <p className="text-[11px] text-white/50 leading-relaxed">
                <span className="font-semibold text-white/70">Apply to Stems</span> — sets preview volumes &amp; pan so you can hear the balance live. <span className="font-semibold text-white/70">Render Mix MP3</span> — runs the full render with your Mastering settings and produces a downloadable file.
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
