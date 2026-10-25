/**
 * Dunning — membership payment recovery (Stack-100 #3, #21).
 *
 * The gap this closes: `past_due` fan memberships were counted
 * (Memberships desk, command center) and creator-tier rows were flagged
 * by the Stripe webhook, but nothing ever WORKED the list — no chase,
 * no fan-facing way to fix the card, no recovery visibility.
 *
 * This module is the pure core (no DB, no Stripe): the grace law, the
 * recovery sequence timeline, the per-step copy, and the recovery-state
 * derivation. The DB/Stripe edges live in lib/email-automations.ts
 * (the sequence rides that rail as the `membership_payment_recovery`
 * kind) and routes/generate/memberships.ts (grace-aware status, the
 * fan's update-payment door, the creator Recovery view).
 *
 * GRACE HONESTY (the hard rule):
 *   - A paid membership whose payment failed is `past_due` for exactly
 *     DUNNING_GRACE_DAYS from the failure, then it reads `expired` —
 *     access ends at the date every recovery email and the fan's own
 *     membership page stated, never before and never silently after.
 *   - The fan is told BEFORE access ends: the final warning lands a
 *     full day before the grace end.
 *   - Nothing here fabricates a payment state: recovery is derived
 *     only from the member row's real status (a seat is "recovered"
 *     when the row is active again, which only a Stripe-verified
 *     payment — or the creator's own hand — can produce).
 *   - Manual tracking rows (fan_user_id null) have no payment rail:
 *     they never auto-expire and their recovery state never claims a
 *     payment happened.
 *
 * "Past due since" = the member row's updated_at. Every status change
 * (the webhook's flag, the creator's status rail, a verified renewal)
 * stamps updated_at, so for a row currently in past_due it is the
 * moment the current failure episode began, to the precision the house
 * records. A new episode (the row leaves past_due and returns) gets a
 * new episode key, so the sequence re-arms; within an episode the
 * email-automation claim ledger dedupes each step exactly once.
 */

/* Grace length in days. Mirrors the house's other fan-facing window,
   the 7-day free trial (MEMBERSHIP_TRIAL_DAYS). */
export const DUNNING_GRACE_DAYS = 7;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type DunningStepKey =
  | "payment_failed_notice"
  | "payment_reminder"
  | "card_update_nudge"
  | "final_warning";

export interface DunningStep {
  key: DunningStepKey;
  /** Hours after the failure when this step comes due. */
  offsetHours: number;
  subject: string;
  body: string;
}

/* The sequence. Copy law: every step states the SAME access-end date
   rule (the grace end) — the fan hears one consistent truth, earlier
   each time it matters more. The update door is the membership page
   itself: /memberships carries the fan's "Update card & renew"
   button for a past-due seat (Stripe-hosted checkout — the fan enters
   the new card there; no card data ever touches this site). */
export const DUNNING_STEPS: readonly DunningStep[] = [
  {
    key: "payment_failed_notice",
    offsetHours: 0,
    subject: "Your membership payment didn't go through",
    body:
      "Hi there,\n\nWe tried to take the payment for your membership and it didn't go through — " +
      "this happens with expired cards, replaced cards, and banks being careful.\n\n" +
      "Your membership is still on for now. You have 7 days from the failed payment to update " +
      "your card before access pauses. Update it any time from Your Memberships on Bow Down Visuals " +
      "(/memberships) — you'll enter your new card on Stripe's secure page.\n\n" +
      "If you already fixed it, you can ignore this — a successful payment ends these reminders.",
  },
  {
    key: "payment_reminder",
    offsetHours: 72,
    subject: "Reminder: your membership payment is still past due",
    body:
      "Hi there,\n\nYour membership payment is still past due. Stripe keeps retrying, but the " +
      "surest fix is a working card: update yours from Your Memberships on Bow Down Visuals " +
      "(/memberships) and your membership continues without a gap.\n\n" +
      "Access pauses 7 days after the failed payment if it still hasn't succeeded — we'll warn " +
      "you once more before that happens.",
  },
  {
    key: "card_update_nudge",
    offsetHours: 120,
    subject: "Is your card about to expire? Update it to keep your membership",
    body:
      "Hi there,\n\nMost failed membership payments turn out to be a card that expired or was " +
      "replaced. If that's yours, one minute now saves your seat: update your card from Your " +
      "Memberships on Bow Down Visuals (/memberships) — Stripe's secure page takes the new card, " +
      "we never see it.\n\nAccess pauses 7 days after the failed payment if no payment has " +
      "succeeded by then.",
  },
  {
    key: "final_warning",
    offsetHours: 144,
    subject: "Final warning: your membership access pauses tomorrow",
    body:
      "Hi there,\n\nThis is the last warning before it happens: if your membership payment " +
      "hasn't succeeded by tomorrow — 7 days after it first failed — your access pauses and " +
      "your seat reads as ended.\n\nYou can still fix it in a minute: update your card from " +
      "Your Memberships on Bow Down Visuals (/memberships). If a payment succeeds after access " +
      "pauses, your membership comes straight back — nothing you've earned is taken away.",
  },
] as const;

