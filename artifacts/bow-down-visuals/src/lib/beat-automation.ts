/* ── Beat automation lanes + mixer sends math (W3a) ─────────────────────
 * Wave 3a adds the two mixer-depth features the FL gap map left for
 * wave 3 (rows 14 + 18): automation lanes and mixer sends.
 *
 * AUTOMATION — per-pattern lanes for the parameters the beat mixer
 * already exposes: channel volume, pan, and the two wet FX amounts
 * (delay mix, reverb mix). A lane is a list of breakpoints on the step
 * grid ({ step, value }); the value between breakpoints is the linear
 * interpolation, and it holds past both ends. Lanes live INSIDE the
 * pattern (BeatPatternData.automation in lib/beat-project), so they
 * persist with the ONE project shape (localStorage + server draft)
 * exactly like velocity and melody, and they play per pattern — in
 * pattern mode they loop with the pattern, in song mode each pattern
 * play in the arrangement chain runs its own lanes.
 *
 * Semantics per parameter (the contract live playback and the offline
 * render both implement, from THIS module's pure functions):
 *   • volume — a MULTIPLIER (0–1, neutral 1) on the channel's fader
 *     gain (the mixer's effective gain incl. mute/solo resolution).
 *     A multiplier is what makes stems exact: a stem's isolated gain
 *     is 0 for every other channel, and 0 × lane is still 0.
 *   • pan — absolute stereo position (−1…+1); a lane overrides the
 *     channel's static pan while its pattern plays.
 *   • delay / reverb — absolute wet gain (0–1 = the FX mix % ÷ 100);
 *     a lane overrides the static mix while its pattern plays, and
 *     only where that effect is enabled on the channel (a stem keeps
 *     its own channel's effects, so its lanes still land; every other
 *     channel's effects are defaulted off in a stem, so theirs can't).
 *
 * Play-boundary rule (both paths): within one pattern play the value
 * ramps step to step; at a play boundary it ANCHORS (snaps) to the new
 * play's step-0 lane value, or holds when the new pattern has no lane
 * for that parameter. The event lists below encode exactly that, and
 * the live scheduler writes the same events two at a time — the test
 * suite simulates both lists through Web Audio automation semantics
 * and proves the curves identical.
 *
 * Backward compatibility is by construction: a project saved before
 * this module existed has NO automation field, normalizes to empty
 * lanes, and therefore schedules zero automation events — its render
 * is the pre-automation render, bit for bit in graph terms. Sends
 * (lib/beat-mixer) default to 0, which builds no bus at all.
 *
 * Editing automation and sends is a manual studio tool = pure UI =
 * FREE. No charges, no provider calls, no sound generation here.
 */

/* ─── Lane data model ──────────────────────────────────────────────────── */

export type BeatAutomationParamId = "volume" | "pan" | "delay" | "reverb";

export interface BeatAutomationPoint {
  /** Pattern-local step (integer, 0 … pattern steps − 1). */
  step: number;
  /** Value in the parameter's native range (see the specs below). */
  value: number;
}

export interface BeatAutomationLane {
  /** Mixer channel id: a drum track id or "bass" (BEAT_MIXER_CHANNEL_IDS). */
  channel: string;
  param: BeatAutomationParamId;
  /** Breakpoints, sorted by step, at most one per step. */
  points: BeatAutomationPoint[];
}

export const BEAT_AUTOMATION_PARAM_IDS: readonly BeatAutomationParamId[] = [
  "volume",
  "pan",
  "delay",
  "reverb",
];

export interface BeatAutomationParamSpec {
  id: BeatAutomationParamId;
  /** House label (matches the mixer panel's own vocabulary). */
  label: string;
  min: number;
  max: number;
  /** The value that changes nothing (the UI's reset reference). */
  neutral: number;
}

export const BEAT_AUTOMATION_PARAMS: Record<BeatAutomationParamId, BeatAutomationParamSpec> = {
  /* Volume is a multiplier on the fader gain: 1 = the fader as set. */
  volume: { id: "volume", label: "Volume", min: 0, max: 1, neutral: 1 },
  pan: { id: "pan", label: "Pan", min: -1, max: 1, neutral: 0 },
  /* Delay / reverb lanes set the wet gain directly: 1 = 100% mix. */
  delay: { id: "delay", label: "Delay", min: 0, max: 1, neutral: 0 },
  reverb: { id: "reverb", label: "Reverb", min: 0, max: 1, neutral: 0 },
};

/** Safety caps so a corrupt draft can't grow lanes without bound. */
export const BEAT_AUTOMATION_MAX_LANES = 40;
export const BEAT_AUTOMATION_MAX_POINTS = 256;

