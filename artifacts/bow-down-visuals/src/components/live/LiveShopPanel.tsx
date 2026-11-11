import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, CheckCircle2, Loader2, Pin, RotateCcw, ShoppingBag, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { loginPathWithNext } from "@/lib/auth-next";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import {
  LIVE_STREAM_SHOP_PATH,
  LIVE_SHOP_CHECKOUT_PATH,
  LIVE_SHOP_VERIFY_PATH,
  LIVE_SHOP_ENDED_COPY,
  liveShopPendingKey,
  normalizeLiveStreamShop,
  otherShopProducts,
  liveShopPanelMode,
  liveShopCheckoutOutcome,
  liveShopVerifyOutcome,
  liveShopVerifyIsTerminal,
  type LiveShopViewerProduct,
  type LiveShopViewerShop,
} from "@/lib/live-shop-viewer";

/* ─── Live Shopping on the watch page ────────────────────────────────
   The viewer side of Live Shopping, docked into /live/:id: the items
   pinned in THIS stream, at the server's prices, buyable on the
   existing rail (POST /live-shopping/checkout → embedded first,
   hosted new-tab fallback → POST /live-shopping/verify). The read is
   GET /api/live-streams/:id/shop (lib/live-shop-viewer carries the
   seam): broadcast stream → its creator → that creator's selling
   session → pinned product + active catalog.

   Honest states, all decided by liveShopPanelMode from server truth:
   - the seller watching their own stream gets a MANAGE view — never
     a buy control (the rail refuses self-purchase);
   - a stream (or selling session) that is not live shows what was
     pinned with NO buy control and the plain ended copy — the rail
     409s STREAM_NOT_LIVE, so the UI never offers what it refuses;
   - a signed-out viewer browses the items (public-browse) and meets
     sign-in at the buy moment;
   - a purchase is "complete" only when verify says success. Q150: a
     payment that settled after the stream ended comes back refused +
     refunded, and the panel says exactly that.
   Renders nothing when the creator has no selling session — no shop
   is attached to this stream (the PartyTableSection pattern). */

type LoadState = "loading" | "ready" | "error";

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#f5d76e] to-[#b8860b] px-4 py-2 text-xs font-bold text-black shadow-[0_0_18px_rgba(212,175,55,0.3)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

