/* ─── Royalty Tracker — dashboard load (S27-43) ───────────────────────
   The three royalty sources (summary / platforms / payouts) are
   independent. Each is checked for HTTP success on its OWN: a !ok
   response is a failure for that source only (its body is an error
   payload, never data — the old panel loader stored 500 bodies as the
   summary, corrupting the totals), and a rejected fetch degrades only
   its own section. A failed source reports its error alongside a
   null/empty value; the panel renders a real per-section error state
   for it instead of a fake empty. Pure + unit-tested in
   royalties-load.test.ts; the panel stays a thin shell over it. */

export interface SummaryData {
  total: string;
  totalStreams: number;
  entryCount: number;
  perSong: { song: string; amount: string; cents: number; streams: number }[];
  perPlatform: { platform: string; label: string; amount: string; cents: number; streams: number }[];
  monthly: { month: string; amount: string; cents: number }[];
}

export interface PlatformStatus {
  key: string;
  label: string;
  connected: boolean;
  connectionType: string | null;
  accountLabel: string | null;
  connectable: boolean;
}

export interface Payout {
  id: string;
  distributor: string;
  period_start: string;
  period_end: string;
  expected_amount: string;
  received_amount: string | null;
  currency: string;
  status: string;
  notes: string | null;
}

/* ── Per-source settle for the dashboard load (S27-43) ────────────────
   The three royalty sources are independent. Each one is checked for
   HTTP success on its OWN: a !ok response is a failure for that source
   only (its body is an error payload, never data — the old loader
   stored 500 bodies as the summary, corrupting the totals), and a
   rejected fetch degrades only its own section. A source that failed
   reports its error alongside a null/empty value; the panel renders a
   real per-section error state for it instead of a fake empty. */
export interface RoyaltySources {
  summary: SummaryData | null;
  summaryError: string | null;
  platforms: PlatformStatus[];
  platformsError: string | null;
  payouts: Payout[];
  payoutsError: string | null;
}

type RoyaltyGetter = (
  path: string,
) => Promise<{ res: { ok: boolean; status?: number }; data: Record<string, unknown> }>;

export async function loadRoyaltySources(get: RoyaltyGetter): Promise<RoyaltySources> {
  const loadSummary = async (): Promise<SummaryData> => {
    const { res, data } = await get("/api/royalties/summary");
    if (!res.ok) throw new Error((data.error as string) || `Couldn't load your royalty summary (${res.status ?? "error"}).`);
    return data as unknown as SummaryData;
  };
  const loadPlatforms = async (): Promise<PlatformStatus[]> => {
    const { res, data } = await get("/api/royalties/platforms");
    if (!res.ok) throw new Error((data.error as string) || `Couldn't load your platform connections (${res.status ?? "error"}).`);
    return ((data as { platforms?: PlatformStatus[] }).platforms ?? []) as PlatformStatus[];
  };
  const loadPayouts = async (): Promise<Payout[]> => {
    const { res, data } = await get("/api/royalties/payouts");
    if (!res.ok) throw new Error((data.error as string) || `Couldn't load your payouts (${res.status ?? "error"}).`);
    return ((data as { payouts?: Payout[] }).payouts ?? []) as Payout[];
  };
  const [s, p, pay] = await Promise.allSettled([loadSummary(), loadPlatforms(), loadPayouts()]);
  const msg = (r: PromiseRejectedResult, fallback: string) =>
    r.reason instanceof Error ? r.reason.message : fallback;
  return {
    summary: s.status === "fulfilled" ? s.value : null,
    summaryError: s.status === "rejected" ? msg(s, "Couldn't load your royalty summary.") : null,
    platforms: p.status === "fulfilled" ? p.value : [],
    platformsError: p.status === "rejected" ? msg(p, "Couldn't load your platform connections.") : null,
    payouts: pay.status === "fulfilled" ? pay.value : [],
    payoutsError: pay.status === "rejected" ? msg(pay, "Couldn't load your payouts.") : null,
  };
}

