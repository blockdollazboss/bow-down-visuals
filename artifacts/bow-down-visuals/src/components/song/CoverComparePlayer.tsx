import { useRef, useState } from "react";
import { Disc3, Play, Square } from "lucide-react";

/* ─── CoverComparePlayer ────────────────────────────────────────────────────
   Side-by-side A/B player: original vs cover. "Play both" starts the two
   tracks together for an honest comparison; Stop halts both. */

export interface CompareTrack {
  title: string;
  audioUrl: string;
}

interface CoverComparePlayerProps {
  original: CompareTrack;
  cover: CompareTrack;
}

export function CoverComparePlayer({ original, cover }: CoverComparePlayerProps) {
  const originalRef = useRef<HTMLAudioElement>(null);
  const coverRef = useRef<HTMLAudioElement>(null);
  const [playingBoth, setPlayingBoth] = useState(false);

  async function playBoth() {
    const a = originalRef.current;
    const b = coverRef.current;
    if (!a || !b) return;
    try {
      a.currentTime = 0;
      b.currentTime = 0;
      await Promise.all([a.play(), b.play()]);
      setPlayingBoth(true);
    } catch {
      /* autoplay or media errors — the individual players still work */
    }
  }

  function stopBoth() {
    originalRef.current?.pause();
    coverRef.current?.pause();
    setPlayingBoth(false);
  }

  function onEnded() {
    if (originalRef.current?.paused && coverRef.current?.paused) setPlayingBoth(false);
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm font-bold text-white flex items-center gap-2">
          <Disc3 className="h-4 w-4 text-primary" />
          Original vs Cover
        </p>
        {playingBoth ? (
          <button
            type="button"
            onClick={stopBoth}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-black px-3 py-1.5 text-xs font-bold hover:bg-primary/90 transition-colors"
          >
            <Square className="h-3.5 w-3.5" /> Stop both
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void playBoth()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 text-primary px-3 py-1.5 text-xs font-bold hover:bg-primary/10 transition-colors"
          >
            <Play className="h-3.5 w-3.5" /> Play both
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg bg-black/40 border border-white/10 p-3">
          <p className="text-[11px] uppercase tracking-wider text-white/40 font-semibold mb-1">Original</p>
          <p className="text-xs font-semibold text-white truncate mb-2">{original.title}</p>
          <audio ref={originalRef} controls src={original.audioUrl} className="w-full h-8" onEnded={onEnded} />
        </div>
        <div className="rounded-lg bg-black/40 border border-primary/25 p-3">
          <p className="text-[11px] uppercase tracking-wider text-primary font-semibold mb-1">Cover</p>
          <p className="text-xs font-semibold text-white truncate mb-2">{cover.title}</p>
          <audio ref={coverRef} controls src={cover.audioUrl} className="w-full h-8" onEnded={onEnded} />
        </div>
      </div>
      <p className="text-[11px] text-white/30 mt-2">
        Tip: play each solo first, then hit “Play both” to feel the style change.
      </p>
    </div>
  );
}
