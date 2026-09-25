/* Pure helpers for the AI Content Calendar page — kept here so they're
   unit-testable without rendering the page. */

export type CalendarPlatformKey = "tiktok" | "youtube" | "instagram";

export interface CalendarDayShape {
  date: string; // YYYY-MM-DD
  post: boolean;
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Stable signature for a calendar's inputs — used to key localStorage so
 * a regenerated calendar (different inputs) doesn't collide with an old one.
 */
export function calendarSig(
  niche: string,
  platforms: CalendarPlatformKey[],
  postsPerWeek: number,
  startDate: string,
): string {
  return `${niche}|${[...platforms].sort().join(",")}|${postsPerWeek}|${startDate}`;
}

/**
 * Number of leading blank cells before day 1 in a 7-column (Sun-first)
 * calendar grid, so the start date lands on its real weekday.
 */
export function leadBlankCount(days: CalendarDayShape[]): number {
  if (days.length === 0) return 0;
  return new Date(days[0]!.date + "T00:00:00Z").getUTCDay();
}

/** Count of posting days in a generated calendar. */
export function postingCount(days: CalendarDayShape[]): number {
  return days.filter((d) => d.post).length;
}
