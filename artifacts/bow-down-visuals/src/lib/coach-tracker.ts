/* Coach Action Tracker — shared types + pure helpers for the /coach
   Action Tracker tab. The numbers come from GET /api/coach/plan-numbers
   (server sums over the creator's own money ledger + platform state);
   nothing here computes money from anything but that DTO. */

export interface PlanNumbersDto {
  asOf: string;
  currentMonth: { key: string; incomeCents: number; expenseCents: number; netCents: number };
  trailing: {
    monthsCounted: number;
    monthKeys: string[];
    avgMonthlyIncomeCents: number | null;
    avgMonthlyNetCents: number | null;
  };
  allTimeLedger: { incomeCents: number; expenseCents: number; netCents: number; entryCount: number };
  platform: {
    earningsCents: number;
    tipsVb: number;
    songs: number;
    releases: number;
    storeProducts: number;
    membershipTiers: number;
  };
  goal: {
    monthlyGoalCents: number;
    percentOfGoal: number | null;
    monthlyGapCents: number | null;
    met: boolean;
    monthsOfNetToBankGoalMonth: number | null;
  } | null;
  hasData: boolean;
}

export interface CoachActionItemDto {
  id: string;
  title: string;
  source: "plan" | "niche" | "custom";
  done: boolean;
  completedAt: string | null;
  createdAt: string | null;
}

/** "$1,234.56" formatting identical to the Money Tracker panel. */
export function fmtPlanMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole-dollar formatting for headline figures. */
export function fmtPlanMoneyShort(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
}

export function trackerProgress(items: CoachActionItemDto[]): {
  done: number;
  total: number;
  pct: number;
} {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** Parse a typed dollar goal ("1,500" / "1500.50") into cents, or null. */
export function parseGoalCents(raw: string): number | null {
  if (raw.includes("-")) return null; // a goal is never negative
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const dollars = parseFloat(cleaned);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}
