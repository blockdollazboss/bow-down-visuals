import { useState } from "react";
import { ListMusic, SlidersHorizontal, Wand2, Disc3, Download, Info } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  AUDIO_EXPORT_FORMATS, EQ_TONES, LOUDNESS_TARGETS,
  type EditorSettings, type MasterSettings, type EqTone, type LoudnessTarget,
} from "@/lib/editor-settings";
import { EditorCard, Field, Segmented, Chip } from "@/components/editor/controls";
import { StemList } from "@/components/editor/music/StemList";

interface ManualDAWProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
}

type DawTab = "tracks" | "mixer" | "effects" | "mastering" | "export";

const TABS: { id: DawTab; label: string; icon: typeof ListMusic }[] = [
  { id: "tracks", label: "Tracks", icon: ListMusic },
  { id: "mixer", label: "Mixer", icon: SlidersHorizontal },
  { id: "effects", label: "Effects", icon: Wand2 },
  { id: "mastering", label: "Mastering", icon: Disc3 },
  { id: "export", label: "Export", icon: Download },
];

export function ManualDAW({ settings, onChange }: ManualDAWProps) {
  const [tab, setTab] = useState<DawTab>("tracks");
  const ms = settings.musicStudio;

  function patchMaster(patch: Partial<MasterSettings>) {
    onChange({ ...settings, musicStudio: { ...ms, master: { ...ms.master, ...patch } } });
  }
  function toggleExport(fmt: string) {
    const next = ms.exportSelections.includes(fmt)
      ? ms.exportSelections.filter((f) => f !== fmt)
      : [...ms.exportSelections, fmt];
    onChange({ ...settings, musicStudio: { ...ms, exportSelections: next } });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5 p-1 rounded-xl border border-white/[0.06] bg-white/[0.02]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-testid={`daw-tab-${t.id}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                active ? "bg-primary text-black" : "text-white/45 hover:text-white/80"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "tracks" && <StemList settings={settings} onChange={onChange} variant="tracks" />}
      {tab === "mixer" && <StemList settings={settings} onChange={onChange} variant="mixer" />}
      {tab === "effects" && <StemList settings={settings} onChange={onChange} variant="effects" />}

      {tab === "mastering" && (
        <EditorCard title="Master Bus" subtitle="Final polish on the whole song" icon={<Disc3 className="h-4 w-4" />}>
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Master volume" hint={`${ms.master.volume}%`}>
                <Slider value={[ms.master.volume]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ volume: v ?? 100 })} />
              </Field>
              <Field label="Bus compression" hint={`${ms.master.compression}%`}>
                <Slider value={[ms.master.compression]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ compression: v ?? 0 })} />
              </Field>
              <Field label="Stereo width" hint={`${ms.master.stereoWidth}%`}>
                <Slider value={[ms.master.stereoWidth]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ stereoWidth: v ?? 50 })} />
              </Field>
              <Field label="Bass boost" hint={`${ms.master.bassBoost}%`}>
                <Slider value={[ms.master.bassBoost]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ bassBoost: v ?? 0 })} />
              </Field>
              <Field label="EQ tone">
                <Segmented value={ms.master.eqTone} options={EQ_TONES.map((t) => ({ value: t as EqTone, label: t }))} onChange={(v) => patchMaster({ eqTone: v })} />
              </Field>
              <Field label="Loudness target">
                <Segmented value={ms.master.loudnessTarget} options={LOUDNESS_TARGETS.map((t) => ({ value: t.id as LoudnessTarget, label: t.label }))} onChange={(v) => patchMaster({ loudnessTarget: v })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip active={ms.master.limiter} onClick={() => patchMaster({ limiter: !ms.master.limiter })}>Limiter</Chip>
              <Chip active={ms.master.fadeIn} onClick={() => patchMaster({ fadeIn: !ms.master.fadeIn })}>Fade in</Chip>
              <Chip active={ms.master.fadeOut} onClick={() => patchMaster({ fadeOut: !ms.master.fadeOut })}>Fade out</Chip>
            </div>
          </div>
        </EditorCard>
      )}

      {tab === "export" && (
        <EditorCard title="Audio Export" subtitle="Pick the deliverables you want" icon={<Download className="h-4 w-4" />}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {AUDIO_EXPORT_FORMATS.map((fmt) => (
                <Chip key={fmt} active={ms.exportSelections.includes(fmt)} onClick={() => toggleExport(fmt)}>{fmt}</Chip>
              ))}
            </div>
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
              <Info className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                Audio rendering &amp; export is coming soon. Your stems, mixer, effects and master settings are saved with this project.
              </p>
            </div>
          </div>
        </EditorCard>
      )}
    </div>
  );
}
