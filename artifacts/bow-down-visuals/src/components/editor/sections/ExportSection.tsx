import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, Download, Music2, AlertCircle, Radio, Mic2, Drum, VolumeX, Upload, X, Loader2, ImageIcon, Subtitles, Eye, Flame, Scissors, Crosshair } from "lucide-react";
import { FinalVideoExport } from "@/components/FinalVideoExport";
import type { SceneData } from "@/lib/scene-parser";
import {
  VIDEO_FORMATS,
  getClipEdit,
  type EditorSettings,
  type VideoFormat,
  type ExportResolution,
  type VideoAudioSource,
  type AudioExportRecord,
  type CaptionExportMode,
  type ExportRangeMode,
} from "@/lib/editor-settings";
import { EditorCard, Field, Chip, Segmented } from "@/components/editor/controls";
import { useAuth } from "@/contexts/AuthContext";

interface ExportSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  projectId: string;
  /** Effective audio URL (project input_data OR first stem fallback). */
  audioUrl: string | null;
  /** Raw project.input_data.audioUrl — for debug only. */
  rawProjectAudioUrl?: string | null;
  /** The exact URL currently playing in the master player. */
  masterAudioUrl?: string | null;
  onGoToMusicStudio?: () => void;
  /** Jump to the Effects tab to open Auto AI Edit. */
  onGoToEffects?: () => void;
  /** Master player current playhead time, for "Set From Playhead". */
  masterCurrentTimeSec?: number;
  /** Total project duration in seconds (from audio). */
  projectDurationSec?: number;
}

/* ── Export range helpers ──────────────────────────────── */

function fmtTimecode(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const mm  = Math.floor(sec / 60);
  const ss  = Math.floor(sec % 60);
  const mmm = Math.round((sec % 1) * 1000);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}

function parseSec(value: string): number {
  const trimmed = value.trim();
  // MM:SS.mmm or MM:SS or plain seconds
  const colonMatch = trimmed.match(/^(\d+):(\d+)(?:\.(\d+))?$/);
  if (colonMatch) {
    const m = parseInt(colonMatch[1]!);
    const s = parseInt(colonMatch[2]!);
    const ms = colonMatch[3] ? parseInt(colonMatch[3]!.slice(0, 3).padEnd(3, "0")) : 0;
    return m * 60 + s + ms / 1000;
  }
  const n = parseFloat(trimmed);
  return isFinite(n) ? n : 0;
}

function resolveRange(
  mode: ExportRangeMode,
  customStart: number,
  customEnd: number,
  projectDur: number,
): { startSec: number; endSec: number } {
  switch (mode) {
    case "full":     return { startSec: 0, endSec: projectDur };
    case "first-10": return { startSec: 0, endSec: Math.min(10, projectDur || 10) };
    case "first-15": return { startSec: 0, endSec: Math.min(15, projectDur || 15) };
    case "first-30": return { startSec: 0, endSec: Math.min(30, projectDur || 30) };
    case "custom":   return { startSec: customStart, endSec: customEnd };
  }
}

/* ── Two-thumb range slider ────────────────────────────── */
function RangeSlider({
  min, max, start, end, onStartChange, onEndChange,
}: {
  min: number; max: number; start: number; end: number;
  onStartChange: (v: number) => void; onEndChange: (v: number) => void;
}) {
  const trackRef  = useRef<HTMLDivElement>(null);
  const dragging  = useRef<"start" | "end" | null>(null);
  const range     = Math.max(max - min, 0.01);
  const startPct  = Math.max(0, Math.min(100, ((start - min) / range) * 100));
  const endPct    = Math.max(0, Math.min(100, ((end - min) / range) * 100));

  function valFromX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return min;
    return min + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * range;
  }

  function onPointerDown(e: React.PointerEvent) {
    const v  = valFromX(e.clientX);
    const dS = Math.abs(v - start);
    const dE = Math.abs(v - end);
    dragging.current = dS <= dE ? "start" : "end";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const v = valFromX(e.clientX);
    if (dragging.current === "start") onStartChange(Math.max(min, Math.min(v, end - 0.5)));
    else                              onEndChange(Math.max(start + 0.5, Math.min(v, max)));
  }
  function onPointerUp() { dragging.current = null; }

  return (
    <div
      ref={trackRef}
      role="presentation"
      className="relative h-7 flex items-center select-none touch-none cursor-pointer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className="absolute inset-x-2 h-1.5 rounded-full bg-white/10" />
      <div
        className="absolute h-1.5 rounded-full bg-primary/70"
        style={{ left: `calc(${startPct}% + 0.5rem / 2 * (1 - ${startPct}/50))`, width: `${endPct - startPct}%` }}
      />
      {/* start thumb */}
      <div
        className="absolute w-4 h-4 rounded-full bg-primary border-2 border-white/70 shadow-lg -translate-x-1/2 hover:scale-110 transition-transform"
        style={{ left: `${startPct}%` }}
      />
      {/* end thumb */}
      <div
        className="absolute w-4 h-4 rounded-full bg-primary border-2 border-white/70 shadow-lg -translate-x-1/2 hover:scale-110 transition-transform"
        style={{ left: `${endPct}%` }}
      />
    </div>
  );
}

