import { plainErrorText } from "../../../lib/api-error";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUpCircle, Check, Loader2, Magnet, Pencil, Plus, RefreshCw, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { centsToDisplay } from "@/lib/shops";
import {
  LEAD_MAGNET_KINDS,
  addonSummary, applyGrowthProductSave, buildBumpPayload,
  buildLeadMagnetConvertPayload, buildLeadMagnetCreatePayload,
  buildLeadMagnetRestorePayload, bumpCandidates, bumpPercentProblem,
  bumpUnitCents, emptyLeadMagnetForm, isLeadMagnet, leadMagnetConvertible,
  leadMagnetFormProblem, leadMagnetRestoreProblem, leadMagnets,
  parseBumpPercent, parseBumpSave, parseGrowthProducts, parseSavedGrowthProduct, parseStoreSlug,
  type GrowthProduct, type LeadMagnetFormState,
} from "@/lib/world/store-growth";

/* ─── StoreGrowthDesk — the store's three growth tools, in-World ──
   Stack1400 parity wave #1, item 3. The store dashboard's three
   conversion tools had no World form (parity census 2026-11-02:
   lead-magnets / order-bumps / post-purchase-upsell ABSENT); this
   desk is their native manage surface, docked at the Marketplace
   stand in ShopStands (the ShopStand manage side) and riding the
   EXISTING 2D store rails end to end — no parallel API, no page
   pull-up, everything completes right here:
   - the seller's store is found the dashboard's way: GET
     /api/storefront/money-checklist → links.storeUrl → the slug,
     then GET /api/storefront/products?slug=… (the dashboard's own
     list read, bumpConfig + resolved bump offer included). A
     genuine no-profile account answers the checklist 404 — the
     desk says "make your creator profile first" and stops, it
     never renders an invented empty store;
   - LEAD MAGNETS: a $0 product, claimed by fans with their email
     (POST /api/storefront/claim is the fan's rail; the seller's
     side is the price). Create one here (POST
     /api/storefront/products, priceCents 0), turn a paid product
     into one, or price one again — both by PATCH
     /api/storefront/products/:id { priceCents }, behind an armed
     confirm, because a price change is a money move;
   - ORDER BUMPS: PUT /api/storefront/products/:id/bump with the
     dashboard's exact body — one of your own priced products as
     the add-on, at its price or your % off it (0–90);
   - POST-PURCHASE UPSELL: the SAME designation (the api rail
     reuses the bump attachment) — the upsell section edits the
     same attachment under its own framing and says so plainly:
     a buyer who skips the tick is offered the add-on once after
     paying, one click on the card they just used.
   Prices are the rails' own: the form's add-on price preview is
   the rail's formula shown for reading; the server recomputes
   every figure at save and at checkout, and the flat 5% platform
   fee on an add-on sale is the rail's, named in copy only.
   The list moves ONLY from server-confirmed rows. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function goldBtn(disabled = false) {
  return `inline-flex items-center justify-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 bdv-touch-target ${disabled ? "opacity-50 hover:scale-100" : ""}`;
}
function chipBtn(isLight: boolean) {
  return `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]" : "border-white/15 text-white/75 hover:text-white"
  }`;
}
function standTabBtn(isLight: boolean, active: boolean) {
  if (active) return "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-black text-black transition bdv-touch-target";
  return chipBtn(isLight);
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
function rowCls(isLight: boolean) {
  return `rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`;
}

type DeskState = "loading" | "ready" | "no-profile" | "failed";
type GrowthSection = "lead" | "bumps" | "upsell";

export function StoreGrowthDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [state, setState] = useState<DeskState>("loading");
  const [products, setProducts] = useState<GrowthProduct[]>([]);
  const [section, setSection] = useState<GrowthSection>("lead");

  const load = async () => {
    setState("loading");
    try {
      const headers = await authHeaders();
      const checkRes = await fetch("/api/storefront/money-checklist", { headers });
      if (checkRes.status === 404) { setState("no-profile"); return; }
      const checkData = (await checkRes.json().catch(() => ({}))) as unknown;
      if (!checkRes.ok) throw new Error("checklist");
      const slug = parseStoreSlug(checkData);
      if (!slug) throw new Error("checklist");
      const listRes = await fetch(`/api/storefront/products?slug=${encodeURIComponent(slug)}`);
      const listData = (await listRes.json().catch(() => ({}))) as unknown;
      if (!listRes.ok) throw new Error("products");
      const parsed = parseGrowthProducts(listData);
      if (!parsed) throw new Error("products");
      setProducts(parsed);
      setState("ready");
    } catch {
      setState("failed");
    }
  };
  useEffect(() => {
    if (isGuest) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  /* Guests have no store to grow — the desk simply isn't there. */
  if (isGuest) return null;

  const onSaved = (saved: GrowthProduct) =>
    setProducts((ps) => applyGrowthProductSave(ps, saved));

  return (
    <NativeCard isLight={isLight} title={t("worldCommerceStands.growthTitle")}>
      <div className="space-y-2" data-testid="world-store-growth">
        <p className={`text-xs ${muted(isLight)}`}>
          {t("worldCommerceStands.growthIntro")}
        </p>

        {state === "loading" && <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.growthLoading")} />}
        {state === "failed" && (
          <NativeErrorState
            isLight={isLight}
            title={t("worldCommerceStands.growthFailedTitle")}
            message={t("worldCommerceStands.growthFailedMsg")}
            onRetry={() => void load()}
          />
        )}
        {state === "no-profile" && (
          <div data-testid="world-store-growth-no-profile">
            <NativeEmptyState
              isLight={isLight}
              message={t("worldCommerceStands.growthNoProfileMsg")}
              detail={t("worldCommerceStands.growthNoProfileDetail")}
            />
          </div>
        )}

        {state === "ready" && (
          <>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("worldCommerceStands.growthTabsAria")}>
              <button type="button" role="tab" aria-selected={section === "lead"} data-testid="world-store-growth-tab-lead" onClick={() => setSection("lead")} className={standTabBtn(isLight, section === "lead")}>
                <Magnet className="h-3 w-3" /> {t("worldCommerceStands.growthTabLead")}
              </button>
              <button type="button" role="tab" aria-selected={section === "bumps"} data-testid="world-store-growth-tab-bumps" onClick={() => setSection("bumps")} className={standTabBtn(isLight, section === "bumps")}>
                <Plus className="h-3 w-3" /> {t("worldCommerceStands.growthTabBumps")}
              </button>
              <button type="button" role="tab" aria-selected={section === "upsell"} data-testid="world-store-growth-tab-upsell" onClick={() => setSection("upsell")} className={standTabBtn(isLight, section === "upsell")}>
                <ArrowUpCircle className="h-3 w-3" /> {t("worldCommerceStands.growthTabUpsell")}
              </button>
            </div>

            {section === "lead" && (
              <LeadMagnetsSection isLight={isLight} products={products} onSaved={onSaved} />
            )}
            {section === "bumps" && (
              <AddonSection
                mode="bump"
                isLight={isLight}
                products={products}
                onSaved={onSaved}
              />
            )}
            {section === "upsell" && (
              <AddonSection
                mode="upsell"
                isLight={isLight}
                products={products}
                onSaved={onSaved}
              />
            )}
          </>
        )}
      </div>
    </NativeCard>
  );
}

