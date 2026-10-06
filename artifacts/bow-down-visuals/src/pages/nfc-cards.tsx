import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Nfc, QrCode, Zap, Pencil, Truck, CheckCircle2, Loader2,
  ChevronRight, ChevronLeft, Plus, Trash2, Download, BarChart3,
  ShieldCheck, Sparkles, CreditCard,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  NFC_CARD_STYLES, nfcStyleByKey, formatMoney,
  type NfcLink, type NfcProfile,
} from "@/lib/nfc-cards";

/* ─── NFC Smart Business Cards ──────────────────────────────────────────
   Product page + order wizard + buyer card management.

   v1 HONESTY CONTRACT: orders are captured as reservations with status
   "received" — payment is collected when production is confirmed with the
   chosen supplier. No shipped/delivered fiction anywhere. */

type Step = "style" | "details" | "shipping" | "review";

interface MyOrder {
  id: string;
  card_style: string;
  quantity: number;
  status: string;
  total_cents: number;
  created_at: string;
  nfc_profiles: { slug: string } | null;
}

const FAQS = [
  {
    q: "How does the tap work?",
    a: "Every card has an NTAG213 NFC chip inside. Tap it against any modern phone and your digital card opens instantly — no app needed. Older phones can scan the QR printed on the back instead.",
  },
  {
    q: "Can I change my links after ordering?",
    a: "Yes — that's the whole point. Your card points to your digital profile, which you can edit anytime: links, title, bio, photo. The physical card never goes out of date.",
  },
  {
    q: "When do I pay?",
    a: "You reserve today with no charge. Once we confirm your card with our production partner, we'll collect payment and your card ships straight to you.",
  },
  {
    q: "How long until I get my card?",
    a: "Cards are made to order. Expect production plus shipping to take 2–3 weeks once payment is confirmed. We'll keep you posted at every step.",
  },
  {
    q: "Can I reorder or get cards for my team?",
    a: "Yes — order any quantity, and each card gets its own digital profile. Team packs are perfect for realtors, barbershops, salons, and agencies.",
  },
];

