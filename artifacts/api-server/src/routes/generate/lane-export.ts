/* ── Lane-model → export filter graph (Stack 5 #1 / #6) ──────────────────
 * The editor's lane model (frontend: lib/timeline-lanes.ts) projects overlay
 * items and caption lines back to the legacy timed lists, which the main
 * export loop already renders truthfully (drawtext / drawbox / overlay with
 * enable='between(t,start,end)'). This module covers the one lane family
 * with no legacy counterpart: ADJUSTMENT clips. An adjustment clip applies
 * its color correction (+ named global effects) to the whole frame, but
 * only inside its time window — implemented by stamping
 * enable='between(t,start,end)' on every filter in its chain, so a trimmed
 * or moved adjustment clip grades exactly the window the editor showed.
 *
 * Composition order on the final video stream (documented, tested):
 *   concat → global effects stack → ADJUSTMENT lane windows (here)
 *          → title overlays → structured overlays → watermark/captions
 * Adjustment runs right after the global effects stack so its grade is the
 * last creative grade applied in its window, before text/graphics burn in.
 */

import { buildProToolsFilterChain, type ProToolsColorCorrection } from "./pro-tools-ffmpeg";
import { buildEffectStack } from "./effects-ffmpeg";

export interface AdjustmentExportItem {
  startSec: number;
  endSec: number;
  colorCorrection?: ProToolsColorCorrection | null;
  effects?: string[] | null;
}

const NEUTRAL_CC: ProToolsColorCorrection = {
  brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vibrance: 0, exposure: 0,
};

function ccIsNeutral(cc: ProToolsColorCorrection): boolean {
  return Object.keys(NEUTRAL_CC).every(
    (k) => (cc as unknown as Record<string, number>)[k] === 0,
  );
}

/** Strip the [0:v]…[ptout] labels from a pro-tools chain, leaving the bare
 *  comma-joined filter list. Only valid for chroma-free chains (grade-only
 *  input guarantees that). Returns "" for an empty/neutral chain. */
export function bareGradeChain(cc: ProToolsColorCorrection | null | undefined): string {
  if (!cc || ccIsNeutral(cc)) return "";
  const labeled = buildProToolsFilterChain({ colorCorrection: cc });
  if (!labeled) return "";
  return labeled.replace(/^\[0:v\]/, "").replace(/\[ptout\]$/, "");
}

/** Add a time-window enable expression to every filter in a bare chain.
 *  The grade/effects chains built here contain no top-level commas inside
 *  filter arguments, so a plain split is exact for these builders. */
export function windowChain(chain: string, startSec: number, endSec: number): string {
  if (!chain) return "";
  const enable = `enable='between(t\\,${startSec.toFixed(3)}\\,${endSec.toFixed(3)})'`;
  return chain
    .split(",")
    .map((f) => (f.includes("enable=") ? f : `${f}:${enable}`))
    .join(",");
}

/**
 * Build the filter_complex fragments for all adjustment items, threading
 * `inLabel` → … → returned out label. Empty/invalid items are skipped;
 * an item with a neutral grade and no effects contributes nothing (the
 * editor says so up front — see the Lanes panel copy).
 */
export function buildAdjustmentGraph(
  items: AdjustmentExportItem[] | null | undefined,
  inLabel: string,
  durationSec: number,
): { fragments: string[]; outLabel: string; applied: number } {
  const fragments: string[] = [];
  let label = inLabel;
  let applied = 0;
  for (const [i, item] of (items ?? []).entries()) {
    if (!item || !Number.isFinite(item.startSec) || !Number.isFinite(item.endSec)) continue;
    if (item.endSec <= item.startSec || item.startSec >= durationSec) continue;
    const end = Math.min(item.endSec, durationSec);
    const parts: string[] = [];
    const grade = bareGradeChain(item.colorCorrection);
    if (grade) parts.push(grade);
    if (Array.isArray(item.effects) && item.effects.length > 0) {
      const fx = buildEffectStack(item.effects, durationSec);
      if (fx.filter) parts.push(fx.filter);
    }
    const chain = parts.join(",");
    if (!chain) continue;
    const out = `vadj${i}`;
    fragments.push(`[${label}]${windowChain(chain, Math.max(0, item.startSec), end)}[${out}]`);
    label = out;
    applied += 1;
  }
  return { fragments, outLabel: label, applied };
}
