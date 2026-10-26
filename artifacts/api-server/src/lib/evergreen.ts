/* ─── Evergreen recycling (Wave-4 #48) — pure scheduling machine ─────────
   The house re-surfaces a creator's OWN back catalog on a schedule the
   CREATOR controls. Docked in the Scheduler (the posts it recycles are
   scheduled_posts; approval produces a scheduled_posts DRAFT) — never a
   standalone surface, and it NEVER posts anything:

   1. Per-creator ON/OFF. Default OFF. While off, no candidates are
      computed and no proposals are generated for that creator.
   2. Creator approval before anything posts — structurally, not by
      policy: the only output of this system is a PROPOSAL. Approving a
      proposal creates a free DRAFT in the Scheduler; the creator still
      reviews it and presses Schedule themselves on the scheduler's
      normal rail. There is no code path from evergreen to a live post.
   3. Proven posts only: a post is eligible once it actually posted
      (status `posted` with a posted_at) and has rested in the catalog
      for MIN_CATALOG_AGE_DAYS — brand-new posts are not "back catalog".
   4. Per-platform spacing + decay stop: a post may resurface only after
      `spacingDaysForCycle` days since its last showing, and the spacing
      DOUBLES every cycle (7d → 14d → 28d …), so a post's returns decay
      instead of spamming — and stop outright at the creator's maxCycles.
   5. Smart law: proposals land only inside the creator's own windows
      (days + hours + their timezone), one proposal per source post, and
      generation is idempotent — a post with a pending proposal is never
      proposed twice.

   Money: none. Browsing candidates, generating proposals, and the
   draft an approval creates are all free interface. If the creator
   schedules the draft, the Scheduler's existing rail applies — this
   module invents no price. */

export interface EvergreenWindows {
  days: number[]; // 0 = Sunday … 6 = Saturday
  startHour: number; // 0–23 local
  endHour: number; // 1–24 local, > startHour
  timezone: string; // IANA
}

export interface EvergreenSettings {
  enabled: boolean;
  windows: EvergreenWindows;
  baseSpacingDays: number;
  maxCycles: number;
}

export const DEFAULT_EVERGREEN_SETTINGS: EvergreenSettings = {
  enabled: false,
  windows: { days: [2, 4], startHour: 17, endHour: 21, timezone: "America/New_York" },
  baseSpacingDays: 7,
  maxCycles: 3,
};

/** A post must rest this long after posting before it counts as back catalog. */
export const MIN_CATALOG_AGE_DAYS = 14;

export const EVERGREEN_LIMITS = {
  baseSpacingDays: { min: 1, max: 90 },
  maxCycles: { min: 1, max: 6 },
  perksNone: null,
} as const;

/** Validate + normalize creator-supplied settings. Returns the clean
 *  settings or an error message — the route turns it into a 400. */
export function normalizeEvergreenSettings(raw: unknown): { settings: EvergreenSettings } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Settings must be an object." };
  const r = raw as Record<string, unknown>;
  const w = (r.windows ?? {}) as Record<string, unknown>;
  const daysRaw = Array.isArray(w.days) ? w.days : DEFAULT_EVERGREEN_SETTINGS.windows.days;
  const days = [...new Set(daysRaw.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort();
  if (days.length === 0) return { error: "Pick at least one day for your evergreen windows." };
  const startHour = Number(w.startHour ?? DEFAULT_EVERGREEN_SETTINGS.windows.startHour);
  const endHour = Number(w.endHour ?? DEFAULT_EVERGREEN_SETTINGS.windows.endHour);
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) return { error: "Window start hour must be 0–23." };
  if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24 || endHour <= startHour) {
    return { error: "Window end hour must be after the start hour (and at most 24)." };
  }
  const timezone = typeof w.timezone === "string" && w.timezone.trim() ? w.timezone.trim().slice(0, 60) : DEFAULT_EVERGREEN_SETTINGS.windows.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { error: "That timezone isn't recognized." };
  }
  const baseSpacingDays = Number(r.baseSpacingDays ?? DEFAULT_EVERGREEN_SETTINGS.baseSpacingDays);
  if (!Number.isInteger(baseSpacingDays) || baseSpacingDays < EVERGREEN_LIMITS.baseSpacingDays.min || baseSpacingDays > EVERGREEN_LIMITS.baseSpacingDays.max) {
    return { error: `Spacing must be ${EVERGREEN_LIMITS.baseSpacingDays.min}–${EVERGREEN_LIMITS.baseSpacingDays.max} days.` };
  }
  const maxCycles = Number(r.maxCycles ?? DEFAULT_EVERGREEN_SETTINGS.maxCycles);
  if (!Number.isInteger(maxCycles) || maxCycles < EVERGREEN_LIMITS.maxCycles.min || maxCycles > EVERGREEN_LIMITS.maxCycles.max) {
    return { error: `Max cycles must be ${EVERGREEN_LIMITS.maxCycles.min}–${EVERGREEN_LIMITS.maxCycles.max}.` };
  }
  return {
    settings: {
      enabled: r.enabled === true,
      windows: { days, startHour, endHour, timezone },
      baseSpacingDays,
      maxCycles,
    },
  };
}

/** The decay stop, as spacing: cycle 1 waits the base spacing, cycle 2
 *  waits twice that, cycle 3 four times — returns get rarer until the
 *  maxCycles hard stop ends them. */
export function spacingDaysForCycle(baseSpacingDays: number, cycle: number): number {
  const c = Math.max(1, Math.floor(cycle));
  return baseSpacingDays * 2 ** (c - 1);
}

