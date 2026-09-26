import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, RotateCcw, Play, Pause } from "lucide-react";

export interface SongSegment {
  start: number;
  end: number;
}

interface SongSegmentPickerProps {
  audioUrl: string;
  label?: string;
  initialSegment?: SongSegment | null;
  onLock?: (segment: SongSegment | null) => void;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Drag-to-select song segment picker. Renders a waveform of the track with
 * two draggable handles (start / end). "Lock in" commits the selection so
 * the video is built from just that slice instead of the full song.
 */
export function SongSegmentPicker({ audioUrl, label = "Your Song", initialSegment = null, onLock }: SongSegmentPickerProps) {
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [locked, setLocked] = useState(!!initialSegment);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loading, setLoading] = useState(true);

  const trackRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dragRef = useRef<"start" | "end" | null>(null);

  /* Decode audio → duration + waveform peaks */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDuration(0);
    setPeaks([]);
    (async () => {
      try {
        const res = await fetch(audioUrl);
        const buf = await res.arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) { void ctx.close(); return; }
        const dur = decoded.duration;
        setDuration(dur);
        const data = decoded.getChannelData(0);
        const buckets = 120;
        const block = Math.floor(data.length / buckets);
        const arr: number[] = [];
        for (let i = 0; i < buckets; i++) {
          let sum = 0;
          const off = i * block;
          for (let j = 0; j < block; j += 64) sum += Math.abs(data[off + j] ?? 0);
          arr.push(Math.min(1, (sum / (block / 64)) * 3));
        }
        setPeaks(arr);
        setStart(initialSegment?.start ?? 0);
        setEnd(initialSegment?.end ?? dur);
        setLocked(!!initialSegment);
        void ctx.close();
      } catch {
        /* fall back to plain audio element duration */
        const a = new Audio();
        a.preload = "metadata";
        a.src = audioUrl;
        a.onloadedmetadata = () => {
          if (!cancelled) {
            setDuration(a.duration || 0);
            setEnd(a.duration || 0);
            setPeaks(new Array(120).fill(0.3));
          }
        };
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Playback preview of the selected slice */
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.currentTime = Math.min(start, duration - 0.1);
      void audio.play();
      setPlaying(true);
    }
  }, [playing, start, duration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setPlayhead(audio.currentTime);
      if (audio.currentTime >= end) {
        audio.pause();
        setPlaying(false);
      }
    };
    const onEnd = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
    };
  }, [end]);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  /* Pointer dragging for handles */
  const posToTime = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || !duration) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * duration;
  }, [duration]);

  const onPointerDown = (which: "start" | "end") => (e: React.PointerEvent) => {
    if (locked || !duration) return;
    dragRef.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const which = dragRef.current;
    if (!which || locked || !duration) return;
    const t = posToTime(e.clientX);
    if (which === "start") setStart(Math.min(t, end - 1));
    else setEnd(Math.max(t, start + 1));
  };

  const onPointerUp = () => { dragRef.current = null; };

  const segmentLen = Math.max(0, end - start);
  const startPct = duration ? (start / duration) * 100 : 0;
  const endPct = duration ? (end / duration) * 100 : 0;

  const lockIn = () => {
    setLocked(true);
    onLock?.(segmentLen >= 1 && (start > 0.5 || end < duration - 0.5) ? { start, end } : null);
  };

  const reset = () => {
    setStart(0);
    setEnd(duration);
    setLocked(false);
    onLock?.(null);
  };

  const bars = useMemo(() => peaks, [peaks]);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <audio ref={audioRef} src={audioUrl} preload="metadata" className="hidden" />
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold text-white/50 tracking-[0.14em] uppercase">
          {label} · <span className="text-white/80">{fmt(segmentLen)}</span> selected
          <span className="text-white/30"> of {fmt(duration)}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            disabled={loading || !duration}
            className="h-8 w-8 rounded-full border border-white/15 bg-white/[0.05] text-white/70 flex items-center justify-center hover:bg-white/[0.12] transition-colors disabled:opacity-40"
            aria-label={playing ? "Pause preview" : "Preview selection"}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-[1px]" />}
          </button>
          {locked ? (
            <button
              type="button"
              onClick={reset}
              className="h-8 px-3 rounded-full border border-white/15 bg-white/[0.05] text-white/60 text-[11px] font-bold flex items-center gap-1.5 hover:bg-white/[0.12] transition-colors"
            >
              <RotateCcw className="h-3 w-3" /> Change
            </button>
          ) : (
            <button
              type="button"
              onClick={lockIn}
              disabled={loading || !duration}
              className="h-8 px-4 rounded-full bg-[#C9A84C] text-black text-[11px] font-black flex items-center gap-1.5 hover:brightness-110 transition-all disabled:opacity-40"
            >
              <Lock className="h-3 w-3" /> Lock in
            </button>
          )}
        </div>
      </div>

      {/* Waveform track */}
      <div
        ref={trackRef}
        className={`relative h-24 rounded-xl overflow-hidden select-none ${locked ? "cursor-default" : "cursor-ew-resize"}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* bars */}
        <div className="absolute inset-0 flex items-center gap-[2px] px-2">
          {loading ? (
            <p className="w-full text-center text-[11px] text-white/30">Loading waveform…</p>
          ) : bars.map((p, i) => {
            const pct = (i / bars.length) * 100;
            const inRange = pct >= startPct && pct <= endPct;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${Math.max(6, p * 100)}%`,
                  background: inRange ? "#C9A84C" : "rgba(255,255,255,0.14)",
                  opacity: inRange ? 0.95 : 0.6,
                }}
              />
            );
          })}
        </div>
        {/* dim outside selection */}
        <div className="absolute inset-y-0 left-0 bg-black/60 pointer-events-none" style={{ width: `${startPct}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/60 pointer-events-none" style={{ width: `${100 - endPct}%` }} />
        {/* playhead */}
        {playing && (
          <div
            className="absolute inset-y-0 w-[2px] bg-white/80 pointer-events-none"
            style={{ left: `${duration ? (playhead / duration) * 100 : 0}%` }}
          />
        )}
        {/* start handle */}
        <div
          className={`absolute inset-y-0 w-6 -ml-3 flex items-center justify-center ${locked ? "" : "cursor-ew-resize"} touch-none`}
          style={{ left: `${startPct}%` }}
          onPointerDown={onPointerDown("start")}
        >
          <div className="w-[5px] h-full bg-[#C9A84C] rounded-full shadow-[0_0_10px_rgba(201,168,76,0.8)]" />
        </div>
        {/* end handle */}
        <div
          className={`absolute inset-y-0 w-6 -ml-3 flex items-center justify-center ${locked ? "" : "cursor-ew-resize"} touch-none`}
          style={{ left: `${endPct}%` }}
          onPointerDown={onPointerDown("end")}
        >
          <div className="w-[5px] h-full bg-[#C9A84C] rounded-full shadow-[0_0_10px_rgba(201,168,76,0.8)]" />
        </div>
      </div>

      {/* time labels */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] font-mono text-[#C9A84C] font-bold">{fmt(start)}</span>
        <span className="text-[10px] text-white/30">
          {locked ? "🔒 Locked in — scenes will be built for this slice" : "Drag the gold handles to pick your section"}
        </span>
        <span className="text-[11px] font-mono text-[#C9A84C] font-bold">{fmt(end)}</span>
      </div>
    </div>
  );
}
