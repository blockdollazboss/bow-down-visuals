import { useEffect, useRef, useState } from "react";
import { ListMusic, SlidersHorizontal, Wand2, Disc3, Download, Info, Save, Clapperboard, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  AUDIO_EXPORT_FORMATS, EQ_TONES, LOUDNESS_TARGETS,
  type EditorSettings, type MasterSettings, type EqTone, type LoudnessTarget,
  type AudioExportRecord,
} from "@/lib/editor-settings";
import {
  AUDIO_EXPORT_BUTTONS, requestAudioExport, buildExportRecord, requestPreviewRender,
  type AudioExportType, type AudioExportButton, type PreviewRenderResult,
  type DirectAudioExportStatus,
} from "@/lib/audio-export";
import { EditorCard, Field, Segmented, Chip } from "@/components/editor/controls";
import { StemList } from "@/components/editor/music/StemList";
import { PreviewTransport } from "@/components/editor/music/PreviewTransport";
import type { MixPreview } from "@/components/editor/music/useMixPreview";

interface ManualDAWProps {
  settings: EditorSettings;
  onChange: (next: EditorSettings) => void;
  preview: MixPreview;
  requestedExport?: AudioExportType | null;
  onExportRequestHandled?: () => void;
  onDirectExportStatusChange?: (status: DirectAudioExportStatus) => void;
}

type DawTab = "tracks" | "mixer" | "effects" | "mastering" | "export";

const TABS: { id: DawTab; label: string; icon: typeof ListMusic }[] = [
  { id: "tracks", label: "Stems", icon: ListMusic },
  { id: "mixer", label: "Mixer", icon: SlidersHorizontal },
  { id: "effects", label: "Effects", icon: Wand2 },
  { id: "mastering", label: "Mastering", icon: Disc3 },
  { id: "export", label: "Export Audio (Beta)", icon: Download },
];

