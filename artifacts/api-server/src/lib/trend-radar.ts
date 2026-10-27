/* ─── Trend Radar (#178) — REAL signals only ──────────────────────────────
   The shipped Trend Predictor sells AI forecasts. The approved Trend Radar
   delta is the opposite: a radar feed built ONLY from verified on-site
   counts (hashtag velocity from real posts/videos, spike episodes from
   real play events, rising creators from real follower deltas). Nothing
   enters the feed without a source and a measured number — a signal with
   no verified count is dropped, never estimated. This module is the pure
   scoring/shaping half; routes/trend-radar.ts gathers the raw rows. */

export type RadarSignalKind = "hashtag" | "spike" | "rising_creator" | "sound";

export interface RadarSignalInput {
  kind: RadarSignalKind;
  /** Stable key, e.g. the tag, content id, user id or sound id. */
  key: string;
  /** Human label shown on the radar. */
  label: string;
  /** Verified count in the current window (posts, plays, new fans…). */
  currentCount: number;
  /** Verified count in the comparison window (baseline). */
  baselineCount: number;
  /** Where the number came from — printed on the card, never hidden. */
  source: string;
  /** Optional deep link into the surface that proves the number. */
  href?: string;
}

export interface RadarSignal extends RadarSignalInput {
  /** Growth multiple vs baseline, 1 = flat. Capped for display sanity. */
  growth: number;
  /** 0–100 radar score: growth weighted by real volume. */
  score: number;
  /** Plain-words movement label for the card. */
  movement: "surging" | "rising" | "steady";
}

const MAX_GROWTH = 50;

export function radarGrowth(currentCount: number, baselineCount: number): number {
  if (!Number.isFinite(currentCount) || !Number.isFinite(baselineCount)) return 0;
  if (currentCount <= 0) return 0;
  if (baselineCount <= 0) return MAX_GROWTH;
  return Math.min(MAX_GROWTH, currentCount / baselineCount);
}

/* A signal is radar-worthy only with a verified positive count AND a named
   source. This is the "real signals and verified numbers only" rule as
   code: no source or no number, no blip. */
export function isVerifiedSignal(input: RadarSignalInput): boolean {
  return (
    typeof input.label === "string" &&
    input.label.trim().length > 0 &&
    typeof input.source === "string" &&
    input.source.trim().length > 0 &&
    Number.isFinite(input.currentCount) &&
    input.currentCount > 0 &&
    Number.isFinite(input.baselineCount) &&
    input.baselineCount >= 0
  );
}

export function scoreSignal(input: RadarSignalInput): RadarSignal {
  const growth = radarGrowth(input.currentCount, input.baselineCount);
  /* Volume matters: a 10x jump on 3 posts is weaker than 2x on 3,000.
     log-volume keeps one giant item from owning the whole radar. */
  const volumeFactor = Math.log10(1 + input.currentCount) / 3; // ~1 at 1,000
  const raw = (growth - 1) * 22 * Math.min(1.5, Math.max(0.15, volumeFactor));
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const movement: RadarSignal["movement"] =
    growth >= 3 ? "surging" : growth >= 1.5 ? "rising" : "steady";
  return { ...input, growth, score, movement };
}

/* Build the feed: verified only, deduped by kind+key (strongest wins),
   sorted by score, capped. Deterministic — same inputs, same radar. */
export function buildRadarFeed(inputs: RadarSignalInput[], limit = 20): RadarSignal[] {
  const byKey = new Map<string, RadarSignal>();
  for (const input of inputs) {
    if (!isVerifiedSignal(input)) continue;
    const scored = scoreSignal(input);
    const k = `${input.kind}:${input.key}`;
    const prev = byKey.get(k);
    if (!prev || scored.score > prev.score) byKey.set(k, scored);
  }
  return [...byKey.values()]
    .sort((a, b) => b.score - a.score || b.currentCount - a.currentCount || a.label.localeCompare(b.label))
    .slice(0, Math.max(1, limit));
}

/* One-line honest summary for the panel header, from the feed itself. */
export function radarHeadline(feed: RadarSignal[]): string {
  if (feed.length === 0) return "No verified signals moving right now — check back soon.";
  const surging = feed.filter((s) => s.movement === "surging").length;
  if (surging > 0) return `${surging} signal${surging === 1 ? "" : "s"} surging in the last 24 hours.`;
  return `${feed.length} verified signal${feed.length === 1 ? "" : "s"} moving in the last 24 hours.`;
}
