import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ShoppingBag, Loader2, Plus, Trash2, Pencil, Sparkles, Radio,
  Bell, Pin, PinOff, Play, Square, TrendingUp, AlertTriangle,
  CheckCircle2, ExternalLink, DollarSign, Users, Zap, X,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { buildAlertText } from "@/lib/live-shopping";

/* ─── Live Shopping ─────────────────────────────────────────────────────
   Sell products during live streams: a product catalog, a live overlay
   (pin products, fire purchase alerts), and a sales dashboard with
   revenue per stream.

   Pricing: setting everything up is FREE (pure interface — the standing
   pricing rule). The business model is a 5% platform fee on sales made
   through the platform. One AI feature costs credits: the AI product
   description writer (1 credit, charged before the call, refunded on
   provider failure).

   Honest v1 boundaries (shown in the UI, never hidden):
   - Platform checkout is "coming soon": buy buttons open the creator's
     own checkout URL in a new tab.
   - Sales and purchase alerts recorded here are TEST sales until
     platform checkout ships — every response and the dashboard say so. */

interface Product {
  id: string;
  name: string;
  price_cents: number;
  price: string;
  image_url: string | null;
  external_url: string | null;
  description: string | null;
  is_active: boolean;
}

interface Stream {
  id: string;
  title: string;
  status: string;
  pinned_product_id: string | null;
  started_at: string | null;
}

interface ShopAlert {
  id: string;
  buyer_name: string;
  quantity: number;
  total: string;
  total_cents: number;
  created_at: string;
}

interface DashboardData {
  totals: {
    sales: number;
    revenue: string;
    revenue_cents: number;
    platform_fees: string;
    creator_payout: string;
    fee_bps: number;
  };
  per_stream: Array<{
    stream_id: string;
    title: string;
    sales: number;
    revenue: string;
    fees: string;
  }>;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-[#f5d76e] to-[#b8860b] px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed";

const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-primary/50 hover:text-white";

type Tab = "products" | "overlay" | "dashboard";

export default function LiveShopping() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState<Product[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* product form */
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiDesc, setAiDesc] = useState(false);

  /* overlay */
  const [activeStream, setActiveStream] = useState<Stream | null>(null);
  const [streamTitle, setStreamTitle] = useState("");
  const [alerts, setAlerts] = useState<ShopAlert[]>([]);
  const [testBuyer, setTestBuyer] = useState("");
  const [overlayKey, setOverlayKey] = useState(0);
  const pollRef = useRef<number | null>(null);

  const authHeaders = useCallback(async () => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }, [getAccessToken]);

