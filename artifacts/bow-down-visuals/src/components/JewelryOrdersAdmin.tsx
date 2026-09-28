import { useCallback, useEffect, useState } from "react";
import { Gem, Loader2, Download, RefreshCw } from "lucide-react";

/* ─── Admin: jewelry orders ─────────────────────────────────────────────
   Lists custom jewelry reservations for the owner, with one-click CSV
   export for the manufacturer (specs + engraving + ship-to). */

interface AdminJewelryOrder {
  id: string;
  user_id: string;
  product_key: string;
  finish: string;
  size_option: string;
  engraving: string | null;
  design_notes: string | null;
  quantity: number;
  full_name: string;
  email: string;
  phone: string | null;
  shipping_address: { street: string; city: string; state: string; zip: string; country: string };
  status: string;
  unit_price_cents: number;
  total_cents: number;
  created_at: string;
}

export function JewelryOrdersAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const [orders, setOrders] = useState<AdminJewelryOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/jewelry/admin/orders", { headers: await authHeaders() });
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
    const res = await fetch("/api/jewelry/admin/orders.csv", { headers: await authHeaders() });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jewelry-orders.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Gem className="h-5 w-5 text-amber-400" /> Jewelry Reservations
          <span className="text-xs font-normal text-white/40">({orders.length})</span>
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:border-white/25"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-black hover:brightness-110"
          >
            <Download className="h-3.5 w-3.5" /> Supplier CSV
          </button>
        </div>
      </div>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : orders.length === 0 ? (
        <p className="text-sm text-white/40">No jewelry reservations yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-white/40 border-b border-white/[0.06]">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Piece</th>
                <th className="px-3 py-2 font-semibold">Finish / Size</th>
                <th className="px-3 py-2 font-semibold">Engraving</th>
                <th className="px-3 py-2 font-semibold">Qty</th>
                <th className="px-3 py-2 font-semibold">Total</th>
                <th className="px-3 py-2 font-semibold">Buyer</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-white/[0.06] text-white/70">
                  <td className="px-3 py-2 text-xs">{new Date(o.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{o.product_key}</td>
                  <td className="px-3 py-2 text-xs">{o.finish} · {o.size_option}</td>
                  <td className="px-3 py-2 text-xs max-w-[160px] truncate" title={o.engraving ?? ""}>{o.engraving || "—"}</td>
                  <td className="px-3 py-2">{o.quantity}</td>
                  <td className="px-3 py-2">${(o.total_cents / 100).toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs">{o.full_name}<br /><span className="text-white/40">{o.email}</span></td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-1 rounded-full bg-amber-400/10 text-amber-300">{o.status.replace("_", " ")}</span>
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