export default function NfcCards() {
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  /* order wizard state */
  const [step, setStep] = useState<Step>("style");
  const [styleKey, setStyleKey] = useState(NFC_CARD_STYLES[0].key);
  const [quantity, setQuantity] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<NfcLink[]>([{ label: "", url: "" }]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state_, setState_] = useState("");
  const [zip, setZip] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState<{ slug: string; url: string; deduped?: boolean } | null>(null);
  const [formError, setFormError] = useState("");
  /* One idempotency key per wizard session — a failed-then-retried submit
     must reuse the same key so the server dedupes instead of double-booking.
     Regenerated after each successful order for the next one. */
  const genOrderKey = () =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [orderKey, setOrderKey] = useState<string>(genOrderKey);

  /* my cards */
  const [profiles, setProfiles] = useState<NfcProfile[]>([]);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [editing, setEditing] = useState<NfcProfile | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const style = nfcStyleByKey(styleKey)!;
  const total = style.priceCents * quantity;

  const loadMine = async () => {
    if (!user) return;
    setLoadingMine(true);
    try {
      const [pRes, oRes] = await Promise.all([
        confirmedFetch("/api/nfc-cards/my-profiles", { skipConfirm: true }),
        confirmedFetch("/api/nfc-cards/orders", { skipConfirm: true }),
      ]);
      if (pRes) {
        const j = await pRes.json();
        if (j.ok) setProfiles(j.profiles);
      }
      if (oRes) {
        const j = await oRes.json();
        if (j.ok) setOrders(j.orders);
      }
    } finally {
      setLoadingMine(false);
    }
  };

  useEffect(() => { loadMine(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const validLinks = links.filter((l) => l.label.trim() && l.url.trim());

  const canNext = (): boolean => {
    if (step === "style") return true;
    if (step === "details") return displayName.trim().length > 0;
    if (step === "shipping")
      return fullName.trim().length > 0 && /.+@.+\..+/.test(email) && street.trim().length > 0 &&
        city.trim().length > 0 && state_.trim().length > 0 && zip.trim().length > 0;
    return true;
  };

  const submitOrder = async () => {
    if (!user) return;
    setSubmitting(true);
    setFormError("");
    try {
      const res = await confirmedFetch("/api/nfc-cards/order", {
        method: "POST",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardStyle: styleKey,
          quantity,
          displayName: displayName.trim(),
          title: title.trim(),
          bio: bio.trim(),
          links: validLinks,
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          shippingAddress: { street, city, state: state_, zip, country: "USA" },
          idempotencyKey: orderKey,
        }),
      });
      const json = await res!.json();
      if (!json.ok) throw new Error(json.error || "Order failed");
      if (json.profile) {
        setOrderResult({ slug: json.profile.slug, url: json.profile.url });
      } else {
        // Deduplicated retry: the order already exists, so no duplicate was
        // created — confirm without a card link (server omits profile here).
        setOrderResult({ slug: "", url: "", deduped: true });
      }
      setOrderKey(genOrderKey());
      loadMine();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Order failed — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const res = await confirmedFetch(`/api/nfc-cards/profile/${editing.slug}`, {
        method: "PUT",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: editing.display_name,
          title: editing.title ?? "",
          bio: editing.bio ?? "",
          links: editing.links,
        }),
      });
      const json = await res!.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setProfiles((ps) => ps.map((p) => (p.slug === editing.slug ? { ...p, ...json.profile } : p)));
      setEditing(null);
    } finally {
      setSavingEdit(false);
    }
  };

  const inputCls =
    "w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-white placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none";

  return (
    <div className="min-h-screen bg-black text-white">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(800px 400px at 50% 0%, rgba(212,175,55,0.15), transparent 70%)" }}
        />
        <div className="relative max-w-5xl mx-auto px-5 pt-16 pb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-400/10 px-4 py-1.5 text-amber-300 text-sm mb-6">
            <Nfc className="w-4 h-4" /> NFC Smart Business Cards
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight">
            Your business card,<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-600">
              but it taps.
            </span>
          </h1>
          <p className="mt-5 text-zinc-400 text-lg max-w-2xl mx-auto">
            A premium physical card with an NFC chip inside. Tap it on any phone
            and your digital card opens instantly — links, booking, socials,
            everything. Update it anytime without reprinting.
          </p>

          {/* how it works */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            {[
              { icon: Pencil, t: "1. Design your card", d: "Pick a style, add your name, links and photo." },
              { icon: Zap, t: "2. We encode it", d: "Your NFC chip + QR are programmed to your digital card." },
              { icon: Truck, t: "3. Tap & connect", d: "Ships to you. Tap phones, scan QRs, land clients." },
            ].map((s, i) => (
              <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                <s.icon className="w-6 h-6 text-amber-400 mb-3" />
                <h3 className="font-semibold">{s.t}</h3>
                <p className="text-sm text-zinc-400 mt-1">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 pb-20">
        {/* ── Order wizard ── */}
        <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-b from-zinc-900 to-black p-6 md:p-10">
          {orderResult ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
              <h2 className="text-3xl font-bold">Card reserved!</h2>
              <p className="text-zinc-400 mt-3 max-w-lg mx-auto">
                Your digital card is already live. We'll reach out to confirm
                production and collect payment — nothing charged today.
              </p>
              {orderResult.url ? (
                <a
                  href={orderResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-6 rounded-xl bg-amber-400 text-black font-semibold px-6 py-3 hover:bg-amber-300"
                >
                  View your digital card <ChevronRight className="w-4 h-4" />
                </a>
              ) : (
                <p className="text-sm text-zinc-500 mt-6 max-w-md mx-auto">
                  This reservation was already placed — no duplicate was created.
                </p>
              )}
              <div className="mt-4">
                <button
                  onClick={() => { setOrderResult(null); setStep("style"); }}
                  className="text-amber-400 hover:text-amber-300 text-sm"
                >
                  Order another card
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold">Build your card</h2>
                <div className="flex gap-1 text-xs">
                  {(["style", "details", "shipping", "review"] as Step[]).map((s, i) => (
                    <div key={s} className="flex items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold ${
                        step === s ? "bg-amber-400 text-black" :
                        (["style", "details", "shipping", "review"].indexOf(step) > i ? "bg-amber-400/30 text-amber-300" : "bg-zinc-800 text-zinc-500")
                      }`}>{i + 1}</div>
                      {i < 3 && <div className="w-4 h-px bg-zinc-800" />}
                    </div>
                  ))}
                </div>
              </div>

              {step === "style" && (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {NFC_CARD_STYLES.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setStyleKey(s.key)}
                        className={`rounded-2xl border p-5 text-left transition ${
                          styleKey === s.key ? "border-amber-400 bg-amber-400/5" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                        }`}
                      >
                        <div className="h-20 rounded-xl mb-4 border border-white/10" style={{ background: s.swatch }} />
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">{s.label}</h3>
                          <span className="text-amber-300 font-bold">{formatMoney(s.priceCents)}</span>
                        </div>
                        <p className="text-sm text-zinc-400 mt-1">{s.blurb}</p>
                      </button>
                    ))}
                  </div>
                  <div className="mt-6 flex items-center gap-4">
                    <label className="text-sm text-zinc-400">Quantity</label>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-9 h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xl">−</button>
                      <span className="w-8 text-center font-bold">{quantity}</span>
                      <button onClick={() => setQuantity(Math.min(100, quantity + 1))} className="w-9 h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xl">+</button>
                    </div>
                    <span className="ml-auto text-lg">Total: <span className="text-amber-300 font-bold">{formatMoney(total)}</span></span>
                  </div>
                </div>
              )}

              {step === "details" && (
                <div className="space-y-4 max-w-xl">
                  <p className="text-zinc-400 text-sm">This is what people see when they tap your card. You can edit it anytime.</p>
                  <input className={inputCls} placeholder="Display name *" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  <input className={inputCls} placeholder="Title — e.g. Realtor, Barber, Photographer" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <textarea className={inputCls} rows={3} placeholder="Short bio" value={bio} onChange={(e) => setBio(e.target.value)} />
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">Links (Instagram, booking, website…)</label>
                    {links.map((l, i) => (
                      <div key={i} className="flex gap-2 mb-2">
                        <input className={inputCls} placeholder="Label" value={l.label} onChange={(e) => setLinks(links.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                        <input className={inputCls} placeholder="https://…" value={l.url} onChange={(e) => setLinks(links.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
                        <button onClick={() => setLinks(links.filter((_, j) => j !== i))} className="px-3 text-zinc-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                    {links.length < 12 && (
                      <button onClick={() => setLinks([...links, { label: "", url: "" }])} className="text-amber-400 text-sm flex items-center gap-1 hover:text-amber-300">
                        <Plus className="w-4 h-4" /> Add link
                      </button>
                    )}
                  </div>
                </div>
              )}

              {step === "shipping" && (
                <div className="space-y-4 max-w-xl">
                  <div className="grid grid-cols-2 gap-4">
                    <input className={inputCls} placeholder="Full name *" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    <input className={inputCls} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <input className={inputCls} placeholder="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <input className={inputCls} placeholder="Street address *" value={street} onChange={(e) => setStreet(e.target.value)} />
                  <div className="grid grid-cols-3 gap-4">
                    <input className={inputCls} placeholder="City *" value={city} onChange={(e) => setCity(e.target.value)} />
                    <input className={inputCls} placeholder="State *" value={state_} onChange={(e) => setState_(e.target.value)} />
                    <input className={inputCls} placeholder="ZIP *" value={zip} onChange={(e) => setZip(e.target.value)} />
                  </div>
                  <p className="text-xs text-zinc-500 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Your details are only used to make and ship your card.
                  </p>
                </div>
              )}

              {step === "review" && (
                <div className="max-w-xl space-y-4">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-zinc-400">Style</span><span className="font-medium">{style.label}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Quantity</span><span className="font-medium">{quantity}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Digital card for</span><span className="font-medium">{displayName}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">Ship to</span><span className="font-medium text-right">{fullName}<br />{street}, {city}, {state_} {zip}</span></div>
                    <div className="flex justify-between pt-2 border-t border-zinc-800">
                      <span className="text-zinc-400">Total due at confirmation</span>
                      <span className="text-amber-300 font-bold text-lg">{formatMoney(total)}</span>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-400 flex items-start gap-2">
                    <CreditCard className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
                    Reserving is free — nothing is charged today. We'll confirm your
                    card with our production partner, then collect payment before it ships.
                  </p>
                  {formError && <p className="text-red-400 text-sm">{formError}</p>}
                </div>
              )}

              {/* nav */}
              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={() => setStep({ style: "style", details: "style", shipping: "details", review: "shipping" }[step] as Step)}
                  disabled={step === "style"}
                  className="flex items-center gap-1 text-zinc-400 hover:text-white disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                {step !== "review" ? (
                  <button
                    onClick={() => {
                      if (!user) { window.location.href = "/login"; return; }
                      setStep({ style: "details", details: "shipping", shipping: "review", review: "review" }[step] as Step);
                    }}
                    disabled={!canNext()}
                    className="flex items-center gap-1 rounded-xl bg-amber-400 text-black font-semibold px-6 py-3 hover:bg-amber-300 disabled:opacity-40"
                  >
                    Continue <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={submitOrder}
                    disabled={submitting || !user}
                    className="flex items-center gap-2 rounded-xl bg-amber-400 text-black font-semibold px-8 py-3 hover:bg-amber-300 disabled:opacity-40"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {submitting ? "Reserving…" : "Reserve my card — free"}
                  </button>
                )}
              </div>
              {!user && (
                <p className="mt-4 text-center text-sm text-zinc-500">
                  You'll be asked to <Link href="/login" className="text-amber-400 hover:text-amber-300">sign in</Link> to reserve your card.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── My cards ── */}
        {user && (
          <div className="mt-10">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Nfc className="w-6 h-6 text-amber-400" /> My smart cards
            </h2>
            {loadingMine ? (
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
            ) : profiles.length === 0 && orders.length === 0 ? (
              <p className="text-zinc-500">No cards yet — build your first one above.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {profiles.map((p) => (
                  <div key={p.slug} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{p.display_name}</h3>
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-amber-400/90 text-sm hover:text-amber-300">
                          bowdownvisuals.com/c/{p.slug}
                        </a>
                        <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" /> {p.tap_count} taps
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => setEditing({ ...p, links: [...p.links] })}
                        className="text-xs rounded-lg border border-zinc-700 px-3 py-2 hover:border-amber-500/50 flex items-center gap-1">
                        <Pencil className="w-3 h-3" /> Edit card
                      </button>
                      <a href={`/api/nfc-cards/qr/${p.slug}.svg`} download={`${p.slug}-qr.svg`}
                        className="text-xs rounded-lg border border-zinc-700 px-3 py-2 hover:border-amber-500/50 flex items-center gap-1">
                        <Download className="w-3 h-3" /> QR SVG
                      </a>
                      <a href={p.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs rounded-lg border border-zinc-700 px-3 py-2 hover:border-amber-500/50 flex items-center gap-1">
                        <QrCode className="w-3 h-3" /> Preview
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {orders.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold mb-2 text-zinc-300">Order history</h3>
                <div className="space-y-2">
                  {orders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm">
                      <span>{nfcStyleByKey(o.card_style)?.label ?? o.card_style} × {o.quantity}</span>
                      <span className="text-zinc-400">{formatMoney(o.total_cents)}</span>
                      <span className={`text-xs px-2 py-1 rounded-full ${o.status === "received" ? "bg-amber-400/10 text-amber-300" : "bg-zinc-800 text-zinc-300"}`}>
                        {o.status.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── FAQ ── */}
        <div className="mt-14">
          <h2 className="text-2xl font-bold mb-5">Questions</h2>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 px-5 py-4 group">
                <summary className="font-medium cursor-pointer list-none flex justify-between items-center">
                  {f.q}
                  <ChevronRight className="w-4 h-4 text-zinc-500 group-open:rotate-90 transition" />
                </summary>
                <p className="text-sm text-zinc-400 mt-2 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* ── Edit drawer ── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold">Edit digital card</h3>
            <input className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3" value={editing.display_name}
              onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} placeholder="Display name" />
            <input className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3" value={editing.title ?? ""}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Title" />
            <textarea className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3" rows={2} value={editing.bio ?? ""}
              onChange={(e) => setEditing({ ...editing, bio: e.target.value })} placeholder="Bio" />
            {editing.links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2 text-sm" value={l.label}
                  onChange={(e) => setEditing({ ...editing, links: editing.links.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} placeholder="Label" />
                <input className="w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-2 text-sm" value={l.url}
                  onChange={(e) => setEditing({ ...editing, links: editing.links.map((x, j) => j === i ? { ...x, url: e.target.value } : x) })} placeholder="https://…" />
                <button onClick={() => setEditing({ ...editing, links: editing.links.filter((_, j) => j !== i) })}
                  className="text-zinc-500 hover:text-red-400 px-2"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            {editing.links.length < 12 && (
              <button onClick={() => setEditing({ ...editing, links: [...editing.links, { label: "", url: "" }] })}
                className="text-amber-400 text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> Add link</button>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditing(null)} className="px-5 py-2.5 rounded-xl border border-zinc-700 text-zinc-300">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className="px-5 py-2.5 rounded-xl bg-amber-400 text-black font-semibold disabled:opacity-50 flex items-center gap-2">
                {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
