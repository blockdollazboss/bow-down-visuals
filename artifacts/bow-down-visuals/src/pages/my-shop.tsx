import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Store, Plus, Loader2, Sparkles, Trash2, Pencil, ExternalLink,
  ShoppingBag, ImagePlus, Check, X, Globe, Palette, ArrowLeft, Copy, BadgeCheck,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { centsToDisplay, dollarsToCents } from "@/lib/shops";

/* ─── My Shop — the customer storefront builder ──────────────────────────
   Your own shop on the Bow Down Visuals platform. Shop/product CRUD is
   FREE (pure data). The AI layer costs credits: AI shop description and
   AI product description at 1 credit each, AI product images at 1 credit
   (standard) / 2 credits (premium). Custom domains are REAL: TXT verification
   via /api/storefronts/domain/verify — never faked. */

interface Shop {
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
  product_count?: number;
}

interface Product {
  id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none";

const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50 disabled:pointer-events-none";

export default function MyShop() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShop, setActiveShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* create-shop form */
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [newTagline, setNewTagline] = useState("");
  const [creating, setCreating] = useState(false);

  /* shop editor */
  const [editName, setEditName] = useState("");
  const [editTagline, setEditTagline] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBannerColor, setEditBannerColor] = useState("#0a0a0a");
  const [editAccentColor, setEditAccentColor] = useState("#d4af37");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [aiShopDescLoading, setAiShopDescLoading] = useState(false);
  const [niche, setNiche] = useState("");

  /* product form */
  const [showProductForm, setShowProductForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pName, setPName] = useState("");
  const [pPrice, setPPrice] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [pImageUrl, setPImageUrl] = useState("");
  const [pSaving, setPSaving] = useState(false);
  const [aiProdDescLoading, setAiProdDescLoading] = useState(false);
  const [aiImageLoading, setAiImageLoading] = useState<"standard" | "premium" | null>(null);
  const [imageStyleHint, setImageStyleHint] = useState("");

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

  function paidFailed(res: Response, data: { error?: string }): boolean {
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  async function loadShops() {
    setLoading(true);
    setError(null);
    try {
      const res = await authed("/api/shops/mine");
      const data = (await res.json().catch(() => ({}))) as { shops?: Shop[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't load your shops.");
      setShops(data.shops ?? []);
      if (data.shops?.length && !activeShop) selectShop(data.shops[0]!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your shops.");
    } finally {
      setLoading(false);
    }
  }

  function selectShop(shop: Shop) {
    setActiveShop(shop);
    setEditName(shop.name);
    setEditTagline(shop.tagline ?? "");
    setEditDescription(shop.description ?? "");
    setEditBannerColor(shop.banner_color);
    setEditAccentColor(shop.accent_color);
    loadProducts(shop);
  }

  async function loadProducts(shop: Shop) {
    try {
      /* Products come from the public storefront endpoint for the shop's handle. */
      const pub = await fetch(`/api/shops/handle/${shop.handle}`);
      const data = (await pub.json().catch(() => ({}))) as { products?: Product[] };
      setProducts(data.products ?? []);
    } catch {
      setProducts([]);
    }
  }

  useEffect(() => {
    if (user) loadShops();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function createShop() {
    if (creating || !newName.trim() || !newHandle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await authed("/api/shops", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), handle: newHandle.trim(), tagline: newTagline.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { shop?: Shop; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't create the shop.");
      setShops((s) => [data.shop!, ...s]);
      setShowCreate(false);
      setNewName(""); setNewHandle(""); setNewTagline("");
      selectShop(data.shop!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the shop.");
    } finally {
      setCreating(false);
    }
  }

  async function saveShop() {
    if (!activeShop || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authed(`/api/shops/${activeShop.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName.trim(),
          tagline: editTagline.trim(),
          description: editDescription.trim(),
          banner_color: editBannerColor,
          accent_color: editAccentColor,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { shop?: Shop; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't save the shop.");
      setActiveShop(data.shop!);
      setShops((s) => s.map((x) => (x.id === data.shop!.id ? data.shop! : x)));
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the shop.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteShop() {
    if (!activeShop || !window.confirm(`Delete "${activeShop.name}" and all its products? This can't be undone.`)) return;
    try {
      const res = await authed(`/api/shops/${activeShop.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't delete the shop.");
      setShops((s) => s.filter((x) => x.id !== activeShop.id));
      setActiveShop(null);
      setProducts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the shop.");
    }
  }

  async function generateShopDescription() {
    if (!activeShop || aiShopDescLoading) return;
    setAiShopDescLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authed("/api/shops/ai/shop-description", {
        method: "POST",
        body: JSON.stringify({
          shopName: editName.trim() || activeShop.name,
          tagline: editTagline.trim(),
          niche: niche.trim(),
          products: products.map((p) => p.name).join(", "),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { description?: string; error?: string; message?: string };
      if (paidFailed(res, data)) return;
      if (!res.ok || !data.description) throw new Error(data.message || data.error || "Description generation failed.");
      setEditDescription(data.description);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Description generation failed.");
    } finally {
      setAiShopDescLoading(false);
    }
  }

  function openNewProduct() {
    setEditingProduct(null);
    setPName(""); setPPrice(""); setPDesc(""); setPImageUrl(""); setImageStyleHint("");
    setShowProductForm(true);
  }

  function openEditProduct(p: Product) {
    setEditingProduct(p);
    setPName(p.name);
    setPPrice((p.price_cents / 100).toFixed(2));
    setPDesc(p.description ?? "");
    setPImageUrl(p.image_url ?? "");
    setImageStyleHint("");
    setShowProductForm(true);
  }

  async function saveProduct() {
    if (!activeShop || pSaving) return;
    const cents = dollarsToCents(pPrice);
    if (!pName.trim()) { setError("Give the product a name."); return; }
    if (cents === null) { setError("Enter a valid price (e.g. 19.99)."); return; }
    setPSaving(true);
    setError(null);
    try {
      const body = {
        name: pName.trim(),
        price_cents: cents,
        description: pDesc.trim(),
        image_url: pImageUrl.trim(),
      };
      const url = editingProduct
        ? `/api/shops/${activeShop.id}/products/${editingProduct.id}`
        : `/api/shops/${activeShop.id}/products`;
      const res = await authed(url, { method: editingProduct ? "PATCH" : "POST", body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { product?: Product; error?: string };
      if (!res.ok) throw new Error(data.error || "Couldn't save the product.");
      setProducts((ps) =>
        editingProduct ? ps.map((x) => (x.id === editingProduct.id ? data.product! : x)) : [...ps, data.product!]
      );
      setShowProductForm(false);
      setShops((s) => s.map((x) => (x.id === activeShop.id ? { ...x, product_count: (x.product_count ?? 0) + (editingProduct ? 0 : 1) } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the product.");
    } finally {
      setPSaving(false);
    }
  }

  async function deleteProduct(p: Product) {
    if (!activeShop || !window.confirm(`Remove "${p.name}" from the shop?`)) return;
    try {
      const res = await authed(`/api/shops/${activeShop.id}/products/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't delete the product.");
      setProducts((ps) => ps.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the product.");
    }
  }

  async function generateProductDescription() {
    if (aiProdDescLoading || !pName.trim()) { if (!pName.trim()) setError("Name the product first."); return; }
    setAiProdDescLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authed("/api/shops/ai/product-description", {
        method: "POST",
        body: JSON.stringify({ productName: pName.trim(), details: pDesc.trim(), price: pPrice.trim(), tone: "luxury" }),
      });
      const data = (await res.json().catch(() => ({}))) as { description?: string; error?: string; message?: string };
      if (paidFailed(res, data)) return;
      if (!res.ok || !data.description) throw new Error(data.message || data.error || "Description generation failed.");
      setPDesc(data.description);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Description generation failed.");
    } finally {
      setAiProdDescLoading(false);
    }
  }

  async function generateProductImage(tier: "standard" | "premium") {
    if (aiImageLoading || !pName.trim()) { if (!pName.trim()) setError("Name the product first."); return; }
    setAiImageLoading(tier);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authed("/api/shops/ai/product-image", {
        method: "POST",
        body: JSON.stringify({ productName: pName.trim(), styleHint: imageStyleHint.trim(), tier }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
      if (paidFailed(res, data)) return;
      if (!res.ok || !data.url) throw new Error(data.message || data.error || "Image generation failed.");
      setPImageUrl(data.url);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setAiImageLoading(null);
    }
  }

  if (!user && !loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <MarketingNav />
        <main className="max-w-3xl mx-auto px-5 py-24 text-center">
          <Store className="w-12 h-12 mx-auto text-amber-400/80" />
          <h1 className="mt-6 text-4xl font-black tracking-tight">Your own storefront</h1>
          <p className="mt-4 text-white/55">Sign in to build your shop on the Bow Down Visuals platform.</p>
          <Link href="/login" className={`${goldBtn} mt-8`}>Sign In</Link>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-400/80">Customer Shops</p>
            <h1 className="mt-2 text-3xl md:text-5xl font-black tracking-tight">My Shop</h1>
            <p className="mt-2 text-white/55 max-w-xl text-sm md:text-base">
              Your own storefront on the platform — live at <span className="text-amber-300 font-mono text-sm">/shop/your-handle</span> the
              moment you create it. Building is free; the AI writer and AI images cost credits.
            </p>
          </div>
          <button className={goldBtn} onClick={() => setShowCreate((v) => !v)}>
            <Plus className="w-4 h-4" /> New Shop <span className="text-[11px] font-semibold opacity-70">free</span>
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}
        {outOfCredits && <div className="mt-6"><OutOfCredits /></div>}

        {showCreate && (
          <div className="mt-6 rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.06] to-transparent p-6">
            <h2 className="text-lg font-bold">Create your shop</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-xs font-semibold text-white/50">Shop name</label>
                <input className={`${inputClass} mt-1`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Shark King Supply" maxLength={80} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/50">Handle (your /shop/ URL)</label>
                <input className={`${inputClass} mt-1 font-mono`} value={newHandle} onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="shark-king-supply" maxLength={30} />
              </div>
              <div>
                <label className="text-xs font-semibold text-white/50">Tagline</label>
                <input className={`${inputClass} mt-1`} value={newTagline} onChange={(e) => setNewTagline(e.target.value)} placeholder="Luxury merch for the bold" maxLength={140} />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button className={goldBtn} onClick={createShop} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />} Create Shop
              </button>
              <button className={ghostBtn} onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
        ) : shops.length === 0 && !showCreate ? (
          <div className="mt-16 rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
            <ShoppingBag className="w-10 h-10 mx-auto text-white/25" />
            <h2 className="mt-4 text-xl font-bold">No shops yet</h2>
            <p className="mt-2 text-sm text-white/50">Create your first shop — it goes live instantly at your /shop/ URL.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[280px_1fr]">
            {/* shop switcher */}
            <aside className="space-y-2">
              {shops.map((s) => (
                <button
                  key={s.id}
                  onClick={() => selectShop(s)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                    activeShop?.id === s.id
                      ? "border-amber-400/50 bg-amber-400/[0.07]"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="font-bold text-sm">{s.name}</div>
                  <div className="text-xs text-white/40 font-mono">/shop/{s.handle}</div>
                  <div className="text-xs text-white/40 mt-1">{s.product_count ?? 0} products</div>
                </button>
              ))}
            </aside>

            {/* editor */}
            {activeShop && (
              <div className="space-y-8">
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">Shop details</h2>
                    <div className="flex items-center gap-2">
                      <Link href={`/shop/${activeShop.handle}`} className={ghostBtn}>
                        <ExternalLink className="w-4 h-4" /> View live
                      </Link>
                      <button className={ghostBtn} onClick={deleteShop}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold text-white/50">Shop name</label>
                      <input className={`${inputClass} mt-1`} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-white/50">Tagline</label>
                      <input className={`${inputClass} mt-1`} value={editTagline} onChange={(e) => setEditTagline(e.target.value)} maxLength={140} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-white/50">About blurb</label>
                      <div className="flex items-center gap-2">
                        <input
                          className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white placeholder:text-white/25 outline-none w-40"
                          value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Niche (optional)" maxLength={120}
                        />
                        <button className={ghostBtn} onClick={generateShopDescription} disabled={aiShopDescLoading}>
                          {aiShopDescLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                          <span className="text-xs">AI write · 1 credit</span>
                        </button>
                      </div>
                    </div>
                    <textarea className={`${inputClass} mt-1 min-h-[90px]`} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} maxLength={2000} placeholder="Tell shoppers what your shop is about…" />
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold text-white/50 flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> Banner color</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input type="color" value={editBannerColor} onChange={(e) => setEditBannerColor(e.target.value)} className="h-10 w-14 rounded-lg border border-white/15 bg-black cursor-pointer" />
                        <span className="font-mono text-xs text-white/50">{editBannerColor}</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-white/50 flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> Accent color</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input type="color" value={editAccentColor} onChange={(e) => setEditAccentColor(e.target.value)} className="h-10 w-14 rounded-lg border border-white/15 bg-black cursor-pointer" />
                        <span className="font-mono text-xs text-white/50">{editAccentColor}</span>
                        <button className="text-xs text-white/40 underline" onClick={() => setEditAccentColor("#d4af37")}>reset gold</button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center gap-3">
                    <button className={goldBtn} onClick={saveShop} disabled={saving}>
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : savedTick ? <Check className="w-4 h-4" /> : null}
                      {savedTick ? "Saved" : "Save changes"} <span className="text-[11px] font-semibold opacity-70">free</span>
                    </button>
                  </div>

                  <DomainManager shop={activeShop} authed={authed} onUpdate={setActiveShop} />
                </section>

                {/* products */}
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">Products <span className="text-white/40 text-sm font-normal">({products.length})</span></h2>
                    <button className={goldBtn} onClick={openNewProduct}>
                      <Plus className="w-4 h-4" /> Add product <span className="text-[11px] font-semibold opacity-70">free</span>
                    </button>
                  </div>

                  {showProductForm && (
                    <div className="mt-4 rounded-xl border border-amber-400/25 bg-black/40 p-5">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-sm">{editingProduct ? "Edit product" : "New product"}</h3>
                        <button className="text-white/40 hover:text-white" onClick={() => setShowProductForm(false)}><X className="w-4 h-4" /></button>
                      </div>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="text-xs font-semibold text-white/50">Product name</label>
                          <input className={`${inputClass} mt-1`} value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Gold Chain Tee" maxLength={120} />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-white/50">Price (USD)</label>
                          <input className={`${inputClass} mt-1`} value={pPrice} onChange={(e) => setPPrice(e.target.value)} placeholder="29.99" inputMode="decimal" />
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold text-white/50">Description</label>
                          <button className={ghostBtn} onClick={generateProductDescription} disabled={aiProdDescLoading}>
                            {aiProdDescLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                            <span className="text-xs">AI write · 1 credit</span>
                          </button>
                        </div>
                        <textarea className={`${inputClass} mt-1 min-h-[80px]`} value={pDesc} onChange={(e) => setPDesc(e.target.value)} maxLength={2000} placeholder="What makes it great…" />
                      </div>
                      <div className="mt-4">
                        <label className="text-xs font-semibold text-white/50">Product image</label>
                        {pImageUrl ? (
                          <div className="mt-1 flex items-center gap-3">
                            <img src={pImageUrl} alt="Product" className="h-16 w-16 rounded-lg object-cover border border-white/15" />
                            <button className="text-xs text-white/40 underline" onClick={() => setPImageUrl("")}>remove</button>
                          </div>
                        ) : (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <input
                              className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none"
                              value={imageStyleHint} onChange={(e) => setImageStyleHint(e.target.value)}
                              placeholder="Style hint for AI (optional): streetwear flat-lay…"
                              maxLength={300}
                            />
                            <button className={ghostBtn} onClick={() => generateProductImage("standard")} disabled={!!aiImageLoading}>
                              {aiImageLoading === "standard" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5 text-amber-300" />}
                              <span className="text-xs">AI image · 1 credit</span>
                            </button>
                            <button className={ghostBtn} onClick={() => generateProductImage("premium")} disabled={!!aiImageLoading}>
                              {aiImageLoading === "premium" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                              <span className="text-xs">Premium · 2 credits</span>
                            </button>
                          </div>
                        )}
                        <input
                          className="mt-2 w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none"
                          value={pImageUrl} onChange={(e) => setPImageUrl(e.target.value)}
                          placeholder="…or paste an image URL"
                        />
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button className={goldBtn} onClick={saveProduct} disabled={pSaving}>
                          {pSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {editingProduct ? "Save product" : "Add product"}
                        </button>
                        <button className={ghostBtn} onClick={() => setShowProductForm(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {products.length === 0 && !showProductForm ? (
                    <p className="mt-6 text-sm text-white/40 text-center py-8">No products yet — add your first one above.</p>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {products.map((p) => (
                        <div key={p.id} className="flex gap-3 rounded-xl border border-white/10 bg-black/40 p-3">
                          {p.image_url ? (
                            <img src={p.image_url} alt={p.name} className="h-16 w-16 rounded-lg object-cover border border-white/10 shrink-0" />
                          ) : (
                            <div className="h-16 w-16 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0">
                              <ShoppingBag className="w-6 h-6 text-white/25" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm truncate">{p.name}</div>
                            <div className="text-amber-300 text-sm font-bold">{centsToDisplay(p.price_cents)}</div>
                            <div className="mt-1.5 flex gap-2">
                              <button className="text-xs text-white/50 hover:text-white flex items-center gap-1" onClick={() => openEditProduct(p)}>
                                <Pencil className="w-3 h-3" /> Edit
                              </button>
                              <button className="text-xs text-red-400/70 hover:text-red-400 flex items-center gap-1" onClick={() => deleteProduct(p)}>
                                <Trash2 className="w-3 h-3" /> Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <AnalyticsCard shopId={activeShop.id} authed={authed} />
              </div>
            )}
          </div>
        )}

        <Link href="/dashboard" className="mt-10 inline-flex items-center gap-2 text-sm text-white/40 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}

/* ─── DomainManager — real custom-domain connection ────────────────────────
   TXT verification via POST /api/storefronts/domain/verify. Never faked:
   the domain only shows "verified" after DNS actually resolves the token. */
function DomainManager({
  shop, authed, onUpdate,
}: {
  shop: Shop;
  authed: (path: string, init?: RequestInit) => Promise<Response>;
  onUpdate: (s: Shop) => void;
}) {
  const [domain, setDomain] = useState(shop.custom_domain ?? "");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function attach() {
    setError(null); setBusy(true);
    try {
      const res = await authed(`/api/storefronts/${shop.id}/domain`, {
        method: "POST", body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't attach that domain.");
      setToken(data.verification.value);
      onUpdate({ ...shop, custom_domain: data.domain, domain_verified: false });
    } catch (e) { setError(e instanceof Error ? e.message : "Attach failed."); }
    finally { setBusy(false); }
  }

  async function verify() {
    setError(null); setVerifying(true);
    try {
      const res = await authed("/api/storefronts/domain/verify", {
        method: "POST", body: JSON.stringify({ shopId: shop.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.verified) {
        setToken(null);
        onUpdate({ ...shop, domain_verified: true });
      } else {
        setError(data.reason || "Not verified yet — DNS can take a few minutes to propagate.");
      }
    } catch { setError("Verification check failed. Try again."); }
    finally { setVerifying(false); }
  }

  async function detach() {
    if (!confirm("Disconnect this domain from your shop?")) return;
    setError(null);
    try {
      const res = await authed(`/api/storefronts/${shop.id}/domain`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't disconnect the domain.");
      setToken(null); setDomain("");
      onUpdate({ ...shop, custom_domain: null, domain_verified: false });
    } catch (e) { setError(e instanceof Error ? e.message : "Disconnect failed."); }
  }

  function copyToken() {
    if (token) navigator.clipboard.writeText(token).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-black/40 p-5">
      <div className="flex items-center gap-2">
        <Globe className="w-5 h-5 text-amber-300" />
        <div className="text-sm font-bold">Custom domain</div>
        {shop.domain_verified && shop.custom_domain && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
            <BadgeCheck className="w-3.5 h-3.5" /> Verified
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      {!shop.custom_domain ? (
        <div className="mt-3">
          <p className="text-xs text-white/45">
            Point your own domain at your shop. You'll add one TXT record to prove ownership.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={domain} onChange={(e) => setDomain(e.target.value)}
              placeholder="shop.yourname.com"
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-amber-400/60"
            />
            <button onClick={attach} disabled={busy || !domain.trim()} className={goldBtn}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Connect
            </button>
          </div>
        </div>
      ) : shop.domain_verified ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-emerald-300">{shop.custom_domain}</p>
          <button onClick={detach} className="text-xs font-bold text-white/40 hover:text-red-300">Disconnect</button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <p className="font-mono text-xs text-white/70">
            Add this TXT record at <span className="text-amber-300">bdv-verify.{shop.custom_domain}</span>:
          </p>
          <div className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-black/60 p-3">
            <code className="break-all font-mono text-xs text-amber-300">{token ?? "••••••••"}</code>
            {token && (
              <button onClick={copyToken} className="shrink-0 text-white/50 hover:text-white" title="Copy token">
                {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
          </div>
          {!token && (
            <p className="text-xs text-white/40">Token issued when you connected — reconnect to get a fresh one.</p>
          )}
          <p className="text-xs text-white/45">
            Also add a CNAME: host <span className="font-mono text-white/70">@</span> →{" "}
            <span className="font-mono text-white/70">cname.bowdownvisuals.com</span>
          </p>
          <div className="flex gap-2">
            <button onClick={verify} disabled={verifying} className={goldBtn}>
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
              Verify domain
            </button>
            <button onClick={detach} className={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-white/40">
        Live now at <span className="font-mono text-amber-300/90">/shop/{shop.handle}</span>
      </p>
    </div>
  );
}

/* ─── AnalyticsCard — per-shop views + sales (free to view) ─────────────── */
function AnalyticsCard({
  shopId, authed,
}: {
  shopId: string;
  authed: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const [data, setData] = useState<{
    totals: { views: number; sales: number; gross_cents: number; platform_fee_cents: number; seller_net_cents: number };
    dailyViews: Array<{ day: string; views: number }>;
    sales: Array<{ id: string; product_name: string | null; amount_cents: number; platform_fee_cents: number; seller_net_cents: number; buyer_email: string | null; created_at: string }>;
    platformFeePct: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await authed(`/api/storefronts/${shopId}/analytics`);
        const d = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setData(d);
      } catch { /* analytics never breaks the page */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [shopId]);

  const maxViews = Math.max(1, ...(data?.dailyViews.map((d) => d.views) ?? [1]));

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="text-lg font-bold">Analytics <span className="text-white/40 text-sm font-normal">free</span></h2>
      {loading ? (
        <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
      ) : !data ? (
        <p className="mt-3 text-sm text-white/40">Couldn't load analytics.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Storefront views", value: String(data.totals.views) },
              { label: "Sales", value: String(data.totals.sales) },
              { label: "Gross revenue", value: centsToDisplay(data.totals.gross_cents) },
              { label: "You keep (90%)", value: centsToDisplay(data.totals.seller_net_cents), gold: true },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-white/10 bg-black/40 p-4">
                <div className={`text-xl font-black ${s.gold ? "text-amber-300" : ""}`}>{s.value}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">{s.label}</div>
              </div>
            ))}
          </div>

          {data.dailyViews.length > 0 && (
            <div className="mt-5">
              <div className="text-xs font-bold uppercase tracking-wider text-white/40">Views — last 30 days</div>
              <div className="mt-2 flex h-20 items-end gap-1">
                {data.dailyViews.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day}: ${d.views} views`}
                    className="flex-1 rounded-t bg-gradient-to-t from-amber-500/40 to-amber-300/80"
                    style={{ height: `${Math.max(4, (d.views / maxViews) * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <div className="text-xs font-bold uppercase tracking-wider text-white/40">
              Recent sales <span className="normal-case font-normal">({data.platformFeePct}% platform fee on each)</span>
            </div>
            {data.sales.length === 0 ? (
              <p className="mt-2 text-sm text-white/40">No sales yet — share your storefront link.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {data.sales.slice(0, 10).map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{sale.product_name ?? "Product"}</div>
                      <div className="text-[11px] text-white/40">
                        {new Date(sale.created_at).toLocaleDateString()}{sale.buyer_email ? ` · ${sale.buyer_email}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-bold">{centsToDisplay(sale.amount_cents)}</div>
                      <div className="text-[11px] text-emerald-300">you keep {centsToDisplay(sale.seller_net_cents)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
