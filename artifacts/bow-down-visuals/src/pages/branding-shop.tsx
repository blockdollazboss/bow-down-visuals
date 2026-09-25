import { useState, useEffect } from "react";
import {
  Shirt, Loader2, Sparkles, ShoppingCart, Trash2, Plus, Minus,
  CheckCircle2, Package, Palette, Tag, Truck, X, ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  BRANDING_PRODUCTS,
  BRANDING_STYLES,
  BRANDING_DESIGN_COST,
  formatMoney,
  type ProductKey,
  type BrandStyle,
  type ColorKey,
} from "@/lib/branding-shop";

/* ─── Thy Cheat Code's AI Branding Shop ───────────────────────────────────
   Dropship branding store: AI designs your brand kit (logo + product
   mockups), you sell the merch, manufacturers ship direct — Bow Down Visuals
   never touches inventory.

   v1 HONESTY CONTRACT: order statuses are only "received" /
   "pending_fulfillment". No shipped/delivered/tracking fiction — the UI says
   "dropship partner integration coming soon". Browsing + ordering is FREE;
   only the AI brand-kit design costs credits (2 per set). */

type TabKey = "shop" | "studio" | "orders";

interface Product {
  key: ProductKey;
  label: string;
  priceCents: number;
  sizes: string[];
  icon: LucideIcon;
  blurb: string;
}

const ICONS: Record<ProductKey, LucideIcon> = {
  tshirt: Shirt,
  hoodie: Shirt,
  mug: Package,
  cap: Tag,
  poster: Palette,
};

/* Catalog lives in @/lib/branding-shop (testable); icons stay page-local. */
const PRODUCTS: Product[] = BRANDING_PRODUCTS.map((p) => ({ ...p, icon: ICONS[p.key] }));

const COLORS: Array<{ key: ColorKey; label: string; swatch: string }> = [
  { key: "black", label: "Black", swatch: "bg-neutral-900 border-white/20" },
  { key: "gold", label: "Gold", swatch: "bg-amber-400 border-amber-200" },
  { key: "white", label: "White", swatch: "bg-white border-white/40" },
];

const STYLES = BRANDING_STYLES;

const DESIGN_COST = BRANDING_DESIGN_COST;

function money(cents: number): string {
  return formatMoney(cents);
}

interface CartItem {
  product: ProductKey;
  color: ColorKey;
  size: string;
  qty: number;
}

interface Mockup {
  product: ProductKey;
  url: string;
}

interface DesignResult {
  logo: { url: string };
  mockups: Mockup[];
  brief: { tagline: string; palette: string[] };
  creditsUsed?: number;
  creditsRemaining?: number;
}

interface Order {
  id: string;
  items: Array<CartItem & { unitPriceCents: number }>;
  totalCents: number;
  status: string;
  createdAt: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

function productByKey(key: ProductKey): Product {
  return PRODUCTS.find((p) => p.key === key)!;
}

export default function BrandingShop() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<TabKey>("shop");

  /* shop config state (per-product selections) */
  const [sel, setSel] = useState<Record<ProductKey, { color: ColorKey; size: string; qty: number }>>(() =>
    Object.fromEntries(
      PRODUCTS.map((p) => [p.key, { color: "black" as ColorKey, size: p.sizes[0], qty: 1 }])
    ) as Record<ProductKey, { color: ColorKey; size: string; qty: number }>
  );

  /* cart */
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  /* studio state */
  const [brandName, setBrandName] = useState("");
  const [niche, setNiche] = useState("");
  const [style, setStyle] = useState<BrandStyle>("luxury-gold");
  const [designProducts, setDesignProducts] = useState<ProductKey[]>(["tshirt", "hoodie", "mug"]);
  const [designing, setDesigning] = useState(false);
  const [design, setDesign] = useState<DesignResult | null>(null);

