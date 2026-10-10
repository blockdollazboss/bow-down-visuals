import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Shirt, Loader2, Sparkles, ShoppingCart, Trash2, Plus, Minus,
  CheckCircle2, Package, Palette, Tag, Truck, X, ChevronRight,
  Smartphone, ShoppingBag, RefreshCw, CreditCard, ExternalLink, BadgeCheck,
  Nfc, Gem, Store, AlertTriangle, Download, Info, Pencil, Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import MerchDropPlanner from "@/components/wave8/MerchDropPlanner";
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
   only the AI brand-kit design costs credits (200 Visual Bucs per set). */

type TabKey = "shop" | "studio" | "orders" | "merch";

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
  snapback: Tag,
  poster: Palette,
  phonecase: Smartphone,
  tote: ShoppingBag,
  rug: Package,
};

/* Catalog lives in @/lib/branding-shop (testable); icons stay page-local. */
const PRODUCTS: Product[] = BRANDING_PRODUCTS.map((p) => ({ ...p, icon: ICONS[p.key] }));

/* Colors + order statuses live inside the component (via t()); the keys stay
   stable because they are stored on carts/orders sent to the backend. */

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
  logoUrl?: string; // For custom logo rugs — customer-uploaded logo
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
  provider: string;
  providerOrderId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  paid: boolean;
  createdAt: string;
}

