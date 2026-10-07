import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Zap, ShoppingCart, TrendingDown, ArrowLeft, Loader2 } from "lucide-react";
import { VisualBucsIcon } from "@/components/VisualBucsIcon";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";


interface Payment {
  id: string;
  createdAt: string;
  creditPack: string | null;
  creditsAmount: number;
  amountTotal: number | null;
  currency: string | null;
  status: string;
}

interface Usage {
  id: string;
  createdAt: string;
  action: string;
  creditsUsed: number;
  projectId: string | null;
}

interface CreditHistory {
  purchases: Payment[];
  usage: Usage[];
}

/**
 * Derive a human-readable transaction type + signed display amount from a
 * ledger row. Grants/refunds are stored with negative creditsUsed (a credit
 * back to the user); charges are positive. This fixes the "−−2" display bug
 * where a grant of -2 rendered as "−−2".
 */
function describeUsage(u: Usage): { type: string; amount: string; tone: "charge" | "credit" | "free" } {
  const n = u.creditsUsed;
  if (n < 0) {
    const label = /grant/i.test(u.action) ? "Grant" : /refund/i.test(u.action) ? "Refund" : "Visual Buc back";
    return { type: label, amount: `+${Math.abs(n).toLocaleString("en-US")}`, tone: "credit" };
  }
  if (n === 0) return { type: "Free", amount: "0", tone: "free" };
  return { type: "Charge", amount: `−${n.toLocaleString("en-US")}`, tone: "charge" };
}

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(cents: number | null, currency: string | null) {
  if (cents == null) return "—";
  const dollars = cents / 100;
  const sym = currency?.toUpperCase() === "USD" ? "$" : (currency?.toUpperCase() ?? "$");
  return `${sym}${dollars.toFixed(2)}`;
}

export default function CreditHistory() {
  const { t } = useTranslation();
  usePageTitle(t("credit-history.metaTitle"), t("credit-history.metaDescription"));
  const { profile, getAccessToken } = useAuth();
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const [payRes, histRes] = await Promise.all([
          fetch("/api/payments/history", { headers }),
          fetch("/api/credits/history", { headers }),
        ]);
        if (!payRes.ok) throw new Error("Failed to load purchase history");
        if (!histRes.ok) throw new Error("Failed to load Visual Buc history");
        const payData = (await payRes.json()) as { payments?: Payment[] };
        const histData = (await histRes.json()) as { usage?: Usage[] };
        if (!cancelled) {
          setPayments(payData.payments ?? []);
          setUsage(histData.usage ?? []);
        }
      } catch {
        if (!cancelled) setError(t("credit-history.could_not_load_visual_buc_histor"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [getAccessToken]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-5 md:px-8 py-10 space-y-10">

        {/* Back + title */}
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-1.5 text-white/40 hover:text-white text-sm transition-colors">
            <ArrowLeft className="h-4 w-4" />{t("credit-history.dashboard")}</Link>
        </div>

        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("credit-history.visual_buc_history")}</h1>
          <p className="text-white/40 mt-1 text-sm">{t("credit-history.track_your_purchases_and_visual")}</p>
        </div>

        {/* Section 1: Current Balance */}
        <section className="rounded-2xl border border-primary/25 bg-primary/5 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <VisualBucsIcon className="h-14 w-14" />
            <div>
              <p className="text-sm text-white/50 font-medium uppercase tracking-widest">{t("credit-history.current_balance")}</p>
              <p className="text-4xl font-extrabold text-primary leading-tight">
                {profile?.credits?.toLocaleString("en-US") ?? "—"}
              </p>
              <p className="text-xs text-white/30 mt-0.5">{t("credit-history.visual_bucs_available")}</p>
            </div>
          </div>
          <Button asChild className="bg-primary hover:bg-primary/90 text-black font-bold shadow-[0_0_16px_rgba(218,165,32,0.35)]">
            <Link href="/pricing#credit-packs">{t("credit-history.buy_more_visual_bucs")}</Link>
          </Button>
        </section>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-red-400 text-sm">{error}</div>
        )}

        {!loading && payments && usage && (
          <>
            {/* Section 2: Purchase History */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold">{t("credit-history.purchase_history")}</h2>
                {payments.length > 0 && (
                  <span className="ml-auto text-xs text-white/30">{payments.length} purchase{payments.length !== 1 ? "s" : ""}</span>
                )}
              </div>

              {payments.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-white/30 text-sm">
                  No purchases yet.{" "}
                  <Link href="/pricing#credit-packs" className="text-primary hover:underline">{t("credit-history.buy_visual_bucs")}</Link>{t("credit-history.to_get_started")}</div>
              ) : (
                <div className="rounded-xl border border-white/[0.06] overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.date")}</th>
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.pack")}</th>
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.visual_bucs_added")}</th>
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.amount_paid")}</th>
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...payments].reverse().map((p) => (
                        <tr key={p.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3 text-white/50">{fmt(p.createdAt)}</td>
                          <td className="px-4 py-3 text-white/70">{p.creditPack ?? "—"}</td>
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1 text-primary font-semibold">
                              <Zap className="h-3.5 w-3.5" />+{p.creditsAmount.toLocaleString("en-US")}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-white/50">{fmtMoney(p.amountTotal, p.currency)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Section 3: Credit Activity (charges, refunds, grants) */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-white/50" />
                <h2 className="text-lg font-bold">{t("credit-history.visual_buc_activity")}</h2>
                {usage.length > 0 && (
                  <span className="ml-auto text-xs text-white/30">{usage.length} transaction{usage.length !== 1 ? "s" : ""}</span>
                )}
              </div>

              {usage.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-white/30 text-sm">{t("credit-history.no_visual_buc_activity_yet_start")}</div>
              ) : (
                <div className="rounded-xl border border-white/[0.06] overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.date")}</th>
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.action")}</th>
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.type")}</th>
                        <th className="text-left px-4 py-3 text-white/40 font-medium">{t("credit-history.amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...usage].reverse().map((u) => {
                        const d = describeUsage(u);
                        return (
                          <tr key={u.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3 text-white/50">{fmt(u.createdAt)}</td>
                            <td className="px-4 py-3 text-white/80">{u.action}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                                  d.tone === "credit"
                                    ? "bg-green-500/10 text-green-400 border-green-500/20"
                                    : d.tone === "free"
                                      ? "bg-white/[0.04] text-white/40 border-white/10"
                                      : "bg-white/[0.04] text-white/60 border-white/10"
                                }`}
                              >
                                {d.type}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`flex items-center gap-1 font-semibold ${
                                  d.tone === "credit" ? "text-green-400" : "text-white/50"
                                }`}
                              >
                                <Zap className="h-3.5 w-3.5" />{d.amount}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

      </div>
    </div>
  );
}
