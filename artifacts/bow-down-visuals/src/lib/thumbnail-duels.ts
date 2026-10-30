/* ─── Thumbnail Duels (#174) — creator-desk helpers ────────────────────────
   Pure logic for the Thumbnail Studio duel desk. The duel itself is run
   by the server (routes/player-upgrades.ts + lib/thumbnail-duels.ts on
   the API side): the audience is served cover A / cover B in rotation,
   every serve is a counted view, every click-through a counted click
   (deduped per audience member per cover), and at the view target the
   click leader takes over as the video's thumbnail automatically.

   ANTI-FAKE RULE (the idea's own words): results are always shown WITH
   REAL COUNTS — never percentages without numbers, never a winner
   declared on vibes. Every formatter here keeps the raw counts in the
   sentence; a rate may ride along but never appears alone. */

export interface DuelResults {
  viewsA: number;
  viewsB: number;
  clicksA: number;
  clicksB: number;
  totalViews: number;
  totalClicks: number;
  targetViews: number;
  clickRateA: number;
  clickRateB: number;
}

export interface DuelRecord {
  id: string;
  status: string; // running | resolved | cancelled
  winner: string | null; // a | b | null
  cover_a_url: string;
  cover_b_url: string;
  target_views: number;
}

export interface CandidateCover {
  url: string;
  label: string;
}

/* The server's clamp band (api lib/thumbnail-duels.ts) — mirrored so the
   desk never promises a target the server would silently change. */
export const DUEL_TARGET_VIEWS_MIN = 20;
export const DUEL_TARGET_VIEWS_MAX = 10000;
export const DUEL_TARGET_VIEWS_DEFAULT = 100;

export function clampDuelTargetViews(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value)
      : DUEL_TARGET_VIEWS_DEFAULT;
  return Math.min(DUEL_TARGET_VIEWS_MAX, Math.max(DUEL_TARGET_VIEWS_MIN, n));
}

/** Merge cover candidates from the studio's sources (generated images,
    A/B variants, the picked winner) into one deduped picker list.
    First occurrence wins the label — callers pass sources in the order
    they want labels preferred. Blank URLs are dropped. */
export function mergeCandidateCovers(
  ...sources: Array<Array<{ url: string; label: string }>>
): CandidateCover[] {
  const seen = new Set<string>();
  const out: CandidateCover[] = [];
  for (const list of sources) {
    for (const c of list) {
      const url = (c.url ?? "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, label: c.label?.trim() || "Cover" });
    }
  }
  return out;
}

/** The POST body for starting a duel. coverAUrl is omitted when blank —
    the server then uses the video's current thumbnail as cover A.
    Returns null when there is no challenger (a duel needs a cover B). */
export function buildDuelStartPayload(input: {
  coverAUrl?: string | null;
  coverBUrl?: string | null;
  targetViews?: number;
}): { coverBUrl: string; coverAUrl?: string; targetViews: number } | null {
  const coverB = (input.coverBUrl ?? "").trim();
  if (!coverB) return null;
  const coverA = (input.coverAUrl ?? "").trim();
  return {
    coverBUrl: coverB,
    ...(coverA ? { coverAUrl: coverA } : {}),
    targetViews: clampDuelTargetViews(input.targetViews),
  };
}

/** Progress toward the view target, counts first. pct is derived from
    the same real counts and is only ever displayed beside them. */
export function duelProgress(results: DuelResults): {
  counted: number;
  target: number;
  pct: number;
  reached: boolean;
} {
  const counted = results.totalViews;
  const target = results.targetViews;
  return {
    counted,
    target,
    pct: target > 0 ? Math.min(100, Math.round((counted / target) * 100)) : 0,
    reached: counted >= target,
  };
}

/** One-line scoreboard for a cover, counts always present:
    "Cover A — 212 views · 41 clicks (19.3% click rate)". */
export function duelScoreLine(cover: "a" | "b", results: DuelResults): string {
  const views = cover === "a" ? results.viewsA : results.viewsB;
  const clicks = cover === "a" ? results.clicksA : results.clicksB;
  const rate = cover === "a" ? results.clickRateA : results.clickRateB;
  return `Cover ${cover.toUpperCase()} — ${views} views · ${clicks} clicks (${rate}% click rate)`;
}

/** The resolved verdict, in the platform's own numbers:
    "Cover B won — 41 clicks from 212 views against 33 clicks from 198
    views. It is now this video's thumbnail." (the takeover is the
    server's, done at resolution — this line reports it, never claims
    it for a duel that has not resolved). */
export function duelWinnerLine(duel: DuelRecord, results: DuelResults): string | null {
  if (duel.status !== "resolved" || (duel.winner !== "a" && duel.winner !== "b")) return null;
  const winner = duel.winner;
  const loser = winner === "a" ? "b" : "a";
  const wClicks = winner === "a" ? results.clicksA : results.clicksB;
  const wViews = winner === "a" ? results.viewsA : results.viewsB;
  const lClicks = loser === "a" ? results.clicksA : results.clicksB;
  const lViews = loser === "a" ? results.viewsA : results.viewsB;
  return (
    `Cover ${winner.toUpperCase()} won — ${wClicks} clicks from ${wViews} views ` +
    `against ${lClicks} clicks from ${lViews} views. It is now this video's thumbnail.`
  );
}
