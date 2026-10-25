import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "wouter";
import {
  ShoppingBag, Loader2, X, Plus, Minus, Trash2,
  Store, ArrowLeft, Check, BadgeCheck, Play,
} from "lucide-react";
import {
  centsToDisplay, cartKey, addToCartLines, setCartLineQty,
  type CartLine,
} from "@/lib/shops";
import { usePageTitle } from "@/hooks/use-page-title";
import ProductReviews from "@/components/product-reviews/ProductReviews";
import WishlistButton from "@/components/wishlist/WishlistButton";
import { useModalA11y } from "@/hooks/use-modal-a11y";

/* ─── Public storefront — /shop/:handle ───────────────────────────────────
   Anyone can view. No auth required. Cart is local-only (localStorage).
   Checkout is a real card checkout via /api/storefronts/checkout (0144):
   the order is recorded pending, the buyer pays the listed price on the
   hosted payment page, and Bow Down Visuals takes a 5% platform fee
   from the seller's cut. Returning with ?session_id= verifies the
   payment server-side — only a confirmed payment shows as paid here. */

interface PublicShop {
  id: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
  banner_color: string;
  accent_color: string;
  banner_image_url: string | null;
  custom_domain: string | null;
  domain_verified: boolean;
}

interface PublicProduct {
  id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
  /* #29: the seller's accessibility description of the product shot —
     renders as the product image's alt; falls back to the name. */
  image_alt_text?: string | null;
  /** The finished UGC ad pinned to this product (migration 0178),
      resolved server-side; null when nothing is pinned. */
  pinned_ad?: { id: string; video_url: string } | null;
  /** The live order-bump offer (feature #13): one add-on from this
      shop at the seller-set price / % off, resolved server-side;
      null when this product has no add-on a buyer could take. */
  bump?: {
    productId: string;
    title: string;
    listPrice: string;
    percentOff: number;
    priceCents: number;
    price: string;
  } | null;
}

/** $0 shop products are FREE goods — label them, never "$0.00". */
function priceLabel(cents: number): string {
  return cents === 0 ? "FREE" : centsToDisplay(cents);
}

