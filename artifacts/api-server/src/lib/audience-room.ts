/* ─── Audience Room (N16) ─────────────────────────────────────────────────
   One honest panel over the plays a creator actually got: WHEN the
   audience listens (best hours, from real played_at rows), and WHERE
   plays come from (the source each playing surface declared). Pure
   aggregation over play_events rows — the route owns the DB.

   Honesty rules baked in:
   - Sources are what surfaces DECLARED at record time. Plays recorded
     before source tracking existed carry NULL and are reported as
     "untracked" — never redistributed into a guessed source.
   - Fan city is NOT in this panel: the platform records no fan
     location anywhere, so the room says so (unavailable + reason)
     instead of estimating an audience map it cannot prove. */

export const PLAY_SOURCES = [
  "profile",
  "feed",
  "charts",
  "search",
  "playlist",
  "world",
  "fan_link",
  "direct",
  "other",
] as const;
export type PlaySource = (typeof PLAY_SOURCES)[number];

/* A client-declared source: known values pass through, anything else a
   surface invents collapses to "other" (still a declared source, just
   not one the panel names), and absent/blank means the play carries no
   source — recorded as NULL, shown as untracked. */
export function normalizePlaySource(v: unknown): PlaySource | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  return (PLAY_SOURCES as readonly string[]).includes(s) ? (s as PlaySource) : "other";
}

export interface PlayRow {
  playedAt: Date;
  source: string | null;
}

/* 24 buckets, hour of day in UTC (played_at is stored in UTC; the
   panel labels the axis UTC rather than pretending to know each fan's
   timezone). */
export function bestHoursHistogram(plays: PlayRow[]): number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const p of plays) {
    const h = p.playedAt.getUTCHours();
    if (h >= 0 && h < 24) buckets[h]++;
  }
  return buckets;
}

export function peakHour(histogram: number[]): { hour: number; plays: number } | null {
  let best: { hour: number; plays: number } | null = null;
  histogram.forEach((plays, hour) => {
    if (plays > 0 && (!best || plays > best.plays)) best = { hour, plays };
  });
  return best;
}

export function hourLabel(hour: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hour)}:00–${pad((hour + 1) % 24)}:00 UTC`;
}

export interface SourceSlice {
  source: PlaySource;
  plays: number;
  pct: number; // of TRACKED plays
}

export interface AudienceRoomSummary {
  totalPlays: number;
  trackedPlays: number;
  untrackedPlays: number;
  hourly: number[];
  peak: { hour: number; plays: number; label: string } | null;
  sources: SourceSlice[];
  fanCity: { available: false; reason: string };
}

export const FAN_CITY_UNAVAILABLE_REASON =
  "Fan location isn't recorded anywhere in the platform yet, so the Audience Room doesn't show a fan map rather than guess one.";

export function summarizeAudienceRoom(plays: PlayRow[]): AudienceRoomSummary {
  const hourly = bestHoursHistogram(plays);
  const peak = peakHour(hourly);
  const counts = new Map<PlaySource, number>();
  let tracked = 0;
  for (const p of plays) {
    const s = normalizePlaySource(p.source);
    if (!s) continue;
    tracked++;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const sources: SourceSlice[] = [...counts.entries()]
    .map(([source, n]) => ({
      source,
      plays: n,
      pct: tracked > 0 ? Math.round((n / tracked) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.plays - a.plays || (a.source < b.source ? -1 : 1));
  return {
    totalPlays: plays.length,
    trackedPlays: tracked,
    untrackedPlays: plays.length - tracked,
    hourly,
    peak: peak ? { ...peak, label: hourLabel(peak.hour) } : null,
    sources,
    fanCity: { available: false, reason: FAN_CITY_UNAVAILABLE_REASON },
  };
}
