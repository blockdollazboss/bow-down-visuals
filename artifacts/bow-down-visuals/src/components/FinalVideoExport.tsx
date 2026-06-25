import { useState } from "react";
import {
  Download, Film, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Clapperboard, ExternalLink, Check, Minus, Volume2, VolumeX,
  Shield, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";
import type { SceneData } from "@/lib/scene-parser";
import type { VideoAudioSource, VideoFormat, ExportResolution, CaptionSettings, BrandingSettings, CaptionExportMode, OverlayItem } from "@/lib/editor-settings";

interface ExportRecord {
  final_video_url: string;
  export_status: "completed" | "failed" | string;
  export_created_at: string;
  clips_used: number;
  audio_used: boolean;
  audio_source?: string;
  aspect_ratio?: string;
  timeline_order?: string[];
}

interface ClipCheckRow {
  sceneNumber: number;
  originalUrl: string;
  resolvedUrl: string;
  sourceType: string;
  localPath: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  ffprobeValid: boolean;
  readyForFFmpeg: boolean;
  error: string | null;
}

interface FinalVideoExportProps {
  scenes: SceneData[];
  projectId?: string | null;
  audioUrl?: string | null;
  audioSource?: VideoAudioSource;
  audioSourceLabel?: string;
  fadeAudioIn?: boolean;
  fadeAudioOut?: boolean;
  loopAudio?: boolean;
  addWatermark?: boolean;
  customWatermarkUrl?: string | null;
  aspectRatio?: VideoFormat;
  resolution?: ExportResolution;
  existingExport?: ExportRecord | null;
  onExportComplete?: (record: ExportRecord) => void;
  captions?: CaptionSettings | null;
  captionExportMode?: CaptionExportMode;
  branding?: BrandingSettings | null;
  /** When set, export only this time slice (seconds). null = full video. */
  exportRangeStart?: number | null;
  exportRangeEnd?: number | null;
  /** Human-readable label like "00:00.000 → 00:10.000" for the UI. */
  exportRangeLabel?: string;
  /** Per-clip transition overrides: index matches clipUrls, null = Cut */
  clipTransitions?: ({ type: string; duration: number } | null)[];
  /** Structured overlay items to burn in */
  overlayItems?: OverlayItem[];
}

type ExportStatus = "idle" | "exporting" | "completed" | "failed";

function parseDuration(timestamp: string): number | null {
  const m = timestamp?.match(/(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)/);
  if (!m) return null;
  const start = parseInt(m[1]!) * 60 + parseInt(m[2]!);
  const end   = parseInt(m[3]!) * 60 + parseInt(m[4]!);
  const dur   = end - start;
  return dur > 0 ? dur : null;
}

function isSelected(s: SceneData): boolean {
  if (!s.demoClipUrl || !s.demoClipUrl.startsWith("http")) return false;
  const isRunway =
    s.provider === "Runway" ||
    s.demoClipUrl.includes("dnznrvs05pmza.cloudfront.net");
  const isComplete =
    s.generationStatus === "completed" ||
    s.approved === true ||
    (!s.generationStatus && !!s.demoClipUrl);
  return isRunway && isComplete;
}

function sceneLabel(s: SceneData, i: number): string {
  const parts = [s.section, s.lyricLine].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : `Scene ${i + 1}`;
}

function audioSourceSummary(source: VideoAudioSource | undefined, label: string | undefined): string {
  if (!source || source === "none") return "No audio";
  return label ?? source;
}

export function FinalVideoExport({
  scenes,
  projectId,
  audioUrl,
  audioSource = "uploaded",
  audioSourceLabel,
  fadeAudioIn = false,
  fadeAudioOut = false,
  loopAudio = false,
  addWatermark = false,
  customWatermarkUrl,
  aspectRatio = "9:16",
  resolution = "1080p",
  existingExport,
  onExportComplete,
  captions,
  captionExportMode = "burn",
  branding,
  exportRangeStart = null,
  exportRangeEnd = null,
  exportRangeLabel,
  clipTransitions,
  overlayItems,
}: FinalVideoExportProps) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();

  const selectedScenes = scenes.filter(isSelected);
  const clipUrls = selectedScenes.map((s) => s.demoClipUrl!);
  const uniqueUrls = new Set(clipUrls);
  const hasDuplicateUrls = clipUrls.length > 1 && uniqueUrls.size < clipUrls.length;

  const [status, setStatus] = useState<ExportStatus>(
    existingExport?.export_status === "completed" ? "completed" : "idle",
  );
  const [exportUrl, setExportUrl] = useState<string | null>(
    existingExport?.final_video_url ?? null,
  );
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [errorStderr, setErrorStderr]   = useState<string[] | null>(null);
  const [errorExitCode, setErrorExitCode] = useState<number | null>(null);
  const [confirmed, setConfirmed]       = useState(false);
  const [progressStep, setProgressStep] = useState<string>("");
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [prepareState, setPrepareState]         = useState<"idle" | "running" | "done" | "failed">("idle");
  const [prepareId, setPrepareId]               = useState<string | null>(null);
  const [clipCheckResults, setClipCheckResults] = useState<ClipCheckRow[] | null>(null);
  const [prepareError, setPrepareError]         = useState<string | null>(null);
  const [prepareAllReady, setPrepareAllReady]   = useState(false);
  const [prepareReadyCount, setPrepareReadyCount] = useState(0);
  const [checkTableExpanded, setCheckTableExpanded] = useState(true);

  const anyClip = scenes.some((s) => !!s.demoClipUrl);
  if (!anyClip) return null;

  async function handlePrepare() {
    if (!projectId || selectedScenes.length === 0) return;
    setPrepareState("running");
    setPrepareId(null);
    setClipCheckResults(null);
    setPrepareError(null);
    setPrepareAllReady(false);
    setPrepareReadyCount(0);
    setCheckTableExpanded(true);
    try {
      const token = await getAccessToken();
      const clips = selectedScenes.map((s) => ({
        sceneNumber: scenes.indexOf(s) + 1,
        url: s.demoClipUrl!,
      }));
      const res = await fetch("/api/prepare-export-files", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ projectId, clips }),
        signal: AbortSignal.timeout(5 * 60 * 1000),
      });
      const data = (await res.json()) as {
        prepareId: string;
        allReady: boolean;
        totalClips: number;
        readyClips: number;
        clips: ClipCheckRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `Prepare failed (HTTP ${res.status})`);
      setPrepareId(data.prepareId);
      setClipCheckResults(data.clips);
      setPrepareAllReady(data.allReady);
      setPrepareReadyCount(data.readyClips);
      setPrepareState(data.allReady ? "done" : "failed");
    } catch (err) {
      setPrepareState("failed");
      setPrepareError(err instanceof Error ? err.message : "Prepare failed");
    }
  }

  const hasAudio = !!audioUrl && audioSource !== "none";
  const aspectLabel = aspectRatio === "9:16" ? "1080×1920 · TikTok / Reels / Shorts"
    : aspectRatio === "16:9" ? "1920×1080 · YouTube"
    : "1080×1080 · Square";

  const isRangeExport = typeof exportRangeStart === "number" && typeof exportRangeEnd === "number"
    && exportRangeEnd > exportRangeStart;

  async function handleExport() {
    if (!projectId) {
      toast({ title: "Save project first", description: "Save your project before exporting.", variant: "destructive" });
      return;
    }
    if (selectedScenes.length === 0) {
      toast({ title: "No clips ready", description: "Generate Runway clips on the scenes first.", variant: "destructive" });
      return;
    }
    if (hasDuplicateUrls) {
      toast({
        title: "Duplicate clip URLs detected",
        description: "Two or more scenes share the same clip URL. Re-generate the affected clips then export again.",
        variant: "destructive",
      });
      return;
    }

    setStatus("exporting");
    setErrorMsg(null);
    setProgressStep("Verifying clips…");

    try {
      const token = await getAccessToken();
      const timelineOrder = scenes.map((s) => s.id);

      setProgressStep(
        `Stitching ${selectedScenes.length} clip${selectedScenes.length > 1 ? "s" : ""}` +
        ` · ${aspectRatio} · ${resolution}` +
        (hasAudio ? ` · mixing audio…` : " · no audio…"),
      );

      const res = await fetch("/api/export-final-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({
          projectId,
          clipUrls,
          audioUrl: hasAudio ? audioUrl : null,
          timelineOrder,
          testMode: false,
          aspectRatio,
          fadeAudioIn: hasAudio ? fadeAudioIn : false,
          fadeAudioOut: hasAudio ? fadeAudioOut : false,
          loopAudio: hasAudio ? loopAudio : false,
          addWatermark,
          customWatermarkUrl: addWatermark ? (customWatermarkUrl ?? null) : null,
          audioSource,
          captions: captionExportMode === "burn" && captions && captions.mode !== "none" ? captions : null,
          captionExportMode,
          branding: branding ?? null,
          exportRangeStart: typeof exportRangeStart === "number" ? exportRangeStart : null,
          exportRangeEnd:   typeof exportRangeEnd   === "number" ? exportRangeEnd   : null,
          clipTransitions:  clipTransitions ?? null,
          overlayItems:     overlayItems?.length ? overlayItems : null,
          prepareId:        prepareId ?? undefined,
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });

      if (!res.ok) {
        const body = (await res.json()) as {
          error?: string;
          exportStatus?: Record<string, unknown>;
          ffmpegStderr?: string;
          stderrTail?: string[];
          ffmpegExitCode?: number;
        };
        const err = Object.assign(
          new Error(body.error ?? `Export failed (HTTP ${res.status})`),
          {
            exportStatus:   body.exportStatus,
            ffmpegStderr:   body.ffmpegStderr,
            stderrTail:     body.stderrTail,
            ffmpegExitCode: body.ffmpegExitCode,
          },
        );
        throw err;
      }

      const data = (await res.json()) as {
        url: string;
        clipCount: number;
        audioIncluded: boolean;
        audioSource?: string;
        duration?: number;
        testMode?: boolean;
        exportStatus?: Record<string, unknown>;
        debug?: { identicalClipsDetected?: boolean };
      };

      if (data.debug?.identicalClipsDetected) {
        throw new Error(
          "Server detected two or more downloaded clips with identical content. " +
          "Re-generate the affected Runway clips and try again.",
        );
      }

      setExportUrl(data.url);
      setStatus("completed");
      setProgressStep("");

      const record: ExportRecord = {
        final_video_url: data.url,
        export_status: "completed",
        export_created_at: new Date().toISOString(),
        clips_used: clipUrls.length,
        audio_used: data.audioIncluded,
        audio_source: audioSource,
        aspect_ratio: aspectRatio,
        timeline_order: timelineOrder,
      };
      onExportComplete?.(record);
      toast({
        title: "Export complete!",
        description: `${data.clipCount} clip${data.clipCount > 1 ? "s" : ""} · ${aspectRatio}${data.audioIncluded ? " · with audio" : " · video only"}.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Export failed";
      if (msg === "out_of_credits") {
        setStatus("idle");
        setProgressStep("");
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      setStatus("failed");
      setErrorMsg(msg);
      setErrorStderr((err as { stderrTail?: string[] }).stderrTail ?? null);
      setErrorExitCode((err as { ffmpegExitCode?: number }).ffmpegExitCode ?? null);
      setProgressStep("");
      toast({ title: "Export failed", description: msg.slice(0, 120), variant: "destructive" });
    }
  }

  return (
    <div
      className="rounded-2xl border border-primary/20 bg-black/40 overflow-hidden"
      data-testid="final-video-export"
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Clapperboard className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Final Video Export</h3>
          <p className="text-xs text-white/40 mt-0.5">
            {selectedScenes.length} of {scenes.length} clip{scenes.length !== 1 ? "s" : ""} selected
            {" · "}{aspectLabel}
            {hasAudio ? ` · ${audioSourceSummary(audioSource, audioSourceLabel)}` : " · no audio"}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="p-5 space-y-4">

        {/* ── Out of credits ── */}
        {outOfCredits && <OutOfCredits />}

        {/* ── Completed ── */}
        {!outOfCredits && status === "completed" && exportUrl && (
          <div className="space-y-3" data-testid="export-result">
            <video
              src={exportUrl}
              controls
              playsInline
              className="w-full rounded-xl bg-black border border-white/10"
              style={{ maxHeight: 400 }}
              data-testid="export-video-player"
            />
            <a
              href={exportUrl}
              download="music-video-export.mp4"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="gold-glow w-full gap-2" data-testid="btn-download-final-video">
                <Download className="h-4 w-4" />
                Download Final Video ({selectedScenes.length} clip{selectedScenes.length !== 1 ? "s" : ""}{hasAudio ? " + audio" : ""})
              </Button>
            </a>
            <button
              onClick={() => { setStatus("idle"); setExportUrl(null); setConfirmed(false); }}
              className="w-full text-center text-[11px] text-white/25 hover:text-white/50 transition-colors"
              data-testid="btn-export-again"
            >
              Export again with updated settings
            </button>
          </div>
        )}

        {/* ── Failed ── */}
        {status === "failed" && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0 w-full">
              <p className="text-sm font-semibold text-red-300">
                Export Failed{errorExitCode !== null ? ` (exit ${errorExitCode})` : ""}
              </p>
              {errorMsg && (
                <p className="text-xs text-red-400/80 mt-1 leading-relaxed break-words">{errorMsg}</p>
              )}
              {errorStderr && errorStderr.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[10px] text-red-400/60 cursor-pointer hover:text-red-400/80 select-none">
                    FFmpeg error details ({errorStderr.length} lines)
                  </summary>
                  <pre className="mt-1 text-[9px] text-red-300/70 bg-black/40 rounded p-2 overflow-x-auto overflow-y-auto max-h-40 whitespace-pre-wrap break-all leading-relaxed">
                    {errorStderr.join("\n")}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {/* ── Exporting ── */}
        {status === "exporting" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="export-status-exporting">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <div>
              <p className="text-sm font-bold text-white">Exporting Final Video…</p>
              <p className="text-xs text-white/40 mt-1">{progressStep || "Processing…"}</p>
              <p className="text-[11px] text-white/25 mt-2">Keep this page open · takes ~30–90 s</p>
            </div>
          </div>
        )}

        {/* ── Idle / Ready ── */}
        {(status === "idle" || status === "failed") && (
          <div className="space-y-3">

            {/* Clips panel */}
            <ClipsPanel scenes={scenes} />

            {/* Audio summary */}
            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${
              hasAudio ? "border-green-500/20 bg-green-500/[0.04]" : "border-white/[0.07] bg-white/[0.02]"
            }`}>
              {hasAudio
                ? <Volume2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                : <VolumeX className="h-3.5 w-3.5 text-white/30 shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-semibold ${hasAudio ? "text-green-300" : "text-white/40"}`}>
                  {hasAudio ? `Audio: ${audioSourceSummary(audioSource, audioSourceLabel)}` : "No audio selected"}
                </p>
                {hasAudio && (
                  <p className="text-[10px] text-white/30 mt-0.5">
                    {[
                      fadeAudioIn && "Fade in",
                      fadeAudioOut && "Fade out",
                      loopAudio && "Loop if shorter",
                    ].filter(Boolean).join(" · ") || "No audio effects"}
                  </p>
                )}
              </div>
            </div>

            {/* Caption export debug */}
            {(() => {
              const KNOWN_PRESETS = ["clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts", "minimal"];
              const captionsFound = !!(captions && captions.lines && captions.lines.length > 0);
              const captionCount = captions?.lines?.length ?? 0;
              const styleFound = KNOWN_PRESETS.includes(captions?.stylePreset ?? "");
              const burnSelected = captionExportMode === "burn";
              const captionsSent = burnSelected && captionsFound && captions?.mode !== "none";
              const firstLine = captions?.lines?.[0];
              const lastLine = captions?.lines?.[captionCount - 1];
              const rows: [string, boolean | null, string][] = [
                ["Captions found", captionsFound, captionsFound ? "yes" : "no"],
                ["Caption count", null, String(captionCount)],
                ["Caption style found", styleFound, styleFound ? `yes (${captions?.stylePreset ?? "—"})` : `no (${captions?.stylePreset ?? "—"})`],
                ["Burn captions selected", burnSelected, burnSelected ? "yes" : "no"],
                ["Captions sent to render pipeline", captionsSent, captionsSent ? "yes" : "no"],
                ["First caption start/end", null, firstLine ? `${firstLine.startSec.toFixed(2)}s – ${firstLine.endSec.toFixed(2)}s` : "—"],
                ["Last caption start/end", null, lastLine ? `${lastLine.startSec.toFixed(2)}s – ${lastLine.endSec.toFixed(2)}s` : "—"],
              ];
              return (
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/[0.06] bg-white/[0.03]">
                    <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">Export Caption Debug</p>
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {rows.map(([label, ok, val]) => (
                      <div key={label} className="flex items-center justify-between px-3 py-1.5 gap-2">
                        <span className="text-[10px] text-white/40">{label}</span>
                        <span className={`text-[10px] font-mono font-bold ${
                          ok === true ? "text-green-400" : ok === false ? "text-red-400" : "text-white/50"
                        }`}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Warnings */}
            {selectedScenes.length === 1 && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  Only 1 clip is selected. Generate Runway clips for other scenes to include them.
                </p>
              </div>
            )}

            {hasDuplicateUrls && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-red-300">Duplicate clip URLs detected</p>
                  <p className="text-xs text-red-400/80 mt-0.5 leading-relaxed">
                    Two scenes point to the same URL. Re-generate those scenes first.
                  </p>
                </div>
              </div>
            )}

            {isRangeExport && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-primary/20 bg-primary/5">
                <Minus className="h-3.5 w-3.5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-primary">Range export selected</p>
                  <p className="text-[10px] text-white/40 mt-0.5">{exportRangeLabel ?? `${exportRangeStart?.toFixed(2)}s → ${exportRangeEnd?.toFixed(2)}s`}</p>
                </div>
              </div>
            )}

            {!confirmed && !hasDuplicateUrls && selectedScenes.length > 0 && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                <AlertTriangle className="h-4 w-4 text-white/30 shrink-0 mt-0.5" />
                <p className="text-xs text-white/40 leading-relaxed">
                  Clips download fresh, normalize to {aspectLabel}, and stitch in timeline order.
                  {hasAudio ? " Audio is mixed underneath." : " No audio in this export."}
                  {isRangeExport ? " Only the selected time range will be in the output." : ""}
                  {" "}Keep the page open.
                </p>
              </div>
            )}

            {/* ── Prepare Export Files ── */}
            {!hasDuplicateUrls && selectedScenes.length > 0 && (
              <div className="space-y-3">

                {/* Prepare status summary */}
                {prepareState !== "idle" && (
                  <div className={`flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2.5 rounded-xl border text-[10px] font-mono ${
                    prepareAllReady
                      ? "border-green-500/25 bg-green-500/[0.05]"
                      : prepareState === "failed"
                      ? "border-red-500/20 bg-red-500/[0.04]"
                      : "border-white/[0.07] bg-white/[0.02]"
                  }`}>
                    <span className="text-white/40">Export files prepared:
                      <span className={`ml-1 font-bold ${prepareAllReady ? "text-green-400" : prepareState === "running" ? "text-white/50" : "text-red-400"}`}>
                        {prepareState === "running" ? "…" : prepareAllReady ? "yes" : "no"}
                      </span>
                    </span>
                    {prepareState !== "running" && clipCheckResults && (
                      <span className="text-white/40">Clips ready:
                        <span className={`ml-1 font-bold ${prepareAllReady ? "text-green-400" : "text-amber-400"}`}>
                          {prepareReadyCount}/{clipCheckResults.length}
                        </span>
                      </span>
                    )}
                    <span className="text-white/40">FFmpeg started:
                      <span className="ml-1 font-bold text-white/30">no</span>
                    </span>
                    {prepareState === "failed" && prepareError && (
                      <span className="w-full text-red-400/80 mt-0.5">{prepareError}</span>
                    )}
                  </div>
                )}

                {/* Prepare button */}
                <Button
                  onClick={handlePrepare}
                  disabled={prepareState === "running"}
                  variant="outline"
                  className={`w-full gap-2 ${
                    prepareAllReady
                      ? "border-green-500/30 bg-green-500/5 text-green-400 hover:bg-green-500/10"
                      : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10"
                  }`}
                  data-testid="btn-prepare-export"
                >
                  {prepareState === "running" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : prepareAllReady ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Shield className="h-4 w-4" />
                  )}
                  {prepareState === "running"
                    ? `Checking ${selectedScenes.length} clip${selectedScenes.length !== 1 ? "s" : ""}…`
                    : prepareAllReady
                    ? `Re-prepare Export Files (${prepareReadyCount}/${selectedScenes.length} ready)`
                    : `Prepare Export Files — ${selectedScenes.length} clip${selectedScenes.length !== 1 ? "s" : ""}`}
                </Button>

                {/* Check table */}
                {clipCheckResults && clipCheckResults.length > 0 && (
                  <ExportFileCheckTable
                    rows={clipCheckResults}
                    expanded={checkTableExpanded}
                    onToggle={() => setCheckTableExpanded((x) => !x)}
                  />
                )}

                {/* Export buttons — only shown when all clips are ready */}
                {prepareAllReady && (
                  <>
                    {!confirmed ? (
                      <Button
                        onClick={() => setConfirmed(true)}
                        variant="outline"
                        className="w-full border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 gap-2"
                        data-testid="btn-confirm-export"
                      >
                        <Film className="h-4 w-4" />
                        {isRangeExport
                          ? `Export Selected Range — ${exportRangeLabel ?? "custom range"}`
                          : `Export Full Video — ${selectedScenes.length} clip${selectedScenes.length !== 1 ? "s" : ""}${hasAudio ? " + audio" : ", no audio"} · ${aspectRatio}`}
                      </Button>
                    ) : (
                      <Button
                        onClick={handleExport}
                        className="gold-glow w-full gap-2"
                        data-testid="btn-start-export"
                      >
                        <Film className="h-4 w-4" />
                        Confirm &amp; Start Export
                      </Button>
                    )}
                  </>
                )}

                {/* Block message when prepare not done */}
                {prepareState === "idle" && (
                  <p className="text-center text-[11px] text-white/25 leading-relaxed">
                    Click <span className="text-white/45">Prepare Export Files</span> to verify all clips before export. FFmpeg will not start until all clips are ready.
                  </p>
                )}
                {prepareState === "failed" && !prepareAllReady && (
                  <p className="text-center text-[11px] text-red-400/60 leading-relaxed">
                    Some clips failed — fix the errors above and click Prepare again before exporting.
                  </p>
                )}
              </div>
            )}

            {/* Blocked states */}
            {hasDuplicateUrls && (
              <Button disabled className="w-full gap-2 opacity-50 cursor-not-allowed">
                <XCircle className="h-4 w-4" />
                Export Blocked — Fix Duplicate Clips First
              </Button>
            )}
            {selectedScenes.length === 0 && (
              <Button disabled className="w-full gap-2 opacity-50 cursor-not-allowed">
                <Film className="h-4 w-4" />
                No Clips Ready to Export
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Clips panel ─────────────────────────────────────── */
function ClipsPanel({ scenes }: { scenes: SceneData[] }) {
  const selectedCount = scenes.filter(isSelected).length;
  const urls = scenes.filter(isSelected).map((s) => s.demoClipUrl!);
  const urlCounts = new Map<string, number>();
  for (const u of urls) urlCounts.set(u, (urlCounts.get(u) ?? 0) + 1);

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.04] border-b border-white/[0.06] flex items-center justify-between">
        <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">
          Clips Included In Export
        </p>
        <span className="text-[10px] font-bold text-white/30">
          {selectedCount} / {scenes.length} selected
        </span>
      </div>

      <div className="grid grid-cols-[20px_1fr_60px_72px_44px_44px_40px] gap-x-2 px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
        <span className="text-[9px] font-bold text-white/20 uppercase">#</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Description</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Provider</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Status</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">URL</span>
        <span className="text-[9px] font-bold text-white/20 uppercase">Selected</span>
        <span className="text-[9px] font-bold text-white/20 uppercase text-right">Dur.</span>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {scenes.map((scene, i) => {
          const selected  = isSelected(scene);
          const hasUrl    = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
          const isDupe    = hasUrl && (urlCounts.get(scene.demoClipUrl!) ?? 0) > 1;
          const dur       = parseDuration(scene.timestamp ?? "");

          let skipReason = "";
          if (!hasUrl) skipReason = "no clip URL";
          else if (!selected) {
            const isRunway =
              scene.provider === "Runway" ||
              scene.demoClipUrl!.includes("dnznrvs05pmza.cloudfront.net");
            skipReason = !isRunway ? "provider not Runway" : "status not completed";
          }

          return (
            <div
              key={scene.id}
              className={`grid grid-cols-[20px_1fr_60px_72px_44px_44px_40px] gap-x-2 items-start px-3 py-2.5 ${
                isDupe ? "bg-red-500/5" : selected ? "" : "opacity-50"
              }`}
            >
              <span className="text-[11px] font-black text-white/30 pt-0.5">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-[11px] text-white/70 font-medium truncate leading-tight">
                  {sceneLabel(scene, i)}
                </p>
                {hasUrl && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-[9px] font-mono truncate ${isDupe ? "text-red-400/70" : "text-white/20"}`}>
                      {"…" + scene.demoClipUrl!.replace(/[?#].*$/, "").slice(-36)}
                    </span>
                    <a
                      href={scene.demoClipUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-primary/40 hover:text-primary/80 transition-colors"
                      title="Open clip"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                )}
                {skipReason && <p className="text-[9px] text-red-400/60 mt-0.5">{skipReason}</p>}
                {isDupe && <p className="text-[9px] text-red-400 font-bold mt-0.5">⚠ duplicate URL</p>}
              </div>
              <span className={`text-[10px] font-bold pt-0.5 ${scene.provider === "Runway" ? "text-purple-400" : "text-white/25"}`}>
                {scene.provider || "—"}
              </span>
              <span className={`text-[10px] font-bold pt-0.5 ${statusColor(scene)}`}>
                {statusLabel(scene)}
              </span>
              <span className="flex items-center pt-1">
                {hasUrl ? <Check className="h-3 w-3 text-green-400" /> : <Minus className="h-3 w-3 text-white/20" />}
              </span>
              <span className="flex items-center pt-1">
                {selected ? <Check className="h-3 w-3 text-green-400" /> : <Minus className="h-3 w-3 text-white/20" />}
              </span>
              <span className="text-[10px] text-white/30 text-right pt-0.5">
                {dur !== null ? `${dur}s` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-2 bg-white/[0.02] border-t border-white/[0.06] flex items-center justify-between gap-2">
        <span className="text-[10px] text-white/25">
          {selectedCount === 0
            ? "No clips ready — generate Runway clips above"
            : selectedCount === scenes.length
            ? "All scenes have clips — ready to export"
            : `${scenes.length - selectedCount} scene${scenes.length - selectedCount > 1 ? "s" : ""} without clips will be skipped`}
        </span>
        <span className="text-[10px] font-bold text-white/40 shrink-0">
          {selectedCount} clip{selectedCount !== 1 ? "s" : ""} → export
        </span>
      </div>
    </div>
  );
}

/* ── Export File Check Table ─────────────────────────── */
function ExportFileCheckTable({
  rows, expanded, onToggle,
}: {
  rows: ClipCheckRow[];
  expanded: boolean;
  onToggle: () => void;
}) {
  function fmt(bytes: number): string {
    if (bytes === 0) return "—";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  function fmtDur(s: number): string {
    return s > 0 ? `${s.toFixed(1)}s` : "—";
  }
  const allReady = rows.every((r) => r.readyForFFmpeg);

  return (
    <div className="rounded-xl border border-white/[0.08] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-white/[0.03] border-b border-white/[0.06] hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">Export File Check</p>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${allReady ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}>
            {rows.filter((r) => r.readyForFFmpeg).length}/{rows.length} ready
          </span>
        </div>
        {expanded
          ? <ChevronUp className="h-3 w-3 text-white/30" />
          : <ChevronDown className="h-3 w-3 text-white/30" />}
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-[9px] border-collapse">
            <thead>
              <tr className="bg-white/[0.025] border-b border-white/[0.05]">
                {["Scene","Source","URL found","HTTP","Local file","Exists","Size","Duration","ffprobe","Ready","Error"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-bold text-white/25 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ok = row.readyForFFmpeg;
                return (
                  <tr
                    key={row.sceneNumber}
                    className={`border-b border-white/[0.04] ${ok ? "" : "bg-red-500/[0.04]"}`}
                  >
                    <td className="px-2 py-1.5 font-black text-white/50 whitespace-nowrap">{row.sceneNumber}</td>
                    <td className="px-2 py-1.5 text-white/40 whitespace-nowrap">
                      <span className={`px-1 py-0.5 rounded text-[8px] ${
                        row.sourceType === "supabase-storage" ? "bg-blue-500/15 text-blue-300"
                        : row.sourceType === "runway-cloudfront" ? "bg-purple-500/15 text-purple-300"
                        : "bg-white/5 text-white/30"
                      }`}>{row.sourceType}</span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {row.originalUrl
                        ? <span className="text-green-400 font-bold">yes</span>
                        : <span className="text-red-400 font-bold">no</span>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <span className={row.localPath ? "text-green-400" : "text-white/25"}>
                        {row.localPath ? "200" : "—"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 font-mono text-white/25 max-w-[120px] truncate">
                      {row.localPath ? "…" + row.localPath.slice(-28) : "—"}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {row.fileSize > 0
                        ? <span className="text-green-400 font-bold">yes</span>
                        : <span className="text-red-400 font-bold">no</span>}
                    </td>
                    <td className="px-2 py-1.5 text-white/40 whitespace-nowrap">{fmt(row.fileSize)}</td>
                    <td className="px-2 py-1.5 text-white/40 whitespace-nowrap">{fmtDur(row.duration)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {row.ffprobeValid
                        ? <span className="text-green-400 font-bold">yes</span>
                        : <span className="text-red-400 font-bold">no</span>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {ok
                        ? <span className="text-green-400 font-bold">yes ✓</span>
                        : <span className="text-red-400 font-bold">no ✗</span>}
                    </td>
                    <td className="px-2 py-1.5 text-red-400/70 max-w-[180px] leading-tight">
                      {row.error ?? <span className="text-white/20">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function statusLabel(s: SceneData): string {
  if (s.approved && s.generationStatus === "completed") return "Approved";
  if (s.generationStatus === "completed") return "Completed";
  if (s.generationStatus === "failed")    return "Failed";
  if (s.generationStatus === "pending")   return "Pending";
  if (s.demoClipUrl)                      return "Ready";
  return "—";
}

function statusColor(s: SceneData): string {
  if (s.approved && s.generationStatus === "completed") return "text-primary";
  if (s.generationStatus === "completed") return "text-green-400";
  if (s.generationStatus === "failed")    return "text-red-400";
  if (s.generationStatus === "pending")   return "text-amber-400";
  if (s.demoClipUrl)                      return "text-green-400";
  return "text-white/25";
}

function StatusBadge({ status }: { status: ExportStatus }) {
  if (status === "idle") {
    return (
      <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest border border-white/10 rounded-full px-2 py-0.5">
        Ready to Export
      </span>
    );
  }
  if (status === "exporting") {
    return (
      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest border border-amber-400/30 bg-amber-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Exporting Final Video…
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest border border-green-400/30 bg-green-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
        <CheckCircle2 className="h-2.5 w-2.5" /> Export Complete
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest border border-red-400/30 bg-red-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
      <XCircle className="h-2.5 w-2.5" /> Export Failed
    </span>
  );
}
