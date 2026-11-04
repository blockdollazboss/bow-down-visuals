import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  CalendarPlus, CheckCircle2, Loader2, Rocket, Save, Shirt, ShoppingBag, Sparkles, Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeLoadingState, NativeErrorState } from "./NativeStates";
import { formatMoney } from "@/lib/branding-shop";
import {
  MERCH_DESIGN_COST_VISUAL_BUCS,
  MERCH_DROP_PLAN_COST_VISUAL_BUCS,
  MERCH_DROP_PRICE_BANDS,
  MERCH_PRODUCTS,
  MERCH_STYLES,
  buildMerchDesignPayload,
  buildMerchDropPlanPayload,
  buildMerchDropSavePayload,
  buildMerchPatchPayload,
  buildMerchSavePayload,
  merchProductLabel,
  merchStyleLabel,
  nextMerchDropMondayISO,
  parseMerchDesignBatch,
  parseMerchDropPlan,
  parseMerchDropPlans,
  parseMerchOrderIntent,
  parseMerchStore,
  type MerchDesignBatch,
  type MerchDropPlan,
  type MerchSavedPlan,
  type MerchStoreDesign,
} from "@/lib/world/merch-studio";

/* ─── The Merch Bench (World parity P3-C) ───────────────────────────
   The Branding Atelier's missing workbench: the three merch
   benches the website keeps in the Branding Shop's Merch tab and
   the Wave 8 planner, complete in-world on the same rails —
   Product Photo Studio (design a batch, get the product photos),
   the Merch Drop Planner (a priced drop plan + its launch week),
   and the Merch store (your saved designs, prices, the rail's own
   margins, order intents). Spends ride the spend-confirmation law
   (300 VB a batch, 100 VB a plan — the registry's figures); a
   failed batch or plan is auto-refunded by its rail. Merch
   checkout is honestly not open yet: ordering records interest
   and never charges, and the bench says so. */

type BenchTab = "photo" | "planner" | "merch";

