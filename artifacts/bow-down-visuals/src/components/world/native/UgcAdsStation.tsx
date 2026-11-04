import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2, Clapperboard, ClipboardList, Eye, Handshake, Loader2, Pin, PinOff,
  RotateCcw, Send, Share2, Sparkles, Trash2, User, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  UGC_PAYMENT_NOTE,
  UGC_PERSONA_CREDIT_COST,
  UGC_STYLES,
  UGC_VIDEO_CREDIT_COST,
  briefActionsFor,
  briefStatusLabel,
  createUgcAd,
  deleteUgcAd,
  fetchMyShopProducts,
  fetchMyUgcAds,
  fetchUgcAd,
  fetchUgcBriefs,
  generateUgcScript,
  normalizeUgcAd,
  pinActionFor,
  pinUgcAd,
  postUgcBrief,
  briefAction,
  recordUgcAdShare,
  ugcAdShareText,
  ugcAdStatusLabel,
  unpinUgcAd,
  type BriefAction,
  type UgcAd,
  type UgcBrief,
  type UgcShopProduct,
  type UgcStyleKey,
} from "@/lib/ugc-ads";
import {
  buildBriefInput,
  buildUgcCreateInput,
  makePersonaKey,
  makerProductName,
  personaDescriptionReady,
  scriptFromMaker,
  ugcBriefStrings,
  ugcMakerStrings,
  validateBriefForm,
  validateUgcMaker,
  type UgcBriefFormState,
  type UgcMakerState,
} from "@/lib/world/ugc-station";

/** Catalog keys for the board-scope chips — the scope ids ride the
 *  rail; the desk renders the catalog words, keyed by the scope. */
const SCOPE_LABEL_KEYS: Record<string, string> = {
  open: "worldLivePromo.ugcScopeOpen",
  posted: "worldLivePromo.ugcScopePosted",
  claimed: "worldLivePromo.ugcScopeClaimed",
};

/* ─── UGC Product Ads, in-world (Stack-100 #56) ─────────────────────
   The headline Promote feature, docked in the Promote Room beside
   promo cards and the Scheduler — the website panel's whole flow on
   its own seam (lib/ugc-ads): pick a product (shop or upload), a
   style, a face (persona 100 VB / own photo / none), a script (Turbo
   writes it free, or yours), film the ad (400 VB, refunded on
   failure), pin the finished ad to its product, and work the briefs
   board (post / claim / deliver / approve — with the board's own
   honesty note: the site does not hold or move money for briefs).
   The two charged calls (persona, generate) ride the credit
   confirmation with the seam's prices as overrides — the registry
   carries no ugc entry, and the price is printed on the button
   before anything runs either way. */

const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

type ListState = "loading" | "ready" | "failed";

const EMPTY_MAKER: UgcMakerState = {
  productSource: "shop",
  shopProductId: "",
  productName: "",
  productBlurb: "",
  productPrice: "",
  productImageUrl: "",
  style: "honest-review",
  faceMode: "persona",
  personaUrl: "",
  facePhotoUrl: "",
  hook: "",
  scriptLines: "",
  cta: "",
  briefId: null,
};

const EMPTY_BRIEF_FORM: UgcBriefFormState = {
  productName: "",
  details: "",
  style: "problem-fix",
  deadline: "",
  productUrl: "",
  productImageUrl: "",
};

