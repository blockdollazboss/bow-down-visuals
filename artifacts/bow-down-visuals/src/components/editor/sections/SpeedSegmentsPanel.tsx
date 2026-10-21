import { useRef, useState } from "react";
import { PencilLine, Plus, Scissors, Trash2 } from "lucide-react";
import { SPEED_CURVE_PRESETS, type ProToolsSettings, type SpeedCurvePoint } from "@/lib/editor-settings";
import {
  normalizeSpeedSegments, segmentsFromPresetCurve, splitSpeedSegment,
  outputDurationForSegments, newSegmentId,
  normalizeSpeedCurvePoints, segmentsFromCustomCurve,
  MAX_CUSTOM_CURVE_POINTS, MIN_CURVE_POINT_GAP,
  SPEED_CURVE_MIN, SPEED_CURVE_MAX,
} from "@/lib/motion-pro";

/* ── Custom speed-ramp editor (Stack 5 #4 + Wave 3 #18) ──────────────────
 * Docks inside Pro Tools → Speed & Reverse, under the preset curves.
 * Two ways to shape a ramp, one export path:
 *  - Segments (Stack 5 #4): tile the clip, each at a constant speed.
 *  - Drawn curve (Wave 3 #18): the creator places/drags points on a graph
 *    (time → speed). The points persist on pt.customSpeedCurve; every edit
 *    re-derives pt.speedSegments via segmentsFromCustomCurve (the preset
 *    sampler), and the panel states the segment count the curve became —
 *    export applies those segments through the same setpts segment
 *    machinery as the preset curves (server: buildSpeedSegmentsFilter).
 *    Hand-editing segments (or "Fine-tune as segments") leaves curve mode:
 *    the segments stay, the points clear, so stored state never claims a
 *    curve the segments no longer match. Presets are the starting points
 *    for both modes. Setting either mode clears the preset curve/flat
 *    speed for this clip (segments win at export, and the panel says so). */

/* ── Drawn-curve graph geometry (viewBox units) ── */
const GRAPH = { w: 320, h: 128, padL: 30, padR: 10, padT: 10, padB: 18 };
const PLOT_W = GRAPH.w - GRAPH.padL - GRAPH.padR;
const PLOT_H = GRAPH.h - GRAPH.padT - GRAPH.padB;
const GRID_SPEEDS = [0.25, 0.5, 1, 2, 4];
const clampNum = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Log2 speed scale: equal speed ratios get equal graph distance. */
const yForSpeed = (speed: number) =>
  GRAPH.padT + (1 - (Math.log2(clampNum(speed, SPEED_CURVE_MIN, SPEED_CURVE_MAX)) + 2) / 4) * PLOT_H;
const xForT = (t: number) => GRAPH.padL + t * PLOT_W;

