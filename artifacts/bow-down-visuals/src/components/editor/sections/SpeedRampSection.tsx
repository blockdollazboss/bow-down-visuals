import { useCallback, useEffect, useState } from "react";
import {
  Gauge, Turtle, Rabbit, Zap, Loader2, CheckCircle2, XCircle,
  Film, Scissors, Download, Waves, Activity,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── Speed Ramp / Slow Motion — CapCut speed parity ─────────────────────
   Docks inside the Video Editor Effects panel (rendered from EffectsSection).
   Three modes, all server-side (ffmpeg, zero paid provider calls):
     1. Buttery Slow-Mo — one-tap 2x / 4x / 8x optical-flow (minterpolate)
        interpolation for 300 Visual Bucs via POST /api/slow-motion.
     2. Speed presets — 0.25x–4x constant speeds for 150 VB
        via GET /api/speed-presets + POST /api/apply-speed.
     3. Speed ramps — preset-based 8-segment animated curves (slow-mo in,
        ramp out, pulse, wave…) for 150 VB via POST /api/apply-speed.
   NOTE: true freeform per-segment ramping is NOT supported by the current
   backends — ramping is preset-based only (see the note on the section).
   After processing: replace the scene clip + "Use in export" handoff. */

const SLOW_MO_COST = 300;
const SPEED_PRESET_COST = 150;

interface SpeedPreset {
  key: string;
  label: string;
  blurb: string;
  kind: "constant" | "ramp";
  speed?: number;
  speeds?: number[];
}

interface SlowMotionResult {
  url: string;
  storageRef: string;
  slowFactor: number;
  sourceFps: number;
  sourceDuration: number;
  creditsRemaining: number;
}

interface ApplySpeedResult {
  url: string;
  storageRef: string;
  preset: string;
  creditsRemaining: number;
}

type SpeedResult =
  | { kind: "slowmo"; url: string; label: string; factor: number }
  | { kind: "preset"; url: string; label: string; presetKey: string };

const SLOW_FACTORS = [2, 4, 8] as const;

/* ── Mini speed-curve sparkline for ramp presets ── */
function RampCurve({ speeds }: { speeds: number[] }) {
  const w = 96;
  const h = 28;
  if (speeds.length < 2) return null;
  const min = Math.min(...speeds);
  const max = Math.max(...speeds);
  const pts = speeds
    .map((s, i) => {
      const x = (i / (speeds.length - 1)) * w;
      const y = h - ((s - min) / Math.max(max - min, 0.001)) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke="#C9A84C"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SpeedRampSection({
  scenes,
  onReplaceClipVideo,
  onGoToExport,
}: {
  scenes: SceneData[];
  /** Replaces a scene's clip URL with the speed-adjusted render. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
  /** Handoff: jump to the Export tab with the adjusted clip queued for multi-ratio export. */
  onGoToExport?: (videoUrl?: string) => void;
}) {
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [presets, setPresets] = useState<SpeedPreset[]>([]);
  const [sceneId, setSceneId] = useState<string>("");
  const [presetKey, setPresetKey] = useState<string>("");
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [working, setWorking] = useState<"slowmo" | "preset" | null>(null);
  const [using, setUsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clips = scenes.filter((s) => !!s.demoClipUrl);
  const activeScene = clips.find((s) => s.id === sceneId) ?? clips[0] ?? null;

  useEffect(() => {
    if (!sceneId && clips[0]) setSceneId(clips[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length]);

  /* ── Load speed presets (free) ── */
  const loadPresets = useCallback(async () => {
    try {
      const res = await confirmedFetch("/api/speed-presets", { skipConfirm: true });
      if (res?.ok) {
        const data = (await res.json()) as { presets: SpeedPreset[] };
        setPresets(data.presets ?? []);
      }
    } catch {
      /* non-fatal */
    }
  }, [confirmedFetch]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const constantPresets = presets.filter((p) => p.kind === "constant");
  const rampPresets = presets.filter((p) => p.kind === "ramp");
  const activePreset = presets.find((p) => p.key === presetKey) ?? null;

  /* ── 1. Buttery slow motion (optical flow, 300 VB) ── */
  async function handleSlowMotion(factor: 2 | 4 | 8) {
    if (!activeScene?.demoClipUrl || working) return;
    setWorking("slowmo");
    setError(null);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/slow-motion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: activeScene.demoClipUrl, slowFactor: factor }),
        overrideCost: SLOW_MO_COST,
        overrideFeature: "AI Slow Motion",
      });
      if (res === null) return; // user cancelled the credit confirm
      const data = (await res.json().catch(() => ({}))) as Partial<SlowMotionResult> & {
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        setError(data.message ?? data.error ?? "Slow motion failed — no Visual Bucs were spent.");
        return;
      }
      setResult({ kind: "slowmo", url: data.url, label: `${data.slowFactor ?? factor}x Buttery Slow-Mo`, factor: data.slowFactor ?? factor });
      toast({
        title: "Slow-mo rendered",
        description: `${data.slowFactor ?? factor}x optical-flow slow-mo — ${SLOW_MO_COST} Visual Bucs.`,
      });
    } catch {
      setError("Slow motion failed — no Visual Bucs were spent.");
    } finally {
      setWorking(null);
    }
  }

  /* ── 2+3. Speed preset or ramp preset (150 VB) ── */
  async function handleApplyPreset() {
    if (!activePreset || !activeScene?.demoClipUrl || working) return;
    setWorking("preset");
    setError(null);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/apply-speed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: activeScene.demoClipUrl, preset: activePreset.key }),
        overrideCost: SPEED_PRESET_COST,
        overrideFeature: "Speed preset",
      });
      if (res === null) return; // user cancelled the credit confirm
      const data = (await res.json().catch(() => ({}))) as Partial<ApplySpeedResult> & {
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.url) {
        setError(data.message ?? data.error ?? "Speed change failed — no Visual Bucs were spent.");
        return;
      }
      setResult({ kind: "preset", url: data.url, label: activePreset.label, presetKey: activePreset.key });
      toast({
        title: activePreset.kind === "ramp" ? "Ramp applied" : "Speed applied",
        description: `"${activePreset.label}" — ${SPEED_PRESET_COST} Visual Bucs.`,
      });
    } catch {
      setError("Speed change failed — no Visual Bucs were spent.");
    } finally {
      setWorking(null);
    }
  }

  /* ── Handoff: use the adjusted clip in the editor ── */
  function handleUseInEditor() {
    if (!result || !activeScene || !onReplaceClipVideo) return;
    setUsing(true);
    try {
      onReplaceClipVideo(activeScene.id, result.url);
      toast({
        title: "In the timeline",
        description: `Scene ${activeScene.sceneNumber} now plays the "${result.label}" render.`,
      });
    } finally {
      setUsing(false);
    }
  }

  function formatSpeed(s: number): string {
    return `${s}x`;
  }

  if (clips.length === 0) {
    return (
      <EditorCard
        title="Speed Ramp"
        subtitle="Slow-mo, speed presets & animated ramps — pro-style"
        icon={<Gauge className="h-4 w-4" />}
      >
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 text-center">
          <Film className="h-6 w-6 mx-auto text-white/25 mb-2" />
          <p className="text-sm font-semibold text-white/80">No clips on the timeline yet</p>
          <p className="text-xs text-white/40 mt-1">Add a clip to a scene first, then retime it here.</p>
        </div>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      title="Speed Ramp"
      subtitle="Slow-mo, speed presets & animated ramps — pro-style"
      icon={<Gauge className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-black uppercase tracking-wider text-[#C9A84C] border border-[#C9A84C]/40 bg-[#C9A84C]/10 rounded-full px-2 py-0.5">
          {SLOW_MO_COST} VB slow-mo · {SPEED_PRESET_COST} VB presets
        </span>
      }
    >
      <div className="space-y-5">
        {/* ── Scene picker ── */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">Clip to retime</p>
          <div className="flex flex-wrap gap-2">
            {clips.map((s) => (
              <button
                key={s.id}
                onClick={() => { setSceneId(s.id); setResult(null); setError(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  s.id === activeScene?.id
                    ? "bg-[#C9A84C] text-black border-[#C9A84C]"
                    : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                Scene {s.sceneNumber}
              </button>
            ))}
          </div>
        </div>

        {/* ── 1. Buttery slow motion — one-tap ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Turtle className="h-3.5 w-3.5 text-[#C9A84C]" />
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Buttery slow-mo</p>
          </div>
          <p className="text-[11px] text-white/40 mb-2">
            Optical-flow interpolation synthesizes frames between real ones — smooth, not choppy.
            One tap, {SLOW_MO_COST} VB each.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {SLOW_FACTORS.map((f) => (
              <button
                key={f}
                onClick={() => void handleSlowMotion(f)}
                disabled={working !== null}
                className={`relative rounded-xl border px-3 py-3 text-center transition-all disabled:opacity-50 ${
                  f === 2
                    ? "border-[#C9A84C] bg-[#C9A84C]/10 hover:bg-[#C9A84C]/20"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25"
                }`}
                title={`Render ${f}x optical-flow slow motion for ${SLOW_MO_COST} Visual Bucs`}
              >
                {f === 2 && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-black uppercase tracking-wider text-black bg-[#C9A84C] rounded-full px-1.5 py-px">
                    Simple
                  </span>
                )}
                <span className="flex items-center justify-center">
                  {working === "slowmo" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" />
                  ) : f === 8 ? (
                    <Zap className="h-4 w-4 text-[#C9A84C]" />
                  ) : (
                    <Turtle className="h-4 w-4 text-[#C9A84C]" />
                  )}
                </span>
                <p className="text-sm font-black text-white mt-1">{f}x</p>
                <p className="text-[10px] text-white/40">{f === 2 ? "Buttery" : f === 4 ? "Dramatic" : "Extreme"}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── 2. Speed presets (constant) ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Rabbit className="h-3.5 w-3.5 text-[#C9A84C]" />
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Speed presets</p>
          </div>
          <p className="text-[11px] text-white/40 mb-2">
            Constant speed from 0.25x to 4x — slow-down or speed-up. {SPEED_PRESET_COST} VB to apply.
          </p>
          {constantPresets.length === 0 ? (
            <p className="text-[11px] text-white/30 italic">Loading presets…</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {constantPresets.map((p) => {
                const active = presetKey === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => { setPresetKey(p.key); setResult(null); setError(null); }}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      active ? "border-[#C9A84C] bg-[#C9A84C]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                    }`}
                    title={p.blurb}
                  >
                    <div className="flex items-baseline justify-between">
                      <p className="text-xs font-black text-white">{p.label}</p>
                      {p.speed !== undefined && (
                        <span className="text-[11px] font-black text-[#C9A84C]">{formatSpeed(p.speed)}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-white/40 leading-tight mt-0.5 line-clamp-2">{p.blurb}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 3. Speed ramps (animated curves) ── */}
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Waves className="h-3.5 w-3.5 text-[#C9A84C]" />
            <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Speed ramps</p>
          </div>
          <p className="text-[11px] text-white/40 mb-2">
            Speed changes over time — e.g. slow-mo in, then ramp out. {SPEED_PRESET_COST} VB to apply.
          </p>
          {rampPresets.length === 0 ? (
            <p className="text-[11px] text-white/30 italic">Loading ramps…</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {rampPresets.map((p) => {
                const active = presetKey === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => { setPresetKey(p.key); setResult(null); setError(null); }}
                    className={`rounded-xl border p-2.5 text-left transition-all ${
                      active ? "border-[#C9A84C] bg-[#C9A84C]/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"
                    }`}
                    title={p.blurb}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Activity className="h-3 w-3 text-[#C9A84C] shrink-0" />
                      <p className="text-xs font-black text-white truncate">{p.label}</p>
                    </div>
                    {p.speeds && <RampCurve speeds={p.speeds} />}
                    <p className="text-[10px] text-white/40 leading-tight mt-1 line-clamp-2">{p.blurb}</p>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-white/30 mt-2 italic">
            Note: ramps are preset curves — custom-drawn per-segment ramping isn't supported by the current backend.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">{error}</p>
          </div>
        )}

        {/* ── Apply preset/ramp ── */}
        {activePreset && (
          <div className="rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void handleApplyPreset()}
                disabled={working !== null}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-50 transition-colors"
              >
                {working === "preset" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
                {working === "preset"
                  ? "Rendering…"
                  : `Apply "${activePreset.label}" · ${SPEED_PRESET_COST} VB`}
              </button>
              <span className="text-[11px] text-white/40">{activePreset.blurb}</span>
            </div>
          </div>
        )}

        {/* ── Result + handoffs ── */}
        {result && (
          <div className="rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/[0.05] p-3 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#C9A84C]" />
              <p className="text-sm font-black text-white">{result.label}</p>
            </div>
            <video src={result.url} controls playsInline className="w-full rounded-lg border border-white/10 max-h-64 bg-black" />
            <div className="flex flex-wrap gap-2">
              {onReplaceClipVideo && activeScene && (
                <button
                  onClick={handleUseInEditor}
                  disabled={using}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black text-black bg-[#C9A84C] hover:bg-[#d9b95c] disabled:opacity-50 transition-colors"
                >
                  {using ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
                  {using ? "Attaching…" : "Use in editor"}
                </button>
              )}
              {onGoToExport && (
                <button
                  onClick={() => onGoToExport(result.url)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
                >
                  Multi-ratio export
                </button>
              )}
              <a
                href={result.url}
                download={`speed-${result.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.mp4`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-white/15 text-white hover:bg-white/10 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
