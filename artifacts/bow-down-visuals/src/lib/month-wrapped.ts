/* ─── Your Month, Wrapped (Stack-200, idea #170) ──────────────────────
   Client mirror of the /api/month-wrapped contract. The recap is made
   server-side from real platform numbers only; a metric the site
   cannot support is ABSENT from the payload (never estimated), so the
   UI renders exactly the keys present — no placeholders, no guesses.
   Sharing happens only when the creator taps Share. */

export interface MonthWrappedBestMoment {
  kind: "track" | "video";
  mediaId: string;
  title: string;
  plays: number;
}

export interface MonthWrappedRecap {
  month: string;
  monthLabel: string;
  periodComplete: boolean;
  displayName: string;
  slug: string;
  plays?: number;
  newFans?: number;
  salesCount?: number;
  salesCreatorCents?: number;
  newReleases?: number;
  bestMoment: MonthWrappedBestMoment | null;
  hasActivity: boolean;
}

export interface MonthWrappedResponse {
  enabled: boolean;
  month: string;
  recap: MonthWrappedRecap | null;
  reason?: string;
  shareText?: string;
}

export function fmtCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Fallback share text if the server didn't send one — built ONLY
 *  from metrics present in the recap, same rule as the server copy. */
export function buildMonthWrappedShareText(recap: MonthWrappedRecap): string {
  const lines: string[] = [`My ${recap.monthLabel} on Bow Down Visuals, wrapped:`];
  if (recap.plays !== undefined) lines.push(`▶ ${fmtCount(recap.plays)} plays`);
  if (recap.newFans !== undefined) lines.push(`✦ ${fmtCount(recap.newFans)} new fans`);
  if (recap.salesCount !== undefined) {
    const money = recap.salesCreatorCents !== undefined ? ` (${fmtMoney(recap.salesCreatorCents)} earned)` : "";
    lines.push(`◆ ${fmtCount(recap.salesCount)} sales${money}`);
  }
  if (recap.newReleases !== undefined && recap.newReleases > 0) {
    lines.push(`● ${fmtCount(recap.newReleases)} new release${recap.newReleases === 1 ? "" : "s"}`);
  }
  if (recap.bestMoment) {
    lines.push(`★ Best moment: "${recap.bestMoment.title}" — ${fmtCount(recap.bestMoment.plays)} plays`);
  }
  return lines.join("\n");
}

/** The metric rows the card shows, in display order — derived purely
 *  from which keys the server actually sent. */
export interface MonthWrappedMetric {
  key: "plays" | "newFans" | "sales" | "newReleases";
  value: string;
}

export function monthWrappedMetrics(recap: MonthWrappedRecap): MonthWrappedMetric[] {
  const metrics: MonthWrappedMetric[] = [];
  if (recap.plays !== undefined) metrics.push({ key: "plays", value: fmtCount(recap.plays) });
  if (recap.newFans !== undefined) metrics.push({ key: "newFans", value: fmtCount(recap.newFans) });
  if (recap.salesCount !== undefined) {
    metrics.push({
      key: "sales",
      value:
        recap.salesCreatorCents !== undefined
          ? `${fmtCount(recap.salesCount)} · ${fmtMoney(recap.salesCreatorCents)}`
          : fmtCount(recap.salesCount),
    });
  }
  if (recap.newReleases !== undefined) metrics.push({ key: "newReleases", value: fmtCount(recap.newReleases) });
  return metrics;
}
