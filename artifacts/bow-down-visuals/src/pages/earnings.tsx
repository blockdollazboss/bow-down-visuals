import { useEffect, useState } from "react";
import { Link } from "wouter";
import { EarningsDocuments } from "@/components/trust/TrustPanels";
import AffiliateDeskSection from "@/components/affiliates/AffiliateDeskSection";
import ConnectPayoutCard from "@/components/earnings/ConnectPayoutCard";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Unified Earnings (Stack 8 #5) — one money picture per creator, served
 * by GET /api/earnings. Per-source breakdown with honest states: a
 * source with no data reads $0.00; a source that failed to load shows
 * an error state (never a fake zero). Stream tips are Visual Bucs and
 * tip-jar intents are pending payment — both shown in their own units,
 * never folded into the USD total.
 */

/* Response types + the partial-payload guard live in
   lib/earnings-data.ts (DTO guard batch #2) — a partial 200 must reach
   this page's honest failure / per-source error states, never render
   $NaN totals. */
import {
  loadEarnings,
  EarningsLoadCancelled,
  type EarningsResponse,
  type SourceErr,
  type SourceOk,
} from "@/lib/earnings-data";

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function SourceCard({ title, source, detail }: { title: string; source: SourceOk | SourceErr; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-sm text-muted-foreground">{title}</div>
      {source.status === "error" ? (
        <div className="mt-2 text-lg font-semibold text-destructive">Couldn&apos;t load — try again</div>
      ) : (
        <>
          <div className="mt-2 text-2xl font-bold">{usd(source.totalCents)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {source.count} {source.count === 1 ? "payment" : "payments"}{detail ? ` · ${detail}` : ""}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Pending payout (payfix store-dashboards) ────────────────────────────
 * The seller's payable balance, read from THE ledger:
 * GET /api/earnings/pending-payout (pending_payout_ledger — every
 * completed sale accrues its net exactly once; a refund reverses it
 * exactly once). This is the same figure the Store Dashboard's Get
 * Paid card shows via /api/connect/status — one number, everywhere.
 * Its own fetch + failure state: a failed load says so, never $0.00. */
interface PendingPayoutRead {
  pendingCents: number;
  accruedCents: number;
  reversedCents: number;
  sponsorReleasedCents: number;
  settledCents: number;
  rows: Array<{
    id: string;
    sourceKind: string;
    entryType: "accrual" | "reversal";
    grossCents: number;
    platformFeeCents: number;
    netCents: number;
    createdAt: string;
  }>;
}

const LEDGER_KIND_LABEL: Record<string, string> = {
  digital_sale: "Digital sale",
  store_order: "Store order",
  shop_event: "Shop sale",
  beat_license: "Beat license",
  membership: "Membership",
};

function PendingPayoutCard({ getToken }: { getToken: () => Promise<string | null> }) {
  const [read, setRead] = useState<PendingPayoutRead | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken().catch(() => null);
        const res = await fetch("/api/earnings/pending-payout", {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error(`pending payout failed (${res.status})`);
        const data = (await res.json()) as PendingPayoutRead;
        if (!cancelled) setRead(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-5" data-testid="pending-payout-card">
      <div className="text-sm text-muted-foreground">Pending payout</div>
      {failed ? (
        <div className="mt-2 text-lg font-semibold text-destructive">Couldn&apos;t load — try again</div>
      ) : !read ? (
        <div className="mt-2 text-sm text-muted-foreground">Loading your payable balance…</div>
      ) : (
        <>
          <div className="mt-2 text-2xl font-bold">{usd(read.pendingCents)}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            accrued {usd(read.accruedCents)}
            {read.reversedCents > 0 ? ` · refunds reversed ${usd(read.reversedCents)}` : ""}
            {read.sponsorReleasedCents > 0 ? ` · brand deals released ${usd(read.sponsorReleasedCents)}` : ""}
            {read.settledCents > 0 ? ` · already paid out ${usd(read.settledCents)}` : ""}
          </div>
          {read.rows.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {read.rows.slice(0, 8).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>
                    {LEDGER_KIND_LABEL[r.sourceKind] ?? r.sourceKind}
                    {r.entryType === "reversal" ? " — refund reversal" : ""}
                  </span>
                  <span className={r.entryType === "reversal" ? "text-destructive" : ""}>
                    {r.entryType === "reversal" ? "−" : "+"}{usd(r.netCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export default function Earnings() {
  const { user, loading: authLoading, getAccessToken } = useAuth();
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /* Guest honesty (access lockdown Lane 3): /api/earnings is
     member-only, so a signed-out visit used to fire a doomed fetch and
     land on the failure card below. Signed-out visitors get a sign-in
     pitch instead, and the fetch never fires without a session.
     The load itself is patient (lib/earnings-data loadEarnings): a
     waking free-tier box answers 502s / drops requests for its first
     seconds, and one burned attempt used to paint the failure card
     for good. Retries with backoff ride that out; only exhaustion
     lands here — with a working Try again, not just the words. */
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setRetrying(false);
    (async () => {
      try {
        const normalized = await loadEarnings({
          getToken: () => getAccessToken(),
          isCancelled: () => cancelled,
          onRetry: () => { if (!cancelled) setRetrying(true); },
        });
        if (!cancelled) setData(normalized);
      } catch (err) {
        if (!cancelled && !(err instanceof EarningsLoadCancelled)) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken, user, authLoading, reloadKey]);

  if (!authLoading && !user) {
    return (
      <div className="mx-auto max-w-3xl p-6" data-testid="earnings-signin">
        <h1 className="text-2xl font-bold">Earnings</h1>
        <p className="mt-4 text-muted-foreground">
          Sign in to see your earnings — sales, memberships, tips and brand deals, all in one picture.
        </p>
        <Link
          href="/login?next=/earnings"
          className="mt-4 inline-block rounded-full bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:scale-105"
        >
          Sign in to view earnings
        </Link>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Earnings</h1>
        <p className="mt-4 text-destructive">Couldn&apos;t load your earnings — try again in a moment.</p>
        <button
          type="button"
          className="mt-4 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium"
          onClick={() => { setFailed(false); setData(null); setReloadKey((k) => k + 1); }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Earnings</h1>
        <p className="mt-4 text-muted-foreground">Loading your money picture…</p>
        {retrying && (
          <p className="mt-1 text-sm text-muted-foreground">Still trying — a sleeping server can take a moment to wake.</p>
        )}
      </div>
    );
  }

  const { sources } = data;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Earnings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every stream, one picture — sales, beats, memberships, tips and brand deals.</p>

      <div className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="text-sm text-muted-foreground">Total earned (USD)</div>
        <div className="mt-1 text-3xl font-bold">{usd(data.totalCents)}</div>
        {data.partial && (
          <div className="mt-1 text-xs text-destructive">Some sources couldn&apos;t load — this total covers the ones that did.</div>
        )}
        <div className="mt-2 text-sm text-muted-foreground">
          Stream tips: {data.totalTipsVb === null ? "couldn't load" : `${data.totalTipsVb.toLocaleString("en-US")} Visual Bucs`}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SourceCard
          title="Store sales"
          source={sources.storeSales}
          detail={
            sources.storeSales.status === "ok" && sources.storeSales.breakdown
              ? [
                  `profile store ${usd(sources.storeSales.breakdown.profileStoreCents)} · shop ${usd(sources.storeSales.breakdown.shopSalesCents)}`,
                  sources.storeSales.breakdown.digitalSalesCents > 0
                    ? `digital store ${usd(sources.storeSales.breakdown.digitalSalesCents)}`
                    : null,
                  /* #36 co-seller splits: what my sales paid my
                     co-sellers, and what I earned as a co-seller on
                     other creators' products — each shown only when
                     it actually happened. */
                  sources.storeSales.breakdown.coSellerSharesPaidOutCents > 0
                    ? `paid to co-sellers ${usd(sources.storeSales.breakdown.coSellerSharesPaidOutCents)}`
                    : null,
                  sources.storeSales.breakdown.coSellerSplitCents > 0
                    ? `earned as a co-seller ${usd(sources.storeSales.breakdown.coSellerSplitCents)} (${sources.storeSales.breakdown.coSellerSplitSales} ${sources.storeSales.breakdown.coSellerSplitSales === 1 ? "sale" : "sales"})`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
        <SourceCard
          title="Beats (licenses sold)"
          source={sources.beats}
          detail={
            sources.beats.status === "ok"
              ? `gross ${usd(sources.beats.grossCents)} · platform commission ${usd(sources.beats.commissionCents)} (15%)`
              : undefined
          }
        />
        <SourceCard title="Memberships" source={sources.memberships} />
        <SourceCard title="Brand deals (escrow released)" source={sources.brandDeals} />
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="text-sm text-muted-foreground">Tips</div>
          {sources.tips.status === "error" ? (
            <div className="mt-2 text-lg font-semibold text-destructive">Couldn&apos;t load — try again</div>
          ) : (
            <>
              <div className="mt-2 text-2xl font-bold">{(sources.tips.streamTipsVb ?? 0).toLocaleString("en-US")} VB</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {sources.tips.streamTipCount ?? 0} stream tips credited · tip jar:{" "}
                {usd(sources.tips.tipJarPendingCents ?? 0)} pending payment ({sources.tips.tipJarPendingCount ?? 0} fans) — not yet earnings
              </div>
            </>
          )}
        </div>
      </div>
      <PendingPayoutCard getToken={() => getAccessToken()} />

      {/* Lane 5 (stack400): the payout door docks directly under the
          pending balance it acts on — Connect state, Start/Continue
          setup, cash out, history. The same /api/connect/* rail the
          Store Dashboard's Get Paid card uses; this page showed the
          balance with no door to move it. */}
      <ConnectPayoutCard getToken={() => getAccessToken()} />

      {/* #16: the affiliate desk docks in the money desk — its own fetch,
          its own failure state, never a standalone page. */}
      <AffiliateDeskSection />
      <div className="mt-4"><EarningsDocuments /></div>
    </div>
  );
}
