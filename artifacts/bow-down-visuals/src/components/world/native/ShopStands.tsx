import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck, Check, Crown, Gem, Loader2, Minus, Plus, RefreshCw,
  ShoppingBag, ShoppingCart, Sparkles, Store, Trash2, Upload,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { PalaceStation } from "@/lib/world/stations";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { centsToDisplay, cartKey } from "@/lib/shops";
import {
  BRANDING_COLORS, BRANDING_DESIGN_COST, BRANDING_PRODUCTS, BRANDING_STYLES,
  MAX_DESIGN_PRODUCTS, formatMoney, productByKey,
  type BrandStyle, type ColorKey, type ProductKey,
} from "@/lib/branding-shop";
import {
  CHECKOUT_TRANSFER_LABEL, CONTACT_FOR_QUOTE_LABEL,
  activeMembershipTiers, addBrandingCartLine, addToCartLines,
  brandingCartTotalCents, brandingDesignComplete, brandingOrderPayload,
  brandingOrderStatusLabel, brandingShippingComplete, checkoutCompletedInWorld,
  detailedMarketCart, hostedCheckoutUrl, isQuoteOnly, marketCartCount, membershipDollars,
  marketCartTotalCents, marketOrderFromPayload, marketPendingKey, parseCreatorUserId,
  setBrandingCartQty, setCartLineQty,
  tierAnnualSavingLabel, tierOffersTrial, tierPriceLabel,
  type BillingPeriod, type BrandingCartLine, type BrandingDesignResult,
  type BrandingOrderDto, type BrandingShipping, type HubShopDto,
  type MarketOrder, type MembershipTierDto, type MyMembershipDto, type PublicProductDto,
  type PublicShopDto,
} from "@/lib/world/shop-stands";
import type { CartLine } from "@/lib/shops";

/* ─── ShopStands — the Shop Stand pattern (NATIVE-PLAN §3.3) ────────
   The palace's three buying surfaces, built for the room: goods on
   a stand, the cart in your hand, everything in-world — EXCEPT the
   one sanctioned transfer (§3.9): at the money moment the stand
   POSTs its checkout endpoint and opens the hosted payment page
   the server returns in a NEW TAB. The palace tab, the room and
   your place in it never move. The checkout action carries the
   uniform label for that moment: CHECKOUT_TRANSFER_LABEL.
   Prices are the real server charges end to end — payload prices
   (Marketplace, Crowns) and the shared client catalog (Branding)
   are displayed and charged from the same source. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

/** The one way a hosted payment page ever opens from a stand:
 *  a new tab, at the checkout moment, on the walker's click. */
function openCheckoutTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function goldBtn(disabled = false) {
  return `inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 ${disabled ? "opacity-50 hover:scale-100" : ""}`;
}
function chipBtn(isLight: boolean) {
  return `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
}
function inputCls(isLight: boolean) {
  return `w-full rounded-xl border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
      : "border-white/15 bg-black/50 text-white placeholder:text-white/30 focus:border-[#d4af37]/60"
  }`;
}
function muted(isLight: boolean) {
  return isLight ? "text-[#6B5B36]" : "text-white/50";
}
function StandTitle({ isLight, children }: { isLight: boolean; children: string }) {
  return (
    <p className={`px-1 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
      {children}
    </p>
  );
}

export interface ShopStandProps {
  station: PalaceStation;
  isLight: boolean;
  isGuest: boolean;
}

/** Dispatch for pattern "shop" — the host swaps this in for the
 *  placeholder on exactly the three shop stations. */
export function ShopStand({ station, isLight, isGuest }: ShopStandProps) {
  switch (station.id) {
    case "marketplace":
      return <MarketplaceStand isLight={isLight} isGuest={isGuest} />;
    case "branding-shop-desk":
      return <BrandingShopStand isLight={isLight} isGuest={isGuest} />;
    case "crowns-desk":
      return <CrownsStand isLight={isLight} isGuest={isGuest} />;
    default:
      return <MarketplaceStand isLight={isLight} isGuest={isGuest} />;
  }
}

/* ═══ 1. The Marketplace — shopfronts as stands ════════════════════ */

