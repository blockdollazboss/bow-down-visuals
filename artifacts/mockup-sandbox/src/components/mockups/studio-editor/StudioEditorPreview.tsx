import { useState, useRef, useMemo, useCallback } from "react";
import {
  Play, Pause, SkipBack, SkipForward, Lock, Download, ZoomIn, ZoomOut,
  Film, ChevronDown, ChevronUp, Copy, Check, Volume2,
} from "lucide-react";

/* ─── Mock data ─────────────────────────────────────────────────────── */

const MOCK_CLIPS = [
  { id: "s1",  section: "Intro",      dur: 15, url: "https://example.com/clip1.mp4"  },
  { id: "s2",  section: "Hook",       dur: 17, url: "https://example.com/clip2.mp4"  },
  { id: "s3",  section: "Verse 1",    dur: 22, url: "https://example.com/clip3.mp4"  },
  { id: "s4",  section: "Pre-Chorus", dur: 12, url: "https://example.com/clip4.mp4"  },
  { id: "s5",  section: "Chorus",     dur: 20, url: "https://example.com/clip5.mp4"  },
  { id: "s6",  section: "Verse 2",    dur: 22, url: "https://example.com/clip6.mp4"  },
  { id: "s7",  section: "Bridge",     dur: 16, url: "https://example.com/clip7.mp4"  },
  { id: "s8",  section: "Drop",       dur: 14, url: null                              },
  { id: "s9",  section: "Chorus 2",   dur: 20, url: "https://example.com/clip9.mp4"  },
  { id: "s10", section: "Break",      dur: 10, url: "https://example.com/clip10.mp4" },
  { id: "s11", section: "Outro A",    dur: 12, url: "https://example.com/clip11.mp4" },
  { id: "s12", section: "Outro B",    dur: 8,  url: "https://example.com/clip12.mp4" },
];

const TOTAL_DUR = MOCK_CLIPS.reduce((s, c) => s + c.dur, 0); // 188s

const OFFSETS: number[] = [];
let _acc = 0;
for (const c of MOCK_CLIPS) { OFFSETS.push(_acc); _acc += c.dur; }

const COLORS = [
  "#7c3aed","#2563eb","#059669","#d97706","#dc2626",
  "#0891b2","#7e22ce","#1d4ed8","#047857","#b45309","#b91c1c","#0e7490",
];

/* ─── Helpers ─────────────────────────────────────────────────────── */