export interface EvergreenCandidateInput {
  postId: string;
  status: string;
  postedAt: string | Date | null;
  platforms: string[];
  /** How many times this post has already been recycled (approved proposals). */
  cyclesUsed: number;
  /** When it last resurfaced (approved proposal's slot), if ever. */
  lastRecycledAt: string | Date | null;
  /** A proposal for this post is already waiting on the creator. */
  hasPendingProposal: boolean;
}

export type EvergreenSkipReason =
  | "not_posted"
  | "too_new"
  | "max_cycles"
  | "spacing"
  | "pending_proposal";

export function evergreenSkipReason(
  input: EvergreenCandidateInput,
  settings: EvergreenSettings,
  now: Date,
): EvergreenSkipReason | null {
  if (input.status !== "posted" || !input.postedAt) return "not_posted";
  const postedAt = new Date(input.postedAt);
  const ageDays = (now.getTime() - postedAt.getTime()) / 86_400_000;
  if (ageDays < MIN_CATALOG_AGE_DAYS) return "too_new";
  if (input.cyclesUsed >= settings.maxCycles) return "max_cycles";
  if (input.hasPendingProposal) return "pending_proposal";
  const nextCycle = input.cyclesUsed + 1;
  const lastShown = input.lastRecycledAt ? new Date(input.lastRecycledAt) : postedAt;
  const spacingDays = spacingDaysForCycle(settings.baseSpacingDays, nextCycle);
  if ((now.getTime() - lastShown.getTime()) / 86_400_000 < spacingDays) return "spacing";
  return null;
}

export function isEvergreenEligible(input: EvergreenCandidateInput, settings: EvergreenSettings, now: Date): boolean {
  return settings.enabled && evergreenSkipReason(input, settings, now) === null;
}

/* ─── Window slot math (creator's timezone) ─────────────────────────── */

function zonedParts(d: Date, timezone: string): { weekday: number; hour: number; minute: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "Sun");
  return {
    weekday,
    hour: Number(parts.hour ?? 0),
    minute: Number(parts.minute ?? 0),
    year: Number(parts.year ?? 1970),
    month: Number(parts.month ?? 1),
    day: Number(parts.day ?? 1),
  };
}

/** The next moment STRICTLY AFTER `after` that falls inside the
 *  creator's windows, at the window's opening hour. Searches up to 14
 *  days ahead in 30-minute steps — windows are day/hour grained, so a
 *  hit is guaranteed whenever days is non-empty; null only for a
 *  degenerate window. */
export function nextEvergreenSlot(windows: EvergreenWindows, after: Date): Date | null {
  const stepMs = 30 * 60_000;
  // Start from the next whole 30-minute mark so a proposal never lands in the past.
  let cursor = new Date(Math.ceil((after.getTime() + 1) / stepMs) * stepMs);
  const deadline = after.getTime() + 14 * 86_400_000;
  while (cursor.getTime() <= deadline) {
    const p = zonedParts(cursor, windows.timezone);
    if (windows.days.includes(p.weekday) && p.hour >= windows.startHour && p.hour < windows.endHour) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return null;
}

export interface EvergreenProposalDraft {
  sourcePostId: string;
  cycle: number;
  proposedSlot: Date;
  spacingDays: number;
}

/** Build the proposal set for one generate pass: eligible posts only,
 *  one proposal each, slots staggered a day apart inside the windows
 *  so a whole batch never lands on a single slot. */
export function buildEvergreenProposals(
  inputs: EvergreenCandidateInput[],
  settings: EvergreenSettings,
  now: Date,
): { proposals: EvergreenProposalDraft[]; skipped: Record<EvergreenSkipReason, number> } {
  const skipped: Record<EvergreenSkipReason, number> = {
    not_posted: 0,
    too_new: 0,
    max_cycles: 0,
    spacing: 0,
    pending_proposal: 0,
  };
  const proposals: EvergreenProposalDraft[] = [];
  if (!settings.enabled) return { proposals, skipped };
  /* Stagger: each proposal searches from a day after the previous
     proposal's slot, so a batch never piles onto one slot even when
     the creator's windows only open once a week. */
  let searchAfter = now;
  for (const input of inputs) {
    const reason = evergreenSkipReason(input, settings, now);
    if (reason) {
      skipped[reason] += 1;
      continue;
    }
    const cycle = input.cyclesUsed + 1;
    const slot = nextEvergreenSlot(settings.windows, searchAfter);
    if (!slot) continue;
    proposals.push({
      sourcePostId: input.postId,
      cycle,
      proposedSlot: slot,
      spacingDays: spacingDaysForCycle(settings.baseSpacingDays, cycle),
    });
    searchAfter = new Date(slot.getTime() + 86_400_000);
  }
  return { proposals, skipped };
}

/** Postgres "undefined table" (42P01) guard — same discipline as
 *  co-posts: writes answer an honest 503 until the provisional
 *  migration lands; guarded reads degrade to defaults. */
export function isMissingEvergreenTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.code === "42P01") return true;
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return /evergreen_(settings|proposals)/.test(msg) && /(does not exist|undefined table|no such table)/i.test(msg);
}

export const EVERGREEN_NOT_READY = {
  error: "evergreen_not_ready",
  message:
    "Evergreen recycling is almost ready — the final setup step hasn't landed yet, so nothing was saved or queued.",
} as const;

/** The exact honesty copy every evergreen surface must carry. */
export const EVERGREEN_COPY = {
  neverAutoPosts:
    "Evergreen never posts on its own. It only proposes — nothing resurfaces until you approve it, and approving creates a draft you still schedule yourself.",
  approvalGate: "Every resurfacing needs your approval first.",
  decayStop:
    "Returns slow down on purpose: the wait doubles every cycle, and a post stops for good at your cycle cap.",
} as const;
