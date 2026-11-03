/* ── Beat Studio automation lane editor (W3a) ────────────────────────────
 * Draw per-pattern automation curves for one mixer channel at a time:
 * volume, pan, and the two wet FX amounts (delay / reverb mix). The
 * editor is a pure view over lib/beat-automation's data + edit ops —
 * every change flows through the page's pattern patch, so lanes save
 * with the project (localStorage + server draft) and render into
 * playback and exports from the same pure evaluation.
 *
 * Interaction: drag on the chart to paint breakpoints (one per step),
 * right-click a column to remove its point, Clear wipes the lane.
 * Keyboard: focus the chart, ←/→ pick the step, ↑/↓ set its value,
 * Delete removes it. One bar (16 steps) is shown at a time, paged by
 * the sequencer's own bar pager — the same paging as the drum grid.
 * Manual tool = free, like every other studio editor on this page. */

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  BEAT_AUTOMATION_PARAMS,
  automationValueAt,
  clearBeatAutomationLane,
  findBeatAutomationLane,
  removeBeatAutomationPoint,
  setBeatAutomationPoint,
  type BeatAutomationLane,
  type BeatAutomationParamId,
} from "@/lib/beat-automation";
import { BEAT_STEPS } from "@/lib/beat-project";

const W = 640;
const H = 180;
const PAD_Y = 12;
const PARAM_ORDER: BeatAutomationParamId[] = ["volume", "pan", "delay", "reverb"];

export interface BeatAutomationChannelOption {
  id: string;
  label: string;
}

interface BeatAutomationLaneEditorProps {
  automation: BeatAutomationLane[];
  onChange: (next: BeatAutomationLane[]) => void;
  /** Mixer channels in display order (drum tracks + the 808 bass). */
  channels: BeatAutomationChannelOption[];
  /** Steps in the pattern being edited (16 / 32 / 64). */
  steps: number;
  /** The bar page the sequencer grid is showing (0-based). */
  page: number;
  /** Transport highlight: current step while playing, -1 when stopped. */
  currentStep: number;
  playing: boolean;
}

function formatAutoValue(param: BeatAutomationParamId, v: number): string {
  if (param === "pan") {
    if (Math.abs(v) < 0.005) return "C";
    return v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
  }
  return `${Math.round(v * 100)}%`;
}