export function UgcAdsStation({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const token = useCallback(() => getAccessToken(), [getAccessToken]);

  const [maker, setMaker] = useState<UgcMakerState>(EMPTY_MAKER);
  const [personaDescription, setPersonaDescription] = useState("");
  const personaKeyRef = useRef("");
  const [products, setProducts] = useState<UgcShopProduct[]>([]);
  const [productsState, setProductsState] = useState<ListState>("loading");
  const [ads, setAds] = useState<UgcAd[]>([]);
  const [adsState, setAdsState] = useState<ListState>("loading");
  const [busyAdId, setBusyAdId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [personaBusy, setPersonaBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [makerError, setMakerError] = useState<string | null>(null);
  const [latestAd, setLatestAd] = useState<UgcAd | null>(null);
  const [makingForBrief, setMakingForBrief] = useState<UgcBrief | null>(null);

  const [boardScope, setBoardScope] = useState<"open" | "posted" | "claimed">("open");
  const [briefs, setBriefs] = useState<UgcBrief[]>([]);
  const [briefsState, setBriefsState] = useState<ListState>("loading");
  const [briefForm, setBriefForm] = useState<UgcBriefFormState>(EMPTY_BRIEF_FORM);
  const [postingBrief, setPostingBrief] = useState(false);
  const [busyBriefId, setBusyBriefId] = useState<string | null>(null);
  const [deliverPick, setDeliverPick] = useState<Record<string, string>>({});
  const [reviewAd, setReviewAd] = useState<UgcAd | null>(null);
  const [boardNote, setBoardNote] = useState<string | null>(null);

  const set = (patch: Partial<UgcMakerState>) => setMaker((m) => ({ ...m, ...patch }));

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

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const noteCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const productName = makerProductName(maker, products);
  // Surrounding component copy in the seams' own words, from the
  // catalog (units 36–43 pattern); the seams' EN defaults ride the
  // rails byte-identical when nothing is passed.
  const makerStrings = ugcMakerStrings(t);
  const briefStrings = ugcBriefStrings(t);

  /* ── Maker actions ── */

  const writeScript = async () => {
    if (!productName) {
      setMakerError(t("worldLivePromo.ugcScriptFirst"));
      return;
    }
    setScriptBusy(true);
    setMakerError(null);
    try {
      const script = await generateUgcScript(await token(), {
        productName,
        productBlurb: maker.productBlurb.trim() || undefined,
        style: maker.style,
      });
      set({ hook: script.hook, scriptLines: script.lines.join("\n"), cta: script.cta });
    } catch (err) {
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcScriptFailed")));
    } finally {
      setScriptBusy(false);
    }
  };

  const makePersona = async () => {
    if (!personaDescriptionReady(personaDescription)) {
      setMakerError(t("worldLivePromo.ugcPersonaDescFirst"));
      return;
    }
    setPersonaBusy(true);
    setMakerError(null);
    try {
      if (!personaKeyRef.current) {
        personaKeyRef.current = makePersonaKey(Date.now(), Math.random().toString(36).slice(2, 10));
      }
      const res = await confirmedFetch("/api/ugc-ads/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: personaDescription.trim(), idempotencyKey: personaKeyRef.current }),
        overrideCost: UGC_PERSONA_CREDIT_COST,
        overrideFeature: "UGC Creator Persona",
      });
      if (!res) return; // confirmation declined — nothing charged
      const data = (await res.json().catch(() => ({}))) as { personaUrl?: unknown; error?: string; message?: string };
      if (!res.ok || typeof data.personaUrl !== "string") {
        /* A failed attempt was refunded — the retry is a NEW intent. */
        personaKeyRef.current = "";
        setMakerError(apiErrorMessage(data, t("worldLivePromo.ugcPersonaFailed")));
        return;
      }
      set({ personaUrl: data.personaUrl });
      refreshProfile();
    } catch {
      personaKeyRef.current = "";
      setMakerError(t("worldLivePromo.ugcPersonaFailed"));
    } finally {
      setPersonaBusy(false);
    }
  };

  /** Generate one ad's video on the charged rail; shared by the
   *  maker's Generate tap and a draft/failed ad's retry. */
  const generateVideo = async (adId: string): Promise<UgcAd | null> => {
    const res = await confirmedFetch(`/api/ugc-ads/${adId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      overrideCost: UGC_VIDEO_CREDIT_COST,
      overrideFeature: "UGC Ad Video",
    });
    if (!res) return null; // confirmation declined — nothing charged
    const data: unknown = await res.json().catch(() => ({}));
    const ad = normalizeUgcAd((data as { ad?: unknown }).ad);
    if (!res.ok || !ad) {
      const d = data as { error?: string; message?: string };
      throw new Error(apiErrorMessage(d, t("worldLivePromo.ugcGenerationFailed")));
    }
    return ad;
  };

  const generateAd = async () => {
    const problem = validateUgcMaker(maker, makerStrings);
    if (problem) {
      setMakerError(problem);
      return;
    }
    const input = buildUgcCreateInput(maker);
    if (!input) {
      setMakerError(t("worldLivePromo.ugcMakerScriptNeeded"));
      return;
    }
    setGenerating(true);
    setMakerError(null);
    try {
      const ad = await createUgcAd(await token(), input);
      const ready = await generateVideo(ad.id);
      if (!ready) return; // declined at the confirmation — the draft waits in My ads
      setLatestAd(ready);
      setAds((prev) => [ready, ...prev.filter((a) => a.id !== ready.id)]);
      setAdsState("ready");
      refreshProfile();
    } catch (err) {
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcGenerationFailed")));
      void loadAds();
    } finally {
      setGenerating(false);
    }
  };

  const regenerate = async (ad: UgcAd) => {
    setBusyAdId(ad.id);
    setMakerError(null);
    try {
      const ready = await generateVideo(ad.id);
      if (!ready) return;
      setAds((prev) => prev.map((a) => (a.id === ready.id ? ready : a)));
      if (latestAd?.id === ready.id) setLatestAd(ready);
      refreshProfile();
    } catch (err) {
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcGenerationFailed")));
      void loadAds();
    } finally {
      setBusyAdId(null);
    }
  };

  const togglePin = async (ad: UgcAd) => {
    const action = pinActionFor(ad);
    if (!action) return;
    setBusyAdId(ad.id);
    try {
      const saved = action === "pin" ? await pinUgcAd(await token(), ad.id) : await unpinUgcAd(await token(), ad.id);
      setAds((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      if (latestAd?.id === saved.id) setLatestAd(saved);
      void loadProducts();
    } catch (err) {
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcPinFailed")));
    } finally {
      setBusyAdId(null);
    }
  };

  const removeAd = async (ad: UgcAd) => {
    setBusyAdId(ad.id);
    try {
      await deleteUgcAd(await token(), ad.id);
      setAds((prev) => prev.filter((a) => a.id !== ad.id));
      if (latestAd?.id === ad.id) setLatestAd(null);
      setConfirmDeleteId(null);
    } catch (err) {
      setMakerError(plainErrorText(err, t("worldLivePromo.ugcDeleteFailed")));
    } finally {
      setBusyAdId(null);
    }
  };

  const shareAd = async (ad: UgcAd) => {
    if (!ad.videoUrl) return;
    const text = ugcAdShareText(ad);
    try {
      if (navigator.share) {
        await navigator.share({ title: t("worldLivePromo.ugcShareTitle", { name: ad.productName }), text, url: ad.videoUrl });
        void recordUgcAdShare(await token(), ad.id, "native");
      } else {
        await navigator.clipboard.writeText(`${text}\n${ad.videoUrl}`);
        void recordUgcAdShare(await token(), ad.id, "copy");
        setMakerError(null);
        setBoardNote(t("worldLivePromo.ugcClipboardNote"));
      }
    } catch {
      /* a dismissed share sheet tracks nothing and says nothing */
    }
  };

  /* ── Briefs board actions ── */

  const submitBrief = async () => {
    const problem = validateBriefForm(briefForm, briefStrings);
    if (problem) {
      setBoardNote(problem);
      return;
    }
    setPostingBrief(true);
    setBoardNote(null);
    try {
      const brief = await postUgcBrief(await token(), buildBriefInput(briefForm));
      setBriefForm(EMPTY_BRIEF_FORM);
      setBoardScope("posted");
      setBriefs((prev) => [brief, ...prev]);
      setBriefsState("ready");
      setBoardNote(t("worldLivePromo.ugcBriefPosted"));
    } catch (err) {
      setBoardNote(plainErrorText(err, t("worldLivePromo.ugcBriefPostFailed")));
    } finally {
      setPostingBrief(false);
    }
  };

  const runBriefAction = async (brief: UgcBrief, action: BriefAction) => {
    if (action === "deliver" && !deliverPick[brief.id]) {
      setBoardNote(t("worldLivePromo.ugcDeliverPickFirst"));
      return;
    }
    setBusyBriefId(brief.id);
    setBoardNote(null);
    try {
      const updated = await briefAction(await token(), brief.id, action, action === "deliver" ? { adId: deliverPick[brief.id] } : undefined);
      setBriefs((prev) =>
        prev
          .map((b) => (b.id === updated.id ? updated : b))
          .filter((b) => (boardScope === "open" ? b.status === "open" : true)),
      );
      if (action === "deliver") setBoardNote(t("worldLivePromo.ugcDeliveredNote"));
      if (action === "approve") setBoardNote(t("worldLivePromo.ugcApprovedNote"));
    } catch (err) {
      setBoardNote(plainErrorText(err, t("worldLivePromo.ugcBriefActionFailed")));
      void loadBriefs();
    } finally {
      setBusyBriefId(null);
    }
  };

  const startAdForBrief = (brief: UgcBrief) => {
    setMakingForBrief(brief);
    setMaker({
      ...maker,
      briefId: brief.id,
      productSource: "upload",
      productName: brief.productName,
      style: (UGC_STYLES.some((s) => s.key === brief.style) ? brief.style : "honest-review") as UgcStyleKey,
      productImageUrl: brief.productImageUrl ?? maker.productImageUrl,
    });
    setMakerError(null);
  };

  const reviewDeliveredAd = async (brief: UgcBrief) => {
    if (!brief.deliveredAdId) return;
    setBusyBriefId(brief.id);
    try {
      setReviewAd(await fetchUgcAd(await token(), brief.deliveredAdId));
    } catch {
      setBoardNote(t("worldLivePromo.ugcReviewFailed"));
    } finally {
      setBusyBriefId(null);
    }
  };

  const myReadyAds = ads.filter((a) => a.status === "ready");

  return (
    <NativeCard isLight={isLight} title={t("worldLivePromo.ugcTitle")}>
      <div className="space-y-4" data-testid="world-ugc-station">
        <p className={`text-sm ${muted}`}>
          {t("worldLivePromo.ugcIntro", { videoCost: UGC_VIDEO_CREDIT_COST, personaCost: UGC_PERSONA_CREDIT_COST })}
        </p>

        {/* ── Maker ── */}
        <div className="space-y-3" data-testid="world-ugc-maker">
          {makingForBrief ? (
            <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${isLight ? "border-[#C9A84C]/50" : "border-[#d4af37]/40"}`}>
              <Handshake className="h-4 w-4 text-[#d4af37]" />
              <span className={`flex-1 ${strong}`}>
                {t("worldLivePromo.ugcForBriefPrefix")} <strong>{makingForBrief.productName}</strong> {t("worldLivePromo.ugcForBriefSuffix", { details: makingForBrief.details })}
              </span>
              <button type="button" onClick={() => { setMakingForBrief(null); set({ briefId: null }); }} className={`font-bold bdv-touch-target ${muted}`}>
                {t("worldLivePromo.ugcNotForBrief")}
              </button>
            </div>
          ) : null}

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldLivePromo.ugcStepProduct")}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" data-testid="world-ugc-source-shop" aria-pressed={maker.productSource === "shop"} onClick={() => set({ productSource: "shop" })} className={chipBtn(isLight, maker.productSource === "shop")}>
              {t("worldLivePromo.ugcSourceShop")}
            </button>
            <button type="button" data-testid="world-ugc-source-upload" aria-pressed={maker.productSource === "upload"} onClick={() => set({ productSource: "upload" })} className={chipBtn(isLight, maker.productSource === "upload")}>
              {t("worldLivePromo.ugcSourceUpload")}
            </button>
          </div>
          {maker.productSource === "shop" ? (
            productsState === "loading" ? (
              <NativeLoadingState isLight={isLight} message={t("worldLivePromo.ugcProductsLoading")} />
            ) : productsState === "failed" ? (
              <NativeErrorState isLight={isLight} message={t("worldLivePromo.ugcProductsFailed")} onRetry={() => void loadProducts()} />
            ) : products.length === 0 ? (
              <p className={`text-xs ${muted}`}>{t("worldLivePromo.ugcNoProducts")}</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2" data-testid="world-ugc-products">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid="world-ugc-product"
                    aria-pressed={maker.shopProductId === p.id}
                    onClick={() => set({ shopProductId: p.id })}
                    className={`${chipBtn(isLight, maker.shopProductId === p.id)} justify-start`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{p.name}</span>
                      <span className="block text-[10px] font-semibold opacity-70">${(p.priceCents / 100).toFixed(2)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <input aria-label={t("worldLivePromo.ugcProductNameAria")} data-testid="world-ugc-product-name" className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcProductNamePlaceholder")} value={maker.productName} onChange={(e) => set({ productName: e.target.value })} maxLength={120} />
              <input aria-label={t("worldLivePromo.ugcProductPriceAria")} className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcProductPricePlaceholder")} inputMode="decimal" value={maker.productPrice} onChange={(e) => set({ productPrice: e.target.value })} />
              <input aria-label={t("worldLivePromo.ugcProductPhotoAria")} className={`${inputCls(isLight)} sm:col-span-2`} placeholder={t("worldLivePromo.ugcProductPhotoPlaceholder")} value={maker.productImageUrl} onChange={(e) => set({ productImageUrl: e.target.value })} maxLength={2048} />
            </div>
          )}
          <input aria-label={t("worldLivePromo.ugcBlurbAria")} className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcBlurbPlaceholder")} value={maker.productBlurb} onChange={(e) => set({ productBlurb: e.target.value })} maxLength={600} />

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldLivePromo.ugcStepStyle")}</p>
          <div className="flex flex-wrap gap-1.5" data-testid="world-ugc-styles">
            {UGC_STYLES.map((s) => (
              <button key={s.key} type="button" aria-pressed={maker.style === s.key} onClick={() => set({ style: s.key })} className={chipBtn(isLight, maker.style === s.key)}>
                {s.label}
              </button>
            ))}
          </div>

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldLivePromo.ugcStepFace")}</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={maker.faceMode === "persona"} onClick={() => set({ faceMode: "persona" })} className={chipBtn(isLight, maker.faceMode === "persona")}>{t("worldLivePromo.ugcFacePersona")}</button>
            <button type="button" aria-pressed={maker.faceMode === "photo"} onClick={() => set({ faceMode: "photo" })} className={chipBtn(isLight, maker.faceMode === "photo")}>{t("worldLivePromo.ugcFacePhoto")}</button>
            <button type="button" aria-pressed={maker.faceMode === "none"} onClick={() => set({ faceMode: "none" })} className={chipBtn(isLight, maker.faceMode === "none")}>{t("worldLivePromo.ugcFaceNone")}</button>
          </div>
          {maker.faceMode === "persona" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label={t("worldLivePromo.ugcPersonaDescAria")}
                  data-testid="world-ugc-persona-desc"
                  className={inputCls(isLight)}
                  style={{ flex: "1 1 220px", width: "auto" }}
                  placeholder={t("worldLivePromo.ugcPersonaDescPlaceholder")}
                  value={personaDescription}
                  onChange={(e) => { setPersonaDescription(e.target.value); personaKeyRef.current = ""; }}
                  maxLength={400}
                />
                <button type="button" data-testid="world-ugc-persona-make" onClick={() => void makePersona()} disabled={personaBusy} className={goldBtn}>
                  {personaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                  {maker.personaUrl ? t("worldLivePromo.ugcPersonaRegenerate", { cost: UGC_PERSONA_CREDIT_COST }) : t("worldLivePromo.ugcPersonaGenerate", { cost: UGC_PERSONA_CREDIT_COST })}
                </button>
              </div>
              {maker.personaUrl ? (
                <div className="flex items-center gap-3">
                  <img src={maker.personaUrl} alt={t("worldLivePromo.ugcPersonaAlt")} className="h-20 w-14 rounded-lg object-cover" />
                  <p className={`text-xs ${muted}`}>{t("worldLivePromo.ugcPersonaExplainer")}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {maker.faceMode === "photo" ? (
            <input aria-label={t("worldLivePromo.ugcPhotoAria")} className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcPhotoPlaceholder")} value={maker.facePhotoUrl} onChange={(e) => set({ facePhotoUrl: e.target.value })} maxLength={2048} />
          ) : null}

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>{t("worldLivePromo.ugcStepScript")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="world-ugc-script-turbo" onClick={() => void writeScript()} disabled={scriptBusy} className={goldBtn}>
              {scriptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {t("worldLivePromo.ugcScriptTurbo")}
            </button>
            <span className={`text-[11px] ${muted}`}>{t("worldLivePromo.ugcScriptFreeNote")}</span>
          </div>
          <input aria-label={t("worldLivePromo.ugcHookAria")} data-testid="world-ugc-hook" className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcHookPlaceholder")} value={maker.hook} onChange={(e) => set({ hook: e.target.value })} maxLength={200} />
          <textarea aria-label={t("worldLivePromo.ugcLinesAria")} className={inputCls(isLight)} rows={3} placeholder={t("worldLivePromo.ugcLinesPlaceholder")} value={maker.scriptLines} onChange={(e) => set({ scriptLines: e.target.value })} maxLength={1400} />
          <input aria-label={t("worldLivePromo.ugcCtaAria")} className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcCtaPlaceholder")} value={maker.cta} onChange={(e) => set({ cta: e.target.value })} maxLength={200} />

          {makerError ? <p className={noteCls} data-testid="world-ugc-error">{makerError}</p> : null}
          <button type="button" data-testid="world-ugc-generate" onClick={() => void generateAd()} disabled={generating} className={`${goldBtn} w-full justify-center`}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {generating ? t("worldLivePromo.ugcFilming") : t("worldLivePromo.ugcGenerateAd", { cost: UGC_VIDEO_CREDIT_COST })}
          </button>
          <p className={`text-center text-[11px] ${muted}`}>
            {t("worldLivePromo.ugcFormatNote")}
          </p>
          {latestAd?.status === "ready" && latestAd.videoUrl ? (
            <div className={`rounded-xl border p-3 ${isLight ? "border-emerald-700/40" : "border-emerald-400/30"}`} data-testid="world-ugc-latest">
              <p className={`flex items-center gap-2 text-sm font-bold ${isLight ? "text-emerald-800" : "text-emerald-300"}`}>
                <CheckCircle2 className="h-4 w-4" /> {t("worldLivePromo.ugcAdReady", { name: latestAd.productName })}
              </p>
              <video src={latestAd.videoUrl} controls playsInline className="mt-2 aspect-[9/16] max-h-72 w-full rounded-lg bg-black object-contain" />
              <p className={`mt-2 text-xs ${muted}`}>{t("worldLivePromo.ugcAdSavedNote")}</p>
            </div>
          ) : null}
        </div>

        {/* ── My ads ── */}
        <div className="space-y-2" data-testid="world-ugc-my-ads">
          <p className={`text-sm font-black ${strong}`}>{t("worldLivePromo.ugcMyAds")}</p>
          {adsState === "loading" ? (
            <NativeLoadingState isLight={isLight} message={t("worldLivePromo.ugcAdsLoading")} />
          ) : adsState === "failed" ? (
            <NativeErrorState isLight={isLight} message={t("worldLivePromo.ugcAdsFailed")} onRetry={() => void loadAds()} />
          ) : ads.length === 0 ? (
            <NativeEmptyState isLight={isLight} message={t("worldLivePromo.ugcNoAds")} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {ads.map((ad) => (
                <div key={ad.id} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-ugc-ad">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-bold ${strong}`}>{ad.productName}</p>
                      <p className={`text-[11px] ${muted}`}>
                        {t("worldLivePromo.ugcAdMeta", { style: UGC_STYLES.find((s) => s.key === ad.style)?.label ?? ad.style, date: new Date(ad.createdAt).toLocaleDateString(i18n.language) })}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${muted}`}>{ugcAdStatusLabel(ad.status)}</span>
                  </div>
                  {ad.status === "ready" && ad.videoUrl ? (
                    <video src={ad.videoUrl} controls playsInline className="mt-2 aspect-[9/16] max-h-64 w-full rounded-lg bg-black object-contain" />
                  ) : null}
                  {ad.status === "failed" && ad.lastError ? (
                    <p className={`mt-2 text-[11px] ${noteCls}`}>{ad.lastError} {t("worldLivePromo.ugcRefundedSuffix")}</p>
                  ) : null}
                  {ad.pinnedProductId ? (
                    <p className={`mt-2 flex items-center gap-1.5 text-[11px] font-bold ${strong}`}>
                      <Pin className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldLivePromo.ugcPinnedLine", { name: products.find((p) => p.id === ad.pinnedProductId)?.name ?? ad.productName })}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ad.status === "draft" || ad.status === "failed" ? (
                      <button type="button" data-testid="world-ugc-ad-generate" onClick={() => void regenerate(ad)} disabled={busyAdId === ad.id} className={chipBtn(isLight, true)}>
                        {busyAdId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />} {t("worldLivePromo.ugcAdGenerate", { cost: UGC_VIDEO_CREDIT_COST })}
                      </button>
                    ) : null}
                    {ad.status === "ready" && ad.videoUrl ? (
                      <button type="button" data-testid="world-ugc-ad-share" onClick={() => void shareAd(ad)} className={chipBtn(isLight, false)}>
                        <Share2 className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcShare")}
                      </button>
                    ) : null}
                    {pinActionFor(ad) === "pin" ? (
                      <button type="button" data-testid="world-ugc-ad-pin" onClick={() => void togglePin(ad)} disabled={busyAdId === ad.id} className={chipBtn(isLight, false)}>
                        <Pin className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcPinToProduct")}
                      </button>
                    ) : null}
                    {pinActionFor(ad) === "unpin" ? (
                      <button type="button" data-testid="world-ugc-ad-unpin" onClick={() => void togglePin(ad)} disabled={busyAdId === ad.id} className={chipBtn(isLight, false)}>
                        <PinOff className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcUnpin")}
                      </button>
                    ) : null}
                    {confirmDeleteId === ad.id ? (
                      <>
                        <button type="button" data-testid="world-ugc-ad-delete-confirm" onClick={() => void removeAd(ad)} className={chipBtn(isLight, false)}>
                          <Trash2 className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcConfirmDelete")}
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)} className={chipBtn(isLight, false)}>{t("worldLivePromo.ugcKeep")}</button>
                      </>
                    ) : (
                      <button type="button" data-testid="world-ugc-ad-delete" onClick={() => setConfirmDeleteId(ad.id)} className={chipBtn(isLight, false)}>
                        <Trash2 className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcDelete")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Briefs board ── */}
        <div className={`space-y-3 border-t border-dashed pt-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-ugc-briefs">
          <p className={`flex items-center gap-2 text-sm font-black ${strong}`}>
            <ClipboardList className="h-4 w-4 text-[#d4af37]" /> {t("worldLivePromo.ugcBriefsTitle")}
          </p>
          <p className={`rounded-xl border px-3 py-2 text-xs ${isLight ? "border-[#C9A84C]/50 text-[#6B5B36]" : "border-[#d4af37]/30 text-white/70"}`} data-testid="world-ugc-payment-note">
            {UGC_PAYMENT_NOTE} {t("worldLivePromo.ugcBoardNoteSuffix")}
          </p>

          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-ugc-brief-form">
            <p className={`text-xs font-bold ${strong}`}>{t("worldLivePromo.ugcBriefFormTitle")}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input aria-label={t("worldLivePromo.ugcBriefNameAria")} data-testid="world-ugc-brief-name" className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcProductNamePlaceholder")} value={briefForm.productName} onChange={(e) => setBriefForm({ ...briefForm, productName: e.target.value })} maxLength={120} />
              <select aria-label={t("worldLivePromo.ugcBriefStyleAria")} className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={briefForm.style} onChange={(e) => setBriefForm({ ...briefForm, style: e.target.value as UgcStyleKey })}>
                {UGC_STYLES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <input aria-label={t("worldLivePromo.ugcBriefUrlAria")} className={inputCls(isLight)} placeholder={t("worldLivePromo.ugcBriefUrlPlaceholder")} value={briefForm.productUrl} onChange={(e) => setBriefForm({ ...briefForm, productUrl: e.target.value })} maxLength={2048} />
              <input aria-label={t("worldLivePromo.ugcBriefDeadlineAria")} type="date" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={briefForm.deadline} onChange={(e) => setBriefForm({ ...briefForm, deadline: e.target.value })} />
              <input aria-label={t("worldLivePromo.ugcBriefPhotoAria")} className={`${inputCls(isLight)} sm:col-span-2`} placeholder={t("worldLivePromo.ugcBriefPhotoPlaceholder")} value={briefForm.productImageUrl} onChange={(e) => setBriefForm({ ...briefForm, productImageUrl: e.target.value })} maxLength={2048} />
            </div>
            <textarea aria-label={t("worldLivePromo.ugcBriefDetailsAria")} className={`${inputCls(isLight)} mt-2`} rows={3} placeholder={t("worldLivePromo.ugcBriefDetailsPlaceholder")} value={briefForm.details} onChange={(e) => setBriefForm({ ...briefForm, details: e.target.value })} maxLength={2000} />
            <button type="button" data-testid="world-ugc-brief-post" onClick={() => void submitBrief()} disabled={postingBrief} className={`${goldBtn} mt-2`}>
              {postingBrief ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("worldLivePromo.ugcPostBrief")}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(["open", "posted", "claimed"] as const).map((scope) => (
              <button key={scope} type="button" data-testid={`world-ugc-scope-${scope}`} aria-pressed={boardScope === scope} onClick={() => setBoardScope(scope)} className={chipBtn(isLight, boardScope === scope)}>
                {t(SCOPE_LABEL_KEYS[scope] ?? "worldLivePromo.ugcScopeOpen")}
              </button>
            ))}
          </div>
          {boardNote ? <p className={noteCls}>{boardNote}</p> : null}

          {briefsState === "loading" ? (
            <NativeLoadingState isLight={isLight} message={t("worldLivePromo.ugcBoardLoading")} />
          ) : briefsState === "failed" ? (
            <NativeErrorState isLight={isLight} message={t("worldLivePromo.ugcBoardFailed")} onRetry={() => void loadBriefs()} />
          ) : briefs.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={
                boardScope === "open"
                  ? t("worldLivePromo.ugcNoOpenBriefs")
                  : boardScope === "posted"
                    ? t("worldLivePromo.ugcNoPostedBriefs")
                    : t("worldLivePromo.ugcNoClaimedBriefs")
              }
            />
          ) : (
            <div className="space-y-2">
              {briefs.map((brief) => {
                const actions = briefActionsFor(brief, user?.id ?? null);
                const busy = busyBriefId === brief.id;
                return (
                  <div key={brief.id} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-ugc-brief">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        {brief.productImageUrl ? <img src={brief.productImageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : null}
                        <div className="min-w-0">
                          <p className={`text-sm font-bold ${strong}`}>{brief.productName}</p>
                          <p className={`text-xs ${muted}`}>{brief.details}</p>
                          <p className={`mt-0.5 text-[11px] ${muted}`}>
                            {UGC_STYLES.find((s) => s.key === brief.style)?.label ?? brief.style}
                            {brief.deadline ? t("worldLivePromo.ugcNeededBy", { date: new Date(brief.deadline).toLocaleDateString(i18n.language) }) : ""}
                          </p>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${muted}`}>{briefStatusLabel(brief.status)}</span>
                    </div>

                    {brief.status === "delivered" && brief.brandUserId === user?.id ? (
                      <button type="button" data-testid="world-ugc-brief-review" onClick={() => void reviewDeliveredAd(brief)} disabled={busy} className={`${chipBtn(isLight, false)} mt-2`}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} {t("worldLivePromo.ugcReviewAd")}
                      </button>
                    ) : null}
                    {reviewAd && brief.deliveredAdId === reviewAd.id ? (
                      <div className="mt-2">
                        <video src={reviewAd.videoUrl ?? undefined} controls playsInline className="aspect-[9/16] max-h-72 w-full rounded-lg bg-black object-contain" />
                        {reviewAd.captions.length > 0 ? <p className={`mt-1 text-[11px] ${muted}`}>{t("worldLivePromo.ugcCaptionsLine", { list: reviewAd.captions.join(" · ") })}</p> : null}
                      </div>
                    ) : null}

                    {actions.includes("deliver") ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <select
                          aria-label={t("worldLivePromo.ugcDeliverPickAria")}
                          data-testid="world-ugc-deliver-pick"
                          className={inputCls(isLight)}
                          style={{ colorScheme: isLight ? "light" : "dark", flex: "1 1 180px", width: "auto" }}
                          value={deliverPick[brief.id] ?? ""}
                          onChange={(e) => setDeliverPick({ ...deliverPick, [brief.id]: e.target.value })}
                        >
                          <option value="">{t("worldLivePromo.ugcDeliverPickPlaceholder")}</option>
                          {myReadyAds.map((a) => (
                            <option key={a.id} value={a.id}>{t("worldLivePromo.ugcDeliverOption", { name: a.productName, date: new Date(a.createdAt).toLocaleDateString(i18n.language) })}</option>
                          ))}
                        </select>
                        <button type="button" data-testid="world-ugc-brief-make" onClick={() => startAdForBrief(brief)} className={chipBtn(isLight, false)}>
                          {t("worldLivePromo.ugcMakeForBrief")}
                        </button>
                      </div>
                    ) : null}

                    {actions.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {actions.includes("claim") ? (
                          <button type="button" data-testid="world-ugc-brief-claim" onClick={() => void runBriefAction(brief, "claim")} disabled={busy} className={chipBtn(isLight, true)}>
                            <Handshake className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcClaimBrief")}
                          </button>
                        ) : null}
                        {actions.includes("deliver") ? (
                          <button type="button" data-testid="world-ugc-brief-deliver" onClick={() => void runBriefAction(brief, "deliver")} disabled={busy} className={chipBtn(isLight, true)}>
                            <Send className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcDeliverAd")}
                          </button>
                        ) : null}
                        {actions.includes("approve") ? (
                          <button type="button" data-testid="world-ugc-brief-approve" onClick={() => void runBriefAction(brief, "approve")} disabled={busy} className={chipBtn(isLight, true)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcApproveDelivery")}
                          </button>
                        ) : null}
                        {actions.includes("release") ? (
                          <button type="button" data-testid="world-ugc-brief-release" onClick={() => void runBriefAction(brief, "release")} disabled={busy} className={chipBtn(isLight, false)}>
                            <RotateCcw className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcRelease")}
                          </button>
                        ) : null}
                        {actions.includes("close") ? (
                          <button type="button" data-testid="world-ugc-brief-close" onClick={() => void runBriefAction(brief, "close")} disabled={busy} className={chipBtn(isLight, false)}>
                            <XCircle className="h-3.5 w-3.5" /> {t("worldLivePromo.ugcCloseBrief")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <p className={`text-[11px] ${muted}`}>
          {scriptFromMaker(maker) ? t("worldLivePromo.ugcScriptReady") : t("worldLivePromo.ugcTipLine")}
        </p>
      </div>
    </NativeCard>
  );
}
