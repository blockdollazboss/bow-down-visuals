/* ── Timed product drops (#25) — pure countdown math ────────────────────
   The server stores the drop moment as ONE UTC instant (timestamptz,
   shipped as an ISO 8601 string). Everything here works off that
   instant: the countdown is the distance to it, and the "when" line is
   rendered with Intl in the VIEWER's local timezone — a fan in Tokyo
   and a fan in Ohio count down to the same moment and each sees it in
   their own local time. No wall-clock fields are ever parsed by hand. */

export interface DropCountdown {
  /** Milliseconds until the drop; <= 0 once the moment has arrived. */
  totalMs: number;
  isLive: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Parse a server drop instant. Returns null for missing/junk input —
    a page with no parseable drop moment renders no countdown at all
    rather than a wrong one. */
export function dropTargetMs(dropAt: string | null | undefined): number | null {
  if (!dropAt) return null;
  const ms = new Date(dropAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function dropCountdown(dropAt: string | null | undefined, nowMs: number): DropCountdown | null {
  const target = dropTargetMs(dropAt);
  if (target === null) return null;
  const totalMs = target - nowMs;
  if (totalMs <= 0) {
    return { totalMs, isLive: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    totalMs,
    isLive: false,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

/** "Fri, Nov 14, 2026, 7:00 PM" in the viewer's local timezone. */
export function formatDropLocal(dropAt: string | null | undefined): string | null {
  const target = dropTargetMs(dropAt);
  if (target === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(target));
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
