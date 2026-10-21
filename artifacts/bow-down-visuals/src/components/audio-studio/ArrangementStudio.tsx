/* ── Arrangement Studio (Stack 6) ────────────────────────────────────────
 * The Audio desk as an instrument: songs/stems live on a timeline as
 * tracks with clips you can move and trim, per-track parametric FX chains
 * in your own order, volume / pan / reverb-mix automation lanes, vocal
 * take lanes with a comp map, sidechain ducking against the vocal lane,
 * and MIDI tracks with a piano roll — all previewed through the shared
 * Web Audio engine and rendered by the same server pipeline the video
 * editor's stem mixer exports through, so the arrangement you hear is
 * the arrangement that renders.
 *
 * Honest preview notes (also shown in the UI):
 *   • Ducking is applied by the export render; the browser preview plays
 *     tracks unducked.
 *   • Comp joins get a 15 ms fade in the render; the preview plays the
 *     chosen regions back-to-back without the fade.
 *   • Everything else — placement, trims, FX order and values, automation
 *     curves — is previewed with the same numbers the render receives.
 *
 * Editing is free. Only the final export charges (the standing Export
 * Audio price, confirmed before it runs). State persists locally plus a
 * server draft (workflowType "audio-arrangement") — project JSON, no
 * migration, and older saved mixes load unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioWaveform, Download, Loader2, Music4, Pause, Play, Plus, Save,
  SlidersHorizontal, Square, Trash2, Upload, Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { EditorCard, Field, Segmented, Chip } from "@/components/editor/controls";
import { AudioMixEngine, type EngineSnapshot, type EngineStem, type EngineMaster } from "@/lib/audio-engine";
import { STEM_TYPES, EQ_TONES, LOUDNESS_TARGETS, type MasterSettings } from "@/lib/editor-settings";
import { AUDIO_EXPORT_BUTTONS, requestAudioExport, type AudioExportButton } from "@/lib/audio-export";
import { uploadStemFile, readAudioDuration } from "@/lib/audio-stems";
import { getAudioPeaks } from "@/lib/audio-peaks";
import {
  arrangementDuration,
  arrangementUid,
  automationValueAt,
  cleanAutomation,
  clipPlayLength,
  emptyArrangement,
  expandArrangementToExportStems,
  fetchServerArrangement,
  hasAutomation,
  loadLocalArrangement,
  makeAudioTrack,
  makeFxStep,
  makeMidiTrack,
  moveFxStep,
  removePointNear,
  resolveCompSegments,
  saveLocalArrangement,
  saveServerArrangement,
  trackSegments,
  upsertPoint,
  type Arrangement,
  type ArrangementClip,
  type ArrangementTrack,
  type FxStepType,
  type TrackAutomation,
} from "@/lib/arrangement";
import { bounceMidiNotesToWav, midiTrackHash } from "@/lib/midi-synth";
import { PianoRoll } from "@/components/audio-studio/PianoRoll";

const HEADER_W = 248;
const INITIAL_SNAP: EngineSnapshot = {
  playState: "stopped", loading: false, position: 0, duration: 0,
  errors: [], ready: false, panSupported: true,
};

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ── Preview hook: arrangement → shared Web Audio engine ──────────────── */

function useArrangementPreview(
  arrangement: Arrangement,
  bounces: Record<string, { hash: string; url: string }>,
) {
  const engineRef = useRef<AudioMixEngine | null>(null);
  const [snap, setSnap] = useState<EngineSnapshot>(INITIAL_SNAP);
  if (!engineRef.current) engineRef.current = new AudioMixEngine();

  useEffect(() => {
    const engine = engineRef.current!;
    engine.subscribe(setSnap);
    return () => engine.dispose();
  }, []);

  const engineStems = useMemo<EngineStem[]>(() => {
    const out: EngineStem[] = [];
    for (const t of arrangement.tracks) {
      if (t.kind === "midi") {
        const b = bounces[t.id];
        if (!b) continue;
        out.push({
          id: `bounce-${t.id}`, url: b.url, volume: t.volume, pan: t.pan,
          muted: t.muted, solo: t.solo, startTime: 0, trimStart: 0, trimEnd: 0,
          fxChain: t.fxChain.length > 0 ? t.fxChain : undefined,
          automation: hasAutomation(t.automation) ? cleanAutomation(t.automation) : undefined,
        });
        continue;
      }
      trackSegments(t).forEach((seg, i) => {
        out.push({
          id: `seg-${t.id}-${i}`, url: seg.url, volume: t.volume, pan: t.pan,
          muted: t.muted, solo: t.solo, startTime: seg.startTime,
          trimStart: seg.trimStart, trimEnd: seg.trimEnd,
          fxChain: t.fxChain.length > 0 ? t.fxChain : undefined,
          automation: hasAutomation(t.automation) ? cleanAutomation(t.automation) : undefined,
        });
      });
    }
    return out;
  }, [arrangement, bounces]);

  const engineMaster = useMemo<EngineMaster>(() => {
    const m = arrangement.master;
    return {
      volume: m.volume, fadeIn: m.fadeIn, fadeOut: m.fadeOut,
      compression: m.compression, stereoWidth: m.stereoWidth,
      bassBoost: m.bassBoost, eqTone: m.eqTone,
      loudnessTarget: m.loudnessTarget, limiter: m.limiter,
    };
  }, [arrangement.master]);

  useEffect(() => {
    engineRef.current?.sync(engineStems, engineMaster);
  }, [engineStems, engineMaster]);

  const play = useCallback(() => void engineRef.current?.play(), []);
  const pause = useCallback(() => engineRef.current?.pause(), []);
  const stop = useCallback(() => engineRef.current?.stop(), []);
  const seek = useCallback((pos: number) => engineRef.current?.seek(pos), []);
  return { snap, play, pause, stop, seek };
}

/* ── Waveform clip ────────────────────────────────────────────────────── */