export const DUNNING_STEP_COUNT = DUNNING_STEPS.length;

/* ── Member shape this module reads (a fan_members row slice) ──────── */

export interface DunningMemberLike {
  id: string;
  status: string;
  fan_user_id: string | null;
  updated_at: Date | string | null;
  created_at?: Date | string | null;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** When the current failure episode began, per the module header. */
export function pastDueSince(m: DunningMemberLike): Date | null {
  return asDate(m.updated_at) ?? asDate(m.created_at);
}

/** The moment access pauses if no payment has succeeded — the date
 *  every recovery step and the fan's own page state. Null for rows
 *  that are not past due, and for manual rows (no payment rail, so
 *  no honest end date exists). */
export function dunningGraceEndsAt(m: DunningMemberLike): Date | null {
  if (m.status !== "past_due" || !m.fan_user_id) return null;
  const since = pastDueSince(m);
  if (!since) return null;
  return new Date(since.getTime() + DUNNING_GRACE_DAYS * DAY_MS);
}

/** True when a paid past-due row's grace has fully run out. */
export function isDunningExpired(m: DunningMemberLike, now: Date = new Date()): boolean {
  const ends = dunningGraceEndsAt(m);
  return ends != null && ends <= now;
}

/** Whole days of grace left (0 on the final day). Null off-grace. */
export function dunningDaysLeft(m: DunningMemberLike, now: Date = new Date()): number | null {
  const ends = dunningGraceEndsAt(m);
  if (!ends) return null;
  const ms = ends.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / DAY_MS);
}

/* ── Sequence triggers ─────────────────────────────────────────────── */

export interface DunningTrigger {
  /** Claim-ledger dedupe ref (unique per member + episode + step). */
  ref: string;
  email: string;
  /** When this step comes due — the runner's gates read this. */
  eventAt: Date;
  stepKey: DunningStepKey;
  subject: string;
  body: string;
}

/** The dedupe-ref prefix for one member's one failure episode. */
export function dunningEpisodeRef(memberId: string, since: Date): string {
  return `member:${memberId}:past_due:${since.toISOString()}`;
}

/** Parse the member id out of any dunning trigger ref (the Recovery
 *  view joins sends back to members through this). Null for refs that
 *  are not dunning refs. */
export function memberIdFromDunningRef(ref: string): string | null {
  const match = /^member:([^:]+):past_due:/.exec(ref);
  return match ? match[1]! : null;
}

/** The episode start (the failure moment) encoded in a dunning ref:
 *  `member:<id>:past_due:<ISO>:<step>` — the ISO carries its own
 *  colons, so it is sliced between the marker and the LAST colon. */