function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function fmtMs(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(Math.floor((s % 1) * 10)).padStart(1, "0")}`;
}

/* ─── Active clip from time ──────────────────────────────────────── */
function activeClipIdx(t: number) {
  for (let i = MOCK_CLIPS.length - 1; i >= 0; i--) {
    if (t >= (OFFSETS[i] ?? 0)) return i;
  }
  return 0;
}

/* ─── Fake waveform ──────────────────────────────────────────────── */
function Waveform({ progress }: { progress: number }) {
  const bars = useMemo(() => Array.from({ length: 220 }, (_, i) => {
    const t = i / 220;
    return Math.min(1, Math.max(0.06,
      0.25 * Math.abs(Math.sin(t * 13.1 + 0.4)) +
      0.35 * Math.abs(Math.sin(t * 27.8 + 2.1)) +
      0.25 * Math.abs(Math.sin(t * 53.2 + 5.7)) +
      0.15 * Math.abs(Math.sin(t * 91.0 + 8.3))
    ));
  }), []);
  const W = 1000, H = 36, bw = W / bars.length;
  const played = Math.min(W, progress * W);
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <clipPath id="p"><rect x={0} y={0} width={played} height={H} /></clipPath>
        <clipPath id="u"><rect x={played} y={0} width={W - played} height={H} /></clipPath>
      </defs>
      {bars.map((h, i) => {
        const x = i * bw, bH = h * H, y = (H - bH) / 2;
        return (
          <g key={i}>
            <rect x={x} y={y} width={Math.max(1, bw - 0.8)} height={bH} fill="rgba(201,168,76,0.85)" clipPath="url(#p)" />
            <rect x={x} y={y} width={Math.max(1, bw - 0.8)} height={bH} fill="rgba(201,168,76,0.22)" clipPath="url(#u)" />
          </g>
        );
      })}
    </svg>
  );
}

/* ─── Ruler ──────────────────────────────────────────────────────── */
function Ruler({ total, current }: { total: number; current: number }) {
  const step = total <= 120 ? 15 : total <= 240 ? 30 : 60;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 0.01; t += step) ticks.push(Math.round(t));
  return (
    <div className="relative h-6 select-none" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)" }}>
      {ticks.map(t => (
        <div key={t} className="absolute top-0 flex flex-col items-center" style={{ left: `${(t / total) * 100}%`, transform: "translateX(-50%)" }}>
          <div style={{ width: 1, height: 8, background: "rgba(255,255,255,0.15)", marginTop: 2 }} />
          <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.25)" }}>{fmt(t)}</span>
        </div>
      ))}
      <div className="absolute top-0 bottom-0" style={{ width: 1, left: `${(current / total) * 100}%`, background: "rgba(201,168,76,0.7)", pointerEvents: "none" }} />
    </div>
  );
}

/* ─── Preview Player ─────────────────────────────────────────────── */
function PreviewPlayer({
  currentTime, isPlaying, clipIdx, onTogglePlay, onRestart, onPrevClip, onNextClip,
}: {
  currentTime: number; isPlaying: boolean; clipIdx: number;
  onTogglePlay: () => void; onRestart: () => void; onPrevClip: () => void; onNextClip: () => void;
}) {
  const clip = MOCK_CLIPS[clipIdx]!;
  const color = COLORS[clipIdx % COLORS.length]!;
  const offset = OFFSETS[clipIdx] ?? 0;
  const clipProgress = clip.dur > 0 ? Math.max(0, Math.min(1, (currentTime - offset) / clip.dur)) : 0;
  const clipTime = Math.max(0, currentTime - offset);

  /* Fake scanline / noise pattern via SVG */
  const scanId = `scan-${clipIdx}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)", background: "#060606" }}>
      {/* ── Video canvas ── */}
      <div style={{ position: "relative", aspectRatio: "16/9", background: "#000", overflow: "hidden" }}>

        {/* Gradient backdrop based on clip color */}
        <div style={{
          position: "absolute", inset: 0,
          background: clip.url
            ? `radial-gradient(ellipse at 30% 40%, ${color}28 0%, #000 70%), radial-gradient(ellipse at 70% 60%, ${color}18 0%, transparent 60%)`
            : "repeating-linear-gradient(45deg, #111 0px, #111 10px, #0a0a0a 10px, #0a0a0a 20px)",
        }} />

        {/* Fake film grain overlay */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.04, pointerEvents: "none" }}>
          <filter id={scanId}>
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#${scanId})`} />
        </svg>

        {/* Scanlines */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1px, transparent 1px, transparent 3px)", pointerEvents: "none" }} />

        {/* Center label */}
        {clip.url ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", border: `2px solid ${color}66`, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Film size={20} style={{ color: `${color}cc` }} />
            </div>
            <p style={{ fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: "0.05em", textAlign: "center", textShadow: "0 2px 16px rgba(0,0,0,0.8)" }}>
              {clip.section}
            </p>
            <p style={{ fontSize: 10, color: `${color}aa`, fontFamily: "monospace" }}>
              Clip {clipIdx + 1} of {MOCK_CLIPS.length}
            </p>
          </div>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <Film size={28} style={{ color: "rgba(255,255,255,0.12)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", fontWeight: 700 }}>No clip assigned</p>
            <p style={{ fontSize: 10, color: "rgba(255,255,255,0.12)" }}>{clip.section}</p>
          </div>
        )}

        {/* Top-left: clip badge */}
        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 4 }}>
          <span style={{ fontSize: 8, fontWeight: 900, padding: "2px 7px", borderRadius: 99, background: `${color}cc`, color: "#fff", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {clip.section}
          </span>
          {!clip.url && (
            <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "rgba(251,191,36,0.85)", color: "#000" }}>NO CLIP</span>
          )}
        </div>

        {/* Top-right: timecode */}
        <div style={{ position: "absolute", top: 8, right: 8, fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.7)", background: "rgba(0,0,0,0.6)", borderRadius: 4, padding: "2px 6px", backdropFilter: "blur(4px)" }}>
          {fmtMs(currentTime)}
        </div>

        {/* Bottom: clip-local progress bar */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(255,255,255,0.08)" }}>
          <div style={{ height: "100%", width: `${clipProgress * 100}%`, background: color, transition: "width 0.05s linear" }} />
        </div>

        {/* Playing pulse ring */}
        {isPlaying && (
          <div style={{ position: "absolute", top: 8, right: 60, width: 8, height: 8, borderRadius: "50%", background: "#ef4444", boxShadow: "0 0 6px #ef4444" }}>
            <span style={{ fontSize: 7, color: "#fff", fontWeight: 900, position: "absolute", left: 12, top: -1, whiteSpace: "nowrap" }}>REC</span>
          </div>
        )}
      </div>

      {/* ── Player controls bar ── */}
      <div style={{ background: "#0d0d0d", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        {/* Clip nav */}
        <button onClick={onRestart}
          style={{ padding: 5, background: "transparent", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", borderRadius: 6 }}>
          <SkipBack size={12} />
        </button>
        <button onClick={onPrevClip} disabled={clipIdx === 0}
          style={{ padding: 5, background: "transparent", border: "none", color: clipIdx === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.4)", cursor: clipIdx === 0 ? "not-allowed" : "pointer", borderRadius: 6 }}>
          ◀
        </button>

        {/* Play/pause */}
        <button onClick={onTogglePlay}
          style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${color}77`, background: `${color}22`, color, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {isPlaying ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
        </button>

        <button onClick={onNextClip} disabled={clipIdx >= MOCK_CLIPS.length - 1}
          style={{ padding: 5, background: "transparent", border: "none", color: clipIdx >= MOCK_CLIPS.length - 1 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.4)", cursor: clipIdx >= MOCK_CLIPS.length - 1 ? "not-allowed" : "pointer", borderRadius: 6 }}>
          ▶
        </button>

        {/* Time display */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, marginLeft: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
            <span style={{ color }}>+{fmt(clipTime)}</span>
            <span>{fmt(clip.dur)} clip</span>
          </div>
          <div style={{ height: 2, background: "rgba(255,255,255,0.08)", borderRadius: 1, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${clipProgress * 100}%`, background: color }} />
          </div>
        </div>

        {/* Volume icon */}
        <Volume2 size={11} style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
      </div>

      {/* ── Clip list strip ── */}
      <div style={{ background: "#0a0a0a", borderTop: "1px solid rgba(255,255,255,0.04)", padding: "6px 8px", display: "flex", gap: 3, overflowX: "auto" }}>
        {MOCK_CLIPS.map((c, i) => {
          const col = COLORS[i % COLORS.length]!;
          const isAct = i === clipIdx;
          return (
            <div key={c.id} title={c.section} style={{
              flexShrink: 0, width: 28, height: 20, borderRadius: 4,
              background: isAct ? `${col}cc` : `${col}33`,
              border: `1px solid ${isAct ? col : `${col}44`}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
              boxShadow: isAct ? `0 0 8px ${col}55` : undefined,
            }}>
              <span style={{ fontSize: 7, fontWeight: 900, color: isAct ? "#fff" : "rgba(255,255,255,0.4)" }}>{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────────── */
export function StudioEditorPreview() {
  const [currentTime, setCurrentTime] = useState(47);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [trims, setTrims] = useState<Record<string, { start: number; end: number }>>({});
  const [locked, setLocked] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lockedId] = useState(() => `tl_${Math.random().toString(36).slice(2, 7)}`);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trimDragRef = useRef<{ side: "start"|"end"; id: string; idx: number; startX: number; startVal: number; dur: number } | null>(null);

  const clipIdx = activeClipIdx(currentTime);

  /* ── Playback ── */
  const togglePlay = () => {
    setIsPlaying(p => {
      if (!p) {
        timerRef.current = setInterval(() => {
          setCurrentTime(t => {
            if (t >= TOTAL_DUR - 0.1) { clearInterval(timerRef.current!); setIsPlaying(false); return 0; }
            return t + 0.1;
          });
        }, 100);
        return true;
      } else {
        clearInterval(timerRef.current!);
        return false;
      }
    });
  };
  const restart = () => {
    clearInterval(timerRef.current!);
    setIsPlaying(false);
    setCurrentTime(0);
  };
  const prevClip = () => {
    const i = Math.max(0, clipIdx - 1);
    setCurrentTime(OFFSETS[i] ?? 0);
  };
  const nextClip = () => {
    const i = Math.min(MOCK_CLIPS.length - 1, clipIdx + 1);
    setCurrentTime(OFFSETS[i] ?? 0);
  };

  /* ── Seek ── */
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setCurrentTime(Math.max(0, Math.min(TOTAL_DUR, frac * TOTAL_DUR)));
  }, []);

  /* ── Trim drag ── */
  const startTrimDrag = (e: React.PointerEvent, side: "start"|"end", id: string, idx: number, dur: number) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cur = trims[id] ?? { start: 0, end: 0 };
    trimDragRef.current = { side, id, idx, startX: e.clientX, startVal: side === "start" ? cur.start : cur.end, dur };
  };
  const onTrimMove = (e: React.PointerEvent) => {
    const d = trimDragRef.current;
    if (!d) return;
    const el = timelineRef.current;
    if (!el) return;
    const pxPerSec = (el.getBoundingClientRect().width * zoom) / TOTAL_DUR;
    const delta = (e.clientX - d.startX) / pxPerSec;
    const max = d.dur * 0.45;
    const raw = d.side === "start" ? d.startVal + delta : d.startVal - delta;
    const val = Math.round(Math.max(0, Math.min(max, raw)) * 10) / 10;
    setTrims(t => ({ ...t, [d.id]: { ...(t[d.id] ?? { start: 0, end: 0 }), [d.side === "start" ? "start" : "end"]: val } }));
  };
  const onTrimUp = () => { trimDragRef.current = null; };

  /* ── Checks ── */
  const clipsWithUrl = MOCK_CLIPS.filter(c => c.url).length;
  const stableChecks = [
    { label: "Audio is master clock", ok: true, detail: "song audio loaded ✓" },
    { label: "All clips have URLs",   ok: clipsWithUrl === MOCK_CLIPS.length, detail: `${clipsWithUrl}/${MOCK_CLIPS.length} clips` },
    { label: "Timeline locked",       ok: locked, detail: locked ? `ID: ${lockedId}` : "click Lock Timeline" },
  ];
  const isStable = stableChecks.every(c => c.ok);

  /* ── Selected clip ── */
  const selClip = selectedIdx !== null ? MOCK_CLIPS[selectedIdx] : null;
  const selTrim = selClip ? (trims[selClip.id] ?? { start: 0, end: 0 }) : null;
  const selOffset = selectedIdx !== null ? (OFFSETS[selectedIdx] ?? 0) : 0;
  const selDur = selClip?.dur ?? 5;
  const selColor = selectedIdx !== null ? (COLORS[selectedIdx % COLORS.length] ?? "#7c3aed") : "#7c3aed";

  return (
    <div
      style={{ minHeight: "100vh", padding: 12, background: "#0a0a0a", color: "#fff", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", gap: 10 }}
      onPointerMove={onTrimMove}
      onPointerUp={onTrimUp}
    >
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 12, fontWeight: 900, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, margin: 0 }}>
            <span style={{ color: "#C9A84C" }}>✦</span> Bow Down Studio Editor
          </h2>
          <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
            {MOCK_CLIPS.length} clips · {fmt(TOTAL_DUR)} · {isPlaying ? "▶ Playing" : "⏸ Paused"}
            {locked && <span style={{ marginLeft: 8, color: "rgba(201,168,76,0.6)" }}>· Locked: {lockedId}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { setLocked(true); setJsonOpen(true); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.4)", background: "rgba(201,168,76,0.08)", color: "#C9A84C", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            <Lock size={11} /> Lock Timeline
          </button>
          <button disabled={!locked}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.06)", color: locked ? "#4ade80" : "rgba(74,222,128,0.3)", fontSize: 11, fontWeight: 700, cursor: locked ? "pointer" : "not-allowed" }}>
            <Download size={11} /> Export
          </button>
        </div>
      </div>

      {/* ── Two-column middle: Preview + Inspector ── */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 10 }}>

        {/* Left: Video Preview Player */}
        <PreviewPlayer
          currentTime={currentTime}
          isPlaying={isPlaying}
          clipIdx={clipIdx}
          onTogglePlay={togglePlay}
          onRestart={restart}
          onPrevClip={prevClip}
          onNextClip={nextClip}
        />

        {/* Right: Inspector */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

          {/* Global transport / timecode */}
          <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", padding: "8px 10px" }}>
            <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, fontWeight: 700 }}>Master Timecode</p>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 900, color: "#C9A84C", letterSpacing: "0.05em", lineHeight: 1 }}>
              {fmtMs(currentTime)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(currentTime / TOTAL_DUR) * 100}%`, background: "rgba(201,168,76,0.65)" }} />
              </div>
              <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.3)" }}>{fmt(TOTAL_DUR)}</span>
            </div>
            {/* Transport mini */}
            <div style={{ display: "flex", gap: 4, marginTop: 8, alignItems: "center" }}>
              <button onClick={restart}
                style={{ padding: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
                <SkipBack size={10} />
              </button>
              <button onClick={togglePlay}
                style={{ flex: 1, padding: 5, background: isPlaying ? "rgba(239,68,68,0.15)" : "rgba(201,168,76,0.15)", border: `1px solid ${isPlaying ? "rgba(239,68,68,0.35)" : "rgba(201,168,76,0.35)"}`, borderRadius: 7, color: isPlaying ? "#ef4444" : "#C9A84C", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, fontSize: 10, fontWeight: 700 }}>
                {isPlaying ? <><Pause size={11} /> Pause</> : <><Play size={11} /> Play</>}
              </button>
              <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                <button onClick={() => setZoom(z => Math.max(1, z - 0.5))} disabled={zoom <= 1}
                  style={{ padding: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "rgba(255,255,255,0.3)", cursor: "pointer" }}>
                  <ZoomOut size={10} />
                </button>
                <span style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.3)", width: 22, textAlign: "center" }}>{zoom}×</span>
                <button onClick={() => setZoom(z => Math.min(6, z + 0.5))} disabled={zoom >= 6}
                  style={{ padding: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, color: "rgba(255,255,255,0.3)", cursor: "pointer" }}>
                  <ZoomIn size={10} />
                </button>
              </div>
            </div>
          </div>

          {/* Clip inspector */}
          {selClip && selTrim ? (
            <div style={{ borderRadius: 10, border: `1px solid ${selColor}44`, background: `${selColor}06`, padding: "8px 10px", flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#fff", margin: 0 }}>{selClip.section}</p>
                  <p style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", marginTop: 2 }}>
                    Clip {(selectedIdx ?? 0) + 1} · {fmt(selOffset)}–{fmt(selOffset + selDur)}
                  </p>
                </div>
                <button onClick={() => setSelectedIdx(null)}
                  style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", background: "none", border: "none", cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 8 }}>
                {[["Source", `${selDur.toFixed(1)}s`], ["Trimmed", `${Math.max(0, selDur - selTrim.start - selTrim.end).toFixed(1)}s`], ["Offset", fmt(selOffset)]].map(([k, v]) => (
                  <div key={k} style={{ borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", padding: "4px 6px", textAlign: "center" }}>
                    <p style={{ fontSize: 7, color: "rgba(255,255,255,0.3)" }}>{k}</p>
                    <p style={{ fontSize: 9, fontFamily: "monospace", fontWeight: 700, color: k === "Trimmed" ? "#C9A84C" : "rgba(255,255,255,0.55)", marginTop: 1 }}>{v}</p>
                  </div>
                ))}
              </div>
              {(["start", "end"] as const).map(side => (
                <div key={side} style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, display: "block", marginBottom: 3 }}>
                    Trim {side === "start" ? "Start" : "End"}: {(side === "start" ? selTrim.start : selTrim.end).toFixed(1)}s
                  </label>
                  <input type="range" min={0} max={selDur * 0.45} step={0.1}
                    value={side === "start" ? selTrim.start : selTrim.end}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setTrims(t => ({ ...t, [selClip.id]: { ...(t[selClip.id] ?? { start: 0, end: 0 }), [side === "start" ? "start" : "end"]: v } }));
                    }}
                    style={{ width: "100%", accentColor: selColor }} />
                </div>
              ))}
              <button onClick={() => setCurrentTime(selOffset)}
                style={{ fontSize: 9, color: `${selColor}bb`, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                Jump to {fmt(selOffset)} →
              </button>
            </div>
          ) : (
            <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)", padding: "10px", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <Film size={18} style={{ color: "rgba(255,255,255,0.1)" }} />
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center" }}>Click a clip on the timeline<br/>to inspect and trim it</p>
            </div>
          )}

          {/* Stable status */}
          <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.01)", padding: "8px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <p style={{ fontSize: 8, fontWeight: 900, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Status</p>
              <span style={{ fontSize: 8, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                background: isStable ? "rgba(74,222,128,0.12)" : "rgba(251,191,36,0.1)",
                color: isStable ? "#4ade80" : "#fbbf24",
                border: `1px solid ${isStable ? "rgba(74,222,128,0.2)" : "rgba(251,191,36,0.2)"}` }}>
                {isStable ? "✓ Ready" : "○ Not ready"}
              </span>
            </div>
            {stableChecks.map(c => (
              <div key={c.label} style={{ display: "flex", gap: 6, fontSize: 8, alignItems: "center", marginBottom: 3 }}>
                <span style={{ color: c.ok ? "#4ade80" : "rgba(255,255,255,0.2)", flexShrink: 0 }}>{c.ok ? "✓" : "○"}</span>
                <span style={{ color: c.ok ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.25)", flex: 1 }}>{c.label}</span>
                <span style={{ color: "rgba(255,255,255,0.18)", fontFamily: "monospace", flexShrink: 0 }}>{c.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Timeline ── */}
      <div style={{ borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "#090909", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
            <Ruler total={TOTAL_DUR} current={currentTime} />
            {/* Waveform row */}
            <div ref={timelineRef} style={{ position: "relative", height: 38, cursor: "crosshair" }} onClick={handleTimelineClick}>
              <Waveform progress={TOTAL_DUR > 0 ? currentTime / TOTAL_DUR : 0} />
              <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, left: `${(currentTime / TOTAL_DUR) * 100}%`, background: "#C9A84C", pointerEvents: "none", zIndex: 10 }}>
                <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 7, height: 7, background: "#C9A84C", borderRadius: "50%" }} />
              </div>
            </div>
            {/* Clip track */}
            <div style={{ position: "relative", height: 68, background: "rgba(0,0,0,0.4)", cursor: "crosshair" }} onClick={handleTimelineClick}>
              {MOCK_CLIPS.map((clip, i) => {
                const offset = OFFSETS[i] ?? 0;
                const leftPct = (offset / TOTAL_DUR) * 100;
                const widthPct = (clip.dur / TOTAL_DUR) * 100;
                const color = COLORS[i % COLORS.length]!;
                const isSel = selectedIdx === i;
                const isAct = i === clipIdx;
                const trim = trims[clip.id] ?? { start: 0, end: 0 };
                return (
                  <div key={clip.id}
                    style={{ position: "absolute", top: 5, bottom: 5, left: `${leftPct}%`, width: `calc(${widthPct}% - 2px)`,
                      background: isSel ? `${color}cc` : isAct ? `${color}77` : `${color}38`,
                      border: `1px solid ${isSel ? color : isAct ? `${color}99` : `${color}33`}`,
                      boxShadow: isSel ? `0 0 0 1px ${color}44, 0 0 10px ${color}22` : isAct ? `0 0 6px ${color}22` : undefined,
                      borderRadius: 5, cursor: "pointer", overflow: "hidden", display: "flex", alignItems: "center" }}
                    onClick={e => { e.stopPropagation(); setSelectedIdx(isSel ? null : i); }}>
                    {trim.start > 0 && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(48, (trim.start / clip.dur) * 100)}%`, background: "rgba(0,0,0,0.55)", borderRight: "1px dashed rgba(255,255,255,0.2)", pointerEvents: "none" }} />}
                    {trim.end > 0 && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${Math.min(48, (trim.end / clip.dur) * 100)}%`, background: "rgba(0,0,0,0.55)", borderLeft: "1px dashed rgba(255,255,255,0.2)", pointerEvents: "none" }} />}
                    <div style={{ padding: "0 5px", zIndex: 10, minWidth: 0, flex: 1, overflow: "hidden" }}>
                      <p style={{ fontSize: 7, fontWeight: 700, color: "#fff", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", lineHeight: 1.3 }}>
                        {i + 1}. {clip.section}
                      </p>
                      <p style={{ fontSize: 6, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{fmt(offset)}–{fmt(offset + clip.dur)}</p>
                    </div>
                    {!clip.url && <Film size={8} style={{ color: "rgba(255,255,255,0.2)", marginRight: 3, flexShrink: 0 }} />}
                    {isSel && (<>
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
                        onPointerDown={e => startTrimDrag(e, "start", clip.id, i, clip.dur)} onClick={e => e.stopPropagation()}>
                        <div style={{ width: 2, height: "65%", background: "rgba(255,255,255,0.6)", borderRadius: 2 }} />
                      </div>
                      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 10, cursor: "ew-resize", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
                        onPointerDown={e => startTrimDrag(e, "end", clip.id, i, clip.dur)} onClick={e => e.stopPropagation()}>
                        <div style={{ width: 2, height: "65%", background: "rgba(255,255,255,0.6)", borderRadius: 2 }} />
                      </div>
                    </>)}
                  </div>
                );
              })}
              <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, left: `${(currentTime / TOTAL_DUR) * 100}%`, background: "rgba(201,168,76,0.65)", pointerEvents: "none", zIndex: 30 }} />
            </div>
          </div>
        </div>
        <div style={{ padding: "4px 10px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 7, color: "rgba(255,255,255,0.18)", display: "flex", gap: 12 }}>
          <span>Click waveform/track to seek</span>
          <span>Click clip to inspect</span>
          <span>Drag handles to trim</span>
        </div>
      </div>

      {/* ── Locked JSON ── */}
      {locked && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(201,168,76,0.2)", background: "rgba(201,168,76,0.03)", overflow: "hidden" }}>
          <button onClick={() => setJsonOpen(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", color: "rgba(201,168,76,0.7)", fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Lock size={10} /> Locked Timeline · {lockedId}</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={e => { e.stopPropagation(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 8, color: "rgba(255,255,255,0.35)", background: "transparent", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontWeight: "normal", textTransform: "none", letterSpacing: "normal" }}>
                {copied ? <><Check size={9} style={{ color: "#4ade80" }} /> Copied!</> : <><Copy size={9} /> Copy JSON</>}
              </button>
              {jsonOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </div>
          </button>
          {jsonOpen && (
            <div style={{ borderTop: "1px solid rgba(201,168,76,0.1)", padding: "8px 12px 10px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 4, marginBottom: 8 }}>
                {[["Clips", String(MOCK_CLIPS.length)], ["Duration", fmt(TOTAL_DUR)], ["Version", "1"], ["Audio", "0:00"], ["Locked", new Date().toLocaleTimeString()], ["Ready", isStable ? "✓" : "○"]].map(([k,v]) => (
                  <div key={k} style={{ borderRadius: 5, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)", padding: "4px 6px", textAlign: "center" }}>
                    <p style={{ fontSize: 7, color: "rgba(255,255,255,0.22)", textTransform: "uppercase" }}>{k}</p>
                    <p style={{ fontSize: 8, fontFamily: "monospace", color: "rgba(255,255,255,0.55)", marginTop: 1 }}>{v}</p>
                  </div>
                ))}
              </div>
              <div style={{ maxHeight: 100, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {MOCK_CLIPS.map((c, i) => (
                  <div key={c.id} style={{ display: "grid", gridTemplateColumns: "18px 1fr 40px 32px 40px", gap: 4, padding: "2px 6px", borderRadius: 3, border: "1px solid rgba(255,255,255,0.03)", fontSize: 7, fontFamily: "monospace", background: i === clipIdx ? "rgba(201,168,76,0.05)" : undefined }}>
                    <span style={{ color: "rgba(255,255,255,0.2)" }}>{i+1}</span>
                    <span style={{ color: "rgba(255,255,255,0.45)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{c.section}</span>
                    <span style={{ color: "rgba(255,255,255,0.3)", textAlign: "right" }}>{fmt(OFFSETS[i]??0)}</span>
                    <span style={{ color: "rgba(255,255,255,0.3)", textAlign: "right" }}>{c.dur}s</span>
                    <span style={{ textAlign: "right", color: c.url ? "rgba(74,222,128,0.6)" : "rgba(251,191,36,0.6)" }}>{c.url ? "✓ url" : "no url"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
