import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell, Loader2, Pin, PinOff, Play, Plus, ShoppingBag, Square, TrendingUp,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "@/components/world/native/NativeStates";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { buildAlertText, parsePriceToCents } from "@/lib/live-shopping";
import {
  LIVE_SHOP_CATALOG_PATH, LIVE_SHOP_PRODUCTS_PATH, LIVE_SHOP_STREAMS_PATH,
  LIVE_SHOP_STREAM_PATH, LIVE_SHOP_STREAM_ALERTS_PATH, LIVE_SHOP_SALES_PATH,
  LIVE_SHOP_CHECKOUT_PATH, LIVE_SHOP_VERIFY_PATH, LIVE_SHOP_DASHBOARD_PATH,
  liveShopPendingKey,
  normalizeLiveShopCatalog, normalizeLiveShopStreams, normalizeLiveShopAlerts,
  normalizeLiveShopDashboard, activeLiveShopStream, pinnedLiveShopProduct,
  liveShopStreamTitleReady, liveShopProductDraftReady,
  liveShopEmbeddedSecret, liveShopHostedUrl, liveShopSessionId, liveShopVerifyConfirmed,
  type LiveShopProductView, type LiveShopStreamView, type LiveShopAlertView, type LiveShopDashboardView,
} from "@/lib/world/live-shopping-desk";

/* ─── Live Shopping desk — World parity wave 1, item 1 ──────────────
   The 2D Live Shopping page (pages/live-shopping.tsx), native in the
   hall's Screen panel on its own rails (lib/world/live-shopping-desk
   carries the seam + the named rail gaps):
   - your catalog (GET catalog) + a compact add-product form
     (POST products — the page's name/price core; editing, images and
     the charged AI description stay on the page, see the seam's
     follow-ons);
   - a selling session (POST streams starts it live; PATCH ends it)
     with pin / unpin of the overlay product (PATCH pinned_product_id);
   - the pinned card exactly as viewers see it on the overlay, with
     its Buy button;
   - purchase alerts: the stream's alert feed, polled on the page's
     4-second rhythm, plus the page's test-alert pair (POST alerts +
     POST sales — test rows, labelled test, never blended with paid);
   - per-stream revenue from the dashboard rail (paid/test apart).
   Buying follows ShopStands' money moment: POST checkout asking for
   the embedded presentation first (the shared
   EmbeddedSessionCheckout mounts right here), the hosted page in a
   NEW TAB only as the fallback, the session id kept under
   liveShopPendingKey() and VERIFIED on focus / reopen — a purchase
   is a sale only when the server's verify says so (the webhook
   settles it too if the buyer never returns). The checkout rail
   refuses your own product and any non-live stream, server-side;
   those refusals surface here word-for-word.
   This panel is members-only (LiveDesksPanel renders inside the
   World's !isGuest Screen panel), so palace guests never reach it. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getAccessToken]);
}

function LiveCard({ isLight, testId, children }: { isLight: boolean; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
      {children}
    </div>
  );
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const redBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

/** The one way a hosted payment page ever opens from this desk:
 *  a new tab, at the checkout moment, on the walker's click
 *  (ShopStands' openCheckoutTab, verbatim pattern). */
function openCheckoutTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function LiveShoppingDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [products, setProducts] = useState<LiveShopProductView[]>([]);
  const [feeBps, setFeeBps] = useState<number | null>(null);
  const [streams, setStreams] = useState<LiveShopStreamView[]>([]);
  const [dashboard, setDashboard] = useState<LiveShopDashboardView | null>(null);
  const [alerts, setAlerts] = useState<LiveShopAlertView[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [streamTitle, setStreamTitle] = useState("");
  const [productName, setProductName] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [testBuyer, setTestBuyer] = useState("");

  const [buySecret, setBuySecret] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const verifyingRef = useRef(false);

  const activeStream = activeLiveShopStream(streams);
  const pinned = pinnedLiveShopProduct(products, activeStream);
  const activeStreamId = activeStream?.id ?? null;

  const loadAlerts = useCallback(async (streamId: string) => {
    try {
      const res = await fetch(LIVE_SHOP_STREAM_ALERTS_PATH(streamId), { headers: await authHeaders() });
      if (!res.ok) return;
      setAlerts(normalizeLiveShopAlerts(await res.json()));
    } catch { /* overlay polling is best-effort — the next tick retries */ }
  }, [authHeaders]);

  const loadAll = useCallback(async () => {
    const [catalogRes, streamsRes, dashboardRes] = await Promise.allSettled([
      fetch(LIVE_SHOP_CATALOG_PATH, { headers: await authHeaders() }).then(async (r) => {
        if (!r.ok) throw new Error("catalog");
        return normalizeLiveShopCatalog(await r.json());
      }),
      fetch(LIVE_SHOP_STREAMS_PATH, { headers: await authHeaders() }).then(async (r) => {
        if (!r.ok) throw new Error("streams");
        return normalizeLiveShopStreams(await r.json());
      }),
      fetch(LIVE_SHOP_DASHBOARD_PATH, { headers: await authHeaders() }).then(async (r) => {
        if (!r.ok) throw new Error("dashboard");
        return normalizeLiveShopDashboard(await r.json());
      }),
    ]);
    if (catalogRes.status === "fulfilled") {
      setProducts(catalogRes.value.products);
      setFeeBps(catalogRes.value.feeBps);
    }
    if (streamsRes.status === "fulfilled") setStreams(streamsRes.value);
    if (dashboardRes.status === "fulfilled") setDashboard(dashboardRes.value);
    /* The desk has failed only when its core source — the catalog —
       couldn't load; the other sources settle independently, like
       the 2D page's per-source load states. */
    setFailed(catalogRes.status === "rejected");
    setLoading(false);
  }, [authHeaders]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  /* The alert feed for the active session, on the 2D page's own
     4-second poll — purchase alerts surface here in-World. */
  useEffect(() => {
    if (!activeStreamId) { setAlerts([]); return; }
    void loadAlerts(activeStreamId);
    const id = window.setInterval(() => void loadAlerts(activeStreamId), 4000);
    return () => window.clearInterval(id);
  }, [activeStreamId, loadAlerts]);

  /* Verify a pending checkout from server truth (ShopStands'
     refreshOrder pattern): paid → the confirmation + fresh revenue;
     not yet → an honest pending note, marker kept for the next
     focus. The webhook settles a paid session even if this never
     runs — verify is the in-World confirmation, not the only path. */
  const verifyPending = useCallback(async () => {
    if (verifyingRef.current) return;
    let sessionId: string | null = null;
    try { sessionId = localStorage.getItem(liveShopPendingKey()); } catch { /* storage blocked */ }
    if (!sessionId) return;
    verifyingRef.current = true;
    try {
      const res = await fetch(LIVE_SHOP_VERIFY_PATH, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && liveShopVerifyConfirmed(data)) {
        try { localStorage.removeItem(liveShopPendingKey()); } catch { /* ignore */ }
        setBuySecret(null);
        setNote("Payment confirmed — your purchase is complete and the sale is on the dashboard below.");
        await loadAll();
      } else {
        setNote("A checkout is still pending — it isn't a sale until the payment confirms. Finish paying, then come back here and it verifies itself.");
      }
    } catch {
      /* status couldn't refresh — nothing about the purchase changed */
    } finally {
      verifyingRef.current = false;
    }
  }, [authHeaders, loadAll]);

  useEffect(() => { void verifyPending(); }, [verifyPending]);
  useEffect(() => {
    const onFocus = () => void verifyPending();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [verifyPending]);

  const run = async (action: string, fn: () => Promise<void>) => {
    setBusy(action);
    setNote(null);
    try { await fn(); } catch (err) {
      setNote(plainErrorText(err, "Something went wrong. Try again in a moment."));
    } finally { setBusy(null); }
  };

  const startStream = () => void run("start", async () => {
    const res = await fetch(LIVE_SHOP_STREAMS_PATH, {
      method: "POST", headers: await authHeaders(),
      body: JSON.stringify({ title: streamTitle.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(data, "That selling session couldn't start."));
    setStreamTitle("");
    setNote("You're selling live — pin a product below and it shows on your overlay for viewers.");
    await loadAll();
  });

  const endStream = () => {
    if (!activeStream) return;
    void run("end", async () => {
      const res = await fetch(LIVE_SHOP_STREAM_PATH(activeStream.id), {
        method: "PATCH", headers: await authHeaders(),
        body: JSON.stringify({ status: "ended", pinned_product_id: null }),
      });
      if (!res.ok) throw new Error("end");
      setBuySecret(null);
      setNote("Selling session ended — purchases are closed, and the revenue below is final.");
      await loadAll();
    });
  };

  const pinProduct = (product: LiveShopProductView) => {
    if (!activeStream) return;
    const next = activeStream.pinnedProductId === product.id ? null : product.id;
    void run(`pin-${product.id}`, async () => {
      const res = await fetch(LIVE_SHOP_STREAM_PATH(activeStream.id), {
        method: "PATCH", headers: await authHeaders(),
        body: JSON.stringify({ pinned_product_id: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, "That pin couldn't be saved."));
      setStreams((ss) => ss.map((s) => (s.id === activeStream.id ? { ...s, pinnedProductId: next } : s)));
    });
  };

  const addProduct = () => void run("add-product", async () => {
    const priceCents = parsePriceToCents(productPrice);
    const res = await fetch(LIVE_SHOP_PRODUCTS_PATH, {
      method: "POST", headers: await authHeaders(),
      body: JSON.stringify({ name: productName.trim(), price_cents: priceCents }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiErrorMessage(data, "That product couldn't be added."));
    setProductName("");
    setProductPrice("");
    setNote("Product added to your catalog — pin it to the stream whenever you're ready.");
    await loadAll();
  });

  const fireTestAlert = (product: LiveShopProductView) => {
    if (!activeStream) return;
    void run(`alert-${product.id}`, async () => {
      const headers = await authHeaders();
      const res = await fetch(LIVE_SHOP_STREAM_ALERTS_PATH(activeStream.id), {
        method: "POST", headers,
        body: JSON.stringify({
          product_id: product.id,
          buyer_name: testBuyer.trim() || "A viewer",
          quantity: 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorMessage(data, "That test alert couldn't fire."));
      /* The 2D page's pair: a test sale rides alongside so the
         dashboard reflects it — labelled test there forever. */
      await fetch(LIVE_SHOP_SALES_PATH, {
        method: "POST", headers,
        body: JSON.stringify({ product_id: product.id, stream_id: activeStream.id, quantity: 1 }),
      });
      await loadAlerts(activeStream.id);
      await loadAll();
    });
  };

  /* Buy the pinned product — ShopStands' money moment on this rail:
     embedded first, hosted new-tab fallback, verify on return. */
  const buyPinned = async () => {
    if (!pinned || buying) return;
    setBuying(true);
    setNote(null);
    setBuySecret(null);
    try {
      const res = await fetch(LIVE_SHOP_CHECKOUT_PATH, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({
          product_id: pinned.id,
          stream_id: activeStream?.id,
          quantity: 1,
          uiMode: hasStripePublishableKey() ? "embedded" : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "Checkout didn't start — nothing was charged."));
      const sessionId = liveShopSessionId(data);
      if (sessionId) {
        try { localStorage.setItem(liveShopPendingKey(), sessionId); } catch { /* storage blocked — verify on return just won't find it */ }
      }
      const secret = liveShopEmbeddedSecret(data);
      if (secret) {
        setBuySecret(secret);
        setNote("Finish paying right here — your purchase confirms the moment the payment lands.");
        return;
      }
      const url = liveShopHostedUrl(data);
      if (url) {
        openCheckoutTab(url);
        setNote("Your checkout opened in a new tab — finish paying there. This desk keeps your place and confirms the purchase here when the payment lands.");
        return;
      }
      throw new Error("Checkout didn't return a payment page — nothing was charged.");
    } catch (err) {
      setNote(plainErrorText(err, "Checkout didn't start — nothing was charged."));
    } finally {
      setBuying(false);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const priceCentsDraft = parsePriceToCents(productPrice);
  const productReady = liveShopProductDraftReady(productName, priceCentsDraft);

  return (
    <div className="space-y-3" data-testid="world-live-shopping">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <ShoppingBag className="h-4 w-4 text-[#d4af37]" /> Live Shopping — sell on your stream
      </p>
      <p className={`text-sm ${muted}`}>
        Pin a product to your live selling session, viewers see it on the overlay, purchases fire the alert feed, and every stream&rsquo;s revenue lands below.
        {feeBps !== null ? ` The platform fee is ${feeBps / 100}% of each sale, taken from the seller's side.` : ""}
      </p>

      {loading ? (
        <NativeLoadingState isLight={isLight} message="Opening your shop…" />
      ) : failed ? (
        <NativeErrorState
          isLight={isLight}
          title="Your live shop wouldn't open"
          message="Your catalog couldn't be brought into the hall. Nothing about your shop changed — try again."
          onRetry={() => { setLoading(true); void loadAll(); }}
        />
      ) : (
        <>
          {!activeStream ? (
            <LiveCard isLight={isLight} testId="world-live-shop-start">
              <p className={`text-sm font-bold ${strong}`}>Start a selling session</p>
              <p className={`mt-1 text-sm ${muted}`}>A session is the selling side of your stream: it starts live, takes one pinned product at a time, and closes purchases the moment it ends.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={streamTitle}
                  onChange={(e) => setStreamTitle(e.target.value)}
                  placeholder="Session title — e.g. Friday drop"
                  maxLength={160}
                  className={`${inputCls(isLight)} min-w-48 flex-1`}
                  data-testid="world-live-shop-title"
                  aria-label="Selling session title"
                />
                <button type="button" onClick={startStream} disabled={busy !== null || !liveShopStreamTitleReady(streamTitle)} className={goldBtn} data-testid="world-live-shop-start-btn">
                  {busy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start selling
                </button>
              </div>
            </LiveCard>
          ) : (
            <>
              {/* The pinned card — the overlay viewers see, in-World. */}
              <LiveCard isLight={isLight} testId="world-live-shop-pinned">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE
                  </span>
                  <span className={`text-sm font-bold ${strong}`}>{activeStream.title}</span>
                  <button type="button" onClick={endStream} disabled={busy !== null} className={`${redBtn} ml-auto`} data-testid="world-live-shop-end">
                    {busy === "end" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} End session
                  </button>
                </div>
                {pinned ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3" data-testid="world-live-shop-pinned-card">
                    {pinned.imageUrl ? (
                      <img src={pinned.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-bold ${strong}`}>{pinned.name}</p>
                      <p className="text-sm font-black text-[#d4af37]">{pinned.price}</p>
                    </div>
                    <button type="button" onClick={() => void buyPinned()} disabled={buying} className={goldBtn} data-testid="world-live-shop-buy">
                      {buying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />} Buy {pinned.price}
                    </button>
                  </div>
                ) : (
                  <p className={`mt-2 text-sm ${muted}`}>Nothing pinned yet — pin a product from your catalog below and it appears here, on your overlay, for every viewer.</p>
                )}
                {buySecret && (
                  <div className="mt-3 space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-live-shop-embedded-checkout">
                    <EmbeddedSessionCheckout clientSecret={buySecret} />
                    <button type="button" onClick={() => setBuySecret(null)} className={chipBtn(isLight)}>
                      Close — nothing is charged until you finish paying
                    </button>
                  </div>
                )}
              </LiveCard>

              {/* Pin / unpin — the catalog IS the pin list. */}
              <div>
                <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>Pin a product</p>
                {products.filter((p) => p.isActive).length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="Your catalog is empty" detail="Add a product below and it can be pinned to this session." />
                ) : (
                  <div className="mt-2 grid gap-2">
                    {products.filter((p) => p.isActive).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pinProduct(p)}
                        disabled={busy !== null}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-sm transition bdv-touch-target ${
                          activeStream.pinnedProductId === p.id
                            ? "border-[#d4af37] bg-[#d4af37]/15"
                            : isLight ? "border-[#C9A84C]/40 hover:border-[#C9A84C]" : "border-white/10 hover:border-[#d4af37]/50"
                        }`}
                        data-testid="world-live-shop-pin"
                      >
                        <span className="inline-flex min-w-0 items-center gap-2">
                          {activeStream.pinnedProductId === p.id ? <PinOff className="h-4 w-4 shrink-0 text-[#d4af37]" /> : <Pin className={`h-4 w-4 shrink-0 ${muted}`} />}
                          <span className={`truncate font-semibold ${strong}`}>{p.name}</span>
                        </span>
                        <span className="shrink-0 font-bold text-[#d4af37]">{p.price}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Purchase alerts — the feed + the page's test pair. */}
              <LiveCard isLight={isLight} testId="world-live-shop-alerts">
                <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
                  <Bell className="h-4 w-4 text-[#d4af37]" /> Purchase alerts
                </p>
                <div className="mt-2 space-y-1.5" data-testid="world-live-shop-alert-feed">
                  {alerts.length === 0 ? (
                    <p className={`text-sm ${muted}`}>No purchases yet this session — when a viewer buys, the alert lands here and pops on your overlay.</p>
                  ) : (
                    alerts.slice(0, 5).map((a) => (
                      <p key={a.id} className={`text-sm ${strong}`} data-testid="world-live-shop-alert-row">
                        <span className="font-bold text-[#b8912c]">Purchase</span>{" "}
                        {buildAlertText(a.buyerName, a.quantity, a.totalCents)}
                      </p>
                    ))
                  )}
                </div>
                <p className={`mt-3 text-xs ${muted}`}>Try the overlay: fire a test alert (it also records a test sale — labelled test on the dashboard, no money moves).</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    value={testBuyer}
                    onChange={(e) => setTestBuyer(e.target.value)}
                    placeholder="Test buyer name (optional)"
                    maxLength={80}
                    className={`${inputCls(isLight)} min-w-40 flex-1`}
                    data-testid="world-live-shop-test-buyer"
                    aria-label="Test buyer name"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {products.filter((p) => p.isActive).map((p) => (
                    <button key={p.id} type="button" onClick={() => fireTestAlert(p)} disabled={busy !== null} className={chipBtn(isLight)} data-testid="world-live-shop-test-alert">
                      <Bell className="h-3.5 w-3.5" /> {p.name} · Test
                    </button>
                  ))}
                </div>
              </LiveCard>
            </>
          )}

          {/* Add a product — the page's compact core (name + price). */}
          <LiveCard isLight={isLight} testId="world-live-shop-add">
            <p className={`text-sm font-bold ${strong}`}>Add a product</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Product name"
                maxLength={120}
                className={`${inputCls(isLight)} min-w-40 flex-1`}
                data-testid="world-live-shop-product-name"
                aria-label="Product name"
              />
              <input
                value={productPrice}
                onChange={(e) => setProductPrice(e.target.value)}
                placeholder="Price — 24.99"
                inputMode="decimal"
                className={`${inputCls(isLight)} w-32`}
                data-testid="world-live-shop-product-price"
                aria-label="Product price"
              />
              <button type="button" onClick={addProduct} disabled={busy !== null || !productReady} className={goldBtn} data-testid="world-live-shop-product-add">
                {busy === "add-product" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add product
              </button>
            </div>
            {products.length > 0 && (
              <p className={`mt-2 text-xs ${muted}`}>{products.length} in your catalog. This desk&rsquo;s add form carries the name + price core; photos, links and descriptions are not part of this stream-side desk.</p>
            )}
          </LiveCard>

          {/* Per-stream revenue — the dashboard rail. */}
          {dashboard && (
            <LiveCard isLight={isLight} testId="world-live-shop-revenue">
              <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
                <TrendingUp className="h-4 w-4 text-[#d4af37]" /> Revenue
                {dashboard.testData ? <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">Includes test sales</span> : null}
              </p>
              <p className={`mt-1 text-sm ${muted}`}>
                <b className={strong}>{dashboard.revenue}</b> total · {dashboard.paidSales} paid · {dashboard.testSales} test · platform fees {dashboard.platformFees} · your payout {dashboard.creatorPayout}
              </p>
              {dashboard.perStream.length > 0 ? (
                <ul className="mt-2 space-y-1.5" data-testid="world-live-shop-revenue-rows">
                  {dashboard.perStream.map((r) => (
                    <li key={r.streamId} className={`flex flex-wrap items-center justify-between gap-2 text-sm ${strong}`}>
                      <span className="min-w-0 truncate">{r.title}</span>
                      <span className={muted}>{r.sales} sales</span>
                      <span className="font-bold text-[#d4af37]">{r.revenue}</span>
                      <span className={muted}>fees {r.fees}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-1 text-sm ${muted}`}>No selling sessions yet — revenue per stream appears here after your first session.</p>
              )}
            </LiveCard>
          )}

          {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-shop-note">{note}</p>}
        </>
      )}
    </div>
  );
}
