import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  BadgeCheck, BarChart3, Check, Crown, Gem, ImagePlus, Loader2, Minus, Pencil, Plus, RefreshCw,
  Settings2, ShoppingBag, ShoppingCart, Sparkles, Store, Trash2, Upload, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
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
  SHOP_AI_DESCRIPTION_COST_VB, SHOP_AI_IMAGE_PREMIUM_COST_VB, SHOP_AI_IMAGE_STANDARD_COST_VB,
  SHOP_AI_SHOP_DESCRIPTION_COST_VB, SHOP_DESCRIPTION_MAX, SHOP_HANDLE_MAX, SHOP_NAME_MAX,
  SHOP_TAGLINE_MAX,
  aiOutOfCredits, applyProductSave, buildProductDescriptionPayload, buildProductImagePayload,
  buildProductPayload, buildShopCreatePayload, buildShopDescriptionPayload,
  buildShopSettingsPayload, emptyProductForm, emptyShopCreateForm,
  isOwnStand, maxDailyViews, parseAiDescription, parseAiImageUrl,
  parseMineShops, parseShopAnalytics, productFormFromDto, productFormProblem,
  recentShopPending, recentShopSales, removeProduct, savedProductDto, savedShopDto,
  shopCreateProblem, shopSettingsFormFromShop, shopSettingsProblem,
  type BillingPeriod, type BrandingCartLine, type BrandingDesignResult,
  type BrandingOrderDto, type BrandingShipping, type HubShopDto,
  type MarketOrder, type MembershipTierDto, type MineShopDto, type MyMembershipDto,
  type ProductFormState, type PublicProductDto,
  type PublicShopDto, type ShopAnalytics, type ShopCreateFormState,
  type ShopSettingsFormState,
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
   are displayed and charged from the same source.

   Stand management (Stack-4 #7): when the walker OWNs the open
   Marketplace stand, the stand itself becomes the shop desk —
   product create/edit/delete and the two product AI helpers ride
   the website's own /api/shops rails with the page's exact
   payloads, in-world. Ownership is proven from the caller's own
   GET /api/shops/mine list (the public stand DTO strips user_id
   by design); guests and non-owners only ever see the buyer's
   stand, and an unlanded ownership read fails closed. */

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
function standTabBtn(isLight: boolean, active: boolean) {
  if (active) return "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-black text-black transition";
  return chipBtn(isLight);
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
  const authHeaders = useAuthHeaders();
  const [shops, setShops] = useState<HubShopDto[] | null>(null);
  const [shopsFailed, setShopsFailed] = useState(false);
  const [tick, setTick] = useState(0);

  /* My shops — the ownership proof for stand management (Stack-4
     #7). Null means the read hasn't landed OR failed: either way
     ownership is unproven and NO management renders (fail closed).
     Guests never fetch it at all. */
  const [mineShops, setMineShops] = useState<MineShopDto[] | null>(null);
  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/shops/mine", { headers: await authHeaders() });
        if (!res.ok) throw new Error("mine");
        const data = (await res.json()) as unknown;
        if (!cancelled) setMineShops(parseMineShops(data));
      } catch { /* fail closed — mineShops stays null, the stand stays a buyer's stand */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

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

  /* The management gate: the open shop's id must appear in MY OWN
     shops list — the only ownership proof the public DTO allows. */
  const ownsStand = isOwnStand(mineShops, shop?.id);
  /* The owner's own full record for the open shop — the settings
     form's source (tagline/description in full, which the public
     DTO also carries, kept in step by every confirmed save). */
  const ownMineShop = ownsStand ? (mineShops?.find((m) => m.id === shop?.id) ?? null) : null;

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

        {standState === "ready" && ownsStand && shop && ownMineShop && (
          <StandManager
            key={shop.id}
            shop={shop}
            mineShop={ownMineShop}
            products={products}
            setProducts={setProducts}
            isLight={isLight}
            onShopSaved={(pub, mine) => {
              setShop(pub);
              setMineShops((ms) => (ms ? ms.map((m) => (m.id === mine.id ? mine : m)) : ms));
              setTick((n) => n + 1);
            }}
            onShopDeleted={() => {
              setMineShops((ms) => (ms ? ms.filter((m) => m.id !== shop.id) : ms));
              setOpenHandle(null);
              setTick((n) => n + 1);
            }}
          />
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
      {/* Opening a shop (Stack-4 wave-2 #6) — the website's own
          create rail, offered only once the caller's mine read has
          landed (a signed-in member surface; guests and an unlanded
          read see the square alone). The new stand joins the square
          from the refreshed server list, never from a local guess. */}
      {!isGuest && mineShops !== null && (
        <StandCreateShop
          isLight={isLight}
          onCreated={(mine) => {
            setMineShops((ms) => (ms ? [mine, ...ms] : [mine]));
            setTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/* ═══ 1a. Open a shop — the create rail, at the square ════════════
   POST /api/shops with the My Shop page's exact body. Opening a
   shop is a Pro-tier rail on the server; a refusal (tier, taken
   handle) is the rail's own answer, shown as-is — the form stays
   and nothing appears on the square until the server confirms. */

function StandCreateShop({
  isLight,
  onCreated,
}: {
  isLight: boolean;
  onCreated: (mine: MineShopDto) => void;
}) {
  const authHeaders = useAuthHeaders();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ShopCreateFormState>(emptyShopCreateForm());
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const set = (patch: Partial<ShopCreateFormState>) => setForm((f) => ({ ...f, ...patch }));

  const create = async () => {
    if (creating) return;
    const problem = shopCreateProblem(form);
    if (problem) { setError(problem); return; }
    const payload = buildShopCreatePayload(form);
    if (!payload) { setError("That shop can't be opened as-is — check the name and handle."); return; }
    setCreating(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/shops", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "The shop didn't open — nothing was created.");
      const saved = savedShopDto(data);
      if (!saved) throw new Error("The shop opened but its answer came back empty — check the square before trying again.");
      onCreated(saved.mine);
      setForm(emptyShopCreateForm());
      setOpen(false);
      setNote(`"${saved.mine.name}" is open on the square — visit its stand to stock it and shape it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The shop didn't open — nothing was created.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <NativeCard isLight={isLight} title="Your shopfront">
      <div className="space-y-2" data-testid="world-shop-create">
        <p className={`text-xs ${muted(isLight)}`}>
          Every creator can hold a stand on this square. Open yours here — the same shop, the same rails as your shop page on the website.
        </p>
        {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
        {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
        {!open ? (
          <button type="button" data-testid="world-shop-create-open" onClick={() => { setOpen(true); setError(null); }} className={goldBtn()}>
            <Store className="h-4 w-4" /> Open a shop
          </button>
        ) : (
          <div className="space-y-2" data-testid="world-shop-create-form">
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Shop name"
              maxLength={SHOP_NAME_MAX}
              className={inputCls(isLight)}
            />
            <input
              value={form.handle}
              onChange={(e) => set({ handle: e.target.value })}
              placeholder="Handle — like gold-standard (its address on the square)"
              maxLength={SHOP_HANDLE_MAX}
              className={inputCls(isLight)}
            />
            <input
              value={form.tagline}
              onChange={(e) => set({ tagline: e.target.value })}
              placeholder="Tagline (optional)"
              maxLength={SHOP_TAGLINE_MAX}
              className={inputCls(isLight)}
            />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" data-testid="world-shop-create-submit" onClick={() => void create()} disabled={creating} className={goldBtn(creating)}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Open the shop
              </button>
              <button type="button" onClick={() => { setOpen(false); setError(null); }} className={chipBtn(isLight)}>
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ═══ 1b. Stand management — the owner's desk at their own stand ══
   Rendered ONLY for the stand's proven owner (see the gate in
   MarketplaceStand). Every verb rides the website's own shops
   rails with the My Shop page's exact payloads — no parallel API:
   create/edit/delete products, plus the two product AI helpers
   through the World's confirmed-spend seam, prices shown before
   each run. The shelf changes ONLY from server-confirmed answers;
   a failed save or delete reports honestly and changes nothing.

   Wave-2 #6 completes the desk: SHOP SETTINGS (name/tagline/
   description on PATCH /api/shops/:id, the shop-description
   writer on the same confirmed-spend seam, delete-the-shop behind
   the same two-step discipline as product deletes) and the SALES
   view (GET /api/storefronts/:id/analytics — the owner-scoped
   ledger the My Shop page reads; totals, the 30-day views strip,
   recent sales, and pending checkouts kept visibly apart from
   sales). Custom domains stay on the website: the settings tab
   says so and points at this panel's standard transfer footer. */

function StandManager({
  shop,
  mineShop,
  products,
  setProducts,
  isLight,
  onShopSaved,
  onShopDeleted,
}: {
  shop: PublicShopDto;
  mineShop: MineShopDto;
  products: PublicProductDto[];
  setProducts: Dispatch<SetStateAction<PublicProductDto[]>>;
  isLight: boolean;
  onShopSaved: (pub: PublicShopDto, mine: MineShopDto) => void;
  onShopDeleted: () => void;
}) {
  const authHeaders = useAuthHeaders();
  const { confirmedFetch } = useConfirmedApi();

  const [formOpen, setFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PublicProductDto | null>(null);
  const [form, setForm] = useState<ProductFormState>(emptyProductForm());
  const [saving, setSaving] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [manageNote, setManageNote] = useState<string | null>(null);
  /* Two-step delete (the World's own discipline — the vault
     characters' remove works the same way): the first tap arms the
     row, the second fires the DELETE. Never one-click. */
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [aiDescBusy, setAiDescBusy] = useState(false);
  const [aiImageBusy, setAiImageBusy] = useState<"standard" | "premium" | null>(null);

  /* The desk's three benches (wave-2 #6): products (the #7 desk),
     shop settings, and the sales ledger. */
  const [section, setSection] = useState<"products" | "settings" | "sales">("products");

  /* Settings state — prefilled from the owner's own mine record;
     the form changes nothing until the PATCH confirms. */
  const [settingsForm, setSettingsForm] = useState<ShopSettingsFormState>(() => shopSettingsFormFromShop(mineShop));
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [shopNiche, setShopNiche] = useState("");
  const [aiShopDescBusy, setAiShopDescBusy] = useState(false);
  /* Delete-the-shop arms exactly like a product delete: first tap
     asks, second tap fires — and the stand only closes on the
     server's confirmation. */
  const [confirmingDeleteShop, setConfirmingDeleteShop] = useState(false);
  const [deletingShop, setDeletingShop] = useState(false);

  /* Sales state: undefined = not asked yet, null = asked and the
     ledger wouldn't open (an honest failure, never fake zeros). */
  const [analytics, setAnalytics] = useState<ShopAnalytics | null | undefined>(undefined);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);

  const set = (patch: Partial<ProductFormState>) => setForm((f) => ({ ...f, ...patch }));

  const openNew = () => {
    setEditingProduct(null);
    setForm(emptyProductForm());
    setManageError(null);
    setManageNote(null);
    setConfirmingDeleteId(null);
    setFormOpen(true);
  };
  const openEdit = (p: PublicProductDto) => {
    setEditingProduct(p);
    setForm(productFormFromDto(p));
    setManageError(null);
    setManageNote(null);
    setConfirmingDeleteId(null);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditingProduct(null);
    setManageError(null);
  };

  /* Save — the page's flow exactly: its two gates first, then POST
     (create) or PATCH (edit) with its body; the shelf takes the
     SERVER's returned row, never the form's guess. Any failure
     keeps the form open and the shelf untouched. */
  const saveProduct = async () => {
    if (saving) return;
    const problem = productFormProblem(form);
    if (problem) { setManageError(problem); return; }
    const payload = buildProductPayload(form);
    if (!payload) { setManageError("That product can't be saved as-is — check the name and price."); return; }
    setSaving(true);
    setManageError(null);
    setManageNote(null);
    try {
      const res = await fetch(
        editingProduct ? `/api/shops/${shop.id}/products/${editingProduct.id}` : `/api/shops/${shop.id}/products`,
        {
          method: editingProduct ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json", ...(await authHeaders()) },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "The product didn't save — nothing about your stand changed.");
      const saved = savedProductDto(data);
      if (!saved) throw new Error("The save came back without your product — the shelf here is unchanged. Reopen the stand to see its true state.");
      setProducts((ps) => applyProductSave(ps, saved, editingProduct ? editingProduct.id : null));
      setManageNote(editingProduct ? `"${saved.name}" is updated on your stand.` : `"${saved.name}" is on your stand.`);
      setFormOpen(false);
      setEditingProduct(null);
    } catch (e) {
      setManageError(e instanceof Error ? e.message : "The product didn't save — nothing about your stand changed.");
    } finally {
      setSaving(false);
    }
  };

  /* Delete — fires ONLY from the armed (second) step. The row
     leaves the shelf only after the server confirms; a failure
     reports and the row stays. */
  const deleteProduct = async (p: PublicProductDto) => {
    if (deletingId) return;
    setDeletingId(p.id);
    setManageError(null);
    setManageNote(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}/products/${p.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "That product wouldn't come off the stand — it's still on your shelf.");
      setProducts((ps) => removeProduct(ps, p.id));
      if (editingProduct?.id === p.id) closeForm();
      setConfirmingDeleteId(null);
      setManageNote(`"${p.name}" is off your stand.`);
    } catch (e) {
      setManageError(e instanceof Error ? e.message : "That product wouldn't come off the stand — it's still on your shelf.");
    } finally {
      setDeletingId(null);
    }
  };

  /* AI description — the page's exact body, through the World's
     confirmed-spend seam (the registry prices this endpoint at
     100 VB, confirmed before the run). A declined confirm is a
     quiet no-op; an out-of-credits answer names the wallet, not
     the stand; the text lands in the form only, unsaved — saving
     the product is still the owner's own tap. */
  const runAiDescription = async () => {
    if (aiDescBusy) return;
    if (!form.name.trim()) { setManageError("Give the product a name first — the writer needs to know what it's selling."); return; }
    setAiDescBusy(true);
    setManageError(null);
    try {
      const res = await confirmedFetch("/api/shops/ai/product-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProductDescriptionPayload(form)),
      });
      if (!res) return; /* the owner declined the spend confirm — nothing charged, nothing changed */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (aiOutOfCredits(res.status, data)) {
        setManageError("You're out of Visual Bucs — top up and the writer is yours again.");
        return;
      }
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "The writer didn't answer — if Visual Bucs were charged, they're refunded.");
      const description = parseAiDescription(data);
      if (!description) throw new Error("The writer came back empty — if Visual Bucs were charged, they're refunded.");
      set({ description });
      setManageNote("The description's written — read it over, then save the product to put it on the stand.");
    } catch (e) {
      setManageError(e instanceof Error ? e.message : "The writer didn't answer — if Visual Bucs were charged, they're refunded.");
    } finally {
      setAiDescBusy(false);
    }
  };

  /* AI product image — same seam; premium carries its own price
     (200 VB, the server constant) as the confirm's override. The
     URL lands in the form's image field only — nothing reaches
     the shelf until the product saves. */
  const runAiImage = async (tier: "standard" | "premium") => {
    if (aiImageBusy) return;
    if (!form.name.trim()) { setManageError("Give the product a name first — the image maker needs to know what it's picturing."); return; }
    setAiImageBusy(tier);
    setManageError(null);
    try {
      const res = await confirmedFetch("/api/shops/ai/product-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildProductImagePayload(form, tier)),
        ...(tier === "premium"
          ? { overrideCost: SHOP_AI_IMAGE_PREMIUM_COST_VB, overrideFeature: "Product Image — Premium" }
          : {}),
      });
      if (!res) return; /* declined — nothing charged, nothing changed */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (aiOutOfCredits(res.status, data)) {
        setManageError("You're out of Visual Bucs — top up and the image maker is yours again.");
        return;
      }
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "The image didn't come back — if Visual Bucs were charged, they're refunded.");
      const url = parseAiImageUrl(data);
      if (!url) throw new Error("The image maker came back empty — if Visual Bucs were charged, they're refunded.");
      set({ imageUrl: url });
      setManageNote("Your product image is made — save the product to put it on the stand.");
    } catch (e) {
      setManageError(e instanceof Error ? e.message : "The image didn't come back — if Visual Bucs were charged, they're refunded.");
    } finally {
      setAiImageBusy(null);
    }
  };

  const setSettings = (patch: Partial<ShopSettingsFormState>) => setSettingsForm((f) => ({ ...f, ...patch }));

  /* Settings save — PATCH /api/shops/:id with the page's exact
     body. The stand's header and the owner's record take the
     SERVER's returned row (through the parent), never the form's
     guess; a failure keeps the form and changes nothing. */
  const saveSettings = async () => {
    if (settingsSaving) return;
    const problem = shopSettingsProblem(settingsForm);
    if (problem) { setSettingsError(problem); return; }
    const payload = buildShopSettingsPayload(settingsForm);
    if (!payload) { setSettingsError("Those settings can't be saved as-is — check the name and lengths."); return; }
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsNote(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "Your settings didn't save — your shop is unchanged.");
      const saved = savedShopDto(data);
      if (!saved) throw new Error("The save came back without your shop — reopen the stand to see its true state.");
      onShopSaved(saved.pub, { ...saved.mine, product_count: mineShop.product_count });
      setSettingsForm(shopSettingsFormFromShop(saved.mine));
      setSettingsNote("Your shop's new face is live on the square.");
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Your settings didn't save — your shop is unchanged.");
    } finally {
      setSettingsSaving(false);
    }
  };

  /* AI shop description — the page's exact body, through the same
     confirmed-spend seam as the product helpers (100 VB, shown
     before the run). The text lands in the form only, unsaved —
     saving the settings is still the owner's own tap. */
  const runAiShopDescription = async () => {
    if (aiShopDescBusy) return;
    if (!(settingsForm.name.trim() || shop.name)) { setSettingsError("Give the shop a name first — the writer needs to know whose story it's telling."); return; }
    setAiShopDescBusy(true);
    setSettingsError(null);
    try {
      const res = await confirmedFetch("/api/shops/ai/shop-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildShopDescriptionPayload({
          shopName: settingsForm.name.trim() || shop.name,
          tagline: settingsForm.tagline,
          niche: shopNiche,
          productNames: products.map((p) => p.name),
        })),
      });
      if (!res) return; /* the owner declined the spend confirm — nothing charged, nothing changed */
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (aiOutOfCredits(res.status, data)) {
        setSettingsError("You're out of Visual Bucs — top up and the writer is yours again.");
        return;
      }
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "The writer didn't answer — if Visual Bucs were charged, they're refunded.");
      const description = parseAiDescription(data);
      if (!description) throw new Error("The writer came back empty — if Visual Bucs were charged, they're refunded.");
      setSettings({ description });
      setSettingsNote("Your shop's story is written — read it over, then save the settings to put it on the square.");
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "The writer didn't answer — if Visual Bucs were charged, they're refunded.");
    } finally {
      setAiShopDescBusy(false);
    }
  };

  /* Delete the shop — fires ONLY from the armed (second) step.
     On the server's confirmation the parent closes the stand and
     the square refreshes; a failure reports and the shop stands. */
  const deleteShop = async () => {
    if (deletingShop) return;
    setDeletingShop(true);
    setSettingsError(null);
    setSettingsNote(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : "Your shop wouldn't close — it's still on the square.");
      onShopDeleted();
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : "Your shop wouldn't close — it's still on the square.");
      setDeletingShop(false);
    }
  };

  /* The sales ledger — read lazily when the bench first opens,
     from the owner-scoped analytics rail the My Shop page reads.
     A failed read is a failure state with a retry, never zeros. */
  const loadAnalytics = async () => {
    if (analyticsBusy) return;
    setAnalyticsBusy(true);
    try {
      const res = await fetch(`/api/storefronts/${shop.id}/analytics`, { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) throw new Error("analytics");
      const parsed = parseShopAnalytics(data);
      if (!parsed) throw new Error("analytics");
      setAnalytics(parsed);
    } catch {
      setAnalytics(null);
    } finally {
      setAnalyticsBusy(false);
    }
  };
  useEffect(() => {
    if (section === "sales" && analytics === undefined) void loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  return (
    <NativeCard isLight={isLight} title="Your stand — manage it here">
      <div className="space-y-2">
        <p className={`text-xs ${muted(isLight)}`}>
          This is your stand — the same products and prices as your shop on the website, run from right here.
          Every change saves on the real rails the moment it lands.
        </p>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Your stand's benches">
          <button type="button" role="tab" aria-selected={section === "products"} data-testid="world-shop-manage-tab-products" onClick={() => setSection("products")} className={standTabBtn(isLight, section === "products")}>
            <ShoppingBag className="h-3 w-3" /> Products
          </button>
          <button type="button" role="tab" aria-selected={section === "settings"} data-testid="world-shop-manage-tab-settings" onClick={() => setSection("settings")} className={standTabBtn(isLight, section === "settings")}>
            <Settings2 className="h-3 w-3" /> Shop settings
          </button>
          <button type="button" role="tab" aria-selected={section === "sales"} data-testid="world-shop-manage-tab-sales" onClick={() => setSection("sales")} className={standTabBtn(isLight, section === "sales")}>
            <BarChart3 className="h-3 w-3" /> Sales
          </button>
        </div>

        {section === "products" && (
        <div className="space-y-2" data-testid="world-shop-manage">
        {manageError && <p className="text-xs font-semibold text-red-400">{manageError}</p>}
        {manageNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{manageNote}</p>}

        <div className="space-y-1.5">
          {products.map((p) => (
            <div
              key={p.id}
              data-testid="world-shop-manage-row"
              className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
            >
              <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.name}</span>
              <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(p.price_cents)}</span>
              {confirmingDeleteId === p.id ? (
                <>
                  <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>Take it off your stand?</span>
                  <button
                    type="button"
                    data-testid="world-shop-manage-delete-confirm"
                    onClick={() => void deleteProduct(p)}
                    disabled={deletingId === p.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:scale-105 disabled:opacity-50"
                  >
                    {deletingId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Remove it
                  </button>
                  <button type="button" onClick={() => setConfirmingDeleteId(null)} className={chipBtn(isLight)}>Keep it</button>
                </>
              ) : (
                <>
                  <button type="button" data-testid="world-shop-manage-edit" onClick={() => openEdit(p)} className={chipBtn(isLight)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button
                    type="button"
                    data-testid="world-shop-manage-delete"
                    onClick={() => { setConfirmingDeleteId(p.id); setManageError(null); }}
                    className={chipBtn(isLight)}
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                </>
              )}
            </div>
          ))}
          {products.length === 0 && (
            <p className={`text-xs ${muted(isLight)}`}>Your stand is bare — add your first product and it&rsquo;s on the shelf.</p>
          )}
        </div>

        {!formOpen ? (
          <button type="button" data-testid="world-shop-manage-add" onClick={openNew} className={goldBtn()}>
            <Plus className="h-4 w-4" /> Add a product
          </button>
        ) : (
          <div className="space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-shop-manage-form">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
              {editingProduct ? `Editing ${editingProduct.name}` : "New product"}
            </p>
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Product name"
              maxLength={120}
              className={inputCls(isLight)}
            />
            <input
              value={form.price}
              onChange={(e) => set({ price: e.target.value })}
              placeholder="Price — like 19.99"
              inputMode="decimal"
              className={inputCls(isLight)}
            />
            <textarea
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="Description — what it is, why it's worth it"
              maxLength={2000}
              rows={3}
              className={inputCls(isLight)}
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                data-testid="world-shop-manage-ai-description"
                onClick={() => void runAiDescription()}
                disabled={aiDescBusy}
                className={chipBtn(isLight)}
              >
                {aiDescBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Write the description — {SHOP_AI_DESCRIPTION_COST_VB} VB
              </button>
              <button
                type="button"
                data-testid="world-shop-manage-ai-image-standard"
                onClick={() => void runAiImage("standard")}
                disabled={aiImageBusy !== null}
                className={chipBtn(isLight)}
              >
                {aiImageBusy === "standard" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                Make an image — {SHOP_AI_IMAGE_STANDARD_COST_VB} VB
              </button>
              <button
                type="button"
                data-testid="world-shop-manage-ai-image-premium"
                onClick={() => void runAiImage("premium")}
                disabled={aiImageBusy !== null}
                className={chipBtn(isLight)}
              >
                {aiImageBusy === "premium" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                Premium image — {SHOP_AI_IMAGE_PREMIUM_COST_VB} VB
              </button>
            </div>
            <input
              value={form.styleHint}
              onChange={(e) => set({ styleHint: e.target.value })}
              placeholder="Image style direction (optional)"
              maxLength={300}
              className={inputCls(isLight)}
            />
            <input
              value={form.imageUrl}
              onChange={(e) => set({ imageUrl: e.target.value })}
              placeholder="Image link — paste one, or make one above"
              className={inputCls(isLight)}
            />
            {form.imageUrl.trim() && (
              <img src={form.imageUrl.trim()} alt="" className="h-24 w-24 rounded-xl border border-[#d4af37]/40 object-cover" />
            )}
            <p className={`text-[11px] ${muted(isLight)}`}>
              The helpers&rsquo; prices are confirmed before each run; a failed run is refunded by the rail itself.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" data-testid="world-shop-manage-save" onClick={() => void saveProduct()} disabled={saving} className={goldBtn(saving)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {editingProduct ? "Save changes" : "Put it on the stand"}
              </button>
              <button type="button" onClick={closeForm} className={chipBtn(isLight)}>
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>
        )}
        </div>
        )}

        {section === "settings" && (
        <div className="space-y-2" data-testid="world-shop-settings">
          <p className={`text-xs ${muted(isLight)}`}>
            Your shop&rsquo;s face on the square — the same name, tagline and story your shop page on the website shows.
            Your stand&rsquo;s address is its handle, <span className="font-mono">{shop.handle}</span> — it never moves.
          </p>
          {settingsError && <p className="text-xs font-semibold text-red-400">{settingsError}</p>}
          {settingsNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{settingsNote}</p>}
          <input
            value={settingsForm.name}
            onChange={(e) => setSettings({ name: e.target.value })}
            placeholder="Shop name"
            maxLength={SHOP_NAME_MAX}
            className={inputCls(isLight)}
          />
          <input
            value={settingsForm.tagline}
            onChange={(e) => setSettings({ tagline: e.target.value })}
            placeholder="Tagline — the one line under your name"
            maxLength={SHOP_TAGLINE_MAX}
            className={inputCls(isLight)}
          />
          <textarea
            value={settingsForm.description}
            onChange={(e) => setSettings({ description: e.target.value })}
            placeholder="Your shop's story — what you sell and why it's worth it"
            maxLength={SHOP_DESCRIPTION_MAX}
            rows={4}
            className={inputCls(isLight)}
          />
          <input
            value={shopNiche}
            onChange={(e) => setShopNiche(e.target.value)}
            placeholder="Your niche (optional — steers the writer below)"
            maxLength={120}
            className={inputCls(isLight)}
          />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" data-testid="world-shop-settings-save" onClick={() => void saveSettings()} disabled={settingsSaving} className={goldBtn(settingsSaving)}>
              {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save settings
            </button>
            <button
              type="button"
              data-testid="world-shop-settings-ai-description"
              onClick={() => void runAiShopDescription()}
              disabled={aiShopDescBusy}
              className={chipBtn(isLight)}
            >
              {aiShopDescBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Write my shop&rsquo;s story — {SHOP_AI_SHOP_DESCRIPTION_COST_VB} VB
            </button>
          </div>
          <p className={`text-[11px] ${muted(isLight)}`}>
            The writer&rsquo;s price is confirmed before it runs; a failed run is refunded by the rail itself. Its words land above, unsaved — saving is your tap.
          </p>
          <p className={`text-[11px] ${muted(isLight)}`}>
            Custom domains live on your shop&rsquo;s page on the website — the quiet &ldquo;Open on the website ↗&rdquo; door at the foot of this panel takes you there.
          </p>

          <div className="space-y-2 border-t border-red-400/30 pt-3">
            <p className={`text-xs font-black uppercase tracking-[0.14em] text-red-300`}>Close this shop</p>
            <p className={`text-xs ${muted(isLight)}`}>
              Closing takes the stand and its products off the square for good. Sales already made stay in your records; files are never deleted.
            </p>
            {confirmingDeleteShop ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>Close &ldquo;{shop.name}&rdquo; for good?</span>
                <button
                  type="button"
                  data-testid="world-shop-settings-delete-confirm"
                  onClick={() => void deleteShop()}
                  disabled={deletingShop}
                  className="inline-flex items-center gap-1.5 rounded-full border border-red-400/50 bg-red-400/10 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:scale-105 disabled:opacity-50"
                >
                  {deletingShop ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Close it
                </button>
                <button type="button" onClick={() => setConfirmingDeleteShop(false)} className={chipBtn(isLight)}>Keep my shop</button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="world-shop-settings-delete"
                onClick={() => { setConfirmingDeleteShop(true); setSettingsError(null); }}
                className={chipBtn(isLight)}
              >
                <Trash2 className="h-3 w-3" /> Close this shop
              </button>
            )}
          </div>
        </div>
        )}

        {section === "sales" && (
        <div className="space-y-2" data-testid="world-shop-sales">
          {analytics === undefined || analyticsBusy ? (
            <NativeLoadingState isLight={isLight} message="Opening your sales ledger…" />
          ) : analytics === null ? (
            <NativeErrorState
              isLight={isLight}
              title="Your sales wouldn't open"
              message="The ledger itself is fine — it couldn't be brought to the stand just now. Nothing about your sales changed."
              onRetry={() => { setAnalytics(undefined); void loadAnalytics(); }}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Views", value: String(analytics.totals.views) },
                  { label: "Sales", value: String(analytics.totals.sales) },
                  { label: "Gross", value: centsToDisplay(analytics.totals.gross_cents) },
                  { label: "You keep", value: centsToDisplay(analytics.totals.seller_net_cents), gold: true },
                ].map((s) => (
                  <div
                    key={s.label}
                    className={`rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                  >
                    <div className={`text-lg font-black ${s.gold ? "text-[#d4af37]" : isLight ? "text-[#2a1e07]" : "text-white"}`}>{s.value}</div>
                    <div className={`mt-0.5 text-[10px] font-bold uppercase tracking-wider ${muted(isLight)}`}>{s.label}</div>
                  </div>
                ))}
              </div>

              {analytics.dailyViews.length > 0 && (
                <div>
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${muted(isLight)}`}>Views — last 30 days</p>
                  <div className="mt-1.5 flex h-16 items-end gap-1">
                    {analytics.dailyViews.map((d) => (
                      <div
                        key={d.day}
                        title={`${d.day}: ${d.views} views`}
                        className="flex-1 rounded-t bg-gradient-to-t from-amber-500/40 to-amber-300/80"
                        style={{ height: `${Math.max(4, (d.views / maxDailyViews(analytics)) * 100)}%` }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className={`text-[11px] font-bold uppercase tracking-wider ${muted(isLight)}`}>
                  Recent sales <span className="normal-case font-normal">— the {analytics.platformFeePct}% platform fee comes out of your cut, never on top of the buyer&rsquo;s price</span>
                </p>
                {analytics.sales.length === 0 ? (
                  <p className={`mt-1.5 text-xs ${muted(isLight)}`}>No sales yet — when your first one lands, it shows here the moment it&rsquo;s paid.</p>
                ) : (
                  <div className="mt-1.5 space-y-1.5">
                    {recentShopSales(analytics).map((sale) => (
                      <div
                        key={sale.id}
                        data-testid="world-shop-sales-row"
                        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{sale.product_name ?? "Product"}</span>
                            {sale.payment_status === "paid" && (
                              <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">Paid</span>
                            )}
                            {sale.payment_status === "no_payment_required" && (
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${isLight ? "bg-black/10 text-[#6B5B36]" : "bg-white/10 text-white/60"}`}>Free order</span>
                            )}
                          </div>
                          <div className={`text-[11px] ${muted(isLight)}`}>
                            {new Date(sale.paid_at ?? sale.created_at).toLocaleDateString()}{sale.buyer_email ? ` · ${sale.buyer_email}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{centsToDisplay(sale.amount_cents)}</div>
                          <div className="text-[11px] font-semibold text-emerald-300">You keep {centsToDisplay(sale.seller_net_cents)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {analytics.pendingSales.length > 0 && (
                <div>
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${muted(isLight)}`}>
                    Awaiting payment <span className="normal-case font-normal">— started at checkout, not paid yet. These are not sales until the payment confirms.</span>
                  </p>
                  <div className="mt-1.5 space-y-1.5">
                    {recentShopPending(analytics).map((sale) => (
                      <div
                        key={sale.id}
                        data-testid="world-shop-sales-pending-row"
                        className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-3 py-2 opacity-75 ${isLight ? "border-[#C9A84C]/40 bg-white/40" : "border-white/15 bg-white/[0.03]"}`}
                      >
                        <div className="min-w-0">
                          <div className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{sale.product_name ?? "Product"}</div>
                          <div className={`text-[11px] ${muted(isLight)}`}>{new Date(sale.created_at).toLocaleDateString()}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{centsToDisplay(sale.amount_cents)}</div>
                          <div className="text-[11px] font-semibold text-amber-300">{sale.payment_status === "expired" ? "Checkout expired" : "Pending"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className={`text-[11px] ${muted(isLight)}`}>
                Real-money sales through the website checkout — this is not Visual Bucs. Your net sits as a pending balance until it pays out through the website&rsquo;s payout path.
              </p>
            </>
          )}
        </div>
        )}
      </div>
    </NativeCard>
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
