import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { Loader2, ShieldCheck, Zap, BadgeDollarSign, ArrowLeft, Lock, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { shareDrop } from "@/lib/share-drop";
import { usePageTitle } from "@/hooks/use-page-title";

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
  series: "Series / Season Pass",
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
    pwyw?: { enabled: boolean; minCents: number; minPrice: string };
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
  const isLight = useIsLightTheme();
  usePageTitle("Checkout", "Complete your purchase securely on Bow Down Visuals.");
  const params = useParams<{ kind: string; id: string }>();
  const [, navigate] = useLocation();
  const { user, getAccessToken } = useAuth();
  const [data, setData] = useState<ItemData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [notWired, setNotWired] = useState(false);
  const [shared, setShared] = useState(false);
  /* Name-your-price: the fan's amount in dollars (PWYW items only). */
  const [pwywDollars, setPwywDollars] = useState("");
  const [pwywError, setPwywError] = useState<string | null>(null);

  async function onShare() {
    if (!data) return;
    const outcome = await shareDrop({
      title: data.item.title,
      text: `“${data.item.title}” by ${data.item.artistName} — cop it on Bow Down Visuals 👑`,
      url: `/store/buy/${data.item.kind}/${data.item.id}`,
    });
    if (outcome === "copied") {
      setShared(true);
      setTimeout(() => setShared(false), 2500);
    }
  }

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
        if (body.item.pwyw?.enabled) {
          const startCents = Math.max(body.item.priceCents, body.item.pwyw.minCents);
          setPwywDollars((startCents / 100).toFixed(2));
        }
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
    /* Name-your-price: the amount the fan typed is the amount charged —
       validated here for speed and again on the server (the server's
       minimum check is the one that counts). */
    let amountCents: number | undefined;
    if (data?.item.pwyw?.enabled) {
      const cents = Math.round(Number.parseFloat(pwywDollars || "0") * 100);
      if (!Number.isFinite(cents) || cents < data.item.pwyw.minCents) {
        setPwywError(`Name your price — at least ${data.item.pwyw.minPrice}.`);
        return;
      }
      setPwywError(null);
      amountCents = cents;
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
        body: JSON.stringify({ kind: params.kind, id: params.id, ...(amountCents !== undefined ? { amountCents } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string; watchUrl?: string };
      /* A series unlock can't be bought twice — the rail refuses the
         second checkout; send the fan straight to their series. */
      if (body.error === "ALREADY_OWNED" && body.watchUrl) {
        navigate(body.watchUrl);
        return;
      }
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
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-amber-200/60 hover:text-amber-200">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          {data && (
            <button
              onClick={onShare}
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 px-4 py-2 text-sm text-amber-200 hover:bg-amber-500/10"
            >
              <Share2 className="h-4 w-4" /> {shared ? "Link copied!" : "Share"}
            </button>
          )}
        </div>

        {error ? (
          <div className={`mt-8 rounded-2xl border border-amber-500/30 p-10 text-center ${isLight ? "bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA]" : "bg-gradient-to-b from-[#171204] to-[#0d0a04]"}`}>
            <div className="text-4xl">{notWired ? "🛠️" : "🔒"}</div>
            <h1 className="mt-4 text-2xl font-bold text-amber-300">Not available right now</h1>
            <p className="mt-2 text-amber-100/70">{error}</p>
          </div>
        ) : !data ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          </div>
        ) : (
          <div className={`mt-8 overflow-hidden rounded-2xl border border-amber-500/30 shadow-[0_0_60px_rgba(201,162,39,0.15)] ${isLight ? "bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA]" : "bg-gradient-to-b from-[#171204] to-[#0d0a04]"}`}>
            {data.item.artworkUrl ? (
              <img src={data.item.artworkUrl} alt={data.item.title} className="h-64 w-full object-cover" />
            ) : (
              <div className="flex h-48 w-full items-center justify-center bg-gradient-to-br from-amber-900/40 to-black text-6xl">
                👑
              </div>
            )}
            <div className="p-8">
              <div className="text-xs uppercase tracking-[0.25em] text-amber-400/80">
                {KIND_LABELS[data.item.kind] ?? data.item.kind} · {data.item.kind === "series" ? "Series unlock" : "Digital download"}
              </div>
              <h1 className="mt-2 text-3xl font-bold text-amber-200">{data.item.title}</h1>
              <p className="mt-1 text-amber-100/70">
                by{" "}
                <Link href={`/artist/${data.item.artistSlug}`} className="text-amber-300 underline-offset-2 hover:underline">
                  {data.item.artistName}
                </Link>
              </p>

              <div className="mt-6 rounded-xl border border-amber-500/20 bg-black/40 p-5">
                {data.item.pwyw?.enabled ? (
                  <div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm text-amber-100/60">Name your price</span>
                      <span className="text-xs text-amber-100/50">minimum {data.item.pwyw.minPrice}</span>
                    </div>
                    <div className="relative mt-2">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-200/60">$</span>
                      <input
                        value={pwywDollars}
                        onChange={(e) => setPwywDollars(e.target.value)}
                        inputMode="decimal"
                        aria-label="Your price in dollars"
                        className="w-full rounded-lg border border-amber-500/30 bg-black/60 py-2.5 pl-7 pr-3 text-xl font-bold text-amber-200 outline-none focus:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/60"
                      />
                    </div>
                    {pwywError && <p className="mt-2 text-xs font-bold text-red-300">{pwywError}</p>}
                    <p className="mt-2 text-xs text-amber-100/50">Pay what it's worth to you — the amount you enter is the amount you're charged.</p>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-amber-100/60">Your price</span>
                    <span className="text-3xl font-bold text-amber-300">{data.item.price}</span>
                  </div>
                )}
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
                {buying ? "Opening secure checkout…" : user
                  ? data.item.kind === "series" ? "Unlock it now — watch instantly" : "Buy it now — instant delivery"
                  : "Sign in to buy"}
              </button>

              <div className="mt-5 flex items-center justify-center gap-2 text-xs text-amber-100/50">
                <ShieldCheck className="h-4 w-4 text-amber-400" />
                {data.item.kind === "series"
                  ? "Unlocks on your account the second you pay · every episode · watch anytime"
                  : "Instant download link after payment · 48 hours · yours to keep"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
