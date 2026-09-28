import { useCallback, useEffect, useState } from "react";
import { Nfc, Loader2, Download, RefreshCw } from "lucide-react";
import { nfcStyleByKey, formatMoney } from "@/lib/nfc-cards";

/* ─── Admin: NFC card orders ────────────────────────────────────────────
   Lists card reservations for the owner, with one-click CSV export for
   the manufacturer (order data + NFC URLs + QR SVG URLs). */

interface AdminOrder {
  id: string;
  user_id: string;
  card_style: string;
  quantity: number;
  full_name: string;
  email: string;
  phone: string | null;
  shipping_address: { street: string; city: string; state: string; zip: string; country: string };
  status: string;
  unit_price_cents: number;
  total_cents: number;
  created_at: string;
  nfc_profiles: { slug: string } | null;
}

export function NfcOrdersAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/nfc-cards/admin/orders", { headers: await authHeaders() });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Load failed");
      setOrders(json.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);

  const downloadCsv = async () => {
    const res = await fetch("/api/nfc-cards/admin/orders.csv", { headers: await authHeaders() });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nfc-card-orders.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Nfc className="h-4 w-4 text-primary" />
          <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
            NFC card orders
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="text-xs rounded-lg border border-white/10 px-3 py-1.5 text-white/70 hover:border-white/25 flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          <button
            onClick={() => void downloadCsv()}
            disabled={orders.length === 0}
            className="text-xs rounded-lg border border-white/10 px-3 py-1.5 text-white/70 hover:border-white/25 disabled:opacity-40 flex items-center gap-1"
          >
            <Download className="h-3 w-3" /> Supplier CSV
          </button>
        </div>
      </div>
      <p className="text-sm text-white/60 mb-4">
        Card reservations. The CSV has everything the manufacturer needs: style,
        quantity, ship-to, NFC URL and QR artwork URL per card.
      </p>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-white/40">No NFC card orders yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-white/[0.03] text-left text-xs text-white/40">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Customer</th>
                <th className="px-3 py-2 font-semibold">Style</th>
                <th className="px-3 py-2 font-semibold">Qty</th>
                <th className="px-3 py-2 font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">Card page</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-white/[0.06] text-white/70">
                  <td className="px-3 py-2 whitespace-nowrap">{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    <div>{o.full_name}</div>
                    <div className="text-xs text-white/40">{o.email}</div>
                  </td>
                  <td className="px-3 py-2">{nfcStyleByKey(o.card_style)?.label ?? o.card_style}</td>
                  <td className="px-3 py-2">{o.quantity}</td>
                  <td className="px-3 py-2">{formatMoney(o.total_cents)}</td>
                  <td className="px-3 py-2">
                    {o.nfc_profiles ? (
                      <a href={`/c/${o.nfc_profiles.slug}`} target="_blank" rel="noopener noreferrer"
                        className="text-amber-400/90 hover:text-amber-300 text-xs">
                        /c/{o.nfc_profiles.slug}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06]">{o.status.replace("_", " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
