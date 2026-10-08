import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { Loader2, ShieldCheck, Zap, BadgeDollarSign, ArrowLeft, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── /store/buy/:kind/:id — the drop page ─────────────────────────────────
   Sell ANY digital content: a track, a video course, a series pass, a sample
   pack, a preset bundle, an ebook. Instant checkout, instant delivery —
   selling should feel like an unfair advantage.

   Money copy rule: this is REAL MONEY via Stripe, never Visual Bucs. */

export const KIND_LABELS: Record<string, string> = {
  track: "Track",
  video: "Video / Course",
  album: "Album / Series",
  pack: "Pack / Bundle",
  digital: "Digital product",
};

interface ItemData {
  item: {
    kind: string;
    id: string;
    title: string;
    artworkUrl: string | null;
    artistName: string;
    artistSlug: string;
    priceCents: number;
    price: string;
  };
  feeSplit: {
    price: string;
    platformFee: string;
    platformFeePct: number;
    creatorAmount: string;
  };
  note: string;
}

export default function StoreBuy() {
  const params = useParams<{ kind: string; id: string }>();
  const [, navigate] = useLocation();
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<ItemData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [notWired, setNotWired] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/store/item/${params.kind}/${params.id}`);
        const body = (await res.json().catch(() => ({}))) as ItemData & { error?: string; message?: string };
        if (!alive) return;
        if (!res.ok) {
          if (body.error === "SELLING_NOT_AVAILABLE") setNotWired(true);
          setError(body.message || body.error || "Couldn't load this drop.");
          return;
        }
        setData(body);
      } catch {
        if (alive) setError("Couldn't load this drop. Check your connection.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [params.kind, params.id]);

  async function buyNow() {
    if (!user) {
      navigate("/login");
      return;
    }
    setBuying(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ kind: params.kind, id: params.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (!res.ok || !body.url) throw new Error(body.message || body.error || "Checkout failed.");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setBuying(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-amber-200/60 hover:text-amber-200">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        {error ? (
          <div className="mt-8 rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-black p-10 text-center">
            <div className="text-4xl">{notWired ? "🛠️" : "🔒"}</div>
            <h1 className="mt-4 text-2xl font-bold text-amber-300">Not available right now</h1>
            <p className="mt-2 text-amber-100/70">{error}</p>
          </div>
        ) : !data ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#171204] to-black shadow-[0_0_60px_rgba(201,162,39,0.15)]">
            {data.item.artworkUrl ? (
              <img src={data.item.artworkUrl} alt={data.item.title} className="h-64 w-full object-cover" />
            ) : (
              <div className="flex h-48 w-full items-center justify-center bg-gradient-to-br from-amber-900/40 to-black text-6xl">
                👑
              </div>
            )}
            <div className="p-8">
              <div className="text-xs uppercase tracking-[0.25em] text-amber-400/80">
                {KIND_LABELS[data.item.kind] ?? data.item.kind} · Digital download
              </div>
              <h1 className="mt-2 text-3xl font-bold text-amber-200">{data.item.title}</h1>
              <p className="mt-1 text-amber-100/70">
                by{" "}
                <Link href={`/c/${data.item.artistSlug}`} className="text-amber-300 underline-offset-2 hover:underline">
                  {data.item.artistName}
                </Link>
              </p>

              <div className="mt-6 rounded-xl border border-amber-500/20 bg-black/40 p-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-amber-100/60">Your price</span>
                  <span className="text-3xl font-bold text-amber-300">{data.item.price}</span>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-amber-500/10 pt-3 text-sm">
                  <div className="flex justify-between text-amber-100/70">
                    <span className="inline-flex items-center gap-1.5">
                      <BadgeDollarSign className="h-4 w-4 text-amber-400" /> Goes to {data.item.artistName}
                    </span>
                    <span className="font-semibold text-amber-200">{data.feeSplit.creatorAmount}</span>
                  </div>
                  <div className="flex justify-between text-amber-100/50">
                    <span>Platform fee ({data.feeSplit.platformFeePct}%)</span>
                    <span>{data.feeSplit.platformFee}</span>
                  </div>
                </div>
                <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-100/50">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Real-money purchase, secured by Stripe. This is not Visual Bucs (AI credits).
                </p>
              </div>

              <button
                onClick={buyNow}
                disabled={buying}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-6 py-4 text-lg font-bold text-black transition hover:brightness-110 disabled:opacity-60"
              >
                {buying ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
                {buying ? "Opening secure checkout…" : user ? "Buy it now — instant delivery" : "Sign in to buy"}
              </button>

              <div className="mt-5 flex items-center justify-center gap-2 text-xs text-amber-100/50">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                Instant download link after payment · 48 hours · yours to keep
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
