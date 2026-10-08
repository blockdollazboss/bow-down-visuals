import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, Download, Music2, ReceiptText, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { KIND_LABELS } from "./store-buy";

/* ─── /my-music — the buyer's library ─────────────────────────────────────
   Every digital drop you've bought: re-download with a fresh secure link,
   view receipts. Real-money purchases (Stripe) — separate from Visual Bucs. */

interface Purchase {
  id: string;
  itemKind: string;
  itemId: string;
  title: string;
  artistName: string;
  artistSlug: string;
  artworkUrl: string | null;
  amount: string;
  purchasedAt: string;
  receiptId: string;
}

export default function MyMusic() {
  const { getAccessToken } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minting, setMinting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/store/purchases", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = (await res.json().catch(() => ({}))) as { purchases?: Purchase[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Couldn't load your library.");
      setPurchases(body.purchases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your library.");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    load();
  }, [load]);

  async function freshDownload(p: Purchase) {
    setMinting(p.id);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/store/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ saleId: p.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) throw new Error(body.error || "Couldn't make a download link.");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make a download link.");
    } finally {
      setMinting(null);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-amber-200">My Music</h1>
            <p className="mt-1 text-sm text-amber-100/60">
              Every drop you own — re-download anytime with a fresh secure link.
            </p>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/10"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          </div>
        ) : error ? (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center text-red-200">
            {error}
          </div>
        ) : purchases.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-black p-12 text-center">
            <Music2 className="mx-auto h-12 w-12 text-amber-400/60" />
            <h2 className="mt-4 text-xl font-bold text-amber-200">Nothing here yet</h2>
            <p className="mt-2 text-amber-100/60">
              When you buy a track, course, pack, or any digital drop, it lands here forever.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {purchases.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-4 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#141004] to-black p-4"
              >
                {p.artworkUrl ? (
                  <img src={p.artworkUrl} alt={p.title} className="h-16 w-16 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-amber-900/30 text-2xl">
                    👑
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-widest text-amber-400/70">
                    {KIND_LABELS[p.itemKind] ?? p.itemKind}
                  </div>
                  <div className="truncate font-bold text-amber-100">{p.title}</div>
                  <div className="text-sm text-amber-100/50">
                    {p.artistName} · {p.amount} · {new Date(p.purchasedAt).toLocaleDateString()}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-amber-100/40">
                    <ReceiptText className="h-3.5 w-3.5" /> Receipt {p.receiptId.slice(0, 18)}…
                  </div>
                </div>
                <button
                  onClick={() => freshDownload(p)}
                  disabled={minting === p.id}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-60"
                >
                  {minting === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Download
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-amber-100/40">
          Real-money purchases via Stripe. Visual Bucs (AI credits) are a separate thing entirely.
        </p>
      </div>
    </div>
  );
}
