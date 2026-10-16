import { Plus, Scissors, Trash2 } from "lucide-react";
import { SPEED_CURVE_PRESETS, type ProToolsSettings } from "@/lib/editor-settings";
import {
  normalizeSpeedSegments, segmentsFromPresetCurve, splitSpeedSegment,
  outputDurationForSegments, newSegmentId,
} from "@/lib/motion-pro";

/* ── Custom speed-ramp editor (Stack 5 #4) ────────────────────────────────
 * Docks inside Pro Tools → Speed & Reverse, under the preset curves.
 * Segments tile the clip; each plays at a constant speed and export applies
 * them through the same setpts segment machinery as the preset curves
 * (server: buildSpeedSegmentsFilter). Presets are the starting points —
 * one tap turns a preset curve into editable segments. Setting segments
 * clears the preset curve/flat speed for this clip (segments win at
 * export, and the panel says so). */

export function SpeedSegmentsPanel({ pt, patchProTools }: {
  pt: ProToolsSettings;
  patchProTools: (patch: Partial<ProToolsSettings>) => void;
}) {
  const segments = pt.speedSegments ? normalizeSpeedSegments(pt.speedSegments) : null;

  function startFromPreset(presetId: string) {
    const preset = SPEED_CURVE_PRESETS.find((c) => c.id === presetId);
    if (!preset) return;
    patchProTools({
      speedSegments: segmentsFromPresetCurve(preset.points, 4),
      speedCurve: null,
      speed: 1,
    });
  }

  function patchSegments(next: typeof segments) {
    patchProTools({ speedSegments: next, speedCurve: null, speed: 1 });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-3" data-testid="speed-segments-panel">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Custom speed ramp — your segments</p>
        {segments && (
          <button type="button" onClick={() => patchProTools({ speedSegments: null })}
            className="text-[11px] font-bold text-white/50 hover:text-white">
            Clear segments
          </button>
        )}
      </div>
      {!segments ? (
        <>
          <p className="text-[11px] text-white/40">
            Draw your own ramp: split the clip into segments and set a speed for each.
            Start from a preset and tweak it, or start flat.
          </p>
          <div className="flex flex-wrap gap-1.5">
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
      ) : (
        <>
          {/* Segment strip */}
          <div className="flex h-9 rounded-lg overflow-hidden border border-white/10">
            {segments.map((s) => (
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
            Clip audio isn't retimed — the song track plays as-is, same as preset curves.
          </p>
        </>
      )}
    </div>
  );
}