/* ── Audio source option definitions ───────────────────── */
interface AudioSourceOption {
  value: VideoAudioSource;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const AUDIO_SOURCE_OPTIONS: AudioSourceOption[] = [
  {
    value: "uploaded",
    label: "Uploaded Original Song",
    description: "The song uploaded to this project",
    icon: <Radio className="h-3.5 w-3.5" />,
  },
  {
    value: "full-mix",
    label: "Exported Full Mix",
    description: "Your exported stems mix (MP3/WAV)",
    icon: <Music2 className="h-3.5 w-3.5" />,
  },
  {
    value: "instrumental",
    label: "Exported Instrumental",
    description: "Beat-only stem mix, no vocals",
    icon: <Drum className="h-3.5 w-3.5" />,
  },
  {
    value: "acapella",
    label: "Exported Acapella",
    description: "Vocals only, no beat",
    icon: <Mic2 className="h-3.5 w-3.5" />,
  },
  {
    value: "none",
    label: "No Audio",
    description: "Video only, silent",
    icon: <VolumeX className="h-3.5 w-3.5" />,
  },
];

const RESOLUTION_OPTIONS: { value: ExportResolution; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
];

/* ── Resolve audio URL from source + exports ──────────── */
function resolveAudioUrl(
  source: VideoAudioSource,
  uploadedUrl: string | null,
  exports: AudioExportRecord[],
): string | null {
  switch (source) {
    case "uploaded": return uploadedUrl;
    case "none": return null;
    case "full-mix": {
      const mp3 = exports.find((r) => r.kind === "full" && r.format === "mp3");
      return mp3?.url ?? exports.find((r) => r.kind === "full")?.url ?? null;
    }
    case "instrumental":
      return exports.find((r) => r.kind === "instrumental")?.url ?? null;
    case "acapella":
      return exports.find((r) => r.kind === "acapella")?.url ?? null;
  }
}

/* ── Check availability per source ──────────────────────  */
function isSourceAvailable(
  source: VideoAudioSource,
  uploadedUrl: string | null,
  exports: AudioExportRecord[],
): boolean {
  switch (source) {
    case "none": return true;
    case "uploaded": return !!uploadedUrl;
    case "full-mix": return exports.some((r) => r.kind === "full");
    case "instrumental": return exports.some((r) => r.kind === "instrumental");
    case "acapella": return exports.some((r) => r.kind === "acapella");
  }
}

/* ── Component ─────────────────────────────────────────── */
export function ExportSection({
  scenes, settings, setSettings, projectId, audioUrl, rawProjectAudioUrl, masterAudioUrl, onGoToMusicStudio, onGoToEffects,
  masterCurrentTimeSec = 0, projectDurationSec = 0,
}: ExportSectionProps) {
  const ms = settings.musicStudio;
  const va = ms.videoAudio;
  const { getAccessToken } = useAuth();

  const [wmUploading, setWmUploading] = useState(false);
  const [wmError, setWmError] = useState<string | null>(null);
  const wmInputRef = useRef<HTMLInputElement>(null);

  /* ── Audio reachability probe ── */
  const [audioReachable,  setAudioReachable ] = useState<boolean | null>(null);
  const [audioReachError, setAudioReachError] = useState<string | null>(null);
  const [audioChecking,   setAudioChecking  ] = useState(false);

  function setVideoAudio(patch: Partial<typeof va>) {
    setSettings({ ...settings, musicStudio: { ...ms, videoAudio: { ...va, ...patch } } });
  }
  function setExport(patch: Partial<typeof settings.export>) {
    setSettings({ ...settings, export: { ...settings.export, ...patch } });
  }
  function setExportRange(patch: Partial<typeof settings.export.exportRange>) {
    setExport({ exportRange: { ...settings.export.exportRange, ...patch } });
  }

  async function handleWatermarkFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setWmError("Please choose a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setWmError("Image must be under 5 MB.");
      return;
    }
    setWmUploading(true);
    setWmError(null);
    try {
      const token = await getAccessToken();
      const buf = await file.arrayBuffer();
      const res = await fetch("/api/upload-watermark", {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: buf,
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Upload failed (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      setExport({ customWatermarkUrl: url });
    } catch (err) {
      setWmError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setWmUploading(false);
    }
  }

  const resolvedAudioUrl = useMemo(
    () => resolveAudioUrl(va.source, audioUrl, ms.exports),
    [va.source, audioUrl, ms.exports],
  );

  /* Probe resolved URL whenever it changes */
  useEffect(() => {
    if (!resolvedAudioUrl) {
      setAudioReachable(false);
      setAudioReachError(audioUrl === null ? "no project.video_audio_url found" : "audio URL could not be resolved for selected source");
      return;
    }
    let cancelled = false;
    setAudioChecking(true);
    setAudioReachable(null);
    setAudioReachError(null);
    fetch(resolvedAudioUrl, { method: "HEAD" })
      .then((r) => {
        if (!cancelled) {
          setAudioReachable(r.ok);
          if (!r.ok) setAudioReachError(`HTTP ${r.status} — audio file may have moved or expired`);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setAudioReachable(false);
          setAudioReachError(e instanceof Error ? e.message : "fetch failed");
        }
      })
      .finally(() => { if (!cancelled) setAudioChecking(false); });
    return () => { cancelled = true; };
  }, [resolvedAudioUrl, audioUrl]);

  const selectedOption = AUDIO_SOURCE_OPTIONS.find((o) => o.value === va.source)!;
  const isAvailable = isSourceAvailable(va.source, audioUrl, ms.exports);

  const audioSourceLabel = selectedOption?.label ?? "";
  const aspectRatio = settings.export.format;

  /* ── Export range ── */
  const exportRange = settings.export.exportRange ?? { mode: "full" as ExportRangeMode, customStartSec: 0, customEndSec: 30 };
  const rangeMode = exportRange.mode;

  // Local input state for custom start/end (string so user can type freely)
  const [customStartInput, setCustomStartInput] = useState(() => fmtTimecode(exportRange.customStartSec));
  const [customEndInput,   setCustomEndInput  ] = useState(() => fmtTimecode(exportRange.customEndSec));

  const projectDur = projectDurationSec > 0 ? projectDurationSec : 60;
  const resolved   = resolveRange(rangeMode, exportRange.customStartSec, exportRange.customEndSec, projectDur);

  // Validation
  const startValid = resolved.startSec >= 0;
  const endValid   = resolved.endSec > resolved.startSec && resolved.endSec <= projectDur + 0.5;
  const rangeValid = startValid && endValid;

  const exportDuration = Math.max(0, resolved.endSec - resolved.startSec);
  const isFullExport   = rangeMode === "full";

  const RANGE_MODE_OPTIONS: { value: ExportRangeMode; label: string }[] = [
    { value: "full",     label: "Full Video"    },
    { value: "first-10", label: "First 10 s"   },
    { value: "first-15", label: "First 15 s"   },
    { value: "first-30", label: "First 30 s"   },
    { value: "custom",   label: "Custom Range"  },
  ];

  return (
    <div className="space-y-5">

      {/* ── AI Edit shortcut ── */}
      {onGoToEffects && (
        <button
          onClick={onGoToEffects}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors text-left group"
        >
          <span className="h-7 w-7 rounded-lg bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
            <Download className="h-3.5 w-3.5 text-primary rotate-180" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black text-white group-hover:text-primary transition-colors">
              Auto AI Edit Whole Video {settings.aiEdit?.applied ? "✓ Applied" : "→ Effects Tab"}
            </p>
            <p className="text-[10px] text-white/35 mt-0.5">
              {settings.aiEdit?.applied
                ? `AI edit is active — style: ${settings.aiEdit.style}`
                : "Let AI plan transitions, effects, color grade & caption style before export"}
            </p>
          </div>
        </button>
      )}

      {/* ── Audio Source ── */}
      <EditorCard
        title="Audio Source"
        subtitle="Which audio plays under the final video"
        icon={<Volume2 className="h-4 w-4" />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2">
            {AUDIO_SOURCE_OPTIONS.map((opt) => {
              const avail = isSourceAvailable(opt.value, audioUrl, ms.exports);
              const active = va.source === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVideoAudio({ source: opt.value })}
                  data-testid={`audio-source-${opt.value}`}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/10"
                      : avail
                      ? "border-white/10 bg-white/[0.03] hover:border-white/20"
                      : "border-white/[0.06] bg-white/[0.02] opacity-60 hover:border-white/12"
                  }`}
                >
                  <span className={`shrink-0 ${active ? "text-primary" : avail ? "text-white/50" : "text-white/25"}`}>
                    {opt.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`text-sm font-bold block ${active ? "text-primary" : "text-white/80"}`}>
                      {opt.label}
                    </span>
                    <span className="text-[11px] text-white/35 block">{opt.description}</span>
                  </span>
                  {avail ? (
                    <span className="text-[10px] font-bold text-green-400/70 shrink-0">Available</span>
                  ) : opt.value !== "none" ? (
                    <span className="text-[10px] font-bold text-white/25 shrink-0">Not exported</span>
                  ) : null}
                  {active && (
                    <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Not available warning */}
          {!isAvailable && va.source !== "none" && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-300">Audio source not available</p>
                <p className="text-xs text-amber-200/60 mt-0.5 leading-relaxed">
                  {va.source === "uploaded" && !rawProjectAudioUrl && !audioUrl
                    ? "No audio saved to this project yet — no project.video_audio_url found."
                    : va.source === "uploaded"
                    ? "Audio URL found but could not be resolved. Check Export Audio Debug below."
                    : `No ${selectedOption?.label.toLowerCase() ?? "export"} found. Go to Music Studio to export audio first.`}
                  {va.source !== "uploaded" && onGoToMusicStudio && (
                    <>
                      {" "}
                      <button type="button" onClick={onGoToMusicStudio} className="underline text-amber-300 hover:text-amber-200 transition-colors">
                        Open Music Studio →
                      </button>
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </EditorCard>

      {/* ── Audio Options ── */}
      {va.source !== "none" && (
        <EditorCard
          title="Audio Options"
          subtitle="Fade and loop settings for the selected audio"
          icon={<Music2 className="h-4 w-4" />}
        >
          <div className="flex flex-wrap gap-2">
            <Chip
              active={va.fadeIn}
              onClick={() => setVideoAudio({ fadeIn: !va.fadeIn })}
            >
              Fade audio in
            </Chip>
            <Chip
              active={va.fadeOut}
              onClick={() => setVideoAudio({ fadeOut: !va.fadeOut })}
            >
              Fade audio out
            </Chip>
            <Chip
              active={va.loopAudio}
              onClick={() => setVideoAudio({ loopAudio: !va.loopAudio })}
            >
              Loop if shorter than video
            </Chip>
          </div>
          {va.loopAudio && (
            <p className="text-[11px] text-white/30 mt-2 leading-relaxed">
              If the audio is shorter than the video, it will repeat seamlessly until the video ends.
            </p>
          )}
          {!va.loopAudio && (
            <p className="text-[11px] text-white/30 mt-2 leading-relaxed">
              If audio is shorter than the video, it ends naturally — the video continues silently.
            </p>
          )}
        </EditorCard>
      )}

      {/* ── Export Format ── */}
      <EditorCard
        title="Export Format"
        subtitle="Aspect ratio and resolution"
        icon={<Download className="h-4 w-4" />}
      >
        <div className="space-y-5">
          <Field label="Aspect ratio">
            <div className="grid grid-cols-3 gap-2">
              {VIDEO_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setExport({ format: f.id as VideoFormat })}
                  data-testid={`export-format-${f.id}`}
                  className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl border text-sm font-black transition-colors ${
                    settings.export.format === f.id
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20"
                  }`}
                >
                  <AspectRatioIcon ratio={f.id as VideoFormat} active={settings.export.format === f.id} />
                  <span>{f.label}</span>
                  <span className="text-[9px] font-normal opacity-60 text-center leading-tight">{f.note}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Resolution">
            <Segmented
              value={settings.export.resolution}
              options={RESOLUTION_OPTIONS}
              onChange={(v) => setExport({ resolution: v })}
            />
          </Field>
        </div>
      </EditorCard>

      {/* ── Export Options ── */}
      <EditorCard
        title="Watermark"
        subtitle="Burned into the bottom-right corner of the exported video"
        icon={<ImageIcon className="h-4 w-4" />}
      >
        <div className="space-y-4">
          {/* Toggle */}
          <Chip
            active={settings.export.watermark}
            onClick={() => setExport({ watermark: !settings.export.watermark })}
          >
            Add watermark to video
          </Chip>

          {settings.export.watermark && (
            <div className="space-y-3">
              {/* Custom watermark preview or BDV default */}
              {settings.export.customWatermarkUrl ? (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/20 bg-primary/5">
                  <img
                    src={settings.export.customWatermarkUrl}
                    alt="Custom watermark"
                    className="h-10 w-auto max-w-[120px] object-contain rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white/80">Your custom watermark</p>
                    <p className="text-[11px] text-white/35 mt-0.5">Will appear bottom-right on the video</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExport({ customWatermarkUrl: null });
                      if (wmInputRef.current) wmInputRef.current.value = "";
                    }}
                    className="shrink-0 p-1 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
                    title="Remove custom watermark"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/[0.03]">
                  <img
                    src={`${import.meta.env.BASE_URL}bdv-watermark.png`}
                    alt="Bow Down Visuals watermark"
                    className="h-10 w-auto max-w-[120px] object-contain"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white/80">Bow Down Visuals logo</p>
                    <p className="text-[11px] text-white/35 mt-0.5">Default — used automatically</p>
                  </div>
                </div>
              )}

              {/* Upload custom */}
              <div>
                <input
                  ref={wmInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleWatermarkFile(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => wmInputRef.current?.click()}
                  disabled={wmUploading}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06] text-xs text-white/50 hover:text-white/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full"
                >
                  {wmUploading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    : <Upload className="h-3.5 w-3.5 shrink-0" />}
                  <span>{wmUploading ? "Uploading…" : settings.export.customWatermarkUrl ? "Replace with a different image" : "Upload your own logo / watermark"}</span>
                  <span className="ml-auto text-[10px] text-white/25">PNG · JPG · WebP · max 5 MB</span>
                </button>
                {wmError && (
                  <p className="text-[11px] text-red-400 mt-1.5">{wmError}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </EditorCard>

      {/* ── Caption Export ── */}
      <CaptionExportCard
        mode={(settings.export.captionExportMode as CaptionExportMode) ?? "burn"}
        hasCaptions={settings.captions.enabled && settings.captions.lines.length > 0}
        onChange={(m) => setExport({ captionExportMode: m })}
      />

      {/* ── Export Audio Debug ── */}
      <EditorCard title="Export Audio Debug" subtitle="Live diagnostic — shows the same audio the master player uses">
        <div className="space-y-1">
          {([
            ["project audio URL found",      !!rawProjectAudioUrl,               rawProjectAudioUrl ? "yes ✓" : "no — no project.video_audio_url saved"],
            ["master player audio URL found", !!masterAudioUrl,                  masterAudioUrl ? "yes ✓" : "no"],
            ["export audio URL found",        !!resolvedAudioUrl,                resolvedAudioUrl ? "yes ✓" : "no"],
            ["audio selected",               !!resolvedAudioUrl && va.source !== "none", resolvedAudioUrl && va.source !== "none" ? "yes ✓" : "no"],
            ["audio source",                 true,                               va.source],
            ["audio name / stem count",      true,                               rawProjectAudioUrl ? "uploaded song" : ms.stems.length > 0 ? `${ms.stems.length} stem(s) — using first` : "none"],
            ["audio duration",               true,                               "—"],
            ["audio file reachable",         audioReachable === true,            audioChecking ? "checking…" : audioReachable === true ? "yes ✓" : audioReachable === false ? "no ✗" : "—"],
            ["last audio error",             false,                              audioReachError ?? "none"],
            ["using master/project audio",   !!resolvedAudioUrl,                 resolvedAudioUrl ? "yes ✓" : "no"],
          ] as [string, boolean, string][]).map(([label, ok, value]) => (
            <div key={label} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-white/30 font-mono">{label}:</span>
              <span className={`font-semibold font-mono ${ok ? "text-green-400/70" : value.startsWith("no") || value.endsWith("✗") ? "text-amber-400/70" : "text-white/45"}`}>
                {value}
              </span>
            </div>
          ))}
          {!resolvedAudioUrl && (
            <p className="text-[11px] text-amber-400/70 pt-1 border-t border-white/[0.06] leading-relaxed">
              {!rawProjectAudioUrl && ms.stems.length === 0
                ? "No audio saved to project. Upload your song in the Music tab, then return here."
                : !rawProjectAudioUrl && ms.stems.length > 0
                ? "Audio found in stems — select 'Uploaded Original Song' above to use it."
                : "Audio URL found but source type does not resolve. Try selecting 'Uploaded Original Song'."}
            </p>
          )}
        </div>
      </EditorCard>

      {/* ── Export Range ── */}
      <EditorCard
        title="Export Range"
        subtitle="Choose which part of the video to export"
        icon={<Scissors className="h-4 w-4" />}
      >
        <div className="space-y-4">
          {/* Mode selector */}
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {RANGE_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setExportRange({ mode: opt.value })}
                className={`px-3 py-2 rounded-lg border text-xs font-bold transition-colors ${
                  rangeMode === opt.value
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom start / end inputs */}
          {rangeMode === "custom" && (
            <div className="space-y-3">
              {/* Start time */}
              <div className="space-y-1">
                <label className="text-[11px] text-white/40 font-semibold uppercase tracking-widest">Start time</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customStartInput}
                    onChange={(e) => setCustomStartInput(e.target.value)}
                    onBlur={() => {
                      const v = Math.max(0, parseSec(customStartInput));
                      setExportRange({ customStartSec: v });
                      setCustomStartInput(fmtTimecode(v));
                    }}
                    placeholder="00:00.000"
                    className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-white/80 focus:outline-none focus:border-primary/40 focus:bg-white/[0.07]"
                  />
                  <button
                    type="button"
                    title="Set start from playhead"
                    onClick={() => {
                      const v = Math.max(0, masterCurrentTimeSec);
                      setExportRange({ customStartSec: v });
                      setCustomStartInput(fmtTimecode(v));
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary text-[10px] font-bold transition-colors shrink-0"
                  >
                    <Crosshair className="h-3 w-3" /> Set From Playhead
                  </button>
                </div>
              </div>

              {/* End time */}
              <div className="space-y-1">
                <label className="text-[11px] text-white/40 font-semibold uppercase tracking-widest">End time</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customEndInput}
                    onChange={(e) => setCustomEndInput(e.target.value)}
                    onBlur={() => {
                      const v = Math.max(0, parseSec(customEndInput));
                      setExportRange({ customEndSec: v });
                      setCustomEndInput(fmtTimecode(v));
                    }}
                    placeholder="00:10.000"
                    className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-xs font-mono text-white/80 focus:outline-none focus:border-primary/40 focus:bg-white/[0.07]"
                  />
                  <button
                    type="button"
                    title="Set end from playhead"
                    onClick={() => {
                      const v = Math.max(0, masterCurrentTimeSec);
                      setExportRange({ customEndSec: v });
                      setCustomEndInput(fmtTimecode(v));
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary text-[10px] font-bold transition-colors shrink-0"
                  >
                    <Crosshair className="h-3 w-3" /> Set From Playhead
                  </button>
                </div>
              </div>

              {/* Validation errors */}
              {!startValid && (
                <p className="text-[11px] text-red-400">Start time cannot be below zero.</p>
              )}
              {resolved.endSec <= resolved.startSec && startValid && (
                <p className="text-[11px] text-red-400">End time must be after start time.</p>
              )}
              {resolved.endSec > projectDur + 0.5 && (
                <p className="text-[11px] text-amber-400">End time exceeds project duration ({fmtTimecode(projectDur)}). It will be clamped.</p>
              )}
            </div>
          )}

          {/* Range slider (shows when not full) */}
          {rangeMode !== "full" && projectDur > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-mono text-white/25">
                <span>{fmtTimecode(0)}</span>
                <span>{fmtTimecode(projectDur)}</span>
              </div>
              <RangeSlider
                min={0}
                max={projectDur}
                start={resolved.startSec}
                end={Math.min(resolved.endSec, projectDur)}
                onStartChange={(v) => {
                  setExportRange({ mode: "custom", customStartSec: Math.round(v * 1000) / 1000 });
                  setCustomStartInput(fmtTimecode(v));
                }}
                onEndChange={(v) => {
                  setExportRange({ mode: "custom", customEndSec: Math.round(v * 1000) / 1000 });
                  setCustomEndInput(fmtTimecode(v));
                }}
              />
            </div>
          )}

          {/* Time info */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {[
              ["Project duration", fmtTimecode(projectDur)],
              ["Export duration",  fmtTimecode(exportDuration)],
              ["Selected start",   fmtTimecode(resolved.startSec)],
              ["Selected end",     fmtTimecode(Math.min(resolved.endSec, projectDur))],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] text-white/30">{label}</p>
                <p className="text-xs font-mono font-bold text-white/70 mt-0.5">{value}</p>
              </div>
            ))}
          </div>

          {/* Range status debug */}
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-white/[0.06] bg-white/[0.03]">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">Export Range Status</p>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {([
                ["export range mode",         null,          rangeMode],
                ["start time",               startValid,     fmtTimecode(resolved.startSec)],
                ["end time",                 endValid,       fmtTimecode(resolved.endSec)],
                ["selected duration",         exportDuration > 0, `${exportDuration.toFixed(2)}s`],
                ["range sent to renderer",   !isFullExport && rangeValid, !isFullExport && rangeValid ? "yes ✓" : isFullExport ? "n/a (full)" : "no (invalid range)"],
                ["renderer used selected range", !isFullExport && rangeValid, !isFullExport && rangeValid ? "yes ✓" : isFullExport ? "n/a (full)" : "pending"],
                ["validation",               rangeValid,     rangeValid ? "passed ✓" : "failed ✗"],
              ] as [string, boolean | null, string][]).map(([label, ok, value]) => (
                <div key={label} className="flex items-center justify-between px-3 py-1.5 gap-2">
                  <span className="text-[10px] text-white/40">{label}</span>
                  <span className={`text-[10px] font-mono font-bold ${
                    ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-white/50"
                  }`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </EditorCard>

      {/* ── Final Video Export ── */}
      <FinalVideoExport
        scenes={scenes}
        projectId={projectId}
        audioUrl={resolvedAudioUrl}
        audioSource={va.source}
        audioSourceLabel={audioSourceLabel}
        fadeAudioIn={va.fadeIn}
        fadeAudioOut={va.fadeOut}
        loopAudio={va.loopAudio}
        addWatermark={settings.export.watermark}
        customWatermarkUrl={settings.export.customWatermarkUrl}
        aspectRatio={aspectRatio}
        resolution={settings.export.resolution}
        captions={settings.captions}
        captionExportMode={(settings.export.captionExportMode as CaptionExportMode) ?? "burn"}
        branding={settings.branding}
        exportRangeStart={isFullExport ? null : rangeValid ? resolved.startSec : null}
        exportRangeEnd={isFullExport ? null : rangeValid ? resolved.endSec : null}
        exportRangeLabel={isFullExport ? undefined : `${fmtTimecode(resolved.startSec)} → ${fmtTimecode(Math.min(resolved.endSec, projectDur))}`}
        clipTransitions={scenes.filter((s) => !!s.demoClipUrl).map((s) => {
          const clip = getClipEdit(settings, s.id);
          if (!clip.transition || clip.transition === "Cut") return null;
          return { type: clip.transition, duration: clip.transitionDuration ?? 1.0 };
        })}
        overlayItems={settings.overlayItems}
      />
    </div>
  );
}

/* ── Caption Export Card ─────────────────────────────────── */
interface CaptionExportCardProps {
  mode: CaptionExportMode;
  hasCaptions: boolean;
  onChange: (m: CaptionExportMode) => void;
}

const CAPTION_EXPORT_OPTIONS: {
  value: CaptionExportMode;
  label: string;
  description: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}[] = [
  {
    value: "off",
    label: "Captions Off",
    description: "No captions in the exported video file",
    icon: <VolumeX className="h-3.5 w-3.5" />,
  },
  {
    value: "overlay",
    label: "Preview Overlay Only",
    description: "Captions show in the editor preview but are not added to the exported file",
    icon: <Eye className="h-3.5 w-3.5" />,
  },
  {
    value: "burn",
    label: "Burn Captions Into Video",
    description: "Captions are permanently rendered into every frame of the final video",
    icon: <Flame className="h-3.5 w-3.5" />,
  },
];

function CaptionExportCard({ mode, hasCaptions, onChange }: CaptionExportCardProps) {
  return (
    <EditorCard
      title="Caption Export"
      subtitle="How captions appear in the final exported video"
      icon={<Subtitles className="h-4 w-4" />}
    >
      <div className="space-y-3">
        {!hasCaptions && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-white/10 bg-white/[0.03] text-xs text-white/35">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-white/25" />
            No captions generated yet. Go to the Captions tab to create them.
          </div>
        )}

        <div className="grid grid-cols-1 gap-2">
          {CAPTION_EXPORT_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-colors ${
                  active
                    ? "border-primary/50 bg-primary/10"
                    : "border-white/10 bg-white/[0.03] hover:border-white/20"
                }`}
              >
                <span className={`shrink-0 ${active ? "text-primary" : "text-white/40"}`}>
                  {opt.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`text-sm font-bold block ${active ? "text-primary" : "text-white/80"}`}>
                    {opt.label}
                    {opt.comingSoon && (
                      <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-amber-400/80 border border-amber-400/30 px-1.5 py-0.5 rounded-full align-middle">
                        coming soon
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-white/35 block mt-0.5">{opt.description}</span>
                </span>
                {active && (
                  <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {mode === "burn" && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-green-500/20 bg-green-500/5">
            <AlertCircle className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-green-300">Burned-in captions connected ✓</p>
              <p className="text-xs text-green-200/60 mt-0.5 leading-relaxed">
                Your synced caption lines, style, position, and size are sent to the FFmpeg render pipeline
                and permanently burned into each video frame. See Export Caption Debug below for details.
              </p>
            </div>
          </div>
        )}

        {mode === "overlay" && (
          <p className="text-[11px] text-white/30 leading-relaxed px-1">
            Overlay captions appear in the Timeline Preview only. They are not burned into the
            exported video file. Switch to <strong className="text-white/50">Burn Captions Into Video</strong>{" "}
            to make captions permanent in the export.
          </p>
        )}

        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[10px] text-white/30 leading-relaxed">
          <Eye className="h-3 w-3 shrink-0 mt-0.5 text-white/20" />
          <span>
            Preview captions always show as HTML overlays in the Timeline tab. Use{" "}
            <strong className="text-white/45">Preview Burned-In Caption Style</strong> in the Timeline tab
            to see how burned-in captions will look on the final video.
          </span>
        </div>
      </div>
    </EditorCard>
  );
}

/* ── Small aspect ratio preview icon ───────────────────── */
function AspectRatioIcon({ ratio, active }: { ratio: VideoFormat; active: boolean }) {
  const cls = `rounded border ${active ? "border-primary/60 bg-primary/20" : "border-white/25 bg-white/5"}`;
  if (ratio === "9:16") return <div className={`${cls} w-4 h-7`} />;
  if (ratio === "16:9") return <div className={`${cls} w-7 h-4`} />;
  return <div className={`${cls} w-5 h-5`} />;
}