export function MerchBench({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();
  const [tab, setTab] = useState<BenchTab>("photo");

  /* photo studio */
  const [product, setProduct] = useState(MERCH_PRODUCTS[0]!.key);
  const [style, setStyle] = useState(MERCH_STYLES[0]!.key);
  const [designTitle, setDesignTitle] = useState("");
  const [description, setDescription] = useState("");
  const [designing, setDesigning] = useState(false);
  const [batch, setBatch] = useState<MerchDesignBatch | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [savePrices, setSavePrices] = useState<Record<number, string>>({});
  const [savedIdx, setSavedIdx] = useState<ReadonlySet<number>>(new Set());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  /* drop planner */
  const [niche, setNiche] = useState("");
  const [audience, setAudience] = useState("");
  const [priceBand, setPriceBand] = useState<string>("mid");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<MerchDropPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planName, setPlanName] = useState("");
  const [weekStart, setWeekStart] = useState<string>(() => nextMerchDropMondayISO());
  const [savingPlan, setSavingPlan] = useState(false);
  const [planSavedMsg, setPlanSavedMsg] = useState<string | null>(null);
  const [savedPlans, setSavedPlans] = useState<MerchSavedPlan[]>([]);
  const [plansState, setPlansState] = useState<"loading" | "failed" | "ready">("loading");

  /* the merch store */
  const [designs, setDesigns] = useState<MerchStoreDesign[]>([]);
  const [commissionPct, setCommissionPct] = useState<number | null>(null);
  const [paymentsLive, setPaymentsLive] = useState(false);
  const [storeState, setStoreState] = useState<"loading" | "failed" | "ready">("loading");
  const [storeTick, setStoreTick] = useState(0);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orderMsgs, setOrderMsgs] = useState<Record<string, string>>({});
  const [storeError, setStoreError] = useState<string | null>(null);

  const loadStore = async (): Promise<boolean> => {
    try {
      const res = await confirmedFetch("/api/merch/designs", { skipConfirm: true });
      if (!res) throw new Error("load");
      const store = parseMerchStore((await res.json().catch(() => null)) as unknown);
      if (!res.ok || !store) throw new Error("load");
      setDesigns(store.designs);
      setCommissionPct(store.commissionPct);
      setPaymentsLive(store.paymentsLive);
      return true;
    } catch {
      return false;
    }
  };

  const loadPlans = async (): Promise<boolean> => {
    try {
      const res = await confirmedFetch("/api/wave8/merch-drop/plans", { skipConfirm: true });
      if (!res) throw new Error("load");
      const plans = parseMerchDropPlans((await res.json().catch(() => null)) as unknown);
      if (!res.ok || !plans) throw new Error("load");
      setSavedPlans(plans);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      setStoreState("loading");
      const ok = await loadStore();
      if (!cancelled) setStoreState(ok ? "ready" : "failed");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeTick, isGuest]);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      setPlansState("loading");
      const ok = await loadPlans();
      if (!cancelled) setPlansState(ok ? "ready" : "failed");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  if (isGuest) {
    return (
      <NativeCard isLight={isLight}>
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {t("worldCommerceStands.merchGuestBefore")}{" "}
          <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
            {t("worldCommerceStands.merchSignIn")}
          </Link>{" "}
          {t("worldCommerceStands.merchGuestAfter")}
        </p>
      </NativeCard>
    );
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const goldBtn =
    "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target disabled:hover:scale-100";
  const ghostBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    isLight ? "border-[#C9A84C]/40 text-[#6B5B36]" : "border-white/15 text-white/70"
  }`;
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
  const optBtn = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-sm font-semibold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37]/15 " + strong
        : isLight
          ? "border-[#C9A84C]/30 bg-white/50 text-[#6B5B36] hover:border-[#d4af37]"
          : "border-white/10 bg-white/5 text-white/60 hover:border-[#d4af37]/50"
    }`;
  const tabBtn = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#C9A84C]/40 text-[#6B5B36]"
          : "border-white/15 text-white/60"
    }`;

  /* Seam catalog labels/blurbs resolve through the catalog by key; the
     seam's EN label is the defaultValue so English renders byte-identical. */
  const PRODUCT_LABEL_KEYS: Record<string, string> = {
    "t-shirt": "worldCommerceStands.merchProductTShirt",
    hoodie: "worldCommerceStands.merchProductHoodie",
    cap: "worldCommerceStands.merchProductCap",
    poster: "worldCommerceStands.merchProductPoster",
  };
  const PRODUCT_BLURB_KEYS: Record<string, string> = {
    "t-shirt": "worldCommerceStands.merchProductTShirtBlurb",
    hoodie: "worldCommerceStands.merchProductHoodieBlurb",
    cap: "worldCommerceStands.merchProductCapBlurb",
    poster: "worldCommerceStands.merchProductPosterBlurb",
  };
  const STYLE_LABEL_KEYS: Record<string, string> = {
    streetwear: "worldCommerceStands.merchStyleStreetwear",
    minimal: "worldCommerceStands.merchStyleMinimal",
    vintage: "worldCommerceStands.merchStyleVintage",
    "luxury-gold": "worldCommerceStands.merchStyleLuxuryGold",
  };
  const STYLE_BLURB_KEYS: Record<string, string> = {
    streetwear: "worldCommerceStands.merchStyleStreetwearBlurb",
    minimal: "worldCommerceStands.merchStyleMinimalBlurb",
    vintage: "worldCommerceStands.merchStyleVintageBlurb",
    "luxury-gold": "worldCommerceStands.merchStyleLuxuryGoldBlurb",
  };
  const BAND_LABEL_KEYS: Record<string, string> = {
    budget: "worldCommerceStands.merchBandBudget",
    mid: "worldCommerceStands.merchBandMid",
    premium: "worldCommerceStands.merchBandPremium",
  };
  const productLabel = (key: string) => t(PRODUCT_LABEL_KEYS[key] ?? key, { defaultValue: merchProductLabel(key) });
  const productBlurb = (key: string, fallback: string) => t(PRODUCT_BLURB_KEYS[key] ?? key, { defaultValue: fallback });
  const styleLabel = (key: string) => t(STYLE_LABEL_KEYS[key] ?? key, { defaultValue: merchStyleLabel(key) });
  const styleBlurb = (key: string, fallback: string) => t(STYLE_BLURB_KEYS[key] ?? key, { defaultValue: fallback });
  const bandLabel = (key: string, fallback: string) => t(BAND_LABEL_KEYS[key] ?? key, { defaultValue: fallback });

  /* ── photo studio actions ── */
  const generateBatch = async () => {
    if (designing || description.trim().length === 0) return;
    setDesigning(true);
    setBatchError(null);
    try {
      const res = await confirmedFetch("/api/merch/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMerchDesignPayload({ product, style, description, title: designTitle })),
      });
      if (!res) return; // the member declined the spend — nothing charged
      if (res.status === 402) {
        setBatchError(t("worldCommerceStands.merchBatchOutOfBucs"));
        return;
      }
      const parsed = parseMerchDesignBatch((await res.json().catch(() => null)) as unknown);
      if (!res.ok || !parsed) {
        setBatchError(t("worldCommerceStands.merchBatchFailed"));
        return;
      }
      setBatch(parsed);
      setSavedIdx(new Set());
      setSavePrices(
        Object.fromEntries(
          parsed.mockups.map((_, i) => [i, parsed.suggestedPriceCents != null ? (parsed.suggestedPriceCents / 100).toFixed(2) : ""]),
        ),
      );
      void refreshProfile().catch(() => {});
    } catch {
      setBatchError(t("worldCommerceStands.merchBatchNoAnswer"));
    } finally {
      setDesigning(false);
    }
  };

  const saveMockup = async (idx: number) => {
    if (!batch || savingIdx !== null) return;
    const mockup = batch.mockups[idx]!;
    const dollars = parseFloat(savePrices[idx] ?? "");
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setBatchError(t("worldCommerceStands.merchPriceAboveZero"));
      return;
    }
    setSavingIdx(idx);
    setBatchError(null);
    try {
      const res = await confirmedFetch("/api/merch/designs", {
        method: "POST",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildMerchSavePayload({
            title: batch.title || t("worldCommerceStands.merchUntitled"),
            product: batch.product,
            style: batch.style,
            prompt: description,
            mockup,
            priceCents: Math.round(dollars * 100),
          }),
        ),
      });
      if (!res || !res.ok) throw new Error("save");
      setSavedIdx((prev) => new Set(prev).add(idx));
      void loadStore().then((ok) => { if (ok) setStoreState("ready"); });
    } catch {
      setBatchError(t("worldCommerceStands.merchPhotoSaveFailed"));
    } finally {
      setSavingIdx(null);
    }
  };

  /* ── drop planner actions ── */
  const makePlan = async () => {
    if (planning || niche.trim().length === 0) return;
    setPlanning(true);
    setPlanError(null);
    setPlanSavedMsg(null);
    try {
      const res = await confirmedFetch("/api/wave8/merch-drop/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMerchDropPlanPayload({ niche, audience, priceBand })),
      });
      if (!res) return; // declined — nothing charged
      if (res.status === 402) {
        setPlanError(t("worldCommerceStands.merchPlanOutOfBucs"));
        return;
      }
      const parsed = parseMerchDropPlan((await res.json().catch(() => null)) as unknown);
      if (!res.ok || !parsed) {
        setPlanError(t("worldCommerceStands.merchPlanFailed"));
        return;
      }
      setPlan(parsed);
      setPlanName(`${niche.slice(0, 40)} Drop`);
      void refreshProfile().catch(() => {});
    } catch {
      setPlanError(t("worldCommerceStands.merchPlanNoAnswer"));
    } finally {
      setPlanning(false);
    }
  };

  const savePlan = async () => {
    if (!plan || savingPlan || planName.trim().length === 0) return;
    setSavingPlan(true);
    setPlanError(null);
    try {
      const res = await confirmedFetch("/api/wave8/merch-drop/save", {
        method: "POST",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMerchDropSavePayload({ planName: planName.trim(), plan, weekStart })),
      });
      if (!res) throw new Error("save");
      const json = (await res.json().catch(() => null)) as { queuedPosts?: number } | null;
      if (!res.ok) throw new Error("save");
      setPlanSavedMsg(
        t("worldCommerceStands.merchPlanSaved", { count: json?.queuedPosts ?? plan.launchPosts.length }),
      );
      void loadPlans().then((ok) => { if (ok) setPlansState("ready"); });
    } catch {
      setPlanError(t("worldCommerceStands.merchPlanSaveFailed"));
    } finally {
      setSavingPlan(false);
    }
  };

  /* ── store actions ── */
  const patchDesign = async (d: MerchStoreDesign, patch: { priceCents?: number; status?: string }) => {
    setBusyId(d.id);
    setStoreError(null);
    try {
      const res = await confirmedFetch(`/api/merch/designs/${d.id}`, {
        method: "PATCH",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildMerchPatchPayload(patch)),
      });
      if (!res || !res.ok) throw new Error("patch");
      setDesigns((ds) =>
        ds.map((x) =>
          x.id === d.id
            ? {
                ...x,
                priceCents: patch.priceCents ?? x.priceCents,
                status: patch.status ?? x.status,
                /* the margin is the rail's math — a price change
                   re-reads it rather than guessing a new one */
                margin: patch.priceCents !== undefined ? null : x.margin,
              }
            : x,
        ),
      );
      if (patch.priceCents !== undefined) void loadStore();
    } catch {
      setStoreError(t("worldCommerceStands.merchChangeFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const deleteDesign = async (d: MerchStoreDesign) => {
    if (!window.confirm(t("worldCommerceStands.merchRemoveConfirm", { title: d.title || t("worldCommerceStands.merchThisDesign") }))) return;
    setBusyId(d.id);
    setStoreError(null);
    try {
      const res = await confirmedFetch(`/api/merch/designs/${d.id}`, { method: "DELETE", skipConfirm: true });
      if (!res || !res.ok) throw new Error("delete");
      setDesigns((ds) => ds.filter((x) => x.id !== d.id));
    } catch {
      setStoreError(t("worldCommerceStands.merchRemoveFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const orderDesign = async (d: MerchStoreDesign) => {
    setBusyId(d.id);
    setStoreError(null);
    try {
      const res = await confirmedFetch(`/api/merch/designs/${d.id}/order`, { method: "POST", skipConfirm: true });
      if (!res) throw new Error("order");
      const intent = parseMerchOrderIntent((await res.json().catch(() => null)) as unknown);
      if (!res.ok || !intent) throw new Error("order");
      setOrderMsgs((m) => ({ ...m, [d.id]: intent.message }));
    } catch {
      setStoreError(t("worldCommerceStands.merchOrderFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3" data-testid="world-merch-bench">
      <div className="flex flex-wrap gap-2 px-1" role="tablist" aria-label={t("worldCommerceStands.merchTabsAria")}>
        <button type="button" role="tab" aria-selected={tab === "photo"} data-testid="world-merch-tab-photo" onClick={() => setTab("photo")} className={tabBtn(tab === "photo")}>
          {t("worldCommerceStands.merchTabPhoto")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "planner"} data-testid="world-merch-tab-planner" onClick={() => setTab("planner")} className={tabBtn(tab === "planner")}>
          {t("worldCommerceStands.merchTabPlanner")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "merch"} data-testid="world-merch-tab-merch" onClick={() => setTab("merch")} className={tabBtn(tab === "merch")}>
          {t("worldCommerceStands.merchTabMerch")}
        </button>
      </div>

      {tab === "photo" ? (
        <div className="space-y-3" data-testid="world-merch-photo-studio">
          <NativeCard isLight={isLight} title={t("worldCommerceStands.merchDesignTitle")}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {MERCH_PRODUCTS.map((p) => (
                  <button key={p.key} type="button" onClick={() => setProduct(p.key)} className={optBtn(product === p.key)} data-testid={`world-merch-product-${p.key}`}>
                    <span className="block">{productLabel(p.key)}</span>
                    <span className={`mt-0.5 block text-xs font-normal ${muted}`}>{productBlurb(p.key, p.blurb)}</span>
                    <span className={`mt-0.5 block text-xs ${muted}`}>{t("worldCommerceStands.merchCostsToMake", { cost: formatMoney(p.baseCostCents) })}</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {MERCH_STYLES.map((s) => (
                  <button key={s.key} type="button" onClick={() => setStyle(s.key)} className={optBtn(style === s.key)} data-testid={`world-merch-style-${s.key}`}>
                    <span className="block">{styleLabel(s.key)}</span>
                    <span className={`mt-0.5 block text-xs font-normal ${muted}`}>{styleBlurb(s.key, s.blurb)}</span>
                  </button>
                ))}
              </div>
              <input aria-label={t("worldCommerceStands.merchTitleAria")} className={inputCls} value={designTitle} onChange={(e) => setDesignTitle(e.target.value)} placeholder={t("worldCommerceStands.merchTitlePlaceholder")} />
              <textarea aria-label={t("worldCommerceStands.merchDescAria")} className={inputCls} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("worldCommerceStands.merchDescPlaceholder")} />
              <button type="button" data-testid="world-merch-generate" onClick={() => void generateBatch()} disabled={designing || description.trim().length === 0} className={goldBtn}>
                {designing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {designing ? t("worldCommerceStands.merchDesigning") : t("worldCommerceStands.merchDesignCost", { cost: MERCH_DESIGN_COST_VISUAL_BUCS })}
              </button>
              {batchError ? <p className="text-xs font-semibold text-red-400" data-testid="world-merch-batch-error">{batchError}</p> : null}
            </div>
          </NativeCard>

          {batch ? (
            <NativeCard isLight={isLight} title={t("worldCommerceStands.merchPhotosTitle")}>
              <div className="space-y-3" data-testid="world-merch-batch">
                <div className="grid gap-3 sm:grid-cols-2">
                  {batch.mockups.map((m, i) => (
                    <div key={i} className={`overflow-hidden rounded-xl border ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                      <img src={m.url} alt={t("worldCommerceStands.merchMockupAlt", { product: productLabel(batch.product), n: i + 1 })} className="aspect-square w-full object-cover" />
                      <div className="space-y-2 p-3">
                        <p className={`text-xs ${muted}`}>
                          {productLabel(batch.product)} · {styleLabel(batch.style)}
                          {batch.baseCostCents != null ? <>{t("worldCommerceStands.merchMetaCosts", { cost: formatMoney(batch.baseCostCents) })}</> : null}
                          {batch.suggestedPriceCents != null ? <>{t("worldCommerceStands.merchMetaSuggested", { price: formatMoney(batch.suggestedPriceCents) })}</> : null}
                        </p>
                        {savedIdx.has(i) ? (
                          <p className={`inline-flex items-center gap-1.5 text-xs font-bold ${strong}`} data-testid="world-merch-saved">
                            <CheckCircle2 className="h-4 w-4 text-emerald-400" /> {t("worldCommerceStands.merchInStoreDraft")}
                          </p>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className={`text-sm ${muted}`}>$</span>
                            <input
                              aria-label={t("worldCommerceStands.merchPhotoPriceAria", { n: i + 1 })}
                              className={inputCls}
                              inputMode="decimal"
                              value={savePrices[i] ?? ""}
                              onChange={(e) => setSavePrices((p) => ({ ...p, [i]: e.target.value }))}
                            />
                            <button type="button" data-testid="world-merch-save-mockup" onClick={() => void saveMockup(i)} disabled={savingIdx !== null} className={goldBtn}>
                              {savingIdx === i ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("worldCommerceStands.merchSave")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <p className={`text-xs ${muted}`}>
                  {t("worldCommerceStands.merchCommissionNote", { pct: batch.commissionPct ?? commissionPct ?? 15 })}
                </p>
              </div>
            </NativeCard>
          ) : null}
        </div>
      ) : null}

      {tab === "planner" ? (
        <div className="space-y-3" data-testid="world-merch-drop-planner">
          <NativeCard isLight={isLight} title={t("worldCommerceStands.merchPlanTitle")}>
            <div className="space-y-3">
              <input aria-label={t("worldCommerceStands.merchNicheAria")} className={inputCls} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("worldCommerceStands.merchNichePlaceholder")} />
              <input aria-label={t("worldCommerceStands.merchAudienceAria")} className={inputCls} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={t("worldCommerceStands.merchAudiencePlaceholder")} />
              <div className="flex flex-wrap gap-2">
                {MERCH_DROP_PRICE_BANDS.map((b) => (
                  <button key={b.key} type="button" onClick={() => setPriceBand(b.key)} className={optBtn(priceBand === b.key)} data-testid={`world-merch-band-${b.key}`}>
                    {bandLabel(b.key, b.label)}
                  </button>
                ))}
              </div>
              <button type="button" data-testid="world-merch-plan" onClick={() => void makePlan()} disabled={planning || niche.trim().length === 0} className={goldBtn}>
                {planning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {planning ? t("worldCommerceStands.merchPlanning") : t("worldCommerceStands.merchPlanCost", { cost: MERCH_DROP_PLAN_COST_VISUAL_BUCS })}
              </button>
              {planError ? <p className="text-xs font-semibold text-red-400" data-testid="world-merch-plan-error">{planError}</p> : null}
            </div>
          </NativeCard>

          {plan ? (
            <NativeCard isLight={isLight} title={t("worldCommerceStands.merchPlanResultTitle")}>
              <div className="space-y-3" data-testid="world-merch-plan-result">
                <div className="space-y-2">
                  {plan.concepts.map((c, i) => (
                    <div key={i} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                      <p className={`text-sm font-bold ${strong}`}>{c.name} <span className={`font-normal ${muted}`}>· {c.product} · {c.pricePoint}</span></p>
                      <p className={`mt-0.5 text-xs ${muted}`}>{c.description}</p>
                      <p className={`mt-0.5 text-xs ${muted}`}>{t("worldCommerceStands.merchWhyItWorks", { why: c.why })}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${muted}`}>{t("worldCommerceStands.merchLaunchWeek")}</p>
                  <div className="space-y-1.5">
                    {plan.launchPosts.map((p, i) => (
                      <p key={i} className={`text-xs ${muted}`}>
                        <span className={`font-bold ${strong}`}>{t("worldCommerceStands.merchDayLine", { day: p.dayOffset + 1, title: p.title })}</span> {p.caption} <span className="font-semibold">{p.cta}</span>
                      </p>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-44 flex-1">
                    <span className={`mb-1 block text-xs font-semibold ${muted}`}>{t("worldCommerceStands.merchPlanName")}</span>
                    <input aria-label={t("worldCommerceStands.merchPlanName")} className={inputCls} value={planName} onChange={(e) => setPlanName(e.target.value)} />
                  </label>
                  <label>
                    <span className={`mb-1 block text-xs font-semibold ${muted}`}>{t("worldCommerceStands.merchWeekStarts")}</span>
                    <input aria-label={t("worldCommerceStands.merchWeekStarts")} type="date" className={inputCls} value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
                  </label>
                  <button type="button" data-testid="world-merch-plan-save" onClick={() => void savePlan()} disabled={savingPlan || planName.trim().length === 0} className={goldBtn}>
                    {savingPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />} {t("worldCommerceStands.merchSaveQueue")}
                  </button>
                </div>
                {planSavedMsg ? (
                  <p className={`inline-flex items-center gap-1.5 text-xs font-bold ${strong}`} data-testid="world-merch-plan-saved">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" /> {planSavedMsg}
                  </p>
                ) : null}
              </div>
            </NativeCard>
          ) : null}

          <NativeCard isLight={isLight} title={t("worldCommerceStands.merchSavedPlansTitle")}>
            {plansState === "loading" ? (
              <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.merchPlansLoading")} />
            ) : plansState === "failed" ? (
              <NativeErrorState isLight={isLight} message={t("worldCommerceStands.merchPlansFailed")} onRetry={() => void loadPlans().then((ok) => setPlansState(ok ? "ready" : "failed"))} />
            ) : savedPlans.length === 0 ? (
              <p className={`text-sm ${muted}`}>{t("worldCommerceStands.merchPlansEmpty")}</p>
            ) : (
              <div className="space-y-1.5">
                {savedPlans.map((p) => (
                  <div key={p.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`} data-testid="world-merch-saved-plan">
                    <span className={`text-sm font-semibold ${strong}`}>{p.planName}</span>
                    <span className={`text-xs ${muted}`}>{t("worldCommerceStands.merchSavedPlanLine", { concepts: p.concepts.length, posts: p.launchPosts.length })}</span>
                  </div>
                ))}
              </div>
            )}
          </NativeCard>
        </div>
      ) : null}

      {tab === "merch" ? (
        <div className="space-y-3" data-testid="world-merch-store">
          <NativeCard isLight={isLight} title={t("worldCommerceStands.merchStoreTitle")}>
            {storeState === "loading" ? (
              <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.merchDesignsLoading")} />
            ) : storeState === "failed" ? (
              <NativeErrorState isLight={isLight} message={t("worldCommerceStands.merchDesignsFailed")} onRetry={() => setStoreTick((n) => n + 1)} />
            ) : (
              <div className="space-y-3">
                {!paymentsLive ? (
                  <p className={`text-xs ${muted}`} data-testid="world-merch-coming-soon">
                    {t("worldCommerceStands.merchComingSoon", { pct: commissionPct ?? 15 })}
                  </p>
                ) : null}
                {storeError ? <p className="text-xs font-semibold text-red-400">{storeError}</p> : null}
                {designs.length === 0 ? (
                  <p className={`text-sm ${muted}`}>{t("worldCommerceStands.merchStoreEmpty")}</p>
                ) : (
                  designs.map((d) => {
                    const priceInput = priceEdits[d.id] ?? (d.priceCents / 100).toFixed(2);
                    const parsedPrice = parseFloat(priceInput);
                    const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0;
                    return (
                      <div key={d.id} className={`flex gap-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`} data-testid="world-merch-design">
                        {d.imageUrl ? (
                          <img src={d.imageUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-lg ${isLight ? "bg-[#C9A84C]/10" : "bg-white/5"}`}>
                            <Shirt className="h-6 w-6 text-[#d4af37]" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className={`truncate text-sm font-bold ${strong}`}>
                            {d.title || t("worldCommerceStands.merchUntitled")}{" "}
                            <span className={`text-xs font-normal ${muted}`}>
                              {productLabel(d.product)} · {styleLabel(d.style)} · {d.status === "listed" ? t("worldCommerceStands.merchStatusListed") : t("worldCommerceStands.merchStatusDraft")}
                            </span>
                          </p>
                          {d.margin ? (
                            <p className={`text-xs ${muted}`}>
                              {t("worldCommerceStands.merchMarginBefore")}<span className={`font-bold ${strong}`}>{formatMoney(d.margin.profitCents)}</span>{t("worldCommerceStands.merchMarginAfter", { pct: d.margin.marginPct, cost: formatMoney(d.baseCostCents) })}
                            </p>
                          ) : (
                            <p className={`text-xs ${muted}`}>{t("worldCommerceStands.merchMarginNone", { cost: formatMoney(d.baseCostCents) })}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-sm ${muted}`}>$</span>
                            <input
                              aria-label={t("worldCommerceStands.merchPriceForAria", { title: d.title || t("worldCommerceStands.merchDesignWord") })}
                              className={`${inputCls} w-24`}
                              inputMode="decimal"
                              value={priceInput}
                              onChange={(e) => setPriceEdits((p) => ({ ...p, [d.id]: e.target.value }))}
                            />
                            <button
                              type="button"
                              data-testid="world-merch-price-save"
                              disabled={busyId === d.id || !priceValid || Math.round(parsedPrice * 100) === d.priceCents}
                              onClick={() => void patchDesign(d, { priceCents: Math.round(parsedPrice * 100) })}
                              className={ghostBtn}
                            >
                              <Save className="h-3.5 w-3.5" /> {t("worldCommerceStands.merchPriceButton")}
                            </button>
                            <button
                              type="button"
                              data-testid="world-merch-list-toggle"
                              disabled={busyId === d.id}
                              onClick={() => void patchDesign(d, { status: d.status === "listed" ? "draft" : "listed" })}
                              className={ghostBtn}
                            >
                              <ShoppingBag className="h-3.5 w-3.5" /> {d.status === "listed" ? t("worldCommerceStands.merchUnlist") : t("worldCommerceStands.merchListIt")}
                            </button>
                            <button
                              type="button"
                              data-testid="world-merch-order"
                              disabled={busyId === d.id}
                              onClick={() => void orderDesign(d)}
                              className={ghostBtn}
                            >
                              {busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingBag className="h-3.5 w-3.5" />} {t("worldCommerceStands.merchOrder")}
                            </button>
                            <button
                              type="button"
                              data-testid="world-merch-delete"
                              disabled={busyId === d.id}
                              onClick={() => void deleteDesign(d)}
                              className={ghostBtn}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> {t("worldCommerceStands.merchRemove")}
                            </button>
                          </div>
                          {orderMsgs[d.id] ? (
                            <p className={`text-xs font-semibold ${strong}`} data-testid="world-merch-order-msg">{orderMsgs[d.id]}</p>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </NativeCard>
        </div>
      ) : null}
    </div>
  );
}