function ClipWaveform({ clip, height }: { clip: ArrangementClip; height: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getAudioPeaks(clip.url, 300).then((peaks) => {
      const canvas = ref.current;
      if (cancelled || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, w, h);
      if (!peaks || peaks.length === 0) {
        ctx.fillStyle = "rgba(251,191,36,0.5)";
        ctx.fillRect(0, h / 2 - 1, w, 2);
        return;
      }
      const dur = clip.durationSec && clip.durationSec > 0 ? clip.durationSec : 0;
      const fromFrac = dur > 0 ? Math.min(0.99, Math.max(0, clip.trimStart / dur)) : 0;
      const toFrac = dur > 0 ? Math.max(fromFrac + 0.01, 1 - Math.max(0, clip.trimEnd) / dur) : 1;
      const from = Math.floor(fromFrac * peaks.length);
      const to = Math.max(from + 1, Math.floor(toFrac * peaks.length));
      const span = to - from;
      ctx.fillStyle = "rgba(251,191,36,0.85)";
      const bars = Math.max(8, Math.floor(w / 3));
      for (let i = 0; i < bars; i++) {
        const p = peaks[from + Math.floor((i / bars) * span)] ?? 0.1;
        const bh = Math.max(1, p * (h - 4));
        ctx.fillRect(i * 3, (h - bh) / 2, 2, bh);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clip.url, clip.trimStart, clip.trimEnd, clip.durationSec]);
  return <canvas ref={ref} width={600} height={height} className="h-full w-full" aria-hidden="true" />;
}

/* ── FX chain editor ──────────────────────────────────────────────────── */

const FX_STEP_LABELS: Record<FxStepType, string> = {
  eq: "EQ", compressor: "Compressor", saturation: "Saturation", reverb: "Reverb", delay: "Delay",
};

function FxChainEditor({ track, onChange }: { track: ArrangementTrack; onChange: (t: ArrangementTrack) => void }) {
  const chain = track.fxChain;
  function patchStep(id: string, patch: Partial<ArrangementTrack["fxChain"][number]>) {
    onChange({ ...track, fxChain: chain.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  function patchBand(stepId: string, bandIdx: number, patch: Partial<{ freq: number; gain: number; q: number }>) {
    onChange({
      ...track,
      fxChain: chain.map((s) =>
        s.id === stepId ? { ...s, bands: (s.bands ?? []).map((b, i) => (i === bandIdx ? { ...b, ...patch } : b)) } : s,
      ),
    });
  }
  return (
    <div className="space-y-3" data-testid="fx-chain-editor">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold text-white/50 mr-1">Add:</span>
        {(Object.keys(FX_STEP_LABELS) as FxStepType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange({ ...track, fxChain: [...chain, makeFxStep(type, arrangementUid("fx"))] })}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/[0.04] text-white/65 hover:text-white transition-colors"
            data-testid={`fx-add-${type}`}
          >
            + {FX_STEP_LABELS[type]}
          </button>
        ))}
        {chain.length === 0 && (
          <span className="text-[11px] text-white/35">No effects yet — the track plays dry. Steps run top to bottom, in the order you set.</span>
        )}
      </div>
      {chain.map((step, idx) => (
        <div key={step.id} className={`rounded-xl border p-3 space-y-3 ${step.enabled ? "border-white/[0.09] bg-white/[0.02]" : "border-white/[0.05] bg-white/[0.01] opacity-60"}`} data-testid={`fx-step-${step.id}`}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-white/85">{idx + 1}. {FX_STEP_LABELS[step.type]}</span>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" title="Move earlier in the chain" onClick={() => onChange({ ...track, fxChain: moveFxStep(chain, step.id, idx - 1) })} className="px-2 py-1 rounded-md text-[11px] font-bold bg-white/[0.04] text-white/60 hover:text-white">↑</button>
              <button type="button" title="Move later in the chain" onClick={() => onChange({ ...track, fxChain: moveFxStep(chain, step.id, idx + 1) })} className="px-2 py-1 rounded-md text-[11px] font-bold bg-white/[0.04] text-white/60 hover:text-white">↓</button>
              <Chip active={step.enabled} onClick={() => patchStep(step.id, { enabled: !step.enabled })}>{step.enabled ? "On" : "Off"}</Chip>
              <button type="button" title="Remove step" onClick={() => onChange({ ...track, fxChain: chain.filter((s) => s.id !== step.id) })} className="px-2 py-1 rounded-md text-[11px] font-bold bg-white/[0.04] text-red-300 hover:text-red-200"><Trash2 className="h-3 w-3" /></button>
            </div>
          </div>
          {step.type === "eq" && (
            <div className="space-y-2">
              {(step.bands ?? []).map((band, bi) => (
                <div key={bi} className="grid grid-cols-[52px_1fr_1fr_1fr_auto] items-center gap-2">
                  <span className="text-[10px] font-bold text-white/45">Band {bi + 1}</span>
                  <Field label="Freq Hz" hint={String(Math.round(band.freq))}>
                    <Slider value={[Math.log10(band.freq)]} min={Math.log10(20)} max={Math.log10(20000)} step={0.01} onValueChange={([v]) => patchBand(step.id, bi, { freq: Math.round(Math.pow(10, v ?? 3)) })} />
                  </Field>
                  <Field label="Gain dB" hint={`${band.gain.toFixed(1)}`}>
                    <Slider value={[band.gain]} min={-24} max={24} step={0.5} onValueChange={([v]) => patchBand(step.id, bi, { gain: v ?? 0 })} />
                  </Field>
                  <Field label="Q" hint={band.q.toFixed(1)}>
                    <Slider value={[band.q]} min={0.3} max={12} step={0.1} onValueChange={([v]) => patchBand(step.id, bi, { q: v ?? 1 })} />
                  </Field>
                  <button type="button" onClick={() => patchStep(step.id, { bands: (step.bands ?? []).filter((_, i) => i !== bi) })} className="text-red-300/70 hover:text-red-200 text-xs font-bold px-1">✕</button>
                </div>
              ))}
              {(step.bands ?? []).length < 5 && (
                <button type="button" onClick={() => patchStep(step.id, { bands: [...(step.bands ?? []), { freq: 1000, gain: 0, q: 1 }] })} className="text-[11px] font-bold text-amber-300/90 hover:text-amber-200">+ Add band</button>
              )}
            </div>
          )}
          {step.type === "compressor" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label="Threshold dB" hint={`${step.thresholdDb ?? -18}`}><Slider value={[step.thresholdDb ?? -18]} min={-60} max={0} step={1} onValueChange={([v]) => patchStep(step.id, { thresholdDb: v ?? -18 })} /></Field>
              <Field label="Ratio" hint={`${(step.ratio ?? 3).toFixed(1)}:1`}><Slider value={[step.ratio ?? 3]} min={1} max={20} step={0.5} onValueChange={([v]) => patchStep(step.id, { ratio: v ?? 3 })} /></Field>
              <Field label="Attack ms" hint={`${step.attackMs ?? 10}`}><Slider value={[step.attackMs ?? 10]} min={0.1} max={500} step={0.1} onValueChange={([v]) => patchStep(step.id, { attackMs: v ?? 10 })} /></Field>
              <Field label="Release ms" hint={`${step.releaseMs ?? 150}`}><Slider value={[step.releaseMs ?? 150]} min={10} max={1000} step={5} onValueChange={([v]) => patchStep(step.id, { releaseMs: v ?? 150 })} /></Field>
            </div>
          )}
          {step.type === "saturation" && (
            <Field label="Drive" hint={(step.drive ?? 1.5).toFixed(1)}><Slider value={[step.drive ?? 1.5]} min={1} max={3} step={0.1} onValueChange={([v]) => patchStep(step.id, { drive: v ?? 1.5 })} /></Field>
          )}
          {step.type === "reverb" && (
            <Field label="Mix %" hint={`${step.mix ?? 25}`}><Slider value={[step.mix ?? 25]} min={0} max={100} step={1} onValueChange={([v]) => patchStep(step.id, { mix: v ?? 25 })} /></Field>
          )}
          {step.type === "delay" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Time ms" hint={`${step.timeMs ?? 250}`}><Slider value={[step.timeMs ?? 250]} min={10} max={1000} step={5} onValueChange={([v]) => patchStep(step.id, { timeMs: v ?? 250 })} /></Field>
              <Field label="Feedback %" hint={`${step.feedback ?? 30}`}><Slider value={[step.feedback ?? 30]} min={0} max={80} step={1} onValueChange={([v]) => patchStep(step.id, { feedback: v ?? 30 })} /></Field>
              <Field label="Mix %" hint={`${step.mix ?? 20}`}><Slider value={[step.mix ?? 20]} min={0} max={100} step={1} onValueChange={([v]) => patchStep(step.id, { mix: v ?? 20 })} /></Field>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Automation lane editor ───────────────────────────────────────────── */

type LaneKind = keyof TrackAutomation;
const LANE_META: Record<LaneKind, { label: string; min: number; max: number; fallback: number; unit: string }> = {
  volume: { label: "Volume", min: 0, max: 150, fallback: 100, unit: "%" },
  pan: { label: "Pan", min: -100, max: 100, fallback: 0, unit: "" },
  reverbMix: { label: "Reverb mix", min: 0, max: 100, fallback: 25, unit: "%" },
};

function AutomationLaneEditor({
  track, widthPx, pxPerSec, durationSec, onChange,
}: {
  track: ArrangementTrack;
  widthPx: number;
  pxPerSec: number;
  durationSec: number;
  onChange: (t: ArrangementTrack) => void;
}) {
  const [kind, setKind] = useState<LaneKind>("volume");
  const meta = LANE_META[kind];
  const points = (track.automation[kind] ?? []).slice().sort((a, b) => a.time - b.time);
  const H = 76;
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragIdx = useRef<number | null>(null);

  const toXY = (time: number, value: number) => ({
    x: time * pxPerSec,
    y: H - ((value - meta.min) / (meta.max - meta.min)) * H,
  });
  function fromEvent(e: React.PointerEvent): { time: number; value: number } {
    const rect = boxRef.current!.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const y = Math.min(H, Math.max(0, e.clientY - rect.top));
    return {
      time: Math.round((x / pxPerSec) * 20) / 20,
      value: Math.round((meta.min + (1 - y / H) * (meta.max - meta.min)) * 10) / 10,
    };
  }
  function setLane(next: Array<{ time: number; value: number }>) {
    onChange({ ...track, automation: { ...track.automation, [kind]: next } });
  }

  const linePts = points.map((p) => toXY(p.time, p.value));
  const path = linePts.length
    ? `M ${linePts.map((p) => `${p.x},${p.y}`).join(" L ")}`
    : "";
  /* Extend the line flat to both edges so the held values read clearly. */
  const edgePath = points.length
    ? `M 0,${toXY(0, automationValueAt(points, 0, meta.fallback)).y} L ${linePts.map((p) => `${p.x},${p.y}`).join(" L ")} L ${widthPx},${toXY(0, automationValueAt(points, durationSec, meta.fallback)).y}`
    : `M 0,${toXY(0, meta.fallback).y} L ${widthPx},${toXY(0, meta.fallback).y}`;

  return (
    <div className="space-y-2" data-testid="automation-editor">
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(LANE_META) as LaneKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${kind === k ? "bg-primary text-black" : "bg-white/[0.04] text-white/55 hover:text-white"}`}
            data-testid={`lane-tab-${k}`}
          >
            {LANE_META[k].label}
          </button>
        ))}
        <span className="text-[11px] text-white/35 ml-1">Click to add a point · drag to move · right-click a point to remove it. The line is exactly what the export renders.</span>
        {points.length > 0 && (
          <button type="button" onClick={() => setLane([])} className="ml-auto text-[11px] font-bold text-red-300/80 hover:text-red-200">Clear lane</button>
        )}
      </div>
      <div
        ref={boxRef}
        className="relative rounded-lg border border-white/[0.08] bg-black/30 overflow-hidden cursor-crosshair"
        style={{ width: widthPx, height: H }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const { time, value } = fromEvent(e);
          const next = upsertPoint(track.automation[kind], time, value);
          setLane(next);
        }}
        data-testid="automation-lane"
      >
        {kind === "pan" && <div className="absolute left-0 right-0 border-t border-dashed border-white/15" style={{ top: H / 2 }} />}
        <svg className="absolute inset-0 pointer-events-none" width={widthPx} height={H}>
          <path d={path || edgePath} fill="none" stroke="rgba(251,191,36,0.9)" strokeWidth={1.5} />
        </svg>
        {points.map((p, i) => {
          const { x, y } = toXY(p.time, p.value);
          return (
            <button
              key={`${p.time}-${i}`}
              type="button"
              className="absolute h-3.5 w-3.5 -ml-[7px] -mt-[7px] rounded-full bg-amber-300 border border-amber-100 cursor-grab active:cursor-grabbing z-10"
              style={{ left: x, top: y }}
              title={`${meta.label}: ${p.value}${meta.unit} @ ${p.time.toFixed(2)}s`}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.button === 2) return;
                dragIdx.current = i;
                (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (dragIdx.current !== i) return;
                const { time, value } = fromEvent(e);
                const others = points.filter((_, j) => j !== i);
                setLane(upsertPoint(others, time, value));
                dragIdx.current = others.filter((q) => q.time < time).length;
              }}
              onPointerUp={() => { dragIdx.current = null; }}
              onContextMenu={(e) => {
                e.preventDefault();
                setLane(removePointNear(track.automation[kind], p.time, 0.001));
              }}
              data-testid={`automation-point-${kind}-${i}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Comp editor (take lanes) ─────────────────────────────────────────── */

function CompEditor({
  track, widthPx, pxPerSec, onChange, onUploadTake, uploading,
}: {
  track: ArrangementTrack;
  widthPx: number;
  pxPerSec: number;
  onChange: (t: ArrangementTrack) => void;
  onUploadTake: (track: ArrangementTrack, file: File) => void;
  uploading: boolean;
}) {
  const takes = track.takes ?? [];
  const comp = track.comp ?? [];
  const [activeTakeId, setActiveTakeId] = useState<string>(takes[0]?.id ?? "");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const segments = resolveCompSegments(takes, comp);
  void segments;

  function timeFromEvent(e: React.PointerEvent): number {
    const rect = stripRef.current!.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left) / pxPerSec);
  }

  function commitDraft() {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d || !activeTakeId) return;
    const start = Math.min(d.start, d.end);
    const end = Math.max(d.start, d.end);
    if (end - start < 0.1) return;
    const region = {
      id: arrangementUid("comp"),
      takeId: activeTakeId,
      srcStart: Math.round(start * 1000) / 1000,
      srcEnd: Math.round(end * 1000) / 1000,
      startTime: Math.round(start * 1000) / 1000,
    };
    /* New region replaces whatever it overlaps. */
    const kept = comp.filter((r) => r.startTime + (r.srcEnd - r.srcStart) <= start || r.startTime >= end);
    onChange({ ...track, comp: [...kept, region] });
    setSelectedRegionId(region.id);
  }

  const takeColor = (idx: number) => ["bg-amber-400/70", "bg-sky-400/60", "bg-emerald-400/60", "bg-violet-400/60", "bg-rose-400/60"][idx % 5];

  return (
    <div className="space-y-3" data-testid="comp-editor">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-white/50">Takes:</span>
        {takes.map((take, i) => (
          <button
            key={take.id}
            type="button"
            onClick={() => setActiveTakeId(take.id)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${activeTakeId === take.id ? "bg-primary text-black" : "bg-white/[0.04] text-white/60 hover:text-white"}`}
            data-testid={`take-${take.id}`}
          >
            <span className={`inline-block h-2 w-2 rounded-full mr-1.5 ${takeColor(i)}`} />
            {take.name}
          </button>
        ))}
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/[0.04] text-white/70 hover:text-white inline-flex items-center gap-1.5"
          data-testid="btn-upload-take"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Add a take
        </button>
        <input ref={fileRef} type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadTake(track, f);
          e.target.value = "";
        }} />
        {comp.length > 0 && (
          <button type="button" onClick={() => onChange({ ...track, comp: [] })} className="ml-auto text-[11px] font-bold text-red-300/80 hover:text-red-200">Clear comp (back to clips)</button>
        )}
      </div>
      <p className="text-[11px] text-white/40 leading-relaxed">
        Pick the active take, then drag on the comp lane to choose which take sings each section. Takes are alternate recordings of the same part, lined up at zero.
        Only the chosen regions play — everything else is muted. Joins get a short 15&nbsp;ms fade in the export render; the preview plays regions back-to-back without the fade.
        {comp.length > 0 ? " While a comp exists, it replaces this track's clips in playback and export." : ""}
      </p>
      {/* Comp strip */}
      <div
        ref={stripRef}
        className="relative h-14 rounded-lg border border-white/[0.08] bg-black/30 overflow-hidden cursor-crosshair"
        style={{ width: widthPx }}
        onPointerDown={(e) => {
          if (e.button !== 0 || takes.length === 0) return;
          const t = timeFromEvent(e);
          draftRef.current = { start: t, end: t };
          setDraft({ start: t, end: t });
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!draftRef.current) return;
          draftRef.current = { ...draftRef.current, end: timeFromEvent(e) };
          setDraft(draftRef.current);
        }}
        onPointerUp={commitDraft}
        data-testid="comp-strip"
      >
        {comp.map((r) => {
          const takeIdx = takes.findIndex((t) => t.id === r.takeId);
          const len = r.srcEnd - r.srcStart;
          return (
            <button
              key={r.id}
              type="button"
              className={`absolute top-1 bottom-1 rounded-md ${takeColor(takeIdx)} ${selectedRegionId === r.id ? "ring-2 ring-white/80" : ""}`}
              style={{ left: r.startTime * pxPerSec, width: Math.max(4, len * pxPerSec) }}
              onPointerDown={(e) => { e.stopPropagation(); setSelectedRegionId(r.id); }}
              title={`${takes[takeIdx]?.name ?? "Take"} · ${r.startTime.toFixed(1)}s – ${(r.startTime + len).toFixed(1)}s`}
              data-testid={`comp-region-${r.id}`}
            />
          );
        })}
        {draft && (
          <div className="absolute top-1 bottom-1 rounded-md bg-white/25 border border-white/50" style={{ left: Math.min(draft.start, draft.end) * pxPerSec, width: Math.abs(draft.end - draft.start) * pxPerSec }} />
        )}
        {takes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-white/35">Add at least one take to start comping.</div>
        )}
      </div>
      {selectedRegionId && comp.some((r) => r.id === selectedRegionId) && (
        <button
          type="button"
          onClick={() => { onChange({ ...track, comp: comp.filter((r) => r.id !== selectedRegionId) }); setSelectedRegionId(null); }}
          className="text-[11px] font-bold text-red-300/80 hover:text-red-200"
          data-testid="btn-delete-comp-region"
        >
          Delete selected region
        </button>
      )}
    </div>
  );
}

/* ── Main surface ─────────────────────────────────────────────────────── */

type PanelKind = "fx" | "auto" | "comp" | "duck" | "roll";

export default function ArrangementStudio() {
  const { toast } = useToast();
  const { user, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [arrangement, setArrangement] = useState<Arrangement>(
    () => loadLocalArrangement() ?? emptyArrangement(),
  );
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<{ trackId: string; kind: PanelKind } | null>(null);
  const [pxPerSec, setPxPerSec] = useState(36);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [bounces, setBounces] = useState<Record<string, { hash: string; url: string }>>({});
  const bounceInFlight = useRef(new Set<string>());
  const addFilesRef = useRef<HTMLInputElement | null>(null);
  const addClipRef = useRef<HTMLInputElement | null>(null);
  const addClipTrackRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { snap, play, pause, stop, seek } = useArrangementPreview(arrangement, bounces);
  const duration = Math.max(arrangementDuration(arrangement), snap.duration, 30);
  const timelineW = Math.ceil((duration + 8) * pxPerSec);

  /* Server draft restore (only fills an empty local state — local wins). */
  useEffect(() => {
    let cancelled = false;
    if (loadLocalArrangement()) return;
    void (async () => {
      const token = await getAccessToken().catch(() => null);
      const server = await fetchServerArrangement(token);
      if (!cancelled && server && server.tracks.length > 0) setArrangement(server);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Debounced auto-save: local always, server when signed in. */
  useEffect(() => {
    saveLocalArrangement(arrangement);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        const token = await getAccessToken().catch(() => null);
        if (token) await saveServerArrangement(token, arrangement);
        setSavedAt(new Date().toLocaleTimeString());
      })();
    }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangement]);

  /* MIDI bounces for preview (re-render only when the notes change). */
  useEffect(() => {
    for (const t of arrangement.tracks) {
      if (t.kind !== "midi" || !(t.notes && t.notes.length > 0)) continue;
      const hash = midiTrackHash(t.notes, t.instrument ?? "keys");
      if (bounces[t.id]?.hash === hash || bounceInFlight.current.has(`${t.id}:${hash}`)) continue;
      bounceInFlight.current.add(`${t.id}:${hash}`);
      const notes = t.notes;
      const instrument = t.instrument ?? "keys";
      const end = Math.max(...notes.map((n) => n.start + n.duration), 1) + 1.5;
      void bounceMidiNotesToWav(notes, instrument, end)
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          setBounces((prev) => {
            const old = prev[t.id];
            if (old && old.hash !== hash) URL.revokeObjectURL(old.url);
            return { ...prev, [t.id]: { hash, url } };
          });
        })
        .catch(() => {})
        .finally(() => bounceInFlight.current.delete(`${t.id}:${hash}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangement.tracks]);

  function updateTrack(next: ArrangementTrack) {
    setArrangement((a) => ({ ...a, tracks: a.tracks.map((t) => (t.id === next.id ? next : t)) }));
  }
  function patchMaster(patch: Partial<MasterSettings>) {
    setArrangement((a) => ({ ...a, master: { ...a.master, ...patch } }));
  }
  function togglePanel(trackId: string, kind: PanelKind) {
    setSelectedTrackId(trackId);
    setOpenPanel((p) => (p && p.trackId === trackId && p.kind === kind ? null : { trackId, kind }));
  }

  async function uploadAudioFile(file: File): Promise<{ url: string; durationSec?: number } | null> {
    if (!user) {
      toast({ title: "Sign in required", description: "Sign in to add audio to your arrangement.", variant: "destructive" });
      return null;
    }
    const up = await uploadStemFile(user.id, file);
    const dur = await readAudioDuration(file).catch(() => undefined);
    return { url: up.url, durationSec: dur ?? undefined };
  }

  async function addTracksFromFiles(files: FileList | File[]) {
    setUploading(true);
    try {
      const added: ArrangementTrack[] = [];
      for (const file of Array.from(files)) {
        const up = await uploadAudioFile(file);
        if (!up) continue;
        const track = makeAudioTrack(file.name.replace(/\.[^.]+$/, "") || "Track");
        track.clips = [{
          id: arrangementUid("clip"), url: up.url, name: file.name,
          startTime: 0, trimStart: 0, trimEnd: 0, durationSec: up.durationSec,
        }];
        added.push(track);
      }
      if (added.length > 0) {
        setArrangement((a) => ({ ...a, tracks: [...a.tracks, ...added] }));
        setSelectedTrackId(added[0]!.id);
        toast({ title: "Tracks added", description: `${added.length} track${added.length > 1 ? "s" : ""} on the timeline.` });
      }
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function addClipToTrack(track: ArrangementTrack, file: File) {
    setUploading(true);
    try {
      const up = await uploadAudioFile(file);
      if (!up) return;
      const end = trackSegments(track).reduce((m, s) => Math.max(m, s.startTime + clipPlayLength(s)), 0);
      const clip: ArrangementClip = {
        id: arrangementUid("clip"), url: up.url, name: file.name,
        startTime: Math.round(end * 1000) / 1000, trimStart: 0, trimEnd: 0, durationSec: up.durationSec,
      };
      updateTrack({ ...track, clips: [...track.clips, clip] });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function addTakeToTrack(track: ArrangementTrack, file: File) {
    setUploading(true);
    try {
      const up = await uploadAudioFile(file);
      if (!up) return;
      const takes = [
        ...(track.takes ?? []),
        { id: arrangementUid("take"), name: file.name.replace(/\.[^.]+$/, "") || `Take ${(track.takes?.length ?? 0) + 1}`, url: up.url, durationSec: up.durationSec },
      ];
      updateTrack({ ...track, takes });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Could not upload.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleExport(btn: AudioExportButton) {
    if (exporting) return;
    setExportError(null);
    setExportUrl(null);
    if (!user) {
      setExportError("Sign in to export your arrangement.");
      return;
    }
    setExporting(btn.id);
    try {
      /* MIDI tracks render through the same synth as the preview: bounce
       * to WAV, upload like any stem, and let the server mix it in. */
      const bounceUrls: Record<string, string> = {};
      for (const t of arrangement.tracks) {
        if (t.kind !== "midi" || !(t.notes && t.notes.length > 0)) continue;
        const end = Math.max(...t.notes.map((n) => n.start + n.duration), 1) + 1.5;
        const blob = await bounceMidiNotesToWav(t.notes, t.instrument ?? "keys", end);
        const file = new File([blob], `${t.name || "midi"}.wav`, { type: "audio/wav" });
        const up = await uploadStemFile(user.id, file);
        bounceUrls[t.id] = up.url;
      }
      const stems = expandArrangementToExportStems(arrangement, bounceUrls);
      if (stems.length === 0) {
        setExportError("Add at least one clip or some MIDI notes before exporting.");
        return;
      }
      const token = await getAccessToken();
      if (!token) throw new Error("You need to be signed in to export audio.");
      const m = arrangement.master;
      const resp = await requestAudioExport(token, {
        exportType: btn.id,
        masterVolume: m.volume,
        masterSettings: {
          volume: m.volume, compression: m.compression, stereoWidth: m.stereoWidth,
          bassBoost: m.bassBoost, eqTone: m.eqTone, loudnessTarget: m.loudnessTarget,
          limiter: m.limiter, fadeIn: m.fadeIn, fadeOut: m.fadeOut,
        },
        stems,
      }, confirmedFetch);
      if (!resp) return; /* user cancelled the credit confirmation */
      setExportUrl(resp.url);
      if (resp.warnings && resp.warnings.length > 0) {
        toast({ title: "Export complete (with a note)", description: resp.warnings[0] });
      } else {
        toast({ title: "Export complete", description: `${btn.label} is ready to download.` });
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  }

  /* Clip drag: move / trim-start / trim-end via pointer capture. */
  const clipDrag = useRef<{
    trackId: string; clipId: string; mode: "move" | "trimStart" | "trimEnd";
    startX: number; orig: ArrangementClip;
  } | null>(null);

  function onClipPointerDown(e: React.PointerEvent, track: ArrangementTrack, clip: ArrangementClip) {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const mode = localX < 9 ? "trimStart" : localX > rect.width - 9 ? "trimEnd" : "move";
    clipDrag.current = { trackId: track.id, clipId: clip.id, mode, startX: e.clientX, orig: clip };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setSelectedTrackId(track.id);
  }
  function onClipPointerMove(e: React.PointerEvent) {
    const drag = clipDrag.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / pxPerSec;
    const orig = drag.orig;
    const playLen = clipPlayLength(orig);
    let next: ArrangementClip = orig;
    if (drag.mode === "move") {
      next = { ...orig, startTime: Math.max(0, Math.round((orig.startTime + dx) * 100) / 100) };
    } else if (drag.mode === "trimStart") {
      const maxTrim = Math.max(0, orig.trimStart + playLen - 0.1);
      const trimStart = Math.min(maxTrim, Math.max(0, orig.trimStart + dx));
      next = { ...orig, trimStart: Math.round(trimStart * 100) / 100, startTime: Math.max(0, Math.round((orig.startTime + (trimStart - orig.trimStart)) * 100) / 100) };
    } else {
      const maxTrim = Math.max(0, orig.trimEnd + playLen - 0.1);
      const trimEnd = Math.min(maxTrim, Math.max(0, orig.trimEnd - dx));
      next = { ...orig, trimEnd: Math.round(trimEnd * 100) / 100 };
    }
    setArrangement((a) => ({
      ...a,
      tracks: a.tracks.map((t) =>
        t.id === drag.trackId ? { ...t, clips: t.clips.map((c) => (c.id === drag.clipId ? next : c)) } : t,
      ),
    }));
  }
  function onClipPointerUp() {
    clipDrag.current = null;
  }

  const panelTrack = openPanel ? arrangement.tracks.find((t) => t.id === openPanel.trackId) ?? null : null;
  const ms = arrangement.master;

  return (
    <div className="space-y-5" data-testid="arrangement-studio">
      {/* Transport + title */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Button type="button" onClick={snap.playState === "playing" ? pause : play} disabled={arrangement.tracks.length === 0} className="h-10 w-10 rounded-full bg-primary text-black hover:bg-primary/90 p-0" data-testid="btn-arr-play">
            {snap.playState === "playing" ? <Pause className="h-4 w-4 mx-auto" /> : <Play className="h-4 w-4 mx-auto" />}
          </Button>
          <Button type="button" variant="outline" onClick={stop} className="h-10 w-10 rounded-full border-white/12 bg-white/[0.03] text-white/75 p-0" data-testid="btn-arr-stop">
            <Square className="h-3.5 w-3.5 mx-auto" />
          </Button>
        </div>
        <span className="text-xs font-mono text-white/60" data-testid="arr-position">
          {fmtTime(snap.position)} / {fmtTime(duration)}
        </span>
        <input
          value={arrangement.title}
          onChange={(e) => setArrangement((a) => ({ ...a, title: e.target.value }))}
          className="h-9 rounded-lg bg-white/[0.03] border border-white/10 px-3 text-sm font-bold text-white/85 min-w-[180px]"
          aria-label="Arrangement title"
          data-testid="arr-title"
        />
        <label className="flex items-center gap-2 text-[11px] font-bold text-white/45">
          BPM
          <input
            type="number" min={30} max={300} value={arrangement.bpm}
            onChange={(e) => setArrangement((a) => ({ ...a, bpm: Math.min(300, Math.max(30, Number(e.target.value) || 120)) }))}
            className="h-9 w-16 rounded-lg bg-white/[0.03] border border-white/10 px-2 text-sm font-bold text-white/85"
            data-testid="arr-bpm"
          />
        </label>
        <label className="flex items-center gap-2 text-[11px] font-bold text-white/45 ml-auto">
          Zoom
          <div className="w-24"><Slider value={[pxPerSec]} min={10} max={110} step={2} onValueChange={([v]) => setPxPerSec(v ?? 36)} /></div>
        </label>
        <span className="text-[10px] text-white/30 inline-flex items-center gap-1">
          <Save className="h-3 w-3" /> {savedAt ? `Saved ${savedAt}` : "Auto-saves as you work"}
        </span>
      </div>

      {/* Add tracks */}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => addFilesRef.current?.click()} disabled={uploading} className="h-10 text-sm font-black bg-primary text-black hover:bg-primary/90" data-testid="btn-add-audio-track">
          {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />} Add audio tracks
        </Button>
        <input ref={addFilesRef} type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) void addTracksFromFiles(e.target.files); e.target.value = ""; }} />
        <Button
          type="button" variant="outline"
          onClick={() => { const t = makeMidiTrack(); setArrangement((a) => ({ ...a, tracks: [...a.tracks, t] })); setSelectedTrackId(t.id); setOpenPanel({ trackId: t.id, kind: "roll" }); }}
          className="h-10 text-sm font-bold border-white/12 bg-white/[0.03] text-white/80"
          data-testid="btn-add-midi-track"
        >
          <Music4 className="h-4 w-4 mr-2" /> Add MIDI track
        </Button>
        {arrangement.tracks.length > 0 && (
          <Button
            type="button" variant="outline"
            onClick={() => { if (window.confirm("Start a new arrangement? This one stays in your saved draft history on this device until you save over it.")) { setArrangement(emptyArrangement()); setSelectedTrackId(null); setOpenPanel(null); setExportUrl(null); } }}
            className="h-10 text-sm font-bold border-white/12 bg-white/[0.03] text-white/50 ml-auto"
            data-testid="btn-new-arrangement"
          >
            <Plus className="h-4 w-4 mr-2" /> New
          </Button>
        )}
      </div>

      {arrangement.tracks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/12 bg-white/[0.02] px-5 py-10 text-center" data-testid="arr-empty">
          <AudioWaveform className="h-8 w-8 text-amber-400/70 mx-auto mb-3" />
          <p className="text-sm font-bold text-white/75">Your arrangement is empty</p>
          <p className="text-xs text-white/40 mt-1 max-w-md mx-auto leading-relaxed">
            Add audio tracks (a beat, a vocal, stems from the Stems tab) or a MIDI track, then arrange, effect, automate and comp them into a finished song — free to edit, rendered for real when you export.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.08] bg-black/25 overflow-x-auto" data-testid="arr-timeline-scroll">
          <div className="relative" style={{ width: HEADER_W + timelineW }}>
            {/* Ruler */}
            <div className="flex border-b border-white/[0.08]">
              <div className="sticky left-0 z-20 shrink-0 bg-[#171208] border-r border-white/[0.08] px-3 py-1.5 text-[10px] font-bold text-white/35" style={{ width: HEADER_W }}>
                Click the ruler to move the playhead
              </div>
              <div
                className="relative shrink-0 h-7 cursor-pointer"
                style={{ width: timelineW }}
                onPointerDown={(e) => {
                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                  seek(Math.max(0, (e.clientX - rect.left) / pxPerSec));
                }}
                data-testid="arr-ruler"
              >
                {Array.from({ length: Math.floor(duration / 5) + 1 }, (_, i) => (
                  <span key={i} className="absolute top-1 text-[9px] font-mono text-white/35 border-l border-white/15 pl-1" style={{ left: i * 5 * pxPerSec }}>
                    {fmtTime(i * 5)}
                  </span>
                ))}
              </div>
            </div>
            {/* Playhead */}
            <div className="absolute top-0 bottom-0 w-px bg-amber-300/80 pointer-events-none z-30" style={{ left: HEADER_W + snap.position * pxPerSec }} />
            {/* Track rows */}
            {arrangement.tracks.map((track) => {
              const isSel = track.id === selectedTrackId;
              const segs = trackSegments(track);
              return (
                <div key={track.id} className={`flex border-b border-white/[0.05] ${isSel ? "bg-white/[0.015]" : ""}`}>
                  {/* Header */}
                  <div
                    className={`sticky left-0 z-20 shrink-0 bg-[#171208] border-r border-white/[0.08] p-2.5 space-y-2 cursor-pointer ${isSel ? "shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]" : ""}`}
                    style={{ width: HEADER_W }}
                    onClick={() => setSelectedTrackId(track.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <input
                        value={track.name}
                        onChange={(e) => updateTrack({ ...track, name: e.target.value })}
                        className="h-7 min-w-0 flex-1 rounded-md bg-white/[0.04] border border-white/10 px-2 text-xs font-bold text-white/90"
                        aria-label="Track name"
                      />
                      <button type="button" title="Delete track" onClick={(e) => { e.stopPropagation(); setArrangement((a) => ({ ...a, tracks: a.tracks.filter((t) => t.id !== track.id) })); }} className="text-white/30 hover:text-red-300 shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    {track.kind === "audio" ? (
                      <select
                        value={track.type}
                        onChange={(e) => updateTrack({ ...track, type: e.target.value })}
                        className="h-7 w-full rounded-md bg-white/[0.04] border border-white/10 px-1.5 text-[11px] font-bold text-white/70"
                        aria-label="Track type"
                      >
                        {STEM_TYPES.map((st) => <option key={st} value={st} className="bg-[#171208]">{st}</option>)}
                      </select>
                    ) : (
                      <p className="text-[11px] font-bold text-white/50 flex items-center gap-1.5"><Music4 className="h-3 w-3" /> MIDI · {track.instrument ?? "keys"}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <Volume2 className="h-3 w-3 text-white/35 shrink-0" />
                      <div className="flex-1"><Slider value={[track.volume]} min={0} max={100} step={1} onValueChange={([v]) => updateTrack({ ...track, volume: v ?? 90 })} /></div>
                      <span className="text-[10px] font-mono text-white/40 w-7 text-right">{track.volume}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-black text-white/35 w-3">L</span>
                      <div className="flex-1"><Slider value={[track.pan]} min={-100} max={100} step={1} onValueChange={([v]) => updateTrack({ ...track, pan: v ?? 0 })} /></div>
                      <span className="text-[9px] font-black text-white/35">R</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Chip active={track.muted} onClick={() => updateTrack({ ...track, muted: !track.muted })}>Mute</Chip>
                      <Chip active={track.solo} onClick={() => updateTrack({ ...track, solo: !track.solo })}>Solo</Chip>
                      <Chip active={openPanel?.trackId === track.id && openPanel.kind === "fx"} onClick={() => togglePanel(track.id, "fx")}>FX</Chip>
                      <Chip active={openPanel?.trackId === track.id && openPanel.kind === "auto"} onClick={() => togglePanel(track.id, "auto")}>Auto</Chip>
                      {track.kind === "audio" && <Chip active={openPanel?.trackId === track.id && openPanel.kind === "comp"} onClick={() => togglePanel(track.id, "comp")}>Takes</Chip>}
                      {track.kind === "audio" && <Chip active={openPanel?.trackId === track.id && openPanel.kind === "duck"} onClick={() => togglePanel(track.id, "duck")}>Duck</Chip>}
                      {track.kind === "midi" && <Chip active={openPanel?.trackId === track.id && openPanel.kind === "roll"} onClick={() => togglePanel(track.id, "roll")}>Piano roll</Chip>}
                      {track.kind === "audio" && (
                        <button
                          type="button"
                          title="Add a clip to this track"
                          onClick={() => { addClipTrackRef.current = track.id; addClipRef.current?.click(); }}
                          className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/[0.04] text-white/55 hover:text-white"
                        >
                          + Clip
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Lane */}
                  <div className="relative shrink-0 py-2" style={{ width: timelineW }}>
                    <div className="relative h-16">
                      {track.kind === "midi" ? (
                        <button type="button" className="absolute inset-y-0 left-0 right-0 rounded-lg bg-white/[0.02] border border-white/[0.06] text-left" onClick={() => togglePanel(track.id, "roll")} data-testid={`midi-lane-${track.id}`}>
                          {(track.notes ?? []).map((n) => (
                            <span key={n.id} className="absolute h-1.5 rounded-full bg-primary/80" style={{ left: n.start * pxPerSec, width: Math.max(4, n.duration * pxPerSec), top: `${8 + (1 - (n.pitch - 36) / 48) * 36}px` }} />
                          ))}
                          {(track.notes ?? []).length === 0 && <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white/30">Open the piano roll to write notes</span>}
                        </button>
                      ) : (
                        segs.map((seg) => {
                          const len = clipPlayLength(seg);
                          const isCompSeg = seg.id.startsWith("comp-");
                          return (
                            <div
                              key={seg.id}
                              className={`absolute top-0 h-16 rounded-lg overflow-hidden border select-none touch-none ${isCompSeg ? "border-sky-300/30" : "border-amber-300/25"} bg-[#241b08] cursor-grab active:cursor-grabbing`}
                              style={{ left: seg.startTime * pxPerSec, width: Math.max(14, len * pxPerSec) }}
                              onPointerDown={isCompSeg ? undefined : (e) => onClipPointerDown(e, track, track.clips.find((c) => c.id === seg.id) ?? seg)}
                              onPointerMove={isCompSeg ? undefined : onClipPointerMove}
                              onPointerUp={isCompSeg ? undefined : onClipPointerUp}
                              title={isCompSeg ? `${seg.name} — edit regions in Takes` : `${seg.name} — drag to move, edges to trim`}
                              data-testid={`clip-${seg.id}`}
                            >
                              <ClipWaveform clip={seg} height={64} />
                              <span className="absolute left-1.5 top-1 text-[9px] font-bold text-white/75 truncate max-w-full pointer-events-none">{seg.name}</span>
                              {!isCompSeg && <><span className="absolute left-0 top-0 bottom-0 w-[8px] cursor-ew-resize" /><span className="absolute right-0 top-0 bottom-0 w-[8px] cursor-ew-resize" /></>}
                            </div>
                          );
                        })
                      )}
                      {track.kind === "audio" && segs.length === 0 && (
                        <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white/25">No clips — use + Clip in the track header</span>
                      )}
                    </div>
                    {openPanel?.trackId === track.id && openPanel.kind === "auto" && (
                      <div className="pt-2 pr-2">
                        <AutomationLaneEditor track={track} widthPx={timelineW - 8} pxPerSec={pxPerSec} durationSec={duration} onChange={updateTrack} />
                      </div>
                    )}
                    {openPanel?.trackId === track.id && openPanel.kind === "comp" && track.kind === "audio" && (
                      <div className="pt-2 pr-2">
                        <CompEditor track={track} widthPx={timelineW - 8} pxPerSec={pxPerSec} onChange={updateTrack} onUploadTake={(t, f) => void addTakeToTrack(t, f)} uploading={uploading} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <input ref={addClipRef} type="file" accept=".wav,.mp3,.m4a,.flac,audio/*" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        const t = arrangement.tracks.find((x) => x.id === addClipTrackRef.current);
        if (f && t) void addClipToTrack(t, f);
        e.target.value = "";
      }} />

      {snap.errors.length > 0 && (
        <p className="text-[11px] text-red-300/80">{snap.errors[0]!.message}</p>
      )}

      {/* Selected-track panels that don't need lane alignment */}
      {panelTrack && openPanel?.kind === "fx" && (
        <EditorCard title={`${panelTrack.name} — Effects`} subtitle="Steps run in your order, in the preview and the render alike" icon={<SlidersHorizontal className="h-4 w-4" />}>
          <FxChainEditor track={panelTrack} onChange={updateTrack} />
        </EditorCard>
      )}
      {panelTrack && openPanel?.kind === "duck" && panelTrack.kind === "audio" && (
        <EditorCard title={`${panelTrack.name} — Ducking`} subtitle="This track dips under the vocal, sidechain-style" icon={<Volume2 className="h-4 w-4" />}>
          <div className="space-y-4">
            <Field label="Duck against">
              <select
                value={panelTrack.ducking?.againstTrackId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  updateTrack({ ...panelTrack, ducking: id ? { againstTrackId: id, amount: panelTrack.ducking?.amount ?? 60, sensitivity: panelTrack.ducking?.sensitivity ?? 50 } : null });
                }}
                className="h-9 w-full rounded-lg bg-white/[0.04] border border-white/10 px-2 text-sm font-bold text-white/80"
                data-testid="duck-against"
              >
                <option value="" className="bg-[#171208]">Off</option>
                {arrangement.tracks.filter((t) => t.id !== panelTrack.id).map((t) => (
                  <option key={t.id} value={t.id} className="bg-[#171208]">{t.name}</option>
                ))}
              </select>
            </Field>
            {panelTrack.ducking && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Duck amount" hint={`${panelTrack.ducking.amount}`}><Slider value={[panelTrack.ducking.amount]} min={0} max={100} step={1} onValueChange={([v]) => updateTrack({ ...panelTrack, ducking: { ...panelTrack.ducking!, amount: v ?? 60 } })} /></Field>
                <Field label="Voice sensitivity" hint={`${panelTrack.ducking.sensitivity}`}><Slider value={[panelTrack.ducking.sensitivity]} min={0} max={100} step={1} onValueChange={([v]) => updateTrack({ ...panelTrack, ducking: { ...panelTrack.ducking!, sensitivity: v ?? 50 } })} /></Field>
              </div>
            )}
            <p className="text-[11px] text-white/40 leading-relaxed">
              Ducking is applied by the export render (the same sidechain the Duck Audio tool uses). The browser preview plays this track unducked — export the arrangement to hear the ducked result.
            </p>
          </div>
        </EditorCard>
      )}
      {panelTrack && openPanel?.kind === "roll" && panelTrack.kind === "midi" && (
        <EditorCard title={`${panelTrack.name} — Piano Roll`} subtitle="Bundled synth voices — no samples, nothing to license" icon={<Music4 className="h-4 w-4" />}>
          <PianoRoll track={panelTrack} bpm={arrangement.bpm} pxPerSec={pxPerSec} durationSec={Math.max(duration, 16)} onChange={updateTrack} />
        </EditorCard>
      )}

      {/* Master + export */}
      {arrangement.tracks.length > 0 && (
        <>
          <EditorCard title="Master Bus" subtitle="Final polish on the whole arrangement" icon={<SlidersHorizontal className="h-4 w-4" />}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field label="Master volume" hint={`${ms.volume}%`}><Slider value={[ms.volume]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ volume: v ?? 100 })} /></Field>
              <Field label="Bus compression" hint={`${ms.compression}%`}><Slider value={[ms.compression]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ compression: v ?? 0 })} /></Field>
              <Field label="Stereo width" hint={`${ms.stereoWidth}%`}><Slider value={[ms.stereoWidth]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ stereoWidth: v ?? 50 })} /></Field>
              <Field label="Bass boost" hint={`${ms.bassBoost}%`}><Slider value={[ms.bassBoost]} min={0} max={100} step={1} onValueChange={([v]) => patchMaster({ bassBoost: v ?? 0 })} /></Field>
              <Field label="EQ tone"><Segmented value={ms.eqTone} options={EQ_TONES.map((t) => ({ value: t, label: t }))} onChange={(v) => patchMaster({ eqTone: v })} /></Field>
              <Field label="Loudness target"><Segmented value={ms.loudnessTarget} options={LOUDNESS_TARGETS.map((t) => ({ value: t.id, label: t.label }))} onChange={(v) => patchMaster({ loudnessTarget: v })} /></Field>
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <Chip active={ms.limiter} onClick={() => patchMaster({ limiter: !ms.limiter })}>Limiter</Chip>
              <Chip active={ms.fadeIn} onClick={() => patchMaster({ fadeIn: !ms.fadeIn })}>Fade in</Chip>
              <Chip active={ms.fadeOut} onClick={() => patchMaster({ fadeOut: !ms.fadeOut })}>Fade out</Chip>
            </div>
          </EditorCard>

          <EditorCard title="Export Arrangement" subtitle="Renders exactly what you arranged — placement, FX order, automation, comp and ducking included" icon={<Download className="h-4 w-4" />}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {AUDIO_EXPORT_BUTTONS.filter((b) => b.kind === "full").map((b) => (
                  <Button key={b.id} type="button" onClick={() => void handleExport(b)} disabled={exporting !== null} variant="outline" className="h-11 text-sm font-bold border-white/12 bg-white/[0.03] hover:bg-white/[0.06] text-white/85 justify-start" data-testid={`arr-export-${b.id}`}>
                    {exporting === b.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />} {b.label}
                  </Button>
                ))}
              </div>
              {exportError && <p className="text-[11px] text-red-300/90 leading-relaxed" data-testid="arr-export-error">{exportError}</p>}
              {exportUrl && (
                <div className="space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3" data-testid="arr-export-complete">
                  <p className="text-xs font-black text-emerald-300">Export complete</p>
                  <audio controls src={exportUrl} className="w-full" />
                  <a href={exportUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 h-10 w-full rounded-lg bg-primary text-black text-sm font-black hover:bg-primary/90 transition-colors">
                    <Download className="h-4 w-4" /> Download audio
                  </a>
                </div>
              )}
              <p className="text-[11px] text-white/40 leading-relaxed">
                The preview is a close approximation of the render. Two things only the render adds: ducking (the preview plays unducked) and the 15&nbsp;ms fades at comp joins. MIDI tracks are bounced through the same synth voices you hear in the preview, then mixed in like any other track.
              </p>
            </div>
          </EditorCard>
        </>
      )}
    </div>
  );
}
