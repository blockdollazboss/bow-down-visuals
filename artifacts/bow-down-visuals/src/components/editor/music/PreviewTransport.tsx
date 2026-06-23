import { Play, Pause, Square, Loader2, Radio, AlertTriangle } from "lucide-react";
import type { MixPreview } from "@/components/editor/music/useMixPreview";

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PreviewTransport({ preview }: { preview: MixPreview }) {
  const { playState, loading, position, duration, errors, hasStems } = preview;
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
    </div>
  );
}
