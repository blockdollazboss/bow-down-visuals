import { useCallback, useEffect, useRef, useState } from "react";
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
  validateBriefForm,
  validateUgcMaker,
  type UgcBriefFormState,
  type UgcMakerState,
} from "@/lib/world/ugc-station";

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
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50";

const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
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

  /* ── Maker actions ── */

  const writeScript = async () => {
    if (!productName) {
      setMakerError("Pick or name the product first — Turbo writes about the product.");
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
      setMakerError(err instanceof Error ? err.message : "The script didn't come through — try again.");
    } finally {
      setScriptBusy(false);
    }
  };

  const makePersona = async () => {
    if (!personaDescriptionReady(personaDescription)) {
      setMakerError("Describe the creator in a sentence or two first.");
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
        setMakerError(data.message ?? data.error ?? "The persona didn't come through — try again.");
        return;
      }
      set({ personaUrl: data.personaUrl });
      refreshProfile();
    } catch {
      personaKeyRef.current = "";
      setMakerError("The persona didn't come through — try again.");
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
      throw new Error(d.message ?? d.error ?? "Generation failed — any charge was refunded.");
    }
    return ad;
  };

  const generateAd = async () => {
    const problem = validateUgcMaker(maker);
    if (problem) {
      setMakerError(problem);
      return;
    }
    const input = buildUgcCreateInput(maker);
    if (!input) {
      setMakerError("The ad needs a script — write one below or let Turbo write it.");
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
      setMakerError(err instanceof Error ? err.message : "Generation failed — any charge was refunded.");
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
      setMakerError(err instanceof Error ? err.message : "Generation failed — any charge was refunded.");
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
      setMakerError(err instanceof Error ? err.message : "That pin didn't land — try again.");
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
      setMakerError(err instanceof Error ? err.message : "Couldn't delete that ad.");
    } finally {
      setBusyAdId(null);
    }
  };

  const shareAd = async (ad: UgcAd) => {
    if (!ad.videoUrl) return;
    const text = ugcAdShareText(ad);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${ad.productName} — UGC ad`, text, url: ad.videoUrl });
        void recordUgcAdShare(await token(), ad.id, "native");
      } else {
        await navigator.clipboard.writeText(`${text}\n${ad.videoUrl}`);
        void recordUgcAdShare(await token(), ad.id, "copy");
        setMakerError(null);
        setBoardNote("Your ad's link is on the clipboard.");
      }
    } catch {
      /* a dismissed share sheet tracks nothing and says nothing */
    }
  };

  /* ── Briefs board actions ── */

  const submitBrief = async () => {
    const problem = validateBriefForm(briefForm);
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
      setBoardNote("Brief posted — it's on the board, creators can claim it now.");
    } catch (err) {
      setBoardNote(err instanceof Error ? err.message : "Couldn't post that brief — try again.");
    } finally {
      setPostingBrief(false);
    }
  };

  const runBriefAction = async (brief: UgcBrief, action: BriefAction) => {
    if (action === "deliver" && !deliverPick[brief.id]) {
      setBoardNote("Pick one of your finished ads to deliver first.");
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
      if (action === "deliver") setBoardNote("Delivered — the brand can review your ad now.");
      if (action === "approve") setBoardNote("Approved — this brief is complete.");
    } catch (err) {
      setBoardNote(err instanceof Error ? err.message : "That didn't land — try again.");
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
      setBoardNote("Couldn't load the delivered ad — try again.");
    } finally {
      setBusyBriefId(null);
    }
  };

  const myReadyAds = ads.filter((a) => a.status === "ready");

  return (
    <NativeCard isLight={isLight} title="UGC Product Ads">
      <div className="space-y-4" data-testid="world-ugc-station">
        <p className={`text-sm ${muted}`}>
          A real creator-style video ad for a product — a script with a hook, a face, your branding kit applied.
          Video generation is {UGC_VIDEO_CREDIT_COST} Visual Bucs; a generated persona face is {UGC_PERSONA_CREDIT_COST}.
          Prices show before anything runs, and a failed generation is refunded.
        </p>

        {/* ── Maker ── */}
        <div className="space-y-3" data-testid="world-ugc-maker">
          {makingForBrief ? (
            <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${isLight ? "border-[#C9A84C]/50" : "border-[#d4af37]/40"}`}>
              <Handshake className="h-4 w-4 text-[#d4af37]" />
              <span className={`flex-1 ${strong}`}>
                Making this ad for a brief: <strong>{makingForBrief.productName}</strong> — “{makingForBrief.details}”
              </span>
              <button type="button" onClick={() => { setMakingForBrief(null); set({ briefId: null }); }} className={`font-bold ${muted}`}>
                Not for this brief
              </button>
            </div>
          ) : null}

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>1 · The product</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" data-testid="world-ugc-source-shop" aria-pressed={maker.productSource === "shop"} onClick={() => set({ productSource: "shop" })} className={chipBtn(isLight, maker.productSource === "shop")}>
              From my shop
            </button>
            <button type="button" data-testid="world-ugc-source-upload" aria-pressed={maker.productSource === "upload"} onClick={() => set({ productSource: "upload" })} className={chipBtn(isLight, maker.productSource === "upload")}>
              Upload a product
            </button>
          </div>
          {maker.productSource === "shop" ? (
            productsState === "loading" ? (
              <NativeLoadingState isLight={isLight} message="Loading your shop products…" />
            ) : productsState === "failed" ? (
              <NativeErrorState isLight={isLight} message="Couldn't load your shop products." onRetry={() => void loadProducts()} />
            ) : products.length === 0 ? (
              <p className={`text-xs ${muted}`}>No products in your shop yet — switch to “Upload a product” and name it here.</p>
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
              <input aria-label="Product name" data-testid="world-ugc-product-name" className={inputCls(isLight)} placeholder="Product name *" value={maker.productName} onChange={(e) => set({ productName: e.target.value })} maxLength={120} />
              <input aria-label="Product price in dollars" className={inputCls(isLight)} placeholder="Price in dollars (optional)" inputMode="decimal" value={maker.productPrice} onChange={(e) => set({ productPrice: e.target.value })} />
              <input aria-label="Product photo link" className={`${inputCls(isLight)} sm:col-span-2`} placeholder="Product photo link (https://…)" value={maker.productImageUrl} onChange={(e) => set({ productImageUrl: e.target.value })} maxLength={2048} />
            </div>
          )}
          <input aria-label="What makes it worth buying" className={inputCls(isLight)} placeholder="One line on what makes it worth buying (optional)" value={maker.productBlurb} onChange={(e) => set({ productBlurb: e.target.value })} maxLength={600} />

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>2 · The style</p>
          <div className="flex flex-wrap gap-1.5" data-testid="world-ugc-styles">
            {UGC_STYLES.map((s) => (
              <button key={s.key} type="button" aria-pressed={maker.style === s.key} onClick={() => set({ style: s.key })} className={chipBtn(isLight, maker.style === s.key)}>
                {s.label}
              </button>
            ))}
          </div>

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>3 · The face</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={maker.faceMode === "persona"} onClick={() => set({ faceMode: "persona" })} className={chipBtn(isLight, maker.faceMode === "persona")}>Generated creator persona</button>
            <button type="button" aria-pressed={maker.faceMode === "photo"} onClick={() => set({ faceMode: "photo" })} className={chipBtn(isLight, maker.faceMode === "photo")}>My own photo</button>
            <button type="button" aria-pressed={maker.faceMode === "none"} onClick={() => set({ faceMode: "none" })} className={chipBtn(isLight, maker.faceMode === "none")}>No face — product only</button>
          </div>
          {maker.faceMode === "persona" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label="Describe the creator"
                  data-testid="world-ugc-persona-desc"
                  className={inputCls(isLight)}
                  style={{ flex: "1 1 220px", width: "auto" }}
                  placeholder="Describe the creator — e.g. “a 30-year-old barber in Chicago, locs, warm laugh”"
                  value={personaDescription}
                  onChange={(e) => { setPersonaDescription(e.target.value); personaKeyRef.current = ""; }}
                  maxLength={400}
                />
                <button type="button" data-testid="world-ugc-persona-make" onClick={() => void makePersona()} disabled={personaBusy} className={goldBtn}>
                  {personaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <User className="h-4 w-4" />}
                  {maker.personaUrl ? "Regenerate" : "Generate"} persona · {UGC_PERSONA_CREDIT_COST} VB
                </button>
              </div>
              {maker.personaUrl ? (
                <div className="flex items-center gap-3">
                  <img src={maker.personaUrl} alt="Your generated creator persona" className="h-20 w-14 rounded-lg object-cover" />
                  <p className={`text-xs ${muted}`}>This is the face your ad is filmed with. Businesses: this is your creator — no real person needed.</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {maker.faceMode === "photo" ? (
            <input aria-label="Your photo link" className={inputCls(isLight)} placeholder="Link to your photo or character image (https://…) — your vault photos work" value={maker.facePhotoUrl} onChange={(e) => set({ facePhotoUrl: e.target.value })} maxLength={2048} />
          ) : null}

          <p className={`text-[11px] font-bold uppercase tracking-[0.12em] ${muted}`}>4 · The script</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="world-ugc-script-turbo" onClick={() => void writeScript()} disabled={scriptBusy} className={goldBtn}>
              {scriptBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write it with Turbo
            </button>
            <span className={`text-[11px] ${muted}`}>Free — the script rides inside the ad. Or write your own below.</span>
          </div>
          <input aria-label="Hook" data-testid="world-ugc-hook" className={inputCls(isLight)} placeholder="Hook — the first line, made to stop the scroll" value={maker.hook} onChange={(e) => set({ hook: e.target.value })} maxLength={200} />
          <textarea aria-label="Spoken lines" className={inputCls(isLight)} rows={3} placeholder={"Spoken lines — one per line\nSay what a real creator would say…"} value={maker.scriptLines} onChange={(e) => set({ scriptLines: e.target.value })} maxLength={1400} />
          <input aria-label="Call to action" className={inputCls(isLight)} placeholder="Call to action — e.g. “Link's in my shop”" value={maker.cta} onChange={(e) => set({ cta: e.target.value })} maxLength={200} />

          {makerError ? <p className={noteCls} data-testid="world-ugc-error">{makerError}</p> : null}
          <button type="button" data-testid="world-ugc-generate" onClick={() => void generateAd()} disabled={generating} className={`${goldBtn} w-full justify-center`}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            {generating ? "Filming your ad — this takes a minute…" : `Generate my UGC ad · ${UGC_VIDEO_CREDIT_COST} Visual Bucs`}
          </button>
          <p className={`text-center text-[11px] ${muted}`}>
            Vertical 9:16 for TikTok, Reels, and Shorts. Captions from your script are burned in, and your branding kit is applied.
          </p>
          {latestAd?.status === "ready" && latestAd.videoUrl ? (
            <div className={`rounded-xl border p-3 ${isLight ? "border-emerald-700/40" : "border-emerald-400/30"}`} data-testid="world-ugc-latest">
              <p className={`flex items-center gap-2 text-sm font-bold ${isLight ? "text-emerald-800" : "text-emerald-300"}`}>
                <CheckCircle2 className="h-4 w-4" /> Your ad is ready — {latestAd.productName}
              </p>
              <video src={latestAd.videoUrl} controls playsInline className="mt-2 aspect-[9/16] max-h-72 w-full rounded-lg bg-black object-contain" />
              <p className={`mt-2 text-xs ${muted}`}>It's saved in your ads below and in your clip library.</p>
            </div>
          ) : null}
        </div>

        {/* ── My ads ── */}
        <div className="space-y-2" data-testid="world-ugc-my-ads">
          <p className={`text-sm font-black ${strong}`}>My UGC ads</p>
          {adsState === "loading" ? (
            <NativeLoadingState isLight={isLight} message="Loading your ads…" />
          ) : adsState === "failed" ? (
            <NativeErrorState isLight={isLight} message="Couldn't load your ads." onRetry={() => void loadAds()} />
          ) : ads.length === 0 ? (
            <NativeEmptyState isLight={isLight} message="No UGC ads yet — your first one is made above." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {ads.map((ad) => (
                <div key={ad.id} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-ugc-ad">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-bold ${strong}`}>{ad.productName}</p>
                      <p className={`text-[11px] ${muted}`}>
                        {UGC_STYLES.find((s) => s.key === ad.style)?.label ?? ad.style} · {new Date(ad.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${muted}`}>{ugcAdStatusLabel(ad.status)}</span>
                  </div>
                  {ad.status === "ready" && ad.videoUrl ? (
                    <video src={ad.videoUrl} controls playsInline className="mt-2 aspect-[9/16] max-h-64 w-full rounded-lg bg-black object-contain" />
                  ) : null}
                  {ad.status === "failed" && ad.lastError ? (
                    <p className={`mt-2 text-[11px] ${noteCls}`}>{ad.lastError} Your Visual Bucs were refunded.</p>
                  ) : null}
                  {ad.pinnedProductId ? (
                    <p className={`mt-2 flex items-center gap-1.5 text-[11px] font-bold ${strong}`}>
                      <Pin className="h-3.5 w-3.5 text-[#d4af37]" /> Pinned to {products.find((p) => p.id === ad.pinnedProductId)?.name ?? ad.productName} — buyers see this ad on the product.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ad.status === "draft" || ad.status === "failed" ? (
                      <button type="button" data-testid="world-ugc-ad-generate" onClick={() => void regenerate(ad)} disabled={busyAdId === ad.id} className={chipBtn(isLight, true)}>
                        {busyAdId === ad.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clapperboard className="h-3.5 w-3.5" />} Generate · {UGC_VIDEO_CREDIT_COST} VB
                      </button>
                    ) : null}
                    {ad.status === "ready" && ad.videoUrl ? (
                      <button type="button" data-testid="world-ugc-ad-share" onClick={() => void shareAd(ad)} className={chipBtn(isLight, false)}>
                        <Share2 className="h-3.5 w-3.5" /> Share
                      </button>
                    ) : null}
                    {pinActionFor(ad) === "pin" ? (
                      <button type="button" data-testid="world-ugc-ad-pin" onClick={() => void togglePin(ad)} disabled={busyAdId === ad.id} className={chipBtn(isLight, false)}>
                        <Pin className="h-3.5 w-3.5" /> Pin to product
                      </button>
                    ) : null}
                    {pinActionFor(ad) === "unpin" ? (
                      <button type="button" data-testid="world-ugc-ad-unpin" onClick={() => void togglePin(ad)} disabled={busyAdId === ad.id} className={chipBtn(isLight, false)}>
                        <PinOff className="h-3.5 w-3.5" /> Unpin
                      </button>
                    ) : null}
                    {confirmDeleteId === ad.id ? (
                      <>
                        <button type="button" data-testid="world-ugc-ad-delete-confirm" onClick={() => void removeAd(ad)} className={chipBtn(isLight, false)}>
                          <Trash2 className="h-3.5 w-3.5" /> Confirm delete
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)} className={chipBtn(isLight, false)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" data-testid="world-ugc-ad-delete" onClick={() => setConfirmDeleteId(ad.id)} className={chipBtn(isLight, false)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
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
            <ClipboardList className="h-4 w-4 text-[#d4af37]" /> Briefs board — brands &amp; creators
          </p>
          <p className={`rounded-xl border px-3 py-2 text-xs ${isLight ? "border-[#C9A84C]/50 text-[#6B5B36]" : "border-[#d4af37]/30 text-white/70"}`} data-testid="world-ugc-payment-note">
            {UGC_PAYMENT_NOTE} The board handles the work — the brief, the claim, the delivery, the approval — never the money.
          </p>

          <div className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`} data-testid="world-ugc-brief-form">
            <p className={`text-xs font-bold ${strong}`}>Post a brief (for brands &amp; businesses)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input aria-label="Brief product name" data-testid="world-ugc-brief-name" className={inputCls(isLight)} placeholder="Product name *" value={briefForm.productName} onChange={(e) => setBriefForm({ ...briefForm, productName: e.target.value })} maxLength={120} />
              <select aria-label="Brief style" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={briefForm.style} onChange={(e) => setBriefForm({ ...briefForm, style: e.target.value as UgcStyleKey })}>
                {UGC_STYLES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <input aria-label="Brief product page link" className={inputCls(isLight)} placeholder="Product page link (optional)" value={briefForm.productUrl} onChange={(e) => setBriefForm({ ...briefForm, productUrl: e.target.value })} maxLength={2048} />
              <input aria-label="Brief deadline" type="date" className={inputCls(isLight)} style={{ colorScheme: isLight ? "light" : "dark" }} value={briefForm.deadline} onChange={(e) => setBriefForm({ ...briefForm, deadline: e.target.value })} />
              <input aria-label="Brief product photo link" className={`${inputCls(isLight)} sm:col-span-2`} placeholder="Product photo link (optional)" value={briefForm.productImageUrl} onChange={(e) => setBriefForm({ ...briefForm, productImageUrl: e.target.value })} maxLength={2048} />
            </div>
            <textarea aria-label="Brief details" className={`${inputCls(isLight)} mt-2`} rows={3} placeholder="What do you want in the ad? The moments it has to hit, what to say, what to never say…" value={briefForm.details} onChange={(e) => setBriefForm({ ...briefForm, details: e.target.value })} maxLength={2000} />
            <button type="button" data-testid="world-ugc-brief-post" onClick={() => void submitBrief()} disabled={postingBrief} className={`${goldBtn} mt-2`}>
              {postingBrief ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Post the brief
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { key: "open", label: "Open briefs" },
                { key: "posted", label: "Briefs I posted" },
                { key: "claimed", label: "Briefs I claimed" },
              ] as const
            ).map((s) => (
              <button key={s.key} type="button" data-testid={`world-ugc-scope-${s.key}`} aria-pressed={boardScope === s.key} onClick={() => setBoardScope(s.key)} className={chipBtn(isLight, boardScope === s.key)}>
                {s.label}
              </button>
            ))}
          </div>
          {boardNote ? <p className={noteCls}>{boardNote}</p> : null}

          {briefsState === "loading" ? (
            <NativeLoadingState isLight={isLight} message="Loading the board…" />
          ) : briefsState === "failed" ? (
            <NativeErrorState isLight={isLight} message="Couldn't load the board." onRetry={() => void loadBriefs()} />
          ) : briefs.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={
                boardScope === "open"
                  ? "No open briefs right now — post one above, or check back soon."
                  : boardScope === "posted"
                    ? "You haven't posted a brief yet — the form above is yours."
                    : "You haven't claimed a brief yet — the open board is waiting."
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
                            {brief.deadline ? ` · needed by ${new Date(brief.deadline).toLocaleDateString()}` : ""}
                          </p>
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${muted}`}>{briefStatusLabel(brief.status)}</span>
                    </div>

                    {brief.status === "delivered" && brief.brandUserId === user?.id ? (
                      <button type="button" data-testid="world-ugc-brief-review" onClick={() => void reviewDeliveredAd(brief)} disabled={busy} className={`${chipBtn(isLight, false)} mt-2`}>
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Review the delivered ad
                      </button>
                    ) : null}
                    {reviewAd && brief.deliveredAdId === reviewAd.id ? (
                      <div className="mt-2">
                        <video src={reviewAd.videoUrl ?? undefined} controls playsInline className="aspect-[9/16] max-h-72 w-full rounded-lg bg-black object-contain" />
                        {reviewAd.captions.length > 0 ? <p className={`mt-1 text-[11px] ${muted}`}>Captions: {reviewAd.captions.join(" · ")}</p> : null}
                      </div>
                    ) : null}

                    {actions.includes("deliver") ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <select
                          aria-label="Pick a finished ad to deliver"
                          data-testid="world-ugc-deliver-pick"
                          className={inputCls(isLight)}
                          style={{ colorScheme: isLight ? "light" : "dark", flex: "1 1 180px", width: "auto" }}
                          value={deliverPick[brief.id] ?? ""}
                          onChange={(e) => setDeliverPick({ ...deliverPick, [brief.id]: e.target.value })}
                        >
                          <option value="">Pick one of your finished ads…</option>
                          {myReadyAds.map((a) => (
                            <option key={a.id} value={a.id}>{a.productName} — {new Date(a.createdAt).toLocaleDateString()}</option>
                          ))}
                        </select>
                        <button type="button" data-testid="world-ugc-brief-make" onClick={() => startAdForBrief(brief)} className={chipBtn(isLight, false)}>
                          Make the ad for this brief
                        </button>
                      </div>
                    ) : null}

                    {actions.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {actions.includes("claim") ? (
                          <button type="button" data-testid="world-ugc-brief-claim" onClick={() => void runBriefAction(brief, "claim")} disabled={busy} className={chipBtn(isLight, true)}>
                            <Handshake className="h-3.5 w-3.5" /> Claim this brief
                          </button>
                        ) : null}
                        {actions.includes("deliver") ? (
                          <button type="button" data-testid="world-ugc-brief-deliver" onClick={() => void runBriefAction(brief, "deliver")} disabled={busy} className={chipBtn(isLight, true)}>
                            <Send className="h-3.5 w-3.5" /> Deliver the ad
                          </button>
                        ) : null}
                        {actions.includes("approve") ? (
                          <button type="button" data-testid="world-ugc-brief-approve" onClick={() => void runBriefAction(brief, "approve")} disabled={busy} className={chipBtn(isLight, true)}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> Approve delivery
                          </button>
                        ) : null}
                        {actions.includes("release") ? (
                          <button type="button" data-testid="world-ugc-brief-release" onClick={() => void runBriefAction(brief, "release")} disabled={busy} className={chipBtn(isLight, false)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Release
                          </button>
                        ) : null}
                        {actions.includes("close") ? (
                          <button type="button" data-testid="world-ugc-brief-close" onClick={() => void runBriefAction(brief, "close")} disabled={busy} className={chipBtn(isLight, false)}>
                            <XCircle className="h-3.5 w-3.5" /> Close brief
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
          {scriptFromMaker(maker) ? "Script's ready — hook, lines and call to action all set." : "Tip: Turbo writes the script free — the 400 Visual Bucs are only for filming the ad."}
        </p>
      </div>
    </NativeCard>
  );
}