function MarketplaceStand({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const [shops, setShops] = useState<HubShopDto[] | null>(null);
  const [shopsFailed, setShopsFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const [openHandle, setOpenHandle] = useState<string | null>(null);
  const [shop, setShop] = useState<PublicShopDto | null>(null);
  const [products, setProducts] = useState<PublicProductDto[]>([]);
  const [feePct, setFeePct] = useState(10);
  const [standState, setStandState] = useState<"idle" | "loading" | "ready" | "failed">("idle");

  const [cart, setCart] = useState<CartLine[]>([]);
  const cartLoadedFor = useRef<string | null>(null);
  const [buyerEmail, setBuyerEmail] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  /* The confirmed (PAID) order — the reward moment, rendered only
     from server truth via marketOrderFromPayload. A pending order is
     a note + a refresh door, never this block. */
  const [paidOrder, setPaidOrder] = useState<MarketOrder | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [refreshingOrder, setRefreshingOrder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/storefronts?limit=60");
        if (!res.ok) throw new Error("shops");
        const data = (await res.json()) as { shops?: HubShopDto[] };
        if (!cancelled) {
          setShops(Array.isArray(data.shops) ? data.shops : []);
          setShopsFailed(false);
        }
      } catch {
        if (!cancelled) setShopsFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const openStand = async (handle: string) => {
    setOpenHandle(handle);
    setStandState("loading");
    setShop(null);
    setProducts([]);
    setPaidOrder(null);
    setPendingNote(null);
    setOrderError(null);
    try {
      const res = await fetch(`/api/storefronts/slug/${encodeURIComponent(handle)}`);
      if (!res.ok) throw new Error("stand");
      const data = (await res.json()) as { shop?: PublicShopDto; products?: PublicProductDto[]; platformFeePct?: number };
      if (!data.shop) throw new Error("stand");
      setShop(data.shop);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setFeePct(data.platformFeePct ?? 5);
      setStandState("ready");
      /* An unfinished checkout from an earlier visit refreshes from
         server truth the moment the stand reopens. */
      void refreshOrder(handle);
    } catch {
      setStandState("failed");
    }
  };

  /* Refresh an order from SERVER truth (POST verify retrieves the
     session and flips the order only when Stripe says paid). Paid →
     the reward moment + the cart clears; still pending → an honest
     pending note; expired → the note says so and the marker drops. */
  const refreshOrder = async (handle: string) => {
    let sessionId: string | null = null;
    try { sessionId = localStorage.getItem(marketPendingKey(handle)); } catch { /* storage blocked */ }
    if (!sessionId || refreshingOrder) return;
    setRefreshingOrder(true);
    try {
      const res = await fetch("/api/storefronts/checkout/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error("verify");
      const order = marketOrderFromPayload(data["order"] ?? data);
      if (order?.paid) {
        setPaidOrder(order);
        setPendingNote(null);
        setCart([]);
        try { localStorage.removeItem(marketPendingKey(handle)); } catch { /* ignore */ }
      } else if (order?.status === "expired") {
        setPendingNote("That checkout expired before payment — the order was never charged. Your cart is still here whenever you're ready.");
        try { localStorage.removeItem(marketPendingKey(handle)); } catch { /* ignore */ }
      } else {
        setPendingNote("Your order is saved as pending — payment hasn't confirmed yet. Finish at the hosted checkout, then check again here.");
      }
    } catch {
      setPendingNote("Your order is saved as pending — its status couldn't be refreshed just now. Nothing about it was changed.");
    } finally {
      setRefreshingOrder(false);
    }
  };

  /* Coming back from the hosted checkout tab: refresh the pending
     order in-world when the palace tab takes focus again. */
  useEffect(() => {
    if (!openHandle) return;
    const onFocus = () => void refreshOrder(openHandle);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openHandle]);

  /* The cart is the shop page's own: local lines, persisted per
     shop handle under the same localStorage key the page uses. */
  useEffect(() => {
    if (!openHandle) return;
    cartLoadedFor.current = null;
    try {
      const raw = localStorage.getItem(cartKey(openHandle));
      const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
      setCart(Array.isArray(parsed) ? parsed.filter((l) => l && typeof l.productId === "string") : []);
    } catch {
      setCart([]);
    }
    cartLoadedFor.current = openHandle;
  }, [openHandle ]);

  useEffect(() => {
    if (!openHandle || cartLoadedFor.current !== openHandle) return;
    try {
      localStorage.setItem(cartKey(openHandle), JSON.stringify(cart));
    } catch { /* storage blocked — the cart just won't persist */ }
  }, [cart, openHandle]);

  const detailed = useMemo(() => detailedMarketCart(cart, products), [cart, products]);
  const total = marketCartTotalCents(detailed);
  const count = marketCartCount(detailed);

  /* Checkout — the marked transfer (§3.9). ONE POST for the whole
     cart: the server records the order as PENDING, prices it from
     its own product rows, and answers the hosted payment URL, which
     opens in a NEW TAB. The order is not a sale yet — the cart stays
     put until the payment confirms (refreshOrder, on focus/reopen),
     and only a server-confirmed paid order renders as paid. A free
     cart completes in-world (checkoutCompletedInWorld) with the
     paid confirmation straight away. Session-creation failure is an
     honest error with the cart untouched. */
  const checkout = async () => {
    if (!shop || detailed.length === 0 || placing) return;
    setPlacing(true);
    setOrderError(null);
    setPendingNote(null);
    try {
      const res = await fetch("/api/storefronts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: shop.id,
          items: detailed.map((l) => ({ productId: l.productId, quantity: l.qty })),
          buyerEmail: buyerEmail.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Checkout didn't start — nothing was charged.");
      if (checkoutCompletedInWorld(data)) {
        const order = marketOrderFromPayload(data);
        if (order?.paid) setPaidOrder(order);
        setCart([]);
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        if (typeof data.sessionId === "string" && openHandle) {
          try { localStorage.setItem(marketPendingKey(openHandle), data.sessionId); } catch { /* storage blocked — refresh on reopen just won't find it */ }
        }
        openCheckoutTab(url);
        setPendingNote("Your checkout opened in a new tab — finish paying there. This stand keeps your place and your cart, and confirms the order here when the payment lands.");
        return;
      }
      throw new Error("Checkout didn't return a payment page — nothing was charged.");
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : "Checkout didn't start — nothing was charged, and your cart is untouched.");
    } finally {
      setPlacing(false);
    }
  };

  if (openHandle) {
    return (
      <div className="space-y-3" data-testid="world-shop-marketplace-stand">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setOpenHandle(null)} className={chipBtn(isLight)}>
            ← All stands
          </button>
          {shop && (
            <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{shop.name}</span>
          )}
          {shop?.tagline && <span className={`text-xs ${muted(isLight)}`}>{shop.tagline}</span>}
          {count > 0 && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1 text-xs font-black text-black">
              <ShoppingBag className="h-3.5 w-3.5" /> {count} in your cart · {centsToDisplay(total)}
            </span>
          )}
        </div>

        {standState === "loading" && <NativeLoadingState isLight={isLight} message="Setting up the stand…" />}
        {standState === "failed" && (
          <NativeErrorState
            isLight={isLight}
            title="This stand wouldn't open"
            message="The shop itself is fine — its goods couldn't be brought to the square. Try the stand again."
            onRetry={() => void openStand(openHandle)}
          />
        )}
        {standState === "ready" && products.length === 0 && (
          <NativeEmptyState isLight={isLight} message="This stand is bare right now — the creator hasn't stocked it yet." />
        )}
        {standState === "ready" && products.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <NativeCard key={p.id} isLight={isLight}>
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="mb-2 h-28 w-full rounded-xl object-cover" />
                ) : null}
                <p className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.name}</p>
                {p.description && <p className={`mt-0.5 line-clamp-2 text-xs ${muted(isLight)}`}>{p.description}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(p.price_cents)}</span>
                  <button
                    type="button"
                    data-testid="world-shop-add-to-cart"
                    onClick={() => setCart((c) => addToCartLines(c, p.id))}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add to cart
                  </button>
                </div>
              </NativeCard>
            ))}
          </div>
        )}

        {standState === "ready" && (detailed.length > 0 || paidOrder || pendingNote) && (
          <NativeCard isLight={isLight} title={`Your cart${count > 0 ? ` (${count})` : ""}`}>
            {detailed.map((l) => (
              <div key={l.productId} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{l.product.name}</span>
                <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(l.product.price_cents * l.qty)}</span>
                <span className="inline-flex items-center gap-1.5">
                  <button type="button" aria-label="One less" onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty - 1))} className={chipBtn(isLight)}><Minus className="h-3 w-3" /></button>
                  <span className="w-5 text-center text-sm font-bold">{l.qty}</span>
                  <button type="button" aria-label="One more" onClick={() => setCart((c) => setCartLineQty(c, l.productId, l.qty + 1))} className={chipBtn(isLight)}><Plus className="h-3 w-3" /></button>
                  <button type="button" aria-label="Remove from cart" onClick={() => setCart((c) => setCartLineQty(c, l.productId, 0))} className={chipBtn(isLight)}><Trash2 className="h-3 w-3" /></button>
                </span>
              </div>
            ))}
            {detailed.length > 0 && !paidOrder && (
              <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className={muted(isLight)}>Total</span>
                  <span className="text-lg font-black">{centsToDisplay(total)}</span>
                </div>
                <input
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  type="email"
                  placeholder="Email for your receipt (optional)"
                  className={inputCls(isLight)}
                />
                {orderError && <p className="text-xs font-semibold text-red-400">{orderError}</p>}
                {/* The ONE marked door out of this stand: payment. */}
                <button type="button" data-testid="world-shop-checkout" onClick={() => void checkout()} disabled={placing} className={`${goldBtn(placing)} w-full`}>
                  {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                  {CHECKOUT_TRANSFER_LABEL} · {centsToDisplay(total)}
                </button>
                <p className={`text-[11px] ${muted(isLight)}`}>
                  Sellers keep {100 - feePct}% — the {feePct}% platform fee comes out of the seller&rsquo;s cut, never on top of your price.
                </p>
              </div>
            )}
            {pendingNote && !paidOrder && (
              <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-shop-pending-order">
                <p className="flex items-start gap-2 text-xs font-semibold text-amber-300">
                  <Loader2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${refreshingOrder ? "animate-spin" : ""}`} />
                  <span>{pendingNote}</span>
                </p>
                <p className={`text-[11px] ${muted(isLight)}`}>
                  This order is pending — it is not paid yet, and it will never be shown as paid until the payment confirms.
                </p>
                <button type="button" data-testid="world-shop-refresh-order" onClick={() => openHandle && void refreshOrder(openHandle)} disabled={refreshingOrder} className={`${chipBtn(isLight)}`}>
                  <RefreshCw className="h-3 w-3" /> Check payment status
                </button>
              </div>
            )}
            {paidOrder && (
              /* The reward moment: the acquired items, named proudly
                 from the server's own confirmed order — never from a
                 local guess. */
              <div className="py-2 text-center" data-testid="world-shop-paid-confirmation">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#d4af37]/20 ring-2 ring-[#d4af37]/60">
                  <Sparkles className="h-6 w-6 text-[#d4af37]" />
                </span>
                <p className={`mt-2 text-base font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  It&rsquo;s yours — payment confirmed
                </p>
                <div className="mx-auto mt-2 max-w-sm space-y-1">
                  {paidOrder.lines.map((l) => (
                    <p key={l.saleId} className="flex items-center justify-center gap-1.5 text-sm font-bold">
                      <BadgeCheck className="h-4 w-4 shrink-0 text-emerald-300" />
                      <span className={isLight ? "text-[#2a1e07]" : "text-white"}>
                        {l.quantity > 1 ? `${l.quantity} × ` : ""}{l.productName ?? "Your item"}
                      </span>
                      <span className="text-[#d4af37]">{centsToDisplay(l.gross_cents)}</span>
                    </p>
                  ))}
                </div>
                <p className={`mt-2 text-xs ${muted(isLight)}`}>
                  Paid {centsToDisplay(paidOrder.gross_cents)} · platform fee ({feePct}%) {centsToDisplay(paidOrder.platform_fee_cents)} · the seller receives {centsToDisplay(paidOrder.seller_net_cents)} — their win lands in their sales the moment this confirmed.
                </p>
                <button type="button" onClick={() => setPaidOrder(null)} className={`${chipBtn(isLight)} mt-2`}>Keep browsing</button>
              </div>
            )}
          </NativeCard>
        )}
        {isGuest && (
          <p className={`px-1 text-[11px] ${muted(isLight)}`}>Browsing the square is open to everyone — no account needed. Buying opens the hosted payment page in a new tab at the money moment, and the stand confirms your order here once the payment lands.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="world-shop-marketplace">
      <StandTitle isLight={isLight}>Shopfronts on the square</StandTitle>
      {shopsFailed ? (
        <NativeErrorState isLight={isLight} title="The square wouldn't load" message="The marketplace stalls are fine — the square couldn't be reached. Try again." onRetry={() => setTick((n) => n + 1)} />
      ) : shops === null ? (
        <NativeLoadingState isLight={isLight} message="Walking the square…" />
      ) : shops.length === 0 ? (
        <NativeEmptyState isLight={isLight} message="No shopfronts are open on the square yet." detail="When creators open shops, their stands appear here." />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shops.map((s) => (
            <NativeCard key={s.id} isLight={isLight}>
              <p className={`flex items-center gap-2 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                <Store className="h-4 w-4 shrink-0 text-[#d4af37]" /> {s.name}
              </p>
              {s.tagline && <p className={`mt-0.5 line-clamp-2 text-xs ${muted(isLight)}`}>{s.tagline}</p>}
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-xs font-semibold ${muted(isLight)}`}>
                  {s.product_count} {s.product_count === 1 ? "product" : "products"}
                </span>
                <button type="button" data-testid="world-shop-open-stand" onClick={() => void openStand(s.handle)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105">
                  Visit the stand
                </button>
              </div>
            </NativeCard>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ 2. The Branding Shop — the same stand, over the catalog ══════ */

function BrandingShopStand({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const [sel, setSel] = useState<Record<ProductKey, { color: ColorKey; size: string; qty: number }>>(() =>
    Object.fromEntries(
      BRANDING_PRODUCTS.map((p) => [p.key, { color: "black" as ColorKey, size: p.sizes[0]!, qty: 1 }]),
    ) as Record<ProductKey, { color: ColorKey; size: string; qty: number }>,
  );
  const [cart, setCart] = useState<BrandingCartLine[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Rug logo upload — required before a rug can be carted. */
  const [rugLogo, setRugLogo] = useState<{ url: string; fileName: string } | null>(null);
  const [rugUploading, setRugUploading] = useState(false);

  /* The design desk. */
  const [brandName, setBrandName] = useState("");
  const [niche, setNiche] = useState("");
  const [style, setStyle] = useState<BrandStyle>("luxury-gold");
  const [designProducts, setDesignProducts] = useState<ProductKey[]>([]);
  const [designing, setDesigning] = useState(false);
  const [design, setDesign] = useState<BrandingDesignResult | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* Shipping + orders. */
  const [shipping, setShipping] = useState<BrandingShipping>({ name: "", email: "", address: "", city: "", state: "", zip: "" });
  const [placing, setPlacing] = useState(false);
  const [orders, setOrders] = useState<BrandingOrderDto[] | null>(null);
  const [ordersFailed, setOrdersFailed] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const cartTotal = brandingCartTotalCents(cart);
  const cartCount = cart.reduce((n, i) => n + i.qty, 0);

  const loadOrders = async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/branding-shop/orders", { headers: await authHeaders() });
      if (!res.ok) throw new Error("orders");
      const data = (await res.json()) as { orders?: BrandingOrderDto[]; demo?: boolean };
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setDemoMode(data.demo === true);
      setOrdersFailed(false);
    } catch {
      setOrdersFailed(true);
    }
  };
  useEffect(() => {
    void loadOrders();
    // Returning from the hosted checkout tab: refresh the orders
    // in-world when the palace tab takes focus again (§3.3).
    const onFocus = () => void loadOrders();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const membersOnlyNote = () => {
    setError("This stand's till works with your account — sign in on the website (the footer below) and come back through the same door.");
  };

  const addToCart = (key: ProductKey) => {
    if (isQuoteOnly(key)) return;
    if (key === "rug" && !rugLogo) {
      setError("The rug needs your logo first — upload it on the rug's card.");
      return;
    }
    const s = sel[key];
    setCart((prev) =>
      addBrandingCartLine(prev, {
        product: key, color: s.color, size: s.size, qty: s.qty,
        ...(key === "rug" && rugLogo ? { logoUrl: rugLogo.url } : {}),
      }),
    );
    setError(null);
    setNote(`${productByKey(key).label} added to your cart.`);
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (isGuest) { membersOnlyNote(); return; }
    if (!file.type.startsWith("image/")) { setError("Please upload an image file (PNG, JPG)."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("That image is over 10MB — a smaller logo file will print cleaner anyway."); return; }
    setRugUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/branding-shop/upload-logo", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed.");
      setRugLogo({ url: data.url, fileName: file.name });
      setNote("Logo's on the rug — add it to your cart when you're ready.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setRugUploading(false);
    }
  };

  const runDesign = async () => {
    if (isGuest) { membersOnlyNote(); return; }
    const form = { brandName, niche, style, products: designProducts };
    if (!brandingDesignComplete(form)) {
      setError("The design desk needs a brand name, your niche, and at least one product to mock up.");
      return;
    }
    setDesigning(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await fetch("/api/branding-shop/design", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as BrandingDesignResult & { error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || !data.logo?.url) throw new Error(data.message ?? data.error ?? "The design didn't come back.");
      setDesign(data);
      setNote(`Your brand kit is designed — ${BRANDING_DESIGN_COST.toLocaleString("en-US")} Visual Bucs, and the logo and mockups are yours.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The design studio hiccupped — if Visual Bucs were charged, they're refunded.");
    } finally {
      setDesigning(false);
    }
  };

  /* Checkout — the marked transfer (§3.9): place the order
     in-world first (intake is free; the server recomputes the
     total), then POST checkout and open the hosted payment page
     it returns in a NEW TAB. Demo mode (no payment key on the
     server) completes in-world instead, clearly labelled. */
  const checkout = async () => {
    if (isGuest) { membersOnlyNote(); return; }
    if (cart.length === 0 || placing) return;
    if (!brandingShippingComplete(shipping)) {
      setError("The stand needs your full shipping details before it can place the order.");
      return;
    }
    setPlacing(true);
    setError(null);
    setNote(null);
    try {
      const orderRes = await fetch("/api/branding-shop/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(brandingOrderPayload(cart, shipping)),
      });
      const orderData = (await orderRes.json().catch(() => ({}))) as { order?: { id: string }; error?: string; message?: string };
      if (!orderRes.ok || !orderData.order?.id) {
        throw new Error(orderData.message ?? orderData.error ?? "The order couldn't be placed.");
      }
      const orderId = orderData.order.id;
      const coRes = await fetch("/api/branding-shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ orderId }),
      });
      const coData = (await coRes.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!coRes.ok) {
        setNote("Your order is saved at this stand (see Your orders below) — paying for it didn't start, so nothing was charged. Use Pay on the order when you're ready.");
        void loadOrders();
        return;
      }
      const url = hostedCheckoutUrl(coData);
      if (url) {
        openCheckoutTab(url);
        setCart([]);
        setNote("Checkout opened in a new tab — finish paying there. When you come back, this stand refreshes your orders on its own.");
        void loadOrders();
        return;
      }
      if (checkoutCompletedInWorld(coData)) {
        setCart([]);
        setNote(coData.message ?? "Order received — demo checkout completed here, no real payment was taken.");
        void loadOrders();
        return;
      }
      setNote("Order placed at this stand — see Your orders below.");
      setCart([]);
      void loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The order couldn't be placed — your cart is untouched.");
    } finally {
      setPlacing(false);
    }
  };

  const payForOrder = async (orderId: string) => {
    if (payingId) return;
    setPayingId(orderId);
    setError(null);
    try {
      const res = await fetch("/api/branding-shop/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Checkout didn't start.");
      const url = hostedCheckoutUrl(data);
      if (url) {
        openCheckoutTab(url);
        setNote("Checkout opened in a new tab — finish paying there; this stand refreshes your orders when you're back.");
        return;
      }
      setNote(data.message ?? "That order is settled.");
      void loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout didn't start — nothing was charged.");
    } finally {
      setPayingId(null);
    }
  };

  const refreshOrder = async (orderId: string) => {
    if (refreshingId) return;
    setRefreshingId(orderId);
    try {
      const res = await fetch(`/api/branding-shop/orders/${encodeURIComponent(orderId)}/refresh`, {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("refresh");
      void loadOrders();
    } catch {
      setError("That order's status wouldn't refresh — it's unchanged. Try again in a moment.");
    } finally {
      setRefreshingId(null);
    }
  };

  const shipField = (key: keyof BrandingShipping, placeholder: string) => (
    <input
      value={shipping[key]}
      onChange={(e) => setShipping((s) => ({ ...s, [key]: e.target.value }))}
      placeholder={placeholder}
      className={inputCls(isLight)}
    />
  );

  return (
    <div className="space-y-4" data-testid="world-shop-branding">
      {isGuest && (
        <p className={`px-1 text-xs ${muted(isLight)}`}>
          The catalog is open to everyone. Designing, ordering and paying ride your account — sign in on the website and come back through this door.
        </p>
      )}
      {error && <p className="px-1 text-xs font-semibold text-red-400">{error}</p>}
      {note && <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
      {outOfCredits && (
        <p className="px-1 text-xs font-semibold text-red-400">
          You&rsquo;re out of Visual Bucs — the design desk needs {BRANDING_DESIGN_COST.toLocaleString("en-US")} VB. Top up and the desk is yours again.
        </p>
      )}

      <div className="space-y-2">
        <StandTitle isLight={isLight}>The goods</StandTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BRANDING_PRODUCTS.map((p) => {
            const s = sel[p.key];
            return (
              <NativeCard key={p.key} isLight={isLight}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.label}</p>
                    <p className={`mt-0.5 line-clamp-2 text-xs ${muted(isLight)}`}>{p.blurb}</p>
                  </div>
                  <span className="ml-auto shrink-0 text-sm font-black text-[#d4af37]">{formatMoney(p.priceCents)}</span>
                </div>
                {!p.quoteOnly && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`text-[11px] font-semibold ${muted(isLight)}`}>Color</span>
                      {BRANDING_COLORS.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], color: c.key } }))}
                          className={`${chipBtn(isLight)} ${s.color === c.key ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`text-[11px] font-semibold ${muted(isLight)}`}>Size</span>
                      {p.sizes.map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={() => setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], size: sz } }))}
                          className={`${chipBtn(isLight)} ${s.size === sz ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                    {p.key === "rug" && (
                      <div className="mt-2">
                        {rugLogo ? (
                          <p className="flex items-center gap-2 text-xs font-semibold">
                            <img src={rugLogo.url} alt="" className="h-8 w-8 rounded object-contain" />
                            <span className="min-w-0 flex-1 truncate">{rugLogo.fileName} — logo ready</span>
                            <button type="button" onClick={() => setRugLogo(null)} className={chipBtn(isLight)}>Change</button>
                          </p>
                        ) : (
                          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-[#d4af37]/50 px-3 py-2 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                            <Upload className="h-3.5 w-3.5" />
                            {rugUploading ? "Uploading your logo…" : "Upload your logo for the rug"}
                            <input type="file" accept="image/*" className="hidden" disabled={rugUploading} onChange={(e) => void uploadLogo(e.target.files?.[0])} />
                          </label>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      data-testid="world-branding-add-to-cart"
                      onClick={() => addToCart(p.key)}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                    >
                      <ShoppingCart className="h-3.5 w-3.5" /> Add to cart
                    </button>
                  </>
                )}
                {p.quoteOnly && (
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-3 py-1.5 text-xs font-bold text-[#e8c86a]" data-testid="world-branding-quote-only">
                    <Gem className="h-3.5 w-3.5" /> {CONTACT_FOR_QUOTE_LABEL}
                  </p>
                )}
              </NativeCard>
            );
          })}
        </div>
      </div>

      {/* The design desk — in-world, priced in Visual Bucs up front. */}
      <NativeCard isLight={isLight} title={`Design my brand kit — ${BRANDING_DESIGN_COST.toLocaleString("en-US")} Visual Bucs`}>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Brand name" maxLength={80} className={inputCls(isLight)} />
          <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Your niche (e.g. indie rap, gaming)" maxLength={120} className={inputCls(isLight)} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BRANDING_STYLES.map((st) => (
            <button
              key={st.key}
              type="button"
              onClick={() => setStyle(st.key)}
              title={st.blurb}
              className={`${chipBtn(isLight)} ${style === st.key ? "border-[#d4af37] text-[#d4af37]" : ""}`}
            >
              {st.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BRANDING_PRODUCTS.filter((p) => !p.quoteOnly).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() =>
                setDesignProducts((prev) =>
                  prev.includes(p.key) ? prev.filter((x) => x !== p.key) : prev.length >= MAX_DESIGN_PRODUCTS ? prev : [...prev, p.key],
                )
              }
              className={`${chipBtn(isLight)} ${designProducts.includes(p.key) ? "border-[#d4af37] text-[#d4af37]" : ""}`}
            >
              {p.label}
            </button>
          ))}
          <span className={`self-center text-[11px] ${muted(isLight)}`}>Mockups: pick up to {MAX_DESIGN_PRODUCTS}</span>
        </div>
        <button type="button" data-testid="world-branding-design" onClick={() => void runDesign()} disabled={designing} className={`${goldBtn(designing)} mt-3`}>
          {designing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {designing ? "Designing your kit…" : `Design it — ${BRANDING_DESIGN_COST.toLocaleString("en-US")} Visual Bucs`}
        </button>
        <p className={`mt-1.5 text-[11px] ${muted(isLight)}`}>Charged only for a kit you get — if the design fails, the Visual Bucs are refunded.</p>
        {design && (
          <div className="mt-3 space-y-2" data-testid="world-branding-design-result">
            <div className="flex flex-wrap items-center gap-3">
              <img src={design.logo.url} alt="Your designed logo" className="h-20 w-20 rounded-2xl border border-[#d4af37]/40 object-cover" />
              <div>
                {design.brief.tagline && <p className="text-sm font-bold text-[#d4af37]">&ldquo;{design.brief.tagline}&rdquo;</p>}
                {design.brief.palette.length > 0 && (
                  <span className="mt-1 flex gap-1.5">
                    {design.brief.palette.map((c) => (
                      <span key={c} title={c} className="h-6 w-6 rounded-full border border-white/20" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {design.mockups.map((m) => (
                <span key={m.product} className="inline-flex flex-col items-center gap-1">
                  <img src={m.url} alt={productByKey(m.product).label} className="h-16 w-16 rounded-xl object-cover" />
                  <span className={`text-[11px] font-semibold ${muted(isLight)}`}>{productByKey(m.product).label}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </NativeCard>

      {/* The cart — in your hand, in-world. */}
      <NativeCard isLight={isLight} title={`Your cart${cartCount > 0 ? ` (${cartCount})` : ""}`}>
        {cart.length === 0 ? (
          <NativeEmptyState isLight={isLight} message="Your cart is empty — the goods above are the stand's whole shelf." />
        ) : (
          <div className="space-y-2">
            {cart.map((item, idx) => {
              const p = productByKey(item.product);
              return (
                <div key={`${item.product}-${item.color}-${item.size}-${idx}`} className="flex flex-wrap items-center gap-2">
                  <span className={`min-w-0 flex-1 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    {p.label} <span className={`font-semibold capitalize ${muted(isLight)}`}>· {item.color} · {item.size}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <button type="button" aria-label="One less" onClick={() => setCart((c) => setBrandingCartQty(c, idx, item.qty - 1))} className={chipBtn(isLight)}><Minus className="h-3 w-3" /></button>
                    <span className="w-5 text-center text-sm font-bold">{item.qty}</span>
                    <button type="button" aria-label="One more" onClick={() => setCart((c) => setBrandingCartQty(c, idx, item.qty + 1))} className={chipBtn(isLight)}><Plus className="h-3 w-3" /></button>
                    <button type="button" aria-label="Remove from cart" onClick={() => setCart((c) => setBrandingCartQty(c, idx, 0))} className={chipBtn(isLight)}><Trash2 className="h-3 w-3" /></button>
                  </span>
                  <span className="text-sm font-black text-[#d4af37]">{formatMoney(p.priceCents * item.qty)}</span>
                </div>
              );
            })}
            <div className="space-y-2 border-t border-[#d4af37]/25 pt-3">
              <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Shipping</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {shipField("name", "Full name")}
                {shipField("email", "Email")}
              </div>
              {shipField("address", "Street address")}
              <div className="grid grid-cols-3 gap-2">
                {shipField("city", "City")}
                {shipField("state", "State")}
                {shipField("zip", "ZIP")}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={muted(isLight)}>Total</span>
                <span className="text-lg font-black">{formatMoney(cartTotal)}</span>
              </div>
              {/* The ONE marked door out of this stand: payment. */}
              <button type="button" data-testid="world-branding-checkout" onClick={() => void checkout()} disabled={placing} className={`${goldBtn(placing)} w-full`}>
                {placing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                {CHECKOUT_TRANSFER_LABEL} · {formatMoney(cartTotal)}
              </button>
              <p className={`text-[11px] ${muted(isLight)}`}>
                The order is placed here at the stand first; payment itself finishes on the payment provider&rsquo;s hosted page, in a new tab.
              </p>
            </div>
          </div>
        )}
      </NativeCard>

      {/* Your orders — status rows, refreshed in-world. */}
      {!isGuest && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <StandTitle isLight={isLight}>Your orders</StandTitle>
            <button type="button" onClick={() => void loadOrders()} className={`${chipBtn(isLight)} ml-auto`}>
              <RefreshCw className="h-3 w-3" /> Refresh orders
            </button>
          </div>
          {demoMode && orders && orders.length > 0 && (
            <p className={`px-1 text-[11px] ${muted(isLight)}`}>Demo fulfillment is simulating the dropship flow right now — statuses below are the sandbox&rsquo;s, honestly labelled.</p>
          )}
          {ordersFailed ? (
            <NativeErrorState isLight={isLight} title="Your orders wouldn't load" message="Your orders are safe on the real rails — the stand couldn't read them. Try again." onRetry={() => void loadOrders()} />
          ) : orders === null ? (
            <NativeLoadingState isLight={isLight} message="Reading your orders…" />
          ) : orders.length === 0 ? (
            <NativeEmptyState isLight={isLight} message="No orders yet — when you buy at this stand, each order's status lives here." />
          ) : (
            orders.map((o) => (
              <div
                key={o.id}
                data-testid="world-branding-order-row"
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
              >
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    #{o.id.slice(0, 8)} · {o.items.reduce((n, i) => n + i.qty, 0)} {o.items.reduce((n, i) => n + i.qty, 0) === 1 ? "item" : "items"}
                  </span>
                  <span className={`block truncate text-xs ${muted(isLight)}`}>
                    {o.items.map((i) => `${i.qty}× ${productByKey(i.product).label}`).join(", ")}
                    {o.trackingNumber ? ` · tracking ${o.trackingNumber}` : ""}
                  </span>
                </span>
                <span className={`ml-auto inline-flex items-center gap-2 text-xs font-semibold ${muted(isLight)}`}>
                  {brandingOrderStatusLabel(o.status)} · {formatMoney(o.totalCents)}
                </span>
                {o.paid ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    <BadgeCheck className="h-3 w-3" /> Paid
                  </span>
                ) : (
                  <button type="button" onClick={() => void payForOrder(o.id)} disabled={payingId === o.id} className={chipBtn(isLight)}>
                    {payingId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Pay {formatMoney(o.totalCents)}
                  </button>
                )}
                {o.providerOrderId && (
                  <button type="button" onClick={() => void refreshOrder(o.id)} disabled={refreshingId === o.id} className={chipBtn(isLight)}>
                    {refreshingId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Status
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ═══ 3. Crowns & Memberships — tiers as crown cards ═══════════════ */

function CrownsStand({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const [creatorInput, setCreatorInput] = useState("");
  const [creatorId, setCreatorId] = useState<string | null>(null);
  const [tiers, setTiers] = useState<MembershipTierDto[] | null>(null);
  const [tiersFailed, setTiersFailed] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [mine, setMine] = useState<MyMembershipDto[] | null>(null);

  const loadMine = async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/memberships/mine", { headers: await authHeaders() });
      if (!res.ok) return;
      const data = (await res.json()) as { memberships?: MyMembershipDto[] };
      setMine(Array.isArray(data.memberships) ? data.memberships : []);
    } catch { /* the fan section is additive — a quiet stand is fine */ }
  };
  useEffect(() => {
    void loadMine();
    // Coming back from the hosted checkout tab: your memberships
    // refresh in-world when the palace tab takes focus again.
    const onFocus = () => void loadMine();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const loadClub = async (id: string) => {
    setCreatorId(id);
    setTiers(null);
    setTiersFailed(false);
    setMsg(null);
    try {
      const res = await fetch(`/api/memberships/public/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("club");
      const data = (await res.json()) as { tiers?: MembershipTierDto[]; testMode?: boolean };
      if (!Array.isArray(data.tiers)) throw new Error("club");
      setTiers(data.tiers);
      setTestMode(data.testMode === true);
    } catch {
      setTiersFailed(true);
    }
  };

  const submitCreator = () => {
    const id = parseCreatorUserId(creatorInput);
    if (!id) {
      setMsg("That doesn't carry a creator's join ID — paste the creator's user ID, or their whole join link (/memberships?creator=…).");
      return;
    }
    void loadClub(id);
  };

  /* Joining: the trial happens right here at the stand; a paid
     join rides the checkout transfer — POST checkout, then the
     hosted page it returns opens in a NEW TAB (§3.9). A free tier
     activates in-world with no payment page at all. Guests get
     the pitch, never a dead button: joining rides an account, and
     sign-in lives on the website by design. */
  const join = async (tier: MembershipTierDto, mode: "checkout" | "trial") => {
    if (isGuest) {
      setMsg("Joining a fan club rides your account — sign in on the website (the footer below) and come back through this door; the crowns will be waiting.");
      return;
    }
    setBusy(tier.id + mode);
    setMsg(null);
    try {
      if (mode === "trial") {
        const res = await fetch("/api/memberships/join-trial", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify({ tierId: tier.id }),
        });
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        if (!res.ok) throw new Error(data.message ?? data.error ?? "Couldn't start the trial.");
        setMsg("Your 7-day free trial is on — no charge today. Join with a paid plan before it ends to keep your seat.");
        void loadMine();
        return;
      }
      const res = await fetch("/api/memberships/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ tierId: tier.id, billingPeriod: period }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Couldn't start checkout.");
      if (checkoutCompletedInWorld(data)) {
        setMsg("You're in — your membership is active, right here at the stand.");
        void loadMine();
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        openCheckoutTab(url);
        setMsg("Checkout opened in a new tab — finish paying there. Your membership activates when the payment confirms, and this stand refreshes your crowns when you're back.");
        return;
      }
      throw new Error("Couldn't start checkout.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong at the stand. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const active = tiers ? activeMembershipTiers(tiers) : [];

  return (
    <div className="space-y-4" data-testid="world-shop-crowns">
      {!isGuest && mine && mine.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <StandTitle isLight={isLight}>Crowns you hold</StandTitle>
            <button type="button" onClick={() => void loadMine()} className={`${chipBtn(isLight)} ml-auto`}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
          {mine.map((m) => (
            <div
              key={m.id}
              data-testid="world-crowns-mine-row"
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
            >
              <Crown className="h-4 w-4 text-[#d4af37]" />
              <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                {m.tierName ?? "Membership"}{m.isGift ? " · gifted to you" : ""}
              </span>
              <span className={`text-xs ${muted(isLight)}`}>
                {membershipDollars(m.priceDollars)} · {m.billingPeriod}
                {m.status === "trialing" && m.trialEndsAt ? ` · trial ends ${new Date(m.trialEndsAt).toLocaleDateString()}` : ""}
                {m.status !== "trialing" && m.currentPeriodEnd ? ` · ${m.status === "expired" ? "ended" : "renews"} ${new Date(m.currentPeriodEnd).toLocaleDateString()}` : ""}
              </span>
              <span className="ml-auto rounded-full border border-[#d4af37]/40 bg-[#d4af37]/10 px-2.5 py-0.5 text-[11px] font-bold capitalize text-[#e8c86a]">{m.status.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      )}

      <NativeCard isLight={isLight} title="Join a fan club">
        <p className={`text-xs ${muted(isLight)}`}>
          Every creator&rsquo;s club has a join ID — it&rsquo;s the tail of the link they share
          (<span className="font-mono">/memberships?creator=…</span>). Paste the ID or the whole link and their crowns appear here.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={creatorInput}
            onChange={(e) => setCreatorInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitCreator(); }}
            placeholder="Creator's join ID or link"
            className={`${inputCls(isLight)} min-w-0 flex-1`}
          />
          <button type="button" onClick={submitCreator} className={goldBtn()}>
            <Crown className="h-4 w-4" /> Show the crowns
          </button>
        </div>
        {msg && <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{msg}</p>}
      </NativeCard>

      {creatorId && (
        <div className="space-y-2">
          {tiersFailed ? (
            <NativeErrorState isLight={isLight} title="This fan club wouldn't load" message="The club itself is fine — its crowns couldn't be brought in. Check the join ID and try again." onRetry={() => void loadClub(creatorId)} />
          ) : tiers === null ? (
            <NativeLoadingState isLight={isLight} message="Polishing the crowns…" />
          ) : active.length === 0 ? (
            <NativeEmptyState isLight={isLight} message="This creator has no crowns on offer right now." detail="When they open membership tiers, the crowns appear on this stand." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StandTitle isLight={isLight}>The crowns on offer</StandTitle>
                {testMode && (
                  <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/50">Test mode</span>
                )}
                <span className="ml-auto inline-flex gap-1.5">
                  {(["monthly", "annual"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`${chipBtn(isLight)} capitalize ${period === p ? "border-[#d4af37] text-[#d4af37]" : ""}`}
                    >
                      {p}
                    </button>
                  ))}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {active.map((tier) => (
                  <NativeCard key={tier.id} isLight={isLight}>
                    <p className={`flex items-center gap-2 text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      <Crown className="h-4 w-4 shrink-0 text-[#d4af37]" /> {tier.name}
                    </p>
                    <p className="mt-1 text-sm font-black text-[#d4af37]">{tierPriceLabel(tier, period)}</p>
                    {period === "annual" && tierAnnualSavingLabel(tier) && (
                      <p className="text-xs font-semibold text-emerald-300">{tierAnnualSavingLabel(tier)}</p>
                    )}
                    {tier.description && <p className={`mt-1 line-clamp-3 text-xs ${muted(isLight)}`}>{tier.description}</p>}
                    {tier.perks.length > 0 && (
                      <ul className={`mt-2 space-y-1 text-xs ${muted(isLight)}`}>
                        {tier.perks.map((perk, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <Check className="mt-0.5 h-3 w-3 shrink-0 text-[#d4af37]" /> {perk}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-3 space-y-1.5">
                      {/* Paid joins ride the ONE marked transfer: the
                          hosted checkout page, in a new tab (§3.9). */}
                      <button
                        type="button"
                        data-testid="world-crowns-join"
                        onClick={() => void join(tier, "checkout")}
                        disabled={busy === tier.id + "checkout"}
                        className={`${goldBtn(busy === tier.id + "checkout")} w-full`}
                      >
                        {busy === tier.id + "checkout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
                        {tier.priceCents <= 0 ? "Join — free" : CHECKOUT_TRANSFER_LABEL}
                      </button>
                      {tierOffersTrial(tier) && (
                        <button
                          type="button"
                          data-testid="world-crowns-trial"
                          onClick={() => void join(tier, "trial")}
                          disabled={busy === tier.id + "trial"}
                          className={`${chipBtn(isLight)} w-full justify-center`}
                        >
                          {busy === tier.id + "trial" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                          Start 7-day free trial — here at the stand
                        </button>
                      )}
                    </div>
                  </NativeCard>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {isGuest && (
        <p className={`px-1 text-[11px] ${muted(isLight)}`}>Browsing the crowns is open to everyone; wearing one rides your account.</p>
      )}
    </div>
  );
}
