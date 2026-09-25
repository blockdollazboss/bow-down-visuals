/* Pure helpers for the Content Scheduler page — kept here so they're
   unit-testable without rendering the page. */

export type SchedulerPlatformKey = "instagram" | "tiktok" | "facebook";

export interface ScheduledPostShape {
  id: string;
  status: "draft" | "scheduled" | "publishing" | "posted" | "failed" | "canceled";
  mediaUrl: string;
  mediaType: "video" | "image";
  caption: string;
  hashtags: string;
  platforms: SchedulerPlatformKey[];
  accountIds: Partial<Record<SchedulerPlatformKey, string>>;
  scheduledAt: string | null; // ISO
  postedAt: string | null; // ISO
  attempts: number;
  lastError: string | null;
  creditsCharged: number;
  results: Array<{ platform: SchedulerPlatformKey; status: string; error?: string | null }>;
  createdAt: string;
  updatedAt: string;
}

/** YYYY-MM-DD for a Date in local time. */
export function toLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Value for <input type="date"> — today in local time. */
export function todayLocal(): string {
  return toLocalDate(new Date());
}

/** Value for <input type="time"> — HH:MM in local time. */
export function timeLocal(d: Date = new Date()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Combine a YYYY-MM-DD date string and HH:MM time string into a Date in
 * local time. Returns null when the inputs don't parse.
 */
export function combineLocalDateTime(dateStr: string, timeStr: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return null;
  const [y, m, day] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const d = new Date(y!, m! - 1, day!, hh!, mm!, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when the local datetime is at least a minute in the future. */
export function isFutureLocal(dateStr: string, timeStr: string): boolean {
  const d = combineLocalDateTime(dateStr, timeStr);
  return d !== null && d.getTime() > Date.now() + 60_000;
}

/**
 * Move a post's scheduled time to a new YYYY-MM-DD date, keeping the same
 * local time-of-day. Used by drag-to-reschedule on the calendar.
 */
export function movePostToDate(scheduledAtISO: string, targetDate: string): string | null {
  const current = new Date(scheduledAtISO);
  if (Number.isNaN(current.getTime())) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null;
  const [y, m, day] = targetDate.split("-").map(Number);
  const moved = new Date(y!, m! - 1, day!, current.getHours(), current.getMinutes(), 0, 0);
  return Number.isNaN(moved.getTime()) ? null : moved.toISOString();
}

/** Group scheduled posts by their local YYYY-MM-DD date. */
export function groupPostsByDay(posts: ScheduledPostShape[]): Map<string, ScheduledPostShape[]> {
  const map = new Map<string, ScheduledPostShape[]>();
  for (const p of posts) {
    if (!p.scheduledAt) continue;
    const key = toLocalDate(new Date(p.scheduledAt));
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  }
  return map;
}

/** Human countdown: "in 3h 20m", "in 2d 4h", "now", or "overdue". */
export function countdownLabel(scheduledAtISO: string, nowMs: number = Date.now()): string {
  const target = new Date(scheduledAtISO).getTime();
  const diff = target - nowMs;
  if (diff <= 0) return "due now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "due now";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const rem = mins % 60;
    return rem === 0 ? `in ${hours}h` : `in ${hours}h ${rem}m`;
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH === 0 ? `in ${days}d` : `in ${days}d ${remH}h`;
}

/** "Mon, Sep 28 · 6:00 PM" style label in local time. */
export function prettyDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Cost in credits to schedule a post — flat 1 credit per post, no matter
    how many platforms it targets. */
export function scheduleCost(platforms: SchedulerPlatformKey[]): number {
  return platforms.length > 0 ? 1 : 0;
}

/** Normalize a hashtags field: ensure each tag starts with # and dedupe. */
export function normalizeHashtags(raw: string): string {
  const tags = raw
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter((t) => t.length > 0 && t.length <= 60)
    .map((t) => `#${t}`);
  return [...new Set(tags)].join(" ");
}

/** Days (YYYY-MM-DD) for the visible month grid, including leading blanks. */
export function monthGridDays(year: number, month: number): { date: string | null }[] {
  const first = new Date(year, month, 1);
  const leadBlanks = first.getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: string | null }[] = [];
  for (let i = 0; i < leadBlanks; i++) cells.push({ date: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    });
  }
  return cells;
}
