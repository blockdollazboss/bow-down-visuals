import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Unified Earnings (Stack 8 #5) — one money picture per creator, served
 * by GET /api/earnings. Per-source breakdown with honest states: a
 * source with no data reads $0.00; a source that failed to load shows
 * an error state (never a fake zero). Stream tips are Visual Bucs and
 * tip-jar intents are pending payment — both shown in their own units,
 * never folded into the USD total.
 */

interface SourceOk { status: "ok"; totalCents: number; count: number }
interface SourceErr { status: "error"; totalCents: null; count: null }
interface EarningsResponse {
  currency: string;
  totalCents: number;
  totalTipsVb: number | null;
  partial: boolean;
  sources: {
    storeSales: (SourceOk & { breakdown: { profileStoreCents: number; shopSalesCents: number } | null }) | (SourceErr & { breakdown: null });
    memberships: SourceOk | SourceErr;
    brandDeals: SourceOk | SourceErr;
    tips: {
      status: "ok" | "error";
      streamTipsVb: number | null;
      streamTipCount: number | null;
      tipJarPendingCents: number | null;
      tipJarPendingCount: number | null;
      tipJarStatus: string;
    };
  };
}

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
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/earnings", {
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!res.ok) throw new Error("earnings failed");
        setData((await res.json()) as EarningsResponse);
      } catch {
        setFailed(true);
      }
    })();
  }, [getAccessToken]);

  if (failed) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Earnings</h1>
        <p className="mt-4 text-destructive">Couldn&apos;t load your earnings — try again in a moment.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">Earnings</h1>
        <p className="mt-4 text-muted-foreground">Loading your money picture…</p>
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
    </div>
  );
}
