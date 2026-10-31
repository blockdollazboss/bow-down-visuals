/* ── Timeline dock drag math (stack1000 M5) ──────────────────────────────
 * The value computations behind TimelineDock's pointer drags, extracted
 * verbatim so the keyboard handle path (arrows on a focused handle)
 * produces the EXACT values a pointer drag produces — one math path,
 * two input devices. The component's snap function is passed in: it is
 * the same snap() the pointer move handler closes over.
 *
 * Two families:
 *  • delta family (trim, fade): the drag tracks a duration value; the
 *    pointer converts through the handle's absolute timeline position
 *    so beat snapping applies to where the edge LANDS, not the delta.
 *  • absolute family (crop, export range, loop): the drag sets an edge
 *    to a snapped absolute time `t` (already clamped to [0, totalDur]
 *    and snapped by the caller, exactly as onPointerMove computes it),
 *    with a minimum gap to the opposite edge.
 *  • pixel family (dock height, stack1100 residuals round-up): the
 *    resize handle tracks a pixel height between the dock's named
 *    MIN/MAX bounds — no timeline, no snapping; the pointer's
 *    clamp+round, shared verbatim with the handle's arrow keys. */

export type DockSnapFn = (t: number) => number;

/** Trim a clip's content edge. maxTrim = 45% of the clip's duration. */
export function trimDragValue(
  side: "start" | "end",
  startVal: number,
  deltaTime: number,
  clipDur: number,
  clipStart: number,
  snapFn: DockSnapFn,
): number {
  const maxTrim = clipDur * 0.45;
  const rawVal = side === "start" ? startVal + deltaTime : startVal - deltaTime;
  const clampedVal = Math.max(0, Math.min(maxTrim, rawVal));
  // Snap the handle's absolute timeline position to the beat grid, then convert back to a trim duration.
  const absTime = side === "start" ? clipStart + clampedVal : clipStart + clipDur - clampedVal;
  const snappedAbs = snapFn(absTime);
  const snappedVal = side === "start" ? snappedAbs - clipStart : clipStart + clipDur - snappedAbs;
  return Math.round(Math.max(0, Math.min(maxTrim, snappedVal)) * 10) / 10;
}

/** Song fade in/out duration. Capped at 15s or half the timeline. */
export function fadeDragValue(
  side: "in" | "out",
  startVal: number,
  deltaTime: number,
  totalDur: number,
  snapFn: DockSnapFn,
): number {
  const maxFade = Math.min(15, totalDur / 2);
  const rawVal = side === "in" ? startVal + deltaTime : startVal - deltaTime;
  const clampedVal = Math.max(0, Math.min(maxFade, rawVal));
  // Fade-in handle sits at absolute time = fadeIn; fade-out handle sits at absolute time = totalDur - fadeOut.
  const absTime = side === "in" ? clampedVal : totalDur - clampedVal;
  const snappedAbs = snapFn(absTime);
  const snappedVal = side === "in" ? snappedAbs : totalDur - snappedAbs;
  return Math.round(Math.max(0, Math.min(maxFade, snappedVal)) * 10) / 10;
}

/** Song crop edge → next crop (dragging always enables the crop). Min gap 0.5s. */
export function cropDragNext(
  cur: { startSec: number; endSec: number },
  side: "start" | "end",
  t: number,
): { enabled: true; startSec: number; endSec: number } {
  return side === "start"
    ? { enabled: true, startSec: Math.min(t, cur.endSec - 0.5), endSec: cur.endSec }
    : { enabled: true, startSec: cur.startSec, endSec: Math.max(t, cur.startSec + 0.5) };
}

/** Export-range edge → next custom range. Min gap 0.3s. */
export function rangeDragNext(
  cur: { customStartSec: number; customEndSec: number },
  side: "start" | "end",
  t: number,
): { mode: "custom"; customStartSec: number; customEndSec: number } {
  return side === "start"
    ? { mode: "custom", customStartSec: Math.min(t, cur.customEndSec - 0.3), customEndSec: cur.customEndSec }
    : { mode: "custom", customStartSec: cur.customStartSec, customEndSec: Math.max(t, cur.customStartSec + 0.3) };
}

/** Dock height → next height in pixels, clamped to the dock's
 *  [min, max] bounds and rounded to a whole pixel — the pointer
 *  resize branch's math verbatim (drag up = positive delta = taller). */
export function dockHeightNext(
  cur: number,
  deltaPx: number,
  min: number,
  max: number,
): number {
  return Math.round(Math.max(min, Math.min(max, cur + deltaPx)));
}

/** Loop-region edge → next loop edges. Min gap 0.3s. */
export function loopDragNext(
  cur: { startSec: number; endSec: number },
  side: "start" | "end",
  t: number,
): { startSec: number; endSec: number } {
  return side === "start"
    ? { startSec: Math.min(t, cur.endSec - 0.3), endSec: cur.endSec }
    : { startSec: cur.startSec, endSec: Math.max(t, cur.startSec + 0.3) };
}
