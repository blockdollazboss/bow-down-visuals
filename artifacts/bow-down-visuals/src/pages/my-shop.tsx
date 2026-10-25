import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Store, Plus, Loader2, Sparkles, Trash2, Pencil, ExternalLink,
  ShoppingBag, ImagePlus, Check, X, Globe, Palette, ArrowLeft, Copy, BadgeCheck, Share2, TrendingUp,
  AlertTriangle, RotateCcw, Pause, Play, Tag,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import PosMode from "@/components/PosMode";
import { centsToDisplay, dollarsToCents } from "@/lib/shops";
import SellerReviewsPanel from "@/components/product-reviews/SellerReviewsPanel";
import { useTranslation } from "react-i18next";
import { AltTextField } from "@/components/accessibility/AltTextField";
import SplitsEditor, { splitsErrorI18nKey } from "@/components/splits/SplitsEditor";
import {
  draftsFromPresented, splitsPayload, validateSplitsDraft,
  type SplitCoSellerDraft,
} from "@/lib/splits-editor";

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
  /* #29: accessibility description of the product shot — buyer reads
     carry it too; it renders as the product image's alt in the shop. */
  image_alt_text?: string | null;
  /* Owner-rail field (migration 0176): 'paused' products are unlisted
     for buyers but stay fully visible here so the seller can resume
     them. Buyer reads never carry this. */
  status: "active" | "paused";
  /* Creator Product Affiliates (#16, migration 0209): the creator-set
     per-product affiliate switch + commission rate (bps of the seller's
     cut). Buyer reads carry them as the published offer. */
  affiliate_enabled?: boolean;
  affiliate_commission_bps?: number | null;
  /* Co-seller revenue splits (Wave 4 #36): the normalized list the
     shop rail presents — [{ userId, sharePct }] including my own
     entry; null/absent = solo product. Names aren't presented on
     shop reads, so the editor resolves them only for fresh picks. */
  splits?: { userId: string; sharePct: number }[] | null;
  /* Order-bump setting (feature #13): the raw add-on attachment, so
     the editor can show and change it even while the add-on is
     paused. Buyer reads carry the resolved offer instead. */
  bumpConfig?: { bumpProductId: string; percentOff: number } | null;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/50 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40 focus-visible:ring-2 focus-visible:ring-primary/60";

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none";

const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50 disabled:pointer-events-none";

