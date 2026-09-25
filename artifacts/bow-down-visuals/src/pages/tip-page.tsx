import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import {
  HandCoins, Loader2, Heart, BadgeAlert, Check, PiggyBank, ChevronLeft,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";

/* ─── Public tip page — /tips/:handle ──────────────────────────────────────
   Fans land here from a creator's shared link, pick an amount, and record a
   tip. Payment processing is COMING SOON: no charge is made, the page and
   the API both say so plainly. */

interface PublicPage {
  handle: string;
  displayName: string;
  message: string;
  suggestedAmounts: number[];
  goalAmount: number | null;
  goalLabel: string;
}

interface PageData {
  page: PublicPage;
  stats: { total: number; count: number; average: number; goalProgress: number | null };
  paymentsLive: boolean;
  notice: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export default function TipPage() {
  const [, params] = useRoute("/tips/:handle");
  const handle = (params?.handle ?? "").toLowerCase();

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [fanName, setFanName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!handle) return;
    setLoading(true);
    fetch(`/api/tips/page/${encodeURIComponent(handle)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const json = await res.json();
        setData(json);
        if (json.page?.suggestedAmounts?.length) setAmount(json.page.suggestedAmounts[0]);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [handle]);

  const effectiveAmount = customAmount.trim() ? Number(customAmount) : amount;

  async function sendTip() {
    if (!effectiveAmount || effectiveAmount <= 0) {
      setError("Pick or enter an amount first.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tips/${encodeURIComponent(handle)}/tip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: effectiveAmount, fanName, message }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.details?.[0]?.message ?? json.error ?? "Couldn't record your tip.");
        return;
      }
      setSent(true);
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-xl px-4 pb-24 pt-28">
        {loading ? (
          <div className="flex justify-center pt-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : notFound || !data ? (
          <div className="pt-16 text-center">
            <HandCoins className="mx-auto h-12 w-12 text-white/20" />
            <h1 className="mt-4 text-2xl font-bold">Tip page not found</h1>
            <p className="mt-2 text-white/50">This handle doesn't have a tip jar yet. Double-check the link.</p>
            <Link href="/" className="mt-6 inline-block rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/70 hover:bg-white/[0.06]">
              Back home
            </Link>
          </div>
        ) : sent ? (
          <div className="pt-16 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
              <Check className="h-8 w-8 text-emerald-400" />
            </div>
            <h1 className="mt-4 text-2xl font-bold">Tip recorded!</h1>
            <p className="mx-auto mt-2 max-w-sm text-white/55">
              {data.page.displayName} will see your ${effectiveAmount?.toFixed(2)} tip intent.
              Payments are coming soon — nothing was charged today.
            </p>
          </div>
        ) : (
          <>
            <Link href="/" className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/70">
              <ChevronLeft className="h-3.5 w-3.5" /> Bow Down Visuals
            </Link>
            <div className="mt-4 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-8 text-center backdrop-blur">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-500/25 to-primary/25">
                <HandCoins className="h-8 w-8 text-primary" />
              </div>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight">
                Tip <span className="bg-gradient-to-r from-amber-200 via-primary to-amber-200 bg-clip-text text-transparent">{data.page.displayName}</span>
              </h1>
              {data.page.message && <p className="mx-auto mt-3 max-w-sm text-white/60">{data.page.message}</p>}

              {data.page.goalAmount != null && (
                <div className="mx-auto mt-5 max-w-sm">
                  <div className="flex items-center justify-between text-xs text-white/50">
                    <span>{data.page.goalLabel || "Goal"}</span>
                    <span>${data.stats.total.toFixed(2)} / ${data.page.goalAmount.toFixed(2)}</span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-primary"
                      style={{ width: `${Math.round((data.stats.goalProgress ?? 0) * 100)}%` }} />
                  </div>
                </div>
              )}

              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-white/40">
                <PiggyBank className="h-4 w-4 text-primary" />
                {data.stats.count} {data.stats.count === 1 ? "tip" : "tips"} so far · ${data.stats.total.toFixed(2)} total
              </div>

              <div className="mt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/45">Choose an amount (USD)</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {data.page.suggestedAmounts.map((a) => (
                    <button key={a} onClick={() => { setAmount(a); setCustomAmount(""); }}
                      className={`rounded-xl border px-5 py-2.5 text-sm font-bold transition ${
                        amount === a && !customAmount.trim()
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-white/15 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                      }`}>
                      ${a}
                    </button>
                  ))}
                </div>
                <input value={customAmount} onChange={(e) => setCustomAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="Or enter a custom amount" className={`${inputClass} mt-3 text-center`} inputMode="decimal" />
              </div>

              <div className="mt-4 space-y-3 text-left">
                <input value={fanName} onChange={(e) => setFanName(e.target.value)}
                  placeholder="Your name (optional)" className={inputClass} maxLength={60} />
                <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Say something nice (optional)" className={inputClass} rows={2} maxLength={280} />
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
              )}

              <button onClick={sendTip} disabled={sending}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-primary px-4 py-3.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className="h-4 w-4" />}
                Send ${effectiveAmount && effectiveAmount > 0 ? effectiveAmount.toFixed(2) : "0.00"} tip
              </button>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-left text-xs text-amber-200/85">
                <BadgeAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <p>{data.notice}</p>
              </div>
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
