import { useEffect, useState } from "react";
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
  const [rows, setRows] = useState<ReceiptRow[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/creator-tiers/history", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) setRows((await res.json()).receipts ?? []);
      } catch {
        /* history degrades silently — never blocks the pricing page */
      }
    })();
  }, [user, getAccessToken]);

  if (!user || rows.length === 0) return null;

  return (
    <section aria-label="Subscription history" className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-white/80">
        <Receipt className="h-4 w-4" /> Subscription history
      </h2>
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
