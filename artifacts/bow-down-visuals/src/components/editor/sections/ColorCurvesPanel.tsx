import { useRef, useState } from "react";
import { Activity, RotateCcw } from "lucide-react";
import {
  defaultColorCurves, colorCurvesActive,
  type ColorCurves, type CurvePoint,
} from "@/lib/editor-settings";
import {
  computeScopes, curveSvgPath, getCurveChannel, setCurveChannel,
  normalizeCurvePoints, type CurveChannelId, type ScopeData,
} from "@/lib/color-pro";

/* ── Colour curves + scopes (Stack 5 #2 / #3) ─────────────────────────────
 * Docks inside Pro Tools → Color Correction, directly under the sliders —
 * curves compose AFTER the sliders at export (server: pro-tools-ffmpeg.ts),
 * never collapsed to a nearest preset. RGB curves render exactly via the
 * ffmpeg curves filter; HSL S/H are mid-tone-sampled approximations and the
 * UI says so. Scopes are display-only analysis of the preview frame,
 * computed at 160px wide — labelled as a guide, not a broadcast measure. */

const CHANNELS: { id: CurveChannelId; label: string; color: string }[] = [
  { id: "all", label: "RGB", color: "#e5e5e5" },
  { id: "r", label: "R", color: "#f87171" },
  { id: "g", label: "G", color: "#4ade80" },
  { id: "b", label: "B", color: "#60a5fa" },
  { id: "h", label: "Hue", color: "#e879f9" },
  { id: "s", label: "Sat", color: "#fbbf24" },
  { id: "l", label: "Light", color: "#a3a3a3" },
];