export function episodeStartFromDunningRef(ref: string): Date | null {
  const marker = ":past_due:";
  const at = ref.indexOf(marker);
  if (at < 0) return null;
  const rest = ref.slice(at + marker.length);
  const iso = rest.slice(0, rest.lastIndexOf(":"));
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Every step trigger for one past-due member. All steps are returned
 *  regardless of due-ness — the automation runner's eventAt + delay
 *  gates decide what fires on a given sweep, exactly like the other
 *  kinds. Members not in past_due produce nothing: the chase stops
 *  the moment the row says the payment reality changed. That includes
 *  a PAUSED member (wave-4 #39): pause is the willing fan's rest, not
 *  a failed payment — a paused row is never past_due (pause requires
 *  an active seat, and resuming a paused seat never writes past_due),
 *  so a resting fan is never chased. The two rescues stay separate. */
export function dunningTriggersForMember(
  m: DunningMemberLike,
  email: string,
): DunningTrigger[] {
  if (m.status !== "past_due") return [];
  const since = pastDueSince(m);
  if (!since) return [];
  const episode = dunningEpisodeRef(m.id, since);
  return DUNNING_STEPS.map((step) => ({
    ref: `${episode}:${step.key}`,
    email,
    eventAt: new Date(since.getTime() + step.offsetHours * HOUR_MS),
    stepKey: step.key,
    subject: step.subject,
    body: step.body,
  }));
}

/* ── Recovery state (the creator Recovery view's derivation) ───────── */

export type DunningRecoveryState =
  | "in_grace" /* past due, chase running, access not yet ended */
  | "recovered" /* was chased, the row is active again */
  | "access_ended" /* grace ran out (or the seat was ended) unpaid */
  | "ended_other"; /* canceled by fan/creator during or after a chase */

export interface DunningSendLike {
  triggerRef: string;
  status: string; /* sent | failed | no_provider | skipped_unsubscribed | queued */
  sentAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface DunningRecovery {
  state: DunningRecoveryState;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  daysLeft: number | null;
  /** Steps the rail actually sent (status 'sent') for this episode —
   *  measured from the claim ledger, never assumed. */
  stepsSent: number;
  stepCount: number;
  lastStepKey: string | null;
  lastSentAt: string | null;
}

/** Derive one member's recovery picture from its row + the claim
 *  ledger rows for its CURRENT episode (callers pass the member's
 *  sends; episode matching happens here so a stale episode's sends
 *  never inflate a new chase). */
export function recoveryForMember(
  m: DunningMemberLike & { canceled_at?: Date | string | null },
  sends: DunningSendLike[],
  effectiveStatus: string,
  now: Date = new Date(),
): DunningRecovery {
  const rowSince = pastDueSince(m);
  /* Still past due: the row's updated_at IS the episode start. No
     longer past due: updated_at moved on with the recovery/end write,
     so the honest episode start comes from the sends' own refs. */
  const refSince =
    m.status !== "past_due"
      ? (sends
          .map((s) => episodeStartFromDunningRef(s.triggerRef))
          .filter((d): d is Date => d != null)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null)
      : null;
  const since = m.status === "past_due" ? rowSince : (refSince ?? (sends.length > 0 ? rowSince : null));
  /* For a recovered/ended member the row's updated_at moved on (the
     recovery write), so the current-episode ref can't be rebuilt from
     it — match this member's sends by member id instead and take the
     latest episode among them. For a member still past_due, updated_at
     IS the episode start, so filter to that exact episode. */
  const mine = sends.filter((s) => memberIdFromDunningRef(s.triggerRef) === m.id);
  const episodeSends =
    m.status === "past_due" && since
      ? mine.filter((s) => s.triggerRef.startsWith(dunningEpisodeRef(m.id, since)))
      : mine;
  const sent = episodeSends
    .filter((s) => s.status === "sent")
    .sort((a, b) => (asDate(a.sentAt ?? a.createdAt)?.getTime() ?? 0) - (asDate(b.sentAt ?? b.createdAt)?.getTime() ?? 0));
  const last = sent[sent.length - 1];
  const lastStepKey = last
    ? (last.triggerRef.split(":").pop() as DunningStepKey | undefined) ?? null
    : null;

  let state: DunningRecoveryState;
  if (effectiveStatus === "active" || effectiveStatus === "trialing") state = "recovered";
  else if (effectiveStatus === "past_due") state = "in_grace";
  else if (effectiveStatus === "canceled") state = "ended_other";
  else state = "access_ended"; /* expired */

  const graceEnds = dunningGraceEndsAt(m);
  return {
    state,
    pastDueSince: since ? since.toISOString() : null,
    graceEndsAt: graceEnds ? graceEnds.toISOString() : null,
    daysLeft: dunningDaysLeft(m, now),
    stepsSent: sent.length,
    stepCount: DUNNING_STEP_COUNT,
    lastStepKey,
    lastSentAt: last ? (asDate(last.sentAt ?? last.createdAt)?.toISOString() ?? null) : null,
  };
}