export function isBeatAutomationParamId(v: unknown): v is BeatAutomationParamId {
  return v === "volume" || v === "pan" || v === "delay" || v === "reverb";
}

export function clampBeatAutomationValue(param: BeatAutomationParamId, v: unknown): number {
  const spec = BEAT_AUTOMATION_PARAMS[param];
  return typeof v === "number" && Number.isFinite(v)
    ? Math.min(spec.max, Math.max(spec.min, v))
    : spec.neutral;
}

/* ─── Normalization / cloning / resizing ───────────────────────────────── */

export function emptyBeatAutomation(): BeatAutomationLane[] {
  return [];
}

export function cloneBeatAutomation(a: readonly BeatAutomationLane[]): BeatAutomationLane[] {
  return a.map((l) => ({
    channel: l.channel,
    param: l.param,
    points: l.points.map((p) => ({ ...p })),
  }));
}

/** Defensive load: anything malformed is dropped, never thrown. Points
 *  are clamped into the pattern's step range and the parameter's value
 *  range; duplicate steps keep the LAST occurrence (the most recent
 *  edit wins, matching how the sparse velocity maps read). */
export function normalizeBeatAutomation(
  raw: unknown,
  steps: number,
  allowedChannels?: readonly string[],
): BeatAutomationLane[] {
  if (!Array.isArray(raw)) return [];
  const stepCount = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 0;
  const out: BeatAutomationLane[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const lane = item as Partial<BeatAutomationLane>;
    if (typeof lane.channel !== "string" || lane.channel.length === 0 || lane.channel.length > 32) continue;
    if (allowedChannels && !allowedChannels.includes(lane.channel)) continue;
    if (!isBeatAutomationParamId(lane.param)) continue;
    if (!Array.isArray(lane.points)) continue;
    const byStep = new Map<number, number>();
    for (const rawPoint of lane.points) {
      if (!rawPoint || typeof rawPoint !== "object") continue;
      const p = rawPoint as Partial<BeatAutomationPoint>;
      if (typeof p.step !== "number" || !Number.isFinite(p.step)) continue;
      const step = Math.round(p.step);
      if (step < 0 || step >= stepCount) continue;
      byStep.set(step, clampBeatAutomationValue(lane.param, p.value));
      if (byStep.size > BEAT_AUTOMATION_MAX_POINTS) break;
    }
    if (byStep.size === 0) continue;
    const points = [...byStep.entries()]
      .map(([step, value]) => ({ step, value }))
      .sort((a, b) => a.step - b.step);
    /* One lane per (channel, param): a later duplicate replaces an
     * earlier one wholesale, like the editor's own lane identity. */
    const existing = out.findIndex((l) => l.channel === lane.channel && l.param === lane.param);
    if (existing >= 0) out.splice(existing, 1);
    out.push({ channel: lane.channel, param: lane.param, points });
    if (out.length >= BEAT_AUTOMATION_MAX_LANES) break;
  }
  return out;
}

/** Keep only the points inside a (possibly shrunk) pattern length —
 *  the automation twin of the velocity pruning in setPatternBars. */
export function resizeBeatAutomation(
  a: readonly BeatAutomationLane[],
  steps: number,
): BeatAutomationLane[] {
  const stepCount = Number.isFinite(steps) && steps > 0 ? Math.floor(steps) : 0;
  const out: BeatAutomationLane[] = [];
  for (const lane of a) {
    const points = lane.points.filter((p) => p.step < stepCount).map((p) => ({ ...p }));
    if (points.length > 0) out.push({ channel: lane.channel, param: lane.param, points });
  }
  return out;
}

/* ─── Lane lookup + evaluation ─────────────────────────────────────────── */

export function findBeatAutomationLane(
  a: readonly BeatAutomationLane[],
  channel: string,
  param: BeatAutomationParamId,
): BeatAutomationLane | undefined {
  return a.find((l) => l.channel === channel && l.param === param);
}

/** The lane's value at a (possibly fractional) pattern-local step:
 *  piecewise-linear between breakpoints, holding the first/last value
 *  past the ends. Points are stored sorted — this is the ONE curve
 *  every consumer (editor drawing, live scheduler, offline render)
 *  reads. */
export function automationValueAt(lane: BeatAutomationLane, stepPos: number): number {
  const pts = lane.points;
  if (pts.length === 0) return BEAT_AUTOMATION_PARAMS[lane.param].neutral;
  const pos = Number.isFinite(stepPos) ? stepPos : 0;
  if (pos <= pts[0]!.step) return pts[0]!.value;
  const last = pts[pts.length - 1]!;
  if (pos >= last.step) return last.value;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i]!;
    if (pos <= b.step) {
      const a = pts[i - 1]!;
      const span = b.step - a.step;
      if (span <= 0) return b.value;
      return a.value + (b.value - a.value) * ((pos - a.step) / span);
    }
  }
  return last.value;
}