  const loadAll = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const [catRes, streamRes, dashRes] = await Promise.all([
        fetch("/api/live-shopping/catalog", { headers }),
        fetch("/api/live-shopping/streams", { headers }),
        fetch("/api/live-shopping/dashboard", { headers }),
      ]);
      if (!catRes.ok || !streamRes.ok || !dashRes.ok) throw new Error("Failed to load live shopping data.");
      const cat = await catRes.json();
      const s = await streamRes.json();
      const d = await dashRes.json();
      setProducts(cat.products ?? []);
      setStreams(s.streams ?? []);
      setDashboard(d);
      const live = (s.streams ?? []).find((x: Stream) => x.status === "live") ?? null;
      setActiveStream(live);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [user, authHeaders]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  /* poll the alert feed for the active stream so the overlay pops in real time */
  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (!activeStream || !user) return;
    const poll = async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/live-shopping/streams/${activeStream.id}/alerts`, { headers });
        if (!res.ok) return;
        const data = await res.json();
        setAlerts(data.alerts ?? []);
      } catch {
        /* overlay polling is best-effort */
      }
    };
    poll();
    pollRef.current = window.setInterval(poll, 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [activeStream, user, authHeaders, overlayKey]);

  const resetForm = () => {
    setEditing(null);
    setName("");
    setPrice("");
    setImageUrl("");
    setExternalUrl("");
    setDescription("");
    setFormOpen(false);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setName(p.name);
    setPrice((p.price_cents / 100).toFixed(2));
    setImageUrl(p.image_url ?? "");
    setExternalUrl(p.external_url ?? "");
    setDescription(p.description ?? "");
    setFormOpen(true);
  };

  const saveProduct = async () => {
    const priceCents = Math.round(Number.parseFloat(price || "0") * 100);
    if (!name.trim() || !Number.isFinite(priceCents) || priceCents < 0) {
      setError("Give the product a name and a valid price.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const body = {
        name: name.trim(),
        price_cents: priceCents,
        image_url: imageUrl.trim() || undefined,
        external_url: externalUrl.trim() || undefined,
        description: description.trim() || undefined,
      };
      const res = editing
        ? await fetch(`/api/live-shopping/products/${editing.id}`, { method: "PATCH", headers, body: JSON.stringify(body) })
        : await fetch("/api/live-shopping/products", { method: "POST", headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save product.");
      }
      resetForm();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save product.");
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!window.confirm("Delete this product?")) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/live-shopping/products/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed to delete product.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete product.");
    }
  };

  const generateAiDescription = async () => {
    if (!name.trim()) {
      setError("Enter a product name first, then let AI write the description.");
      return;
    }
    setAiDesc(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/live-shopping/ai-description", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: name.trim(), selling_points: description.trim() || undefined }),
      });
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "AI description failed.");
      }
      const data = await res.json();
      setDescription(data.description ?? "");
      refreshProfile?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI description failed.");
    } finally {
      setAiDesc(false);
    }
  };

  const startStream = async () => {
    if (!streamTitle.trim()) {
      setError("Give your selling stream a title first.");
      return;
    }
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/live-shopping/streams", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: streamTitle.trim() }),
      });
      if (!res.ok) throw new Error("Failed to start stream.");
      const data = await res.json();
      setActiveStream(data.stream);
      setStreamTitle("");
      setOverlayKey((k) => k + 1);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start stream.");
    }
  };

  const endStream = async () => {
    if (!activeStream) return;
    try {
      const headers = await authHeaders();
      await fetch(`/api/live-shopping/streams/${activeStream.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ status: "ended", pinned_product_id: null }),
      });
      setActiveStream(null);
      setAlerts([]);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to end stream.");
    }
  };

  const pinProduct = async (productId: string | null) => {
    if (!activeStream) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/live-shopping/streams/${activeStream.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ pinned_product_id: productId }),
      });
      if (!res.ok) throw new Error("Failed to pin product.");
      const data = await res.json();
      setActiveStream(data.stream);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to pin product.");
    }
  };

  const fireTestAlert = async (product: Product) => {
    if (!activeStream) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`/api/live-shopping/streams/${activeStream.id}/alerts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          product_id: product.id,
          buyer_name: testBuyer.trim() || "A viewer",
          quantity: 1,
        }),
      });
      if (!res.ok) throw new Error("Failed to fire alert.");
      /* also record a test sale so the dashboard reflects it */
      await fetch("/api/live-shopping/sales", {
        method: "POST",
        headers,
        body: JSON.stringify({ product_id: product.id, stream_id: activeStream.id, quantity: 1 }),
      });
      setOverlayKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fire alert.");
    }
  };

  const pinned = products.find((p) => p.id === activeStream?.pinned_product_id) ?? null;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-5 md:px-8 pb-24">
        {/* hero */}
        <section className="pt-14 pb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
            Live Shopping
          </div>
          <h1 className="mt-5 text-4xl md:text-6xl font-black tracking-tight">
            Sell <span className="bg-gradient-to-b from-[#f5d76e] to-[#b8860b] bg-clip-text text-transparent">live</span> on stream
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/60 text-sm md:text-base leading-relaxed">
            Pin products in your overlay, fire animated purchase alerts when viewers buy,
            and track revenue per stream. Free to set up — a 5% fee only applies to
            sales made through the platform.
          </p>
          <div className="mx-auto mt-4 flex max-w-2xl items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-left">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
            <p className="text-xs leading-relaxed text-amber-100/80">
              Platform checkout is <strong>coming soon</strong>. Buy buttons currently open your
              own checkout link, and sales/alerts recorded here are <strong>test sales</strong> —
              nothing charges anyone.
            </p>
          </div>
        </section>

        {!user ? (
          <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
            <Zap className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <h2 className="mt-3 text-xl font-bold">Sign in to open your shop</h2>
            <p className="mt-2 text-sm text-white/55">Your product catalog and selling streams live in your account.</p>
            <Link href="/login" className={`${goldBtn} mt-5 w-full`}>Sign In</Link>
          </div>
        ) : (
          <>
            {/* tabs */}
            <div className="flex justify-center gap-2">
              {(
                [
                  { key: "products", label: "Products", icon: ShoppingBag },
                  { key: "overlay", label: "Live Overlay", icon: Radio },
                  { key: "dashboard", label: "Dashboard", icon: TrendingUp },
                ] as Array<{ key: Tab; label: string; icon: typeof ShoppingBag }>
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                    tab === t.key
                      ? "bg-primary/20 text-primary border border-primary/50"
                      : "text-white/55 border border-white/10 hover:text-white"
                  }`}
                >
                  <t.icon className="h-4 w-4" aria-hidden="true" />
                  {t.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="mx-auto mt-6 flex max-w-2xl items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/[0.06] px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden="true" />
                <p className="text-xs text-red-100/80">{error}</p>
                <button onClick={() => setError(null)} className="ml-auto text-white/40 hover:text-white" aria-label="Dismiss">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center gap-3 py-16 text-white/50">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
                Loading your shop…
              </div>
            ) : (
              <>
                {/* ── PRODUCTS ── */}
                {tab === "products" && (
                  <section className="mt-8">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold">Product catalog</h2>
                      <button onClick={() => { resetForm(); setFormOpen(true); }} className={ghostBtn}>
                        <Plus className="h-4 w-4" aria-hidden="true" /> Add product
                      </button>
                    </div>

                    {formOpen && (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                        <h3 className="font-bold">{editing ? "Edit product" : "New product"}</h3>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Product name *" className={inputClass} />
                          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (USD), e.g. 24.99 *" inputMode="decimal" className={inputClass} />
                          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="Image URL" className={inputClass} />
                          <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="Your checkout link (Stripe/Shopify…)" className={inputClass} />
                        </div>
                        <div className="mt-4">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-semibold uppercase tracking-wider text-white/40">Description</label>
                            <button onClick={generateAiDescription} disabled={aiDesc} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50">
                              {aiDesc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                              Write with AI · 1 credit
                            </button>
                          </div>
                          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What makes it worth buying on stream?" rows={3} className={`${inputClass} mt-2`} />
                        </div>
                        <div className="mt-4 flex gap-3">
                          <button onClick={saveProduct} disabled={saving} className={goldBtn}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {editing ? "Save changes" : "Add product"}
                          </button>
                          <button onClick={resetForm} className={ghostBtn}>Cancel</button>
                        </div>
                      </div>
                    )}

                    <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {products.map((p) => (
                        <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="h-32 w-full rounded-xl object-cover" loading="lazy" />
                          ) : (
                            <div className="flex h-32 w-full items-center justify-center rounded-xl bg-white/[0.04]">
                              <ShoppingBag className="h-8 w-8 text-white/20" aria-hidden="true" />
                            </div>
                          )}
                          <div className="mt-3 flex items-start justify-between gap-2">
                            <h3 className="font-bold leading-tight">{p.name}</h3>
                            <span className="shrink-0 rounded-lg bg-primary/15 px-2.5 py-1 text-sm font-bold text-primary">{p.price}</span>
                          </div>
                          {p.description && <p className="mt-2 line-clamp-2 text-xs text-white/50">{p.description}</p>}
                          <div className="mt-4 flex gap-2">
                            <button onClick={() => openEdit(p)} className={`${ghostBtn} flex-1 !px-2 !py-2 text-xs`}>
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </button>
                            <button onClick={() => deleteProduct(p.id)} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-400/25 bg-red-400/[0.05] px-2 py-2 text-xs font-semibold text-red-200/80 transition hover:border-red-400/50">
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {products.length === 0 && !formOpen && (
                      <p className="mt-8 text-center text-sm text-white/40">No products yet — add your first one to start selling on stream.</p>
                    )}
                  </section>
                )}

                {/* ── OVERLAY ── */}
                {tab === "overlay" && (
                  <section className="mt-8">
                    {!activeStream ? (
                      <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
                        <Radio className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
                        <h2 className="mt-3 text-xl font-bold">Start a selling stream</h2>
                        <p className="mt-2 text-sm text-white/55">Pin products and fire purchase alerts while you're live.</p>
                        <input value={streamTitle} onChange={(e) => setStreamTitle(e.target.value)} placeholder="Stream title, e.g. Friday merch drop" className={`${inputClass} mt-5`} />
                        <button onClick={startStream} className={`${goldBtn} mt-4 w-full`}>
                          <Play className="h-4 w-4" /> Go live
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-6 lg:grid-cols-2">
                        {/* overlay preview */}
                        <div>
                          <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold">Overlay preview</h2>
                            <button onClick={endStream} className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/25 bg-red-400/[0.05] px-3 py-2 text-xs font-semibold text-red-200/80 hover:border-red-400/50">
                              <Square className="h-3.5 w-3.5" /> End stream
                            </button>
                          </div>
                          <div className="relative mt-4 aspect-video overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#141414] to-black">
                            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1 text-xs font-bold">
                              <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> LIVE
                            </div>
                            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-white/25">
                              <Radio className="mx-auto h-10 w-10" aria-hidden="true" />
                              <p className="mt-2 text-xs">Your stream scene goes here</p>
                            </div>
                            {/* pinned product card */}
                            {pinned && (
                              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-xl border border-primary/50 bg-black/85 p-3 backdrop-blur">
                                {pinned.image_url && <img src={pinned.image_url} alt="" className="h-12 w-12 rounded-lg object-cover" />}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-bold">{pinned.name}</p>
                                  <p className="text-sm font-black text-primary">{pinned.price}</p>
                                </div>
                                {pinned.external_url ? (
                                  <a href={pinned.external_url} target="_blank" rel="noreferrer" className={`${goldBtn} !px-4 !py-2 text-xs`}>
                                    Buy <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ) : (
                                  <span className="text-[10px] text-white/40">Link coming soon</span>
                                )}
                              </div>
                            )}
                            {/* purchase alerts */}
                            <div className="absolute right-3 top-12 flex w-56 flex-col gap-2">
                              {alerts.slice(0, 3).map((a) => (
                                <div key={a.id} className="animate-[pop_0.4s_ease-out] rounded-xl border border-primary/60 bg-black/90 p-3 shadow-[0_0_20px_rgba(212,175,55,0.4)]">
                                  <div className="flex items-center gap-1.5 text-primary">
                                    <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                                    <span className="text-[10px] font-bold uppercase tracking-wider">Purchase!</span>
                                  </div>
                                  <p className="mt-1 text-xs font-semibold">{buildAlertText(a.buyer_name, a.quantity, a.total_cents)}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                          <p className="mt-3 text-xs text-white/40">
                            Capture this in OBS as a browser source. Alerts refresh every few seconds.
                          </p>
                        </div>

                        {/* controls */}
                        <div>
                          <h2 className="text-xl font-bold">Stream controls</h2>
                          <p className="mt-1 text-xs text-white/45">“{activeStream.title}” is live</p>

                          <h3 className="mt-5 text-sm font-bold text-white/70">Pin a product in the overlay</h3>
                          <div className="mt-2 grid gap-2">
                            {products.filter((p) => p.is_active).map((p) => (
                              <button
                                key={p.id}
                                onClick={() => pinProduct(activeStream.pinned_product_id === p.id ? null : p.id)}
                                className={`flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm transition ${
                                  activeStream.pinned_product_id === p.id
                                    ? "border-primary/60 bg-primary/10"
                                    : "border-white/10 bg-white/[0.02] hover:border-primary/40"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  {activeStream.pinned_product_id === p.id ? <PinOff className="h-4 w-4 text-primary" /> : <Pin className="h-4 w-4 text-white/40" />}
                                  <span className="font-semibold">{p.name}</span>
                                </span>
                                <span className="text-primary font-bold">{p.price}</span>
                              </button>
                            ))}
                            {products.length === 0 && <p className="text-xs text-white/40">Add products first, then pin one here.</p>}
                          </div>

                          <h3 className="mt-5 text-sm font-bold text-white/70">Fire a test purchase alert</h3>
                          <p className="text-[11px] text-white/35">Test alerts only — no real payments until platform checkout ships.</p>
                          <div className="mt-2 flex gap-2">
                            <input value={testBuyer} onChange={(e) => setTestBuyer(e.target.value)} placeholder="Buyer name (optional)" className={`${inputClass} !py-2.5`} />
                          </div>
                          <div className="mt-2 grid gap-2">
                            {products.filter((p) => p.is_active).map((p) => (
                              <button key={p.id} onClick={() => fireTestAlert(p)} className={`${ghostBtn} justify-between !py-2.5`}>
                                <span className="flex items-center gap-2"><Bell className="h-4 w-4 text-primary" /> {p.name}</span>
                                <span className="text-xs text-white/40">test alert</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {/* ── DASHBOARD ── */}
                {tab === "dashboard" && dashboard && (
                  <section className="mt-8">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold">Sales dashboard</h2>
                      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">Test data</span>
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                        <div className="flex items-center gap-2 text-white/45"><DollarSign className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wider">Revenue</span></div>
                        <p className="mt-2 text-3xl font-black text-primary">{dashboard.totals.revenue}</p>
                        <p className="mt-1 text-xs text-white/40">{dashboard.totals.sales} test sales</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                        <div className="flex items-center gap-2 text-white/45"><Zap className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wider">Platform fees (5%)</span></div>
                        <p className="mt-2 text-3xl font-black">{dashboard.totals.platform_fees}</p>
                        <p className="mt-1 text-xs text-white/40">your payout: {dashboard.totals.creator_payout}</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                        <div className="flex items-center gap-2 text-white/45"><Users className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-wider">Streams</span></div>
                        <p className="mt-2 text-3xl font-black">{dashboard.per_stream.length}</p>
                        <p className="mt-1 text-xs text-white/40">selling sessions</p>
                      </div>
                    </div>
                    <h3 className="mt-8 text-sm font-bold text-white/70">Revenue per stream</h3>
                    <div className="mt-3 overflow-hidden rounded-2xl border border-white/10">
                      {dashboard.per_stream.length === 0 ? (
                        <p className="p-6 text-center text-sm text-white/40">No streams yet — go live from the overlay tab.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-white/10 bg-white/[0.02] text-left text-xs uppercase tracking-wider text-white/40">
                              <th className="px-5 py-3">Stream</th>
                              <th className="px-5 py-3">Sales</th>
                              <th className="px-5 py-3">Revenue</th>
                              <th className="px-5 py-3">Fees</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dashboard.per_stream.map((r) => (
                              <tr key={r.stream_id} className="border-b border-white/5 last:border-0">
                                <td className="px-5 py-3 font-semibold">{r.title}</td>
                                <td className="px-5 py-3 text-white/60">{r.sales}</td>
                                <td className="px-5 py-3 font-bold text-primary">{r.revenue}</td>
                                <td className="px-5 py-3 text-white/60">{r.fees}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}

        {/* cross-link */}
        <p className="mt-12 text-center text-sm text-white/40">
          Running drops on stream? Grab matching graphics in{" "}
          <Link href="/stream-pack" className="font-semibold text-primary hover:underline">Stream Pack Generator</Link>.
        </p>
      </main>
      <SiteFooter />
      {outOfCredits && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOutOfCredits(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <OutOfCredits />
          </div>
        </div>
      )}
    </div>
  );
}
