import { useMemo, useRef, useState } from "react";
import { Volume2, Download, Music2, AlertCircle, Radio, Mic2, Drum, VolumeX, Upload, X, Loader2, ImageIcon, Subtitles, Eye, Flame } from "lucide-react";
import { FinalVideoExport } from "@/components/FinalVideoExport";
import type { SceneData } from "@/lib/scene-parser";
import {
  VIDEO_FORMATS,
  type EditorSettings,
  type VideoFormat,
  type ExportResolution,
  type VideoAudioSource,
  type AudioExportRecord,
  type CaptionExportMode,
} from "@/lib/editor-settings";
import { EditorCard, Field, Chip, Segmented } from "@/components/editor/controls";
import { useAuth } from "@/contexts/AuthContext";

interface ExportSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  projectId: string;
  audioUrl: string | null;
  onGoToMusicStudio?: () => void;
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
  scenes, settings, setSettings, projectId, audioUrl, onGoToMusicStudio,
}: ExportSectionProps) {
  const ms = settings.musicStudio;
  const va = ms.videoAudio;
  const { getAccessToken } = useAuth();

  const [wmUploading, setWmUploading] = useState(false);
  const [wmError, setWmError] = useState<string | null>(null);
  const wmInputRef = useRef<HTMLInputElement>(null);

  function setVideoAudio(patch: Partial<typeof va>) {
    setSettings({ ...settings, musicStudio: { ...ms, videoAudio: { ...va, ...patch } } });
  }
  function setExport(patch: Partial<typeof settings.export>) {
    setSettings({ ...settings, export: { ...settings.export, ...patch } });
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

  const selectedOption = AUDIO_SOURCE_OPTIONS.find((o) => o.value === va.source)!;
  const isAvailable = isSourceAvailable(va.source, audioUrl, ms.exports);

  const audioSourceLabel = selectedOption?.label ?? "";
  const aspectRatio = settings.export.format;

  return (
    <div className="space-y-5">

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
                  {va.source === "uploaded"
                    ? "No song was uploaded to this project."
                    : `No ${selectedOption?.label.toLowerCase() ?? "export"} found. Go to Music Studio to export audio first.`}
                  {va.source !== "uploaded" && onGoToMusicStudio && (
                    <>
                      {" "}
                      <button
                        type="button"
                        onClick={onGoToMusicStudio}
                        className="underline text-amber-300 hover:text-amber-200 transition-colors"
                      >
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
    comingSoon: true,
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
          <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-300">Burned-in caption export coming soon</p>
              <p className="text-xs text-amber-200/60 mt-0.5 leading-relaxed">
                This setting is saved and will take effect when the feature is fully connected.
                Your current export will include captions as overlay data sent to the rendering pipeline.
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