/** The value a channel+param plays at a step, or null when the pattern
 *  has no lane for it (the caller then leaves the static value alone). */
export function automationLaneValueAt(
  a: readonly BeatAutomationLane[],
  channel: string,
  param: BeatAutomationParamId,
  stepPos: number,
): number | null {
  const lane = findBeatAutomationLane(a, channel, param);
  return lane ? automationValueAt(lane, stepPos) : null;
}

/* ─── Pure edit ops (the editor's whole vocabulary) ────────────────────── */

export function setBeatAutomationPoint(
  a: readonly BeatAutomationLane[],
  channel: string,
  param: BeatAutomationParamId,
  step: number,
  value: number,
): BeatAutomationLane[] {
  const s = Math.round(step);
  if (!Number.isFinite(s) || s < 0) return cloneBeatAutomation(a);
  const v = clampBeatAutomationValue(param, value);
  const next = cloneBeatAutomation(a);
  let lane = next.find((l) => l.channel === channel && l.param === param);
  if (!lane) {
    lane = { channel, param, points: [] };
    next.push(lane);
  }
  const existing = lane.points.findIndex((p) => p.step === s);
  if (existing >= 0) lane.points[existing] = { step: s, value: v };
  else {
    lane.points.push({ step: s, value: v });
    lane.points.sort((x, y) => x.step - y.step);
  }
  return next;
}

export function removeBeatAutomationPoint(
  a: readonly BeatAutomationLane[],
  channel: string,
  param: BeatAutomationParamId,
  step: number,
): BeatAutomationLane[] {
  const next = cloneBeatAutomation(a);
  const li = next.findIndex((l) => l.channel === channel && l.param === param);
  if (li < 0) return next;
  const lane = next[li]!;
  lane.points = lane.points.filter((p) => p.step !== step);
  if (lane.points.length === 0) next.splice(li, 1);
  return next;
}

export function clearBeatAutomationLane(
  a: readonly BeatAutomationLane[],
  channel: string,
  param: BeatAutomationParamId,
): BeatAutomationLane[] {
  return cloneBeatAutomation(a).filter((l) => !(l.channel === channel && l.param === param));
}

/* ─── Automation events (live + offline share these) ─────────────────────
 * An event list is what gets written onto AudioParams. Anchor events
 * set a value outright; ramp events glide linearly to a value. The
 * offline render writes the whole list up front. The live scheduler
 * writes the same list incrementally — an anchor (with cancellation
 * of anything stale) at each play's step 0, then one ramp per step —
 * automationStepEvents is exactly the per-step slice of the full
 * list, so the two paths trace the identical curve (proven in the
 * test suite through a Web Audio semantics simulation of both).
 *
 * One contract keeps the live glide pure: NOTHING ELSE may write
 * .value onto an automated param mid-glide, because a .value write
 * inserts a static event at the current time and bends the ramp.
 * The mixer's update() honors this by skipping unchanged values
 * (see buildTrackChain's change guard in lib/beat-mixer), and the
 * mixer's fader writes land only on user action — after which the
 * next step's ramp re-aims the curve within one step. */

export interface BeatAutomationEvent {
  channel: string;
  param: BeatAutomationParamId;
  timeSec: number;
  value: number;
  anchor: boolean;
}

/** One pattern play for event generation: its lanes + its step count. */
export interface BeatAutomationPlayInput {
  automation: readonly BeatAutomationLane[];
  steps: number;
}

/** The audio time of a step, using the sequencer's own step clock:
 *  the unswung global position plus the swing delay on odd steps —
 *  the identical formula the hit scheduler and the render use. */
export function beatAutomationStepTimeSec(
  globalStep: number,
  stepInPattern: number,
  stepDurSec: number,
  swing: number,
): number {
  return globalStep * stepDurSec + (stepInPattern % 2 === 1 ? stepDurSec * swing : 0);
}

/** The events ONE lane contributes during ONE pattern play starting at
 *  a global step: an anchor at step 0, a ramp target at every later
 *  step, and a closing hold at the play's end (so the value sits still
 *  until the next play's anchor — or forever, in the render tail). */
export function automationPlayEvents(
  lane: BeatAutomationLane,
  globalStartStep: number,
  stepsInPattern: number,
  stepDurSec: number,
  swing: number,
): BeatAutomationEvent[] {
  const out: BeatAutomationEvent[] = [];
  if (stepsInPattern <= 0) return out;
  for (let si = 0; si < stepsInPattern; si++) {
    out.push({
      channel: lane.channel,
      param: lane.param,
      timeSec: beatAutomationStepTimeSec(globalStartStep + si, si, stepDurSec, swing),
      value: automationValueAt(lane, si),
      anchor: si === 0,
    });
  }
  out.push({
    channel: lane.channel,
    param: lane.param,
    /* Play end is an unswung boundary: global start + the play length. */
    timeSec: (globalStartStep + stepsInPattern) * stepDurSec,
    value: automationValueAt(lane, stepsInPattern - 1),
    anchor: false,
  });
  return out;
}

