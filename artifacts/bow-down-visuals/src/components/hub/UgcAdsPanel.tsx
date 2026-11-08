import { plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Clapperboard, Loader2, Sparkles, User, ImageOff, Store, Upload, Share2, Trash2,
  RefreshCw, ClipboardList, Handshake, CheckCircle2, XCircle, RotateCcw, Send, Eye,
  Pin, PinOff, ShieldCheck,
} from "lucide-react";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  UGC_STYLES,
  UGC_VIDEO_CREDIT_COST,
  UGC_PERSONA_CREDIT_COST,
  briefActionsFor,
  briefStatusLabel,
  escrowStatusLabel,
  ugcBriefNetPreview,
  ugcFeePct,
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
  fundUgcBrief,
  confirmUgcBriefFunding,
  verifyUgcBriefFunding,
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
     through the same maker, brands approve. A brief may carry a
     price (C-25): the brand funds it on-site once claimed, the site
     holds the payment, and approval releases it to the creator at
     the rail's 5% fee. A brief with no price stays a free brief —
     its payment is arranged directly, and the board says so.
   Lists follow the house discipline: loading / failed-with-retry /
   truly-empty are distinct states; nothing here invents an ad, a
   brief, or a price the server didn't send. */

const moneyCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

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
  /* Locale wiring (Stack-200 D6): this panel renders through the same
     worldLivePromo.ugc* catalog keys its World twin (UgcAdsStation)
     uses; panel-only strings live under ugcAds.*. The lib label
     helpers take the catalog-resolved bundles below — money-adjacent
     values (escrow labels, the money note) are the English source
     verbatim in every catalog. */
  const { t } = useTranslation();
  const escrowLabels = {
    unfunded: t("worldLivePromo.ugcEscrowUnfunded"),
    funding: t("worldLivePromo.ugcEscrowFunding"),
    funded: t("worldLivePromo.ugcEscrowFunded"),
    released: t("worldLivePromo.ugcEscrowReleased"),
    refunded: t("worldLivePromo.ugcEscrowRefunded"),
  };
  const briefStatusLabels = {
    open: t("worldLivePromo.ugcBriefStatusOpen"),
    claimed: t("worldLivePromo.ugcBriefStatusClaimed"),
    delivered: t("worldLivePromo.ugcBriefStatusDelivered"),
    approved: t("worldLivePromo.ugcBriefStatusApproved"),
    closed: t("worldLivePromo.ugcBriefStatusClosed"),
  };
  const adStatusLabels = {
    draft: t("worldLivePromo.ugcAdStatusDraft"),
    generating: t("worldLivePromo.ugcAdStatusGenerating"),
    ready: t("worldLivePromo.ugcAdStatusReady"),
    failed: t("worldLivePromo.ugcAdStatusFailedRefunded"),
  };

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
  const [briefForm, setBriefForm] = useState({ productName: "", details: "", style: "problem-fix" as UgcStyleKey, deadline: "", productUrl: "", productImageUrl: "", price: "" });
  const [postingBrief, setPostingBrief] = useState(false);
  const [busyBriefId, setBusyBriefId] = useState<string | null>(null);
  /* The brief whose embedded funding checkout is mounted, if any. */
  const [fundCheckout, setFundCheckout] = useState<{ briefId: string; clientSecret: string } | null>(null);
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
      setMakerError(t("worldLivePromo.ugcScriptFirst"));
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
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcScriptFailed")));
    } finally {
      setScriptBusy(false);
    }
  }

  async function makePersona() {
    if (personaDescription.trim().length < 10) {
      setMakerError(t("worldLivePromo.ugcPersonaDescFirst"));
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
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcPersonaFailed")));
    } finally {
      setPersonaBusy(false);
    }
  }

  /** Create the draft (if needed) and generate its video in one tap. */
  async function generateAd() {
    const script = scriptFromForm();
    if (!script) {
      setMakerError(t("ugcAds.makerScriptNeeded"));
      return;
    }
    if (productSource === "shop" && !shopProductId) {
      setMakerError(t("worldLivePromo.ugcMakerPickProduct"));
      return;
    }
    if (productSource === "upload" && !productName.trim()) {
      setMakerError(t("worldLivePromo.ugcMakerNameProduct"));
      return;
    }
    if (faceMode === "persona" && !personaUrl) {
      setMakerError(t("worldLivePromo.ugcMakerPersonaFirst"));
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
      toast({ title: t("ugcAds.adReadyTitle"), description: t("ugcAds.adReadyDesc", { name: ready.productName }) });
    } catch (err) {
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcGenerationFailed")));
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
      toast({ title: t("ugcAds.generationFailedTitle"), description: plainErrorText(err, t("ugcAds.refundedNote")), variant: "destructive" });
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
        title: action === "pin" ? t("ugcAds.pinnedTitle") : t("ugcAds.unpinnedTitle"),
        description: action === "pin"
          ? t("ugcAds.pinnedDesc", { name: ad.productName })
          : t("ugcAds.unpinnedDesc", { name: ad.productName }),
      });
    } catch (err) {
      toast({ title: action === "pin" ? t("ugcAds.pinFailed") : t("ugcAds.unpinFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
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
      toast({ title: t("ugcAds.adDeleteFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusyAdId(null);
    }
  }

  async function shareAd(ad: UgcAd) {
    if (!ad.videoUrl) return;
    const text = ugcAdShareText(ad);
    try {
      if (navigator.share) {
        await navigator.share({ title: t("worldLivePromo.ugcShareTitle", { name: ad.productName }), text, url: ad.videoUrl });
        void recordUgcAdShare(await token(), ad.id, "native");
      } else {
        await navigator.clipboard.writeText(`${text}\n${ad.videoUrl}`);
        void recordUgcAdShare(await token(), ad.id, "copy");
        toast({ title: t("ugcAds.linkCopiedTitle"), description: t("worldLivePromo.ugcClipboardNote") });
      }
    } catch {
      /* a dismissed share sheet tracks nothing and says nothing */
    }
  }

  /* ── Brief actions ── */
  async function submitBrief() {
    if (!briefForm.productName.trim() || briefForm.details.trim().length < 10) {
      toast({ title: t("ugcAds.briefNeedsBoth"), variant: "destructive" });
      return;
    }
    setPostingBrief(true);
    try {
      const dollars = Number(briefForm.price);
      const brief = await postUgcBrief(await token(), {
        productName: briefForm.productName.trim(),
        details: briefForm.details.trim(),
        style: briefForm.style,
        deadline: briefForm.deadline ? new Date(`${briefForm.deadline}T23:59:59`).toISOString() : undefined,
        productUrl: briefForm.productUrl.trim() || undefined,
        productImageUrl: briefForm.productImageUrl.trim() || undefined,
        priceCents:
          briefForm.price.trim() && Number.isFinite(dollars) && dollars > 0 ? Math.round(dollars * 100) : undefined,
      });
      setBriefForm({ productName: "", details: "", style: "problem-fix", deadline: "", productUrl: "", productImageUrl: "", price: "" });
      setBoardScope("posted");
      setBriefs((prev) => [brief, ...prev]);
      setBriefsState("ready");
      toast({ title: t("ugcAds.briefPostedTitle"), description: t("ugcAds.briefPostedDesc") });
    } catch (err) {
      toast({ title: t("ugcAds.briefPostFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setPostingBrief(false);
    }
  }

  async function runBriefAction(brief: UgcBrief, action: Exclude<BriefAction, "fund">) {
    setBusyBriefId(brief.id);
    try {
      const body = action === "deliver" ? { adId: deliverPick[brief.id] } : undefined;
      if (action === "deliver" && !body?.adId) {
        toast({ title: t("ugcAds.deliverPickFirst"), variant: "destructive" });
        return;
      }
      const updated = await briefAction(await token(), brief.id, action, body);
      setBriefs((prev) => prev.map((b) => (b.id === updated.id ? updated : b)).filter((b) => {
        if (boardScope === "open") return b.status === "open";
        return true;
      }));
      if (action === "deliver") toast({ title: t("ugcAds.deliveredTitle"), description: t("ugcAds.deliveredDesc") });
      if (action === "approve") {
        if (updated.escrowStatus === "released" && updated.creatorPayoutCents != null) {
          toast({ title: t("ugcAds.approveReleasedTitle"), description: t("ugcAds.approveReleasedDesc", { amount: moneyCents(updated.creatorPayoutCents) }) });
        } else {
          toast({ title: t("ugcAds.approveTitle"), description: t("ugcAds.approveCompleteDesc") });
        }
      }
      if (action === "close" && brief.escrowStatus === "funded" && updated.escrowStatus === "refunded") {
        toast({ title: t("ugcAds.closedRefundTitle"), description: t("ugcAds.closedRefundDesc") });
      }
    } catch (err) {
      toast({ title: t("ugcAds.actionFailedTitle"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      void loadBriefs();
    } finally {
      setBusyBriefId(null);
    }
  }

  /* ── Escrow funding (C-25): the sponsor rail's flow, on the board ──
     Sandbox settles through confirm; a clientSecret mounts the
     embedded checkout right in the card (never leave the site); a
     hosted checkoutUrl is the legacy fallback only. */
  async function fundBrief(brief: UgcBrief) {
    setBusyBriefId(brief.id);
    setFundCheckout(null);
    try {
      const result = await fundUgcBrief(await token(), brief.id, hasStripePublishableKey() ? "embedded" : undefined);
      if (result.sandbox && result.sessionId) {
        const updated = await confirmUgcBriefFunding(await token(), brief.id, result.sessionId);
        setBriefs((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
        toast({ title: t("ugcAds.fundedTitle"), description: t("ugcAds.fundedDesc") });
      } else if (result.clientSecret) {
        setFundCheckout({ briefId: brief.id, clientSecret: result.clientSecret });
      } else if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      }
    } catch (err) {
      toast({ title: t("ugcAds.fundStartFailed"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      void loadBriefs();
    } finally {
      setBusyBriefId(null);
    }
  }

  async function checkFunding(brief: UgcBrief) {
    setBusyBriefId(brief.id);
    try {
      const { brief: updated } = await verifyUgcBriefFunding(await token(), brief.id);
      setBriefs((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      toast({ title: t("ugcAds.fundedTitle"), description: t("ugcAds.fundedDesc") });
    } catch (err) {
      toast({ title: t("ugcAds.notFundedYetTitle"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusyBriefId(null);
    }
  }

  /* Returning from the funding checkout (?ugcBriefFunded=<id>):
     settle from the payment record, then show the board's true state. */
  const fundReturnHandled = useRef(false);
  useEffect(() => {
    if (fundReturnHandled.current) return;
    const fundedId = new URLSearchParams(window.location.search).get("ugcBriefFunded");
    if (!fundedId || fundedId === "0") return;
    fundReturnHandled.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        const { brief: updated } = await verifyUgcBriefFunding(await token(), fundedId);
        setBriefs((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
        toast({ title: t("ugcAds.fundedTitle"), description: t("ugcAds.fundedDesc") });
      } catch {
        /* The board reload shows the true state either way. */
      }
      void loadBriefs();
    })();
  }, [token, loadBriefs]);

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
      toast({ title: t("ugcAds.reviewLoadFailed"), variant: "destructive" });
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
        <h2 className="mt-3 text-xl font-bold">{t("worldLivePromo.ugcTitle")}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
          {t("ugcAds.signedOutBlurb")}
        </p>
        <Link href="/login">
          <span className="mt-4 inline-block cursor-pointer rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-2.5 text-sm font-bold text-black transition hover:brightness-110">
            {t("ugcAds.signInToMakeAds")}
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
          <h2 className="text-xl font-bold">{t("worldLivePromo.ugcTitle")}</h2>
          <p className="mt-1 text-sm text-white/55">
            {t("ugcAds.intro", { videoCost: UGC_VIDEO_CREDIT_COST, personaCost: UGC_PERSONA_CREDIT_COST })}
          </p>
        </div>
      </div>

      {/* ── MAKER ─────────────────────────────────────────────────── */}
      <div id="ugc-maker" className="mt-8">
        {makingForBrief && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
            <Handshake className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1">
              {t("ugcAds.forBriefPrefix")} <strong>{makingForBrief.productName}</strong> {t("worldLivePromo.ugcForBriefSuffix", { details: makingForBrief.details })}
            </span>
            <button onClick={() => setMakingForBrief(null)} className="font-semibold text-white/60 transition hover:text-white">
              {t("worldLivePromo.ugcNotForBrief")}
            </button>
          </div>
        )}

        <label className={labelClass}>{t("worldLivePromo.ugcStepProduct")}</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setProductSource("shop")} className={pill(productSource === "shop")}>
            <span className="inline-flex items-center gap-1.5"><Store className="h-4 w-4" /> {t("worldLivePromo.ugcSourceShop")}</span>
          </button>
          <button onClick={() => setProductSource("upload")} className={pill(productSource === "upload")}>
            <span className="inline-flex items-center gap-1.5"><Upload className="h-4 w-4" /> {t("worldLivePromo.ugcSourceUpload")}</span>
          </button>
        </div>

        {productSource === "shop" ? (
          <div className="mt-3">
            {productsState === "loading" && (
              <p className="inline-flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> {t("worldLivePromo.ugcProductsLoading")}</p>
            )}
            {productsState === "failed" && (
              <p className="text-sm text-red-200">
                {t("worldLivePromo.ugcProductsFailed")}{" "}
                <button onClick={() => void loadProducts()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                  <RefreshCw className="h-3.5 w-3.5" /> {t("common.retry")}
                </button>
              </p>
            )}
            {productsState === "ready" && products.length === 0 && (
              <p className="text-sm text-white/50">
                {t("ugcAds.noProductsPrefix")} <Link href="/my-shop" className="font-semibold text-primary hover:underline">{t("ugcAds.myShopLink")}</Link>{t("ugcAds.noProductsSuffix")}
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
            <input aria-label={t("worldLivePromo.ugcProductNamePlaceholder")} value={productName} onChange={(e) => setProductName(e.target.value)} placeholder={t("worldLivePromo.ugcProductNamePlaceholder")} maxLength={120} className={inputClass} />
            <input aria-label={t("worldLivePromo.ugcProductPriceAria")} value={productPrice} onChange={(e) => setProductPrice(e.target.value)} placeholder={t("worldLivePromo.ugcProductPricePlaceholder")} inputMode="decimal" className={inputClass} />
            <input aria-label={t("worldLivePromo.ugcProductPhotoPlaceholder")} value={productImageUrl} onChange={(e) => setProductImageUrl(e.target.value)} placeholder={t("worldLivePromo.ugcProductPhotoPlaceholder")} maxLength={2048} className={`${inputClass} sm:col-span-2`} />
          </div>
        )}
        <input aria-label={t("worldLivePromo.ugcBlurbPlaceholder")}
          value={productBlurb}
          onChange={(e) => setProductBlurb(e.target.value)}
          placeholder={t("worldLivePromo.ugcBlurbPlaceholder")}
          maxLength={600}
          className={`${inputClass} mt-3`}
        />

        <label className={`${labelClass} mt-7 block`}>{t("worldLivePromo.ugcStepStyle")}</label>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {UGC_STYLES.map((s) => (
            <button key={s.key} onClick={() => setStyle(s.key)} className={pill(style === s.key)}>
              <span className="block font-semibold">{s.label}</span>
              <span className="mt-0.5 block text-xs font-normal text-white/40">{s.blurb}</span>
            </button>
          ))}
        </div>

        <label className={`${labelClass} mt-7 block`}>{t("worldLivePromo.ugcStepFace")}</label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={() => setFaceMode("persona")} className={pill(faceMode === "persona")}>{t("worldLivePromo.ugcFacePersona")}</button>
          <button onClick={() => setFaceMode("photo")} className={pill(faceMode === "photo")}>{t("worldLivePromo.ugcFacePhoto")}</button>
          <button onClick={() => setFaceMode("none")} className={pill(faceMode === "none")}>{t("worldLivePromo.ugcFaceNone")}</button>
        </div>
        {faceMode === "persona" && (
          <div className="mt-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input aria-label={t("worldLivePromo.ugcStepFace")}
                value={personaDescription}
                onChange={(e) => { setPersonaDescription(e.target.value); personaKeyRef.current = ""; }}
                placeholder={t("worldLivePromo.ugcPersonaDescPlaceholder")}
                maxLength={400}
                className={`${inputClass} flex-1`}
              />
              <button
                onClick={() => void makePersona()}
                disabled={personaBusy}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/15 px-5 py-3 text-sm font-bold text-white transition hover:bg-primary/25 disabled:opacity-50"
              >
                {personaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                {personaUrl ? t("worldLivePromo.ugcPersonaRegenerate", { cost: UGC_PERSONA_CREDIT_COST }) : t("worldLivePromo.ugcPersonaGenerate", { cost: UGC_PERSONA_CREDIT_COST })}
              </button>
            </div>
            {personaUrl && (
              <div className="mt-3 flex items-center gap-3">
                <img src={personaUrl} alt={t("worldLivePromo.ugcPersonaAlt")} className="h-24 w-16 rounded-xl object-cover" />
                <p className="text-sm text-white/55">{t("worldLivePromo.ugcPersonaExplainer")}</p>
              </div>
            )}
          </div>
        )}
        {faceMode === "photo" && (
          <input aria-label={t("worldLivePromo.ugcPhotoPlaceholder")}
            value={facePhotoUrl}
            onChange={(e) => setFacePhotoUrl(e.target.value)}
            placeholder={t("worldLivePromo.ugcPhotoPlaceholder")}
            maxLength={2048}
            className={`${inputClass} mt-3`}
          />
        )}

        <label className={`${labelClass} mt-7 block`}>{t("worldLivePromo.ugcStepScript")}</label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void writeScriptWithTurbo()}
            disabled={scriptBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-primary/50 bg-primary/15 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary/25 disabled:opacity-50"
          >
            {scriptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t("worldLivePromo.ugcScriptTurbo")}
          </button>
          <span className="text-xs text-white/40">{t("worldLivePromo.ugcScriptFreeNote")}</span>
        </div>
        <input aria-label={t("worldLivePromo.ugcStepScript")} value={hook} onChange={(e) => setHook(e.target.value)} placeholder={t("worldLivePromo.ugcHookPlaceholder")} maxLength={200} className={`${inputClass} mt-3`} />
        <textarea aria-label={t("worldLivePromo.ugcLinesPlaceholder")}
          value={scriptLines}
          onChange={(e) => setScriptLines(e.target.value)}
          placeholder={t("worldLivePromo.ugcLinesPlaceholder")}
          rows={4}
          maxLength={1400}
          className={`${inputClass} mt-3 resize-none`}
        />
        <input aria-label={t("worldLivePromo.ugcCtaPlaceholder")} value={cta} onChange={(e) => setCta(e.target.value)} placeholder={t("worldLivePromo.ugcCtaPlaceholder")} maxLength={200} className={`${inputClass} mt-3`} />

        {makerError && (
          <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{makerError}</div>
        )}

        <button
          onClick={() => void generateAd()}
          disabled={generating}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {generating ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {t("worldLivePromo.ugcFilming")}</>
          ) : (
            <><Clapperboard className="h-4 w-4" /> {t("worldLivePromo.ugcGenerateAd", { cost: UGC_VIDEO_CREDIT_COST })}</>
          )}
        </button>
        <p className="mt-2 text-center text-xs text-white/40">
          {t("ugcAds.formatNote", { cost: UGC_VIDEO_CREDIT_COST })}
        </p>

        {latestAd?.status === "ready" && latestAd.videoUrl && (
          <AdResult ad={latestAd} onShare={() => void shareAd(latestAd)} />
        )}
      </div>

      {/* ── MY ADS ────────────────────────────────────────────────── */}
      <div className="mt-10">
        <h3 className="text-base font-bold">{t("worldLivePromo.ugcMyAds")}</h3>
        {adsState === "loading" && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> {t("worldLivePromo.ugcAdsLoading")}</p>
        )}
        {adsState === "failed" && (
          <p className="mt-3 text-sm text-red-200">
            {t("worldLivePromo.ugcAdsFailed")}{" "}
            <button onClick={() => void loadAds()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <RefreshCw className="h-3.5 w-3.5" /> {t("common.retry")}
            </button>
          </p>
        )}
        {adsState === "ready" && ads.length === 0 && (
          <p className="mt-3 text-sm text-white/50">{t("worldLivePromo.ugcNoAds")}</p>
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
                    {ugcAdStatusLabel(ad.status, adStatusLabels)}
                  </span>
                </div>
                {ad.status === "ready" && ad.videoUrl && (
                  <video src={ad.videoUrl} controls playsInline className="mt-3 aspect-[9/16] max-h-72 w-full rounded-lg bg-black object-contain" />
                )}
                {ad.status === "failed" && ad.lastError && (
                  <p className="mt-3 text-xs text-red-200/80">{ad.lastError} {t("worldLivePromo.ugcRefundedSuffix")}</p>
                )}
                {ad.pinnedProductId && (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Pin className="h-3.5 w-3.5" />
                    {t("worldLivePromo.ugcPinnedLine", { name: products.find((p) => p.id === ad.pinnedProductId)?.name ?? ad.productName })}
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
                      {t("worldLivePromo.ugcAdGenerate", { cost: UGC_VIDEO_CREDIT_COST })}
                    </button>
                  )}
                  {ad.status === "ready" && ad.videoUrl && (
                    <button
                      onClick={() => void shareAd(ad)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white"
                    >
                      <Share2 className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcShare")}
                    </button>
                  )}
                  {pinActionFor(ad) === "pin" && (
                    <button
                      onClick={() => void togglePin(ad)}
                      disabled={busyAdId === ad.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                    >
                      {busyAdId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />} {t("worldLivePromo.ugcPinToProduct")}
                    </button>
                  )}
                  {pinActionFor(ad) === "unpin" && (
                    <button
                      onClick={() => void togglePin(ad)}
                      disabled={busyAdId === ad.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
                    >
                      {busyAdId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PinOff className="h-3.5 w-3.5" />} {t("worldLivePromo.ugcUnpin")}
                    </button>
                  )}
                  {confirmDeleteId === ad.id ? (
                    <>
                      <button onClick={() => void removeAd(ad)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/50 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-200">
                        <Trash2 className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcConfirmDelete")}
                      </button>
                      <button onClick={() => setConfirmDeleteId(null)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-white/50 hover:text-white">{t("worldLivePromo.ugcKeep")}</button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(ad.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-white/45 transition hover:border-red-400/40 hover:text-red-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcDelete")}
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
          <h3 className="text-base font-bold">{t("worldLivePromo.ugcBriefsTitle")}</h3>
        </div>
        <p className="mt-2 rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3 text-sm text-white/70">
          {t("worldLivePromo.ugcBriefsMoneyNote")}
        </p>

        {/* Post a brief */}
        <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4">
          <p className="text-sm font-bold">{t("worldLivePromo.ugcBriefFormTitle")}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input aria-label={t("worldLivePromo.ugcProductNamePlaceholder")} value={briefForm.productName} onChange={(e) => setBriefForm({ ...briefForm, productName: e.target.value })} placeholder={t("worldLivePromo.ugcProductNamePlaceholder")} maxLength={120} className={inputClass} />
            <select aria-label={t("ugcAds.adStyleAria")} value={briefForm.style} onChange={(e) => setBriefForm({ ...briefForm, style: e.target.value as UgcStyleKey })} className={`${inputClass} cursor-pointer appearance-none`}>
              {UGC_STYLES.map((s) => (
                <option key={s.key} value={s.key} className="bg-black">{s.label}</option>
              ))}
            </select>
            <input aria-label={t("worldLivePromo.ugcBriefUrlPlaceholder")} value={briefForm.productUrl} onChange={(e) => setBriefForm({ ...briefForm, productUrl: e.target.value })} placeholder={t("worldLivePromo.ugcBriefUrlPlaceholder")} maxLength={2048} className={inputClass} />
            <input type="date" value={briefForm.deadline} onChange={(e) => setBriefForm({ ...briefForm, deadline: e.target.value })} className={`${inputClass} [color-scheme:dark]`} aria-label={t("ugcAds.deadlineAria")} />
            <input aria-label={t("worldLivePromo.ugcBriefPhotoPlaceholder")} value={briefForm.productImageUrl} onChange={(e) => setBriefForm({ ...briefForm, productImageUrl: e.target.value })} placeholder={t("worldLivePromo.ugcBriefPhotoPlaceholder")} maxLength={2048} className={`${inputClass} sm:col-span-2`} />
            <input aria-label={t("worldLivePromo.ugcBriefPriceAria")} value={briefForm.price} onChange={(e) => setBriefForm({ ...briefForm, price: e.target.value })} placeholder={t("worldLivePromo.ugcBriefPricePlaceholder")} inputMode="decimal" className={inputClass} />
            <p className="self-center text-xs text-white/45">
              {t("worldLivePromo.ugcBriefPriceHelp", { feePct: ugcFeePct(null) })}
            </p>
          </div>
          <textarea aria-label={t("worldLivePromo.ugcBriefDetailsPlaceholder")}
            value={briefForm.details}
            onChange={(e) => setBriefForm({ ...briefForm, details: e.target.value })}
            placeholder={t("worldLivePromo.ugcBriefDetailsPlaceholder")}
            rows={3}
            maxLength={2000}
            className={`${inputClass} mt-3 resize-none`}
          />
          <button
            onClick={() => void submitBrief()}
            disabled={postingBrief}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
          >
            {postingBrief ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("worldLivePromo.ugcPostBrief")}
          </button>
        </div>

        {/* Board scopes */}
        <div className="mt-6 flex flex-wrap gap-2">
          {(
            [
              { key: "open", label: t("worldLivePromo.ugcScopeOpen") },
              { key: "posted", label: t("worldLivePromo.ugcScopePosted") },
              { key: "claimed", label: t("worldLivePromo.ugcScopeClaimed") },
            ] as const
          ).map((s) => (
            <button key={s.key} onClick={() => setBoardScope(s.key)} className={pill(boardScope === s.key)}>{s.label}</button>
          ))}
        </div>

        {briefsState === "loading" && (
          <p className="mt-4 inline-flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> {t("worldLivePromo.ugcBoardLoading")}</p>
        )}
        {briefsState === "failed" && (
          <p className="mt-4 text-sm text-red-200">
            {t("worldLivePromo.ugcBoardFailed")}{" "}
            <button onClick={() => void loadBriefs()} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <RefreshCw className="h-3.5 w-3.5" /> {t("common.retry")}
            </button>
          </p>
        )}
        {briefsState === "ready" && briefs.length === 0 && (
          <p className="mt-4 text-sm text-white/50">
            {boardScope === "open" && t("worldLivePromo.ugcNoOpenBriefs")}
            {boardScope === "posted" && t("worldLivePromo.ugcNoPostedBriefs")}
            {boardScope === "claimed" && t("worldLivePromo.ugcNoClaimedBriefs")}
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
                          {brief.deadline ? t("worldLivePromo.ugcNeededBy", { date: new Date(brief.deadline).toLocaleDateString() }) : ""}
                          {brief.productUrl ? <> · <a href={brief.productUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{t("ugcAds.productPageLink")}</a></> : null}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
                      {briefStatusLabel(brief.status, briefStatusLabels)}
                    </span>
                  </div>

                  {brief.priceCents != null && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 font-bold text-white/85">
                        {t("ugcAds.priceChip", { amount: moneyCents(brief.priceCents) })}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 font-semibold text-white/70">
                        {escrowStatusLabel(brief.escrowStatus, escrowLabels)}
                      </span>
                      {(() => {
                        const preview = ugcBriefNetPreview(brief);
                        if (!preview) return null;
                        if (brief.escrowStatus === "released" && brief.creatorPayoutCents != null) {
                          return <span className="text-white/50">{t("ugcAds.wentToCreator", { amount: moneyCents(brief.creatorPayoutCents) })}</span>;
                        }
                        if (brief.escrowStatus === "refunded") return null;
                        return (
                          <span className="text-white/50">
                            {t("worldLivePromo.ugcCreatorReceives", { net: moneyCents(preview.netCents), gross: moneyCents(brief.priceCents), fee: moneyCents(preview.feeCents), feePct: ugcFeePct(brief.feeBps) })}
                          </span>
                        );
                      })()}
                    </div>
                  )}

                  {brief.status === "delivered" && brief.brandUserId === user?.id && (
                    <button
                      onClick={() => void reviewDeliveredAd(brief)}
                      disabled={busy}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {t("worldLivePromo.ugcReviewAd")}
                    </button>
                  )}
                  {reviewAd && brief.deliveredAdId === reviewAd.id && (
                    <div className="mt-3">
                      <video src={reviewAd.videoUrl ?? undefined} controls playsInline className="aspect-[9/16] max-h-80 w-full rounded-lg bg-black object-contain" />
                      {reviewAd.captions.length > 0 && (
                        <p className="mt-2 text-xs text-white/45">{t("worldLivePromo.ugcCaptionsLine", { list: reviewAd.captions.join(" · ") })}</p>
                      )}
                    </div>
                  )}

                  {actions.includes("deliver") && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select aria-label={t("ugcAds.deliverPickAria")}
                        value={deliverPick[brief.id] ?? ""}
                        onChange={(e) => setDeliverPick({ ...deliverPick, [brief.id]: e.target.value })}
                        className="min-w-44 flex-1 cursor-pointer appearance-none rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white outline-none focus:border-primary/60"
                      >
                        <option value="" className="bg-black">{t("worldLivePromo.ugcDeliverPickPlaceholder")}</option>
                        {myReadyAds.map((a) => (
                          <option key={a.id} value={a.id} className="bg-black">{t("worldLivePromo.ugcDeliverOption", { name: a.productName, date: new Date(a.createdAt).toLocaleDateString() })}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => startAdForBrief(brief)}
                        className="rounded-lg border border-primary/50 bg-primary/15 px-3 py-2 text-xs font-bold text-white transition hover:bg-primary/25"
                      >
                        {t("worldLivePromo.ugcMakeForBrief")}
                      </button>
                    </div>
                  )}

                  {actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {actions.includes("claim") && (
                        <button onClick={() => void runBriefAction(brief, "claim")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                          <Handshake className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcClaimBrief")}
                        </button>
                      )}
                      {actions.includes("fund") && (
                        <button onClick={() => void fundBrief(brief)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />} {t("worldLivePromo.ugcFundBrief", { amount: brief.priceCents != null ? moneyCents(brief.priceCents) : "" })}
                        </button>
                      )}
                      {actions.includes("deliver") && (
                        <button onClick={() => void runBriefAction(brief, "deliver")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                          <Send className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcDeliverAd")}
                        </button>
                      )}
                      {actions.includes("approve") && (
                        <button onClick={() => void runBriefAction(brief, "approve")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50">
                          <CheckCircle2 className="h-3.5 w-3.5" /> {brief.priceCents != null && brief.escrowStatus === "funded" ? t("worldLivePromo.ugcApproveRelease", { amount: moneyCents(brief.priceCents) }) : t("worldLivePromo.ugcApproveDelivery")}
                        </button>
                      )}
                      {actions.includes("release") && (
                        <button onClick={() => void runBriefAction(brief, "release")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:text-white disabled:opacity-50">
                          <RotateCcw className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcRelease")}
                        </button>
                      )}
                      {actions.includes("close") && (
                        <button onClick={() => void runBriefAction(brief, "close")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/60 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-50">
                          <XCircle className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcCloseBrief")}
                        </button>
                      )}
                    </div>
                  )}

                  {brief.priceCents != null && brief.escrowStatus === "funding" && brief.brandUserId === user?.id && (
                    <button
                      onClick={() => void checkFunding(brief)}
                      disabled={busy}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/70 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {t("ugcAds.checkFundingStatus")}
                    </button>
                  )}

                  {fundCheckout?.briefId === brief.id && (
                    <div className="mt-3 space-y-2" data-testid="ugc-brief-fund-embedded-checkout">
                      <p className="text-xs text-white/50">
                        {t("ugcAds.fundingPanelNote")}
                      </p>
                      <EmbeddedSessionCheckout clientSecret={fundCheckout.clientSecret} />
                      <button onClick={() => setFundCheckout(null)} className="text-xs text-white/40 hover:text-white">
                        {t("ugcAds.fundingPanelClose")}
                      </button>
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
  const { t } = useTranslation();
  return (
    <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-400/[0.05] p-4">
      <p className="inline-flex items-center gap-2 text-sm font-bold text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> {t("worldLivePromo.ugcAdReady", { name: ad.productName })}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
        <video src={ad.videoUrl ?? undefined} controls playsInline className="aspect-[9/16] w-full rounded-lg bg-black object-contain" />
        <div className="text-sm text-white/65">
          {ad.brand && (ad.brand.brandName || ad.brand.logoUrl) && (
            <p className="flex items-center gap-2">
              {ad.brand.logoUrl && <img src={ad.brand.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />}
              {t("ugcAds.brandingKitApplied")}{ad.brand.brandName ? ` — ${ad.brand.brandName}` : ""}
              {ad.brand.primaryColor ? <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/25" style={{ background: ad.brand.primaryColor }} /> : null}
            </p>
          )}
          <p className="mt-2">
            {ad.captionsBurned ? t("ugcAds.captionsBurned", { list: ad.captions.join(" · ") }) : t("ugcAds.captionsSaved", { list: ad.captions.join(" · ") })}
          </p>
          <p className="mt-2">{t("ugcAds.adSavedNote")}</p>
          <button
            onClick={onShare}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-semibold text-white/75 transition hover:border-primary/50 hover:text-white"
          >
            <Share2 className="h-3.5 w-3.5" /> {t("ugcAds.shareIt")}
          </button>
        </div>
      </div>
    </div>
  );
}
