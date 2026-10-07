import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Gem, Loader2, ChevronRight, ChevronLeft, CheckCircle2,
  ShieldCheck, CreditCard, Sparkles, Palette,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import {
  JEWELRY_PRODUCTS, JEWELRY_FINISHES, jewelryProductByKey, formatMoney,
} from "@/lib/jewelry";

/* ─── Custom Jewelry Shop ───────────────────────────────────────────────
   Made-to-order branded jewelry (dropship).
   v1 HONESTY CONTRACT: reservations only — no charge today. Payment is
   collected when production is confirmed with the manufacturer.
   Pairs with the Logo-to-Luxury studio at /jewelry for custom designs. */

type Step = "piece" | "customize" | "shipping" | "review";

interface JewelryOrder {
  id: string;
  product_key: string;
  finish: string;
  size_option: string;
  engraving: string | null;
  quantity: number;
  status: string;
  total_cents: number;
  created_at: string;
}

export default function JewelryShop() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [step, setStep] = useState<Step>("piece");
  const [productKey, setProductKey] = useState(JEWELRY_PRODUCTS[0].key);
  const [finish, setFinish] = useState(JEWELRY_FINISHES[0].key);
  const [sizeOption, setSizeOption] = useState(JEWELRY_PRODUCTS[0].sizes[1]);
  const [engraving, setEngraving] = useState("");
  const [designNotes, setDesignNotes] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state_, setState_] = useState("");
  const [zip, setZip] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState("");

  const [orders, setOrders] = useState<JewelryOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const product = jewelryProductByKey(productKey)!;
  const total = product.priceCents * quantity;

  const loadOrders = async () => {
    if (!user) return;
    setLoadingOrders(true);
    try {
      const res = await confirmedFetch("/api/jewelry/orders", { skipConfirm: true });
      if (res) {
        const j = await res.json();
        if (j.ok) setOrders(j.orders);
      }
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => { void loadOrders(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const pickProduct = (key: string) => {
    setProductKey(key);
    const p = jewelryProductByKey(key)!;
    setSizeOption(p.sizes[1] ?? p.sizes[0]);
  };

  const canNext = (): boolean => {
    if (step === "piece") return true;
    if (step === "customize") return sizeOption.length > 0;
    if (step === "shipping")
      return fullName.trim().length > 0 && /.+@.+\..+/.test(email) && street.trim().length > 0 &&
        city.trim().length > 0 && state_.trim().length > 0 && zip.trim().length > 0;
    return true;
  };

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    setFormError("");
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await confirmedFetch("/api/jewelry/order", {
        method: "POST",
        skipConfirm: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productKey, finish, sizeOption,
          engraving: engraving.trim(), designNotes: designNotes.trim(),
          quantity,
          fullName: fullName.trim(), email: email.trim(), phone: phone.trim(),
          shippingAddress: { street, city, state: state_, zip, country: "USA" },
          idempotencyKey,
        }),
      });
      const json = await res!.json();
      if (!json.ok) throw new Error(json.error || t("jewelryShop.reservationFailed"));
      setDone(true);
      void loadOrders();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("jewelryShop.reservationFailedRetry"));
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-white placeholder-zinc-600 focus:border-amber-500/60 focus:outline-none";

  return (
    <div className="min-h-screen bg-black text-white">
      {/* hero */}
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(800px 400px at 50% 0%, rgba(212,175,55,0.15), transparent 70%)" }}
        />
        <div className="relative max-w-5xl mx-auto px-5 pt-16 pb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-400/10 px-4 py-1.5 text-amber-300 text-sm mb-6">
            <Gem className="w-4 h-4" /> {t("jewelryShop.heroBadge")}
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight">
            {t("jewelryShop.heroTitle1")}<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-600">
              {t("jewelryShop.heroTitle2")}
            </span>
          </h1>
          <p className="mt-5 text-zinc-400 text-lg max-w-2xl mx-auto">
            {t("jewelryShop.heroDesc")}
          </p>
          <Link
            href="/jewelry"
            className="mt-6 inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-400/10 px-5 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20"
          >
            <Palette className="w-4 h-4" /> {t("jewelryShop.studioLink")}
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-5 pb-20">
        <div className="rounded-3xl border border-amber-500/25 bg-gradient-to-b from-zinc-900 to-black p-6 md:p-10">
          {done ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto mb-4" />
              <h2 className="text-3xl font-bold">{t("jewelryShop.reserved")}</h2>
              <p className="text-zinc-400 mt-3 max-w-lg mx-auto">
                {t("jewelryShop.reservedDesc")}
              </p>
              <button
                onClick={() => { setDone(false); setStep("piece"); }}
                className="mt-6 text-amber-400 hover:text-amber-300 text-sm"
              >
                {t("jewelryShop.reserveAnother")}
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold">{t("jewelryShop.designTitle")}</h2>
                <div className="flex gap-1 text-xs">
                  {(["piece", "customize", "shipping", "review"] as Step[]).map((s, i) => (
                    <div key={s} className="flex items-center">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold ${
                        step === s ? "bg-amber-400 text-black" :
                        (["piece", "customize", "shipping", "review"].indexOf(step) > i ? "bg-amber-400/30 text-amber-300" : "bg-zinc-800 text-zinc-500")
                      }`}>{i + 1}</div>
                      {i < 3 && <div className="w-4 h-px bg-zinc-800" />}
                    </div>
                  ))}
                </div>
              </div>

              {step === "piece" && (
                <div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {JEWELRY_PRODUCTS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => pickProduct(p.key)}
                        className={`rounded-2xl border p-5 text-left transition ${
                          productKey === p.key ? "border-amber-400 bg-amber-400/5" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                        }`}
                      >
                        <div className="h-24 rounded-xl mb-4 border border-white/10 flex items-center justify-center" style={{ background: p.swatch }}>
                          <Gem className="w-10 h-10 text-black/60" />
                        </div>
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">{p.label}</h3>
                          <span className="text-amber-300 font-bold">{formatMoney(p.priceCents)}</span>
                        </div>
                        <p className="text-sm text-zinc-400 mt-1">{p.blurb}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === "customize" && (
                <div className="space-y-6 max-w-xl">
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">{t("jewelryShop.finish")}</label>
                    <div className="grid grid-cols-3 gap-3">
                      {JEWELRY_FINISHES.map((f) => (
                        <button
                          key={f.key}
                          onClick={() => setFinish(f.key)}
                          className={`rounded-xl border p-3 text-center transition ${
                            finish === f.key ? "border-amber-400 bg-amber-400/5" : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                          }`}
                        >
                          <div className="h-10 rounded-lg mb-2 border border-white/10" style={{ background: f.swatch }} />
                          <span className="text-xs font-medium">{f.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">{product.sizeLabel}</label>
                    <div className="flex flex-wrap gap-2">
                      {product.sizes.map((s) => (
                        <button
                          key={s}
                          onClick={() => setSizeOption(s)}
                          className={`rounded-lg border px-4 py-2 text-sm transition ${
                            sizeOption === s ? "border-amber-400 bg-amber-400/10 text-amber-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">{t("jewelryShop.engraving")} <span className="text-zinc-600">{t("jewelryShop.engravingNote")}</span></label>
                    <input className={inputCls} placeholder={t("jewelryShop.engravingPh")} value={engraving}
                      maxLength={60} onChange={(e) => setEngraving(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">{t("jewelryShop.designNotes")} <span className="text-zinc-600">{t("jewelryShop.designNotesNote")}</span></label>
                    <textarea className={inputCls} rows={3}
                      placeholder={t("jewelryShop.designNotesPh")}
                      value={designNotes} onChange={(e) => setDesignNotes(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-zinc-400">{t("jewelryShop.quantity")}</label>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-9 h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xl">−</button>
                      <span className="w-8 text-center font-bold">{quantity}</span>
                      <button onClick={() => setQuantity(Math.min(20, quantity + 1))} className="w-9 h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xl">+</button>
                    </div>
                    <span className="ml-auto text-lg">{t("jewelryShop.total")} <span className="text-amber-300 font-bold">{formatMoney(total)}</span></span>
                  </div>
                </div>
              )}

              {step === "shipping" && (
                <div className="space-y-4 max-w-xl">
                  <div className="grid grid-cols-2 gap-4">
                    <input className={inputCls} placeholder={t("jewelryShop.fullNamePh")} value={fullName} onChange={(e) => setFullName(e.target.value)} />
                    <input className={inputCls} placeholder={t("jewelryShop.phonePh")} value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                  <input className={inputCls} placeholder={t("jewelryShop.emailPh")} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  <input className={inputCls} placeholder={t("jewelryShop.streetPh")} value={street} onChange={(e) => setStreet(e.target.value)} />
                  <div className="grid grid-cols-3 gap-4">
                    <input className={inputCls} placeholder={t("jewelryShop.cityPh")} value={city} onChange={(e) => setCity(e.target.value)} />
                    <input className={inputCls} placeholder={t("jewelryShop.statePh")} value={state_} onChange={(e) => setState_(e.target.value)} />
                    <input className={inputCls} placeholder={t("jewelryShop.zipPh")} value={zip} onChange={(e) => setZip(e.target.value)} />
                  </div>
                  <p className="text-xs text-zinc-500 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    {t("jewelryShop.detailsNote")}
                  </p>
                </div>
              )}

              {step === "review" && (
                <div className="max-w-xl space-y-4">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-zinc-400">{t("jewelryShop.reviewPiece")}</span><span className="font-medium">{product.label}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">{t("jewelryShop.reviewFinish")}</span><span className="font-medium">{JEWELRY_FINISHES.find((f) => f.key === finish)?.label}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">{product.sizeLabel}</span><span className="font-medium">{sizeOption}</span></div>
                    {engraving.trim() && <div className="flex justify-between"><span className="text-zinc-400">{t("jewelryShop.reviewEngraving")}</span><span className="font-medium">“{engraving.trim()}”</span></div>}
                    <div className="flex justify-between"><span className="text-zinc-400">{t("jewelryShop.reviewQuantity")}</span><span className="font-medium">{quantity}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">{t("jewelryShop.reviewShipTo")}</span><span className="font-medium text-right">{fullName}<br />{street}, {city}, {state_} {zip}</span></div>
                    <div className="flex justify-between pt-2 border-t border-zinc-800">
                      <span className="text-zinc-400">{t("jewelryShop.reviewTotal")}</span>
                      <span className="text-amber-300 font-bold text-lg">{formatMoney(total)}</span>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-400 flex items-start gap-2">
                    <CreditCard className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" />
                    {t("jewelryShop.reserveNote")}
                  </p>
                  {formError && <p className="text-red-400 text-sm">{formError}</p>}
                </div>
              )}

              <div className="mt-8 flex items-center justify-between">
                <button
                  onClick={() => setStep({ piece: "piece", customize: "piece", shipping: "customize", review: "shipping" }[step] as Step)}
                  disabled={step === "piece"}
                  className="flex items-center gap-1 text-zinc-400 hover:text-white disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" /> {t("jewelryShop.back")}
                </button>
                {step !== "review" ? (
                  <button
                    onClick={() => {
                      if (!user) { window.location.href = "/login"; return; }
                      setStep({ piece: "customize", customize: "shipping", shipping: "review", review: "review" }[step] as Step);
                    }}
                    disabled={!canNext()}
                    className="flex items-center gap-1 rounded-xl bg-amber-400 text-black font-semibold px-6 py-3 hover:bg-amber-300 disabled:opacity-40"
                  >
                    {t("jewelryShop.continue")} <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={submitting || !user}
                    className="flex items-center gap-2 rounded-xl bg-amber-400 text-black font-semibold px-8 py-3 hover:bg-amber-300 disabled:opacity-40"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {submitting ? t("jewelryShop.reserving") : t("jewelryShop.reserveFree")}
                  </button>
                )}
              </div>
              {!user && (
                <p className="mt-4 text-center text-sm text-zinc-500">
                  {t("jewelryShop.signInPrefix")}<Link href="/login" className="text-amber-400 hover:text-amber-300">{t("jewelryShop.signIn")}</Link>{t("jewelryShop.signInSuffix")}
                </p>
              )}
            </>
          )}
        </div>

        {/* my reservations */}
        {user && orders.length > 0 && (
          <div className="mt-10">
            <h2 className="text-2xl font-bold mb-4">{t("jewelryShop.myReservations")}</h2>
            {loadingOrders ? (
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm">
                    <span>{jewelryProductByKey(o.product_key)?.label ?? o.product_key} · {o.size_option} × {o.quantity}</span>
                    <span className="text-zinc-400">{formatMoney(o.total_cents)}</span>
                    <span className="text-xs px-2 py-1 rounded-full bg-amber-400/10 text-amber-300">
                      {o.status.replace("_", " ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
