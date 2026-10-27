import { useEffect, useState } from "react";
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
          The Smart Cards stand orders cards on your own account — guests can look around the
          palace, but this stand only opens for members.{" "}
          <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
            Sign in
          </Link>{" "}
          and the stand is yours, right here in the Atelier.
        </p>
      </NativeCard>
    );
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const goldBtn =
    "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100";
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
  const optBtn = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
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
        setFormError(((json as { error?: string } | null)?.error) ?? "The order couldn't be placed — try again.");
        return;
      }
      setOrderResult(result);
      setOrderKey(newSmartCardOrderKey());
      void loadMine().then((ok) => { if (ok) setMineState("ready"); });
    } catch {
      setFormError("The smart cards stand didn't answer. Try again.");
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
      setFormError("That card couldn't be saved — try again.");
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
            aria-label={`Link ${i + 1} label`}
            className={inputCls}
            value={l.label}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
            placeholder="Label — Instagram"
          />
          <input
            aria-label={`Link ${i + 1} address`}
            className={inputCls}
            value={l.url}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, url: e.target.value } : r)))}
            placeholder="https://…"
          />
          <button
            type="button"
            aria-label={`Remove link ${i + 1}`}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="shrink-0 rounded-full border border-white/15 p-2 text-white/50 transition hover:text-white"
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
          className={`inline-flex items-center gap-1.5 text-xs font-bold ${strong}`}
        >
          <Plus className="h-3.5 w-3.5 text-[#d4af37]" /> Add a link
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="world-smart-cards-stand">
      {formError ? (
        <p className="px-1 text-xs font-semibold text-red-400" data-testid="world-smart-cards-error">{formError}</p>
      ) : null}

      <NativeCard isLight={isLight} title="1 · Pick your card">
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
                <span className="mt-1 block font-bold text-[#d4af37]">{formatMoney(s.priceCents)} a card</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <label className={`text-sm font-semibold ${strong}`} htmlFor="world-smart-cards-qty">How many cards</label>
            <input
              id="world-smart-cards-qty"
              aria-label="How many cards"
              type="number"
              min={1}
              max={SMART_CARD_MAX_QUANTITY}
              className={`${inputCls} w-24 text-center`}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(SMART_CARD_MAX_QUANTITY, Number(e.target.value) || 1)))}
            />
          </div>
          <p className={`text-sm ${muted}`} data-testid="world-smart-cards-total">
            Reservation total <span className={`font-bold ${strong}`}>{formatMoney(totalCents)}</span> — an order here is a
            reservation: payment is collected when production is confirmed with the supplier, never before.
          </p>
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title="2 · What the tap shows">
        <div className="space-y-2">
          <input aria-label="Name on the card" className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name on the card *" />
          <input aria-label="Title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title — Artist · Producer" />
          <textarea aria-label="Short bio" className={inputCls} rows={2} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Short bio (optional)" />
          {linkEditor(links, setLinks, "world-smart-cards")}
          <p className={`text-xs ${muted}`}>
            {smartCardValidLinks(links).length} link{smartCardValidLinks(links).length === 1 ? "" : "s"} will ride the card —
            every card in the order gets its own tap link to this same card page.
          </p>
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title="3 · Where they ship">
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label="Full name" className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name *" />
            <input aria-label="Email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" />
          </div>
          <input aria-label="Phone (optional)" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" />
          <input aria-label="Street address" className={inputCls} value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Street address *" />
          <div className="grid grid-cols-3 gap-2">
            <input aria-label="City" className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City *" />
            <input aria-label="State" className={inputCls} value={state_} onChange={(e) => setState_(e.target.value)} placeholder="State *" />
            <input aria-label="ZIP" className={inputCls} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP *" />
          </div>
          <button
            type="button"
            data-testid="world-smart-cards-order"
            onClick={() => void placeOrder()}
            disabled={!complete || submitting}
            className={goldBtn}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Nfc className="h-4 w-4" />}
            {submitting ? "Reserving…" : `Reserve ${quantity} card${quantity === 1 ? "" : "s"} — ${formatMoney(totalCents)}`}
          </button>
          {!complete ? (
            <p className={`text-xs ${muted}`}>Add the card's name and a complete shipping address — the stand reserves nothing half-written.</p>
          ) : null}
          {orderResult ? (
            <div className="rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-3" data-testid="world-smart-cards-order-result">
              <p className={`inline-flex items-center gap-2 text-sm font-bold ${strong}`}>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                {orderResult.deduped ? "That reservation already stands" : "Reservation received"}
              </p>
              {orderResult.deduped ? (
                <p className={`mt-1 text-xs ${muted}`}>A retried tap returned your standing order — nothing was double-booked.</p>
              ) : (
                <>
                  <p className={`mt-1 text-xs ${muted}`}>
                    {orderResult.slugs.length > 1
                      ? `${orderResult.slugs.length} cards reserved, each with its own tap link. The first card: `
                      : "Your card's tap page is live: "}
                    <a href={orderResult.url} target="_blank" rel="noreferrer" className="font-bold text-[#d4af37] underline underline-offset-2">
                      {orderResult.url}
                    </a>
                  </p>
                  <img
                    src={smartCardQrPath(orderResult.slug)}
                    alt="The tap QR for your card"
                    className="mt-2 h-28 w-28 rounded-lg bg-white p-1.5"
                    data-testid="world-smart-cards-qr"
                  />
                </>
              )}
            </div>
          ) : null}
        </div>
      </NativeCard>

      <NativeCard isLight={isLight} title="My smart cards">
        {mineState === "loading" ? (
          <NativeLoadingState isLight={isLight} message="Fetching your cards…" />
        ) : mineState === "failed" ? (
          <NativeErrorState
            isLight={isLight}
            message="Your cards wouldn't load — they're safe on the real rails."
            onRetry={() => setMineTick((n) => n + 1)}
          />
        ) : profiles.length === 0 && orders.length === 0 ? (
          <p className={`text-sm ${muted}`}>No cards yet — reserve your first above and it stands here.</p>
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
                      {p.tapCount} tap{p.tapCount === 1 ? "" : "s"} · {p.isActive ? "live" : "paused"}
                    </p>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#d4af37] underline underline-offset-2">
                        Open the tap page
                      </a>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    data-testid="world-smart-cards-edit"
                    onClick={() => (editingSlug === p.slug ? setEditingSlug(null) : startEdit(p))}
                    className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-bold ${strong}`}
                  >
                    <Pencil className="h-3.5 w-3.5 text-[#d4af37]" /> Edit
                  </button>
                </div>
                {editingSlug === p.slug ? (
                  <div className="mt-3 space-y-2" data-testid="world-smart-cards-edit-form">
                    <input aria-label="Edit name" className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name on the card" />
                    <input aria-label="Edit title" className={inputCls} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" />
                    <textarea aria-label="Edit bio" className={inputCls} rows={2} value={editBio} onChange={(e) => setEditBio(e.target.value)} placeholder="Short bio" />
                    {linkEditor(editLinks, setEditLinks, "world-smart-cards-edit")}
                    <div className="flex gap-2">
                      <button type="button" data-testid="world-smart-cards-edit-save" onClick={() => void saveEdit()} disabled={savingEdit} className={goldBtn}>
                        {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save the card
                      </button>
                      <button type="button" onClick={() => setEditingSlug(null)} className={`inline-flex items-center gap-1.5 text-xs font-bold ${strong}`}>
                        <Minus className="h-3.5 w-3.5" /> Close
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            {orders.length > 0 ? (
              <div>
                <p className={`mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${muted}`}>
                  <QrCode className="h-3.5 w-3.5 text-[#d4af37]" /> Reservations
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
