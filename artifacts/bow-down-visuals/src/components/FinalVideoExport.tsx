import { useState } from "react";
import {
  Download, Film, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Clapperboard, FlaskConical, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { SceneData } from "@/lib/scene-parser";

interface ExportRecord {
  final_video_url: string;
  export_status: "completed" | "failed" | string;
  export_created_at: string;
  clips_used: number;
  audio_used: boolean;
  timeline_order?: string[];
}

interface FinalVideoExportProps {
  scenes: SceneData[];
  projectId?: string | null;
  audioUrl?: string | null;
  existingExport?: ExportRecord | null;
  onExportComplete?: (record: ExportRecord) => void;
}

type ExportStatus = "idle" | "exporting" | "completed" | "failed";

/** Parse "0:05-0:10" → duration in seconds (5) */
function parseDurationFromTimestamp(timestamp: string): number | null {
  const m = timestamp?.match(/(\d+):(\d+)\s*[-–]\s*(\d+):(\d+)/);
  if (!m) return null;
  const start = parseInt(m[1]!) * 60 + parseInt(m[2]!);
  const end   = parseInt(m[3]!) * 60 + parseInt(m[4]!);
  const dur = end - start;
  return dur > 0 ? dur : null;
}

export function FinalVideoExport({
  scenes,
  projectId,
  audioUrl,
  existingExport,
  onExportComplete,
}: FinalVideoExportProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  /* All scenes that have a real HTTP clip URL */
  const clips = scenes.filter((s) => !!s.demoClipUrl && s.demoClipUrl.startsWith("http"));

  const [status, setStatus] = useState<ExportStatus>(
    existingExport?.export_status === "completed" ? "completed" : "idle",
  );
  const [exportUrl, setExportUrl] = useState<string | null>(
    existingExport?.final_video_url ?? null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [progressStep, setProgressStep] = useState<string>("");

  async function handleExport() {
    if (!projectId) {
      toast({ title: "Save project first", description: "Save your project before exporting.", variant: "destructive" });
      return;
    }
    if (clips.length === 0) {
      toast({ title: "No clips ready", description: "Generate Runway clips on the scenes below first.", variant: "destructive" });
      return;
    }

    setStatus("exporting");
    setErrorMsg(null);
    setProgressStep("Verifying clips…");

    try {
      const token = await getAccessToken();
      /* Preserve scene order — use scenes array index, not clips subset */
      const orderedClips = scenes
        .filter((s) => !!s.demoClipUrl && s.demoClipUrl.startsWith("http"));
      const clipUrls = orderedClips.map((s) => s.demoClipUrl!);
      const timelineOrder = scenes.map((s) => s.id);

      setProgressStep(
        `Downloading ${clips.length} clip${clips.length > 1 ? "s" : ""} · normalizing to 1080×1920 · running FFmpeg…`,
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
          audioUrl: testMode ? null : (audioUrl ?? null),
          timelineOrder,
          testMode,
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Export failed (HTTP ${res.status})`);
      }

      const data = (await res.json()) as {
        url: string;
        clipCount: number;
        audioIncluded: boolean;
        testMode?: boolean;
      };
      setExportUrl(data.url);
      setStatus("completed");
      setProgressStep("");

      const record: ExportRecord = {
        final_video_url: data.url,
        export_status: "completed",
        export_created_at: new Date().toISOString(),
        clips_used: clipUrls.length,
        audio_used: data.audioIncluded,
        timeline_order: timelineOrder,
      };
      if (!testMode) onExportComplete?.(record);
      toast({
        title: data.testMode ? "Test export complete!" : "Export complete!",
        description: data.testMode
          ? "Video-only test passed. Now export with audio."
          : "Your final video is ready to download.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Export failed";
      setStatus("failed");
      setErrorMsg(msg);
      setProgressStep("");
      toast({ title: "Export failed", description: msg, variant: "destructive" });
    }
  }

  if (clips.length === 0) return null;

  return (
    <div
      className="rounded-2xl border border-primary/20 bg-black/40 overflow-hidden"
      data-testid="final-video-export"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <Clapperboard className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Final Video Export</h3>
          <p className="text-xs text-white/40 mt-0.5">
            {clips.length} clip{clips.length !== 1 ? "s" : ""}
            {audioUrl && !testMode ? " · with audio track" : " · video only"}
            {" · "}normalized to 1080×1920
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="p-5 space-y-4">

        {/* ── Completed — show player + download ── */}
        {status === "completed" && exportUrl && (
          <div className="space-y-3" data-testid="export-result">
            {testMode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <FlaskConical className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <p className="text-xs text-blue-300">
                  Test export (video only). If both clips appear in order, export again with audio.
                </p>
              </div>
            )}
            <video
              src={exportUrl}
              controls
              playsInline
              className="w-full rounded-xl bg-black border border-white/10"
              style={{ maxHeight: 360 }}
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
                Download{testMode ? " Test Video" : " Final Video"}
              </Button>
            </a>
            {!testMode && (
              <p className="text-center text-xs text-white/30">
                {clips.length} clip{clips.length !== 1 ? "s" : ""}
                {audioUrl ? " · audio track included" : " · no audio"}
                {" · "}1080×1920 MP4
              </p>
            )}
            <button
              onClick={() => { setStatus("idle"); setExportUrl(null); setConfirmed(false); }}
              className="w-full text-center text-[11px] text-white/25 hover:text-white/50 transition-colors"
            >
              Export again
            </button>
          </div>
        )}

        {/* ── Failed ── */}
        {status === "failed" && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-300">Export Failed</p>
              {errorMsg && (
                <p className="text-xs text-red-400/80 mt-1 leading-relaxed break-words">{errorMsg}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Exporting ── */}
        {status === "exporting" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <div>
              <p className="text-sm font-bold text-white">
                {testMode ? "Running test export…" : "Exporting your video…"}
              </p>
              <p className="text-xs text-white/40 mt-1">{progressStep || "Processing…"}</p>
            </div>
          </div>
        )}

        {/* ── Idle / Ready ── */}
        {(status === "idle" || status === "failed") && (
          <div className="space-y-3">

            {/* CLIPS INCLUDED IN EXPORT — always visible */}
            <ClipsIncludedList scenes={scenes} />

            {/* Warning */}
            {!confirmed && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  Each clip is downloaded from its saved URL, normalized to 1080×1920, and stitched with FFmpeg.
                  Keep the page open during export.
                </p>
              </div>
            )}

            {/* Test mode toggle */}
            <button
              onClick={() => setTestMode((v) => !v)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                testMode
                  ? "border-blue-500/40 bg-blue-500/10 text-blue-300"
                  : "border-white/10 bg-white/[0.03] text-white/35 hover:border-white/20 hover:text-white/50"
              }`}
            >
              <FlaskConical className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 text-left">
                {testMode
                  ? "✓ Video Only Test mode — audio skipped"
                  : "Enable Video Only Test (skip audio)"}
              </span>
            </button>

            {!confirmed ? (
              <Button
                onClick={() => setConfirmed(true)}
                variant="outline"
                className="w-full border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 gap-2"
                data-testid="btn-confirm-export"
              >
                <Film className="h-4 w-4" />
                {testMode ? "Export Video Only Test" : "Export Final Video"}
              </Button>
            ) : (
              <Button
                onClick={handleExport}
                className="gold-glow w-full gap-2"
                data-testid="btn-start-export"
              >
                <Film className="h-4 w-4" />
                Confirm &amp; Start {testMode ? "Test " : ""}Export ({clips.length} clip{clips.length !== 1 ? "s" : ""})
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Clips Included In Export list ── */
function ClipsIncludedList({ scenes }: { scenes: SceneData[] }) {
  const allScenes = scenes;

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className="px-3 py-2 bg-white/[0.04] border-b border-white/[0.06]">
        <p className="text-[10px] font-black text-white/50 uppercase tracking-widest">
          Clips Included In Export
        </p>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {allScenes.map((scene, i) => {
          const hasClip = !!scene.demoClipUrl && scene.demoClipUrl.startsWith("http");
          const dur = parseDurationFromTimestamp(scene.timestamp);

          return (
            <div key={scene.id} className="flex items-start gap-3 px-3 py-2.5">
              {/* Scene number */}
              <span className="text-[11px] font-black text-white/30 w-5 shrink-0 mt-0.5">
                {i + 1}
              </span>

              {/* Clip status dot */}
              <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${hasClip ? "bg-green-400" : "bg-white/20"}`} />

              {/* Details */}
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs text-white/70 truncate font-medium">
                  {scene.section || `Scene ${i + 1}`}
                  {scene.lyricLine ? (
                    <span className="text-white/30 font-normal"> — {scene.lyricLine}</span>
                  ) : null}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  <Pill
                    label="clip URL"
                    value={hasClip ? "yes" : "no"}
                    color={hasClip ? "green" : "red"}
                  />
                  {scene.provider && (
                    <Pill label="provider" value={scene.provider} color="purple" />
                  )}
                  <Pill
                    label="status"
                    value={scene.generationStatus ?? "unknown"}
                    color={scene.generationStatus === "completed" ? "green" : "amber"}
                  />
                  {dur !== null && (
                    <Pill label="duration" value={`~${dur}s`} color="neutral" />
                  )}
                  {hasClip && (
                    <a
                      href={scene.demoClipUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-primary/50 hover:text-primary/80 transition-colors"
                      title="Open clip URL"
                    >
                      <Link2 className="h-2.5 w-2.5" />
                      view URL
                    </a>
                  )}
                </div>
              </div>

              {/* Not-included badge */}
              {!hasClip && (
                <span className="text-[10px] font-bold text-white/20 uppercase tracking-wider shrink-0 mt-0.5">
                  skipped
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer: total clips */}
      {(() => {
        const includedCount = allScenes.filter(
          (s) => !!s.demoClipUrl && s.demoClipUrl.startsWith("http"),
        ).length;
        return (
          <div className="px-3 py-2 bg-white/[0.02] border-t border-white/[0.06] flex items-center justify-between">
            <span className="text-[10px] text-white/25">
              {allScenes.length - includedCount > 0
                ? `${allScenes.length - includedCount} scene${allScenes.length - includedCount > 1 ? "s" : ""} without clips will be skipped`
                : "All scenes have clips"}
            </span>
            <span className="text-[10px] font-bold text-white/40">
              {includedCount} / {allScenes.length} clips
            </span>
          </div>
        );
      })()}
    </div>
  );
}

type PillColor = "green" | "red" | "amber" | "purple" | "neutral";

function Pill({ label, value, color }: { label: string; value: string; color: PillColor }) {
  const colors: Record<PillColor, string> = {
    green:   "text-green-400",
    red:     "text-red-400",
    amber:   "text-amber-400",
    purple:  "text-purple-400",
    neutral: "text-white/40",
  };
  return (
    <span className="text-[10px] text-white/25">
      {label}:{" "}
      <span className={`font-bold ${colors[color]}`}>{value}</span>
    </span>
  );
}

function StatusBadge({ status }: { status: ExportStatus }) {
  if (status === "idle") {
    return (
      <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest border border-white/10 rounded-full px-2 py-0.5">
        Ready
      </span>
    );
  }
  if (status === "exporting") {
    return (
      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest border border-amber-400/30 bg-amber-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Exporting
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span className="text-[10px] font-bold text-green-400 uppercase tracking-widest border border-green-400/30 bg-green-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
        <CheckCircle2 className="h-2.5 w-2.5" /> Complete
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest border border-red-400/30 bg-red-400/10 rounded-full px-2 py-0.5 flex items-center gap-1">
      <XCircle className="h-2.5 w-2.5" /> Failed
    </span>
  );
}
