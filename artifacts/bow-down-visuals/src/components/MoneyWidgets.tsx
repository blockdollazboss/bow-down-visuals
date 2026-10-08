import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Wallet, TrendingUp, BadgeDollarSign, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import TierBadge from "@/components/TierBadge";

/* ─── MoneyWidgets — Worker 12 ────────────────────────────────────────────
   Seller dashboard money widgets. HONEST MATH EVERYWHERE: every widget shows
   gross → fee → net. The money is NEVER gated — free tier sees the same
   numbers. TierBadge links onward to the upgrade page (link-graph).

   Data: GET /api/creator-tiers/earnings (auth).                               */

interface Sale {
  id: string;
  itemKind: string;
  gross: string;
  fee: string;
  net: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  feePct: string;
  createdAt: string;
  wouldKeepAtNextTierCents: number | null;
}

interface Earnings {
  tier: "free" | "pro" | "elite";
  saleCount: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
  payoutBalanceCents: number;
  payoutRailLive: boolean;
  feePct: string;
  feeBpsNextTier: number | null;
  sales: Sale[];
  note?: string;
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MoneyWidgets({ compact = false }: { compact?: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/creator-tiers/earnings", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) setData(await res.json());
      } catch {
        /* widgets stay empty rather than crashing */
      } finally {
        setLoading(false);
      }
    })();
  }, [user, getAccessToken]);

  if (!user) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-white/60">
        <Link href="/login" className="font-bold text-amber-300 hover:text-amber-200">
          Sign in
        </Link>{" "}
        to see your money.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-8 text-white/50">
        <Loader2 className="h-5 w-5 animate-spin" /> Counting your money…
      </div>
    );
  }

  const cards = [
    { icon: TrendingUp, label: "Gross sales", value: usd(data?.grossCents ?? 0), sub: `${data?.saleCount ?? 0} sales`, tone: "text-white" },
    { icon: BadgeDollarSign, label: `Platform fee (${data?.feePct ?? "–"})`, value: usd(data?.feeCents ?? 0), sub: "what keeps the lights on", tone: "text-amber-300" },
    { icon: Wallet, label: "You keep", value: usd(data?.netCents ?? 0), sub: "gross − fee, always", tone: "text-emerald-300" },
  ];

  return (
    <section aria-label="Your money" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-black text-white">Your money</h2>
        <TierBadge />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/50">
              <c.icon className="h-4 w-4" /> {c.label}
            </div>
            <div className={`mt-2 text-2xl font-black ${c.tone}`}>{c.value}</div>
            <div className="mt-1 text-xs text-white/40">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-white/50">Payout balance</div>
          <div className="text-xl font-black text-amber-200">{usd(data?.payoutBalanceCents ?? 0)}</div>
          {!data?.payoutRailLive && (
            <div className="mt-1 text-xs text-white/40">
              Payouts ship soon — your balance is real and accruing. Nothing is hidden.
            </div>
          )}
        </div>
        {data && data.feeBpsNextTier != null && (
          <Link
            href="/creator-pricing"
            className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-200 to-amber-500 px-4 py-2 text-sm font-black text-black hover:brightness-110"
          >
            Keep more of every sale <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {!compact && (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <div className="border-b border-white/10 bg-white/5 px-4 py-3 text-xs font-black uppercase tracking-wider text-white/50">
            Recent sales — gross → fee → net
          </div>
          {(data?.sales?.length ?? 0) === 0 ? (
            <div className="p-6 text-center text-sm text-white/40">
              No sales yet. Share your link — every sale shows up here with the full split.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {data!.sales.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white">{s.itemKind}</div>
                    <div className="text-xs text-white/40">
                      {new Date(s.createdAt).toLocaleDateString()} · fee {s.feePct}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <span className="text-white/60">{s.gross}</span>
                    <span className="mx-1.5 text-white/30">−</span>
                    <span className="text-amber-300/90">{s.fee}</span>
                    <span className="mx-1.5 text-white/30">=</span>
                    <span className="font-black text-emerald-300">{s.net}</span>
                    {s.wouldKeepAtNextTierCents != null && s.wouldKeepAtNextTierCents > s.netCents && (
                      <div className="mt-0.5 text-xs text-white/40">
                        <Link href="/creator-pricing" className="text-amber-300/90 hover:text-amber-200">
                          {usd(s.wouldKeepAtNextTierCents)} on the next tier ↑
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