  /* checkout state */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state_, setState_] = useState("");
  const [zip, setZip] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  /* orders state */
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const cartCount = cart.reduce((n, i) => n + i.qty, 0);
  const cartTotal = cart.reduce((n, i) => n + productByKey(i.product).priceCents * i.qty, 0);

  function switchTab(next: TabKey) {
    setTab(next);
    setError(null);
    setOutOfCredits(false);
    if (next === "orders") loadOrders();
  }

  async function authed(path: string, init?: RequestInit) {
    const token = await getAccessToken();
    return fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  function addToCart(product: ProductKey) {
    const s = sel[product];
    setCart((prev) => {
      const idx = prev.findIndex(
        (i) => i.product === product && i.color === s.color && i.size === s.size
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.min(99, next[idx].qty + s.qty) };
        return next;
      }
      return [...prev, { product, color: s.color, size: s.size, qty: s.qty }];
    });
    setCartOpen(true);
  }

  function updateQty(idx: number, delta: number) {
    setCart((prev) => {
      const next = [...prev];
      const q = next[idx].qty + delta;
      if (q <= 0) next.splice(idx, 1);
      else next[idx] = { ...next[idx], qty: Math.min(99, q) };
      return next;
    });
  }

  function toggleDesignProduct(p: ProductKey) {
    setDesignProducts((prev) =>
      prev.includes(p)
        ? prev.filter((x) => x !== p)
        : prev.length >= 3
          ? prev
          : [...prev, p]
    );
  }

  async function designBrandKit() {
    if (designing || !user) return;
    if (!brandName.trim() || !niche.trim()) {
      setError("Give your brand a name and a niche first.");
      return;
    }
    if (designProducts.length === 0) {
      setError("Pick at least one product to mock up.");
      return;
    }
    setDesigning(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authed("/api/branding-shop/design", {
        method: "POST",
        body: JSON.stringify({
          brandName: brandName.trim(),
          niche: niche.trim(),
          style,
          products: designProducts,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as DesignResult & {
        error?: string;
        message?: string;
      };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.logo?.url) {
        throw new Error(data.message || data.error || "Brand kit design failed — try again.");
      }
      setDesign(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("design-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Brand kit design failed — try again.");
    } finally {
      setDesigning(false);
    }
  }

  async function placeOrder() {
    if (ordering || !user || cart.length === 0) return;
    if (!name.trim() || !email.trim() || !address.trim() || !city.trim() || !state_.trim() || !zip.trim()) {
      setError("Fill in every shipping field so we know where to send your merch.");
      return;
    }
    setOrdering(true);
    setError(null);
    try {
      const res = await authed("/api/branding-shop/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart,
          name: name.trim(),
          email: email.trim(),
          address: address.trim(),
          city: city.trim(),
          state: state_.trim(),
          zip: zip.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        order?: { id: string };
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.order?.id) {
        throw new Error(data.message || data.error || "Order failed — try again.");
      }
      setOrderSuccess(data.message || "Order received!");
      setCart([]);
      setCartOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order failed — try again.");
    } finally {
      setOrdering(false);
    }
  }

  async function loadOrders() {
    if (!user) return;
    setOrdersLoading(true);
    try {
      const res = await authed("/api/branding-shop/orders");
      const data = (await res.json().catch(() => ({}))) as { orders?: Order[] };
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      /* orders list is best-effort */
    } finally {
      setOrdersLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "orders" && user) loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        {/* header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" /> AI Branding Shop
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              Your brand. <span className="bg-gradient-to-r from-amber-400 to-yellow-200 bg-clip-text text-transparent">On everything.</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/50">
              AI designs your logo and product mockups, you sell the merch, our
              dropship partners ship it straight to your fans. You never touch inventory.
            </p>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="relative inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:border-primary/40"
          >
            <ShoppingCart className="h-4 w-4 text-primary" />
            Cart
            {cartCount > 0 && (
              <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-black text-black">
                {cartCount}
              </span>
            )}
          </button>
        </div>

        {/* tabs */}
        <div className="mb-8 flex gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
          {(
            [
              { key: "shop", label: "Shop Merch" },
              { key: "studio", label: "AI Design Studio" },
              { key: "orders", label: "My Orders" },
            ] as Array<{ key: TabKey; label: string }>
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                tab === t.key
                  ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
        {outOfCredits && (
          <div className="mb-6">
            <OutOfCredits />
          </div>
        )}

        {/* ── SHOP TAB ─────────────────────────────────────────── */}
        {tab === "shop" && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map((p) => {
              const Icon = p.icon;
              const s = sel[p.key];
              return (
                <div
                  key={p.key}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-primary/30"
                >
                  <div className="flex h-44 items-center justify-center bg-gradient-to-br from-neutral-900 via-black to-neutral-900">
                    <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10">
                      <Icon className="h-10 w-10 text-primary" />
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{p.label}</h3>
                        <p className="mt-0.5 text-xs text-white/45">{p.blurb}</p>
                      </div>
                      <span className="text-lg font-black text-primary">{money(p.priceCents)}</span>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <span className="text-xs text-white/40">Color</span>
                      {COLORS.map((c) => (
                        <button
                          key={c.key}
                          title={c.label}
                          onClick={() => setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], color: c.key } }))}
                          className={`h-7 w-7 rounded-full border-2 ${c.swatch} ${
                            s.color === c.key ? "ring-2 ring-primary ring-offset-2 ring-offset-black" : ""
                          }`}
                        />
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-white/40">Size</span>
                      <div className="flex flex-wrap gap-1.5">
                        {p.sizes.map((sz) => (
                          <button
                            key={sz}
                            onClick={() => setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], size: sz } }))}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                              s.size === sz
                                ? "border-primary bg-primary/15 text-primary"
                                : "border-white/10 text-white/50 hover:border-white/25"
                            }`}
                          >
                            {sz}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 rounded-xl border border-white/10 px-2 py-1">
                        <button
                          onClick={() =>
                            setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], qty: Math.max(1, prev[p.key].qty - 1) } }))
                          }
                          className="p-1 text-white/60 hover:text-white"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{s.qty}</span>
                        <button
                          onClick={() =>
                            setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], qty: Math.min(99, prev[p.key].qty + 1) } }))
                          }
                          className="p-1 text-white/60 hover:text-white"
                          aria-label="Increase quantity"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button onClick={() => addToCart(p.key)} className={`${goldBtn} flex-1 !px-4 !py-2.5`}>
                        <ShoppingCart className="h-4 w-4" /> Add to cart
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── STUDIO TAB ───────────────────────────────────────── */}
        {tab === "studio" && (
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 lg:col-span-2">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Sparkles className="h-5 w-5 text-primary" /> Design my brand kit
              </h2>
              <p className="mt-1 text-xs text-white/45">
                AI creates your logo plus mockups on up to 3 products — {DESIGN_COST} credits per set.
              </p>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">Brand name</label>
                  <input
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="e.g. Shark King Supply"
                    maxLength={80}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">Your niche</label>
                  <input
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    placeholder="e.g. luxury hip-hop streetwear"
                    maxLength={120}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">Style</label>
                  <div className="grid grid-cols-2 gap-2">
                    {STYLES.map((st) => (
                      <button
                        key={st.key}
                        onClick={() => setStyle(st.key)}
                        className={`rounded-xl border p-3 text-left transition ${
                          style === st.key
                            ? "border-primary bg-primary/10"
                            : "border-white/10 hover:border-white/25"
                        }`}
                      >
                        <div className={`text-sm font-bold ${style === st.key ? "text-primary" : ""}`}>{st.label}</div>
                        <div className="mt-0.5 text-xs text-white/40">{st.blurb}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">
                    Mock up on (up to 3)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRODUCTS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => toggleDesignProduct(p.key)}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                          designProducts.includes(p.key)
                            ? "border-primary bg-primary/15 text-primary"
                            : "border-white/10 text-white/50 hover:border-white/25"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                {!user && (
                  <p className="text-xs text-white/40">
                    <a href="/login" className="text-primary underline">Sign in</a> to design your brand kit.
                  </p>
                )}
                <button onClick={designBrandKit} disabled={designing || !user} className={goldBtn + " w-full"}>
                  {designing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Designing your brand kit…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Design my brand kit · {DESIGN_COST} credits
                    </>
                  )}
                </button>
                <p className="text-xs text-white/35">
                  Credits are only charged on success — if the AI fails, you're refunded automatically.
                </p>
              </div>
            </div>

            <div className="lg:col-span-3">
              {!design && !designing && (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 p-8 text-center">
                  <Palette className="mb-3 h-10 w-10 text-white/20" />
                  <p className="text-sm font-semibold text-white/50">Your brand kit appears here</p>
                  <p className="mt-1 max-w-sm text-xs text-white/35">
                    Logo, tagline, color palette, and product mockups — ready to slap on merch and sell.
                  </p>
                </div>
              )}
              {designing && (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-white/10 p-8 text-center">
                  <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm font-semibold">Designing logo + {designProducts.length} mockups…</p>
                  <p className="mt-1 text-xs text-white/40">This takes about a minute. Good brands take time.</p>
                </div>
              )}
              {design && (
                <div id="design-results" className="space-y-5">
                  <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
                    <div className="flex flex-wrap items-center gap-4">
                      <img
                        src={design.logo.url}
                        alt="AI-generated brand logo"
                        className="h-28 w-28 rounded-2xl border border-white/10 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-widest text-white/40">Brand identity</div>
                        {design.brief.tagline && (
                          <p className="mt-1 text-lg font-bold text-primary">“{design.brief.tagline}”</p>
                        )}
                        {design.brief.palette.length > 0 && (
                          <div className="mt-2 flex gap-2">
                            {design.brief.palette.map((c) => (
                              <span
                                key={c}
                                title={c}
                                className="h-8 w-8 rounded-full border border-white/20"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {design.mockups.map((m) => (
                      <div key={m.product} className="overflow-hidden rounded-2xl border border-white/10">
                        <img src={m.url} alt={`${productByKey(m.product).label} mockup`} className="aspect-square w-full object-cover" />
                        <div className="flex items-center justify-between bg-black/60 px-4 py-2.5">
                          <span className="text-sm font-semibold">{productByKey(m.product).label}</span>
                          <span className="text-sm font-bold text-primary">{money(productByKey(m.product).priceCents)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      switchTab("shop");
                    }}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    Love it? Sell it in the shop <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ORDERS TAB ───────────────────────────────────────── */}
        {tab === "orders" && (
          <div>
            {!user ? (
              <p className="text-sm text-white/50">
                <a href="/login" className="text-primary underline">Sign in</a> to see your orders.
              </p>
            ) : ordersLoading ? (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading orders…
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
                <Package className="mx-auto mb-3 h-10 w-10 text-white/20" />
                <p className="text-sm font-semibold text-white/50">No orders yet</p>
                <p className="mt-1 text-xs text-white/35">Your merch orders will show up here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((o) => (
                  <div key={o.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm">
                        <span className="font-mono text-white/40">#{o.id.slice(0, 8)}</span>
                        <span className="ml-3 text-white/40">
                          {new Date(o.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-300">
                        <Truck className="h-3.5 w-3.5" />
                        {o.status === "received" ? "Order received" : "Pending fulfillment"}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {o.items.map((it, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-white/60">
                            {it.qty}× {productByKey(it.product).label} · {it.color} · {it.size}
                          </span>
                          <span className="font-semibold">{money(it.unitPriceCents * it.qty)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-between border-t border-white/10 pt-3 text-sm font-bold">
                      <span>Total</span>
                      <span className="text-primary">{money(o.totalCents)}</span>
                    </div>
                    <p className="mt-2 text-xs text-white/35">
                      Dropship partner integration coming soon — we'll notify you when fulfillment goes live.
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* fulfillment honesty banner */}
        <div className="mt-12 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <Truck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-white/45">
            <span className="font-bold text-white/70">How fulfillment works:</span> this is a
            pure dropship store — manufacturers print and ship your merch directly to your
            fans, so you never touch inventory. Our dropship partner integration is coming
            soon: orders placed now are saved as <span className="text-white/70">received</span> and
            you'll be notified the moment fulfillment goes live. No payment is taken at checkout today.
          </p>
        </div>
      </main>

      {/* ── CART DRAWER ─────────────────────────────────────────── */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/70" onClick={() => setCartOpen(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col bg-neutral-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <ShoppingCart className="h-5 w-5 text-primary" /> Your cart
              </h2>
              <button onClick={() => setCartOpen(false)} className="p-1 text-white/50 hover:text-white" aria-label="Close cart">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {orderSuccess ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
                  <h3 className="font-bold text-emerald-300">Order received!</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{orderSuccess}</p>
                  <button
                    onClick={() => {
                      setOrderSuccess(null);
                      setCartOpen(false);
                      switchTab("orders");
                    }}
                    className={`${goldBtn} mt-5 w-full`}
                  >
                    View my orders
                  </button>
                </div>
              ) : cart.length === 0 ? (
                <div className="py-16 text-center">
                  <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-white/15" />
                  <p className="text-sm text-white/45">Your cart is empty.</p>
                  <button onClick={() => { setCartOpen(false); switchTab("shop"); }} className="mt-3 text-sm font-semibold text-primary hover:underline">
                    Browse the shop
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {cart.map((item, idx) => {
                    const p = productByKey(item.product);
                    return (
                      <div key={idx} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <p.icon className="h-6 w-6 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold">{p.label}</div>
                          <div className="text-xs text-white/40 capitalize">
                            {item.color} · {item.size}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <button onClick={() => updateQty(idx, -1)} className="rounded border border-white/10 p-0.5 text-white/60 hover:text-white" aria-label="Decrease">
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="text-xs font-bold">{item.qty}</span>
                            <button onClick={() => updateQty(idx, 1)} className="rounded border border-white/10 p-0.5 text-white/60 hover:text-white" aria-label="Increase">
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-primary">{money(p.priceCents * item.qty)}</div>
                          <button onClick={() => updateQty(idx, -item.qty)} className="mt-1 text-white/30 hover:text-red-400" aria-label="Remove item">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* checkout form */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <h3 className="mb-3 text-sm font-bold">Shipping details</h3>
                    <div className="space-y-2.5">
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={inputClass} />
                      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" className={inputClass} />
                      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" className={inputClass} />
                      <div className="grid grid-cols-3 gap-2.5">
                        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className={inputClass} />
                        <input value={state_} onChange={(e) => setState_(e.target.value)} placeholder="State" className={inputClass} />
                        <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" className={inputClass} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!orderSuccess && cart.length > 0 && (
              <div className="border-t border-white/10 p-5">
                <div className="mb-3 flex justify-between text-sm">
                  <span className="text-white/50">Total</span>
                  <span className="text-lg font-black text-primary">{money(cartTotal)}</span>
                </div>
                <button onClick={placeOrder} disabled={ordering || !user} className={goldBtn + " w-full"}>
                  {ordering ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Placing order…
                    </>
                  ) : (
                    <>Place order · {money(cartTotal)}</>
                  )}
                </button>
                <p className="mt-2 text-center text-xs text-white/35">
                  No payment taken today — dropship partner integration coming soon.
                </p>
                {!user && (
                  <p className="mt-1 text-center text-xs text-white/40">
                    <a href="/login" className="text-primary underline">Sign in</a> to check out.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}