export function BeatAutomationLaneEditor({
  automation,
  onChange,
  channels,
  steps,
  page,
  currentStep,
  playing,
}: BeatAutomationLaneEditorProps) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const [channelId, setChannelId] = useState<string>(() => channels[0]?.id ?? "kick");
  const [param, setParam] = useState<BeatAutomationParamId>("volume");
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const paintingRef = useRef(false);

  const channel = channels.some((c) => c.id === channelId) ? channelId : (channels[0]?.id ?? "kick");
  const spec = BEAT_AUTOMATION_PARAMS[param];
  const lane = findBeatAutomationLane(automation, channel, param);
  const pageStart = Math.min(page, Math.max(0, Math.ceil(steps / BEAT_STEPS) - 1)) * BEAT_STEPS;
  const pageSteps = Array.from({ length: BEAT_STEPS }, (_, i) => pageStart + i).filter((s) => s < steps);
  const colW = W / BEAT_STEPS;

  const xFor = (step: number) => (step - pageStart + 0.5) * colW;
  const yFor = (value: number) => {
    const frac = (value - spec.min) / (spec.max - spec.min);
    return PAD_Y + (1 - frac) * (H - PAD_Y * 2);
  };
  const posFromEvent = (e: React.PointerEvent): { step: number; value: number } => {
    const rect = svgRef.current!.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const vy = ((e.clientY - rect.top) / rect.height) * H;
    const step = Math.min(
      steps - 1,
      Math.max(0, pageStart + Math.floor(vx / colW)),
    );
    const frac = 1 - (vy - PAD_Y) / (H - PAD_Y * 2);
    const raw = spec.min + Math.min(1, Math.max(0, frac)) * (spec.max - spec.min);
    return { step, value: Math.round(raw * 100) / 100 };
  };

  const describe = (step: number, value: number) =>
    t("beatMaker.autoPointSet", {
      defaultValue: "Step {{step}}: {{value}}",
      step: step + 1,
      value: formatAutoValue(param, value),
    });

  const paint = (e: React.PointerEvent) => {
    const { step, value } = posFromEvent(e);
    onChange(setBeatAutomationPoint(automation, channel, param, step, value));
    setActiveStep(step);
    setAnnounce(describe(step, value));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    paintingRef.current = true;
    svgRef.current?.setPointerCapture(e.pointerId);
    paint(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (paintingRef.current) paint(e);
  };
  const onPointerUp = () => {
    paintingRef.current = false;
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const step = Math.min(steps - 1, Math.max(0, pageStart + Math.floor(vx / colW)));
    onChange(removeBeatAutomationPoint(automation, channel, param, step));
    setAnnounce(t("beatMaker.autoPointRemoved", { defaultValue: "Step {{step}} point removed", step: step + 1 }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = activeStep ?? pageStart;
    const bump = (spec.max - spec.min) / 20;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveStep(Math.min(steps - 1, Math.max(0, cur + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const existing = lane?.points.find((p) => p.step === cur);
      const base = existing ? existing.value : spec.neutral;
      const value = Math.round((base + (e.key === "ArrowUp" ? bump : -bump)) * 100) / 100;
      onChange(setBeatAutomationPoint(automation, channel, param, cur, value));
      setActiveStep(cur);
      setAnnounce(describe(cur, value));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onChange(removeBeatAutomationPoint(automation, channel, param, cur));
      setAnnounce(t("beatMaker.autoPointRemoved", { defaultValue: "Step {{step}} point removed", step: cur + 1 }));
    }
  };

  const curvePoints = lane
    ? pageSteps.map((s) => `${xFor(s)},${yFor(automationValueAt(lane, s))}`).join(" ")
    : "";
  const activePoint = activeStep != null ? lane?.points.find((p) => p.step === activeStep) : undefined;
  const chipCls = (on: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors ${
      on
        ? "bg-[#C9A84C] border-[#C9A84C] text-black"
        : isLight
          ? "border-[#c9a84c]/30 text-[#4A3B22] hover:border-[#C9A84C]"
          : "border-white/15 text-white/60 hover:border-[#C9A84C]/60"
    }`;
  const gridLine = isLight ? "rgba(138,109,47,0.18)" : "rgba(255,255,255,0.10)";
  const beatLine = isLight ? "rgba(138,109,47,0.35)" : "rgba(255,255,255,0.22)";

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 ${isLight ? "border-[#c9a84c]/25 bg-[#8a6d2f]/[0.04]" : "border-white/10 bg-black/30"}`}
      data-testid="beat-automation-editor"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className={`text-xs font-black uppercase tracking-wider ${isLight ? "text-[#4A3B22]" : "text-white/85"}`}>
          {t("beatMaker.automation", { defaultValue: "Automation" })}
        </p>
        <span className={`text-xs ${isLight ? "text-[#4A3B22]/60" : "text-white/45"}`}>
          {t("beatMaker.autoHint", { defaultValue: "Draw how a sound moves across this pattern — it plays and exports exactly as drawn." })}
        </span>
        <button
          type="button"
          disabled={!lane}
          onClick={() => {
            onChange(clearBeatAutomationLane(automation, channel, param));
            setAnnounce(t("beatMaker.autoLaneCleared", { defaultValue: "Lane cleared" }));
          }}
          className={`ml-auto px-2.5 py-1 rounded-full text-[11px] font-bold border flex items-center gap-1 transition-colors disabled:opacity-40 ${isLight ? "border-[#c9a84c]/30 text-[#4A3B22]" : "border-white/15 text-white/60"}`}
        >
          <Trash2 className="w-3 h-3" /> {t("beatMaker.autoClearLane", { defaultValue: "Clear lane" })}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("beatMaker.autoChannel", { defaultValue: "Channel" })}>
        {channels.map((c) => (
          <button
            key={c.id} type="button" aria-pressed={channel === c.id}
            onClick={() => { setChannelId(c.id); setActiveStep(null); }}
            className={chipCls(channel === c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("beatMaker.autoParam", { defaultValue: "What moves" })}>
        {PARAM_ORDER.map((p) => (
          <button
            key={p} type="button" aria-pressed={param === p}
            onClick={() => { setParam(p); setActiveStep(null); }}
            className={chipCls(param === p)}
          >
            {t(`beatMaker.autoParam_${p}`, { defaultValue: BEAT_AUTOMATION_PARAMS[p].label })}
          </button>
        ))}
        <span className={`ml-auto text-xs tabular-nums ${isLight ? "text-[#4A3B22]/70" : "text-white/50"}`} aria-live="polite">
          {activePoint
            ? describe(activePoint.step, activePoint.value)
            : lane
              ? t("beatMaker.autoLaneSummary", { defaultValue: "{{n}} points", n: lane.points.length })
              : t("beatMaker.autoNoLane", { defaultValue: "No points yet — drag on the chart to draw" })}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div
          className="min-w-[640px] outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C] rounded-lg"
          tabIndex={0}
          role="application"
          aria-label={t("beatMaker.autoChartLabel", {
            defaultValue: "{{channel}} {{param}} automation. Arrow keys pick a step and set its value; Delete removes a point.",
            channel: channels.find((c) => c.id === channel)?.label ?? channel,
            param: BEAT_AUTOMATION_PARAMS[param].label,
          })}
          onKeyDown={onKeyDown}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full block touch-none select-none rounded-lg"
            style={{ background: isLight ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.03)" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={onContextMenu}
            data-testid="beat-automation-chart"
          >
            {pageSteps.map((s) => (
              <line
                key={`v${s}`}
                x1={xFor(s) - colW / 2} y1={0} x2={xFor(s) - colW / 2} y2={H}
                stroke={s % 4 === 0 ? beatLine : gridLine} strokeWidth={1}
              />
            ))}
            {[spec.min, spec.neutral, spec.max].map((v) => (
              <line
                key={`h${v}`}
                x1={0} y1={yFor(v)} x2={W} y2={yFor(v)}
                stroke={v === spec.neutral ? beatLine : gridLine} strokeWidth={1}
                strokeDasharray={v === spec.neutral ? "4 4" : undefined}
              />
            ))}
            {playing && currentStep >= pageStart && currentStep < pageStart + BEAT_STEPS && (
              <line
                x1={xFor(currentStep)} y1={0} x2={xFor(currentStep)} y2={H}
                stroke="#C9A84C" strokeWidth={2} opacity={0.55}
              />
            )}
            {lane ? (
              <polyline points={curvePoints} fill="none" stroke="#C9A84C" strokeWidth={2} strokeLinejoin="round" />
            ) : (
              <line
                x1={0} y1={yFor(spec.neutral)} x2={W} y2={yFor(spec.neutral)}
                stroke={isLight ? "rgba(138,109,47,0.4)" : "rgba(255,255,255,0.25)"}
                strokeWidth={1.5} strokeDasharray="6 5"
              />
            )}
            {lane?.points
              .filter((p) => p.step >= pageStart && p.step < pageStart + BEAT_STEPS)
              .map((p) => (
                <circle
                  key={p.step}
                  cx={xFor(p.step)} cy={yFor(p.value)} r={activeStep === p.step ? 6 : 4.5}
                  fill="#C9A84C" stroke={isLight ? "#FDFBF5" : "#0A0A0A"} strokeWidth={1.5}
                />
              ))}
            {activeStep != null && activeStep >= pageStart && activeStep < pageStart + BEAT_STEPS && (
              <line
                x1={xFor(activeStep)} y1={0} x2={xFor(activeStep)} y2={H}
                stroke="#C9A84C" strokeWidth={1} opacity={0.35}
              />
            )}
          </svg>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{announce}</span>
    </div>
  );
}