function ScopeCanvas({ draw, width = 150, height = 90 }: {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  width?: number; height?: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  return (
    <canvas
      width={width} height={height}
      className="w-full rounded border border-white/10 bg-black"
      ref={(el) => {
        ref.current = el;
        if (el) {
          const ctx = el.getContext("2d");
          if (ctx) { ctx.clearRect(0, 0, width, height); draw(ctx, width, height); }
        }
      }}
    />
  );
}

export function ColorCurvesPanel({ curves, onChange, videoRef }: {
  curves: ColorCurves | null;
  onChange: (curves: ColorCurves | null) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const value = curves ?? defaultColorCurves();
  const [channel, setChannel] = useState<CurveChannelId>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [scopes, setScopes] = useState<ScopeData | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const points = normalizeCurvePoints(getCurveChannel(value, channel));
  const active = colorCurvesActive(value);
  const def = CHANNELS.find((c) => c.id === channel)!;

  function commit(pts: CurvePoint[]) {
    const next = setCurveChannel(value, channel, normalizeCurvePoints(pts));
    onChange(colorCurvesActive(next) ? next : next); // keep object; identity = no export effect
  }

  function svgPoint(e: React.PointerEvent): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height)),
    };
  }

  function handleSvgPointer(e: React.PointerEvent) {
    if (e.type === "pointerdown" && selected === null) {
      const p = svgPoint(e);
      // Clicking near an existing point selects it instead of adding.
      const near = points.findIndex((pt) => Math.abs(pt.x - p.x) < 0.06 && Math.abs(pt.y - p.y) < 0.08);
      if (near >= 0) { setSelected(near); return; }
      const next = [...points, p].sort((a, b) => a.x - b.x);
      commit(next);
      setSelected(next.findIndex((pt) => pt.x === p.x));
      return;
    }
    if (e.type === "pointermove" && selected !== null && e.buttons > 0) {
      const p = svgPoint(e);
      const next = points.map((pt, i) => (i === selected
        ? { x: selected === 0 ? 0 : selected === points.length - 1 ? 1 : p.x, y: p.y }
        : pt));
      commit(next);
    }
    if (e.type === "pointerup") setSelected(null);
  }

  function analyseFrame() {
    setScopeError(null);
    const video = videoRef?.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      setScopeError("No preview frame available yet — play the preview, then analyse.");
      return;
    }
    try {
      const w = 160;
      const h = Math.max(2, Math.round((video.videoHeight / video.videoWidth) * w));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      setScopes(computeScopes(img.data, w, h));
    } catch {
      setScopeError("This frame can't be analysed (cross-origin clip) — scopes need a same-origin preview.");
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3" data-testid="color-curves-panel">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Colour curves — after the sliders</p>
        {active && (
          <button type="button" onClick={() => onChange(null)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-white/50 hover:text-white">
            <RotateCcw className="h-3 w-3" /> Reset curves
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {CHANNELS.map((c) => (
          <button key={c.id} type="button" onClick={() => { setChannel(c.id); setSelected(null); }}
            className={`px-2 py-1 rounded-md text-[11px] font-bold border transition-colors ${
              channel === c.id ? "text-black border-transparent" : "border-white/10 text-white/60 hover:text-white"
            }`}
            style={channel === c.id ? { backgroundColor: c.color } : undefined}>
            {c.label}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        className="w-full h-44 rounded border border-white/10 bg-black/60 touch-none cursor-crosshair"
        onPointerDown={handleSvgPointer} onPointerMove={handleSvgPointer} onPointerUp={handleSvgPointer}
        data-testid="curve-editor"
      >
        <line x1="0" y1="100" x2="100" y2="0" stroke="#ffffff22" strokeDasharray="3 3" />
        {[25, 50, 75].map((v) => (
          <g key={v} stroke="#ffffff10">
            <line x1={v} y1="0" x2={v} y2="100" />
            <line x1="0" y1={v} x2="100" y2={v} />
          </g>
        ))}
        <path d={curveSvgPath(points)} fill="none" stroke={def.color} strokeWidth="1.8" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x * 100} cy={(1 - p.y) * 100} r="3"
            fill={def.color} stroke="#000" strokeWidth="0.8"
            onDoubleClick={() => { if (points.length > 2 && i > 0 && i < points.length - 1) commit(points.filter((_, j) => j !== i)); }}
          />
        ))}
      </svg>
      <p className="text-[10px] text-white/35">
        Click to add a point · drag to shape · double-click a point to remove it. RGB curves render exactly at export;
        Hue/Sat curves are mid-tone approximations at export (Light is exact) — the export never swaps your curve for a preset.
      </p>

      {/* ── Scopes (#3) — display-only ── */}
      <div className="border-t border-white/[0.06] pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={analyseFrame}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/15 text-white/70 hover:bg-white/5">
            <Activity className="h-3.5 w-3.5" /> Analyse preview frame
          </button>
          <span className="text-[10px] text-white/35">Scopes are a guide from the preview frame at 160px wide — display only, no export effect.</span>
        </div>
        {scopeError && <p className="text-[11px] text-red-300">{scopeError}</p>}
        {scopes && (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] font-bold text-white/40 mb-1">Histogram</p>
              <ScopeCanvas draw={(ctx, w, h) => {
                const drawHist = (arr: number[], color: string) => {
                  ctx.fillStyle = color;
                  arr.forEach((v, i) => {
                    const bh = v * (h - 4);
                    ctx.fillRect((i / arr.length) * w, h - bh, Math.max(1, w / arr.length - 0.5), bh);
                  });
                };
                ctx.globalAlpha = 0.75;
                drawHist(scopes.histogram.r, "#f87171");
                drawHist(scopes.histogram.g, "#4ade80");
                drawHist(scopes.histogram.b, "#60a5fa");
              }} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-white/40 mb-1">Waveform (luma)</p>
              <ScopeCanvas draw={(ctx, w, h) => {
                const img = ctx.createImageData(w, h);
                scopes.waveform.forEach((col, xBin) => col.forEach((v, lBin) => {
                  if (v <= 0) return;
                  const x = Math.floor((xBin / col.length) * w);
                  const y = h - 1 - Math.floor((lBin / col.length) * h);
                  const idx = (y * w + x) * 4;
                  img.data[idx] = 120; img.data[idx + 1] = 255; img.data[idx + 2] = 140;
                  img.data[idx + 3] = Math.round(60 + v * 195);
                }));
                ctx.putImageData(img, 0, 0);
              }} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-white/40 mb-1">Vectorscope</p>
              <ScopeCanvas draw={(ctx, w, h) => {
                const img = ctx.createImageData(w, h);
                scopes.vectorscope.forEach((row, vBin) => row.forEach((val, uBin) => {
                  if (val <= 0) return;
                  const x = Math.floor((uBin / row.length) * w);
                  const y = h - 1 - Math.floor((vBin / row.length) * h);
                  const idx = (y * w + x) * 4;
                  img.data[idx] = 250; img.data[idx + 1] = 200; img.data[idx + 2] = 90;
                  img.data[idx + 3] = Math.round(60 + val * 195);
                }));
                ctx.putImageData(img, 0, 0);
              }} />
            </div>
          </div>
        )}
        {scopes && (
          <p className="text-[10px] text-white/30">
            Analysed {scopes.sampledPixels.toLocaleString()} pixels at {scopes.width}×{scopes.height}.
          </p>
        )}
      </div>
    </div>
  );
}
