import { useEffect, useMemo, useRef } from "react";

/* ─── Lightweight canvas waveform (Worker 2) ───
   No heavy deps. Peaks come from a Web Audio offline analysis when the
   browser can fetch the audio, otherwise a deterministic seeded pseudo-
   peak array derived from the track id. Cached in module memory. */

const PEAK_CACHE = new Map<string, number[]>();
const BARS = 96;

function seededPeaks(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const peaks: number[] = [];
  let level = 0.5;
  for (let i = 0; i < BARS; i++) {
    // Smooth random walk — reads like a real waveform, not static noise.
    level += (rnd() - 0.5) * 0.35;
    level = Math.max(0.08, Math.min(1, level));
    const envelope = 0.55 + 0.45 * Math.sin((i / BARS) * Math.PI); // swell mid-track
    peaks.push(Math.min(1, level * envelope + rnd() * 0.12));
  }
  return peaks;
}

async function analyzedPeaks(src: string): Promise<number[] | null> {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    const res = await fetch(src);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(buf);
    await ctx.close();
    const data = audio.getChannelData(0);
    const peaks: number[] = [];
    const block = Math.floor(data.length / BARS) || 1;
    for (let i = 0; i < BARS; i++) {
      const start = i * block;
      let max = 0;
      for (let j = start; j < Math.min(start + block, data.length); j += 8) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks.push(Math.min(1, max * 1.4));
    }
    return peaks;
  } catch {
    return null; // CORS / decode failures fall back to seeded peaks
  }
}

export function getPeaks(cacheKey: string, src?: string): Promise<number[]> {
  const hit = PEAK_CACHE.get(cacheKey);
  if (hit) return Promise.resolve(hit);
  if (!src) {
    const p = seededPeaks(cacheKey);
    PEAK_CACHE.set(cacheKey, p);
    return Promise.resolve(p);
  }
  return analyzedPeaks(src).then((p) => {
    const peaks = p && p.length ? p : seededPeaks(cacheKey);
    PEAK_CACHE.set(cacheKey, peaks);
    return peaks;
  });
}

export function Waveform({
  cacheKey,
  src,
  progress = 0,
  height = 72,
  onSeek,
  interactive = false,
}: {
  cacheKey: string;
  src?: string;
  progress?: number; // 0..1 played
  height?: number;
  onSeek?: (ratio: number) => void;
  interactive?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef<number[]>([]);

  const draw = useMemo(() => {
    return (prog: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const peaks = peaksRef.current;
      if (!peaks.length) return;
      const gap = 2;
      const barW = Math.max(1, (w - gap * (BARS - 1)) / BARS);
      const playedBars = Math.floor(prog * BARS);
      for (let i = 0; i < peaks.length; i++) {
        const bh = Math.max(2, peaks[i] * h);
        const x = i * (barW + gap);
        const y = (h - bh) / 2;
        ctx.fillStyle = i < playedBars ? "#e8c86a" : "rgba(255,255,255,0.22)";
        const r = Math.min(2, barW / 2);
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, barW, bh, r);
        else ctx.rect(x, y, barW, bh);
        ctx.fill();
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getPeaks(cacheKey, src).then((p) => {
      if (!alive) return;
      peaksRef.current = p;
      draw(progress);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, src]);

  useEffect(() => { draw(progress); }, [progress, draw]);

  useEffect(() => {
    const onResize = () => draw(progress);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw, progress]);

  const handleClick = (e: React.MouseEvent) => {
    if (!interactive || !onSeek) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ height }}
      className={`w-full ${interactive ? "cursor-pointer" : ""}`}
      onClick={handleClick}
      role={interactive ? "slider" : "img"}
      aria-label="Audio waveform"
    />
  );
}
