import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── SubscriptionHistory — visible subscription receipts ──────────────────
   Payfix upgrade-path: Pass 1 found NO receipt/history row anywhere for
   a paid tier subscription. The webhook sync now writes one row per
   lifecycle event (exactly once per Stripe event/invoice); this lists
   them from GET /creator-tiers/history. Renders nothing when signed out
   or when there are no receipts yet.                                   */

interface ReceiptRow {
  id: string;
  kind: string;
  tier: string | null;
  status: string | null;
  amount: string | null;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  subscribed: "Subscribed",
  tier_changed: "Plan changed",
  renewed: "Renewed",
  payment_failed: "Payment failed",
  canceled: "Canceled",
  status_changed: "Status changed",
};

export default function SubscriptionHistory() {
  const { user, getAccessToken } = useAuth();
  const { t } = useTranslation();
  /* null = no successful load yet; [] = a confirmed-empty 200. The
     two must never be conflated (empty-lie fix): before, rows started
     as [] and failures were swallowed, so a paying subscriber's whole
     receipt history silently disappeared. */
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadFailed(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/creator-tiers/history", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("history load failed");
      setRows((await res.json()).receipts ?? []);
    } catch {
      /* A failed load is NOT an empty history — raise the honest
         failed state below; it never blocks the pricing page. */
      setLoadFailed(true);
    }
  }, [user, getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  if (!user) return null;

  if (loadFailed && (!rows || rows.length === 0)) {
    return (
      <section aria-label="Subscription history" data-testid="subscription-history-load-error"
        className="mx-auto mt-10 max-w-2xl rounded-2xl border border-red-500/30 bg-red-500/[0.04] p-5">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/80">
          <Receipt className="h-4 w-4" /> Subscription history
        </h2>
        <p role="alert" className="mt-3 text-sm text-red-300">{t("subscriptionHistory.loadError")}</p>
        <button type="button" onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white/70 transition hover:text-white">
          {t("subscriptionHistory.retry")}
        </button>
      </section>
    );
  }

  if (!rows) {
    return (
      <section aria-label="Subscription history" data-testid="subscription-history-loading"
        className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-5">
        <p className="text-sm text-white/50">{t("subscriptionHistory.loading")}</p>
      </section>
    );
  }

  if (rows.length === 0) return null;

  return (
    <section aria-label="Subscription history" className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/80">
        <Receipt className="h-4 w-4" /> Subscription history
      </h2>
      {loadFailed && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-300" data-testid="subscription-history-reload-error">
          <span role="alert">{t("subscriptionHistory.loadError")}</span>
          <button type="button" onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold text-white/70 transition hover:text-white">
            {t("subscriptionHistory.retry")}
          </button>
        </p>
      )}
      <ul className="mt-3 divide-y divide-white/10">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-white/80">
              {KIND_LABELS[r.kind] ?? r.kind}
              {r.tier ? <span className="text-white/50"> · {r.tier}</span> : null}
            </span>
            <span className="text-white/50">
              {r.amount ? <span className="mr-3 text-white/80">{r.amount}</span> : null}
              {new Date(r.createdAt).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