export function SpeedSegmentsPanel({ pt, patchProTools }: {
  pt: ProToolsSettings;
  patchProTools: (patch: Partial<ProToolsSettings>) => void;
}) {
  const normalizedCurve = pt.customSpeedCurve ? normalizeSpeedCurvePoints(pt.customSpeedCurve) : null;
  // An all-invalid stored curve normalizes to [] — treat it as no curve.
  const curve = normalizedCurve && normalizedCurve.length > 0 ? normalizedCurve : null;
  const curveSegments = curve ? segmentsFromCustomCurve(curve) : null;
  const segments = curve
    ? curveSegments
    : pt.speedSegments ? normalizeSpeedSegments(pt.speedSegments) : null;

  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragIdx = useRef<number | null>(null);
  const selIdx = curve && selected !== null ? Math.min(selected, curve.length - 1) : null;
  const selPoint = curve && selIdx !== null ? curve[selIdx]! : null;

  function startFromPreset(presetId: string) {
    const preset = SPEED_CURVE_PRESETS.find((c) => c.id === presetId);
    if (!preset) return;
    patchProTools({
      speedSegments: segmentsFromPresetCurve(preset.points, 4),
      speedCurve: null,
      speed: 1,
      customSpeedCurve: null,
    });
  }

  function patchSegments(next: typeof segments) {
    patchProTools({ speedSegments: next, speedCurve: null, speed: 1, customSpeedCurve: null });
  }

  /* ── Drawn curve ── */
  function patchCurve(points: SpeedCurvePoint[]) {
    const normalized = normalizeSpeedCurvePoints(points);
    if (normalized.length === 0) {
      patchProTools({ customSpeedCurve: null, speedSegments: null });
      return;
    }
    patchProTools({
      customSpeedCurve: normalized,
      speedSegments: segmentsFromCustomCurve(normalized),
      speedCurve: null,
      speed: 1,
    });
  }

  function startCurve() {
    const seed: SpeedCurvePoint[] = pt.speedCurve && pt.speedCurve.length >= 2
      ? pt.speedCurve.map((p) => ({ ...p }))
      : [0, 0.5, 1].map((t) => ({ t, speed: pt.speed || 1 }));
    patchCurve(seed);
    setSelected(Math.floor(seed.length / 2));
    setNotice(null);
  }

  function clearCurve() {
    patchProTools({ customSpeedCurve: null, speedSegments: null });
    setSelected(null);
    setNotice(null);
  }

  /** Leave curve mode keeping the derived segments as hand-editable ones. */
  function fineTuneAsSegments() {
    patchProTools({ customSpeedCurve: null });
    setSelected(null);
    setNotice(null);
  }

  function removeSelectedPoint() {
    if (!curve || selIdx === null) return;
    if (curve.length <= 1) {
      setNotice("A curve needs at least one point — use Clear curve to remove the whole curve.");
      return;
    }
    patchCurve(curve.filter((_, i) => i !== selIdx));
    setSelected(null);
    setNotice(null);
  }

  function eventPoint(e: React.PointerEvent): { fx: number; fy: number; t: number; speed: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { fx: 0, fy: 0, t: 0, speed: 1 };
    const fx = ((e.clientX - rect.left) / rect.width) * GRAPH.w;
    const fy = ((e.clientY - rect.top) / rect.height) * GRAPH.h;
    const t = clampNum((fx - GRAPH.padL) / PLOT_W, 0, 1);
    const frac = clampNum((fy - GRAPH.padT) / PLOT_H, 0, 1);
    const speed = clampNum(Math.pow(2, (1 - frac) * 4 - 2), SPEED_CURVE_MIN, SPEED_CURVE_MAX);
    return { fx, fy, t: Math.round(t * 1000) / 1000, speed: Math.round(speed * 100) / 100 };
  }

  function onGraphPointerDown(e: React.PointerEvent) {
    if (!curve) return;
    const { fx, fy, t, speed } = eventPoint(e);
    const hit = curve.findIndex(
      (p) => Math.abs(xForT(p.t) - fx) <= 10 && Math.abs(yForSpeed(p.speed) - fy) <= 10,
    );
    if (hit >= 0) {
      setSelected(hit);
      setNotice(null);
      dragIdx.current = hit;
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (curve.length >= MAX_CUSTOM_CURVE_POINTS) {
      setNotice(`Up to ${MAX_CUSTOM_CURVE_POINTS} points per curve — drag or remove one to reshape it.`);
      return;
    }
    const inserted = { t, speed };
    const sorted = [...curve, inserted].sort((a, b) => a.t - b.t);
    patchCurve(sorted);
    setSelected(sorted.indexOf(inserted));
    dragIdx.current = sorted.indexOf(inserted);
    setNotice(null);
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onGraphPointerMove(e: React.PointerEvent) {
    if (!curve || dragIdx.current === null) return;
    const idx = dragIdx.current;
    if (idx >= curve.length) return;
    const { t, speed } = eventPoint(e);
    const prev = curve[idx - 1];
    const next = curve[idx + 1];
    const lo = prev ? prev.t + MIN_CURVE_POINT_GAP : 0;
    const hi = next ? next.t - MIN_CURVE_POINT_GAP : 1;
    const clampedT = clampNum(t, lo, hi);
    patchCurve(curve.map((p, i) => (i === idx ? { t: clampedT, speed } : p)));
  }

  function onGraphPointerUp() {
    dragIdx.current = null;
  }

  const strip = (segs: NonNullable<typeof segments>) => (
    <div className="flex h-9 rounded-lg overflow-hidden border border-white/10">
      {segs.map((s) => (
        <div key={s.id} className="relative border-r border-black/50 last:border-r-0"
          style={{
            width: `${(s.endT - s.startT) * 100}%`,
            backgroundColor: s.speed < 1 ? "rgba(96,165,250,0.35)" : s.speed > 1 ? "rgba(248,113,113,0.35)" : "rgba(255,255,255,0.08)",
          }}
          title={`${Math.round(s.startT * 100)}%–${Math.round(s.endT * 100)}% at ${s.speed}×`}>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white/85">
            {s.speed}×
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3" data-testid="speed-segments-panel">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
          {curve ? "Custom speed ramp — your curve" : "Custom speed ramp — your segments"}
        </p>
        {curve ? (
          <button type="button" onClick={clearCurve}
            className="text-[11px] font-bold text-white/50 hover:text-white">
            Clear curve
          </button>
        ) : segments && (
          <button type="button" onClick={() => patchProTools({ speedSegments: null, customSpeedCurve: null })}
            className="text-[11px] font-bold text-white/50 hover:text-white">
            Clear segments
          </button>
        )}
      </div>
      {!segments && !curve ? (
        <>
          <p className="text-[11px] text-white/40">
            Shape your own ramp: draw a curve point by point, split the clip into segments
            and set a speed for each, or start from a preset and tweak it.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={startCurve}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-[#C9A84C]/40 text-[#C9A84C] hover:bg-[#C9A84C]/10">
              <PencilLine className="h-3 w-3" /> Draw your own curve
            </button>
            <button type="button" onClick={() => patchSegments([{ id: newSegmentId(), startT: 0, endT: 1, speed: 1 }])}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-[#C9A84C]/40 text-[#C9A84C] hover:bg-[#C9A84C]/10">
              Start flat (1×)
            </button>
            {SPEED_CURVE_PRESETS.filter((c) => c.id !== "flat").slice(0, 4).map((c) => (
              <button key={c.id} type="button" onClick={() => startFromPreset(c.id)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-white/60 hover:text-white hover:border-white/25">
                From “{c.label}”
              </button>
            ))}
          </div>
        </>
      ) : curve && curveSegments ? (
        <>
          {/* Drawn-curve graph: x = time across the clip, y = speed (log2). */}
          <svg ref={svgRef} viewBox={`0 0 ${GRAPH.w} ${GRAPH.h}`} data-testid="speed-curve-editor"
            className="w-full h-32 rounded-lg border border-white/10 bg-black/40 touch-none select-none cursor-crosshair"
            onPointerDown={onGraphPointerDown} onPointerMove={onGraphPointerMove}
            onPointerUp={onGraphPointerUp} onPointerCancel={onGraphPointerUp}>
            {GRID_SPEEDS.map((g) => (
              <g key={g}>
                <line x1={GRAPH.padL} x2={GRAPH.padL + PLOT_W} y1={yForSpeed(g)} y2={yForSpeed(g)}
                  stroke={g === 1 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)"} strokeWidth="1" />
                <text x={GRAPH.padL - 4} y={yForSpeed(g) + 3} textAnchor="end"
                  fontSize="8" fill="rgba(255,255,255,0.35)">{g}×</text>
              </g>
            ))}
            {[0, 0.5, 1].map((t) => (
              <text key={t} x={xForT(t)} y={GRAPH.h - 5}
                textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}
                fontSize="8" fill="rgba(255,255,255,0.35)">{Math.round(t * 100)}%</text>
            ))}
            <polyline
              points={[
                `${xForT(0)},${yForSpeed(curve[0]!.speed)}`,
                ...curve.map((p) => `${xForT(p.t)},${yForSpeed(p.speed)}`),
                `${xForT(1)},${yForSpeed(curve[curve.length - 1]!.speed)}`,
              ].join(" ")}
              fill="none" stroke="#C9A84C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {curve.map((p, i) => (
              <circle key={`${p.t}-${i}`} cx={xForT(p.t)} cy={yForSpeed(p.speed)} r={i === selIdx ? 6.5 : 5}
                fill={i === selIdx ? "#C9A84C" : "#0a0a0a"} stroke="#C9A84C" strokeWidth="2"
                className="cursor-grab" />
            ))}
          </svg>
          <p className="text-[11px] text-white/40">
            Drag points to shape the ramp — click the graph to add a point (up to {MAX_CUSTOM_CURVE_POINTS}).
            Points stay inside the clip and the 0.25×–4× range.
          </p>
          {selPoint && selIdx !== null && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono text-white/40 w-24 shrink-0">
                {Math.round(selPoint.t * 100)}% · pt {selIdx + 1}/{curve.length}
              </span>
              <input type="range" min={SPEED_CURVE_MIN} max={SPEED_CURVE_MAX} step={0.05} value={selPoint.speed}
                onChange={(e) => patchCurve(curve.map((p, i) => (i === selIdx ? { ...p, speed: Number(e.target.value) } : p)))}
                className="flex-1 h-1 min-w-24 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
              <span className="text-[10px] font-mono text-white/40 w-10">{selPoint.speed.toFixed(2)}×</span>
              <button type="button" title="Remove this point" onClick={removeSelectedPoint}
                className="inline-flex items-center gap-1 text-[10px] font-bold text-white/50 hover:text-red-300 border border-white/10 rounded px-1.5 py-1">
                <Trash2 className="h-3 w-3" /> Point
              </button>
            </div>
          )}
          {notice && <p className="text-[10px] text-[#C9A84C]">{notice}</p>}
          {/* The segments this curve exports as — shown, not hidden. */}
          {strip(curveSegments)}
          <p className="text-[10px] text-white/35">
            Exports as {curveSegments.length} constant-speed segment{curveSegments.length === 1 ? "" : "s"} — your curve is
            sampled into segments (the same conversion the preset curves use), each rendering at the speed at its middle.
            A 10-second clip with this curve renders at {outputDurationForSegments(curveSegments, 10).toFixed(1)}s.
            Clip audio isn&apos;t retimed — the song track plays as-is, same as preset curves.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={fineTuneAsSegments}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-white/60 hover:text-white hover:border-white/25">
              Fine-tune as segments
            </button>
          </div>
        </>
      ) : segments ? (
        <>
          {/* Segment strip */}
          {strip(segments)}
          <div className="space-y-2">
            {segments.map((s, i) => (
              <div key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono text-white/40 w-24 shrink-0">
                  {Math.round(s.startT * 100)}%–{Math.round(s.endT * 100)}%
                </span>
                <input type="range" min={0.25} max={4} step={0.05} value={s.speed}
                  onChange={(e) => patchSegments(segments.map((x) => x.id === s.id ? { ...x, speed: Number(e.target.value) } : x))}
                  className="flex-1 h-1 min-w-24 cursor-pointer" style={{ accentColor: "#C9A84C" }} />
                <span className="text-[10px] font-mono text-white/40 w-10">{s.speed.toFixed(2)}×</span>
                <button type="button" title="Split at midpoint"
                  onClick={() => patchSegments(splitSpeedSegment(segments, s.id, (s.startT + s.endT) / 2))}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-white/50 hover:text-white border border-white/10 rounded px-1.5 py-1">
                  <Scissors className="h-3 w-3" /> Split
                </button>
                {segments.length > 1 && (
                  <button type="button" title="Remove segment (neighbours stretch to fill)"
                    onClick={() => patchSegments(normalizeSpeedSegments(segments.filter((x) => x.id !== s.id)))}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-white/50 hover:text-red-300 border border-white/10 rounded px-1.5 py-1">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                {i === segments.length - 1 && (
                  <button type="button" title="Split the last segment to add another"
                    onClick={() => patchSegments(splitSpeedSegment(segments, s.id, (s.startT + s.endT) / 2))}
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-white/50 hover:text-white border border-white/10 rounded px-1.5 py-1">
                    <Plus className="h-3 w-3" /> Segment
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-white/35">
            Segments win at export over the flat speed and preset curves for this clip.
            A 10-second clip with these segments renders at {outputDurationForSegments(segments, 10).toFixed(1)}s.
            Clip audio isn&apos;t retimed — the song track plays as-is, same as preset curves.
          </p>
        </>
      ) : null}
    </div>
  );
}