export default function ShopStorefront() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const params = useParams<{ slug?: string }>();
  const handle = (params.slug ?? "").toLowerCase();
  const [shop, setShop] = useState<PublicShop | null>(null);
  usePageTitle(shop?.name ?? "Shop", "A creator storefront on Bow Down Visuals.");
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  /* Dialog contract for the two hand-rolled overlays below (product
     modal + cart drawer): Escape closes, Tab traps, focus returns to
     the opener on close. See hooks/use-modal-a11y.ts. */
  const productDialogRef = useModalA11y<HTMLDivElement>(!!selected, () => setSelected(null));
  const cartDialogRef = useModalA11y<HTMLElement>(cartOpen, () => setCartOpen(false));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [feePct, setFeePct] = useState(10);
  /* checkout */
  const [buyerEmail, setBuyerEmail] = useState("");
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderDone, setOrderDone] = useState<{ lines: number; gross: number; fee: number; net: number } | null>(null);
  /* Discount code (0190): validated against THIS shop's codes via the
     public validate endpoint; the server re-validates at checkout and
     is always the pricing authority — the totals shown here mirror
     its exact unit-rounding formula. */
  const [discountInput, setDiscountInput] = useState("");
  /* Gift-card tender (Stack-100 #3 #26): stored value beside the
     discount code — the server validates it against this shop's owner
     and applies it to the total due at checkout. */
  const [giftCardInput, setGiftCardInput] = useState("");
  /* Order bumps (feature #13): cart product ids whose add-on the buyer
     ticked. The server re-resolves and re-prices every tick — the
     ticks alone buy nothing. */
  const [bumpTicks, setBumpTicks] = useState<Set<string>>(new Set());
  const [appliedCode, setAppliedCode] = useState<{ code: string; percentOff: number } | null>(null);
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await fetch(`/api/storefronts/slug/${encodeURIComponent(handle)}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = (await res.json()) as { shop?: PublicShop; products?: PublicProduct[]; platformFeePct?: number };
        if (!data.shop) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!cancelled) {
          setShop(data.shop);
          setProducts(data.products ?? []);
          setFeePct(data.platformFeePct ?? 5);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (handle) load();
    return () => { cancelled = true; };
  }, [handle]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(cartKey(handle));
      if (raw) {
        const parsed = JSON.parse(raw) as CartLine[];
        if (Array.isArray(parsed)) setCart(parsed.filter((l) => l && typeof l.productId === "string"));
      }
    } catch { /* corrupted cart — start fresh */ }
  }, [handle]);

  useEffect(() => {
    try {
      localStorage.setItem(cartKey(handle), JSON.stringify(cart));
    } catch { /* storage full/blocked — cart just won't persist */ }
  }, [cart, handle]);

  const cartDetailed = useMemo(
    () =>
      cart
        .map((l) => ({ ...l, product: products.find((p) => p.id === l.productId) }))
        .filter((l) => l.product && l.qty > 0),
    [cart, products]
  );

  const cartTotal = cartDetailed.reduce((sum, l) => sum + l.product!.price_cents * l.qty, 0);
  /* The server's discount sequence, mirrored for display: percent off
     the unit price (rounded), summed per line. Checkout re-prices
     server-side regardless — this number can never overcharge. */
  const discountedTotal = appliedCode
    ? cartDetailed.reduce(
        (sum, l) => sum + Math.round((l.product!.price_cents * (100 - appliedCode.percentOff)) / 100) * l.qty,
        0,
      )
    : cartTotal;
  const cartCount = cartDetailed.reduce((sum, l) => sum + l.qty, 0);
  /* Ticked add-ons that are still in the cart with a live offer. The
     same add-on offered by two cart products is one line (the server
     collapses it too), so the display total dedupes by add-on id. */
  const tickedBumpMainIds = cartDetailed
    .filter((l) => l.product!.bump && bumpTicks.has(l.productId))
    .map((l) => l.productId);
  const bumpTotalCents = (() => {
    const seen = new Set<string>();
    let sum = 0;
    for (const l of cartDetailed) {
      const b = l.product!.bump;
      if (!b || !bumpTicks.has(l.productId) || seen.has(b.productId)) continue;
      seen.add(b.productId);
      sum += b.priceCents;
    }
    return sum;
  })();
  const displayTotalCents = discountedTotal + bumpTotalCents;

  function toggleBump(productId: string, on: boolean) {
    setBumpTicks((prev) => {
      const next = new Set(prev);
      if (on) next.add(productId); else next.delete(productId);
      return next;
    });
  }

  async function applyCode() {
    if (!shop || !discountInput.trim()) return;
    setCheckingCode(true);
    setCodeMsg(null);
    try {
      const res = await fetch(`/api/shops/${shop.id}/discounts/validate?code=${encodeURIComponent(discountInput.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (data.valid === true) {
        setAppliedCode({ code: String(data.code), percentOff: Number(data.percentOff) });
        setCodeMsg(`${data.code} — ${data.percentOff}% off applied.`);
      } else {
        setAppliedCode(null);
        setCodeMsg(typeof data.reason === "string" ? data.reason : "That code doesn't work at this shop.");
      }
    } catch {
      setCodeMsg("Couldn't check that code just now — you can still check out and the code is verified again there.");
    } finally {
      setCheckingCode(false);
    }
  }

  function addToCart(productId: string) {
    setCart((c) => addToCartLines(c, productId));
  }

  function setQty(productId: string, qty: number) {
    setCart((c) => setCartLineQty(c, productId, qty));
  }

  /* Returning from the hosted payment page: verify the session with
     the server — the paid panel below renders ONLY from a confirmed
     payment, never from the redirect alone. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId || params.get("checkout") !== "paid") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/storefronts/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.paid === true) {
          const lines = Array.isArray(data.lines) ? data.lines : [];
          setOrderDone({
            lines: lines.reduce((s: number, l: { quantity?: number }) => s + (l.quantity ?? 1), 0) || 1,
            gross: data.gross_cents ?? 0, fee: data.platform_fee_cents ?? 0, net: data.seller_net_cents ?? 0,
          });
          setCart([]);
          setCartOpen(true);
        } else {
          setOrderError("That payment hasn't confirmed yet — if you completed it, give it a moment and reopen your cart.");
          setCartOpen(true);
        }
      } catch {
        if (!cancelled) setOrderError("Your payment couldn't be confirmed just now — the order stays pending until it does.");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Real card checkout: ONE call for the whole cart. The server prices
     it from its own product rows, records the order as pending, and
     answers the hosted payment page — the browser goes there to pay.
     A free cart completes in place. Failure leaves the cart untouched. */
  async function placeOrder() {
    if (!shop || cartDetailed.length === 0) return;
    setPlacing(true);
    setOrderError(null);
    try {
      const res = await fetch("/api/storefronts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId: shop.id,
          items: cartDetailed.map((l) => ({ productId: l.productId, quantity: l.qty })),
          buyerEmail: buyerEmail.trim() || undefined,
          ...(appliedCode ? { discountCode: appliedCode.code } : discountInput.trim() ? { discountCode: discountInput.trim() } : {}),
          /* #16: a fan's share link lands on this shop with ?ref=CODE —
             pass it through so the sale attributes to them. The server
             validates it against the cart; it never changes the price. */
          ...(new URLSearchParams(window.location.search).get("ref")?.trim()
            ? { affiliateCode: new URLSearchParams(window.location.search).get("ref")!.trim() }
            : {}),
          ...(giftCardInput.trim() ? { giftCardCode: giftCardInput.trim() } : {}),
          ...(tickedBumpMainIds.length > 0 ? { includeBumps: tickedBumpMainIds } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || t("shop.errorOrderFailed"));
      if ((data.free === true || data.paidWithGiftCard === true) && data.paid === true) {
        setOrderDone({ lines: cartDetailed.length, gross: data.gross_cents ?? 0, fee: data.platform_fee_cents ?? 0, net: data.seller_net_cents ?? 0 });
        setCart([]);
        return;
      }
      const url = typeof data.url === "string" ? data.url : typeof data.checkoutUrl === "string" ? data.checkoutUrl : null;
      if (url) {
        window.location.href = url;
        return;
      }
      throw new Error(t("shop.errorOrderFailed"));
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : t("shop.errorOrderFailedRetry"));
    } finally {
      setPlacing(false);
    }
  }

  const accent = shop?.accent_color ?? "#d4af37";

  return (
    <div className="min-h-screen bg-black text-white">

      {loading ? (
        <div className="py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
      ) : notFound || !shop ? (
        <main className="max-w-2xl mx-auto px-5 py-32 text-center">
          <Store className="w-12 h-12 mx-auto text-white/25" />
          <h1 className="mt-6 text-3xl font-black">{t("shop.notFoundTitle")}</h1>
          <p className="mt-3 text-white/50 text-sm">{t("shop.notFoundDescStart")} <span className="font-mono text-amber-300">/shop/{handle}</span> {t("shop.notFoundDescEnd")}</p>
          <Link href="/my-shop" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-3 text-sm font-bold text-black">
            <Store className="w-4 h-4" /> {t("shop.startMyShop")}
          </Link>
        </main>
      ) : (
        <main>
          {/* banner */}
          <div
            className="relative overflow-hidden"
            style={{ background: shop.banner_image_url ? undefined : `linear-gradient(135deg, ${shop.banner_color}, #000)` }}
          >
            {shop.banner_image_url && (
              <img src={shop.banner_image_url} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
            <div className="relative max-w-6xl mx-auto px-5 md:px-8 pt-16 pb-10 md:pt-24 md:pb-14">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: accent }}>Bow Down Visuals Shop</p>
                    {shop.domain_verified && shop.custom_domain && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                        <BadgeCheck className="h-3.5 w-3.5" /> {shop.custom_domain}
                      </span>
                    )}
                  </div>
                  <h1 className="mt-2 text-4xl md:text-6xl font-black tracking-tight">{shop.name}</h1>
                  {shop.tagline && <p className="mt-2 text-lg text-white/70">{shop.tagline}</p>}
                  {shop.description && <p className="mt-4 max-w-2xl text-sm text-white/55 whitespace-pre-line">{shop.description}</p>}
                </div>
                <button
                  onClick={() => setCartOpen(true)}
                  className="relative shrink-0 rounded-xl border border-white/15 bg-black/60 backdrop-blur px-4 py-3 flex items-center gap-2 hover:bg-black/80 transition"
                  aria-label={t("shop.openCartLabel")}
                >
                  <ShoppingBag className="w-5 h-5" />
                  <span className="text-sm font-bold hidden sm:inline">{t("shop.cartLabel")}</span>
                  {cartCount > 0 && (
                    <span
                      className="absolute -top-2 -right-2 min-w-[22px] h-[22px] rounded-full text-[11px] font-black text-black flex items-center justify-center px-1"
                      style={{ background: accent }}
                    >
                      {cartCount}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* product grid */}
          <div className="max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14">
            {products.length === 0 ? (
              <div className={`rounded-2xl border p-12 text-center ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                <ShoppingBag className="w-10 h-10 mx-auto text-white/25" />
                <p className="mt-4 text-white/50 text-sm">{t("shop.noProducts")}</p>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className={`relative text-left rounded-2xl border overflow-hidden hover:border-white/25 transition group ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
                  >
                    {p.pinned_ad?.video_url && (
                      <span className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-amber-300">
                        <Play className="h-3 w-3" /> {t("shop.ugcAd", "UGC ad")}
                      </span>
                    )}
                    {p.image_url ? (
                      <img src={p.image_url} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={p.image_alt_text ?? p.name} className="h-56 w-full object-cover group-hover:scale-[1.02] transition" />
                    ) : (
                      <div className="h-56 w-full bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center">
                        <ShoppingBag className="w-10 h-10 text-white/20" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="font-bold truncate">{p.name}</div>
                      <div className="mt-1 font-black" style={{ color: accent }}>{priceLabel(p.price_cents)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-10 text-center text-xs text-white/50">
              {t("shop.poweredBy")} <span className="text-amber-300/80 font-semibold">Bow Down Visuals</span> · {t("shop.sellersKeep")} ·{" "}
              <Link href="/storefronts" className="underline hover:text-white/60">{t("shop.browseAllShops")}</Link>
            </p>
          </div>
        </main>
      )}

      {/* product detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            ref={productDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={selected.name}
            tabIndex={-1}
            className={`w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA]" : "border-white/15 bg-[#0c0c0c]"}`}

            onClick={(e) => e.stopPropagation()}
          >
            {selected.image_url ? (
              <img src={selected.image_url} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={selected.image_alt_text ?? selected.name} className="h-64 w-full object-cover" />
            ) : (
              <div className="h-40 w-full bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center">
                <ShoppingBag className="w-10 h-10 text-white/20" />
              </div>
            )}
            {selected.pinned_ad?.video_url && (
              <div className="px-6 pt-5">
                <p className="text-xs font-bold uppercase tracking-widest text-white/40">{t("shop.watchTheAd", "Watch the ad")}</p>
                <video
                  src={selected.pinned_ad.video_url}
                  controls
                  playsInline
                  preload="metadata"
                  className="mt-2 aspect-[9/16] max-h-80 w-full rounded-xl bg-black object-contain"
                />
              </div>
            )}
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-black">{selected.name}</h2>
                <button className="text-white/40 hover:text-white" onClick={() => setSelected(null)} aria-label={t("shop.closeLabel")}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-1 text-2xl font-black" style={{ color: accent }}>{priceLabel(selected.price_cents)}</div>
              {/* Wave 4 #38: save-for-later — a price drop on this
                  product notifies the fan once per drop. */}
              <div className="mt-4">
                <WishlistButton itemKind="shop_product" itemId={selected.id} variant="labeled" />
              </div>
              {selected.description && (
                <p className="mt-3 text-sm text-white/60 whitespace-pre-line">{selected.description}</p>
              )}
              <button
                className="mt-6 w-full rounded-xl px-5 py-3.5 text-sm font-bold text-black transition hover:brightness-110"
                style={{ background: `linear-gradient(to bottom, ${accent}, ${accent}cc)` }}
                onClick={() => { addToCart(selected.id); setSelected(null); setCartOpen(true); }}
              >
                {t("shop.addToCart")}
              </button>
              {/* Verified-purchase reviews for this shop product,
                  docked in its detail view (Stack-100 #3, #14). */}
              <ProductReviews productType="shop_product" productId={selected.id} />
            </div>
          </div>
        </div>
      )}

      {/* cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setCartOpen(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <aside
            ref={cartDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("shop.yourCart")}
            tabIndex={-1}
            className={`absolute right-0 top-0 h-full w-full max-w-md border-l p-6 flex flex-col ${isLight ? "border-[#C9A84C]/40 bg-[#FCF7EA]" : "bg-[#0c0c0c] border-white/10"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">{t("shop.yourCart")} {cartCount > 0 && <span className="text-white/40 font-normal">({cartCount})</span>}</h2>
              <button className="text-white/40 hover:text-white" onClick={() => setCartOpen(false)} aria-label={t("shop.closeCartLabel")}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-4 flex-1 overflow-y-auto space-y-3">
              {cartDetailed.length === 0 ? (
                <p className="text-sm text-white/40 text-center py-12">{t("shop.cartEmpty")}</p>
              ) : (
                cartDetailed.map((l) => (
                  <div key={l.productId} className="flex gap-3 rounded-xl border border-white/10 bg-black/40 p-3">
                    {l.product!.image_url ? (
                      <img src={l.product!.image_url} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={l.product!.image_alt_text ?? l.product!.name} className="h-14 w-14 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="h-14 w-14 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                        <ShoppingBag className="w-5 h-5 text-white/25" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{l.product!.name}</div>
                      <div className="text-sm font-bold" style={{ color: accent }}>{priceLabel(l.product!.price_cents)}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button className="rounded-lg border border-white/15 p-1 hover:bg-white/10" onClick={() => setQty(l.productId, l.qty - 1)} aria-label={t("shop.decreaseLabel")}>
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-bold w-6 text-center">{l.qty}</span>
                        <button className="rounded-lg border border-white/15 p-1 hover:bg-white/10" onClick={() => setQty(l.productId, l.qty + 1)} aria-label={t("shop.increaseLabel")}>
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button className="ml-auto text-red-400/70 hover:text-red-400" onClick={() => setQty(l.productId, 0)} aria-label={t("shop.removeItemLabel")}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      {l.product!.bump && (
                        <label className="mt-2.5 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2">
                          <input
                            type="checkbox"
                            checked={bumpTicks.has(l.productId)}
                            onChange={(e) => toggleBump(l.productId, e.target.checked)}
                            aria-label={`Add ${l.product!.bump!.title} to this order`}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-400">Add-on</span>
                              <span className="flex items-baseline gap-1.5">
                                {l.product!.bump!.percentOff > 0 && (
                                  <span className="text-[11px] text-white/35 line-through">{l.product!.bump!.listPrice}</span>
                                )}
                                <span className="text-sm font-bold text-amber-200">{l.product!.bump!.price}</span>
                              </span>
                            </span>
                            <span className="block truncate text-xs font-semibold text-white/85">{l.product!.bump!.title}</span>
                            <span className="block text-[11px] text-white/40">
                              {l.product!.bump!.percentOff > 0 ? `${l.product!.bump!.percentOff}% off as an add-on · ` : ""}
                              added to this same checkout — one charge.
                            </span>
                          </span>
                        </label>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            {cartDetailed.length > 0 && !orderDone && (
              <div className="mt-4 border-t border-white/10 pt-4">
                {bumpTotalCents > 0 && (
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-amber-200/70">Add-ons</span>
                    <span className="font-bold text-amber-200">{centsToDisplay(bumpTotalCents)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">{t("shop.totalLabel")}</span>
                  {appliedCode || bumpTotalCents > 0 ? (
                    <span className="text-lg font-black">
                      {appliedCode && (
                        <span className="mr-2 text-sm font-normal text-white/35 line-through">{centsToDisplay(cartTotal)}</span>
                      )}
                      {centsToDisplay(displayTotalCents)}
                    </span>
                  ) : (
                    <span className="text-lg font-black">{centsToDisplay(cartTotal)}</span>
                  )}
                </div>
                {bumpTotalCents > 0 && appliedCode && (
                  <p className="mt-1 text-[11px] text-white/35">Your code applies to the items — add-ons carry their own seller-set price.</p>
                )}
                <div className="mt-3 flex gap-2">
                  <input
                    value={discountInput}
                    onChange={(e) => { setDiscountInput(e.target.value); setAppliedCode(null); setCodeMsg(null); }}
                    placeholder="Discount code (optional)"
                    aria-label="Discount code"
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/50 outline-none focus:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400/60"
                  />
                  <button
                    onClick={applyCode}
                    disabled={checkingCode || !discountInput.trim()}
                    className="shrink-0 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-white/80 transition hover:bg-white/[0.08] disabled:opacity-50"
                  >
                    {checkingCode ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                  </button>
                </div>
                {codeMsg && (
                  <p className={`mt-2 text-xs ${appliedCode ? "text-emerald-300" : "text-red-300"}`} role="status">{codeMsg}</p>
                )}
                <input
                  value={giftCardInput}
                  onChange={(e) => setGiftCardInput(e.target.value)}
                  placeholder="Gift card code (optional) — BDV-XXXX-XXXX-XXXX-XXXX"
                  aria-label="Gift card code"
                  className="mt-3 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 font-mono text-sm text-white placeholder:text-white/50 outline-none focus:border-amber-400/60"
                />
                <p className="mt-1.5 text-[11px] leading-relaxed text-white/35">
                  Paying with a gift card from this creator? It covers what it can, the rest goes on your card, and what's left stays on the gift card.
                </p>
                <input
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  type="email"
                  placeholder={t("shop.emailPlaceholder")}
                  aria-label={t("shop.emailPlaceholder")}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/50 outline-none focus:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400/60"
                />
                {orderError && <p className="mt-2 text-xs text-red-300" role="alert">{orderError}</p>}
                <button
                  onClick={placeOrder}
                  disabled={placing}
                  className="mt-3 w-full rounded-xl px-5 py-3.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                  style={{ background: `linear-gradient(to bottom, ${accent}, ${accent}cc)` }}
                >
                  {placing ? <Loader2 className="w-5 h-5 mx-auto animate-spin" /> : t("shop.placeOrder", { total: centsToDisplay(displayTotalCents) })}
                </button>
                <p className="mt-2 text-[11px] leading-relaxed text-white/50">
                  {t("shop.checkoutNote", { feePct })}
                </p>
              </div>
            )}
            {orderDone && (
              <div className="mt-4 border-t border-white/10 pt-4 text-center" role="status">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/15">
                  <Check className="h-6 w-6 text-emerald-300" />
                </div>
                <h3 className="mt-3 font-black">{t("shop.orderRecorded")}</h3>
                <p className="mt-1 text-xs text-white/50">{t("shop.orderRecordedDesc", { count: orderDone.lines })}</p>
                <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-3 text-left text-xs">
                  <div className="flex justify-between py-0.5"><span className="text-white/50">{t("shop.orderTotalLabel")}</span><span className="font-bold">{centsToDisplay(orderDone.gross)}</span></div>
                  <div className="flex justify-between py-0.5"><span className="text-white/50">{t("shop.platformFeeLabel", { feePct })}</span><span>{centsToDisplay(orderDone.fee)}</span></div>
                  <div className="flex justify-between border-t border-white/10 py-0.5 pt-1.5"><span className="font-bold">{t("shop.sellerReceivesLabel")}</span><span className="font-bold text-emerald-300">{centsToDisplay(orderDone.net)}</span></div>
                </div>
                <button className="mt-3 text-xs font-bold text-white/50 hover:text-white" onClick={() => { setOrderDone(null); setCartOpen(false); }}>
                  {t("shop.continueShopping")}
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-5 md:px-8 pb-6">
        <Link href="/my-shop" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> {t("shop.openMyShop")}
        </Link>
      </div>

    </div>
  );
}