export function ManualDAW({
  settings,
  onChange,
  preview,
  requestedExport = null,
  onExportRequestHandled,
  onDirectExportStatusChange,
}: ManualDAWProps) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [tab, setTab] = useState<DawTab>("tracks");
  const [exporting, setExporting] = useState<AudioExportType | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [justExported, setJustExported] = useState<AudioExportRecord | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderedPreview, setRenderedPreview] = useState<PreviewRenderResult | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const ms = settings.musicStudio;
  const usingMixForVideo = ms.videoAudio.source === "full-mix";

  function patchMaster(patch: Partial<MasterSettings>) {
    onChange({ ...settings, musicStudio: { ...ms, master: { ...ms.master, ...patch } } });
  }
  function toggleExport(fmt: string) {
    const next = ms.exportSelections.includes(fmt)
      ? ms.exportSelections.filter((f) => f !== fmt)
      : [...ms.exportSelections, fmt];
    onChange({ ...settings, musicStudio: { ...ms, exportSelections: next } });
  }
  async function startExport(btn: AudioExportButton, isDirectRequest = false) {
    if (exporting) return;
    setExportError(null);
    setJustExported(null);
    if (ms.stems.length === 0) {
      const message = "Upload at least one stem before exporting.";
      setExportError(message);
      if (isDirectRequest) {
        onDirectExportStatusChange?.({
          status: "error",
          exportType: btn.id,
          label: btn.label,
          message,
        });
      }
      return;
    }
    setExporting(btn.id);
    if (isDirectRequest) {
      onDirectExportStatusChange?.({
        status: "rendering",
        exportType: btn.id,
        label: btn.label,
      });
    }
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You need to be signed in to export audio.");
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
        stems: ms.stems.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          url: s.url,
          volume: s.volume,
          muted: s.muted,
          solo: s.solo,
          pan: s.pan,
          trimStart: s.trimStart,
          trimEnd: s.trimEnd,
          effects: s.effects,
          ...(s.durationSec != null ? { durationSec: s.durationSec } : {}),
        })),
      });
      const record = buildExportRecord(btn, resp, {
        masterVolume: ms.master.volume,
        stems: ms.stems.map((s) => ({ name: s.name, volume: s.volume, muted: s.muted })),
      });
      onChange({
        ...settings,
        musicStudio: { ...ms, exports: [record, ...ms.exports].slice(0, 25) },
      });
      setJustExported(record);
      if (isDirectRequest) {
        onDirectExportStatusChange?.({
          status: "complete",
          exportType: btn.id,
          label: btn.label,
        });
      }
      if (resp.warnings && resp.warnings.length > 0) {
        toast({
          title: "Export Complete (with a note)",
          description: `${btn.label} is ready to download. ${resp.warnings[0]}`,
        });
      } else {
        toast({ title: "Export Complete", description: `${btn.label} is ready to download.` });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Export failed. Please try again.";
      setExportError(message);
      if (isDirectRequest) {
        onDirectExportStatusChange?.({
          status: "error",
          exportType: btn.id,
          label: btn.label,
          message,
        });
      }
    } finally {
      setExporting(null);
    }
  }

  const handledRequestRef = useRef<AudioExportType | null>(null);
  useEffect(() => {
    if (!requestedExport) {
      handledRequestRef.current = null;
      return;
    }
    if (handledRequestRef.current === requestedExport || exporting) return;

    const btn = AUDIO_EXPORT_BUTTONS.find((candidate) => candidate.id === requestedExport);
    handledRequestRef.current = requestedExport;
    onExportRequestHandled?.();
    if (!btn) return;

    setTab("export");
    void startExport(btn, true);
    // The request is edge-triggered by the parent and is cleared above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedExport]);
  async function renderTruePreview() {
    if (rendering) return;
    setRenderError(null);
    if (ms.stems.length === 0) {
      setRenderError("Upload at least one stem before rendering a preview.");
      return;
    }
    setRendering(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("You need to be signed in to render a preview.");
      const result = await requestPreviewRender(token, {
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
        stems: ms.stems.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          url: s.url,
          volume: s.volume,
          muted: s.muted,
          solo: s.solo,
          pan: s.pan,
          trimStart: s.trimStart,
          trimEnd: s.trimEnd,
          effects: s.effects,
          ...(s.durationSec != null ? { durationSec: s.durationSec } : {}),
        })),
      });
      setRenderedPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return result;
      });
      if (result.warnings.length > 0) {
        toast({ title: "True Render Ready (with a note)", description: result.warnings[0] });
      }
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : "Preview render failed. Please try again.");
    } finally {
      setRendering(false);
    }
  }
  function handleSave() {
    onChange({ ...settings, musicStudio: { ...ms } });
    toast({ title: "Mix settings saved", description: "Your stems, volumes, mute/solo, pan, trims, master and AI mix are stored with this project." });
  }
  function handleUseForVideo() {
    onChange({ ...settings, musicStudio: { ...ms, videoAudio: { ...ms.videoAudio, source: "full-mix" } } });
    toast({ title: "Using this mix for the video", description: "The video's soundtrack is now set to your Music Studio mix." });
  }

  return (
    <div className="space-y-5">
      <PreviewTransport
        preview={preview}
        onRenderTruePreview={renderTruePreview}
        rendering={rendering}
        renderedPreview={renderedPreview}
        renderError={renderError}
        hasStems={ms.stems.length > 0}
      />

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
        <div className="space-y-4">
          <EditorCard title="Audio Export Beta" subtitle="Render your stem mix into a downloadable audio file" icon={<Download className="h-4 w-4" />}>
            <div className="space-y-4">
              {ms.stems.length === 0 ? (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
                  <Info className="h-3.5 w-3.5 text-white/40 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-white/55 leading-relaxed">
                    Upload stems in the <span className="text-white/80 font-semibold">Stems</span> tab to enable audio export.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AUDIO_EXPORT_BUTTONS.map((b) => {
                    const busy = exporting === b.id;
                    return (
                      <Button
                        key={b.id}
                        onClick={() => startExport(b)}
                        disabled={exporting !== null}
                        variant="outline"
                        className="h-11 text-sm font-bold border-white/12 bg-white/[0.03] hover:bg-white/[0.06] text-white/85 justify-start"
                        data-testid={`btn-export-${b.id}`}
                      >
                        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                        {b.label}
                      </Button>
                    );
                  })}
                </div>
              )}

              {exporting && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/[0.06] border border-primary/20" data-testid="export-status-running">
                  <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  <p className="text-xs font-bold text-primary">Exporting Audio…</p>
                </div>
              )}

              {exportError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/25" data-testid="export-error">
                  <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-red-200/90 leading-relaxed">{exportError}</p>
                </div>
              )}

              {justExported && !exporting && (
                <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3" data-testid="export-complete">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <p className="text-xs font-black text-emerald-300">Export Complete</p>
                    <span className="text-[10px] text-white/40 ml-auto truncate">{justExported.label} · {justExported.format.toUpperCase()}</span>
                  </div>
                  <audio controls src={justExported.url} className="w-full" data-testid="export-audio-player" />
                  <a
                    href={justExported.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    data-testid="btn-download-audio"
                    className="inline-flex items-center justify-center gap-2 h-10 w-full rounded-lg bg-primary text-black text-sm font-black hover:bg-primary/90 transition-colors"
                  >
                    <Download className="h-4 w-4" /> Download Audio
                  </a>
                </div>
              )}

              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
                <Info className="h-3.5 w-3.5 text-white/40 shrink-0 mt-0.5" />
                <p className="text-[11px] text-white/50 leading-relaxed">
                  Renders your stems with your Mastering settings — compression, EQ, bass boost, stereo width, loudness target, and fades.
                </p>
              </div>
            </div>
          </EditorCard>

          {ms.exports.length > 0 && (
            <EditorCard title="Previous Exports" subtitle="Saved with this project" icon={<ListMusic className="h-4 w-4" />}>
              <div className="space-y-2">
                {ms.exports.map((ex) => (
                  <div
                    key={ex.id}
                    className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"
                    data-testid={`export-record-${ex.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white/85 truncate">{ex.label}</p>
                      <p className="text-[10px] text-white/40">
                        {ex.format.toUpperCase()} · {ex.stemsUsed.length} stem{ex.stemsUsed.length === 1 ? "" : "s"} · {new Date(ex.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <a
                      href={ex.url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-white/12 bg-white/[0.03] text-[11px] font-bold text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </a>
                  </div>
                ))}
              </div>
            </EditorCard>
          )}

          <EditorCard title="Planned Deliverables" subtitle="Tag formats to revisit later — saved with this project" icon={<Download className="h-4 w-4" />}>
            <div className="flex flex-wrap gap-2">
              {AUDIO_EXPORT_FORMATS.map((fmt) => (
                <Chip key={fmt} active={ms.exportSelections.includes(fmt)} onClick={() => toggleExport(fmt)}>{fmt}</Chip>
              ))}
            </div>
          </EditorCard>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          onClick={handleSave}
          className="flex-1 min-w-[140px] h-11 text-sm font-black bg-primary text-black hover:bg-primary/90"
          data-testid="btn-save-mix"
        >
          <Save className="h-4 w-4 mr-2" /> Save Mix Settings
        </Button>
        <Button
          onClick={handleUseForVideo}
          variant="outline"
          className={`flex-1 min-w-[140px] h-11 text-sm font-bold border-white/12 bg-white/[0.03] hover:bg-white/[0.06] ${
            usingMixForVideo ? "text-primary border-primary/40" : "text-white/75 hover:text-white"
          }`}
          data-testid="btn-use-mix-for-video"
        >
          <Clapperboard className="h-4 w-4 mr-2" /> {usingMixForVideo ? "Mix Set For Video ✓" : "Use This Mix For Video"}
        </Button>
      </div>
    </div>
  );
}
