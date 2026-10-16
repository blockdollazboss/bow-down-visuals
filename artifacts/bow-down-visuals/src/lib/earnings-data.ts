/* ── Unified-earnings payload guard (DTO guard batch #2) ─────────────
 * Same pattern as lib/destination-keys.ts / lib/explore-data.ts.
 * pages/earnings.tsx stored `(await res.json()) as EarningsResponse`
 * after only an res.ok check — a partial 200 rendered $NaN-style totals
 * instead of the page's honest failure state, which is worse than a
 * crash on a money page. This normalizer runs at the fetch boundary:
 *   • no real total → null → the page's honest "couldn't load" state;
 *   • a source that is missing, mistyped, or carrying non-numeric
 *     money fields degrades to that source's own error card (the page's
 *     designed per-source state) and flags the payload partial. */

export interface SourceOk {
  status: "ok";
  totalCents: number;
  count: number;
}
export interface SourceErr {
  status: "error";
  totalCents: null;
  count: null;
}
export type EarningsSource = SourceOk | SourceErr;

export interface EarningsTips {
  status: "ok" | "error";
  streamTipsVb: number | null;
  streamTipCount: number | null;
  tipJarPendingCents: number | null;
  tipJarPendingCount: number | null;
  tipJarStatus: string;
}

export interface EarningsResponse {
  currency: string;
  totalCents: number;
  totalTipsVb: number | null;
  partial: boolean;
  sources: {
    storeSales: (SourceOk & { breakdown: { profileStoreCents: number; shopSalesCents: number } | null }) | (SourceErr & { breakdown: null });
    memberships: EarningsSource;
    brandDeals: EarningsSource;
    tips: EarningsTips;
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const errSource = (): SourceErr => ({ status: "error", totalCents: null, count: null });

function moneySource(v: unknown): EarningsSource {
  if (!isObj(v) || v.status !== "ok") return errSource();
  const totalCents = finite(v.totalCents);
  const count = finite(v.count);
  if (totalCents === null || count === null) return errSource();
  return { status: "ok", totalCents, count };
}

export function normalizeEarningsResponse(payload: unknown): EarningsResponse | null {
  if (!isObj(payload)) return null;
  const totalCents = finite(payload.totalCents);
  if (totalCents === null) return null; // the headline total is never guessed
  const sources = isObj(payload.sources) ? payload.sources : {};
  let degraded = !isObj(payload.sources);

  const rawStore = sources.storeSales;
  const storeBase = moneySource(rawStore);
  if (storeBase.status === "error") degraded = true;
  let breakdown: { profileStoreCents: number; shopSalesCents: number } | null = null;
  if (storeBase.status === "ok" && isObj(rawStore) && isObj(rawStore.breakdown)) {
    const p = finite(rawStore.breakdown.profileStoreCents);
    const s = finite(rawStore.breakdown.shopSalesCents);
    if (p !== null && s !== null) breakdown = { profileStoreCents: p, shopSalesCents: s };
  }
  const storeSales = storeBase.status === "ok"
    ? { ...storeBase, breakdown }
    : { ...errSource(), breakdown: null };

  const memberships = moneySource(sources.memberships);
  if (memberships.status === "error") degraded = true;
  const brandDeals = moneySource(sources.brandDeals);
  if (brandDeals.status === "error") degraded = true;

  const rawTips = sources.tips;
  let tips: EarningsTips;
  if (isObj(rawTips) && rawTips.status === "ok") {
    tips = {
      status: "ok",
      streamTipsVb: finite(rawTips.streamTipsVb),
      streamTipCount: finite(rawTips.streamTipCount),
      tipJarPendingCents: finite(rawTips.tipJarPendingCents),
      tipJarPendingCount: finite(rawTips.tipJarPendingCount),
      tipJarStatus: typeof rawTips.tipJarStatus === "string" ? rawTips.tipJarStatus : "",
    };
  } else {
    tips = {
      status: "error",
      streamTipsVb: null,
      streamTipCount: null,
      tipJarPendingCents: null,
      tipJarPendingCount: null,
      tipJarStatus: "",
    };
    degraded = true;
  }

  return {
    currency: typeof payload.currency === "string" ? payload.currency : "USD",
    totalCents,
    totalTipsVb: finite(payload.totalTipsVb),
    partial: payload.partial === true || degraded,
    sources: { storeSales, memberships, brandDeals, tips },
  };
}
