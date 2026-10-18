import { useEffect, useState } from "react";
import { Link } from "wouter";
import { EarningsDocuments } from "@/components/trust/TrustPanels";
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
      <p className="mt-1 text-sm text-muted-foreground">Every stream, one picture — sales, memberships, tips and brand deals.</p>

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
              ? `profile store ${usd(sources.storeSales.breakdown.profileStoreCents)} · shop ${usd(sources.storeSales.breakdown.shopSalesCents)}`
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
      <div className="mt-4"><EarningsDocuments /></div>
    </div>
  );
}
