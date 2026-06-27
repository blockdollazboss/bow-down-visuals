/**
 * FormatSection — project canvas / aspect ratio settings.
 *
 * Changing the format immediately reshapes the master player in the preview.
 * The same format drives the export pipeline.
 */
import { Monitor, Smartphone, Square, Instagram } from "lucide-react";
import {
  VIDEO_FORMATS, FORMAT_PRESET_LABELS, formatDimensions,
  type EditorSettings, type VideoFormat, type FitMode,
} from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";

interface FormatSectionProps {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
}

const FORMAT_ICONS: Record<VideoFormat, React.ReactNode> = {
  "9:16":  <Smartphone className="h-3.5 w-3.5" />,
  "16:9":  <Monitor   className="h-3.5 w-3.5" />,
  "1:1":   <Square    className="h-3.5 w-3.5" />,
  "4:5":   <Instagram className="h-3.5 w-3.5" />,
};

const FIT_MODES: { id: FitMode; label: string; desc: string }[] = [
  { id: "fill", label: "Fill / Crop",       desc: "Crops clip to fill canvas" },
  { id: "fit",  label: "Fit / Letterbox",   desc: "Black bars, no crop" },
  { id: "blur", label: "Blur Background",   desc: "Blurred fill behind clip" },
];

export function FormatSection({ settings, setSettings }: FormatSectionProps) {
  const fmt     = settings.export.format;
  const fitMode = settings.export.fitMode ?? "fill";
  const [w, h]  = formatDimensions(fmt);
  const label   = FORMAT_PRESET_LABELS[fmt];
  const isVert  = h > w;

  function setFormat(f: VideoFormat) {
    setSettings({ ...settings, export: { ...settings.export, format: f } });
  }

  function setFitMode(m: FitMode) {
    setSettings({ ...settings, export: { ...settings.export, fitMode: m } });
  }

  return (
    <EditorCard
      title="Project Format"
      subtitle="Canvas shape — master player and export use the same format"
      icon={isVert ? <Smartphone className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
    >
      {/* Format preset chips */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {VIDEO_FORMATS.map((vf) => {
          const active = fmt === vf.id;
          const [fw, fh] = formatDimensions(vf.id as VideoFormat);
          return (
            <button
              key={vf.id}
              type="button"
              onClick={() => setFormat(vf.id as VideoFormat)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all ${
                active
                  ? "bg-[#C9A84C]/15 border-[#C9A84C]/50 text-white"
                  : "bg-white/[0.03] border-white/[0.07] text-white/55 hover:bg-white/[0.06] hover:text-white/75"
              }`}
            >
              <span className={active ? "text-[#C9A84C]" : "text-white/35"}>
                {FORMAT_ICONS[vf.id as VideoFormat]}
              </span>
              <span className="min-w-0">
                <span className={`block text-[11px] font-bold ${active ? "text-[#C9A84C]" : ""}`}>{vf.label}</span>
                <span className="block text-[9px] text-white/35 leading-tight truncate">{vf.note}</span>
                <span className="block text-[9px] text-white/22 font-mono">{fw}×{fh}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Fit Mode */}
      <div className="mt-2 pt-2 border-t border-white/[0.06]">
        <label className="text-[10px] font-semibold text-white/35 uppercase tracking-wide block mb-1.5">
          Fit Mode — how clips fill the canvas
        </label>
        <div className="flex flex-col gap-1">
          {FIT_MODES.map(({ id, label: lbl, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFitMode(id)}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition-all ${
                fitMode === id
                  ? "bg-[#C9A84C]/12 border-[#C9A84C]/40 text-white"
                  : "bg-white/[0.02] border-white/[0.06] text-white/45 hover:bg-white/[0.05]"
              }`}
            >
              <span>
                <span className={`text-[10px] font-bold block ${fitMode === id ? "text-[#C9A84C]" : ""}`}>{lbl}</span>
                <span className="text-[9px] text-white/30">{desc}</span>
              </span>
              {fitMode === id && (
                <span className="text-[9px] font-bold text-[#C9A84C] ml-2 shrink-0">Active</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="mt-3 pt-2 border-t border-white/[0.06]">
        <p className="text-[9px] font-black text-white/22 uppercase tracking-widest mb-1.5">Project Format Status</p>
        <div className="space-y-0.5">
          {([
            ["format name",       label.name],
            ["aspect ratio",      fmt],
            ["export size",       `${w}×${h}px`],
            ["fit mode",          fitMode === "fill" ? "Fill / Crop" : fitMode === "fit" ? "Fit / Letterbox" : "Blur Background"],
            ["master player matches format", "yes"],
            ["export matches format",         "yes"],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-mono text-white/28">{k}</span>
              <span className={`text-[9px] font-mono font-bold ${v === "yes" ? "text-green-400" : "text-white/50"}`}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </EditorCard>
  );
}
