import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  CheckCircle2, Loader2, Minus, Nfc, Pencil, Plus, QrCode, X,
} from "lucide-react";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeLoadingState, NativeErrorState } from "./NativeStates";
import { NFC_CARD_STYLES, formatMoney, nfcStyleByKey } from "@/lib/nfc-cards";
import {
  SMART_CARD_MAX_LINKS,
  SMART_CARD_MAX_QUANTITY,
  buildSmartCardOrderPayload,
  buildSmartCardProfilePayload,
  newSmartCardOrderKey,
  parseSmartCardOrderResult,
  parseSmartCardOrders,
  parseSmartCardProfile,
  parseSmartCardProfiles,
  smartCardOrderComplete,
  smartCardOrderStatusLabel,
  smartCardOrderTotalCents,
  smartCardQrPath,
  smartCardValidLinks,
  type SmartCardLink,
  type SmartCardOrder,
  type SmartCardOrderResult,
  type SmartCardProfile,
} from "@/lib/world/smart-cards";

/* ─── The Smart Cards stand (World parity P3-C) ─────────────────────
   The Branding Atelier's missing department: the NFC Smart Business
   Cards line (pages/nfc-cards.tsx), complete in-world on the line's
   own rails — pick a style → write what a tap shows → say where the
   cards ship → the reservation is captured, and your cards (digital
   profiles + orders) are managed right here. The line's v1 honesty
   contract stands verbatim: an order is a reservation — payment is
   collected when production is confirmed with the supplier — so the
   stand takes no money and charges no Bucs; one idempotency key per
   attempt keeps a retried tap from ever double-booking. */

