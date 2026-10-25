/* ─── membership-pause.ts — membership pause core (wave-4 #39). Pure.
 *
 * The gap this closes: a willing-but-broke fan had exactly one button —
 * cancel — and cancelled fans mostly never return. Pause lets the fan
 * rest 1–3 months instead: access sleeps, billing skips, resume is one
 * tap, and the resume date is stated plainly BEFORE the fan confirms.
 *
 * THE RAIL, HONESTLY: fan memberships are NOT a Stripe subscription —
 * they are one paid period at a time via Stripe-hosted checkout, with
 * no auto-charge (see routes/generate/memberships.ts header). So
 * "billing skips" here means the paid-period CLOCK freezes:
 *   - while paused, no paid time burns — the stored
 *     current_period_end is never consumed by the pause;
 *   - on resume (one tap, or automatically once the stated resume
 *     date arrives) current_period_end shifts forward by exactly the
 *     time spent paused, so the next renewal falls due that much
 *     later — never during the rest;
 *   - a paused seat can never drift into past_due: pause is only
 *     offered from an effective "active" seat, and the stored status
 *     while resting is "paused", which dunning never reads (dunning
 *     works stored "past_due" rows only — lib/dunning). The two
 *     rescues never entangle: dunning rescues a failed PAYMENT, pause
 *     rescues a willing fan. A past-due fan cannot pause — their door
 *     is the card-update door, and the pause door answers 409.
 *
 * ENTITLEMENT HONESTY: every membership gate in the product admits
 * only effective "trialing" / "active" (members-only posts via
 * lib/close-friends + lib/fan-tier-gate, tier-gated rooms via
 * lib/fan-tier-gate, email member segments via a stored-status
 * IN ('active','trialing') query). A stored "paused" row therefore
 * sleeps EVERYWHERE at once by construction, and this module's
 * effective-status mirror is what the two read-time status functions
 * (memberships.ts effectiveMemberStatus, fan-tier-gate.ts
 * effectiveFanMemberStatus) share so no surface can drift.
 *
 * AUTO-RESUME: stored rows are never silently rewritten (the house
 * rule for effective statuses). Once `paused_until` passes, the
 * effective status reads "active" again — with the period end
 * shifted by the full planned pause — until that shifted end passes,
 * when it reads "expired" like any unpaid period. The fan's one-tap
 * resume performs the same shift as a write, so the stored row and
 * every read agree.
 */

export const PAUSE_MIN_MONTHS = 1;
export const PAUSE_MAX_MONTHS = 3;

export interface PausableMemberLike {
  status: string;
  fan_user_id: string | null;
  trial_ends_at: Date | string | null;
  current_period_end: Date | string | null;
  paused_at: Date | string | null;
  paused_until: Date | string | null;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar months later — Jan 31 + 1 month clamps to Feb's last day
 *  (Date#setMonth semantics roll over; the clamp keeps the stated
 *  resume date inside the month the fan picked). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** The resume date stated to the fan before they confirm: paused_at +
 *  the chosen months. The pause write stores exactly this value as
 *  paused_until, so the promise and the row can never drift. */
export function pauseResumeDate(pausedAt: Date, months: number): Date {
  return addMonths(pausedAt, months);
}

export function isValidPauseMonths(months: unknown): months is number {
  return (
    typeof months === "number" &&
    Number.isInteger(months) &&
    months >= PAUSE_MIN_MONTHS &&
    months <= PAUSE_MAX_MONTHS
  );
}

/** How much of the period clock the pause consumed: from paused_at to
 *  the earlier of the actual resume moment and the stated resume date
 *  (a late resume never shifts the period past the planned rest — the
 *  auto-resume already returned access at paused_until). Zero for a
 *  row with no honest pause window. */
export function pauseElapsedMs(m: PausableMemberLike, resumeAt: Date): number {
  const start = asDate(m.paused_at);
  const until = asDate(m.paused_until);
  if (!start || !until) return 0;
  const end = resumeAt.getTime() < until.getTime() ? resumeAt : until;
  return Math.max(0, end.getTime() - start.getTime());
}

/** The period end as it reads DURING/AFTER a pause: the stored end
 *  shifted forward by the pause elapsed at `now`. While still resting
 *  this is the end the fan will come back to; after the resume date
 *  it is the end the auto-resumed seat runs to. */
export function pausedPeriodEnd(m: PausableMemberLike, now: Date = new Date()): Date | null {
  const end = asDate(m.current_period_end);
  if (!end) return null;
  return new Date(end.getTime() + pauseElapsedMs(m, now));
}

/**
 * The effective status of a PAUSED row, shared by every read-time
 * status mirror. Returns null when the row is not paused (the caller
 * applies its own rules), otherwise:
 *   - "paused"  — still resting (now < paused_until): admits nowhere.
 *   - "active"  — the stated resume date has arrived: access is back,
 *                 running to the pause-shifted period end.
 *   - "expired" — auto-resumed but the shifted paid period has also
 *                 run out unpaid (paid rows only; a manual row with
 *                 no period end never expires, matching the house rule
 *                 for manual tracking rows).
 * A paused row with no honest pause window (paused_until missing)
 * reads "paused" — access stays asleep rather than inventing a resume
 * date nobody stated.
 */
export function pausedEffectiveStatus(m: PausableMemberLike, now: Date = new Date()): string | null {
  if (m.status !== "paused") return null;
  const until = asDate(m.paused_until);
  if (!until || now < until) return "paused";
  const shiftedEnd = pausedPeriodEnd(m, now);
  if (m.fan_user_id && shiftedEnd && shiftedEnd <= now) return "expired";
  return "active";
}

/** True while the seat is actually resting (stored paused and the
 *  stated resume date has not yet arrived). */
export function isResting(m: PausableMemberLike, now: Date = new Date()): boolean {
  return pausedEffectiveStatus(m, now) === "paused";
}