/* ═══ Lead magnets — the $0 door into the store ═══════════════════ */

function LeadMagnetsSection({
  isLight, products, onSaved,
}: {
  isLight: boolean;
  products: GrowthProduct[];
  onSaved: (saved: GrowthProduct) => void;
}) {
  const { t } = useTranslation();
  const leadStrings = {
    titleRequired: t("worldCommerceStands.growthProblemTitleRequired"),
    titleLong: t("worldCommerceStands.growthProblemTitleLong"),
    descLong: t("worldCommerceStands.growthProblemDescLong"),
    restorePrice: t("worldCommerceStands.growthProblemRestorePrice"),
  };
  const authHeaders = useAuthHeaders();
  const magnets = leadMagnets(products);
  const convertible = leadMagnetConvertible(products);

  const [form, setForm] = useState<LeadMagnetFormState>(emptyLeadMagnetForm());
  const [creating, setCreating] = useState(false);
  const [convertId, setConvertId] = useState("");
  const [convertArmed, setConvertArmed] = useState(false);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [restorePrice, setRestorePrice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const set = (patch: Partial<LeadMagnetFormState>) => setForm((f) => ({ ...f, ...patch }));

  const patchPrice = async (p: GrowthProduct, payload: { priceCents: number }, done: string) => {
    if (busyId) return;
    setBusyId(p.id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/storefront/products/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.growthPriceSaveFailed"));
      const saved = parseSavedGrowthProduct(data);
      if (!saved) throw new Error(t("worldCommerceStands.growthSaveNoProduct"));
      onSaved(saved);
      setNote(done);
      setConvertArmed(false);
      setConvertId("");
      setRestoreId(null);
      setRestorePrice("");
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.growthPriceSaveFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const create = async () => {
    if (creating) return;
    const problem = leadMagnetFormProblem(form, leadStrings);
    if (problem) { setError(problem); return; }
    const payload = buildLeadMagnetCreatePayload(form);
    if (!payload) { setError(t("worldCommerceStands.growthCreateBadTitle")); return; }
    setCreating(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/storefront/products", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.growthCreateFailed"));
      const saved = parseSavedGrowthProduct(data);
      if (!saved) throw new Error(t("worldCommerceStands.growthSaveNoProduct"));
      onSaved(saved);
      setForm(emptyLeadMagnetForm());
      setNote(t("worldCommerceStands.growthCreatedNote", { title: saved.title }));
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.growthCreateFailed")));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="world-store-growth-lead">
      <p className={`text-xs ${muted(isLight)}`}>
        {t("worldCommerceStands.growthLeadIntro")}
      </p>
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}

      <div className="space-y-1.5">
        {magnets.map((p) => (
          <div key={p.id} data-testid="world-store-growth-lead-row" className={rowCls(isLight)}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.title}</span>
              <span className="shrink-0 rounded-full bg-[#d4af37]/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#e8c86a]">
                <Magnet className="mr-1 inline h-3 w-3" />{t("worldCommerceStands.growthLeadBadge")}
              </span>
              {restoreId !== p.id && (
                <button type="button" data-testid="world-store-growth-lead-restore-open" onClick={() => { setRestoreId(p.id); setRestorePrice(""); setError(null); }} className={chipBtn(isLight)}>
                  <Pencil className="h-3 w-3" /> {t("worldCommerceStands.growthMakePaid")}
                </button>
              )}
            </div>
            {restoreId === p.id && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="world-store-growth-lead-restore">
                <input
                  value={restorePrice}
                  onChange={(e) => setRestorePrice(e.target.value)}
                  placeholder={t("worldCommerceStands.growthNewPricePlaceholder")}
                  aria-label={t("worldCommerceStands.growthNewPriceAria")}
                  inputMode="decimal"
                  className={`${inputCls(isLight)} max-w-[180px]`}
                />
                <button
                  type="button"
                  data-testid="world-store-growth-lead-restore-save"
                  disabled={busyId === p.id}
                  onClick={() => {
                    const problem = leadMagnetRestoreProblem(restorePrice, leadStrings);
                    if (problem) { setError(problem); return; }
                    const payload = buildLeadMagnetRestorePayload(restorePrice);
                    if (payload) void patchPrice(p, payload, t("worldCommerceStands.growthRestoredNote", { title: p.title, price: centsToDisplay(payload.priceCents) }));
                  }}
                  className={goldBtn(busyId === p.id)}
                >
                  {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t("worldCommerceStands.growthSavePrice")}
                </button>
                <button type="button" onClick={() => setRestoreId(null)} className={chipBtn(isLight)}>
                  <X className="h-3 w-3" /> {t("worldCommerceStands.growthKeepFree")}
                </button>
              </div>
            )}
          </div>
        ))}
        {magnets.length === 0 && (
          <p className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.growthNoMagnets")}</p>
        )}
      </div>

      <div className="space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-store-growth-lead-create">
        <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCommerceStands.growthMakeMagnetTitle")}</p>
        <input
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t("worldCommerceStands.growthLeadTitlePlaceholder")}
          aria-label={t("worldCommerceStands.growthLeadTitleAria")}
          maxLength={160}
          className={inputCls(isLight)}
        />
        <textarea
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder={t("worldCommerceStands.growthLeadDescPlaceholder")}
          aria-label={t("worldCommerceStands.growthLeadDescAria")}
          maxLength={5000}
          rows={2}
          className={inputCls(isLight)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={form.kind}
            onChange={(e) => set({ kind: e.target.value as LeadMagnetFormState["kind"] })}
            aria-label={t("worldCommerceStands.growthLeadKindAria")}
            className={`${inputCls(isLight)} max-w-[180px]`}
          >
            {LEAD_MAGNET_KINDS.map((k) => (
              <option key={k} value={k}>{k === "digital" ? t("worldCommerceStands.growthKindDigital") : t("worldCommerceStands.growthKindDownload")}</option>
            ))}
          </select>
          <span className={`text-xs ${muted(isLight)}`}>{t("worldCommerceStands.growthLeadPriceNote")}</span>
          <button type="button" data-testid="world-store-growth-lead-create-submit" onClick={() => void create()} disabled={creating} className={goldBtn(creating)}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Magnet className="h-4 w-4" />} {t("worldCommerceStands.growthPutFree")}
          </button>
        </div>
      </div>

      {convertible.length > 0 && (
        <div className="space-y-2 border-t border-[#d4af37]/25 pt-3" data-testid="world-store-growth-lead-convert">
          <p className={`text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("worldCommerceStands.growthConvertTitle")}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value={convertId}
              onChange={(e) => { setConvertId(e.target.value); setConvertArmed(false); }}
              aria-label={t("worldCommerceStands.growthConvertAria")}
              className={`${inputCls(isLight)} max-w-[320px]`}
            >
              <option value="">{t("worldCommerceStands.growthConvertPick")}</option>
              {convertible.map((p) => (
                <option key={p.id} value={p.id}>{p.title} — {centsToDisplay(p.priceCents)}</option>
              ))}
            </select>
            {convertId && !convertArmed && (
              <button type="button" data-testid="world-store-growth-lead-convert-arm" onClick={() => setConvertArmed(true)} className={chipBtn(isLight)}>
                {t("worldCommerceStands.growthMakeFree")}
              </button>
            )}
            {convertId && convertArmed && (
              <>
                <span className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
                  {t("worldCommerceStands.growthConvertArmedNote")}
                </span>
                <button
                  type="button"
                  data-testid="world-store-growth-lead-convert-confirm"
                  disabled={busyId !== null}
                  onClick={() => {
                    const p = convertible.find((q) => q.id === convertId);
                    if (p) void patchPrice(p, buildLeadMagnetConvertPayload(), t("worldCommerceStands.growthConvertedNote", { title: p.title }));
                  }}
                  className={goldBtn(busyId !== null)}
                >
                  {busyId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t("worldCommerceStands.growthYesMakeFree")}
                </button>
                <button type="button" onClick={() => setConvertArmed(false)} className={chipBtn(isLight)}>
                  <X className="h-3 w-3" /> {t("worldCommerceStands.growthKeepPrice")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══ Add-ons — one editor, two doors (checkout bump + the
       after-purchase offer share the one designation) ════════════ */

function AddonSection({
  mode, isLight, products, onSaved,
}: {
  mode: "bump" | "upsell";
  isLight: boolean;
  products: GrowthProduct[];
  onSaved: (saved: GrowthProduct) => void;
}) {
  const { t } = useTranslation();
  const bumpStrings = {
    percentProblem: t("worldCommerceStands.growthProblemPercent"),
    summaryNone: t("worldCommerceStands.growthSummaryNone"),
    summaryAttachedNamed: t("worldCommerceStands.growthSummaryAttachedNamed"),
    summaryAttachedAnon: t("worldCommerceStands.growthSummaryAttachedAnon"),
    summaryLive: t("worldCommerceStands.growthSummaryLive"),
    summaryLivePct: t("worldCommerceStands.growthSummaryLivePct"),
  };
  const feeLabel = t("worldCommerceStands.growthAddonFeeLabel");
  const authHeaders = useAuthHeaders();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [percentRaw, setPercentRaw] = useState("0");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const openEditor = (p: GrowthProduct) => {
    setError(null);
    setNote(null);
    if (editingId === p.id) { setEditingId(null); return; }
    setEditingId(p.id);
    setTargetId(p.bumpConfig?.bumpProductId ?? "");
    setPercentRaw(String(p.bumpConfig?.percentOff ?? 0));
  };

  const put = async (p: GrowthProduct, payload: { bumpProductId: string | null; percentOff: number }) => {
    if (busyId) return;
    setBusyId(p.id);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/storefront/products/${p.id}/bump`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data["error"] === "string" ? data["error"] : t("worldCommerceStands.growthAddonSaveFailed"));
      const saved = parseBumpSave(data);
      if (!saved) throw new Error(t("worldCommerceStands.growthSaveNoProduct"));
      onSaved(saved.product);
      setEditingId(null);
      setNote(
        payload.bumpProductId === null
          ? t("worldCommerceStands.growthAddonRemovedNote", { title: p.title })
          : saved.offerLive
            ? t("worldCommerceStands.growthAddonLiveNote", { title: p.title })
            : t("worldCommerceStands.growthAddonNotLiveNote", { title: p.title }),
      );
    } catch (e) {
      setError(plainErrorText(e, t("worldCommerceStands.growthAddonSaveFailed")));
    } finally {
      setBusyId(null);
    }
  };

  const save = (p: GrowthProduct) => {
    if (!targetId) { setError(t("worldCommerceStands.growthPickAddonFirst")); return; }
    const problem = bumpPercentProblem(percentRaw, bumpStrings);
    if (problem) { setError(problem); return; }
    const payload = buildBumpPayload(targetId, percentRaw);
    if (!payload) { setError(t("worldCommerceStands.growthAddonBadSave")); return; }
    void put(p, payload);
  };

  const target = targetId ? (products.find((q) => q.id === targetId) ?? null) : null;

  return (
    <div className="space-y-2" data-testid={mode === "bump" ? "world-store-growth-bumps" : "world-store-growth-upsell"}>
      {mode === "bump" ? (
        <p className={`text-xs ${muted(isLight)}`}>
          {t("worldCommerceStands.growthBumpIntro", { fee: feeLabel })}
        </p>
      ) : (
        <p className={`text-xs ${muted(isLight)}`}>
          {t("worldCommerceStands.growthUpsellIntro", { fee: feeLabel })}
        </p>
      )}
      {error && <p className="text-xs font-semibold text-red-400">{error}</p>}
      {note && <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}

      <div className="space-y-1.5">
        {products.map((p) => {
          const summary = addonSummary(products, p, bumpStrings);
          return (
            <div key={p.id} data-testid={mode === "bump" ? "world-store-growth-bump-row" : "world-store-growth-upsell-row"} className={rowCls(isLight)}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{p.title}</span>
                <span className="text-sm font-black text-[#d4af37]">{isLeadMagnet(p) ? t("worldCommerceStands.growthFree") : centsToDisplay(p.priceCents)}</span>
                <span className={`text-xs ${summary.live ? (isLight ? "text-[#92600a]" : "text-amber-300") : muted(isLight)}`}>{summary.line}</span>
                <button type="button" data-testid={mode === "bump" ? "world-store-growth-bump-edit" : "world-store-growth-upsell-edit"} onClick={() => openEditor(p)} className={chipBtn(isLight)}>
                  <Pencil className="h-3 w-3" /> {p.bumpConfig ? t("worldCommerceStands.growthChangeAddon") : t("worldCommerceStands.growthAttachAddon")}
                </button>
              </div>
              {editingId === p.id && (
                <div className="mt-2 space-y-2 border-t border-[#d4af37]/25 pt-2" data-testid={mode === "bump" ? "world-store-growth-bump-editor" : "world-store-growth-upsell-editor"}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      aria-label={t("worldCommerceStands.growthAddonProductAria")}
                      className={`${inputCls(isLight)} max-w-[320px]`}
                    >
                      <option value="">{t("worldCommerceStands.growthPickProduct")}</option>
                      {bumpCandidates(products, p.id).map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.title} — {centsToDisplay(q.priceCents)}{q.isActive ? "" : t("worldCommerceStands.growthDraftSuffix")}
                        </option>
                      ))}
                    </select>
                    <label className={`inline-flex items-center gap-1.5 text-xs ${muted(isLight)}`}>
                      {t("worldCommerceStands.growthPercentOffLabel")}
                      <input
                        value={percentRaw}
                        onChange={(e) => setPercentRaw(e.target.value)}
                        inputMode="numeric"
                        aria-label={t("worldCommerceStands.growthPercentOffAria")}
                        className={`${inputCls(isLight)} max-w-[72px]`}
                      />
                    </label>
                    <button type="button" data-testid={mode === "bump" ? "world-store-growth-bump-save" : "world-store-growth-upsell-save"} onClick={() => save(p)} disabled={busyId === p.id} className={goldBtn(busyId === p.id)}>
                      {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t("worldCommerceStands.growthSaveAddon")}
                    </button>
                    {p.bumpConfig && (
                      <button
                        type="button"
                        data-testid={mode === "bump" ? "world-store-growth-bump-remove" : "world-store-growth-upsell-remove"}
                        onClick={() => {
                          const payload = buildBumpPayload(null, "0");
                          if (payload) void put(p, payload);
                        }}
                        disabled={busyId === p.id}
                        className="inline-flex items-center gap-1.5 rounded-full border border-red-400/40 px-3 py-1.5 text-xs font-bold text-red-300 transition hover:bg-red-400/10 disabled:opacity-60 bdv-touch-target"
                      >
                        {t("worldCommerceStands.growthRemove")}
                      </button>
                    )}
                  </div>
                  {target && !bumpPercentProblem(percentRaw, bumpStrings) && (
                    <p className={`text-[11px] ${muted(isLight)}`}>
                      {t("worldCommerceStands.growthBuyerPreview", {
                        title: target.title,
                        price: centsToDisplay(bumpUnitCents(target.priceCents, parseBumpPercent(percentRaw))),
                        offPart: parseBumpPercent(percentRaw) > 0
                          ? t("worldCommerceStands.growthBuyerPreviewOff", { pct: parseBumpPercent(percentRaw), list: centsToDisplay(target.priceCents) })
                          : "",
                        fee: feeLabel,
                      })}
                    </p>
                  )}
                  <button type="button" onClick={() => setEditingId(null)} className={chipBtn(isLight)}>
                    <X className="h-3 w-3" /> {t("worldCommerceStands.growthCancel")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {products.length === 0 && (
          <NativeEmptyState isLight={isLight} message={t("worldCommerceStands.growthNoProducts")} />
        )}
      </div>
      <p className={`flex items-center gap-2 text-[11px] ${muted(isLight)}`}>
        <RefreshCw className="h-3 w-3 shrink-0" />
        {t("worldCommerceStands.growthDesignationNote")}
      </p>
    </div>
  );
}
