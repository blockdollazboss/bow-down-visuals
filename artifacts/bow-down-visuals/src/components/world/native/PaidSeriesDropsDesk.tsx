import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BadgeCheck, CalendarClock, Check, Loader2, Lock, Pencil, Plus, RefreshCw, Sparkles, Trash2, Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout";
import { centsToDisplay } from "@/lib/shops";
import { formatDropLocal } from "@/lib/product-drop";
import { checkoutTransferLabel, hostedCheckoutUrl } from "@/lib/world/shop-stands";
import {
  buildDropSchedulePayload, buildSeriesCreatePayload,
  buildSeriesPreviewPatch, buildSeriesPricePatch, dropLocalInputValue, dropScheduleProblem,
  emptySeriesCreateForm, parseDropAnswer, parseDropDetail, parseDroppableProducts,
  parseMyProfileRef, parseSavedSeries, parseSeriesBuyers, parseSeriesIdInput,
  parseSeriesPending, parseSeriesStoreItem, parseMySeries, seriesCheckoutPayload,
  seriesCreateProblem, seriesPendingKey, seriesPriceProblem, seriesUnlockedFromVerify,
  seriesVerifyState,
  type DropDetail, type DroppableProductDto, type PaidSeriesDto, type SeriesBuyers,
  type SeriesCreateFormState, type SeriesStoreItem,
} from "@/lib/world/paid-series-drops";

/* ─── PaidSeriesDropsDesk — Paid Series + Product Drops at the
   Marketplace stand (World parity wave 1; census items
   `paid-series` + `product-drops`, both ABSENT in-World before).
   Everything completes inside the World on the features' OWN
   rails — no 2D page is ever pulled up:
   - PAID SERIES: a creator makes a series (POST /api/playlists,
     kind "series"), prices the unlock and marks its one free
     preview (PATCH /api/playlists/:id), and reads its buyer list
     (GET /api/playlists/:id/buyers) right here. A fan unlocks a
     series here too: the price + fee split are the store rail's
     own (GET /api/store/item/series/:id) and the unlock rides
     POST /api/store/checkout embedded-first — the payment form
     mounts in this desk; the §3.9 hosted tab is only the
     no-publishable-key fallback — settled by POST
     /api/store/verify. Prices are the creator's, read off the
     rails; this desk invents none.
   - PRODUCT DROPS: the owner schedules / moves / cancels a timed
     drop on their storefront products (PUT/DELETE
     /api/storefront/products/:id/drop) and reads the capture
     list (GET …/drop) — the fans who joined the drop list on the
     product's own drop page, one email each at the drop moment.
   Guests browse the stand as always; creating, pricing and
   scheduling are member surfaces (the rails are auth-required),
   and buying a series unlock rides the fan's account too. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function openCheckoutTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function goldBtn(disabled = false) {
  return `inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target ${disabled ? "opacity-50 hover:scale-100" : ""}`;
}
function chipBtn(isLight: boolean) {
  return `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
}
function inputCls(isLight: boolean) {
  return `w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
      : "border-white/15 bg-black/50 text-white placeholder:text-white/30 focus:border-[#d4af37]/60"
  }`;
}
function muted(isLight: boolean) {
  return isLight ? "text-[#6B5B36]" : "text-white/50";
}

export function PaidSeriesDropsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  return (
    <>
      <SeriesDesk isLight={isLight} isGuest={isGuest} />
      <DropsDesk isLight={isLight} isGuest={isGuest} />
    </>
  );
}

/* ═══ Paid Series ═══════════════════════════════════════════════ */

function SeriesDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const problemStrings = {
    priceCeiling: t("worldCommerceStands.seriesProbCeiling"),
    priceValid: t("worldCommerceStands.seriesProbValid"),
    priceMin: t("worldCommerceStands.seriesProbMin"),
    titleFirst: t("worldCommerceStands.seriesProbTitle"),
    dropPick: t("worldCommerceStands.seriesProbDropPick"),
    dropFuture: t("worldCommerceStands.seriesProbDropFuture"),
  };
  const authHeaders = useAuthHeaders();
  const [mine, setMine] = useState<PaidSeriesDto[] | null>(null);
  const [mineFailed, setMineFailed] = useState(false);
  const [tick, setTick] = useState(0);

  /* Create */
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<SeriesCreateFormState>(emptySeriesCreateForm());
  const [creating, setCreating] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesNote, setSeriesNote] = useState<string | null>(null);

  /* Per-series manage state */
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [savingPreviewId, setSavingPreviewId] = useState<string | null>(null);
  const [buyersById, setBuyersById] = useState<Record<string, SeriesBuyers | null>>({});
  const [buyersBusyId, setBuyersBusyId] = useState<string | null>(null);

  /* Fan unlock */
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockItem, setUnlockItem] = useState<SeriesStoreItem | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState<{ clientSecret: string; sessionId: string; seriesId: string; title: string } | null>(null);
  const [pendingNote, setPendingNote] = useState<string | null>(null);
  const [unlockedTitle, setUnlockedTitle] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/playlists/mine", { headers: await authHeaders() });
        if (!res.ok) throw new Error("mine");
        const parsed = parseMySeries(await res.json());
        if (parsed === null) throw new Error("mine");
        if (!cancelled) {
          setMine(parsed);
          setMineFailed(false);
          setPriceInputs(Object.fromEntries(parsed.map((s) => [s.id, s.priceCents ? (s.priceCents / 100).toFixed(2) : ""])));
        }
      } catch {
        if (!cancelled) setMineFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  const createSeries = async () => {
    if (creating) return;
    const problem = seriesCreateProblem(createForm, problemStrings);
    if (problem) { setSeriesError(problem); return; }
    const payload = buildSeriesCreatePayload(createForm);
    if (!payload) { setSeriesError(t("worldCommerceStands.seriesCreateBad")); return; }
    setCreating(true);
    setSeriesError(null);
    setSeriesNote(null);
    try {
      const res = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.seriesCreateFailed")));
      const saved = parseSavedSeries(data);
      if (!saved) throw new Error(t("worldCommerceStands.seriesCreateEmpty"));
      setMine((m) => (m ? [saved, ...m] : [saved]));
      setPriceInputs((p) => ({ ...p, [saved.id]: saved.priceCents ? (saved.priceCents / 100).toFixed(2) : "" }));
      setCreateForm(emptySeriesCreateForm());
      setCreateOpen(false);
      setSeriesNote(t("worldCommerceStands.seriesCreatedNote", { title: saved.title }));
    } catch (e) {
      setSeriesError(plainErrorText(e, t("worldCommerceStands.seriesCreateFailed")));
    } finally {
      setCreating(false);
    }
  };

  const savePrice = async (s: PaidSeriesDto) => {
    if (savingPriceId) return;
    const typed = priceInputs[s.id] ?? "";
    const problem = seriesPriceProblem(typed, problemStrings);
    if (problem) { setSeriesError(problem); return; }
    const patch = buildSeriesPricePatch(typed);
    if (!patch) { setSeriesError(t("worldCommerceStands.seriesPriceValidFirst")); return; }
    setSavingPriceId(s.id);
    setSeriesError(null);
    setSeriesNote(null);
    try {
      const res = await fetch(`/api/playlists/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.seriesPriceFailed")));
      const saved = parseSavedSeries(data);
      if (!saved) throw new Error(t("worldCommerceStands.seriesPriceEmpty"));
      setMine((m) => (m ? m.map((x) => (x.id === saved.id ? saved : x)) : m));
      setSeriesNote(saved.priceCents ? t("worldCommerceStands.seriesPriceSetNote", { title: saved.title, price: centsToDisplay(saved.priceCents) }) : t("worldCommerceStands.seriesPriceFreeNote", { title: saved.title }));
    } catch (e) {
      setSeriesError(plainErrorText(e, t("worldCommerceStands.seriesPriceFailed")));
    } finally {
      setSavingPriceId(null);
    }
  };

  const savePreview = async (s: PaidSeriesDto, value: string) => {
    if (savingPreviewId) return;
    const item = value
      ? (() => { const [kind, id] = value.split(":"); return kind && id ? { kind: kind as "track" | "video", id } : null; })()
      : null;
    setSavingPreviewId(s.id);
    setSeriesError(null);
    setSeriesNote(null);
    try {
      const res = await fetch(`/api/playlists/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildSeriesPreviewPatch(item)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.seriesPreviewFailed")));
      const saved = parseSavedSeries(data);
      if (!saved) throw new Error(t("worldCommerceStands.seriesPreviewEmpty"));
      setMine((m) => (m ? m.map((x) => (x.id === saved.id ? saved : x)) : m));
      setSeriesNote(item ? t("worldCommerceStands.seriesPreviewSetNote", { title: saved.title }) : t("worldCommerceStands.seriesPreviewClearedNote", { title: saved.title }));
    } catch (e) {
      setSeriesError(plainErrorText(e, t("worldCommerceStands.seriesPreviewFailed")));
    } finally {
      setSavingPreviewId(null);
    }
  };

  const loadBuyers = async (s: PaidSeriesDto) => {
    if (buyersBusyId) return;
    setBuyersBusyId(s.id);
    try {
      const res = await fetch(`/api/playlists/${s.id}/buyers`, { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.seriesBuyersFailed")));
      setBuyersById((b) => ({ ...b, [s.id]: parseSeriesBuyers(data) }));
    } catch (e) {
      setSeriesError(plainErrorText(e, t("worldCommerceStands.seriesBuyersFailedDetail")));
    } finally {
      setBuyersBusyId(null);
    }
  };

  /* ── Fan unlock ── */
  const lookupSeries = async () => {
    if (unlockBusy) return;
    const id = parseSeriesIdInput(unlockInput);
    if (!id) { setUnlockError(t("worldCommerceStands.seriesUnlockNeedLink")); return; }
    setUnlockBusy(true);
    setUnlockError(null);
    setUnlockItem(null);
    setUnlockedTitle(null);
    try {
      const res = await fetch(`/api/store/item/series/${id}`);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.seriesUnlockNotForSale")));
      const item = parseSeriesStoreItem(data);
      if (!item) throw new Error(t("worldCommerceStands.seriesUnlockNoPrice"));
      setUnlockItem(item);
      /* An unfinished unlock from an earlier visit refreshes too. */
      let pendingRaw: string | null = null;
      try { pendingRaw = localStorage.getItem(seriesPendingKey(item.id)); } catch { /* storage blocked */ }
      const pending = parseSeriesPending(pendingRaw);
      if (pending) setPendingNote(t("worldCommerceStands.seriesUnlockPendingNote", { title: pending.title }));
    } catch (e) {
      setUnlockError(plainErrorText(e, t("worldCommerceStands.seriesUnlockNotForSaleNow")));
    } finally {
      setUnlockBusy(false);
    }
  };

  const verifyUnlock = async (sessionId: string, seriesId: string) => {
    if (verifying) return;
    setVerifying(true);
    try {
      const res = await fetch("/api/store/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ sessionId }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const state = seriesVerifyState(res.status, data);
      if (state === "confirmed" && seriesUnlockedFromVerify(data)) {
        setUnlockedTitle(unlockItem?.title ?? embedded?.title ?? t("worldCommerceStands.seriesYourSeriesFallback"));
        setEmbedded(null);
        setPendingNote(null);
        try { localStorage.removeItem(seriesPendingKey(seriesId)); } catch { /* ignore */ }
      } else if (state === "pending") {
        setPendingNote(t("worldCommerceStands.seriesVerifyPending"));
      } else {
        setEmbedded(null);
        setPendingNote(null);
        try { localStorage.removeItem(seriesPendingKey(seriesId)); } catch { /* ignore */ }
        setUnlockError(t("worldCommerceStands.seriesVerifyClosed"));
      }
    } catch {
      setPendingNote(t("worldCommerceStands.seriesVerifyCheckFailed"));
    } finally {
      setVerifying(false);
    }
  };

  const startUnlock = async () => {
    if (!unlockItem || unlockBusy) return;
    if (isGuest) { setUnlockError(t("worldCommerceStands.seriesUnlockGuest")); return; }
    setUnlockBusy(true);
    setUnlockError(null);
    setPendingNote(null);
    setEmbedded(null);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(seriesCheckoutPayload(unlockItem.id, hasStripePublishableKey())),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.seriesCheckoutFailed")));
      const sessionId = typeof data["sessionId"] === "string" ? data["sessionId"] : "";
      if (sessionId) {
        try {
          localStorage.setItem(seriesPendingKey(unlockItem.id), JSON.stringify({ sessionId, seriesId: unlockItem.id, title: unlockItem.title }));
        } catch { /* storage blocked — the check button below still verifies this session in place */ }
      }
      if (typeof data["clientSecret"] === "string" && data["clientSecret"]) {
        setEmbedded({ clientSecret: data["clientSecret"], sessionId, seriesId: unlockItem.id, title: unlockItem.title });
        setPendingNote(t("worldCommerceStands.seriesUnlockPayNote", { title: unlockItem.title }));
        return;
      }
      const url = hostedCheckoutUrl(data);
      if (url) {
        openCheckoutTab(url);
        setPendingNote(t("worldCommerceStands.seriesUnlockTabNote"));
        return;
      }
      throw new Error(t("worldCommerceStands.seriesCheckoutNoPage"));
    } catch (e) {
      setUnlockError(plainErrorText(e, t("worldCommerceStands.seriesCheckoutFailed")));
    } finally {
      setUnlockBusy(false);
    }
  };

  /* Returning from a hosted tab: re-check the open series' pending unlock. */
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  useEffect(() => {
    const onFocus = () => {
      const item = unlockItem;
      if (!item || embeddedRef.current) return;
      let raw: string | null = null;
      try { raw = localStorage.getItem(seriesPendingKey(item.id)); } catch { /* ignore */ }
      const pending = parseSeriesPending(raw);
      if (pending) void verifyUnlock(pending.sessionId, pending.seriesId);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlockItem]);

  return (
    <NativeCard isLight={isLight} title={t("worldCommerceStands.seriesDeskTitle")}>
      <div className="space-y-3" data-testid="world-series-desk">
        {seriesError && <p className="text-xs font-semibold text-red-400">{seriesError}</p>}
        {seriesNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{seriesNote}</p>}

        {/* Fan unlock — every member can open a creator's series here. */}
        {!isGuest ? (
          <div className="space-y-2" data-testid="world-series-unlock">
            <p className={`text-xs ${muted(isLight)}`}>
              {t("worldCommerceStands.seriesUnlockIntro")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <input
                value={unlockInput}
                onChange={(e) => setUnlockInput(e.target.value)}
                placeholder={t("worldCommerceStands.seriesLinkPlaceholder")}
                aria-label={t("worldCommerceStands.seriesLinkPlaceholder")}
                className={`${inputCls(isLight)} min-w-44 flex-1`}
              />
              <button type="button" data-testid="world-series-lookup" onClick={() => void lookupSeries()} disabled={unlockBusy} className={chipBtn(isLight)}>
                {unlockBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />} {t("worldCommerceStands.seriesFind")}
              </button>
            </div>
            {unlockError && <p className="text-xs font-semibold text-red-400">{unlockError}</p>}
            {unlockItem && !unlockedTitle && (
              <div className="space-y-2 rounded-xl border border-[#d4af37]/30 px-3 py-2" data-testid="world-series-unlock-card">
                <p className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {unlockItem.title}
                  {unlockItem.artistName && <span className={`ml-2 text-xs font-semibold ${muted(isLight)}`}>{t("worldCommerceStands.seriesBy", { name: unlockItem.artistName })}</span>}
                </p>
                <p className={`text-xs ${muted(isLight)}`}>
                  {t("worldCommerceStands.seriesUnlockSplit", { price: centsToDisplay(unlockItem.priceCents), creator: centsToDisplay(unlockItem.creatorCents), pct: unlockItem.platformFeePct })}
                </p>
                {!embedded && (
                  <button type="button" data-testid="world-series-unlock-start" onClick={() => void startUnlock()} disabled={unlockBusy} className={goldBtn(unlockBusy)}>
                    {unlockBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {checkoutTransferLabel(t)} · {centsToDisplay(unlockItem.priceCents)}
                  </button>
                )}
              </div>
            )}
            {embedded && (
              <div className="space-y-2" data-testid="world-series-embedded-checkout">
                <EmbeddedSessionCheckout clientSecret={embedded.clientSecret} />
                <button
                  type="button"
                  data-testid="world-series-verify"
                  onClick={() => embedded.sessionId && void verifyUnlock(embedded.sessionId, embedded.seriesId)}
                  disabled={verifying || !embedded.sessionId}
                  className={chipBtn(isLight)}
                >
                  <RefreshCw className="h-3 w-3" /> {verifying ? t("worldCommerceStands.seriesChecking") : t("worldCommerceStands.seriesCheckStatus")}
                </button>
              </div>
            )}
            {pendingNote && !unlockedTitle && (
              <div className="space-y-2" data-testid="world-series-pending">
                <p className="text-xs font-semibold text-amber-300">{pendingNote}</p>
                {!embedded && unlockItem && (
                  <button
                    type="button"
                    data-testid="world-series-verify-pending"
                    onClick={() => {
                      let raw: string | null = null;
                      try { raw = localStorage.getItem(seriesPendingKey(unlockItem.id)); } catch { /* ignore */ }
                      const pending = parseSeriesPending(raw);
                      if (pending) void verifyUnlock(pending.sessionId, pending.seriesId);
                    }}
                    disabled={verifying}
                    className={chipBtn(isLight)}
                  >
                    <RefreshCw className="h-3 w-3" /> {t("worldCommerceStands.seriesCheckStatus")}
                  </button>
                )}
              </div>
            )}
            {unlockedTitle && (
              <p className="flex items-center gap-2 text-sm font-bold text-emerald-300" data-testid="world-series-unlocked">
                <BadgeCheck className="h-4 w-4 shrink-0" /> {t("worldCommerceStands.seriesUnlockedLine", { title: unlockedTitle })}
              </p>
            )}
          </div>
        ) : (
          <p className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.seriesGuestNote")}</p>
        )}

        {/* The owner's series shelf */}
        {!isGuest && (
          <div className="space-y-2 border-t border-dashed pt-3" data-testid="world-series-mine">
            <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCommerceStands.seriesMineTitle")}</p>
            {mineFailed ? (
              <NativeErrorState isLight={isLight} title={t("worldCommerceStands.seriesLoadTitle")} message={t("worldCommerceStands.seriesLoadFailed")} onRetry={() => setTick((n) => n + 1)} />
            ) : mine === null ? (
              <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.seriesLoading")} />
            ) : (
              <>
                {mine.length === 0 && <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.seriesEmpty")} />}
                {mine.map((s) => (
                  <div key={s.id} className="space-y-2 rounded-xl border border-[#d4af37]/25 px-3 py-2" data-testid="world-series-row">
                    <p className={`flex flex-wrap items-center gap-2 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <span className="text-sm font-black text-[#d4af37]">{s.priceCents ? centsToDisplay(s.priceCents) : t("worldCommerceStands.seriesFree")}</span>
                      <span className={`text-[11px] ${muted(isLight)}`}>{t(s.items.length === 1 ? "worldCommerceStands.seriesEpisodeOne" : "worldCommerceStands.seriesEpisodeMany", { count: s.items.length })}{s.isPublic ? "" : t("worldCommerceStands.seriesPrivateSuffix")}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        value={priceInputs[s.id] ?? ""}
                        onChange={(e) => setPriceInputs((p) => ({ ...p, [s.id]: e.target.value }))}
                        placeholder={t("worldCommerceStands.seriesPricePlaceholder")}
                        aria-label={t("worldCommerceStands.seriesPriceAria", { title: s.title })}
                        inputMode="decimal"
                        className={`${inputCls(isLight)} w-40`}
                      />
                      <button type="button" data-testid="world-series-save-price" onClick={() => void savePrice(s)} disabled={savingPriceId === s.id} className={chipBtn(isLight)}>
                        {savingPriceId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pencil className="h-3 w-3" />} {t("worldCommerceStands.seriesSavePrice")}
                      </button>
                      {s.items.length > 0 && (
                        <select
                          value={s.previewItem ? `${s.previewItem.kind}:${s.previewItem.id}` : ""}
                          onChange={(e) => void savePreview(s, e.target.value)}
                          disabled={savingPreviewId === s.id}
                          aria-label={t("worldCommerceStands.seriesPreviewAria", { title: s.title })}
                          className={`${inputCls(isLight)} w-48`}
                        >
                          <option value="">{t("worldCommerceStands.seriesNoPreview")}</option>
                          {s.items.map((it, i) => (
                            <option key={`${it.kind}:${it.id}`} value={`${it.kind}:${it.id}`}>{t("worldCommerceStands.seriesPreviewOption", { n: i + 1, kind: it.kind })}</option>
                          ))}
                        </select>
                      )}
                      <button type="button" data-testid="world-series-buyers" onClick={() => void loadBuyers(s)} disabled={buyersBusyId === s.id} className={chipBtn(isLight)}>
                        {buyersBusyId === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />} {t("worldCommerceStands.seriesBuyers")}
                      </button>
                    </div>
                    {buyersById[s.id] && (
                      <p className={`text-xs ${muted(isLight)}`} data-testid="world-series-buyers-list">
                        {t(buyersById[s.id]!.buyerCount === 1 ? "worldCommerceStands.seriesBuyersLineOne" : "worldCommerceStands.seriesBuyersLineMany", { count: buyersById[s.id]!.buyerCount, gross: centsToDisplay(buyersById[s.id]!.grossCents) })}
                        {buyersById[s.id]!.buyers.slice(0, 5).map((b) => ` · ${b.displayName} (${centsToDisplay(b.amountCents)}${b.status !== "completed" ? `, ${b.status}` : ""})`).join("")}
                      </p>
                    )}
                    {buyersById[s.id] === null && <p className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.seriesBuyersNoAnswer")}</p>}
                  </div>
                ))}
                {!createOpen ? (
                  <button type="button" data-testid="world-series-create-open" onClick={() => { setCreateOpen(true); setSeriesError(null); }} className={goldBtn()}>
                    <Plus className="h-4 w-4" /> {t("worldCommerceStands.seriesCreateOpen")}
                  </button>
                ) : (
                  <div className="space-y-2" data-testid="world-series-create-form">
                    <input value={createForm.title} onChange={(e) => setCreateForm((f) => ({ ...f, title: e.target.value }))} placeholder={t("worldCommerceStands.seriesTitlePlaceholder")} aria-label={t("worldCommerceStands.seriesTitlePlaceholder")} className={inputCls(isLight)} />
                    <input value={createForm.description} onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))} placeholder={t("worldCommerceStands.seriesDescPlaceholder")} aria-label={t("worldCommerceStands.seriesDescAria")} className={inputCls(isLight)} />
                    <input value={createForm.price} onChange={(e) => setCreateForm((f) => ({ ...f, price: e.target.value }))} placeholder={t("worldCommerceStands.seriesCreatePricePlaceholder")} aria-label={t("worldCommerceStands.seriesCreatePriceAria")} inputMode="decimal" className={inputCls(isLight)} />
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" data-testid="world-series-create-submit" onClick={() => void createSeries()} disabled={creating} className={goldBtn(creating)}>
                        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("worldCommerceStands.seriesCreateSubmit")}
                      </button>
                      <button type="button" onClick={() => { setCreateOpen(false); setSeriesError(null); }} className={chipBtn(isLight)}>{t("worldCommerceStands.seriesCancel")}</button>
                    </div>
                    <p className={`text-[11px] ${muted(isLight)}`}>{t("worldCommerceStands.seriesCreateNote")}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ═══ Product Drops ═════════════════════════════════════════════ */

function DropsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const problemStrings = {
    priceCeiling: t("worldCommerceStands.seriesProbCeiling"),
    priceValid: t("worldCommerceStands.seriesProbValid"),
    priceMin: t("worldCommerceStands.seriesProbMin"),
    titleFirst: t("worldCommerceStands.seriesProbTitle"),
    dropPick: t("worldCommerceStands.seriesProbDropPick"),
    dropFuture: t("worldCommerceStands.seriesProbDropFuture"),
  };
  const authHeaders = useAuthHeaders();
  const [products, setProducts] = useState<DroppableProductDto[] | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [dropInputs, setDropInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [dropNote, setDropNote] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, DropDetail | null>>({});
  const [detailBusyId, setDetailBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/creator-profiles/me", { headers: await authHeaders() });
        if (meRes.status === 404) { if (!cancelled) setNoProfile(true); return; }
        if (!meRes.ok) throw new Error("me");
        const me = parseMyProfileRef(await meRes.json());
        if (!me) throw new Error("me");
        const res = await fetch(`/api/storefront/products?profileId=${encodeURIComponent(me.id)}`);
        if (!res.ok) throw new Error("products");
        const parsed = parseDroppableProducts(await res.json());
        if (parsed === null) throw new Error("products");
        if (!cancelled) {
          setProducts(parsed);
          setLoadFailed(false);
          setDropInputs(Object.fromEntries(parsed.map((p) => [p.id, dropLocalInputValue(p.drop?.dropAt) ?? ""])));
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, tick]);

  const schedule = async (p: DroppableProductDto) => {
    if (busyId) return;
    const value = dropInputs[p.id] ?? "";
    const problem = dropScheduleProblem(value, Date.now(), problemStrings);
    if (problem) { setDropError(problem); return; }
    const payload = buildDropSchedulePayload(value, Date.now());
    if (!payload) { setDropError(t("worldCommerceStands.seriesProbDropPick")); return; }
    setBusyId(p.id);
    setDropError(null);
    setDropNote(null);
    try {
      const res = await fetch(`/api/storefront/products/${p.id}/drop`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.dropsScheduleFailed")));
      const drop = parseDropAnswer(data);
      if (drop === undefined) throw new Error(t("worldCommerceStands.dropsScheduleEmpty"));
      setProducts((ps) => (ps ? ps.map((x) => (x.id === p.id ? { ...x, drop } : x)) : ps));
      setDropNote(t("worldCommerceStands.dropsScheduledNote", { title: p.title, when: formatDropLocal(payload.dropAt) ?? "" }));
    } catch (e) {
      setDropError(plainErrorText(e, t("worldCommerceStands.dropsScheduleFailedDetail")));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (p: DroppableProductDto) => {
    if (busyId) return;
    setBusyId(p.id);
    setDropError(null);
    setDropNote(null);
    try {
      const res = await fetch(`/api/storefront/products/${p.id}/drop`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.dropsCancelFailed")));
      setProducts((ps) => (ps ? ps.map((x) => (x.id === p.id ? { ...x, drop: null } : x)) : ps));
      setDetailById((d) => ({ ...d, [p.id]: null }));
      setDropNote(t("worldCommerceStands.dropsCancelledNote", { title: p.title }));
    } catch (e) {
      setDropError(plainErrorText(e, t("worldCommerceStands.dropsCancelFailedDetail")));
    } finally {
      setBusyId(null);
    }
  };

  const loadDetail = async (p: DroppableProductDto) => {
    if (detailBusyId) return;
    setDetailBusyId(p.id);
    try {
      const res = await fetch(`/api/storefront/products/${p.id}/drop`, { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCommerceStands.dropsListFailed")));
      setDetailById((d) => ({ ...d, [p.id]: parseDropDetail(data) }));
    } catch (e) {
      setDropError(plainErrorText(e, t("worldCommerceStands.dropsListFailedDetail")));
    } finally {
      setDetailBusyId(null);
    }
  };


  if (isGuest) {
    return (
      <NativeCard isLight={isLight} title={t("worldCommerceStands.dropsGuestTitle")}>
        <p className={`text-xs ${muted(isLight)}`} data-testid="world-drops-guest">
          {t("worldCommerceStands.dropsGuestNote")}
        </p>
      </NativeCard>
    );
  }

  return (
    <NativeCard isLight={isLight} title={t("worldCommerceStands.dropsDeskTitle")}>
      <div className="space-y-3" data-testid="world-drops-desk">
        {dropError && <p className="text-xs font-semibold text-red-400">{dropError}</p>}
        {dropNote && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{dropNote}</p>}
        {noProfile ? (
          <p className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.dropsNoProfile")}</p>
        ) : loadFailed ? (
          <NativeErrorState isLight={isLight} title={t("worldCommerceStands.dropsLoadTitle")} message={t("worldCommerceStands.dropsLoadFailed")} onRetry={() => setTick((n) => n + 1)} />
        ) : products === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.dropsLoading")} />
        ) : products.length === 0 ? (
          <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.dropsEmpty")} />
        ) : (
          products.map((p) => (
            <div key={p.id} className="space-y-2 rounded-xl border border-[#d4af37]/25 px-3 py-2" data-testid="world-drop-product-row">
              <p className={`flex flex-wrap items-center gap-2 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(p.priceCents)}</span>
                {p.drop?.isUpcoming ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-300"><CalendarClock className="h-3.5 w-3.5" /> {t("worldCommerceStands.dropsWhen", { when: formatDropLocal(p.drop.dropAt) ?? "" })}</span>
                ) : p.drop ? (
                  <span className="text-[11px] font-bold text-emerald-300">{t("worldCommerceStands.dropsLive")}</span>
                ) : (
                  <span className={`text-[11px] ${muted(isLight)}`}>{t("worldCommerceStands.dropsNone")}</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="datetime-local"
                  value={dropInputs[p.id] ?? ""}
                  onChange={(e) => setDropInputs((d) => ({ ...d, [p.id]: e.target.value }))}
                  aria-label={t("worldCommerceStands.dropsWhenAria", { title: p.title })}
                  className={`${inputCls(isLight)} w-56`}
                />
                <button type="button" data-testid="world-drop-schedule" onClick={() => void schedule(p)} disabled={busyId === p.id} className={chipBtn(isLight)}>
                  {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CalendarClock className="h-3 w-3" />}
                  {p.drop?.isUpcoming ? t("worldCommerceStands.dropsMove") : t("worldCommerceStands.dropsSchedule")}
                </button>
                {p.drop?.isUpcoming && (
                  <button type="button" data-testid="world-drop-cancel" onClick={() => void cancel(p)} disabled={busyId === p.id} className={chipBtn(isLight)}>
                    <Trash2 className="h-3 w-3" /> {t("worldCommerceStands.dropsCancel")}
                  </button>
                )}
                {p.drop && (
                  <button type="button" data-testid="world-drop-list" onClick={() => void loadDetail(p)} disabled={detailBusyId === p.id} className={chipBtn(isLight)}>
                    {detailBusyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="h-3 w-3" />} {t("worldCommerceStands.dropsList")}
                  </button>
                )}
              </div>
              {detailById[p.id] && (
                <p className={`text-xs ${muted(isLight)}`} data-testid="world-drop-captures">
                  {t(detailById[p.id]!.captureCount === 1 ? "worldCommerceStands.dropsCapturesOne" : "worldCommerceStands.dropsCapturesMany", { count: detailById[p.id]!.captureCount })}
                  {detailById[p.id]!.captures.slice(0, 5).map((c) => ` · ${c.email}`).join("")}
                </p>
              )}
              {detailById[p.id] === null && p.drop && <p className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.dropsListNoAnswer")}</p>}
            </div>
          ))
        )}
        <p className={`text-[11px] ${muted(isLight)}`}>
          {t("worldCommerceStands.dropsFooterNote")}
        </p>
      </div>
    </NativeCard>
  );
}
