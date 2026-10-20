import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Clapperboard, Loader2, Sparkles, User, ImageOff, Store, Upload, Share2, Trash2,
  RefreshCw, ClipboardList, Handshake, CheckCircle2, XCircle, RotateCcw, Send, Eye,
  Pin, PinOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  UGC_STYLES,
  UGC_VIDEO_CREDIT_COST,
  UGC_PERSONA_CREDIT_COST,
  UGC_PAYMENT_NOTE,
  briefActionsFor,
  briefStatusLabel,
  ugcAdStatusLabel,
  ugcAdShareText,
  fetchMyShopProducts,
  fetchMyUgcAds,
  generateUgcScript,
  generateUgcPersona,
  createUgcAd,
  generateUgcAdVideo,
  deleteUgcAd,
  pinUgcAd,
  unpinUgcAd,
  pinActionFor,
  fetchUgcBriefs,
  postUgcBrief,
  briefAction,
  fetchUgcAd,
  recordUgcAdShare,
  type UgcAd,
  type UgcBrief,
  type UgcScript,
  type UgcShopProduct,
  type UgcStyleKey,
  type BriefAction,
} from "@/lib/ugc-ads";

/* ─── UGC Product Ads (owner order Oct 19, 2026) ────────────────────────
   Docked in Promote beside Promo Clips and promo cards — one feature,
   two sides:
   - THE MAKER: pick a product (own shop product in one tap, or an
     uploaded product), a style, and a face (own photo, or a generated
     creator persona — which is also how a BUSINESS fronts its own
     product with no real creator), a script (Turbo writes it or you
     do), and generate a 9:16 UGC-style video ad at the promo-clip
     price (400 Visual Bucs; persona portraits are 100, the
     artist-image rate). Prices are printed before anything is charged;
     generation charges are refunded by the server on failure.
   - THE BRIEFS BOARD: brands post briefs, creators claim and deliver
     through the same maker, brands approve. NO money moves through
     the board — the payment note is stated plainly on the board,
     because the site pays nobody real money.
   Lists follow the house discipline: loading / failed-with-retry /
   truly-empty are distinct states; nothing here invents an ad, a
   brief, or a price the server didn't send. */

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";
const labelClass = "text-xs font-bold uppercase tracking-widest text-white/45";
const pill = (active: boolean) =>
  "rounded-xl px-4 py-2.5 text-sm font-semibold transition border text-left " +
  (active
    ? "border-primary/60 bg-primary/15 text-white"
    : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/25 hover:text-white");

type ListState = "loading" | "ready" | "failed";

export function UgcAdsPanel() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();

  /* ── Maker state ── */
  const [productSource, setProductSource] = useState<"shop" | "upload">("shop");
  const [products, setProducts] = useState<UgcShopProduct[]>([]);
  const [productsState, setProductsState] = useState<ListState>("loading");
  const [shopProductId, setShopProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [productBlurb, setProductBlurb] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productImageUrl, setProductImageUrl] = useState("");
  const [style, setStyle] = useState<UgcStyleKey>("honest-review");
  const [faceMode, setFaceMode] = useState<"persona" | "photo" | "none">("persona");
  const [personaDescription, setPersonaDescription] = useState("");
  const [personaUrl, setPersonaUrl] = useState("");
  const [personaBusy, setPersonaBusy] = useState(false);
  const personaKeyRef = useRef("");
  const [facePhotoUrl, setFacePhotoUrl] = useState("");
  const [hook, setHook] = useState("");
  const [scriptLines, setScriptLines] = useState("");
  const [cta, setCta] = useState("");
  const [scriptBusy, setScriptBusy] = useState(false);
  const [makingForBrief, setMakingForBrief] = useState<UgcBrief | null>(null);
  const [generating, setGenerating] = useState(false);
  const [makerError, setMakerError] = useState<string | null>(null);
  const [latestAd, setLatestAd] = useState<UgcAd | null>(null);

  /* ── My ads ── */
  const [ads, setAds] = useState<UgcAd[]>([]);
  const [adsState, setAdsState] = useState<ListState>("loading");
  const [busyAdId, setBusyAdId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* ── Briefs board ── */
  const [boardScope, setBoardScope] = useState<"open" | "posted" | "claimed">("open");
  const [briefs, setBriefs] = useState<UgcBrief[]>([]);
  const [briefsState, setBriefsState] = useState<ListState>("loading");
  const [briefForm, setBriefForm] = useState({ productName: "", details: "", style: "problem-fix" as UgcStyleKey, deadline: "", productUrl: "", productImageUrl: "" });
  const [postingBrief, setPostingBrief] = useState(false);
  const [busyBriefId, setBusyBriefId] = useState<string | null>(null);
  const [deliverPick, setDeliverPick] = useState<Record<string, string>>({});
  const [reviewAd, setReviewAd] = useState<UgcAd | null>(null);

  const token = useCallback(() => getAccessToken(), [getAccessToken]);

  const loadProducts = useCallback(async () => {
    setProductsState("loading");
    try {
      setProducts(await fetchMyShopProducts(await token()));
      setProductsState("ready");
    } catch {
      setProductsState("failed");
    }
  }, [token]);

  const loadAds = useCallback(async () => {
    setAdsState("loading");
    try {
      setAds(await fetchMyUgcAds(await token()));
      setAdsState("ready");
    } catch {
      setAdsState("failed");
    }
  }, [token]);

  const loadBriefs = useCallback(async () => {
    setBriefsState("loading");
    try {
      const page = await fetchUgcBriefs(await token(), boardScope);
      setBriefs(page.briefs);
      setBriefsState("ready");
    } catch {
      setBriefsState("failed");
    }
  }, [token, boardScope]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => { void loadAds(); }, [loadAds]);
  useEffect(() => { void loadBriefs(); }, [loadBriefs]);

  const scriptFromForm = useCallback((): UgcScript | null => {
    const lines = scriptLines.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!hook.trim() || lines.length === 0 || !cta.trim()) return null;
    return { hook: hook.trim(), lines, cta: cta.trim() };
  }, [hook, scriptLines, cta]);

  const currentProductName = useMemo(() => {
    if (productSource === "shop") {
      return products.find((p) => p.id === shopProductId)?.name ?? "";
    }
    return productName.trim();
  }, [productSource, products, shopProductId, productName]);

  async function writeScriptWithTurbo() {
    if (!currentProductName) {
      setMakerError("Pick or name the product first — Turbo writes about the product.");
      return;
    }
    setScriptBusy(true);
    setMakerError(null);
    try {
      const script = await generateUgcScript(await token(), {
        productName: currentProductName,
        productBlurb: productBlurb.trim() || undefined,
        style,
      });
      setHook(script.hook);
      setScriptLines(script.lines.join("\n"));
      setCta(script.cta);
    } catch (err) {
      setMakerError(err instanceof Error ? err.message : "The script didn't come through — try again.");
    } finally {
      setScriptBusy(false);
    }
  }

  async function makePersona() {
    if (personaDescription.trim().length < 10) {
      setMakerError("Describe the creator in a sentence or two first.");
      return;
    }
    setPersonaBusy(true);
    setMakerError(null);
    try {
      if (!personaKeyRef.current) {
        personaKeyRef.current = `persona-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const { personaUrl: url } = await generateUgcPersona(await token(), personaDescription.trim(), personaKeyRef.current);
      setPersonaUrl(url);
      refreshProfile();
    } catch (err) {
      /* A failed attempt was refunded — the retry must be a NEW intent
         (fresh idempotency key), never a replay of the refunded one. */
      personaKeyRef.current = "";
      setMakerError(err instanceof Error ? err.message : "The persona didn't come through — try again.");
    } finally {
      setPersonaBusy(false);
    }
  }

  /** Create the draft (if needed) and generate its video in one tap. */
  async function generateAd() {
    const script = scriptFromForm();
    if (!script) {
      setMakerError("The ad needs a script — write one above or let Turbo write it.");
      return;
    }
    if (productSource === "shop" && !shopProductId) {
      setMakerError("Pick one of your shop products first.");
      return;
    }
    if (productSource === "upload" && !productName.trim()) {
      setMakerError("Name the product this ad is for.");
      return;
    }
    if (faceMode === "persona" && !personaUrl) {
      setMakerError("Generate the persona first — or switch the face to your own photo / no face.");
      return;
    }
    setGenerating(true);
    setMakerError(null);
    try {
      const priceCents = productPrice.trim() ? Math.round(Number(productPrice) * 100) : undefined;
      const ad = await createUgcAd(await token(), {
        productSource,
        shopProductId: productSource === "shop" ? shopProductId : undefined,
        productName: productSource === "upload" ? productName.trim() : undefined,
        productBlurb: productBlurb.trim() || undefined,
        productPriceCents: productSource === "upload" && priceCents !== undefined && Number.isFinite(priceCents) ? priceCents : undefined,
        productImageUrl: productSource === "upload" && productImageUrl.trim() ? productImageUrl.trim() : undefined,
        style,
        faceImageUrl: faceMode === "persona" ? personaUrl : faceMode === "photo" ? (facePhotoUrl.trim() || null) : null,
        faceKind: faceMode === "persona" ? "persona" : faceMode === "photo" ? "photo" : undefined,
        script,
        briefId: makingForBrief?.id,
      });
      const { ad: ready } = await generateUgcAdVideo(await token(), ad.id);
      setLatestAd(ready);
      setAds((prev) => [ready, ...prev.filter((a) => a.id !== ready.id)]);
      setAdsState("ready");
      refreshProfile();
      toast({ title: "Your UGC ad is ready", description: `${ready.productName} — saved to your ads and your clip library.` });
    } catch (err) {
      setMakerError(err instanceof Error ? err.message : "Generation failed — any charge was refunded.");
      void loadAds();
    } finally {
      setGenerating(false);
    }
  }

  async function regenerate(ad: UgcAd) {
    setBusyAdId(ad.id);
    try {
      const { ad: ready } = await generateUgcAdVideo(await token(), ad.id);
      setAds((prev) => prev.map((a) => (a.id === ready.id ? ready : a)));
      if (latestAd?.id === ready.id) setLatestAd(ready);
      refreshProfile();
    } catch (err) {
      toast({ title: "Generation failed", description: err instanceof Error ? err.message : "Any charge was refunded.", variant: "destructive" });
      void loadAds();
    } finally {
      setBusyAdId(null);
    }
  }

  /* Pin / unpin (migration 0178): the finished ad goes ON its
     product — the shop page and the profile store play it there.
     State is replaced from the server's response, never guessed. */
  async function togglePin(ad: UgcAd) {
    const action = pinActionFor(ad);
    if (!action) return;
    setBusyAdId(ad.id);
    try {
      const saved = action === "pin"
        ? await pinUgcAd(await token(), ad.id)
        : await unpinUgcAd(await token(), ad.id);
      setAds((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      if (latestAd?.id === saved.id) setLatestAd(saved);
      void loadProducts();
      toast({
        title: action === "pin" ? "Pinned to your product" : "Unpinned",
        description: action === "pin"
          ? `${ad.productName} — buyers see this ad on the product now.`
          : `${ad.productName} — the ad no longer shows on the product.`,
      });
    } catch (err) {
      toast({ title: action === "pin" ? "Couldn't pin that ad" : "Couldn't unpin that ad", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusyAdId(null);
    }
  }

  async function removeAd(ad: UgcAd) {
    setBusyAdId(ad.id);
    try {
      await deleteUgcAd(await token(), ad.id);
      setAds((prev) => prev.filter((a) => a.id !== ad.id));
      if (latestAd?.id === ad.id) setLatestAd(null);
      setConfirmDeleteId(null);
    } catch (err) {
      toast({ title: "Couldn't delete that ad", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusyAdId(null);
    }
  }

  async function shareAd(ad: UgcAd) {
    if (!ad.videoUrl) return;
    const text = ugcAdShareText(ad);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${ad.productName} — UGC ad`, text, url: ad.videoUrl });
        void recordUgcAdShare(await token(), ad.id, "native");
      } else {
        await navigator.clipboard.writeText(`${text}\n${ad.videoUrl}`);
        void recordUgcAdShare(await token(), ad.id, "copy");
        toast({ title: "Link copied", description: "Your ad's link is on the clipboard." });
      }
    } catch {
      /* a dismissed share sheet tracks nothing and says nothing */
    }
  }

  /* ── Brief actions ── */
  async function submitBrief() {
    if (!briefForm.productName.trim() || briefForm.details.trim().length < 10) {
      toast({ title: "The brief needs a product and a real description", variant: "destructive" });
      return;
    }
    setPostingBrief(true);
    try {
      const brief = await postUgcBrief(await token(), {
        productName: briefForm.productName.trim(),
        details: briefForm.details.trim(),
        style: briefForm.style,
        deadline: briefForm.deadline ? new Date(`${briefForm.deadline}T23:59:59`).toISOString() : undefined,
        productUrl: briefForm.productUrl.trim() || undefined,
        productImageUrl: briefForm.productImageUrl.trim() || undefined,
      });
      setBriefForm({ productName: "", details: "", style: "problem-fix", deadline: "", productUrl: "", productImageUrl: "" });
      setBoardScope("posted");
      setBriefs((prev) => [brief, ...prev]);
      setBriefsState("ready");
      toast({ title: "Brief posted", description: "It's on the board — creators can claim it now." });
    } catch (err) {
      toast({ title: "Couldn't post that brief", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setPostingBrief(false);
    }
  }

  async function runBriefAction(brief: UgcBrief, action: BriefAction) {
    setBusyBriefId(brief.id);
    try {
      const body = action === "deliver" ? { adId: deliverPick[brief.id] } : undefined;
      if (action === "deliver" && !body?.adId) {
        toast({ title: "Pick one of your finished ads to deliver", variant: "destructive" });
        return;
      }
      const updated = await briefAction(await token(), brief.id, action, body);
      setBriefs((prev) => prev.map((b) => (b.id === updated.id ? updated : b)).filter((b) => {
        if (boardScope === "open") return b.status === "open";
        return true;
      }));
      if (action === "deliver") toast({ title: "Delivered", description: "The brand can review your ad now." });
      if (action === "approve") toast({ title: "Approved", description: "This brief is complete." });
    } catch (err) {
      toast({ title: "That didn't land", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      void loadBriefs();
    } finally {
      setBusyBriefId(null);
    }
  }

  function startAdForBrief(brief: UgcBrief) {
    setMakingForBrief(brief);
    setProductSource("upload");
    setProductName(brief.productName);
    setStyle((UGC_STYLES.some((s) => s.key === brief.style) ? brief.style : "honest-review") as UgcStyleKey);
    if (brief.productImageUrl) setProductImageUrl(brief.productImageUrl);
    document.getElementById("ugc-maker")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function reviewDeliveredAd(brief: UgcBrief) {
    if (!brief.deliveredAdId) return;
    setBusyBriefId(brief.id);
    try {
      setReviewAd(await fetchUgcAd(await token(), brief.deliveredAdId));
    } catch {
      toast({ title: "Couldn't load the delivered ad", variant: "destructive" });
    } finally {
      setBusyBriefId(null);
    }
  }

  const myReadyAds = useMemo(() => ads.filter((a) => a.status === "ready"), [ads]);
  const shell = isLight
    ? "border-[#C9A84C]/40 bg-gradient-to-b from-white/[0.05] to-[#F4E7C3]"
    : "border-primary/25 bg-gradient-to-b from-white/[0.05] to-[#0d0a04]";

  if (!user) {
    return (
      <div className={`rounded-2xl border p-6 md:p-8 text-center ${shell}`}>
        <Clapperboard className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-3 text-xl font-bold">UGC Product Ads</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
          Make creator-style video ads for your products — or post a brief and let a creator make one for you.
        </p>
        <Link href="/login">
          <span className="mt-4 inline-block cursor-pointer rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110">
            Sign in to make ads
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-6 md:p-8 ${shell}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-amber-400/25 to-yellow-600/10">
          <Clapperboard className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold">UGC Product Ads</h2>
          <p className="mt-1 text-sm text-white/55">
            A real creator-style video ad for a product — selfie energy, a script with a hook, your branding kit applied.
            Video generation is {UGC_VIDEO_CREDIT_COST} Visual Bucs (the promo-clip price); a generated persona face is {UGC_PERSONA_CREDIT_COST}.
            Brands: post a brief below and a creator makes the ad for you.
          </p>
        </div>
      </div>

      {/* ── MAKER ─────────────────────────────────────────────────── */}
      <div id="ugc-maker" className="mt-8">
        {makingForBrief && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
            <Handshake className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1">
              You're making this ad for a brief: <strong>{makingForBrief.productName}</strong> — “{makingForBrief.details}”
            </span>
            <button onClick={() => setMakingForBrief(null)} className="font-semibold text-white/60 transition hover:text-white">
              Not for this brief
            </button>
          </div>
        )}

        <label className={labelClass}>1 · The product</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setProductSource("shop")} className={pill(productSource === "shop")}>
            <span className="inline-flex items-center gap-1.5"><Store className="h-4 w-4" /> From my shop</span>
          </button>
          <button onClick={() => setProductSource("upload")} className={pill(productSource === "upload")}>
            <span className="inline-flex items-center gap-1.5"><Upload className="h-4 w-4" /> Upload a product</span>
          </button>
        </div>

        {productSource === "shop" ? (
          <div className="mt-3">
            {productsState === "loading" && (
              <p className="inline-flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading your shop products…</p>
            )}
            {productsState === "failed" && (
              <p className="text-sm text-red-200">
                Couldn't load your shop products.{" "}
                <button onClick={() => void loadProducts()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </button>
              </p>
            )}
            {productsState === "ready" && products.length === 0 && (
              <p className="text-sm text-white/50">
                No products in your shop yet — add one in <Link href="/my-shop" className="font-semibold text-primary hover:underline">My Shop</Link>, or switch to “Upload a product”.
              </p>
            )}
            {productsState === "ready" && products.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setShopProductId(p.id)}
                    className={pill(shopProductId === p.id) + " flex items-center gap-3"}
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5"><ImageOff className="h-4 w-4 text-white/30" /></span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.name}</span>
                      <span className="block text-xs font-normal text-white/40">${(p.priceCents / 100).toFixed(2)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Product name *" maxLength={120} className={inputClass} />
            <input value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder="Price in dollars (optional)" inputMode="decimal" className={inputClass} />
            <input value={productImageUrl} onChange={(e) => setProductImageUrl(e.target.value)} placeholder="Product photo link (https://…)" maxLength={2048} className={`${inputClass} sm:col-span-2`} />
          </div>
        )}
        <input
          value={productBlurb}
          onChange={(e) => setProductBlurb(e.target.value)}
          placeholder="One line on what makes it worth buying (optional)"
          maxLength={600}
          className={`${inputClass} mt-3`}
        />

        <label className={`${labelClass} mt-7 block`}>2 · The style</label>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {UGC_STYLES.map((s) => (
            <button key={s.key} onClick={() => setStyle(s.key)} className={pill(style === s.key)}>
              <span className="block font-semibold">{s.label}</span>
              <span className="mt-0.5 block text-xs font-normal text-white/40">{s.blurb}</span>
            </button>
          ))}
        </div>

        <label className={`${labelClass} mt-7 block`}>3 · The face</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setFaceMode("persona")} className={pill(faceMode === "persona")}>Generated creator persona</button>
          <button onClick={() => setFaceMode("photo")} className={pill(faceMode === "photo")}>My own photo</button>
          <button onClick={() => setFaceMode("none")} className={pill(faceMode === "none")}>No face — product only</button>
        </div>
        {faceMode === "persona" && (
          <div className="mt-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={personaDescription}
                onChange={(e) => { setPersonaDescription(e.target.value); personaKeyRef.current = ""; }}
                placeholder="Describe the creator — e.g. “a 30-year-old barber in Chicago, locs, warm laugh”"
                maxLength={400}
                className={`${inputClass} flex-1`}
              />
              <button
                onClick={() => void makePersona()}
                disabled={personaBusy}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/15 px-5 py-3 text-sm font-bold text-white transition hover:bg-primary/25 disabled:opacity-50"
              >
                {personaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                {personaUrl ? "Regenerate" : "Generate"} persona · {UGC_PERSONA_CREDIT_COST} VB
              </button>
            </div>
            {personaUrl && (
              <div className="mt-3 flex items-center gap-3">
                <img src={personaUrl} alt="Your generated creator persona" className="h-24 w-16 rounded-xl object-cover" />
                <p className="text-sm text-white/55">This is the face your ad is filmed with. Businesses: this is your creator — no real person needed.</p>
              </div>
            )}
          </div>
        )}
        {faceMode === "photo" && (
          <input
            value={facePhotoUrl}
            onChange={(e) => setFacePhotoUrl(e.target.value)}
            placeholder="Link to your photo or character image (https://…) — your vault photos work"
            maxLength={2048}
            className={`${inputClass} mt-3`}
          />
        )}

        <label className={`${labelClass} mt-7 block`}>4 · The script</label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void writeScriptWithTurbo()}
            disabled={scriptBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/15 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary/25 disabled:opacity-50"
          >
            {scriptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Write it with Turbo
          </button>
          <span className="text-xs text-white/40">Free — the script rides inside the ad. Or write your own below.</span>
        </div>
        <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Hook — the first line, made to stop the scroll" maxLength={200} className={`${inputClass} mt-3`} />
        <textarea
          value={scriptLines}
          onChange={(e) => setScriptLines(e.target.value)}
          placeholder={"Spoken lines — one per line\nSay what a real creator would say…"}
          rows={4}
          maxLength={1400}
          className={`${inputClass} mt-3 resize-none`}
        />
        <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Call to action — e.g. “Link's in my shop”" maxLength={200} className={`${inputClass} mt-3`} />

        {makerError && (
          <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{makerError}</div>
        )}

        <button
          onClick={() => void generateAd()}
          disabled={generating}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {generating ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Filming your ad — this takes a minute…</>
          ) : (
            <><Clapperboard className="h-4 w-4" /> Generate my UGC ad · {UGC_VIDEO_CREDIT_COST} Visual Bucs</>
          )}
        </button>
        <p className="mt-2 text-center text-xs text-white/40">
          Vertical 9:16 for TikTok, Reels, and Shorts. Captions from your script are burned in, and your branding kit is applied.
          If a generation fails, the {UGC_VIDEO_CREDIT_COST} Visual Bucs are refunded automatically.
        </p>

        {latestAd?.status === "ready" && latestAd.videoUrl && (
          <AdResult ad={latestAd} onShare={() => void shareAd(latestAd)} />
        )}
      </div>

      {/* ── MY ADS ────────────────────────────────────────────────── */}
      <div className="mt-10">
        <h3 className="text-base font-bold">My UGC ads</h3>
        {adsState === "loading" && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading your ads…</p>
        )}
        {adsState === "failed" && (
          <p className="mt-3 text-sm text-red-200">
            Couldn't load your ads.{" "}
            <button onClick={() => void loadAds()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </p>
        )}
        {adsState === "ready" && ads.length === 0 && (
          <p className="mt-3 text-sm text-white/50">No UGC ads yet — your first one is made above.</p>
        )}
        {adsState === "ready" && ads.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ads.map((ad) => (
              <div key={ad.id} className="rounded-xl border border-white/10 bg-black/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{ad.productName}</p>
                    <p className="mt-0.5 text-xs text-white/40">
                      {UGC_STYLES.find((s) => s.key === ad.style)?.label ?? ad.style} · {new Date(ad.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${ad.status === "ready" ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : ad.status === "failed" ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-primary/40 bg-primary/10 text-primary"}`}>
                    {ugcAdStatusLabel(ad.status)}
                  </span>
                </div>
                {ad.status === "ready" && ad.videoUrl && (
                  <video src={ad.videoUrl} controls playsInline className="mt-3 aspect-[9/16] max-h-72 w-full rounded-lg bg-black object-contain" />
                )}
                {ad.status === "failed" && ad.lastError && (
                  <p className="mt-3 text-xs text-red-200/80">{ad.lastError} Your Visual Bucs were refunded.</p>
                )}
                {ad.pinnedProductId && (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Pin className="h-3.5 w-3.5" />
                    Pinned to {products.find((p) => p.id === ad.pinnedProductId)?.name ?? ad.productName} — buyers see this ad on the product.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {(ad.status === "draft" || ad.status === "failed") && (
                    <button
                      onClick={() => void regenerate(ad)}
                      disabled={busyAdId === ad.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50"
                    >
                      {busyAdId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />}
                      Generate · {UGC_VIDEO_CREDIT_COST} VB
                    </button>
                  )}
                  {ad.status === "ready" && ad.videoUrl && (
                    <button
                      onClick={() => void shareAd(ad)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </button>
                  )}
                  {pinActionFor(ad) === "pin" && (
                    <button
                      onClick={() => void togglePin(ad)}
                      disabled={busyAdId === ad.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                    >
                      {busyAdId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />} Pin to product
                    </button>
                  )}
                  {pinActionFor(ad) === "unpin" && (
                    <button
                      onClick={() => void togglePin(ad)}
                      disabled={busyAdId === ad.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
                    >
                      {busyAdId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PinOff className="h-3.5 w-3.5" />} Unpin
                    </button>
                  )}
                  {confirmDeleteId === ad.id ? (
                    <>
                      <button onClick={() => void removeAd(ad)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/50 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-200">
                        <Trash2 className="h-3.5 w-3.5" /> Confirm delete
                      </button>
                      <button onClick={() => setConfirmDeleteId(null)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-white/50 hover:text-white">Keep</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(ad.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/45 transition hover:border-red-400/40 hover:text-red-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── BRIEFS BOARD ──────────────────────────────────────────── */}
      <div className="mt-12 border-t border-white/10 pt-8">
        <div className="flex items-center gap-2.5">
          <ClipboardList className="h-5 w-5 text-primary" />
          <h3 className="text-base font-bold">Briefs board — brands &amp; creators</h3>
        </div>
        <p className="mt-2 rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3 text-sm text-white/70">
          {UGC_PAYMENT_NOTE} The board handles the work — the brief, the claim, the delivery, the approval — never the money.
        </p>

        {/* Post a brief */}
        <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <p className="text-sm font-bold">Post a brief (for brands &amp; businesses)</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={briefForm.productName} onChange={(e) => setBriefForm({ ...briefForm, productName: e.target.value })} placeholder="Product name *" maxLength={120} className={inputClass} />
            <select value={briefForm.style} onChange={(e) => setBriefForm({ ...briefForm, style: e.target.value as UgcStyleKey })} className={`${inputClass} cursor-pointer appearance-none`}>
              {UGC_STYLES.map((s) => (
                <option key={s.key} value={s.key} className="bg-black">{s.label}</option>
              ))}
            </select>
            <input value={briefForm.productUrl} onChange={(e) => setBriefForm({ ...briefForm, productUrl: e.target.value })} placeholder="Product page link (optional)" maxLength={2048} className={inputClass} />
            <input type="date" value={briefForm.deadline} onChange={(e) => setBriefForm({ ...briefForm, deadline: e.target.value })} className={`${inputClass} [color-scheme:dark]`} aria-label="Deadline (optional)" />
            <input value={briefForm.productImageUrl} onChange={(e) => setBriefForm({ ...briefForm, productImageUrl: e.target.value })} placeholder="Product photo link (optional)" maxLength={2048} className={`${inputClass} sm:col-span-2`} />
          </div>
          <textarea
            value={briefForm.details}
            onChange={(e) => setBriefForm({ ...briefForm, details: e.target.value })}
            placeholder="What do you want in the ad? The moments it has to hit, what to say, what to never say…"
            rows={3}
            maxLength={2000}
            className={`${inputClass} mt-3 resize-none`}
          />
          <button
            onClick={() => void submitBrief()}
            disabled={postingBrief}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {postingBrief ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Post the brief
          </button>
        </div>

        {/* Board scopes */}
        <div className="mt-6 flex flex-wrap gap-2">
          {(
            [
              { key: "open", label: "Open briefs" },
              { key: "posted", label: "Briefs I posted" },
              { key: "claimed", label: "Briefs I claimed" },
            ] as const
          ).map((s) => (
            <button key={s.key} onClick={() => setBoardScope(s.key)} className={pill(boardScope === s.key)}>{s.label}</button>
          ))}
        </div>

        {briefsState === "loading" && (
          <p className="mt-4 inline-flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading the board…</p>
        )}
        {briefsState === "failed" && (
          <p className="mt-4 text-sm text-red-200">
            Couldn't load the board.{" "}
            <button onClick={() => void loadBriefs()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </p>
        )}
        {briefsState === "ready" && briefs.length === 0 && (
          <p className="mt-4 text-sm text-white/50">
            {boardScope === "open" && "No open briefs right now — post one above, or check back soon."}
            {boardScope === "posted" && "You haven't posted a brief yet — the form above is yours."}
            {boardScope === "claimed" && "You haven't claimed a brief yet — the open board is waiting."}
          </p>
        )}
        {briefsState === "ready" && briefs.length > 0 && (
          <div className="mt-4 space-y-3">
            {briefs.map((brief) => {
              const actions = briefActionsFor(brief, user?.id ?? null);
              const busy = busyBriefId === brief.id;
              return (
                <div key={brief.id} className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {brief.productImageUrl && <img src={brief.productImageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />}
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{brief.productName}</p>
                        <p className="mt-0.5 text-sm text-white/60">{brief.details}</p>
                        <p className="mt-1 text-xs text-white/40">
                          {UGC_STYLES.find((s) => s.key === brief.style)?.label ?? brief.style}
                          {brief.deadline ? ` · needed by ${new Date(brief.deadline).toLocaleDateString()}` : ""}
                          {brief.productUrl ? <> · <a href={brief.productUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">product page</a></> : null}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                      {briefStatusLabel(brief.status)}
                    </span>
                  </div>

                  {brief.status === "delivered" && brief.brandUserId === user?.id && (
                    <button
                      onClick={() => void reviewDeliveredAd(brief)}
                      disabled={busy}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Review the delivered ad
                    </button>
                  )}
                  {reviewAd && brief.deliveredAdId === reviewAd.id && (
                    <div className="mt-3">
                      <video src={reviewAd.videoUrl ?? undefined} controls playsInline className="aspect-[9/16] max-h-80 w-full rounded-lg bg-black object-contain" />
                      {reviewAd.captions.length > 0 && (
                        <p className="mt-2 text-xs text-white/45">Captions: {reviewAd.captions.join(" · ")}</p>
                      )}
                    </div>
                  )}

                  {actions.includes("deliver") && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        value={deliverPick[brief.id] ?? ""}
                        onChange={(e) => setDeliverPick({ ...deliverPick, [brief.id]: e.target.value })}
                        className="min-w-44 flex-1 cursor-pointer appearance-none rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
                      >
                        <option value="" className="bg-black">Pick one of your finished ads…</option>
                        {myReadyAds.map((a) => (
                          <option key={a.id} value={a.id} className="bg-black">{a.productName} — {new Date(a.createdAt).toLocaleDateString()}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => startAdForBrief(brief)}
                        className="rounded-lg border border-primary/50 bg-primary/15 px-3 py-2 text-xs font-bold text-white transition hover:bg-primary/25"
                      >
                        Make the ad for this brief
                      </button>
                    </div>
                  )}

                  {actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {actions.includes("claim") && (
                        <button onClick={() => void runBriefAction(brief, "claim")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                          <Handshake className="h-3.5 w-3.5" /> Claim this brief
                        </button>
                      )}
                      {actions.includes("deliver") && (
                        <button onClick={() => void runBriefAction(brief, "deliver")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                          <Send className="h-3.5 w-3.5" /> Deliver the ad
                        </button>
                      )}
                      {actions.includes("approve") && (
                        <button onClick={() => void runBriefAction(brief, "approve")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve delivery
                        </button>
                      )}
                      {actions.includes("release") && (
                        <button onClick={() => void runBriefAction(brief, "release")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:text-white disabled:opacity-50">
                          <RotateCcw className="h-3.5 w-3.5" /> Release
                        </button>
                      )}
                      {actions.includes("close") && (
                        <button onClick={() => void runBriefAction(brief, "close")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-50">
                          <XCircle className="h-3.5 w-3.5" /> Close brief
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdResult({ ad, onShare }: { ad: UgcAd; onShare: () => void }) {
  return (
    <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.05] p-4">
      <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> Your ad is ready — {ad.productName}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
        <video src={ad.videoUrl ?? undefined} controls playsInline className="aspect-[9/16] w-full rounded-lg bg-black object-contain" />
        <div className="text-sm text-white/65">
          {ad.brand && (ad.brand.brandName || ad.brand.logoUrl) && (
            <p className="flex items-center gap-2">
              {ad.brand.logoUrl && <img src={ad.brand.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />}
              Branding kit applied{ad.brand.brandName ? ` — ${ad.brand.brandName}` : ""}
              {ad.brand.primaryColor ? <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/25" style={{ background: ad.brand.primaryColor }} /> : null}
            </p>
          )}
          <p className="mt-2">
            Captions: {ad.captionsBurned ? "burned into the video" : "saved with the ad"} — {ad.captions.join(" · ")}
          </p>
          <p className="mt-2">It's saved in your ads above and in your clip library.</p>
          <button
            onClick={onShare}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-primary/50 hover:text-white"
          >
            <Share2 className="h-3.5 w-3.5" /> Share it
          </button>
        </div>
      </div>
    </div>
  );
}
