/* ─── First 100 Fans (#155) — client seam ──────────────────────────
   The dashboard card's brain. The SERVER owns the truth (fan count
   from real follows, steps from real state, celebrations exactly
   once); this module owns only presentation decisions:
     - milestone ladder + progress math for rendering,
     - whether the card shows at all (mirrors the server's smart-law
       surface rule so a snoozed/completed journey never flashes),
     - the celebration headline for a pending milestone.
   Nothing here invents a number: every figure it formats came from
   GET /api/first100. */

export const FIRST100_MILESTONES = [1, 10, 25, 50, 100] as const;
export type First100Milestone = (typeof FIRST100_MILESTONES)[number];
export const FIRST100_GOAL = 100;

export interface First100MilestoneState {
  milestone: number;
  reached: boolean;
  celebrated: boolean;
}

export interface First100Step {
  key: string;
  title: string;
  blurb: string;
  href: string;
  done: boolean;
}

export interface First100EarlyFan {
  fanNumber: number;
  userId: string;
  displayName: string | null;
  slug: string | null;
  avatarUrl: string | null;
  followedAt: string;
}

export interface First100Status {
  fanCount: number;
  goal: number;
  progressPct: number;
  milestones: First100MilestoneState[];
  currentMilestone: number | null;
  nextMilestone: number | null;
  fansToNext: number | null;
  pendingCelebrations: number[];
  steps: First100Step[];
  nextStep: string | null;
  earlyFans: First100EarlyFan[];
  surface: boolean;
  completed: boolean;
  completedAt: string | null;
  snoozeUntil: string | null;
}

/** The next milestone still ahead of a count, or null at/past 100. */
export function nextMilestoneFor(fanCount: number): number | null {
  return FIRST100_MILESTONES.find((m) => fanCount < m) ?? null;
}

/** Honest progress toward the goal, clamped — never above 100%. */
export function progressPctFor(fanCount: number): number {
  if (fanCount <= 0) return 0;
  return Math.min(100, Math.floor((fanCount / FIRST100_GOAL) * 100));
}

/**
 * Whether the dashboard card renders. The server's `surface` flag is
 * the authority; this client check only keeps a locally-dismissed
 * card (same session, before the refetch lands) from flashing back,
 * and never resurrects a completed program.
 */
export function shouldShowFirst100Card(
  status: Pick<First100Status, "surface" | "completed" | "pendingCelebrations"> | null,
  locallyDismissed: boolean,
): boolean {
  if (!status) return false;
  if (!status.surface) return false;
  if (status.completed && status.pendingCelebrations.length === 0) return false;
  if (locallyDismissed && status.pendingCelebrations.length === 0) return false;
  return true;
}

/** Headline for the celebration banner, keyed by the milestone just hit. */
export function celebrationHeadline(milestone: number): string {
  switch (milestone) {
    case 1:
      return "Your first fan is here";
    case 10:
      return "10 fans strong";
    case 25:
      return "25 fans — a real crowd";
    case 50:
      return "Halfway there — 50 fans";
    case 100:
      return "100 fans! You did it";
    default:
      return `${milestone} fans`;
  }
}

/** The one next action the card leads with (the first open step). */
export function nextStepOf(status: Pick<First100Status, "steps" | "nextStep">): First100Step | null {
  if (!status.nextStep) return null;
  return status.steps.find((s) => s.key === status.nextStep) ?? null;
}