export function SmartCardsStand({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();

  /* order form */
  const [styleKey, setStyleKey] = useState(NFC_CARD_STYLES[0]!.key);
  const [quantity, setQuantity] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<SmartCardLink[]>([{ label: "", url: "" }]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state_, setState_] = useState("");
  const [zip, setZip] = useState("");
  const [orderKey, setOrderKey] = useState<string>(newSmartCardOrderKey);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [orderResult, setOrderResult] = useState<SmartCardOrderResult | null>(null);

  /* my cards */
  const [profiles, setProfiles] = useState<SmartCardProfile[]>([]);
  const [orders, setOrders] = useState<SmartCardOrder[]>([]);
  const [mineState, setMineState] = useState<"loading" | "failed" | "ready">("loading");
  const [mineTick, setMineTick] = useState(0);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editLinks, setEditLinks] = useState<SmartCardLink[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadMine = async (): Promise<boolean> => {
    try {
      const [pRes, oRes] = await Promise.all([
        confirmedFetch("/api/nfc-cards/my-profiles", { skipConfirm: true }),
        confirmedFetch("/api/nfc-cards/orders", { skipConfirm: true }),
      ]);
      if (!pRes || !oRes) throw new Error("load");
      const parsedProfiles = parseSmartCardProfiles((await pRes.json().catch(() => null)) as unknown);
      const parsedOrders = parseSmartCardOrders((await oRes.json().catch(() => null)) as unknown);
      if (!pRes.ok || !oRes.ok || !parsedProfiles || !parsedOrders) throw new Error("load");
      setProfiles(parsedProfiles);
      setOrders(parsedOrders);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      setMineState("loading");
      const ok = await loadMine();
      if (!cancelled) setMineState(ok ? "ready" : "failed");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineTick, isGuest]);

  if (isGuest) {
    return (
      <NativeCard isLight={isLight}>
        <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
          {t("worldCommerceStands.cardsGuestBefore")}{" "}
          <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
            {t("worldCommerceStands.cardsSignIn")}
          </Link>{" "}
          {t("worldCommerceStands.cardsGuestAfter")}
        </p>
      </NativeCard>
    );
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const goldBtn =
    "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target disabled:hover:scale-100";
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

  const style = nfcStyleByKey(styleKey) ?? NFC_CARD_STYLES[0]!;
  const form = {
    cardStyle: styleKey, quantity, displayName, title, bio, links,
    fullName, email, phone, street, city, state: state_, zip,
  };
  const complete = smartCardOrderComplete(form);
  const totalCents = smartCardOrderTotalCents(style.priceCents, quantity);

  const placeOrder = async () => {
    if (!complete || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await confirmedFetch("/api/nfc-cards/order", {
        method: "POST",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSmartCardOrderPayload(form, orderKey)),
      });
      if (!res) throw new Error("order");
      const json: unknown = await res.json().catch(() => null);
      const result = parseSmartCardOrderResult(json);
      if (!res.ok || !result) {
        setFormError(((json as { error?: string } | null)?.error) ?? t("worldCommerceStands.cardsOrderFailed"));
        return;
      }
      setOrderResult(result);
      setOrderKey(newSmartCardOrderKey());
      void loadMine().then((ok) => { if (ok) setMineState("ready"); });
    } catch {
      setFormError(t("worldCommerceStands.cardsStandSilent"));
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (p: SmartCardProfile) => {
    setEditingSlug(p.slug);
    setEditName(p.displayName);
    setEditTitle(p.title);
    setEditBio(p.bio);
    setEditLinks(p.links.length > 0 ? p.links.map((l) => ({ ...l })) : [{ label: "", url: "" }]);
  };

  const saveEdit = async () => {
    if (!editingSlug || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await confirmedFetch(`/api/nfc-cards/profile/${editingSlug}`, {
        method: "PUT",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildSmartCardProfilePayload({ displayName: editName, title: editTitle, bio: editBio, links: editLinks }),
        ),
      });
      if (!res) throw new Error("save");
      const json: unknown = await res.json().catch(() => null);
      const updated = parseSmartCardProfile(json);
      if (!res.ok || !updated) throw new Error("save");
      setProfiles((ps) => ps.map((p) => (p.slug === updated.slug ? { ...p, ...updated } : p)));
      setEditingSlug(null);
    } catch {
      setFormError(t("worldCommerceStands.cardsSaveFailed"));
    } finally {
      setSavingEdit(false);
    }
  };

  const linkEditor = (
    rows: SmartCardLink[],
    setRows: (rows: SmartCardLink[]) => void,
    testidPrefix: string,
  ) => (
    <div className="space-y-2">
      {rows.map((l, i) => (
        <div key={i} className="flex gap-2">
          <input
            aria-label={t("worldCommerceStands.cardsLinkLabelAria", { n: i + 1 })}
            className={inputCls}
            value={l.label}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
            placeholder={t("worldCommerceStands.cardsLinkLabelPlaceholder")}
          />
          <input
            aria-label={t("worldCommerceStands.cardsLinkAddressAria", { n: i + 1 })}
            className={inputCls}
            value={l.url}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))}
            placeholder="https://…"
          />
          <button
            type="button"
            aria-label={t("worldCommerceStands.cardsRemoveLinkAria", { n: i + 1 })}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="shrink-0 rounded-full border border-white/15 p-2 text-white/50 transition hover:text-white bdv-touch-box"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {rows.length < SMART_CARD_MAX_LINKS ? (
        <button
          type="button"
          data-testid={`${testidPrefix}-add-link`}
          onClick={() => setRows([...rows, { label: "", url: "" }])}
          className={`inline-flex items-center gap-1.5 text-xs font-bold bdv-touch-target ${strong}`}
        >
          <Plus className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldCommerceStands.cardsAddLink")}
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="world-smart-cards-stand">
      {formError ? (
        <p className="px-1 text-xs font-semibold text-red-400" data-testid="world-smart-cards-error">{formError}</p>
      ) : null}

      <NativeCard isLight={isLight} title={t("worldCommerceStands.cardsStep1Title")}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {NFC_CARD_STYLES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStyleKey(s.key)}
                className={optBtn(styleKey === s.key)}
                data-testid={`world-smart-cards-style-${s.key}`}
              >
                <span className="mb-2 block h-10 rounded-lg" style={{ background: s.swatch }} />
                <span className="block">{s.label}</span>
                <span className={`mt-0.5 block text-xs font-normal ${muted}`}>{s.blurb}</span>
                <span className="mt-1 block font-bold text-[#d4af37]">{t("worldCommerceStands.cardsPerCard", { price: formatMoney(s.priceCents) })}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className={`text-sm font-semibold ${strong}`} htmlFor="world-smart-cards-qty">{t("worldCommerceStands.cardsHowMany")}</label>
            <input
              id="world-smart-cards-qty"
              aria-label={t("worldCommerceStands.cardsHowMany")}
              type="number"
              min={1}
              max={SMART_CARD_MAX_QUANTITY}
              className={`${inputCls} w-24 text-center`}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(SMART_CARD_MAX_QUANTITY, Number(e.target.value) || 1)))}
            />
          </div>
          <p className={`text-sm ${muted}`} data-testid="world-smart-cards-total">
            {t("worldCommerceStands.cardsReservationTotalBefore")} <span className={`font-bold ${strong}`}>{formatMoney(totalCents)}</span> {t("worldCommerceStands.cardsReservationTotalAfter")}
          </p>
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldCommerceStands.cardsStep2Title")}>
        <div className="space-y-2">
          <input aria-label={t("worldCommerceStands.cardsNameAria")} className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={t("worldCommerceStands.cardsNamePlaceholder")} />
          <input aria-label={t("worldCommerceStands.cardsTitleAria")} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("worldCommerceStands.cardsTitlePlaceholder")} />
          <textarea aria-label={t("worldCommerceStands.cardsBioAria")} className={inputCls} rows={2} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t("worldCommerceStands.cardsBioPlaceholder")} />
          {linkEditor(links, setLinks, "world-smart-cards")}
          <p className={`text-xs ${muted}`}>
            {t(smartCardValidLinks(links).length === 1 ? "worldCommerceStands.cardsLinksRideOne" : "worldCommerceStands.cardsLinksRideMany", { count: smartCardValidLinks(links).length })}
          </p>
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldCommerceStands.cardsStep3Title")}>
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label={t("worldCommerceStands.cardsFullNameAria")} className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("worldCommerceStands.cardsFullNamePlaceholder")} />
            <input aria-label={t("worldCommerceStands.cardsEmailAria")} className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("worldCommerceStands.cardsEmailPlaceholder")} />
          </div>
          <input aria-label={t("worldCommerceStands.cardsPhoneAria")} className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("worldCommerceStands.cardsPhonePlaceholder")} />
          <input aria-label={t("worldCommerceStands.cardsStreetAria")} className={inputCls} value={street} onChange={(e) => setStreet(e.target.value)} placeholder={t("worldCommerceStands.cardsStreetPlaceholder")} />
          <div className="grid grid-cols-3 gap-2">
            <input aria-label={t("worldCommerceStands.cardsCityAria")} className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder={t("worldCommerceStands.cardsCityPlaceholder")} />
            <input aria-label={t("worldCommerceStands.cardsStateAria")} className={inputCls} value={state_} onChange={(e) => setState_(e.target.value)} placeholder={t("worldCommerceStands.cardsStatePlaceholder")} />
            <input aria-label={t("worldCommerceStands.cardsZipAria")} className={inputCls} value={zip} onChange={(e) => setZip(e.target.value)} placeholder={t("worldCommerceStands.cardsZipPlaceholder")} />
          </div>
          <button
            type="button"
            data-testid="world-smart-cards-order"
            onClick={() => void placeOrder()}
            disabled={!complete || submitting}
            className={goldBtn}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Nfc className="h-4 w-4" />}
            {submitting ? t("worldCommerceStands.cardsReserving") : t(quantity === 1 ? "worldCommerceStands.cardsReserveOne" : "worldCommerceStands.cardsReserveMany", { qty: quantity, total: formatMoney(totalCents) })}
          </button>
          {!complete ? (
            <p className={`text-xs ${muted}`}>{t("worldCommerceStands.cardsIncompleteNote")}</p>
          ) : null}
          {orderResult ? (
            <div className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-3" data-testid="world-smart-cards-order-result">
              <p className={`inline-flex items-center gap-2 text-sm font-bold ${strong}`}>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                {orderResult.deduped ? t("worldCommerceStands.cardsDedupedTitle") : t("worldCommerceStands.cardsReceivedTitle")}
              </p>
              {orderResult.deduped ? (
                <p className={`mt-1 text-xs ${muted}`}>{t("worldCommerceStands.cardsDedupedNote")}</p>
              ) : (
                <>
                  <p className={`mt-1 text-xs ${muted}`}>
                    {orderResult.slugs.length > 1
                      ? t("worldCommerceStands.cardsReservedMany", { count: orderResult.slugs.length })
                      : t("worldCommerceStands.cardsReservedOne")}
                    <a href={orderResult.url} target="_blank" rel="noreferrer" className="font-bold text-[#d4af37] underline underline-offset-2">
                      {orderResult.url}
                    </a>
                  </p>
                  <img
                    src={smartCardQrPath(orderResult.slug)}
                    alt={t("worldCommerceStands.cardsQrAlt")}
                    className="mt-2 h-28 w-28 rounded-lg bg-white p-1.5"
                    data-testid="world-smart-cards-qr"
                  />
                </>
              )}
            </div>
          ) : null}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title={t("worldCommerceStands.cardsMineTitle")}>
        {mineState === "loading" ? (
          <NativeLoadingState isLight={isLight} message={t("worldCommerceStands.cardsFetching")} />
        ) : mineState === "failed" ? (
          <NativeErrorState
            isLight={isLight}
            message={t("worldCommerceStands.cardsLoadFailed")}
            onRetry={() => setMineTick((n) => n + 1)}
          />
        ) : profiles.length === 0 && orders.length === 0 ? (
          <p className={`text-sm ${muted}`}>{t("worldCommerceStands.cardsEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <div key={p.slug} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`} data-testid="world-smart-cards-profile">
                <div className="flex items-start gap-3">
                  <img src={smartCardQrPath(p.slug)} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-white p-1" />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-bold ${strong}`}>{p.displayName || p.slug}</p>
                    {p.title ? <p className={`truncate text-xs ${muted}`}>{p.title}</p> : null}
                    <p className={`mt-0.5 text-xs ${muted}`}>
                      {t(p.tapCount === 1 ? "worldCommerceStands.cardsTapOne" : "worldCommerceStands.cardsTapMany", { count: p.tapCount, state: p.isActive ? t("worldCommerceStands.cardsLive") : t("worldCommerceStands.cardsPaused") })}
                    </p>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#d4af37] underline underline-offset-2">
                        {t("worldCommerceStands.cardsOpenTapPage")}
                      </a>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    data-testid="world-smart-cards-edit"
                    onClick={() => (editingSlug === p.slug ? setEditingSlug(null) : startEdit(p))}
                    className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold bdv-touch-target ${strong}`}
                  >
                    <Pencil className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldCommerceStands.cardsEdit")}
                  </button>
                </div>
                {editingSlug === p.slug ? (
                  <div className="mt-3 space-y-2" data-testid="world-smart-cards-edit-form">
                    <input aria-label={t("worldCommerceStands.cardsEditNameAria")} className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("worldCommerceStands.cardsEditNamePlaceholder")} />
                    <input aria-label={t("worldCommerceStands.cardsEditTitleAria")} className={inputCls} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder={t("worldCommerceStands.cardsEditTitlePlaceholder")} />
                    <textarea aria-label={t("worldCommerceStands.cardsEditBioAria")} className={inputCls} rows={2} value={editBio} onChange={(e) => setEditBio(e.target.value)} placeholder={t("worldCommerceStands.cardsEditBioPlaceholder")} />
                    {linkEditor(editLinks, setEditLinks, "world-smart-cards-edit")}
                    <div className="flex gap-2">
                      <button type="button" data-testid="world-smart-cards-edit-save" onClick={() => void saveEdit()} disabled={savingEdit} className={goldBtn}>
                        {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {t("worldCommerceStands.cardsSaveBtn")}
                      </button>
                      <button type="button" onClick={() => setEditingSlug(null)} className={`inline-flex items-center gap-1.5 text-xs font-bold bdv-touch-target ${strong}`}>
                        <Minus className="h-3.5 w-3.5" /> {t("worldCommerceStands.cardsClose")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {orders.length > 0 ? (
              <div>
                <p className={`mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${muted}`}>
                  <QrCode className="h-3.5 w-3.5 text-[#d4af37]" /> {t("worldCommerceStands.cardsReservations")}
                </p>
                <div className="space-y-1.5">
                  {orders.map((o) => (
                    <div key={o.id} className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`} data-testid="world-smart-cards-order-row">
                      <span className={`text-sm ${strong}`}>
                        {nfcStyleByKey(o.cardStyle)?.label ?? o.cardStyle} × {o.quantity}
                      </span>
                      <span className={`text-xs ${muted}`}>{smartCardOrderStatusLabel(o.status)}</span>
                      <span className="text-sm font-bold text-[#d4af37]">{formatMoney(o.totalCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </NativeCard>
    </div>
  );
}