const STATUS_DEFS: Record<string, { labelKey: string; className: string }> = {
  received:            { labelKey: "received",           className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  pending_fulfillment: { labelKey: "pendingFulfillment", className: "border-sky-400/30 bg-sky-400/10 text-sky-300" },
  in_production:       { labelKey: "inProduction",       className: "border-violet-400/30 bg-violet-400/10 text-violet-300" },
  shipped:             { labelKey: "shipped",            className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  delivered:           { labelKey: "delivered",          className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
  canceled:            { labelKey: "canceled",           className: "border-red-400/30 bg-red-400/10 text-red-300" },
  failed:              { labelKey: "failed",             className: "border-red-400/30 bg-red-400/10 text-red-300" },
};

const COLOR_DEFS: Array<{ key: ColorKey; labelKey: string; swatch: string }> = [
  { key: "black", labelKey: "black", swatch: "bg-neutral-900 border-white/20" },
  { key: "gold", labelKey: "gold", swatch: "bg-amber-400 border-amber-200" },
  { key: "white", labelKey: "white", swatch: "bg-white border-white/40" },
];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

function productByKey(key: ProductKey): Product {
  return PRODUCTS.find((p) => p.key === key)!;
}

export default function BrandingShop() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<TabKey>(() => {
    try { return new URLSearchParams(window.location.search).get("tab") === "merch" ? "merch" : "shop"; } catch { return "shop"; }
  });
  const [shopCat, setShopCat] = useState<"merch" | "smart" | "jewelry">("merch");

  /* Translated display strings for the color swatches and order statuses. */
  const COLORS: Array<{ key: ColorKey; label: string; swatch: string }> = COLOR_DEFS.map((c) => ({
    ...c,
    label: t(`brandingShop.colors.${c.labelKey}`),
  }));
  const STATUS_META: Record<string, { label: string; className: string }> = Object.fromEntries(
    Object.entries(STATUS_DEFS).map(([key, def]) => [
      key,
      { label: t(`brandingShop.statuses.${def.labelKey}`), className: def.className },
    ])
  );

  /* shop config state (per-product selections) */
  const [sel, setSel] = useState<Record<ProductKey, { color: ColorKey; size: string; qty: number }>>(() =>
    Object.fromEntries(
      PRODUCTS.map((p) => [p.key, { color: "black" as ColorKey, size: p.sizes[0], qty: 1 }])
    ) as Record<ProductKey, { color: ColorKey; size: string; qty: number }>
  );

  /* cart */
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  /* rug logo uploads: productKey -> { url, fileName } */
  const [rugLogos, setRugLogos] = useState<Record<string, { url: string; fileName: string }>>({});
  const [rugUploading, setRugUploading] = useState(false);

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
    // Rugs require a logo upload first
    if (product === "rug" && !rugLogos["rug"]) {
      setError("Please upload your logo first");
      return;
    }
    const logoUrl = product === "rug" ? rugLogos["rug"]?.url : undefined;
    setCart((prev) => {
      const idx = prev.findIndex(
        (i) => i.product === product && i.color === s.color && i.size === s.size
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: Math.min(99, next[idx].qty + s.qty) };
        return next;
      }
      return [...prev, { product, color: s.color, size: s.size, qty: s.qty, logoUrl }];
    });
    setCartOpen(true);
  }

  /* Upload logo for custom rug — stores URL for checkout */
  async function handleRugLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (PNG, JPG)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB");
      return;
    }
    setRugUploading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/branding-shop/upload-logo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Upload failed");
      }
      setRugLogos((prev) => ({
        ...prev,
        rug: { url: data.url!, fileName: file.name },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setRugUploading(false);
    }
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
      setError(t("brandingShop.errorBrandName"));
      return;
    }
    if (designProducts.length === 0) {
      setError(t("brandingShop.errorProducts"));
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
        throw new Error(data.message || data.error || t("brandingShop.errorDesignFailed"));
      }
      setDesign(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("design-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("brandingShop.errorDesignFailed"));
    } finally {
      setDesigning(false);
    }
  }

  const [checkingOut, setCheckingOut] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);

  /** Pay for an existing unpaid order (from My Orders). */
  async function payForOrder(orderId: string) {
    if (!user || paying) return;
    setPaying(orderId);
    setError(null);
    try {
      const res = await authed("/api/branding-shop/checkout", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        mock?: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || t("brandingShop.errorCheckoutFailed"));
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      /* Demo checkout completed instantly — refresh the list. */
      await loadOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("brandingShop.errorCheckoutFailed"));
    } finally {
      setPaying(null);
    }
  }

  async function placeOrder() {
    if (ordering || checkingOut || !user || cart.length === 0) return;
    if (!name.trim() || !email.trim() || !address.trim() || !city.trim() || !state_.trim() || !zip.trim()) {
      setError(t("brandingShop.errorShipping"));
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
        throw new Error(data.message || data.error || t("brandingShop.errorOrderFailed"));
      }
      const orderId = data.order.id;
      setOrdering(false);
      /* ── pay for it: Stripe Checkout (live) or instant demo checkout ── */
      setCheckingOut(true);
      const coRes = await authed("/api/branding-shop/checkout", {
        method: "POST",
        body: JSON.stringify({ orderId }),
      });
      const coData = (await coRes.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        mock?: boolean;
        demo?: boolean;
        error?: string;
        message?: string;
      };
      if (!coRes.ok) {
        throw new Error(coData.error || t("brandingShop.errorCheckoutSaved"));
      }
      if (coData.checkoutUrl) {
        window.location.href = coData.checkoutUrl;
        return;
      }
      setOrderSuccess(coData.message || t("brandingShop.orderReceived"));
      setCart([]);
      setCartOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("brandingShop.errorOrderFailed"));
    } finally {
      setOrdering(false);
      setCheckingOut(false);
    }
  }

  async function loadOrders() {
    if (!user) return;
    setOrdersLoading(true);
    try {
      const res = await authed("/api/branding-shop/orders");
      const data = (await res.json().catch(() => ({}))) as { orders?: Order[]; demo?: boolean };
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setDemoMode(!!data.demo);
    } catch {
      /* orders list is best-effort */
    } finally {
      setOrdersLoading(false);
    }
  }

  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  async function refreshOrder(orderId: string) {
    if (!user || refreshing) return;
    setRefreshing(orderId);
    try {
      const res = await authed(`/api/branding-shop/orders/${orderId}/refresh`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        trackingNumber?: string | null;
        trackingUrl?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || t("brandingShop.errorRefreshFailed"));
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? { ...o, status: data.status ?? o.status, trackingNumber: data.trackingNumber ?? o.trackingNumber, trackingUrl: data.trackingUrl ?? o.trackingUrl }
            : o
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("brandingShop.errorRefreshFailed"));
    } finally {
      setRefreshing(null);
    }
  }

  useEffect(() => {
    if (tab === "orders" && user) loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /* After Stripe checkout redirects back (?order=…&paid=1), land on My Orders. */
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("paid") === "1") {
        setTab("orders");
        setOrderSuccess(t("brandingShop.paymentReceived"));
        window.history.replaceState({}, "", "/branding-shop");
      }
    } catch {
      /* non-browser or malformed query — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-10">
        {orderSuccess && !cartOpen && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
            <div className="flex-1">
              <p className="text-sm font-bold text-emerald-300">{t("brandingShop.orderReceived")}</p>
              <p className="mt-1 text-sm text-white/60">{orderSuccess}</p>
            </div>
            <button onClick={() => setOrderSuccess(null)} className="p-1 text-white/40 hover:text-white" aria-label={t("brandingShop.dismissAria")}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {/* header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" /> {t("brandingShop.heroBadge")}
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              {t("brandingShop.title")} <span className="bg-gradient-to-r from-amber-400 to-yellow-200 bg-clip-text text-transparent">{t("brandingShop.titleAccent")}</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-white/50">
              {t("brandingShop.subtitle")}
            </p>
          </div>
          <button
            onClick={() => setCartOpen(true)}
            className="relative inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:border-primary/40"
          >
            <ShoppingCart className="h-4 w-4 text-primary" />
            {t("brandingShop.cartButton")}
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
              { key: "shop", label: t("brandingShop.tabs.shop") },
              { key: "studio", label: t("brandingShop.tabs.studio") },
              { key: "orders", label: t("brandingShop.tabs.orders") },
              { key: "merch", label: t("merch.tabs.merch", { defaultValue: t("merch.title") }) },
            ] as Array<{ key: TabKey; label: string }>
          ).map((t2) => (
            <button
              key={t2.key}
              onClick={() => switchTab(t2.key)}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                tab === t2.key
                  ? "bg-gradient-to-r from-amber-500 to-yellow-400 text-black"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {t2.label}
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
          <>
            {/* department pills: merch + smart cards + jewelry, one storefront */}
            <div className="mb-6 flex flex-wrap gap-2">
              {(
                [
                  { key: "merch", label: t("brandingShop.departments.merch"), icon: Shirt },
                  { key: "smart", label: t("brandingShop.departments.smart"), icon: Nfc },
                  { key: "jewelry", label: t("brandingShop.departments.jewelry"), icon: Gem },
                ] as Array<{ key: "merch" | "smart" | "jewelry"; label: string; icon: LucideIcon }>
              ).map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.key}
                    onClick={() => setShopCat(c.key)}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      shopCat === c.key
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-white/10 text-white/50 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {c.label}
                  </button>
                );
              })}
            </div>

            {shopCat === "smart" && (
              <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-neutral-900 via-black to-neutral-900">
                <div className="grid gap-0 md:grid-cols-2">
                  <div className="flex items-center justify-center p-10">
                    <div className="flex h-44 w-72 items-center justify-center rounded-2xl border border-primary/40 bg-gradient-to-br from-zinc-900 to-black shadow-[0_0_40px_rgba(234,179,8,0.15)]">
                      <Nfc className="h-16 w-16 text-primary" />
                    </div>
                  </div>
                  <div className="flex flex-col justify-center p-8">
                    <div className="mb-2 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      <Sparkles className="h-3.5 w-3.5" /> {t("brandingShop.smartCardsBadge")}
                    </div>
                    <h2 className="text-2xl font-black">{t("brandingShop.smartCardsTitle")}</h2>
                    <p className="mt-2 text-sm text-white/50">
                      {t("brandingShop.smartCardsText")}
                    </p>
                    <Link
                      href="/nfc-cards"
                      className="mt-5 inline-flex w-fit items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110"
                    >
                      {t("brandingShop.smartCardsCta")} <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {shopCat === "jewelry" && (
              <div className="overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-neutral-900 via-black to-neutral-900">
                <div className="grid gap-0 md:grid-cols-2">
                  <div className="flex items-center justify-center p-10">
                    <div
                      className="flex h-44 w-72 items-center justify-center rounded-2xl border border-white/10"
                      style={{ background: "linear-gradient(135deg,#8a6d1c,#d4af37 40%,#f5d76e 55%,#8a6d1c 100%)" }}
                    >
                      <Gem className="h-16 w-16 text-black/60" />
                    </div>
                  </div>
                  <div className="flex flex-col justify-center p-8">
                    <div className="mb-2 inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                      <Gem className="h-3.5 w-3.5" /> {t("brandingShop.jewelryBadge")}
                    </div>
                    <h2 className="text-2xl font-black">{t("brandingShop.jewelryTitle")}</h2>
                    <p className="mt-2 text-sm text-white/50">
                      {t("brandingShop.jewelryText")}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link
                        href="/jewelry-shop"
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110"
                      >
                        {t("brandingShop.jewelryCtaShop")} <ChevronRight className="h-4 w-4" />
                      </Link>
                      <Link
                        href="/jewelry"
                        className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-6 py-3 text-sm font-semibold text-white/70 transition hover:border-primary/40 hover:text-white"
                      >
                        <Palette className="h-4 w-4" /> {t("brandingShop.jewelryCtaStudio")}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {shopCat === "merch" && (
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
                      <span className="text-xs text-white/40">{t("brandingShop.colorLabel")}</span>
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
                      <span className="text-xs text-white/40">{t("brandingShop.sizeLabel")}</span>
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
                          aria-label={t("brandingShop.decreaseQtyAria")}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center text-sm font-bold">{s.qty}</span>
                        <button
                          onClick={() =>
                            setSel((prev) => ({ ...prev, [p.key]: { ...prev[p.key], qty: Math.min(99, prev[p.key].qty + 1) } }))
                          }
                          className="p-1 text-white/60 hover:text-white"
                          aria-label={t("brandingShop.increaseQtyAria")}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {/* Rug logo upload — required before adding to cart */}
                      {p.key === "rug" && (
                        <div className="mt-3">
                          {rugLogos["rug"] ? (
                            <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
                              <img
                                src={rugLogos["rug"].url}
                                alt="Uploaded logo"
                                className="h-12 w-12 rounded object-contain bg-white/10"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-primary truncate">
                                  {rugLogos["rug"].fileName}
                                </p>
                                <p className="text-[11px] text-white/40">Logo ready</p>
                              </div>
                              <button
                                onClick={() =>
                                  setRugLogos((prev) => {
                                    const next = { ...prev };
                                    delete next["rug"];
                                    return next;
                                  })
                                }
                                className="text-xs text-white/40 hover:text-white"
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-3 text-sm font-bold text-primary hover:border-primary/60 hover:bg-primary/10 transition">
                              <Upload className="h-4 w-4" />
                              {rugUploading ? "Uploading..." : "Upload your logo"}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={rugUploading}
                                onChange={handleRugLogoUpload}
                              />
                            </label>
                          )}
                        </div>
                      )}
                      <button onClick={() => addToCart(p.key)} className={`${goldBtn} flex-1 !px-4 !py-2.5`}>
                        <ShoppingCart className="h-4 w-4" /> {t("brandingShop.addToCart")}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
            )}
            {/* ── Wave 8: Merch Drop Planner — docks below the merch grid ── */}
            {shopCat === "merch" && (
              <div className="mt-12">
                <MerchDropPlanner />
              </div>
            )}
          </>
        )}

        {/* ── STUDIO TAB ───────────────────────────────────────── */}
        {tab === "studio" && (
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 lg:col-span-2">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Sparkles className="h-5 w-5 text-primary" /> {t("brandingShop.studioTitle")}
              </h2>
              <p className="mt-1 text-xs text-white/45">
                {t("brandingShop.studioSubtitle", { n: DESIGN_COST })}
              </p>
              <div className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("brandingShop.brandNameLabel")}</label>
                  <input
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder={t("brandingShop.brandNamePlaceholder")}
                    maxLength={80}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("brandingShop.nicheLabel")}</label>
                  <input
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    placeholder={t("brandingShop.nichePlaceholder")}
                    maxLength={120}
                    className={inputClass}
                  />
                </div>
                <div data-min-stars="2">
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">{t("brandingShop.styleLabel")}</label>
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
                <div data-min-stars="2">
                  <label className="mb-1.5 block text-xs font-semibold text-white/60">
                    {t("brandingShop.mockupLabel")}
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
                    <a href="/login" className="text-primary underline">{t("brandingShop.signIn")}</a> {t("brandingShop.signInToDesign")}
                  </p>
                )}
                <button onClick={designBrandKit} disabled={designing || !user} className={goldBtn + " w-full"}>
                  {designing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> {t("brandingShop.designingButton")}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> {t("brandingShop.designButton", { n: DESIGN_COST })}
                    </>
                  )}
                </button>
                <p className="text-xs text-white/35">
                  {t("brandingShop.refundNote")}
                </p>
              </div>
            </div>

            <div className="lg:col-span-3">
              {!design && !designing && (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 p-8 text-center">
                  <Palette className="mb-3 h-10 w-10 text-white/20" />
                  <p className="text-sm font-semibold text-white/50">{t("brandingShop.emptyDesignTitle")}</p>
                  <p className="mt-1 max-w-sm text-xs text-white/35">
                    {t("brandingShop.emptyDesignText")}
                  </p>
                </div>
              )}
              {designing && (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-white/10 p-8 text-center">
                  <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                  <p className="text-sm font-semibold">{t("brandingShop.designingStatus", { n: designProducts.length })}</p>
                  <p className="mt-1 text-xs text-white/40">{t("brandingShop.designingHint")}</p>
                </div>
              )}
              {design && (
                <div id="design-results" className="space-y-5">
                  <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
                    <div className="flex flex-wrap items-center gap-4">
                      <img
                        src={design.logo.url}
                        alt={t("brandingShop.logoAlt")}
                        className="h-28 w-28 rounded-2xl border border-white/10 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-widest text-white/40">{t("brandingShop.brandIdentityLabel")}</div>
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
                        <img src={m.url} alt={t("brandingShop.mockupAlt", { product: productByKey(m.product).label })} className="aspect-square w-full object-cover" />
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
                    {t("brandingShop.sellCta")} <ChevronRight className="h-4 w-4" />
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
                <a href="/login" className="text-primary underline">{t("brandingShop.signIn")}</a> {t("brandingShop.signInToSeeOrders")}
              </p>
            ) : ordersLoading ? (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("brandingShop.loadingOrders")}
              </div>
            ) : orders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
                <Package className="mx-auto mb-3 h-10 w-10 text-white/20" />
                <p className="text-sm font-semibold text-white/50">{t("brandingShop.noOrdersTitle")}</p>
                <p className="mt-1 text-xs text-white/35">{t("brandingShop.noOrdersText")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {demoMode && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-200">
                    <span className="font-bold">{t("brandingShop.demoFulfillmentTitle")}</span>{" "}
                    {t("brandingShop.demoFulfillmentText")}
                  </div>
                )}
                {orders.map((o) => {
                  const meta = STATUS_META[o.status] ?? STATUS_META.received!;
                  return (
                  <div key={o.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-white/40">#{o.id.slice(0, 8)}</span>
                        <span className="text-white/40">
                          {new Date(o.createdAt).toLocaleDateString()}
                        </span>
                        {o.paid && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                            <BadgeCheck className="h-3 w-3" /> {t("brandingShop.paidBadge")}
                          </span>
                        )}
                        {!o.paid && (
                          <button
                            onClick={() => payForOrder(o.id)}
                            disabled={paying === o.id}
                            className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary hover:bg-primary/20 disabled:opacity-50"
                          >
                            {paying === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />}
                            {t("brandingShop.payOrder", { amount: money(o.totalCents) })}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${meta.className}`}>
                          <Truck className="h-3.5 w-3.5" />
                          {meta.label}
                        </span>
                        {o.providerOrderId && (
                          <button
                            onClick={() => refreshOrder(o.id)}
                            disabled={refreshing === o.id}
                            className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/60 hover:text-white disabled:opacity-50"
                            title={t("brandingShop.refreshTitle")}
                          >
                            {refreshing === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                            {t("brandingShop.refreshButton")}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      {o.items.map((it, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-white/60">
                            {it.qty}× {productByKey(it.product).label} · {t(`brandingShop.colors.${it.color}`)} · {it.size}
                          </span>
                          <span className="font-semibold">{money(it.unitPriceCents * it.qty)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-between border-t border-white/10 pt-3 text-sm font-bold">
                      <span>{t("brandingShop.totalLabel")}</span>
                      <span className="text-primary">{money(o.totalCents)}</span>
                    </div>
                    {(o.trackingNumber || o.trackingUrl) && (
                      <p className="mt-2 text-xs text-white/55">
                        {t("brandingShop.trackingLabel")}{" "}
                        {o.trackingUrl ? (
                          <a href={o.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                            {o.trackingNumber ?? t("brandingShop.trackPackage")} <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="font-mono">{o.trackingNumber}</span>
                        )}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-white/35">
                      {o.provider === "printful"
                        ? t("brandingShop.providerNotePrintful")
                        : t("brandingShop.providerNoteDemo")}
                    </p>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── MERCH TAB — absorbed from /merch ── */}
        {tab === "merch" && (
          <MerchTab />
        )}

        {/* fulfillment honesty banner */}
        <div className="mt-12 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <Truck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed text-white/45">
            <span className="font-bold text-white/70">{t("brandingShop.fulfillmentTitle")}</span>{" "}
            {t("brandingShop.fulfillmentText", { n: DESIGN_COST })}
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
                <ShoppingCart className="h-5 w-5 text-primary" /> {t("brandingShop.cartTitle")}
              </h2>
              <button onClick={() => setCartOpen(false)} className="p-1 text-white/50 hover:text-white" aria-label={t("brandingShop.closeCartAria")}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {orderSuccess ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
                  <h3 className="font-bold text-emerald-300">{t("brandingShop.orderReceived")}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{orderSuccess}</p>
                  <button
                    onClick={() => {
                      setOrderSuccess(null);
                      setCartOpen(false);
                      switchTab("orders");
                    }}
                    className={`${goldBtn} mt-5 w-full`}
                  >
                    {t("brandingShop.viewOrders")}
                  </button>
                </div>
              ) : cart.length === 0 ? (
                <div className="py-16 text-center">
                  <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-white/15" />
                  <p className="text-sm text-white/45">{t("brandingShop.cartEmpty")}</p>
                  <button onClick={() => { setCartOpen(false); switchTab("shop"); }} className="mt-3 text-sm font-semibold text-primary hover:underline">
                    {t("brandingShop.browseShop")}
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
                            {t(`brandingShop.colors.${item.color}`)} · {item.size}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <button onClick={() => updateQty(idx, -1)} className="rounded border border-white/10 p-0.5 text-white/60 hover:text-white" aria-label={t("brandingShop.decreaseAria")}>
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="text-xs font-bold">{item.qty}</span>
                            <button onClick={() => updateQty(idx, 1)} className="rounded border border-white/10 p-0.5 text-white/60 hover:text-white" aria-label={t("brandingShop.increaseAria")}>
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold text-primary">{money(p.priceCents * item.qty)}</div>
                          <button onClick={() => updateQty(idx, -item.qty)} className="mt-1 text-white/30 hover:text-red-400" aria-label={t("brandingShop.removeItemAria")}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {/* checkout form */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <h3 className="mb-3 text-sm font-bold">{t("brandingShop.shippingTitle")}</h3>
                    <div className="space-y-2.5">
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("brandingShop.fullNamePlaceholder")} className={inputClass} />
                      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("brandingShop.emailPlaceholder")} type="email" className={inputClass} />
                      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("brandingShop.streetPlaceholder")} className={inputClass} />
                      <div className="grid grid-cols-3 gap-2.5">
                        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("brandingShop.cityPlaceholder")} className={inputClass} />
                        <input value={state_} onChange={(e) => setState_(e.target.value)} placeholder={t("brandingShop.statePlaceholder")} className={inputClass} />
                        <input value={zip} onChange={(e) => setZip(e.target.value)} placeholder={t("brandingShop.zipPlaceholder")} className={inputClass} />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!orderSuccess && cart.length > 0 && (
              <div className="border-t border-white/10 p-5">
                <div className="mb-3 flex justify-between text-sm">
                  <span className="text-white/50">{t("brandingShop.totalLabel")}</span>
                  <span className="text-lg font-black text-primary">{money(cartTotal)}</span>
                </div>
                <button onClick={placeOrder} disabled={ordering || !user} className={goldBtn + " w-full"}>
                  {ordering ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> {t("brandingShop.placingOrder")}
                    </>
                  ) : (
                    <>{t("brandingShop.placeOrder", { amount: money(cartTotal) })}</>
                  )}
                </button>
                <p className="mt-2 text-center text-xs text-white/35">
                  {t("brandingShop.noPaymentNote")}
                </p>
                {!user && (
                  <p className="mt-1 text-center text-xs text-white/40">
                    <a href="/login" className="text-primary underline">{t("brandingShop.signIn")}</a> {t("brandingShop.signInToCheckout")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MERCH TAB — the full /merch page (AI Merch Designer), absorbed as a tab.
   AI-designed merch for creators (dropship model): describe a design or
   pick a style → 300-Visual-Buc batch (registry: /api/merch/design) generates 2
   real product mockups → save to store, set your price, see your profit
   margin. Checkout is honestly "coming soon" — manufacturers ship directly
   when it goes live. The → /my-shop handoff is preserved. */

type MerchProductKey = "t-shirt" | "hoodie" | "cap" | "poster";
type MerchStyleKey = "streetwear" | "minimal" | "vintage" | "luxury-gold";

const MERCH_PRODUCTS: Array<{ key: MerchProductKey; baseCost: string; swatch: string }> = [
  { key: "t-shirt", baseCost: "$12.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#3b82f6 100%)" },
  { key: "hoodie", baseCost: "$28.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#8b5cf6 100%)" },
  { key: "cap", baseCost: "$15.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#f97316 100%)" },
  { key: "poster", baseCost: "$8.00 base", swatch: "linear-gradient(135deg,#1a1a1a 40%,#10b981 100%)" },
];

const MERCH_STYLES: Array<{ key: MerchStyleKey; swatch: string }> = [
  { key: "streetwear", swatch: "linear-gradient(135deg,#0a0a0a 40%,#ef4444 100%)" },
  { key: "minimal", swatch: "linear-gradient(135deg,#111 40%,#e5e5e5 100%)" },
  { key: "vintage", swatch: "linear-gradient(135deg,#0a0a0a 40%,#d97706 100%)" },
  { key: "luxury-gold", swatch: "linear-gradient(135deg,#0a0a0a 40%,#d4af37 100%)" },
];

interface MerchMockup {
  url: string;
  path: string;
}

interface MerchDesignResponse {
  status?: string;
  mockups?: MerchMockup[];
  product?: string;
  style?: string;
  title?: string;
  baseCostCents?: number;
  suggestedPriceCents?: number;
  commissionPct?: number;
  error?: string;
  message?: string;
  creditsRemaining?: number;
}

interface MerchStoreDesign {
  id: string;
  title: string;
  product: string;
  style: string;
  prompt: string | null;
  image_url: string;
  price_cents: number | null;
  base_cost_cents: number;
  status: string;
  margin: { profitCents: number; marginPct: number; commissionCents: number } | null;
  created_at: string;
}

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function MerchTab() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [innerTab, setInnerTab] = useState<"design" | "store">("design");

  /* ── Design studio state ── */
  const [product, setProduct] = useState<MerchProductKey>("t-shirt");
  const [style, setStyle] = useState<MerchStyleKey>("luxury-gold");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [mockups, setMockups] = useState<MerchMockup[]>([]);
  const [batchMeta, setBatchMeta] = useState<{ baseCostCents: number; suggestedPriceCents: number; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  /* ── Store state ── */
  const [designs, setDesigns] = useState<MerchStoreDesign[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [orderMsg, setOrderMsg] = useState<string | null>(null);

  async function loadStore() {
    setStoreLoading(true);
    try {
      const res = await fetch("/api/merch/designs");
      if (res.ok) {
        const data = await res.json();
        setDesigns(data.designs ?? []);
      }
    } catch {
      /* store stays empty on network error */
    } finally {
      setStoreLoading(false);
    }
  }

  useEffect(() => {
    if (innerTab === "store" && user) void loadStore();
  }, [innerTab, user]);

  async function generate() {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    setOutOfCredits(false);
    setMockups([]);
    setBatchMeta(null);
    setSavedIds(new Set());
    try {
      const res = await confirmedFetch("/api/merch/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product,
          style,
          description: description.trim(),
          title: title.trim(),
        }),
      });
      if (!res) return;
      const data: MerchDesignResponse = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok || data.status !== "succeeded" || !data.mockups?.length) {
        setError(data.error || data.message || t("merch.errorGenerate"));
        return;
      }
      setMockups(data.mockups);
      setBatchMeta({
        baseCostCents: data.baseCostCents ?? 0,
        suggestedPriceCents: data.suggestedPriceCents ?? 0,
        title: data.title ?? "Merch Design",
      });
      if (typeof data.creditsRemaining === "number") setCreditsRemaining(data.creditsRemaining);
    } catch {
      setError(t("merch.errorNetwork"));
    } finally {
      setBusy(false);
    }
  }

  async function saveToStore(m: MerchMockup) {
    try {
      const res = await fetch("/api/merch/designs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (title.trim() || batchMeta?.title || "Merch Design").slice(0, 80),
          product,
          style,
          prompt: description.trim(),
          imageUrl: m.url,
          imagePath: m.path,
          priceCents: batchMeta?.suggestedPriceCents ?? undefined,
          status: "draft",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSavedIds((s) => new Set(s).add(m.url));
        void data;
      }
    } catch {
      /* silent — user can retry */
    }
  }

  async function updateDesign(id: string, patch: { priceCents?: number | null; status?: string; title?: string }) {
    try {
      const res = await fetch(`/api/merch/designs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) void loadStore();
    } catch {
      /* silent */
    }
  }

  async function deleteDesign(id: string) {
    if (!window.confirm(t("merch.confirmDelete"))) return;
    try {
      const res = await fetch(`/api/merch/designs/${id}`, { method: "DELETE" });
      if (res.ok) void loadStore();
    } catch {
      /* silent */
    }
  }

  async function orderIntent(id: string) {
    setOrderMsg(null);
    try {
      const res = await fetch(`/api/merch/designs/${id}/order`, { method: "POST" });
      const data = await res.json();
      setOrderMsg(data.message ?? t("merch.checkoutSoon"));
    } catch {
      setOrderMsg(t("merch.checkoutSoon"));
    }
  }

  const canGenerate = !!user && !busy;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-center gap-3 mb-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Shirt className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-2xl font-black">{t("merch.title")}</h2>
          <p className="text-sm text-white/45">{t("merch.subtitle")}</p>
          <Link href="/my-shop" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
            <Store className="h-3.5 w-3.5" />{t("merch.myShopLink", { defaultValue: "Sell this in my shop" })} →
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-1.5">
        {(
          [
            { key: "design", icon: Sparkles },
            { key: "store", icon: Store },
          ] as const
        ).map((tabItem) => (
          <button
            key={tabItem.key}
            type="button"
            onClick={() => setInnerTab(tabItem.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
              innerTab === tabItem.key ? "bg-primary text-black" : "text-white/50 hover:text-white"
            }`}
          >
            <tabItem.icon className="h-4 w-4" /> {t(`merch.tabs.${tabItem.key}`)}
          </button>
        ))}
      </div>

      {outOfCredits && (
        <div className="mt-4"><OutOfCredits /></div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-200/80">{error}</p>
        </div>
      )}

      {/* ═══════════ DESIGN STUDIO ═══════════ */}
      {innerTab === "design" && (
        <div className="mt-6 space-y-5">
          {/* Product picker */}
          <div>
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("merch.productLabel")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MERCH_PRODUCTS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setProduct(p.key)}
                  className={`rounded-xl border p-3 text-left transition ${
                    product === p.key
                      ? "border-primary/60 bg-primary/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <span className="block h-10 rounded-lg mb-2" style={{ background: p.swatch }} />
                  <p className="font-bold text-white text-sm">{t(`merch.products.${p.key}.label`)}</p>
                  <p className="text-xs text-white/40 mt-0.5">{t(`merch.products.${p.key}.blurb`)}</p>
                  <p className="text-[11px] text-primary/80 mt-1 font-semibold">{p.baseCost}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Style picker */}
          <div>
            <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">{t("merch.styleLabel")}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MERCH_STYLES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStyle(s.key)}
                  className={`rounded-xl border p-3 text-left transition ${
                    style === s.key
                      ? "border-primary/60 bg-primary/[0.08]"
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <span className="block h-10 rounded-lg mb-2" style={{ background: s.swatch }} />
                  <p className="font-bold text-white text-sm">{t(`merch.styles.${s.key}.label`)}</p>
                  <p className="text-xs text-white/40 mt-0.5">{t(`merch.styles.${s.key}.blurb`)}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Title + description */}
          <div>
            <label className="text-xs font-bold text-white/40 uppercase tracking-wider">{t("merch.designTitleLabel")}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("merch.titlePlaceholder")}
              maxLength={80}
              className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-white/40 uppercase tracking-wider">
              {t("merch.describeLabel")} <span className="text-white/25 normal-case font-normal">{t("merch.describeHint")}</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("merch.descriptionPlaceholder")}
              maxLength={500}
              rows={3}
              className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60 resize-none"
            />
          </div>

          <button
            onClick={generate}
            disabled={!canGenerate}
            className="w-full rounded-2xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4" /> {t("merch.generateButton")}</span>
          </button>
          {creditsRemaining != null && (
            <p className="text-center text-xs text-white/35">{t("merch.creditsRemaining", { count: creditsRemaining })}</p>
          )}

          {/* Progress */}
          {busy && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
              <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
              <p className="font-bold text-white">{t("merch.designing")}</p>
              <p className="text-sm text-white/40 mt-1">{t("merch.designingDetail")}</p>
            </div>
          )}

          {/* Batch results */}
          {mockups.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2.5 rounded-xl border border-green-500/25 bg-green-500/5 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                <p className="text-sm font-semibold text-white/80">
                  {t("merch.mockupsReady")}{batchMeta ? <> — {t("merch.suggestedRetail", { price: fmtCents(batchMeta.suggestedPriceCents) })}</> : null}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {mockups.map((m) => (
                  <div key={m.url} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3">
                    <img src={m.url} alt={t("merch.mockupAlt")} className="w-full rounded-xl aspect-square object-cover" />
                    <div className="mt-3 flex gap-2">
                      <a
                        href={m.url}
                        download="merch-mockup.png"
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white hover:bg-white/[0.1] transition"
                      >
                        <Download className="h-4 w-4" /> {t("merch.download")}
                      </a>
                      <button
                        onClick={() => void saveToStore(m)}
                        disabled={savedIds.has(m.url)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black hover:brightness-110 transition disabled:opacity-50"
                      >
                        {savedIds.has(m.url) ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        {savedIds.has(m.url) ? t("merch.saved") : t("merch.saveToStore")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setMockups([]); setBatchMeta(null); setSavedIds(new Set()); }}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/[0.12] px-6 py-3.5 font-semibold text-white/70 hover:border-white/25 transition"
              >
                <RefreshCw className="h-4 w-4" /> {t("merch.newBatch")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ MY STORE ═══════════ */}
      {innerTab === "store" && (
        <div className="mt-6 space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
            <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-white/70">
              <span className="font-bold text-white">{t("merch.dropshipTitle")}</span> {t("merch.dropshipDesc")}{" "}
              <span className="font-bold text-primary">{t("merch.comingSoon")}</span>{t("merch.dropshipEnd")}
            </p>
          </div>

          {orderMsg && (
            <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
              <ShoppingBag className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <p className="text-sm text-white/75">{orderMsg}</p>
            </div>
          )}

          {storeLoading && (
            <div className="text-center py-10">
              <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto mb-3" />
              <p className="text-sm text-white/40">{t("merch.loadingStore")}</p>
            </div>
          )}

          {!storeLoading && designs.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/[0.12] px-6 py-12 text-center">
              <Store className="h-8 w-8 text-white/25 mx-auto mb-3" />
              <p className="font-bold text-white/70">{t("merch.noDesigns")}</p>
              <p className="text-sm text-white/40 mt-1">{t("merch.noDesignsDetail")}</p>
              <button
                onClick={() => setInnerTab("design")}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 transition"
              >
                <Sparkles className="h-4 w-4" /> {t("merch.startDesigning")}
              </button>
            </div>
          )}

          {designs.map((d) => {
            const priceInput = priceEdits[d.id] ?? (d.price_cents != null ? (d.price_cents / 100).toFixed(2) : "");
            const priceCents = Math.round(Number.parseFloat(priceInput || "0") * 100);
            const validPrice = priceInput.trim() !== "" && Number.isFinite(priceCents) && priceCents >= 0;
            const commission = validPrice ? Math.round((priceCents * 15) / 100) : 0;
            const profit = validPrice ? priceCents - d.base_cost_cents - commission : null;
            return (
              <div key={d.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 sm:flex gap-4">
                <img src={d.image_url} alt={d.title} className="w-full sm:w-36 aspect-square rounded-xl object-cover shrink-0" />
                <div className="mt-3 sm:mt-0 flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-white truncate">{d.title}</p>
                      <p className="text-xs text-white/40 capitalize mt-0.5">{d.product} · {d.style.replace("-", " ")}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                      d.status === "listed" ? "bg-green-500/15 text-green-300" : "bg-white/[0.06] text-white/50"
                    }`}>
                      {d.status}
                    </span>
                  </div>

                  {/* Price + margin */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.12] bg-white/[0.03] px-3 py-2">
                      <Tag className="h-3.5 w-3.5 text-white/40" />
                      <input
                        value={priceInput}
                        onChange={(e) => setPriceEdits((p) => ({ ...p, [d.id]: e.target.value }))}
                        placeholder={t("merch.pricePlaceholder")}
                        inputMode="decimal"
                        className="w-20 bg-transparent text-sm font-bold text-white placeholder:text-white/25 outline-none"
                      />
                    </div>
                    <button
                      onClick={() => validPrice && void updateDesign(d.id, { priceCents })}
                      disabled={!validPrice}
                      className="rounded-xl bg-white/[0.06] px-4 py-2 text-sm font-bold text-white hover:bg-white/[0.1] transition disabled:opacity-40"
                    >
                      {t("merch.setPrice")}
                    </button>
                    {d.status === "draft" ? (
                      <button
                        onClick={() => void updateDesign(d.id, { status: "listed" })}
                        className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black hover:brightness-110 transition"
                      >
                        {t("merch.listForSale")}
                      </button>
                    ) : (
                      <button
                        onClick={() => void updateDesign(d.id, { status: "draft" })}
                        className="rounded-xl border border-white/[0.12] px-4 py-2 text-sm font-semibold text-white/70 hover:border-white/25 transition"
                      >
                        {t("merch.unlist")}
                      </button>
                    )}
                    <button
                      onClick={() => void deleteDesign(d.id)}
                      className="rounded-xl p-2 text-white/40 hover:text-red-300 hover:bg-red-500/10 transition"
                      aria-label={t("merch.deleteDesign")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Margin readout */}
                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-white/40">{t("merch.baseCost")} <span className="text-white/70 font-semibold">{fmtCents(d.base_cost_cents)}</span></span>
                    {profit != null && (
                      <>
                        <span className="text-white/40">{t("merch.platformFee")} <span className="text-white/70 font-semibold">{fmtCents(commission)}</span></span>
                        <span className={`font-bold ${profit >= 0 ? "text-green-300" : "text-red-300"}`}>
                          {t("merch.yourProfit")} {fmtCents(profit)}{" "}
                          <span className="font-normal opacity-70">
                            ({t("merch.marginPct", { pct: priceCents > 0 ? Math.round((profit / priceCents) * 100) : 0 })})
                          </span>
                        </span>
                      </>
                    )}
                  </div>

                  {d.status === "listed" && (
                    <button
                      onClick={() => void orderIntent(d.id)}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/10 transition"
                    >
                      <ShoppingBag className="h-4 w-4" /> {t("merch.previewCheckout")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {designs.length > 0 && (
            <p className="flex items-center gap-2 text-xs text-white/35">
              <Pencil className="h-3.5 w-3.5" /> {t("merch.priceNote")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
