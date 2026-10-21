/* ── Per-stem parametric FX chains for the Music Studio desk (Wave 3 #16) ──
 * The desk's stems used to stop at preset-level effects (StemEffects: one
 * of 7 EQ presets, fixed compression/saturation levels). A stem can now
 * also carry a parametric chain — the same FxStep model the arrangement
 * uses (lib/arrangement.ts): EQ bands with frequency/gain/Q, a compressor
 * with threshold/ratio/attack/release, saturation, reverb and delay, in
 * a user-controlled order.
 *
 * Render truth (identical in the Web Audio preview engine and the server
 * FFmpeg render): a non-empty chain REPLACES the stem's preset effects;
 * an empty chain means the presets apply, exactly as before. The chain
 * persists inside AudioStem in the project's editor settings JSON (via
 * normalizeStem below) and rides the existing /music/export payload —
 * no new storage, no new charge.
 *
 * Every operation here is pure so the desk's chain state is unit-testable
 * without a DOM. Numeric bounds mirror the server's parseFxChain clamps
 * exactly, so what the desk saves is what the server renders. */

import {
  defaultEqBands,
  makeFxStep,
  moveFxStep,
  type EqBand,
  type FxStep,
  type FxStepType,
} from "@/lib/arrangement";

export const FX_CHAIN_MAX_STEPS = 12;
export const FX_EQ_MAX_BANDS = 5;

export const FX_STEP_TYPES: readonly FxStepType[] = [
  "eq",
  "compressor",
  "saturation",
  "reverb",
  "delay",
];

const FX_STEP_TYPE_SET = new Set<string>(FX_STEP_TYPES);

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

let uidCounter = 0;
/** Stable-enough client id for a new step (mirrors arrangementUid's shape). */
export function stemFxUid(): string {
  uidCounter += 1;
  return `fx-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function normalizeBand(raw: unknown): EqBand | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  return {
    freq: clampNum(b["freq"], 20, 20000, 1000),
    gain: clampNum(b["gain"], -24, 24, 0),
    q: clampNum(b["q"], 0.3, 12, 1),
  };
}

function normalizeStep(raw: unknown): FxStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["type"] !== "string" || !FX_STEP_TYPE_SET.has(r["type"])) return null;
  const type = r["type"] as FxStepType;
  const step: FxStep = {
    id: typeof r["id"] === "string" && r["id"].length > 0 ? r["id"] : stemFxUid(),
    type,
    enabled: r["enabled"] !== false,
  };
  if (type === "eq") {
    const bands = Array.isArray(r["bands"])
      ? r["bands"]
          .map(normalizeBand)
          .filter((b): b is EqBand => b !== null)
          .slice(0, FX_EQ_MAX_BANDS)
      : [];
    step.bands = bands.length > 0 ? bands : defaultEqBands();
  }
  if (type === "compressor") {
    step.thresholdDb = clampNum(r["thresholdDb"], -60, 0, -18);
    step.ratio = clampNum(r["ratio"], 1, 20, 3);
    step.attackMs = clampNum(r["attackMs"], 0.1, 500, 10);
    step.releaseMs = clampNum(r["releaseMs"], 10, 1000, 150);
  }
  if (type === "saturation") {
    step.drive = clampNum(r["drive"], 1, 3, 1.5);
  }
  if (type === "reverb") {
    step.mix = clampNum(r["mix"], 0, 100, 25);
  }
  if (type === "delay") {
    step.mix = clampNum(r["mix"], 0, 100, 20);
    step.timeMs = clampNum(r["timeMs"], 10, 2000, 250);
    step.feedback = clampNum(r["feedback"], 0, 80, 30);
  }
  return step;
}

/**
 * Validate + clamp a stored/sent chain onto the renderable model.
 * Malformed steps are dropped (a stored project must always load), the
 * server independently refuses malformed chains at export time — the
 * desk only ever produces chains that pass through here or the editor
 * ops below, all of which stay inside these bounds.
 */
export function normalizeStemFxChain(raw: unknown): FxStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeStep)
    .filter((s): s is FxStep => s !== null)
    .slice(0, FX_CHAIN_MAX_STEPS);
}

/* ── Pure editing ops (the desk's chain state transitions) ────────────── */

export function addFxStep(chain: FxStep[], type: FxStepType): FxStep[] {
  if (chain.length >= FX_CHAIN_MAX_STEPS) return chain;
  return [...chain, makeFxStep(type, stemFxUid())];
}

export function removeFxStep(chain: FxStep[], stepId: string): FxStep[] {
  return chain.filter((s) => s.id !== stepId);
}

export function moveStemFxStep(chain: FxStep[], stepId: string, toIndex: number): FxStep[] {
  return moveFxStep(chain, stepId, toIndex);
}

export function patchFxStep(chain: FxStep[], stepId: string, patch: Partial<FxStep>): FxStep[] {
  return chain.map((s) => (s.id === stepId ? { ...s, ...patch } : s));
}

export function patchFxBand(
  chain: FxStep[],
  stepId: string,
  bandIdx: number,
  patch: Partial<EqBand>,
): FxStep[] {
  return chain.map((s) =>
    s.id === stepId
      ? { ...s, bands: (s.bands ?? []).map((b, i) => (i === bandIdx ? { ...b, ...patch } : b)) }
      : s,
  );
}

export function addEqBand(chain: FxStep[], stepId: string): FxStep[] {
  return chain.map((s) => {
    if (s.id !== stepId || s.type !== "eq") return s;
    const bands = s.bands ?? [];
    if (bands.length >= FX_EQ_MAX_BANDS) return s;
    return { ...s, bands: [...bands, { freq: 1000, gain: 0, q: 1 }] };
  });
}

export function removeEqBand(chain: FxStep[], stepId: string, bandIdx: number): FxStep[] {
  return chain.map((s) =>
    s.id === stepId ? { ...s, bands: (s.bands ?? []).filter((_, i) => i !== bandIdx) } : s,
  );
}