/** The full event list for a render scope: the plays in order (song
 *  mode's chain, or pattern mode's loop of the active pattern), each
 *  contributing its own patterns' lanes at their own lengths. */
export function automationEventsForPlays(
  plays: readonly BeatAutomationPlayInput[],
  stepDurSec: number,
  swing: number,
): BeatAutomationEvent[] {
  const out: BeatAutomationEvent[] = [];
  let global = 0;
  for (const play of plays) {
    for (const lane of play.automation) {
      out.push(...automationPlayEvents(lane, global, play.steps, stepDurSec, swing));
    }
    global += play.steps;
  }
  return out.sort((a, b) => a.timeSec - b.timeSec);
}

/** The events the live scheduler writes for ONE step of a play:
 *  - step 0: an anchor at this step's value (the caller writes it
 *    WITH cancellation, clearing any stale events from a previous
 *    play, run or edit), then the ramp to the next step's value;
 *  - middle steps: only the ramp to the next step's value — the
 *    previous step's ramp already targeted this step's value, so the
 *    glide runs unbroken, exactly like the offline list;
 *  - the play's last step: a closing ramp that holds this step's
 *    value at the play's end.
 *  `timeSec` is this step's (already swing-shifted) audio time,
 *  exactly as the hit scheduler computed it. */
export function automationStepEvents(
  lane: BeatAutomationLane,
  stepInPattern: number,
  stepsInPattern: number,
  timeSec: number,
  stepDurSec: number,
  swing: number,
): BeatAutomationEvent[] {
  const value = automationValueAt(lane, stepInPattern);
  const out: BeatAutomationEvent[] = [];
  if (stepInPattern === 0) {
    out.push({ channel: lane.channel, param: lane.param, timeSec, value, anchor: true });
  }
  if (stepInPattern >= stepsInPattern - 1) {
    /* Play end (unswung): this step's swung time minus its own swing
     * offset, plus one step of duration. */
    const swingOffset = stepInPattern % 2 === 1 ? stepDurSec * swing : 0;
    out.push({
      channel: lane.channel,
      param: lane.param,
      timeSec: timeSec - swingOffset + stepDurSec,
      value,
      anchor: false,
    });
    return out;
  }
  const nextSwingOffset = (stepInPattern + 1) % 2 === 1 ? stepDurSec * swing : 0;
  const thisSwingOffset = stepInPattern % 2 === 1 ? stepDurSec * swing : 0;
  out.push({
    channel: lane.channel,
    param: lane.param,
    timeSec: timeSec + stepDurSec + nextSwingOffset - thisSwingOffset,
    value: automationValueAt(lane, stepInPattern + 1),
    anchor: false,
  });
  return out;
}

/* ─── Writing events onto AudioParams ──────────────────────────────────── */

/** The structural subset of AudioParam both paths write through. */
export interface BeatAutomationParamTarget {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

/** Write an event list (one channel+param, time-ordered) onto a param:
 *  anchors set and ramps glide, in order. With `cancel` (the default)
 *  stale events from the first event's time onward are cancelled
 *  first — the offline render always cancels, and the live scheduler
 *  cancels at each play's step 0; mid-play live writes pass
 *  cancel:false so the glide the previous step aimed is never cut. */
export function writeBeatAutomationEvents(
  target: BeatAutomationParamTarget,
  events: readonly BeatAutomationEvent[],
  options?: { cancel?: boolean },
): void {
  if (events.length === 0) return;
  if (options?.cancel !== false) target.cancelScheduledValues(events[0]!.timeSec);
  for (const e of events) {
    if (e.anchor) target.setValueAtTime(e.value, e.timeSec);
    else target.linearRampToValueAtTime(e.value, e.timeSec);
  }
}

export function filterBeatAutomationEvents(
  events: readonly BeatAutomationEvent[],
  channel: string,
  param: BeatAutomationParamId,
): BeatAutomationEvent[] {
  return events.filter((e) => e.channel === channel && e.param === param);
}

/** Multiply every event value by a factor — the volume lane's fader
 *  base, applied identically by the live scheduler and the render. */
export function scaleBeatAutomationEvents(
  events: readonly BeatAutomationEvent[],
  factor: number,
): BeatAutomationEvent[] {
  const f = Number.isFinite(factor) ? factor : 0;
  return events.map((e) => ({ ...e, value: e.value * f }));
}
