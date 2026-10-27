/* ─── Cover Fridays (N19) ────────────────────────────────────────────────
   A weekly ritual on the challenge engine: every Friday a cover-song
   theme opens; creators post their cover with #CoverFriday; entries close
   Sunday night; the cover with the most REAL plays wins the week and is
   crowned on the challenge page. This module is the cycle math — pure,
   deterministic, timezone-explicit (America/New_York, the house zone) —
   the route reads real entries/plays, never invented numbers. */

export const COVER_FRIDAY_TAG = "CoverFriday";
export const COVER_FRIDAY_TIMEZONE = "America/New_York";

/* Rotating weekly themes — one per week, repeating. A theme is a prompt,
   not a restriction: any cover posted with the tag counts as an entry. */
export const COVER_FRIDAY_THEMES = [
  "One-take wonder — no edits, one pass",
  "Slow it down — a fast song, half speed",
  "Genre swap — take it somewhere new",
  "Acoustic stripped — voice and one instrument",
  "Old gold — a classic older than you",
  "Duet energy — two voices, one song",
  "Piano only — keys carry the whole thing",
  "Hometown anthem — a song from where you're from",
] as const;

const DAY_MS = 24 * 3600_000;

function nyDayStartUtcMs(nowMs: number): number {
  /* Midnight in New York for the NY calendar day containing nowMs.
     Uses Intl to find the NY wall-clock, then walks back to its start. */
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: COVER_FRIDAY_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
  const wallAsUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  const offsetMs = wallAsUtc - nowMs; // NY wall clock expressed against UTC
  const dayStartWall = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!);
  return dayStartWall - offsetMs;
}

function nyWeekday(nowMs: number): number {
  /* 0=Sunday … 5=Friday in New York. */
  const s = new Intl.DateTimeFormat("en-US", { timeZone: COVER_FRIDAY_TIMEZONE, weekday: "short" }).format(new Date(nowMs));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

export interface CoverFridayCycle {
  /** ISO week key anchored to the Friday, e.g. "2026-W44-FRI". */
  weekKey: string;
  theme: string;
  /** Entry window: Friday 00:00 NY → Sunday 23:59:59 NY (epoch ms). */
  opensAt: number;
  closesAt: number;
  phase: "open" | "before" | "closed";
  /** The Friday (NY) this cycle belongs to, epoch ms at NY midnight. */
  fridayMs: number;
}

/* The cycle for the week containing nowMs: if today (NY) is Fri–Sun the
   window is this week's; Mon–Thu it is the coming Friday's. */
export function coverFridayCycle(nowMs: number): CoverFridayCycle {
  const todayStart = nyDayStartUtcMs(nowMs);
  const dow = nyWeekday(nowMs);
  const daysSinceFriday = (dow + 7 - 5) % 7; // Fri=0, Sat=1, Sun=2, Mon=3…
  const inWindow = dow === 5 || dow === 6 || dow === 0;
  const fridayMs = inWindow ? todayStart - daysSinceFriday * DAY_MS : todayStart + ((5 - dow + 7) % 7) * DAY_MS;
  const opensAt = fridayMs;
  const closesAt = fridayMs + 3 * DAY_MS - 1;
  const phase: CoverFridayCycle["phase"] = nowMs < opensAt ? "before" : nowMs > closesAt ? "closed" : "open";
  /* Theme + key rotate by whole weeks since a fixed epoch Friday
     (2026-01-02 was a Friday). */
  const epochFriday = Date.UTC(2026, 0, 2);
  const weekIndex = Math.max(0, Math.floor((fridayMs - epochFriday) / (7 * DAY_MS)));
  const d = new Date(fridayMs);
  const weekKey = `${d.getUTCFullYear()}-FRI-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  return {
    weekKey,
    theme: COVER_FRIDAY_THEMES[weekIndex % COVER_FRIDAY_THEMES.length]!,
    opensAt,
    closesAt,
    phase,
    fridayMs,
  };
}

/* Rank real entries by real plays; ties break by earlier post (first in
   wins the crown), then by id for determinism. No plays = no crown. */
export interface CoverEntry {
  id: string;
  plays: number;
  createdAt: number;
}
export function rankCoverEntries<T extends CoverEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.plays - a.plays || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
export function coverFridayWinner<T extends CoverEntry>(entries: T[]): T | null {
  const ranked = rankCoverEntries(entries);
  return ranked.length > 0 && ranked[0]!.plays > 0 ? ranked[0]! : null;
}
