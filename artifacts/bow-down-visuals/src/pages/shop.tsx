import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import {
  ShoppingBag, Loader2, X, Plus, Minus, Trash2,
  Store, ArrowLeft, Lock,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import {
  centsToDisplay, cartKey, addToCartLines, setCartLineQty,
  type CartLine,
} from "@/lib/shops";

/* ─── Public storefront — /shop/:handle ───────────────────────────────────
   Anyone can view. No auth required. Cart is local-only (localStorage);
   checkout is honestly marked COMING SOON — v1 never fakes an order. */

interface PublicShop {
  id: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
  banner_color: string;
  accent_color: string;
  banner_image_url: string | null;
}

interface PublicProduct {
  id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
}

export default function ShopStorefront() {
  const params = useParams<{ handle?: string }>();
  const handle = (params.handle ?? "").toLowerCase();
  const [shop, setShop] = useState<PublicShop | null>(null);
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<PublicProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await fetch(`/api/shops/handle/${encodeURIComponent(handle)}`);
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = (await res.json()) as { shop?: PublicShop; products?: PublicProduct[] };
        if (!data.shop) {
          if (!cancelled) setNotFound(true);
          return;
        }
        if (!cancelled) {
          setShop(data.shop);
          setProducts(data.products ?? []);
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
  const cartCount = cartDetailed.reduce((sum, l) => sum + l.qty, 0);

  function addToCart(productId: string) {
    setCart((c) => addToCartLines(c, productId));
  }

  function setQty(productId: string, qty: number) {
    setCart((c) => setCartLineQty(c, productId, qty));
  }

  const accent = shop?.accent_color ?? "#d4af37";

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      {loading ? (
        <div className="py-32 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
      ) : notFound || !shop ? (
        <main className="max-w-2xl mx-auto px-5 py-32 text-center">
          <Store className="w-12 h-12 mx-auto text-white/25" />
          <h1 className="mt-6 text-3xl font-black">Shop not found</h1>
          <p className="mt-3 text-white/50 text-sm">There's no storefront at <span className="font-mono text-amber-300">/shop/{handle}</span> — check the link or start your own shop.</p>
          <Link href="/my-shop" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-3 text-sm font-bold text-black">
            <Store className="w-4 h-4" /> Start my shop
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
              <img src={shop.banner_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
            <div className="relative max-w-6xl mx-auto px-5 md:px-8 pt-16 pb-10 md:pt-24 md:pb-14">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: accent }}>Bow Down Visuals Shop</p>
                  <h1 className="mt-2 text-4xl md:text-6xl font-black tracking-tight">{shop.name}</h1>
                  {shop.tagline && <p className="mt-2 text-lg text-white/70">{shop.tagline}</p>}
                  {shop.description && <p className="mt-4 max-w-2xl text-sm text-white/55 whitespace-pre-line">{shop.description}</p>}
                </div>
                <button
                  onClick={() => setCartOpen(true)}
                  className="relative shrink-0 rounded-xl border border-white/15 bg-black/60 backdrop-blur px-4 py-3 flex items-center gap-2 hover:bg-black/80 transition"
                  aria-label="Open cart"
                >
                  <ShoppingBag className="w-5 h-5" />
                  <span className="text-sm font-bold hidden sm:inline">Cart</span>
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
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
                <ShoppingBag className="w-10 h-10 mx-auto text-white/25" />
                <p className="mt-4 text-white/50 text-sm">This shop is setting up — products are on the way.</p>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="text-left rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden hover:border-white/25 transition group"
                  >
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="h-56 w-full object-cover group-hover:scale-[1.02] transition" />
                    ) : (
                      <div className="h-56 w-full bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center">
                        <ShoppingBag className="w-10 h-10 text-white/20" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="font-bold truncate">{p.name}</div>
                      <div className="mt-1 font-black" style={{ color: accent }}>{centsToDisplay(p.price_cents)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-10 text-center text-xs text-white/30">
              Powered by <span className="text-amber-300/80 font-semibold">Bow Down Visuals</span> · Secure checkout coming soon
            </p>
          </div>
        </main>
      )}

      {/* product detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0c0c0c] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {selected.image_url ? (
              <img src={selected.image_url} alt={selected.name} className="h-64 w-full object-cover" />
            ) : (
              <div className="h-40 w-full bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center">
                <ShoppingBag className="w-10 h-10 text-white/20" />
              </div>
            )}
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-black">{selected.name}</h2>
                <button className="text-white/40 hover:text-white" onClick={() => setSelected(null)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="mt-1 text-2xl font-black" style={{ color: accent }}>{centsToDisplay(selected.price_cents)}</div>
              {selected.description && (
                <p className="mt-3 text-sm text-white/60 whitespace-pre-line">{selected.description}</p>
              )}
              <button
                className="mt-6 w-full rounded-xl px-5 py-3.5 text-sm font-bold text-black transition hover:brightness-110"
                style={{ background: `linear-gradient(to bottom, ${accent}, ${accent}cc)` }}
                onClick={() => { addToCart(selected.id); setSelected(null); setCartOpen(true); }}
              >
                Add to cart
              </button>
            </div>
          </div>
        </div>
      )}

      {/* cart drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setCartOpen(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-md bg-[#0c0c0c] border-l border-white/10 p-6 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">Your cart {cartCount > 0 && <span className="text-white/40 font-normal">({cartCount})</span>}</h2>
              <button className="text-white/40 hover:text-white" onClick={() => setCartOpen(false)} aria-label="Close cart">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-4 flex-1 overflow-y-auto space-y-3">
              {cartDetailed.length === 0 ? (
                <p className="text-sm text-white/40 text-center py-12">Your cart is empty.</p>
              ) : (
                cartDetailed.map((l) => (
                  <div key={l.productId} className="flex gap-3 rounded-xl border border-white/10 bg-black/40 p-3">
                    {l.product!.image_url ? (
                      <img src={l.product!.image_url} alt={l.product!.name} className="h-14 w-14 rounded-lg object-cover shrink-0" />
                    ) : (
                      <div className="h-14 w-14 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                        <ShoppingBag className="w-5 h-5 text-white/25" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate">{l.product!.name}</div>
                      <div className="text-sm font-bold" style={{ color: accent }}>{centsToDisplay(l.product!.price_cents)}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <button className="rounded-lg border border-white/15 p-1 hover:bg-white/10" onClick={() => setQty(l.productId, l.qty - 1)} aria-label="Decrease">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-bold w-6 text-center">{l.qty}</span>
                        <button className="rounded-lg border border-white/15 p-1 hover:bg-white/10" onClick={() => setQty(l.productId, l.qty + 1)} aria-label="Increase">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button className="ml-auto text-red-400/70 hover:text-red-400" onClick={() => setQty(l.productId, 0)} aria-label="Remove">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {cartDetailed.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Total</span>
                  <span className="text-lg font-black">{centsToDisplay(cartTotal)}</span>
                </div>
                <div className="mt-3 rounded-xl border border-dashed border-amber-400/40 bg-amber-400/[0.06] p-3 flex items-start gap-2">
                  <Lock className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200/80">
                    <span className="font-bold">Secure checkout is coming soon.</span> Your cart is saved on this device —
                    check back once the shop owner enables checkout.
                  </p>
                </div>
                <button
                  disabled
                  className="mt-3 w-full rounded-xl bg-white/10 px-5 py-3.5 text-sm font-bold text-white/40 cursor-not-allowed"
                  title="Checkout is coming soon"
                >
                  Checkout — coming soon
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-5 md:px-8 pb-6">
        <Link href="/my-shop" className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Open my own shop
        </Link>
      </div>
      <SiteFooter />
    </div>
  );
}
