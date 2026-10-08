import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, TrendingUp, Wallet, BadgeDollarSign, PiggyBank,
  CheckCircle2, PlusCircle, AlertTriangle, Sparkles,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { KIND_LABELS } from "./store-buy";

/* ─── /music-sales — creator sales dashboard ──────────────────────────────
   "You just got paid" energy: every sale, your cut, per-drop breakdown, and
   one-tap logging into the Money Tracker. Copy stays vertical-neutral —
   tracks, courses, series passes, packs, presets: it's all YOUR content.

   Pending payouts are tracked in real dollars. Real payouts need Stripe
   Connect — that build comes before anyone gets paid out. */

interface Sale {
  id: string;
  itemKind: string;
  itemTitle: string;
  gross: string;
  platformFee: string;
  creatorAmount: string;
  soldAt: string;
  loggedToTracker: boolean;
}

interface SalesData {
  totals: {
    sales: number;
    gross: string;
    platformFee: string;
    pendingPayout: string;
    pendingPayoutCents: number;
  };
  byKind: { kind: string; sales: number; gross: string; creatorAmount: string }[];
  sales: Sale[];
  platformFeePct: number;
  payoutNote: string;
}

export default function MusicSales() {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/store/sales", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await res.json().catch(() => ({}))) as SalesData & { error?: string; message?: string };
      if (!res.ok) throw new Error(body.message || body.error || "Couldn't load your sales.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your sales.");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function logToTracker(saleId: string) {
    setLogging(saleId);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/store/log-to-tracker", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ saleId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; entry?: { amount: string } };
      if (!res.ok) throw new Error(body.message || body.error || "Couldn't log this sale.");
      setNotice(`Logged ${body.entry?.amount ?? ""} to your Money Tracker. 💰`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't log this sale.");
    } finally {
      setLogging(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-8 w-8 text-amber-300" />
          <div>
            <h1 className="text-3xl font-bold text-amber-200">Sales Dashboard</h1>
            <p className="mt-1 text-sm text-amber-100/60">
              Create it, publish it, sell it, get paid — all in one place. It should feel illegal. 👑
            </p>
          </div>
        </div>

        {notice && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">
            {notice}
          </div>
        )}

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          </div>
        ) : error ? (
          <div className="mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-black p-10 text-center">
            <div className="text-4xl">🎤</div>
            <h2 className="mt-4 text-xl font-bold text-amber-200">No creator profile yet</h2>
            <p className="mt-2 text-amber-100/60">
              Set up your creator profile first — then every drop you sell shows up here.
            </p>
          </div>
        ) : data ? (
          <>
            {/* Totals */}
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-5">
                <div className="text-xs uppercase tracking-widest text-amber-400/70">Sales</div>
                <div className="mt-1 text-2xl font-bold text-amber-200">{data.totals.sales}</div>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-5">
                <div className="text-xs uppercase tracking-widest text-amber-400/70">Gross</div>
                <div className="mt-1 text-2xl font-bold text-amber-200">{data.totals.gross}</div>
              </div>
              <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-5">
                <div className="text-xs uppercase tracking-widest text-amber-400/70">
                  Platform fee ({data.platformFeePct}%)
                </div>
                <div className="mt-1 text-2xl font-bold text-amber-100/70">{data.totals.platformFee}</div>
              </div>
              <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-b from-[#1d1606] to-black p-5 shadow-[0_0_30px_rgba(201,162,39,0.15)]">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-amber-300">
                  <PiggyBank className="h-4 w-4" /> Your cut · pending payout
                </div>
                <div className="mt-1 text-2xl font-bold text-amber-300">{data.totals.pendingPayout}</div>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-black/40 p-4 text-xs text-amber-100/60">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                {data.payoutNote} Real money, real dollars — completely separate from Visual Bucs (AI credits).
              </span>
            </div>

            {/* Per-drop-type breakdown */}
            {data.byKind.length > 0 && (
              <div className="mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-6">
                <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
                  <Sparkles className="h-5 w-5" /> What's selling
                </h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {data.byKind.map((k) => (
                    <div key={k.kind} className="rounded-xl border border-amber-500/10 bg-black/40 p-4">
                      <div className="text-xs uppercase tracking-widest text-amber-400/70">
                        {KIND_LABELS[k.kind] ?? k.kind}
                      </div>
                      <div className="mt-1 text-xl font-bold text-amber-200">{k.gross}</div>
                      <div className="text-xs text-amber-100/50">
                        {k.sales} sale{k.sales === 1 ? "" : "s"} · you keep {k.creatorAmount}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sales list */}
            <div className="mt-6 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-amber-200">
                <BadgeDollarSign className="h-5 w-5" /> Recent sales
              </h2>
              {data.sales.length === 0 ? (
                <p className="mt-4 text-amber-100/60">
                  No sales yet. Put a price on your content and share the link — the first "you just got
                  paid" moment is waiting.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {data.sales.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-4 rounded-xl border border-amber-500/10 bg-black/40 p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-widest text-amber-400/70">
                          {KIND_LABELS[s.itemKind] ?? s.itemKind}
                        </div>
                        <div className="truncate font-bold text-amber-100">{s.itemTitle}</div>
                        <div className="text-xs text-amber-100/50">
                          {new Date(s.soldAt).toLocaleString()} · {s.gross} sale · {s.platformFee} fee ·{" "}
                          <span className="font-semibold text-amber-200">you keep {s.creatorAmount}</span>
                        </div>
                      </div>
                      {s.loggedToTracker ? (
                        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-green-500/30 bg-green-950/30 px-3 py-1.5 text-xs font-semibold text-green-300">
                          <CheckCircle2 className="h-4 w-4" /> In Money Tracker
                        </span>
                      ) : (
                        <button
                          onClick={() => logToTracker(s.id)}
                          disabled={logging === s.id}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-xs font-bold text-black hover:brightness-110 disabled:opacity-60"
                        >
                          {logging === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <PlusCircle className="h-4 w-4" />
                          )}
                          Log to Money Tracker
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Link
                href="/coach?tab=money"
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-300 hover:underline"
              >
                <Wallet className="h-4 w-4" /> Open the Money Tracker
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
