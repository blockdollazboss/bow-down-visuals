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

/** Store-sales breakdown. The co-seller fields (Wave 4 #36) ride the
    same source: shares I paid my co-sellers out of my sales, and my
    earnings as a co-seller on other creators' products. They default
    to 0 when an older payload doesn't carry them. */
export interface StoreSalesBreakdown {
  profileStoreCents: number;
  shopSalesCents: number;
  coSellerSharesPaidOutCents: number;
  coSellerSplitCents: number;
  coSellerSplitSales: number;
}

export interface EarningsResponse {
  currency: string;
  totalCents: number;
  totalTipsVb: number | null;
  partial: boolean;
  sources: {
    storeSales: (SourceOk & { breakdown: StoreSalesBreakdown | null }) | (SourceErr & { breakdown: null });
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

/* ─── The load itself: patient + retrying ────────────────────────────
 * pages/earnings.tsx used to fire ONE fetch and paint its "couldn't
 * load" card on any failure (owner screenshot, Oct 17 18:16 EDT: the
 * card on a signed-in visit). The handler cannot produce that card by
 * itself — every source settles independently and a 200 always carries
 * a finite totalCents (this module's contract, pinned in tests) — so
 * the card means the load died in transit: a non-200 from the edge
 * while the free-tier box wakes (502/reset), a rejected fetch, an
 * unparseable body, or a token that came back null for one attempt
 * (→ 401). ALL of those are transient on a waking box, and the API
 * would have answered seconds later — the page just never asked again.
 *
 * loadEarnings is the whole load as one retryable unit (fresh token
 * per attempt — the token leg is part of the failure surface — plus
 * fetch + normalize), with the World door's patience shape: several
 * attempts, growing backoff, and a per-attempt timeout so a hung
 * request retries instead of stranding the page on "Loading…" forever.
 * Only genuine exhaustion surfaces the page's honest error card. */

export const EARNINGS_LOAD_ATTEMPTS = 4;
export const EARNINGS_LOAD_BACKOFF_MS: readonly number[] = [2_000, 5_000, 12_000];
export const EARNINGS_ATTEMPT_TIMEOUT_MS = 45_000;

/** Thrown when the caller went away mid-load (page unmounted / reload
 *  superseded) — the page treats it as silence, never as failure. */
export class EarningsLoadCancelled extends Error {
  constructor() {
    super("earnings load cancelled");
    this.name = "EarningsLoadCancelled";
  }
}

export interface EarningsLoadDeps {
  /** Fresh token per attempt; a null (or a throw) is just a failed
   *  attempt — the next try asks again. */
  getToken: () => Promise<string | null>;
  /** Defaults to the ambient fetch (in the browser, the session-guard
   *  wrapped one). Injected in tests. */
  fetchFn?: (input: string, init: RequestInit) => Promise<Response>;
  /** Injected in tests so backoff never slows the suite. */
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
  /** Fires when another attempt is about to start (attempt ≥ 2) —
   *  the page uses it to say "still trying — the server may be
   *  waking up" instead of a bare spinner. */
  onRetry?: (nextAttempt: number) => void;
}

export interface EarningsLoadOptions {
  attempts?: number;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
}

export async function loadEarnings(
  deps: EarningsLoadDeps,
  options: EarningsLoadOptions = {},
): Promise<EarningsResponse> {
  const fetchFn = deps.fetchFn ?? ((input: string, init: RequestInit) => fetch(input, init));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = options.attempts ?? EARNINGS_LOAD_ATTEMPTS;
  const backoffMs = options.backoffMs ?? EARNINGS_LOAD_BACKOFF_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? EARNINGS_ATTEMPT_TIMEOUT_MS;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (deps.isCancelled?.()) throw new EarningsLoadCancelled();
    try {
      const token = await deps.getToken().catch(() => null);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const res = await fetchFn("/api/earnings", {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`earnings failed (${res.status})`);
        const normalized = normalizeEarningsResponse(await res.json());
        if (!normalized) throw new Error("earnings payload incomplete");
        return normalized;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastError = err;
      if (attempt >= attempts) break;
      if (deps.isCancelled?.()) throw new EarningsLoadCancelled();
      deps.onRetry?.(attempt + 1);
      await sleep(backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1] ?? 0);
    }
  }
  throw lastError ?? new Error("earnings failed");
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
  let breakdown: StoreSalesBreakdown | null = null;
  if (storeBase.status === "ok" && isObj(rawStore) && isObj(rawStore.breakdown)) {
    const p = finite(rawStore.breakdown.profileStoreCents);
    const s = finite(rawStore.breakdown.shopSalesCents);
    if (p !== null && s !== null) {
      breakdown = {
        profileStoreCents: p,
        shopSalesCents: s,
        /* #36 co-seller splits: absent on older payloads → 0. */
        coSellerSharesPaidOutCents: finite(rawStore.breakdown.coSellerSharesPaidOutCents) ?? 0,
        coSellerSplitCents: finite(rawStore.breakdown.coSellerSplitCents) ?? 0,
        coSellerSplitSales: finite(rawStore.breakdown.coSellerSplitSales) ?? 0,
      };
    }
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
