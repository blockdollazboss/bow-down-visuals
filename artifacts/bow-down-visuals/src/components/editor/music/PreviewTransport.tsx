import { Play, Pause, Square, Loader2, Radio, AlertTriangle, Sparkles, AlertCircle } from "lucide-react";
import type { MixPreview } from "@/components/editor/music/useMixPreview";
import type { PreviewRenderResult } from "@/lib/audio-export";

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface PreviewTransportProps {
  preview: MixPreview;
  /** Trigger a short (5-20s) real server-side FFmpeg render of the current mix. */
  onRenderTruePreview: () => void;
  rendering: boolean;
  renderedPreview: PreviewRenderResult | null;
  renderError: string | null;
  hasStems: boolean;
}

export function PreviewTransport({
  preview,
  onRenderTruePreview,
  rendering,
  renderedPreview,
  renderError,
  hasStems,
}: PreviewTransportProps) {
  const { playState, loading, position, duration, errors } = preview;
  const isPlaying = playState === "playing";
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const busy = loading && !isPlaying;

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/30 text-[10px] font-black uppercase tracking-wider text-primary">
            <Radio className="h-3 w-3" /> Preview Mix Mode
          </span>
        </div>
        <span className="text-[11px] font-mono text-white/50 tabular-nums" data-testid="preview-time">
          {formatTime(position)} / {formatTime(duration)}
        </span>
      </div>

      <p className="text-[11px] text-white/40 leading-relaxed">
        This is a browser preview. Final studio-quality rendering/export comes in the next phase.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => preview.toggle()}
          disabled={!hasStems || busy}
          data-testid="btn-preview-play"
          className="h-10 px-4 flex items-center gap-2 rounded-lg bg-primary text-black text-sm font-black hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {busy ? "Loading…" : isPlaying ? "Pause" : "Play Mix"}
        </button>
        <button
          type="button"
          onClick={() => preview.stop()}
          disabled={!hasStems || playState === "stopped"}
          data-testid="btn-preview-stop"
          className="h-10 w-10 flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.03] text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30"
          title="Stop"
        >
          <Square className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div className="h-full bg-primary/70 transition-[width] duration-100" style={{ width: `${pct}%` }} data-testid="preview-progress" />
        </div>
      </div>

      {!hasStems && (
        <p className="text-[11px] text-white/35">Upload stems in the Tracks tab to preview your mix.</p>
      )}

      {errors.length > 0 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-200/80 leading-relaxed">
            {errors.length} stem{errors.length > 1 ? "s" : ""} couldn't be decoded for browser preview (the file may be a format your browser can't play). They're still saved and exportable later.
          </p>
        </div>
      )}

      <div className="pt-2 border-t border-white/[0.06] space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-white/85">Hear the True Render</p>
            <p className="text-[11px] text-white/40 leading-relaxed">
              Renders a real 12s clip through the actual export pipeline (incl. real pitch correction) — the exact audio you'd get in a full export.
            </p>
          </div>
          <button
            type="button"
            onClick={onRenderTruePreview}
            disabled={!hasStems || rendering}
            data-testid="btn-render-true-preview"
            className="h-10 px-4 shrink-0 flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-black hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {rendering ? "Rendering…" : "Render True Preview"}
          </button>
        </div>

        {renderError && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/25" data-testid="true-preview-error">
            <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-200/90 leading-relaxed">{renderError}</p>
          </div>
        )}

        {renderedPreview && !rendering && (
          <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/[0.05] p-2.5" data-testid="true-preview-result">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/20 text-[10px] font-black uppercase tracking-wide text-primary">
                True Render
              </span>
              <span className="text-[10px] text-white/40">{renderedPreview.seconds}s clip of the actual export audio</span>
            </div>
            <audio controls src={renderedPreview.url} className="w-full" data-testid="true-preview-audio" />
            {renderedPreview.warnings.length > 0 && (
              <p className="text-[10px] text-amber-300/80 leading-relaxed">{renderedPreview.warnings[0]}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