export default function MyShop() {
  usePageTitle("My Shop", "Your own storefront on Bow Down Visuals — sell products with AI-written descriptions, images, and your own domain.");
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  /* Shops-list load failures are NOT "no shops yet" — they get their
     own error state with a retry, scoped to the shops list. The empty
     state renders ONLY for a successful load with zero shops. */
  const [shopsLoadError, setShopsLoadError] = useState(false);
  const [shopsRetryNonce, setShopsRetryNonce] = useState(0);
  const [activeShop, setActiveShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  /* Product-list load failures are NOT "no products yet" — they get
     their own error state with a retry, scoped to the products list
     only. The empty state renders ONLY for a successful load with
     zero products. */
  const [productsLoadError, setProductsLoadError] = useState(false);
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
  /* #16 affiliates: fan-resale switch + the commission % I choose to pay
     (of MY cut — never added to the buyer's price). */
  const [pAffiliates, setPAffiliates] = useState(false);
  const [pAffiliatePct, setPAffiliatePct] = useState("");
  /* #36 co-seller splits: the editor's co-seller drafts (my own share
     is derived by lib/splits-editor, never a row here). */
  const [pSplitDrafts, setPSplitDrafts] = useState<SplitCoSellerDraft[]>([]);
  const [pImageAlt, setPImageAlt] = useState("");
  const [pSaving, setPSaving] = useState(false);
  const [pauseTogglingId, setPauseTogglingId] = useState<string | null>(null);
  const [aiProdDescLoading, setAiProdDescLoading] = useState(false);
  const [aiImageLoading, setAiImageLoading] = useState<"standard" | "premium" | null>(null);
  const [imageStyleHint, setImageStyleHint] = useState("");
  /* Order-bump editor (feature #13): which of this shop's products is
     offered as the add-on for the product being edited, and the
     seller-set % off. Saved on its own rail (PUT …/bump). */
  const [bumpTargetId, setBumpTargetId] = useState("");
  const [bumpPercent, setBumpPercent] = useState("0");
  const [bumpSaving, setBumpSaving] = useState(false);
  const [bumpMsg, setBumpMsg] = useState<string | null>(null);

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
    setShopsLoadError(false);
    try {
      const res = await authed("/api/shops/mine");
      const data = (await res.json().catch(() => ({}))) as { shops?: Shop[]; error?: string };
      if (!res.ok) throw new Error(data.error || t("myShop.loadShopsFailed"));
      setShops(data.shops ?? []);
      if (data.shops?.length && !activeShop) selectShop(data.shops[0]!);
    } catch {
      /* List-load failure gets the scoped error state below, not the
         shared mutation error banner — and never the fake-empty box. */
      setShopsLoadError(true);
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
    setProductsLoadError(false);
    try {
      /* Products come from the owner rail (authed, shop-id scoped):
         it returns ALL of the seller's products with their pause
         state. The public handle read hides paused products by
         design (Stack-4 #6), so it can no longer feed this view —
         it would blind the seller to their own paused stock. */
      const pub = await authed(`/api/shops/${shop.id}/products`);
      const data = (await pub.json().catch(() => ({}))) as { products?: Product[] };
      if (!pub.ok) throw new Error("products load failed");
      setProducts(data.products ?? []);
    } catch {
      setProductsLoadError(true);
    }
  }

  useEffect(() => {
    if (user) loadShops();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, shopsRetryNonce]);

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
      if (!res.ok) throw new Error(data.error || t("myShop.createShopFailed"));
      setShops((s) => [data.shop!, ...s]);
      setShowCreate(false);
      setNewName(""); setNewHandle(""); setNewTagline("");
      selectShop(data.shop!);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.createShopFailed"));
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
      if (!res.ok) throw new Error(data.error || t("myShop.saveShopFailed"));
      setActiveShop(data.shop!);
      setShops((s) => s.map((x) => (x.id === data.shop!.id ? data.shop! : x)));
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.saveShopFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteShop() {
    if (!activeShop || !window.confirm(t("myShop.deleteShopConfirm", { name: activeShop.name }))) return;
    try {
      const res = await authed(`/api/shops/${activeShop.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("myShop.deleteShopFailed"));
      setShops((s) => s.filter((x) => x.id !== activeShop.id));
      setActiveShop(null);
      setProducts([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.deleteShopFailed"));
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
      if (!res.ok || !data.description) throw new Error(data.message || data.error || t("myShop.descriptionFailed"));
      setEditDescription(data.description);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.descriptionFailed"));
    } finally {
      setAiShopDescLoading(false);
    }
  }

  function openNewProduct() {
    setEditingProduct(null);
    setPName(""); setPPrice(""); setPDesc(""); setPImageUrl(""); setPImageAlt(""); setImageStyleHint("");
    setPAffiliates(false); setPAffiliatePct("");
    setPSplitDrafts([]);
    setShowProductForm(true);
  }

  function openEditProduct(p: Product) {
    setEditingProduct(p);
    setPName(p.name);
    setPPrice((p.price_cents / 100).toFixed(2));
    setPDesc(p.description ?? "");
    setPImageUrl(p.image_url ?? "");
    setPAffiliates(p.affiliate_enabled === true);
    setPAffiliatePct(p.affiliate_commission_bps != null ? String(p.affiliate_commission_bps / 100) : "");
    setPSplitDrafts(draftsFromPresented(p.splits, user?.id ?? ""));
    setPImageAlt(p.image_alt_text ?? "");
    setImageStyleHint("");
    setBumpTargetId(p.bumpConfig?.bumpProductId ?? "");
    setBumpPercent(String(p.bumpConfig?.percentOff ?? 0));
    setBumpMsg(null);
    setShowProductForm(true);
  }

  async function saveBump() {
    if (!activeShop || !editingProduct || bumpSaving) return;
    const pct = Number.parseInt(bumpPercent, 10);
    if (!Number.isInteger(pct) || pct < 0 || pct > 90) {
      setBumpMsg("Percent off must be a whole number from 0 to 90.");
      return;
    }
    setBumpSaving(true);
    setBumpMsg(null);
    try {
      const res = await authed(`/api/shops/${activeShop.id}/products/${editingProduct.id}/bump`, {
        method: "PUT",
        body: JSON.stringify({
          bumpProductId: bumpTargetId || null,
          percentOff: bumpTargetId ? pct : 0,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        bumpConfig?: { bumpProductId: string; percentOff: number } | null;
        offerLive?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.message || data.error || "Could not save the add-on offer.");
      setProducts((ps) =>
        ps.map((x) => (x.id === editingProduct.id ? { ...x, bumpConfig: data.bumpConfig ?? null } : x)),
      );
      setBumpMsg(
        !bumpTargetId
          ? "Add-on offer removed."
          : data.offerLive
            ? "Add-on is live — buyers can tick it at checkout."
            : "Saved. The add-on isn't offered until it's active and priced.",
      );
    } catch (err) {
      setBumpMsg(err instanceof Error ? err.message : "Could not save the add-on offer.");
    } finally {
      setBumpSaving(false);
    }
  }

  async function togglePauseProduct(p: Product) {
    if (!activeShop || pauseTogglingId) return;
    const next = p.status === "paused" ? "active" : "paused";
    setPauseTogglingId(p.id);
    setError(null);
    try {
      const res = await authed(`/api/shops/${activeShop.id}/products/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { product?: Product; error?: string };
      if (!res.ok) throw new Error(data.error || t("myShop.togglePauseFailed"));
      /* The row changes ONLY from the server's confirmed response —
         the delete discipline: a failed flip shows the error and
         leaves the list exactly as it was. */
      setProducts((ps) => ps.map((x) => (x.id === p.id ? data.product! : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.togglePauseFailed"));
    } finally {
      setPauseTogglingId(null);
    }
  }

  async function saveProduct() {
    if (!activeShop || pSaving) return;
    const cents = dollarsToCents(pPrice);
    if (!pName.trim()) { setError(t("myShop.productNameRequired")); return; }
    if (cents === null) { setError(t("myShop.validPriceRequired")); return; }
    /* #16: an affiliate % is the creator's own number — required when the
       switch is on, 0 < % ≤ 100 of my cut. Never invented here. */
    let affiliateBps: number | null = null;
    if (pAffiliates) {
      const pct = Number(pAffiliatePct);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        setError("Set the commission you'll pay affiliates — a % of your cut, between 0 and 100.");
        return;
      }
      affiliateBps = Math.round(pct * 100);
    }
    /* #36: co-seller splits — validated by the same contract the
       server enforces (lib/splits-editor). The splits key rides the
       save ONLY when it sets or clears a split: an explicit null is
       a write on the server (it clears), and pre-migration any
       splits write answers 503 — a solo product's ordinary save
       must never carry the key. */
    const splitCheck = validateSplitsDraft(user?.id ?? "", pSplitDrafts);
    if (!splitCheck.ok) {
      setError(t(splitsErrorI18nKey(splitCheck.reason)));
      return;
    }
    const splitPayload = splitsPayload(user?.id ?? "", pSplitDrafts);
    const splitsTouched = splitPayload !== null || ((editingProduct?.splits?.length ?? 0) > 0);
    setPSaving(true);
    setError(null);
    try {
      const body = {
        name: pName.trim(),
        price_cents: cents,
        description: pDesc.trim(),
        image_url: pImageUrl.trim(),
        affiliate_enabled: pAffiliates,
        affiliate_commission_bps: affiliateBps,
        ...(splitsTouched ? { splits: splitPayload } : {}),
        image_alt_text: pImageAlt.trim(),
      };
      const url = editingProduct
        ? `/api/shops/${activeShop.id}/products/${editingProduct.id}`
        : `/api/shops/${activeShop.id}/products`;
      const res = await authed(url, { method: editingProduct ? "PATCH" : "POST", body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { product?: Product; error?: string };
      if (!res.ok) throw new Error(data.error || t("myShop.saveProductFailed"));
      setProducts((ps) =>
        editingProduct ? ps.map((x) => (x.id === editingProduct.id ? data.product! : x)) : [...ps, data.product!]
      );
      setShowProductForm(false);
      setShops((s) => s.map((x) => (x.id === activeShop.id ? { ...x, product_count: (x.product_count ?? 0) + (editingProduct ? 0 : 1) } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.saveProductFailed"));
    } finally {
      setPSaving(false);
    }
  }

  async function deleteProduct(p: Product) {
    if (!activeShop || !window.confirm(t("myShop.deleteProductConfirm", { name: p.name }))) return;
    try {
      const res = await authed(`/api/shops/${activeShop.id}/products/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("myShop.deleteProductFailed"));
      setProducts((ps) => ps.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.deleteProductFailed"));
    }
  }

  async function generateProductDescription() {
    if (aiProdDescLoading || !pName.trim()) { if (!pName.trim()) setError(t("myShop.nameProductFirst")); return; }
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
      if (!res.ok || !data.description) throw new Error(data.message || data.error || t("myShop.descriptionFailed"));
      setPDesc(data.description);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.descriptionFailed"));
    } finally {
      setAiProdDescLoading(false);
    }
  }

  async function generateProductImage(tier: "standard" | "premium") {
    if (aiImageLoading || !pName.trim()) { if (!pName.trim()) setError(t("myShop.nameProductFirst")); return; }
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
      if (!res.ok || !data.url) throw new Error(data.message || data.error || t("myShop.imageFailed"));
      setPImageUrl(data.url);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.imageFailed"));
    } finally {
      setAiImageLoading(null);
    }
  }

  if (!user && !loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <main className="max-w-3xl mx-auto px-5 py-24 text-center">
          <Store className="w-12 h-12 mx-auto text-amber-400/80" />
          <h1 className="mt-6 text-4xl font-black tracking-tight">{t("myShop.ownStorefront")}</h1>
          <p className="mt-4 text-white/55">{t("myShop.signInPrompt")}</p>
          <Link href="/login" className={`${goldBtn} mt-8`}>{t("myShop.signIn")}</Link>
        </main>

      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-400/80">{t("myShop.customerShops")}</p>
            <h1 className="mt-2 text-3xl md:text-5xl font-black tracking-tight">{t("myShop.heading")}</h1>
            <p className="mt-2 text-white/55 max-w-xl text-sm md:text-base">
              {t("myShop.subheading")}
            </p>
          </div>
          <button className={goldBtn} onClick={() => setShowCreate((v) => !v)}>
            <Plus className="w-4 h-4" /> {t("myShop.newShop")} <span className="text-[11px] font-semibold opacity-70">{t("myShop.free")}</span>
          </button>
        </div>

        {/* Music & digital sales live in the Store Dashboard (the /music-sales
            surface) — dock the handoff here so sellers can reach it from
            their shop instead of hunting for the URL. */}
        <Link href="/music-sales" className="group mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/25 bg-gradient-to-r from-amber-400/[0.08] to-transparent px-5 py-4 transition hover:border-amber-400/50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
            <TrendingUp className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">{t("myShop.salesBannerTitle", { defaultValue: "Selling music or digital products?" })}</span>
            <span className="block text-xs text-white/50">{t("myShop.salesBannerBody", { defaultValue: "Track every sale, order and payout in your Music Sales dashboard." })}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-300 transition group-hover:translate-x-0.5">
            {t("myShop.salesBannerCta", { defaultValue: "View sales" })} <ArrowLeft className="h-4 w-4 rotate-180" />
          </span>
        </Link>

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}
        {outOfCredits && <div className="mt-6"><OutOfCredits /></div>}

        {showCreate && (
          <div className="mt-6 rounded-2xl border border-amber-400/25 bg-gradient-to-b from-amber-400/[0.06] to-transparent p-6">
            <h2 className="text-lg font-bold">{t("myShop.createYourShop")}</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="myshop-create-name" className="text-xs font-semibold text-white/50">{t("myShop.shopNameLabel")}</label>
                <input id="myshop-create-name" className={`${inputClass} mt-1`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("myShop.shopNamePlaceholder")} maxLength={80} />
              </div>
              <div>
                <label htmlFor="myshop-create-handle" className="text-xs font-semibold text-white/50">{t("myShop.handleLabel")}</label>
                <input id="myshop-create-handle" className={`${inputClass} mt-1 font-mono`} value={newHandle} onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder={t("myShop.handlePlaceholder")} maxLength={30} />
              </div>
              <div>
                <label htmlFor="myshop-create-tagline" className="text-xs font-semibold text-white/50">{t("myShop.taglineLabel")}</label>
                <input id="myshop-create-tagline" className={`${inputClass} mt-1`} value={newTagline} onChange={(e) => setNewTagline(e.target.value)} placeholder={t("myShop.taglinePlaceholder")} maxLength={140} />
              </div>
            </div>
            <div className="mt-4 flex gap-3">
              <button className={goldBtn} onClick={createShop} disabled={creating}>
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />} {t("myShop.createShop")}
              </button>
              <button className={ghostBtn} onClick={() => setShowCreate(false)}>{t("myShop.cancel")}</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-16 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-amber-400" /></div>
        ) : shopsLoadError ? (
          <div className={`mt-16 rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
            <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
            <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your shops.</p>
            <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              Something went wrong on our end — your shops are safe, this page just couldn't load them.
            </p>
            <button
              type="button"
              onClick={() => setShopsRetryNonce((n) => n + 1)}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
            >
              <RotateCcw className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : shops.length === 0 && !showCreate ? (
          <div className="mt-16 rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
            <ShoppingBag className="w-10 h-10 mx-auto text-white/25" />
            <h2 className="mt-4 text-xl font-bold">{t("myShop.noShops")}</h2>
            <p className="mt-2 text-sm text-white/50">{t("myShop.noShopsHint")}</p>
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
                  <div className="text-xs text-white/40 mt-1">{t("myShop.productCount", { count: s.product_count ?? 0 })}</div>
                </button>
              ))}
            </aside>

            {/* editor */}
            {activeShop && (
              <div className="space-y-8">
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h2 className="text-lg font-bold">{t("myShop.shopDetails")}</h2>
                    <div className="flex items-center gap-2">
                      <Link href={`/shop/${activeShop.handle}`} className={ghostBtn}>
                        <ExternalLink className="w-4 h-4" /> {t("myShop.viewLive")}
                      </Link>
                      <button
                        className={ghostBtn}
                        onClick={async () => {
                          const url = `${window.location.origin}/shop/${activeShop.handle}`;
                          const shareData = {
                            title: `${activeShop.name} — shop`,
                            text: `Check out my shop: ${activeShop.name} 🛍️ Powered by Bow Down Visuals`,
                            url,
                          };
                          try {
                            if (navigator.share) await navigator.share(shareData);
                            else await navigator.clipboard.writeText(`${shareData.text}\n${shareData.url}`);
                          } catch { /* user dismissed */ }
                        }}
                      >
                        <Share2 className="w-4 h-4" /> {t("myShop.shareShop", { defaultValue: "Share" })}
                      </button>
                      <button className={ghostBtn} onClick={deleteShop}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="myshop-edit-name" className="text-xs font-semibold text-white/50">{t("myShop.shopNameLabel")}</label>
                      <input id="myshop-edit-name" className={`${inputClass} mt-1`} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={80} />
                    </div>
                    <div>
                      <label htmlFor="myshop-edit-tagline" className="text-xs font-semibold text-white/50">{t("myShop.taglineLabel")}</label>
                      <input id="myshop-edit-tagline" className={`${inputClass} mt-1`} value={editTagline} onChange={(e) => setEditTagline(e.target.value)} maxLength={140} />
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <label htmlFor="myshop-edit-about" className="text-xs font-semibold text-white/50">{t("myShop.aboutBlurb")}</label>
                      <div className="flex items-center gap-2">
                        <input
                          className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-xs text-white placeholder:text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 w-40"
                          value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("myShop.nichePlaceholder")} aria-label={t("myShop.nichePlaceholder")} maxLength={120}
                        />
                        <button className={ghostBtn} onClick={generateShopDescription} disabled={aiShopDescLoading}>
                          {aiShopDescLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                          <span className="text-xs">{t("myShop.aiWrite100")}</span>
                        </button>
                      </div>
                    </div>
                    <textarea id="myshop-edit-about" className={`${inputClass} mt-1 min-h-[90px]`} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} maxLength={2000} placeholder={t("myShop.aboutPlaceholder")} />
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <label htmlFor="myshop-banner-color" className="text-xs font-semibold text-white/50 flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> {t("myShop.bannerColor")}</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input id="myshop-banner-color" type="color" value={editBannerColor} onChange={(e) => setEditBannerColor(e.target.value)} className="h-10 w-14 rounded-lg border border-white/15 bg-black cursor-pointer" />
                        <span className="font-mono text-xs text-white/50">{editBannerColor}</span>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="myshop-accent-color" className="text-xs font-semibold text-white/50 flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> {t("myShop.accentColor")}</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input id="myshop-accent-color" type="color" value={editAccentColor} onChange={(e) => setEditAccentColor(e.target.value)} className="h-10 w-14 rounded-lg border border-white/15 bg-black cursor-pointer" />
                        <span className="font-mono text-xs text-white/50">{editAccentColor}</span>
                        <button className="text-xs text-white/40 underline" onClick={() => setEditAccentColor("#d4af37")}>{t("myShop.resetGold")}</button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center gap-3">
                    <button className={goldBtn} onClick={saveShop} disabled={saving}>
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : savedTick ? <Check className="w-4 h-4" /> : null}
                      {savedTick ? t("myShop.saved") : t("myShop.saveChanges")} <span className="text-[11px] font-semibold opacity-70">{t("myShop.free")}</span>
                    </button>
                  </div>

                  <DomainManager shop={activeShop} authed={authed} onUpdate={setActiveShop} />
                </section>

                {/* Sell in person (POS mode) — QR / payment-link till +
                    cash recorder, docked in My Shop (Stack-100 #3 #28). */}
                <PosMode key={activeShop.id} shop={activeShop} products={products} authed={authed} />

                {/* products */}
                <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">{t("myShop.products")} <span className="text-white/40 text-sm font-normal">({products.length})</span></h2>
                    <button className={goldBtn} onClick={openNewProduct}>
                      <Plus className="w-4 h-4" /> {t("myShop.addProduct")} <span className="text-[11px] font-semibold opacity-70">{t("myShop.free")}</span>
                    </button>
                  </div>

                  {showProductForm && (
                    <div className={`mt-4 rounded-xl border p-5 ${isLight ? "bg-[#F7ECD2]/80 border-[#C9A84C]/40" : "border-amber-400/25 bg-black/40"}`}>
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-sm">{editingProduct ? t("myShop.editProduct") : t("myShop.newProduct")}</h3>
                        <button className="text-white/40 hover:text-white" onClick={() => setShowProductForm(false)}><X className="w-4 h-4" /></button>
                      </div>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor="myshop-product-name" className="text-xs font-semibold text-white/50">{t("myShop.productNameLabel")}</label>
                          <input id="myshop-product-name" className={`${inputClass} mt-1`} value={pName} onChange={(e) => setPName(e.target.value)} placeholder={t("myShop.productNamePlaceholder")} maxLength={120} />
                        </div>
                        <div>
                          <label htmlFor="myshop-product-price" className="text-xs font-semibold text-white/50">{t("myShop.priceLabel")}</label>
                          <input id="myshop-product-price" className={`${inputClass} mt-1`} value={pPrice} onChange={(e) => setPPrice(e.target.value)} placeholder={t("myShop.pricePlaceholder")} inputMode="decimal" />
                        </div>
                      </div>
                      <div className="mt-4">
                        <div className="flex items-center justify-between">
                          <label htmlFor="myshop-product-desc" className="text-xs font-semibold text-white/50">{t("myShop.descriptionLabel")}</label>
                          <button className={ghostBtn} onClick={generateProductDescription} disabled={aiProdDescLoading}>
                            {aiProdDescLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                            <span className="text-xs">{t("myShop.aiWrite100")}</span>
                          </button>
                        </div>
                        <textarea id="myshop-product-desc" className={`${inputClass} mt-1 min-h-[80px]`} value={pDesc} onChange={(e) => setPDesc(e.target.value)} maxLength={2000} placeholder={t("myShop.productDescPlaceholder")} />
                      </div>
                      <div className="mt-4">
                        <label htmlFor="myshop-product-image-url" className="text-xs font-semibold text-white/50">{t("myShop.productImageLabel")}</label>
                        {pImageUrl ? (
                          <div className="mt-1 flex items-center gap-3">
                            <img src={pImageUrl} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={pName || "Product"} className="h-16 w-16 rounded-lg object-cover border border-white/15" />
                            <button className="text-xs text-white/40 underline" onClick={() => setPImageUrl("")}>{t("myShop.removeImage")}</button>
                          </div>
                        ) : (
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <input
                              className="flex-1 min-w-[200px] rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                              value={imageStyleHint} onChange={(e) => setImageStyleHint(e.target.value)}
                              placeholder={t("myShop.styleHintPlaceholder")} aria-label={t("myShop.styleHintPlaceholder")}
                              maxLength={300}
                            />
                            <button className={ghostBtn} onClick={() => generateProductImage("standard")} disabled={!!aiImageLoading}>
                              {aiImageLoading === "standard" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5 text-amber-300" />}
                              <span className="text-xs">{t("myShop.aiImage100")}</span>
                            </button>
                            <button className={ghostBtn} onClick={() => generateProductImage("premium")} disabled={!!aiImageLoading}>
                              {aiImageLoading === "premium" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-300" />}
                              <span className="text-xs">{t("myShop.premium200")}</span>
                            </button>
                          </div>
                        )}
                        <input
                          className="mt-2 w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-xs text-white placeholder:text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
                          id="myshop-product-image-url" value={pImageUrl} onChange={(e) => setPImageUrl(e.target.value)}
                          placeholder={t("myShop.imageUrlPlaceholder")}
                        />
                        {/* #29 product-shot accessibility description */}
                        <AltTextField
                          compact
                          imageUrl={pImageUrl.trim() || null}
                          value={pImageAlt}
                          onChange={setPImageAlt}
                          label="Describe the product photo for screen readers"
                          context={pName || undefined}
                        />
                      </div>
                      {/* #16: Creator Product Affiliates — docked in the product settings. */}
                      <div className={`mt-4 rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40 bg-[#FBF3DC]/70" : "border-white/10 bg-black/30"}`}>
                        <label className="flex cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            checked={pAffiliates}
                            onChange={(e) => setPAffiliates(e.target.checked)}
                            className="h-4 w-4 accent-amber-400"
                          />
                          <span className="text-sm font-semibold">Let fans resell this product (affiliates)</span>
                        </label>
                        <p className="mt-1 text-xs text-white/45">
                          Fans get a share link from the Earnings page. When someone buys through it, they earn the commission
                          you set — paid out of <em>your</em> cut, never added to the buyer&apos;s price. The 5% platform fee doesn&apos;t change.
                        </p>
                        {pAffiliates && (
                          <div className="mt-3 flex items-center gap-2">
                            <label className="text-xs font-semibold text-white/50">Commission you pay</label>
                            <input
                              className="w-24 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none"
                              value={pAffiliatePct}
                              onChange={(e) => setPAffiliatePct(e.target.value)}
                              placeholder="10"
                              inputMode="decimal"
                            />
                            <span className="text-sm text-white/60">% of your cut</span>
                          </div>
                        )}
                      </div>
                      {/* #36: Co-seller splits — the shared editor, docked
                          in the product form under the affiliate block;
                          the shares ride the product save. */}
                      <div className="mt-4">
                        <SplitsEditor
                          ownerUserId={user?.id ?? ""}
                          drafts={pSplitDrafts}
                          onChange={setPSplitDrafts}
                          getAccessToken={getAccessToken}
                          disabled={pSaving}
                        />
                      </div>
                      {editingProduct && (
                        <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4">
                          <label className="text-xs font-semibold text-white/50">
                            Add-on offer — one more thing buyers can tick at checkout
                          </label>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <select
                              className="min-w-[200px] flex-1 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none"
                              value={bumpTargetId}
                              onChange={(e) => setBumpTargetId(e.target.value)}
                              aria-label="Add-on product"
                            >
                              <option value="">No add-on</option>
                              {products
                                .filter((x) => x.id !== editingProduct.id && x.price_cents > 0)
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name} — ${(x.price_cents / 100).toFixed(2)}{x.status === "paused" ? " (paused)" : ""}
                                  </option>
                                ))}
                            </select>
                            <div className="flex items-center gap-1.5">
                              <input
                                className="w-20 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none"
                                value={bumpPercent}
                                onChange={(e) => setBumpPercent(e.target.value)}
                                inputMode="numeric"
                                aria-label="Percent off the add-on"
                              />
                              <span className="text-xs text-white/50">% off</span>
                            </div>
                            <button className={ghostBtn} onClick={saveBump} disabled={bumpSaving}>
                              {bumpSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              <span className="text-xs">Save add-on</span>
                            </button>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                            The add-on sells at its own price (or your % off it) in the same checkout — one charge.
                            The platform fee stays the flat 5%. A discount code never discounts the add-on.
                          </p>
                          {bumpMsg && <p className="mt-1.5 text-xs text-amber-200/90">{bumpMsg}</p>}
                        </div>
                      )}
                      <div className="mt-4 flex gap-3">
                        <button className={goldBtn} onClick={saveProduct} disabled={pSaving}>
                          {pSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {editingProduct ? t("myShop.saveProduct") : t("myShop.addProduct")}
                        </button>
                        <button className={ghostBtn} onClick={() => setShowProductForm(false)}>{t("myShop.cancel")}</button>
                      </div>
                    </div>
                  )}

                  {productsLoadError ? (
                    <div className={`mt-6 rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
                      <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
                      <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load your products.</p>
                      <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                        Something went wrong on our end — your products are safe, this shop just couldn't load them.
                      </p>
                      <button
                        type="button"
                        onClick={() => { if (activeShop) loadProducts(activeShop); }}
                        className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
                      >
                        <RotateCcw className="h-4 w-4" /> Try again
                      </button>
                    </div>
                  ) : products.length === 0 && !showProductForm ? (
                    <p className="mt-6 text-sm text-white/40 text-center py-8">{t("myShop.noProducts")}</p>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {products.map((p) => (
                        <div key={p.id} className={`flex gap-3 rounded-xl border p-3 ${isLight ? "bg-[#F7ECD2]/80 border-[#C9A84C]/30" : "border-white/10 bg-black/40"}`}>
                          {p.image_url ? (
                            <img src={p.image_url} onError={(e) => { e.currentTarget.style.display = "none"; }} alt={p.name} className="h-16 w-16 rounded-lg object-cover border border-white/10 shrink-0" />
                          ) : (
                            <div className="h-16 w-16 rounded-lg bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0">
                              <ShoppingBag className="w-6 h-6 text-white/25" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-bold text-sm truncate">{p.name}</div>
                              {p.status === "paused" && (
                                <span className="shrink-0 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                                  {t("myShop.pausedBadge")}
                                </span>
                              )}
                            </div>
                            <div className="text-amber-300 text-sm font-bold">{centsToDisplay(p.price_cents)}</div>
                            <div className="mt-1.5 flex gap-2">
                              <button className="text-xs text-white/50 hover:text-white flex items-center gap-1" onClick={() => openEditProduct(p)}>
                                <Pencil className="w-3 h-3" /> {t("myShop.edit")}
                              </button>
                              <button
                                className="text-xs text-white/50 hover:text-white flex items-center gap-1 disabled:opacity-50 disabled:pointer-events-none"
                                onClick={() => togglePauseProduct(p)}
                                disabled={pauseTogglingId === p.id}
                              >
                                {p.status === "paused" ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                                {p.status === "paused" ? t("myShop.unpause") : t("myShop.pause")}
                              </button>
                              <button className="text-xs text-red-400/70 hover:text-red-400 flex items-center gap-1" onClick={() => deleteProduct(p)}>
                                <Trash2 className="w-3 h-3" /> {t("myShop.remove")}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Verified-purchase reviews for this shop's products —
                    respond + flag/hide moderation, docked in the
                    seller's shop dashboard (Stack-100 #3, #14). */}
                <SellerReviewsPanel productType="shop_product" heading="Shop reviews" />

                <DiscountCodesCard shop={activeShop} authed={authed} />

                <AnalyticsCard shopId={activeShop.id} authed={authed} />
              </div>
            )}
          </div>
        )}

        <Link href="/dashboard" className="mt-10 inline-flex items-center gap-2 text-sm text-white/40 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> {t("myShop.backToDashboard")}
        </Link>
      </main>

    </div>
  );
}

/* ─── DiscountCodesCard — shop discount codes (0190) ─────────────────────
   Parity with the profile store's discount system: the owner manages
   codes against /api/shops/:id/discounts (owner-scoped server-side);
   checkout validates + applies them and counts a use only when a sale
   actually records. */
interface ShopDiscountRow {
  id: string;
  code: string;
  percentOff: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

function DiscountCodesCard({
  shop, authed,
}: {
  shop: Shop;
  authed: (path: string, init?: RequestInit) => Promise<Response>;
}) {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const [codes, setCodes] = useState<ShopDiscountRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newPct, setNewPct] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const res = await authed(`/api/shops/${shop.id}/discounts`);
      const body = (await res.json().catch(() => ({}))) as { codes?: ShopDiscountRow[] };
      if (!res.ok || !Array.isArray(body.codes)) throw new Error("load");
      setCodes(body.codes);
    } catch {
      setLoadFailed(true);
    }
  }, [authed, shop.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const code = newCode.trim().toUpperCase();
    const pct = Number.parseInt(newPct, 10);
    if (!code || !Number.isInteger(pct) || pct < 1 || pct > 90) {
      setErr(t("myShop.discountCreateFailed"));
      return;
    }
    setCreating(true);
    setErr("");
    try {
      const res = await authed(`/api/shops/${shop.id}/discounts`, {
        method: "POST",
        body: JSON.stringify({ code, percentOff: pct }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setErr(body.error === "CODE_TAKEN" ? t("myShop.discountTaken") : body.message || t("myShop.discountCreateFailed"));
        return;
      }
      setNewCode("");
      setNewPct("");
      await load();
    } catch {
      setErr(t("myShop.discountCreateFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function toggle(row: ShopDiscountRow) {
    setErr("");
    try {
      const res = await authed(`/api/shops/${shop.id}/discounts/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) throw new Error("patch");
      setCodes((prev) => (prev ?? []).map((c) => (c.id === row.id ? { ...c, isActive: !row.isActive } : c)));
    } catch {
      setErr(t("myShop.discountUpdateFailed"));
    }
  }

  async function remove(row: ShopDiscountRow) {
    if (!window.confirm(t("myShop.discountDeleteConfirm"))) return;
    setErr("");
    try {
      const res = await authed(`/api/shops/${shop.id}/discounts/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      setCodes((prev) => (prev ?? []).filter((c) => c.id !== row.id));
    } catch {
      setErr(t("myShop.discountDeleteFailed"));
    }
  }

  const inputCls = "rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/50 outline-none focus:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400/60";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Tag className="h-5 w-5 text-amber-300" /> {t("myShop.discountsTitle")}
      </h2>
      <p className="mt-1 text-xs text-white/45">{t("myShop.discountsHint")}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={newCode}
          onChange={(e) => setNewCode(e.target.value.toUpperCase())}
          placeholder={t("myShop.discountCodePlaceholder")}
          aria-label={t("myShop.discountCodePlaceholder")}
          maxLength={32}
          className={`${inputCls} w-56 uppercase`}
        />
        <input
          value={newPct}
          onChange={(e) => setNewPct(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={t("myShop.discountPercentPlaceholder")}
          aria-label={t("myShop.discountPercentPlaceholder")}
          inputMode="numeric"
          className={`${inputCls} w-32`}
        />
        <button
          onClick={create}
          disabled={creating || !newCode.trim() || !newPct}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-600 px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {creating ? t("myShop.discountCreating") : t("myShop.discountCreate")}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      {loadFailed ? (
        <p className="mt-4 text-sm text-red-300">{t("myShop.discountLoadFailed")}</p>
      ) : codes === null ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> …
        </p>
      ) : codes.length === 0 ? (
        <p className="mt-4 text-sm text-white/40">{t("myShop.discountNone")}</p>
      ) : (
        <div className="mt-4 space-y-2">
          {codes.map((c) => (
            <div
              key={c.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/30 bg-[#F7ECD2]/80" : "border-white/10 bg-black/40"}`}
            >
              <span className="font-mono text-sm font-bold tracking-wide text-amber-200">{c.code}</span>
              <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-bold text-amber-300">−{c.percentOff}%</span>
              <span className="text-xs text-white/45">
                {t("myShop.discountUses", { used: c.usedCount })} · {c.maxUses < 0 ? t("myShop.discountUnlimited") : t("myShop.discountMaxUses", { max: c.maxUses })}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <button
                  onClick={() => toggle(c)}
                  className={`rounded-full px-3 py-1 text-xs font-bold ${c.isActive ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.06] text-white/50"}`}
                >
                  {c.isActive ? t("myShop.discountActive") : t("myShop.discountOff")}
                </button>
                <button onClick={() => remove(c)} className="text-xs text-red-400/70 hover:text-red-400" aria-label={`Delete ${c.code}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
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
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
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
      if (!res.ok) throw new Error(data.error || t("myShop.domainAttachFailed"));
      setToken(data.verification.value);
      onUpdate({ ...shop, custom_domain: data.domain, domain_verified: false });
    } catch (e) { setError(e instanceof Error ? e.message : t("myShop.domainAttachFailedShort")); }
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
        setError(data.reason || t("myShop.domainNotVerifiedYet"));
      }
    } catch { setError(t("myShop.domainVerifyFailed")); }
    finally { setVerifying(false); }
  }

  async function detach() {
    if (!confirm(t("myShop.domainDisconnectConfirm"))) return;
    setError(null);
    try {
      const res = await authed(`/api/storefronts/${shop.id}/domain`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("myShop.domainDisconnectFailed"));
      setToken(null); setDomain("");
      onUpdate({ ...shop, custom_domain: null, domain_verified: false });
    } catch (e) { setError(e instanceof Error ? e.message : t("myShop.domainDisconnectFailedShort")); }
  }

  function copyToken() {
    if (token) navigator.clipboard.writeText(token).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`mt-6 rounded-xl border p-5 ${isLight ? "bg-[#F7ECD2]/80 border-[#C9A84C]/30" : "border-white/10 bg-black/40"}`}>
      <div className="flex items-center gap-2">
        <Globe className="w-5 h-5 text-amber-300" />
        <div className="text-sm font-bold">{t("myShop.customDomain")}</div>
        {shop.domain_verified && shop.custom_domain && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
            <BadgeCheck className="w-3.5 h-3.5" /> {t("myShop.verified")}
          </span>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

      {!shop.custom_domain ? (
        <div className="mt-3">
          <p className="text-xs text-white/45">
            {t("myShop.domainHint")}
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={domain} onChange={(e) => setDomain(e.target.value)}
              placeholder={t("myShop.domainPlaceholder")} aria-label={t("myShop.domainPlaceholder")}
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/50 outline-none focus:border-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-400/60"
            />
            <button onClick={attach} disabled={busy || !domain.trim()} className={goldBtn}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t("myShop.connect")}
            </button>
          </div>
        </div>
      ) : shop.domain_verified ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-emerald-300">{shop.custom_domain}</p>
          <button onClick={detach} className="text-xs font-bold text-white/40 hover:text-red-300">{t("myShop.disconnect")}</button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 text-sm">
          <p className="font-mono text-xs text-white/70">
            {t("myShop.txtRecordPrefix")} <span className="text-amber-300">bdv-verify.{shop.custom_domain}</span>:
          </p>
          <div className={`flex items-start justify-between gap-2 rounded-lg border p-3 ${isLight ? "bg-[#F7ECD2]/80 border-[#C9A84C]/30" : "border-white/10 bg-black/60"}`}>
            <code className="break-all font-mono text-xs text-amber-300">{token ?? "••••••••"}</code>
            {token && (
              <button onClick={copyToken} className="shrink-0 text-white/50 hover:text-white" title={t("myShop.copyToken")}>
                {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
          </div>
          {!token && (
            <p className="text-xs text-white/40">{t("myShop.tokenHint")}</p>
          )}
          <p className="text-xs text-white/45">
            {t("myShop.cnamePrefix")} <span className="font-mono text-white/70">@</span> →{" "}
            <span className="font-mono text-white/70">cname.bowdownvisuals.com</span>
          </p>
          <div className="flex gap-2">
            <button onClick={verify} disabled={verifying} className={goldBtn}>
              {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
              {t("myShop.verifyDomain")}
            </button>
            <button onClick={detach} className={ghostBtn}>{t("myShop.cancel")}</button>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-white/40">
        {t("myShop.liveAt")} <span className="font-mono text-amber-300/90">/shop/{shop.handle}</span>
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
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  const [data, setData] = useState<{
    totals: { views: number; sales: number; gross_cents: number; platform_fee_cents: number; seller_net_cents: number; pending_orders?: number };
    dailyViews: Array<{ day: string; views: number }>;
    sales: Array<{ id: string; product_name: string | null; amount_cents: number; platform_fee_cents: number; seller_net_cents: number; buyer_email: string | null; created_at: string; payment_status?: string | null; paid_at?: string | null }>;
    pendingSales?: Array<{ id: string; product_name: string | null; amount_cents: number; seller_net_cents: number; created_at: string; payment_status?: string | null }>;
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
      <h2 className="text-lg font-bold">{t("myShop.analytics")} <span className="text-white/40 text-sm font-normal">{t("myShop.free")}</span></h2>
      {loading ? (
        <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-amber-400" /></div>
      ) : !data ? (
        <p className="mt-3 text-sm text-white/40">{t("myShop.analyticsFailed")}</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: t("myShop.statViews"), value: String(data.totals.views) },
              { label: t("myShop.statSales"), value: String(data.totals.sales) },
              { label: t("myShop.statGross"), value: centsToDisplay(data.totals.gross_cents) },
              { label: t("myShop.statYouKeep"), value: centsToDisplay(data.totals.seller_net_cents), gold: true },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl border p-4 ${isLight ? "bg-[#F7ECD2]/80 border-[#C9A84C]/30" : "border-white/10 bg-black/40"}`}>
                <div className={`text-xl font-black ${s.gold ? "text-amber-300" : ""}`}>{s.value}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-white/40">{s.label}</div>
              </div>
            ))}
          </div>

          {data.dailyViews.length > 0 && (
            <div className="mt-5">
              <div className="text-xs font-bold uppercase tracking-wider text-white/40">{t("myShop.views30Days")}</div>
              <div className="mt-2 flex h-20 items-end gap-1">
                {data.dailyViews.map((d) => (
                  <div
                    key={d.day}
                    title={t("myShop.dayViews", { day: d.day, views: d.views })}
                    className="flex-1 rounded-t bg-gradient-to-t from-amber-500/40 to-amber-300/80"
                    style={{ height: `${Math.max(4, (d.views / maxViews) * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <div className="text-xs font-bold uppercase tracking-wider text-white/40">
              {t("myShop.recentSales")} <span className="normal-case font-normal">{t("myShop.platformFeeNote", { pct: data.platformFeePct })}</span>
            </div>
            {data.sales.length === 0 ? (
              <p className="mt-2 text-sm text-white/40">{t("myShop.noSales")}</p>
            ) : (
              <div className="mt-2 space-y-2">
                {data.sales.slice(0, 10).map((sale) => (
                  <div key={sale.id} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm ${isLight ? "bg-[#F7ECD2]/80 border-[#C9A84C]/30" : "border-white/10 bg-black/40"}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-bold">{sale.product_name ?? t("myShop.productFallback")}</span>
                        {/* The seller's win, only ever on a confirmed sale:
                            this list is event_type='sale', which since the
                            real checkout (0144) means payment confirmed. */}
                        {sale.payment_status === "paid" && (
                          <span className="shrink-0 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                            {t("myShop.paidBadge", { defaultValue: "Paid" })}
                          </span>
                        )}
                        {sale.payment_status === "no_payment_required" && (
                          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white/60">
                            {t("myShop.freeOrderBadge", { defaultValue: "Free order" })}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/40">
                        {new Date(sale.paid_at ?? sale.created_at).toLocaleDateString()}{sale.buyer_email ? ` · ${sale.buyer_email}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-bold">{centsToDisplay(sale.amount_cents)}</div>
                      <div className="text-[11px] text-emerald-300">{t("myShop.youKeepAmount", { amount: centsToDisplay(sale.seller_net_cents) })}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(data.pendingSales?.length ?? 0) > 0 && (
            <div className="mt-5">
              <div className="text-xs font-bold uppercase tracking-wider text-white/40">
                {t("myShop.awaitingPayment", { defaultValue: "Awaiting payment" })}
                <span className="normal-case font-normal"> {t("myShop.awaitingPaymentNote", { defaultValue: "— started at checkout, not paid yet. These are not sales until the payment confirms." })}</span>
              </div>
              <div className="mt-2 space-y-2">
                {data.pendingSales!.slice(0, 10).map((sale) => (
                  <div key={sale.id} className={`flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-2.5 text-sm opacity-75 ${isLight ? "bg-[#F7ECD2]/50 border-[#C9A84C]/30" : "border-white/15 bg-black/30"}`}>
                    <div className="min-w-0">
                      <div className="truncate font-bold">{sale.product_name ?? t("myShop.productFallback")}</div>
                      <div className="text-[11px] text-white/40">{new Date(sale.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-bold">{centsToDisplay(sale.amount_cents)}</div>
                      <div className="text-[11px] text-amber-300">{sale.payment_status === "expired" ? t("myShop.checkoutExpired", { defaultValue: "Checkout expired" }) : t("myShop.pendingBadge", { defaultValue: "Pending" })}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
