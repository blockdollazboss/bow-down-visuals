import { useState, useRef, useMemo, useCallback } from "react";
import {
  Play, Pause, SkipBack, Lock, Download, ZoomIn, ZoomOut,
  Film, Music2, ChevronDown, ChevronUp, Copy, Check, AlertCircle,
} from "lucide-react";

/* ─── Mock data ─────────────────────────────────────────────────────── */

const MOCK_CLIPS = [
  { id: "s1", section: "Intro",     dur: 15, url: "https://example.com/clip1.mp4" },
  { id: "s2", section: "Hook",      dur: 17, url: "https://example.com/clip2.mp4" },
  { id: "s3", section: "Verse 1",   dur: 22, url: "https://example.com/clip3.mp4" },
  { id: "s4", section: "Pre-Chorus",dur: 12, url: "https://example.com/clip4.mp4" },
  { id: "s5", section: "Chorus",    dur: 20, url: "https://example.com/clip5.mp4" },
  { id: "s6", section: "Verse 2",   dur: 22, url: "https://example.com/clip6.mp4" },
  { id: "s7", section: "Bridge",    dur: 16, url: "https://example.com/clip7.mp4" },
  { id: "s8", section: "Drop",      dur: 14, url: null },
  { id: "s9", section: "Chorus 2",  dur: 20, url: "https://example.com/clip9.mp4" },
  { id: "s10",section: "Break",     dur: 10, url: "https://example.com/clip10.mp4" },
  { id: "s11",section: "Outro A",   dur: 12, url: "https://example.com/clip11.mp4" },
  { id: "s12",section: "Outro B",   dur: 8,  url: "https://example.com/clip12.mp4" },
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

/* ─── Time ruler ─────────────────────────────────────────────────── */

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

/* ─── Main Component ─────────────────────────────────────────────── */

export function StudioEditorPreview() {
  const [currentTime, setCurrentTime] = useState(47);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(1);
  const [zoom, setZoom] = useState(1);
  const [trims, setTrims] = useState<Record<string, { start: number; end: number }>>({});
  const [locked, setLocked] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lockedId] = useState(() => `tl_${Math.random().toString(36).slice(2, 7)}`);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trimDragRef = useRef<{ side: "start"|"end"; id: string; idx: number; startX: number; startVal: number; dur: number } | null>(null);

  /* ── Playback simulation ── */
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

  /* ── Click to seek ── */
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
    { label: "Audio is master clock",  ok: true,  detail: "song audio loaded ✓" },
    { label: "All clips have URLs",    ok: clipsWithUrl === MOCK_CLIPS.length, detail: `${clipsWithUrl}/${MOCK_CLIPS.length} clips` },
    { label: "Timeline locked",        ok: locked, detail: locked ? `ID: ${lockedId}` : "click Lock Timeline" },
  ];
  const isStable = stableChecks.every(c => c.ok);

  /* ── Selected clip ── */
  const selClip = selectedIdx !== null ? MOCK_CLIPS[selectedIdx] : null;
  const selTrim = selClip ? (trims[selClip.id] ?? { start: 0, end: 0 }) : null;
  const selOffset = selectedIdx !== null ? (OFFSETS[selectedIdx] ?? 0) : 0;
  const selDur = selClip?.dur ?? 5;

  return (
    <div
      className="min-h-screen p-4 space-y-3"
      style={{ background: "#0a0a0a", color: "#fff", fontFamily: "system-ui, sans-serif" }}
      onPointerMove={onTrimMove}
      onPointerUp={onTrimUp}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 style={{ fontSize: 13, fontWeight: 900, color: "#fff", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#C9A84C" }}>✦</span> Bow Down Studio Editor
          </h2>
          <p style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
            CapCut-style timeline · {MOCK_CLIPS.length} clips · {fmt(TOTAL_DUR)} total
            {locked && <span style={{ marginLeft: 8, color: "rgba(201,168,76,0.6)" }}>· Timeline locked: {lockedId}</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => { setLocked(true); setJsonOpen(true); }}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(201,168,76,0.4)", background: "rgba(201,168,76,0.08)", color: "#C9A84C", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            <Lock size={11} /> Lock Timeline
          </button>
          <button
            disabled={!locked}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, border: "1px solid rgba(74,222,128,0.35)", background: "rgba(74,222,128,0.06)", color: locked ? "#4ade80" : "rgba(74,222,128,0.3)", fontSize: 11, fontWeight: 700, cursor: locked ? "pointer" : "not-allowed" }}
          >
            <Download size={11} /> Export
          </button>
        </div>
      </div>

      {/* ── Transport ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
        <button onClick={restart} style={{ padding: 5, borderRadius: 8, border: "none", background: "transparent", color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
          <SkipBack size={13} />
        </button>
        <button
          onClick={togglePlay}
          style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid rgba(201,168,76,0.5)", background: "rgba(201,168,76,0.18)", color: "#C9A84C", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} style={{ marginLeft: 1 }} />}
        </button>
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "rgba(255,255,255,0.5)", minWidth: 90 }}>
          {fmt(currentTime)} / {fmt(TOTAL_DUR)}
        </span>
        {/* Progress bar */}
        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(currentTime / TOTAL_DUR) * 100}%`, background: "rgba(201,168,76,0.65)", borderRadius: 2 }} />
        </div>
        {/* Zoom */}
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)" }}>zoom</span>
          <button onClick={() => setZoom(z => Math.max(1, z - 0.5))} disabled={zoom <= 1}
            style={{ padding: 3, background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer" }}>
            <ZoomOut size={11} />
          </button>
          <span style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.4)", width: 24, textAlign: "center" }}>{zoom}×</span>
          <button onClick={() => setZoom(z => Math.min(6, z + 0.5))} disabled={zoom >= 6}
            style={{ padding: 3, background: "transparent", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer" }}>
            <ZoomIn size={11} />
          </button>
        </div>
      </div>

      {/* ── Timeline ── */}
      <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "#090909", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }}>
            <Ruler total={TOTAL_DUR} current={currentTime} />

            {/* Waveform */}
            <div
              ref={timelineRef}
              style={{ position: "relative", height: 40, cursor: "crosshair" }}
              onClick={handleTimelineClick}
            >
              <Waveform progress={TOTAL_DUR > 0 ? currentTime / TOTAL_DUR : 0} />
              {/* Playhead */}
              <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, left: `${(currentTime / TOTAL_DUR) * 100}%`, background: "#C9A84C", pointerEvents: "none", zIndex: 10 }}>
                <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 8, height: 8, background: "#C9A84C", borderRadius: "50%" }} />
              </div>
            </div>

            {/* Clip track */}
            <div
              style={{ position: "relative", height: 76, background: "rgba(0,0,0,0.4)", cursor: "crosshair" }}
              onClick={handleTimelineClick}
            >
              {MOCK_CLIPS.map((clip, i) => {
                const offset = OFFSETS[i] ?? 0;
                const leftPct = (offset / TOTAL_DUR) * 100;
                const widthPct = (clip.dur / TOTAL_DUR) * 100;
                const color = COLORS[i % COLORS.length]!;
                const isSel = selectedIdx === i;
                const isActive = currentTime >= offset && currentTime < offset + clip.dur;
                const trim = trims[clip.id] ?? { start: 0, end: 0 };

                return (
                  <div
                    key={clip.id}
                    style={{
                      position: "absolute",
                      top: 6, bottom: 6,
                      left: `${leftPct}%`,
                      width: `calc(${widthPct}% - 2px)`,
                      background: isSel ? `${color}cc` : isActive ? `${color}88` : `${color}44`,
                      border: `1px solid ${isSel ? color : isActive ? `${color}88` : `${color}33`}`,
                      boxShadow: isSel ? `0 0 0 1px ${color}55, 0 0 12px ${color}33` : undefined,
                      borderRadius: 5,
                      cursor: "pointer",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                    }}
                    onClick={e => { e.stopPropagation(); setSelectedIdx(isSel ? null : i); }}
                  >
                    {/* Left trim overlay */}
                    {trim.start > 0 && (
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(48, (trim.start / clip.dur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderRight: "1px dashed rgba(255,255,255,0.25)", pointerEvents: "none" }} />
                    )}
                    {/* Right trim overlay */}
                    {trim.end > 0 && (
                      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${Math.min(48, (trim.end / clip.dur) * 100)}%`, background: "rgba(0,0,0,0.6)", borderLeft: "1px dashed rgba(255,255,255,0.25)", pointerEvents: "none" }} />
                    )}
                    {/* Label */}
                    <div style={{ padding: "0 6px", zIndex: 10, minWidth: 0, flex: 1, overflow: "hidden" }}>
                      <p style={{ fontSize: 8, fontWeight: 700, color: "#fff", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", lineHeight: 1.3 }}>
                        {i + 1}. {clip.section}
                      </p>
                      <p style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                        {fmt(offset)}–{fmt(offset + clip.dur)}
                      </p>
                    </div>
                    {!clip.url && <Film size={9} style={{ color: "rgba(255,255,255,0.2)", marginRight: 4, flexShrink: 0 }} />}
                    {/* Trim handles */}
                    {isSel && (
                      <>
                        <div
                          style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 12, cursor: "ew-resize", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
                          onPointerDown={e => startTrimDrag(e, "start", clip.id, i, clip.dur)}
                          onClick={e => e.stopPropagation()}
                        >
                          <div style={{ width: 2, height: "70%", background: "rgba(255,255,255,0.6)", borderRadius: 2 }} />
                        </div>
                        <div
                          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 12, cursor: "ew-resize", zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center" }}
                          onPointerDown={e => startTrimDrag(e, "end", clip.id, i, clip.dur)}
                          onClick={e => e.stopPropagation()}
                        >
                          <div style={{ width: 2, height: "70%", background: "rgba(255,255,255,0.6)", borderRadius: 2 }} />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              {/* Playhead over clips */}
              <div style={{ position: "absolute", top: 0, bottom: 0, width: 1, left: `${(currentTime / TOTAL_DUR) * 100}%`, background: "rgba(201,168,76,0.7)", pointerEvents: "none", zIndex: 30 }} />
            </div>
          </div>
        </div>
        <div style={{ padding: "5px 12px", borderTop: "1px solid rgba(255,255,255,0.04)", fontSize: 8, color: "rgba(255,255,255,0.2)" }}>
          Click timeline to seek · Click clip to select · Drag handles to trim
        </div>
      </div>

      {/* ── Selected clip panel ── */}
      {selClip && selTrim && (
        <div style={{ borderRadius: 12, border: `1px solid ${COLORS[selectedIdx! % COLORS.length]}44`, background: `${COLORS[selectedIdx! % COLORS.length]}08`, padding: "10px 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#fff" }}>{selClip.section}</p>
              <p style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", marginTop: 2 }}>
                {fmt(selOffset)} – {fmt(selOffset + selDur)} · clip {(selectedIdx ?? 0) + 1} of {MOCK_CLIPS.length}
              </p>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {!selClip.url && (
                <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 99, border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.1)", color: "#fbbf24" }}>No clip</span>
              )}
              <button onClick={() => setSelectedIdx(null)} style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
          </div>

          {/* Duration summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 10 }}>
            {[["Source", `${selDur.toFixed(1)}s`], ["Trimmed", `${Math.max(0, selDur - selTrim.start - selTrim.end).toFixed(1)}s`], ["Starts at", fmt(selOffset)]].map(([k, v]) => (
              <div key={k} style={{ borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", padding: "5px 8px", textAlign: "center" }}>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>{k}</p>
                <p style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: k === "Trimmed" ? "#C9A84C" : "rgba(255,255,255,0.6)", marginTop: 2 }}>{v}</p>
              </div>
            ))}
          </div>

          {/* Trim sliders */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {(["start", "end"] as const).map(side => (
              <div key={side}>
                <label style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, display: "block", marginBottom: 4 }}>
                  Trim {side === "start" ? "Start" : "End"}: {(side === "start" ? selTrim.start : selTrim.end).toFixed(1)}s
                </label>
                <input
                  type="range" min={0} max={selDur * 0.45} step={0.1}
                  value={side === "start" ? selTrim.start : selTrim.end}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setTrims(t => ({ ...t, [selClip.id]: { ...(t[selClip.id] ?? { start: 0, end: 0 }), [side === "start" ? "start" : "end"]: v } }));
                  }}
                  style={{ width: "100%", accentColor: "#C9A84C" }}
                />
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", marginTop: 2 }}>
                  Skip {(side === "start" ? selTrim.start : selTrim.end).toFixed(1)}s from {side}
                </p>
              </div>
            ))}
          </div>
          <button
            onClick={() => setCurrentTime(selOffset)}
            style={{ fontSize: 9, color: "rgba(201,168,76,0.6)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", marginTop: 6 }}
          >
            Jump to {fmt(selOffset)} →
          </button>
        </div>
      )}

      {/* ── Stable status ── */}
      <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)", padding: "10px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <p style={{ fontSize: 9, fontWeight: 900, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Master Player Stable</p>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
            background: isStable ? "rgba(74,222,128,0.12)" : "rgba(251,191,36,0.12)",
            color: isStable ? "#4ade80" : "#fbbf24",
            border: `1px solid ${isStable ? "rgba(74,222,128,0.25)" : "rgba(251,191,36,0.25)"}`,
          }}>
            {isStable ? "✓ Stable — ready to export" : "○ Not stable yet"}
          </span>
        </div>
        {stableChecks.map(c => (
          <div key={c.label} style={{ display: "flex", gap: 8, fontSize: 9, alignItems: "center", marginBottom: 3 }}>
            <span style={{ color: c.ok ? "#4ade80" : "rgba(255,255,255,0.2)" }}>{c.ok ? "✓" : "○"}</span>
            <span style={{ color: c.ok ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)" }}>{c.label}</span>
            <span style={{ color: "rgba(255,255,255,0.2)", marginLeft: "auto", fontFamily: "monospace" }}>{c.detail}</span>
          </div>
        ))}
      </div>

      {/* ── Locked Timeline JSON ── */}
      {locked && (
        <div style={{ borderRadius: 12, border: "1px solid rgba(201,168,76,0.2)", background: "rgba(201,168,76,0.03)", overflow: "hidden" }}>
          <button
            onClick={() => setJsonOpen(o => !o)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "transparent", border: "none", cursor: "pointer", color: "rgba(201,168,76,0.7)", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.1em" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Lock size={11} />
              Locked Timeline · {lockedId} · {MOCK_CLIPS.length} clips · {fmt(TOTAL_DUR)}
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={e => { e.stopPropagation(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "rgba(255,255,255,0.4)", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, padding: "2px 6px", cursor: "pointer", fontWeight: "normal", textTransform: "none", letterSpacing: "normal" }}
              >
                {copied ? <><Check size={10} style={{ color: "#4ade80" }} /> Copied!</> : <><Copy size={10} /> Copy JSON</>}
              </button>
              {jsonOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </div>
          </button>

          {jsonOpen && (
            <div style={{ borderTop: "1px solid rgba(201,168,76,0.1)", padding: "0 12px 12px" }}>
              {/* Summary grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, padding: "8px 0 10px" }}>
                {[["Version","1"],["Clip count",String(MOCK_CLIPS.length)],["Duration",fmt(TOTAL_DUR)],["Audio start","0:00"],["Locked at",new Date().toLocaleTimeString()],["Ready",isStable ? "✓ Yes" : "○ No"]].map(([k,v]) => (
                  <div key={k} style={{ borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)", padding: "5px 8px" }}>
                    <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", textTransform: "uppercase" }}>{k}</p>
                    <p style={{ fontSize: 9, fontFamily: "monospace", color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{v}</p>
                  </div>
                ))}
              </div>
              {/* Clip rows */}
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", marginBottom: 4 }}>Clip List</p>
                <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                  {MOCK_CLIPS.map((c, i) => (
                    <div key={c.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr 44px 36px 44px", gap: 4, padding: "3px 6px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.04)", background: "rgba(255,255,255,0.01)", fontSize: 8, fontFamily: "monospace" }}>
                      <span style={{ color: "rgba(255,255,255,0.25)" }}>{i+1}</span>
                      <span style={{ color: "rgba(255,255,255,0.5)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{c.section}</span>
                      <span style={{ color: "rgba(255,255,255,0.35)", textAlign: "right" }}>{fmt(OFFSETS[i]??0)}</span>
                      <span style={{ color: "rgba(255,255,255,0.35)", textAlign: "right" }}>{c.dur}s</span>
                      <span style={{ textAlign: "right", color: c.url ? "rgba(74,222,128,0.7)" : "rgba(251,191,36,0.7)" }}>{c.url ? "✓ url" : "no url"}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Raw JSON snippet */}
              <details>
                <summary style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", cursor: "pointer", padding: "3px 0" }}>Show raw JSON</summary>
                <pre style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", overflow: "auto", maxHeight: 100, marginTop: 4, padding: 8, background: "rgba(0,0,0,0.3)", borderRadius: 6, lineHeight: 1.5 }}>
{`{
  "id": "${lockedId}",
  "version": 1,
  "audioDuration": ${TOTAL_DUR},
  "clipCount": ${MOCK_CLIPS.length},
  "clips": [
    { "sceneIdx": 0, "title": "Intro", "startSec": 0, "dur": 15 },
    { "sceneIdx": 1, "title": "Hook", "startSec": 15, "dur": 17 },
    ... ${MOCK_CLIPS.length - 2} more clips
  ]
}`}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