export default function LiveShopPanel({
  streamId,
  broadcastLive,
}: {
  streamId: string;
  broadcastLive: boolean;
}) {
  const { user, getAccessToken } = useAuth();
  const tokenFnRef = useRef(getAccessToken);
  tokenFnRef.current = getAccessToken;
  const [load, setLoad] = useState<LoadState>("loading");
  const [shop, setShop] = useState<LiveShopViewerShop | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [buySecret, setBuySecret] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [noteTone, setNoteTone] = useState<"ok" | "warn">("ok");
  const verifyingRef = useRef(false);

  const authHeaders = useCallback(async () => {
    const token = await tokenFnRef.current().catch(() => null);
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const fetchShop = useCallback(async (): Promise<LiveShopViewerShop | null> => {
    const token = await tokenFnRef.current().catch(() => null);
    const res = await fetch(LIVE_STREAM_SHOP_PATH(streamId), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error("shop load failed");
    return normalizeLiveStreamShop(await res.json());
  }, [streamId]);

  /* Initial load (and manual retries): a failure is an error card
     with a retry — never dressed up as "no shop here". */
  useEffect(() => {
    let cancelled = false;
    setLoad("loading");
    (async () => {
      try {
        const s = await fetchShop();
        if (cancelled) return;
        setShop(s);
        setLoad("ready");
      } catch {
        if (!cancelled) setLoad("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchShop, retryNonce]);

  /* While the show is live, keep the pin honest: the seller can
     rotate the pinned product or end the session mid-watch. Silent
     refresh — a failed tick keeps the last truth and retries next
     tick (the page's own poll rhythm). */
  useEffect(() => {
    if (!broadcastLive || load !== "ready") return;
    const timer = setInterval(async () => {
      try {
        const s = await fetchShop();
        setShop(s);
      } catch {
        /* the next poll retries */
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [broadcastLive, load, fetchShop]);

  const say = useCallback((message: string, tone: "ok" | "warn") => {
    setNote(message);
    setNoteTone(tone);
  }, []);

  /* Verify a pending checkout from server truth (the desk pattern):
     a hosted checkout opened in a new tab — or an embedded one left
     mid-payment — is confirmed here on focus / mount, never assumed
     paid. The webhook settles a paid session even if this never
     runs; verify is the buyer's in-page confirmation. */
  const verifyPending = useCallback(async () => {
    if (verifyingRef.current || !user) return;
    let sessionId: string | null = null;
    try {
      sessionId = localStorage.getItem(liveShopPendingKey());
    } catch {
      /* storage blocked */
    }
    if (!sessionId) return;
    verifyingRef.current = true;
    try {
      const res = await fetch(LIVE_SHOP_VERIFY_PATH, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      const outcome = liveShopVerifyOutcome(res.ok, res.status, data);
      if (liveShopVerifyIsTerminal(outcome)) {
        try {
          localStorage.removeItem(liveShopPendingKey());
        } catch {
          /* ignore */
        }
      }
      if (outcome.kind === "confirmed") {
        setBuySecret(null);
        say("Payment confirmed — your purchase is complete.", "ok");
        const s = await fetchShop().catch(() => null);
        if (s) setShop(s);
      } else if (outcome.kind === "refunded" || outcome.kind === "refused") {
        setBuySecret(null);
        say(outcome.message, "warn");
      } else {
        say(outcome.message, "warn");
      }
    } catch {
      /* status couldn't refresh — nothing about the purchase changed */
    } finally {
      verifyingRef.current = false;
    }
  }, [user, authHeaders, fetchShop, say]);

  useEffect(() => {
    void verifyPending();
  }, [verifyPending]);
  useEffect(() => {
    const onFocus = () => void verifyPending();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [verifyPending]);

  /* Buy on the existing rail: embedded first (payment stays on this
     page), the hosted page in a NEW TAB only as the fallback (the
     sanctioned money moment), and the session id kept under the
     shared pending key so returning here verifies it. */
  const buy = async (product: LiveShopViewerProduct) => {
    if (!shop || busyId) return;
    setBusyId(product.id);
    setNote(null);
    setBuySecret(null);
    try {
      const res = await fetch(LIVE_SHOP_CHECKOUT_PATH, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          product_id: product.id,
          stream_id: shop.session.id,
          quantity: 1,
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const outcome = liveShopCheckoutOutcome(res.ok, res.status, data, "Checkout failed. Try again in a moment.");
      if (outcome.kind === "embedded") {
        if (outcome.sessionId) {
          try {
            localStorage.setItem(liveShopPendingKey(), outcome.sessionId);
          } catch {
            /* storage blocked — the on-return verify just won't find it */
          }
        }
        setBuySecret(outcome.clientSecret);
        say("Finish paying right here — your purchase confirms the moment the payment lands.", "ok");
      } else if (outcome.kind === "hosted") {
        if (outcome.sessionId) {
          try {
            localStorage.setItem(liveShopPendingKey(), outcome.sessionId);
          } catch {
            /* ignore */
          }
        }
        window.open(outcome.url, "_blank", "noopener,noreferrer");
        say("Checkout opened in a new tab — come back here and we'll confirm your purchase.", "ok");
      } else if (outcome.kind === "stream-ended") {
        say(outcome.message, "warn");
        const s = await fetchShop().catch(() => null);
        if (s) setShop(s);
      } else {
        say(outcome.message, "warn");
      }
    } catch {
      say("Checkout failed. Try again in a moment.", "warn");
    } finally {
      setBusyId(null);
    }
  };

  if (load === "loading") {
    return (
      <div
        className="mt-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-sm text-white/50"
        data-testid="live-shop-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
        Loading this stream's shop…
      </div>
    );
  }

  if (load === "error") {
    return (
      <div
        className="mt-5 flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-400/[0.05] px-5 py-4"
        data-testid="live-shop-error"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-red-100">Couldn't load this stream's shop.</p>
          <p className="mt-0.5 text-xs text-red-100/60">The stream itself is fine — its shop just couldn't load right now.</p>
        </div>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-red-300/30 px-3 py-1.5 text-xs font-bold text-red-100 transition hover:bg-red-400/10"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }

  /* No selling session for this creator — no shop rides this stream. */
  if (!shop) return null;
  /* A session with nothing pinned and nothing active has nothing a
     viewer can act on; the seller's own page is where it gets set up. */
  if (!shop.pinnedProduct && shop.products.length === 0) return null;

  const mode = liveShopPanelMode(shop, { broadcastLive, signedIn: !!user });
  const others = otherShopProducts(shop);
  const signInHref = loginPathWithNext(`/live/${streamId}`);

  const buyControl = (p: LiveShopViewerProduct) => {
    if (mode === "buy") {
      return (
        <button
          type="button"
          onClick={() => void buy(p)}
          disabled={busyId !== null}
          className={goldBtn}
          data-testid="live-shop-buy"
        >
          {busyId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />}
          Buy {p.price}
        </button>
      );
    }
    if (mode === "signin") {
      return (
        <Link href={signInHref} className={goldBtn} data-testid="live-shop-signin">
          Sign in to buy
        </Link>
      );
    }
    return null;
  };

  const productRow = (p: LiveShopViewerProduct, pinned: boolean) => (
    <div
      key={p.id}
      className={`flex items-center gap-3 rounded-xl border p-3 ${
        pinned ? "border-[#C9A84C]/50 bg-[#C9A84C]/[0.06]" : "border-white/10 bg-white/[0.02]"
      } ${mode === "ended" ? "opacity-60" : ""}`}
      data-testid={pinned ? "live-shop-pinned" : "live-shop-item"}
    >
      {p.imageUrl ? (
        <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/[0.05]">
          <ShoppingBag className="h-5 w-5 text-white/25" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-bold">
          <span className="truncate">{p.name}</span>
          {pinned && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#C9A84C]/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#e8c86a]">
              <Pin className="h-3 w-3" /> Pinned
            </span>
          )}
        </p>
        {p.description && <p className="mt-0.5 line-clamp-1 text-xs text-white/45">{p.description}</p>}
        <p className="mt-0.5 text-sm font-black text-[#e8c86a]">{p.price}</p>
      </div>
      {buyControl(p)}
    </div>
  );

  return (
    <section
      className="mt-5 rounded-2xl border border-[#C9A84C]/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] p-5"
      data-testid="live-shop-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-black">
          <ShoppingBag className="h-4 w-4 text-[#e8c86a]" /> Live Shopping
        </h2>
        {mode !== "ended" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
          </span>
        )}
        {shop.testMode && (
          <span className="rounded-full border border-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/40">
            Test mode
          </span>
        )}
        {mode === "manage" && (
          <Link
            href="/live-shopping"
            className="ml-auto text-xs font-bold text-[#e8c86a] hover:underline"
            data-testid="live-shop-manage-link"
          >
            Manage in Live Shopping
          </Link>
        )}
      </div>

      {mode === "ended" && (
        <p className="mt-3 text-xs leading-relaxed text-white/50" data-testid="live-shop-ended-copy">
          {LIVE_SHOP_ENDED_COPY}
        </p>
      )}
      {mode === "manage" && (
        <p className="mt-3 text-xs leading-relaxed text-white/50" data-testid="live-shop-manage-copy">
          This is your shop on this stream — viewers see these items with a Buy button. Pin or unpin from Live Shopping.
        </p>
      )}

      <div className="mt-4 grid gap-2">
        {shop.pinnedProduct && productRow(shop.pinnedProduct, true)}
        {others.map((p) => productRow(p, false))}
      </div>

      {note && (
        <div
          className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 ${
            noteTone === "ok"
              ? "border-green-400/30 bg-green-400/[0.06]"
              : "border-amber-400/30 bg-amber-400/[0.06]"
          }`}
          data-testid="live-shop-note"
          role="status"
        >
          <CheckCircle2
            className={`mt-0.5 h-4 w-4 shrink-0 ${noteTone === "ok" ? "text-green-300" : "text-amber-300"}`}
          />
          <p className={`text-xs leading-relaxed ${noteTone === "ok" ? "text-green-100/85" : "text-amber-100/85"}`}>
            {note}
          </p>
          <button type="button" onClick={() => setNote(null)} className="ml-auto shrink-0 text-white/40 hover:text-white" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {buySecret && mode === "buy" && (
        <div className="mt-4 space-y-2" data-testid="live-shop-embedded-checkout">
          <EmbeddedSessionCheckout clientSecret={buySecret} />
          <button type="button" onClick={() => setBuySecret(null)} className="text-xs text-white/40 hover:text-white">
            Close — nothing is charged until you finish paying
          </button>
        </div>
      )}
    </section>
  );
}
