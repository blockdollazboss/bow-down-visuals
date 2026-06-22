import { useState } from "react";
import {
  Download, Film, Loader2, AlertTriangle, CheckCircle2, XCircle, Clapperboard,
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

export function FinalVideoExport({
  scenes,
  projectId,
  audioUrl,
  existingExport,
  onExportComplete,
}: FinalVideoExportProps) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();

  const clips = scenes.filter((s) => !!s.demoClipUrl);

  const [status, setStatus] = useState<ExportStatus>(
    existingExport?.export_status === "completed" ? "completed" : "idle",
  );
  const [exportUrl, setExportUrl] = useState<string | null>(
    existingExport?.final_video_url ?? null,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

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

    try {
      const token = await getAccessToken();
      const clipUrls = clips.map((s) => s.demoClipUrl!);
      const timelineOrder = scenes.map((s) => s.id);

      const res = await fetch("/api/export-final-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? ""}`,
        },
        body: JSON.stringify({ projectId, clipUrls, audioUrl: audioUrl ?? null, timelineOrder }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Export failed (${res.status})`);
      }

      const data = (await res.json()) as { url: string };
      setExportUrl(data.url);
      setStatus("completed");

      const record: ExportRecord = {
        final_video_url: data.url,
        export_status: "completed",
        export_created_at: new Date().toISOString(),
        clips_used: clipUrls.length,
        audio_used: !!audioUrl,
        timeline_order: timelineOrder,
      };
      onExportComplete?.(record);
      toast({ title: "Export complete!", description: "Your final video is ready to download." });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Export failed";
      setStatus("failed");
      setErrorMsg(msg);
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
            {clips.length} clip{clips.length !== 1 ? "s" : ""} ready
            {audioUrl ? " · with audio track" : " · no audio"}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="p-5 space-y-4">
        {/* Completed — show player + download */}
        {status === "completed" && exportUrl && (
          <div className="space-y-3" data-testid="export-result">
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
                Download Final Video
              </Button>
            </a>
            <p className="text-center text-xs text-white/30">
              Exported {clips.length} clip{clips.length !== 1 ? "s" : ""}
              {audioUrl ? " · audio track included" : ""}
            </p>
          </div>
        )}

        {/* Failed */}
        {status === "failed" && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-300">Export Failed</p>
              {errorMsg && <p className="text-xs text-red-400/70 mt-0.5">{errorMsg}</p>}
            </div>
          </div>
        )}

        {/* Exporting */}
        {status === "exporting" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <div>
              <p className="text-sm font-bold text-white">Exporting your video…</p>
              <p className="text-xs text-white/40 mt-1">
                Downloading clips · Running FFmpeg · Uploading
              </p>
            </div>
          </div>
        )}

        {/* Idle / ready */}
        {(status === "idle" || status === "failed") && (
          <div className="space-y-3">
            {/* Warning */}
            {!confirmed && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-200/80 leading-relaxed">
                  Final video export may take time depending on clip length and number of scenes.
                  The page must stay open during export.
                </p>
              </div>
            )}

            {/* Clip summary */}
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.04]">
              {clips.map((clip, i) => (
                <div key={clip.id} className="flex items-center gap-2 px-3 py-2">
                  <Film className="h-3 w-3 text-primary/60 shrink-0" />
                  <span className="text-xs text-white/50 flex-1 truncate">
                    Scene {i + 1}
                    {clip.section ? ` · ${clip.section}` : ""}
                  </span>
                  {clip.approved && (
                    <span className="text-[10px] font-bold text-primary">★</span>
                  )}
                </div>
              ))}
            </div>

            {!confirmed ? (
              <Button
                onClick={() => setConfirmed(true)}
                variant="outline"
                className="w-full border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 gap-2"
                data-testid="btn-confirm-export"
              >
                <Film className="h-4 w-4" />
                Export Final Video
              </Button>
            ) : (
              <Button
                onClick={handleExport}
                className="gold-glow w-full gap-2"
                data-testid="btn-start-export"
              >
                <Film className="h-4 w-4" />
                Confirm &amp; Start Export ({clips.length} clip{clips.length !== 1 ? "s" : ""})
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
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
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Exporting
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
