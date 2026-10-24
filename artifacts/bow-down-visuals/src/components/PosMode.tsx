import { useEffect, useMemo, useRef, useState } from "react";
import {
  QrCode, Link2, Copy, Check, Loader2, Minus, Plus, Banknote,
  ShoppingBag, X, BadgeCheck, Info,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { centsToDisplay } from "@/lib/shops";
import { QRCodeImage } from "@/components/QRCode";

/* ─── Sell in person (POS mode) — Stack-100 #3, item #28 ────────────────
   A mode inside My Shop, never a standalone page. The seller taps their
   own live products into a cart, then either:
     • Charge by QR / payment link — POST /api/shops/:id/pos/checkout
       mints ONE hosted Stripe Checkout session on the SAME marketplace
       rail as an online cart (same shop_events records, same flat-5%
       platform fee out of the seller's cut). The customer scans the QR
       or opens the link and pays on THEIR OWN phone. This panel polls
       the existing checkout verify endpoint until the paid flip lands.
     • Record cash sale — POST /api/shops/:id/pos/cash-sale logs the
       cart in the Money Tracker as in-person cash (no fee — the
       platform never held the money).
   SCOPE HONESTY: there is NO card reader and NO tap-to-pay here. Card
   readers are Stripe Terminal hardware — a partnership step this
   version does not include — and the copy below says so plainly. */

export interface PosProduct {
  id: string;
  name: string;
  price_cents: number;
  image_url: string | null;
  status: "active" | "paused";
}

interface PosModeProps {
  shop: { id: string; name: string };
  products: PosProduct[];
  authed: (path: string, init?: RequestInit) => Promise<Response>;
}

interface PaySession {
  sessionId: string;
  url: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  itemCount: number;
}

const goldBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-amber-300 to-amber-500 px-5 py-3 text-sm font-bold text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none";

const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-50 disabled:pointer-events-none";

export default function PosMode({ shop, products, authed }: PosModeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phase, setPhase] = useState<"building" | "awaiting" | "paid" | "cashDone">("building");
  const [pay, setPay] = useState<PaySession | null>(null);
  const [cashTotal, setCashTotal] = useState(0);
  const [busy, setBusy] = useState<"qr" | "cash" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sellable = useMemo(() => products.filter((p) => p.status === "active"), [products]);
  const lines = useMemo(
    () =>
      sellable
        .filter((p) => (cart[p.id] ?? 0) > 0)
        .map((p) => ({ product: p, qty: cart[p.id]!, gross: p.price_cents * cart[p.id]! })),
    [sellable, cart],
  );
  const totalCents = lines.reduce((s, l) => s + l.gross, 0);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }
  useEffect(() => stopPolling, []);

  function setQty(id: string, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = Math.min(99, qty);
      return next;
    });
  }

  function resetSale() {
    stopPolling();
    setCart({});
    setPay(null);
    setError(null);
    setPhase("building");
  }

  /* Poll the EXISTING verify endpoint: the session id is the capability,
     and a paid session flips the pending order to a sale exactly once
     (the same flip the customer's return page and the webhook run). */
  function startPolling(sessionId: string) {
    stopPolling();
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      if (attempts > 200) {
        stopPolling();
        return;
      }
      try {
        const res = await authed("/api/storefronts/checkout/verify", {
          method: "POST",
          body: JSON.stringify({ sessionId }),
        });
        const data = (await res.json().catch(() => ({}))) as { paid?: boolean };
        if (data.paid) {
          stopPolling();
          setPhase("paid");
        }
      } catch {
        /* transient — the next tick retries */
      }
    }, 3000);
  }

  async function chargeByQr() {
    if (busy || lines.length === 0) return;
    setBusy("qr");
    setError(null);
    try {
      const res = await authed(`/api/shops/${shop.id}/pos/checkout`, {
        method: "POST",
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sessionId?: string; paymentLink?: string; url?: string;
        gross_cents?: number; platform_fee_cents?: number; seller_net_cents?: number;
        paid?: boolean; error?: string;
      };
      if (!res.ok) throw new Error(data.error || t("myShop.pos.chargeFailed", { defaultValue: "Could not start the payment. Nothing was charged." }));
      if (data.paid) {
        /* Free cart: the server recorded it as paid with no payment. */
        setPhase("paid");
        return;
      }
      const url = data.paymentLink || data.url;
      if (!url || !data.sessionId) throw new Error(t("myShop.pos.chargeFailed", { defaultValue: "Could not start the payment. Nothing was charged." }));
      setPay({
        sessionId: data.sessionId,
        url,
        grossCents: data.gross_cents ?? totalCents,
        feeCents: data.platform_fee_cents ?? 0,
        netCents: data.seller_net_cents ?? totalCents,
        itemCount,
      });
      setPhase("awaiting");
      startPolling(data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.pos.chargeFailed", { defaultValue: "Could not start the payment. Nothing was charged." }));
    } finally {
      setBusy(null);
    }
  }

  async function recordCash() {
    if (busy || lines.length === 0) return;
    setBusy("cash");
    setError(null);
    try {
      const res = await authed(`/api/shops/${shop.id}/pos/cash-sale`, {
        method: "POST",
        body: JSON.stringify({
          items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { gross_cents?: number; error?: string };
      if (!res.ok) throw new Error(data.error || t("myShop.pos.cashFailed", { defaultValue: "Could not record the cash sale." }));
      setCashTotal(data.gross_cents ?? totalCents);
      setPhase("cashDone");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("myShop.pos.cashFailed", { defaultValue: "Could not record the cash sale." }));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!pay) return;
    try {
      await navigator.clipboard.writeText(pay.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the link text is selectable below */ }
  }

  if (!open) {
    return (
      <section className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <QrCode className="w-5 h-5 text-amber-300" />
              {t("myShop.pos.title", { defaultValue: "Sell in person" })}
            </h2>
            <p className="mt-1 text-sm text-white/50 max-w-xl">
              {t("myShop.pos.intro", {
                defaultValue:
                  "Selling face to face — at a show, a pop-up, or on the street? Ring up your products here and let the customer pay by QR code or payment link, or record a cash sale.",
              })}
            </p>
          </div>
          <button className={goldBtn} onClick={() => setOpen(true)}>
            <QrCode className="w-4 h-4" />
            {t("myShop.pos.open", { defaultValue: "Open the till" })}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.04] p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <QrCode className="w-5 h-5 text-amber-300" />
          {t("myShop.pos.title", { defaultValue: "Sell in person" })}
          <span className="text-white/40 text-sm font-normal">— {shop.name}</span>
        </h2>
        <button className={ghostBtn} onClick={() => { resetSale(); setOpen(false); }}>
          <X className="w-4 h-4" /> {t("myShop.pos.close", { defaultValue: "Close" })}
        </button>
      </div>

      {/* Scope honesty — what this is, and what it is not. */}
      <p className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-xs leading-relaxed text-white/60">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-300/80" />
        <span>
          {t("myShop.pos.scopeNote", {
            defaultValue:
              "In-person selling here works by QR code or payment link: your customer pays on their own phone with their card, through the same secure checkout as your online shop. There is no card reader and no tap-to-pay — card readers need Stripe Terminal hardware, which this version doesn't include.",
          })}
        </span>
      </p>

      {error && (
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {phase === "paid" && (
        <div className="mt-6 text-center py-6">
          <BadgeCheck className="w-12 h-12 mx-auto text-emerald-400" />
          <h3 className="mt-3 text-xl font-bold">
            {t("myShop.pos.paidTitle", { defaultValue: "Payment confirmed — sale recorded" })}
          </h3>
          <p className="mt-2 text-sm text-white/50">
            {pay
              ? t("myShop.pos.paidDetail", {
                  defaultValue: `The customer paid ${centsToDisplay(pay.grossCents)}. The 5% platform fee (${centsToDisplay(pay.feeCents)}) came out of your cut, same as an online sale — you receive ${centsToDisplay(pay.netCents)}. It shows in your shop sales like any other order.`,
                })
              : t("myShop.pos.paidFreeDetail", {
                  defaultValue: "No payment was needed for these items, and none was taken. The sale is recorded in your shop sales.",
                })}
          </p>
          <button className={`${goldBtn} mt-5`} onClick={resetSale}>
            {t("myShop.pos.newSale", { defaultValue: "New sale" })}
          </button>
        </div>
      )}

      {phase === "cashDone" && (
        <div className="mt-6 text-center py-6">
          <Banknote className="w-12 h-12 mx-auto text-emerald-400" />
          <h3 className="mt-3 text-xl font-bold">
            {t("myShop.pos.cashTitle", { defaultValue: "Cash sale recorded" })}
          </h3>
          <p className="mt-2 text-sm text-white/50">
            {t("myShop.pos.cashDetail", {
              defaultValue: `${centsToDisplay(cashTotal)} is logged in your Money Tracker as in-person cash. No platform fee on cash — the money is already in your hand. You can edit or remove the entry any time in the Money Tracker.`,
            })}
          </p>
          <button className={`${goldBtn} mt-5`} onClick={resetSale}>
            {t("myShop.pos.newSale", { defaultValue: "New sale" })}
          </button>
        </div>
      )}

      {phase === "awaiting" && pay && (
        <div className="mt-6 grid gap-6 md:grid-cols-[auto_1fr] items-start">
          <div className="mx-auto rounded-2xl bg-white p-3">
            <QRCodeImage data={pay.url} size={240} />
          </div>
          <div>
            <h3 className="font-bold">
              {t("myShop.pos.awaitingTitle", { defaultValue: "Customer scans & pays on their phone" })}
            </h3>
            <p className="mt-1 text-sm text-white/50">
              {t("myShop.pos.awaitingDetail", {
                defaultValue: `${pay.itemCount} item${pay.itemCount === 1 ? "" : "s"} — ${centsToDisplay(pay.grossCents)} total. The 5% platform fee (${centsToDisplay(pay.feeCents)}) comes out of your cut; you receive ${centsToDisplay(pay.netCents)}. This screen updates on its own when the payment lands.`,
              })}
            </p>
            <div className="mt-3 flex items-center gap-2 text-sm text-amber-200">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("myShop.pos.waiting", { defaultValue: "Waiting for payment…" })}
            </div>
            <label className="mt-4 block text-xs font-semibold text-white/50">
              {t("myShop.pos.linkLabel", { defaultValue: "Or send them the payment link" })}
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                readOnly
                value={pay.url}
                onFocus={(e) => e.target.select()}
                className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2.5 text-xs font-mono text-white/70 outline-none"
              />
              <button className={ghostBtn} onClick={copyLink}>
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                {copied
                  ? t("myShop.pos.copied", { defaultValue: "Copied" })
                  : t("myShop.pos.copy", { defaultValue: "Copy" })}
              </button>
            </div>
            <p className="mt-3 text-xs text-white/40">
              {t("myShop.pos.laterNote", {
                defaultValue:
                  "If the customer pays later using this link, the sale still records automatically. Starting a new sale doesn't cancel their link.",
              })}
            </p>
            <button className={`${ghostBtn} mt-4`} onClick={resetSale}>
              {t("myShop.pos.newSale", { defaultValue: "New sale" })}
            </button>
          </div>
        </div>
      )}

      {phase === "building" && (
        <>
          {sellable.length === 0 ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-white/50">
              <ShoppingBag className="w-4 h-4" />
              {t("myShop.pos.noProducts", {
                defaultValue: "No live products yet — add a product below first, then you can sell it in person.",
              })}
            </p>
          ) : (
            <>
              {/* Big tap targets: the seller's own live products. */}
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sellable.map((p) => {
                  const qty = cart[p.id] ?? 0;
                  return (
                    <div
                      key={p.id}
                      className={`rounded-2xl border p-3 transition ${
                        qty > 0 ? "border-amber-400/60 bg-amber-400/[0.08]" : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setQty(p.id, qty + 1)}
                        className="w-full text-left"
                        aria-label={`Add ${p.name}`}
                      >
                        {p.image_url ? (
                          <img src={p.image_url} alt="" className="h-20 w-full rounded-xl object-cover" />
                        ) : (
                          <div className="flex h-20 w-full items-center justify-center rounded-xl bg-black/40">
                            <ShoppingBag className="w-6 h-6 text-white/25" />
                          </div>
                        )}
                        <div className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug">{p.name}</div>
                        <div className="text-sm font-bold text-amber-300">{centsToDisplay(p.price_cents)}</div>
                      </button>
                      {qty > 0 && (
                        <div className="mt-2 flex items-center justify-between rounded-xl bg-black/40 px-1 py-1">
                          <button
                            type="button"
                            onClick={() => setQty(p.id, qty - 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06] text-white/80 hover:bg-white/[0.12]"
                            aria-label={`Remove one ${p.name}`}
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="text-sm font-bold">×{qty}</span>
                          <button
                            type="button"
                            onClick={() => setQty(p.id, qty + 1)}
                            className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06] text-white/80 hover:bg-white/[0.12]"
                            aria-label={`Add one ${p.name}`}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Cart summary + the two ways to close the sale. */}
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
                {lines.length === 0 ? (
                  <p className="text-sm text-white/50">
                    {t("myShop.pos.emptyCart", { defaultValue: "Tap products to build the sale." })}
                  </p>
                ) : (
                  <>
                    <ul className="space-y-1.5">
                      {lines.map((l) => (
                        <li key={l.product.id} className="flex items-center justify-between text-sm">
                          <span className="text-white/75">{l.product.name} <span className="text-white/40">×{l.qty}</span></span>
                          <span className="font-semibold">{centsToDisplay(l.gross)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                      <span className="font-bold">{t("myShop.pos.total", { defaultValue: "Total" })}</span>
                      <span className="text-lg font-bold text-amber-300">{centsToDisplay(totalCents)}</span>
                    </div>
                    <p className="mt-2 text-xs text-white/40">
                      {t("myShop.pos.feeNote", {
                        defaultValue:
                          "The customer pays the total above — your listed prices, nothing added. For card payments the standard 5% platform fee comes out of your cut, exactly like an online sale; the exact split is shown on the payment screen. Cash has no fee.",
                      })}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button className={goldBtn} onClick={chargeByQr} disabled={busy !== null}>
                        {busy === "qr" ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
                        {t("myShop.pos.chargeQr", { defaultValue: "Charge by QR / payment link" })}
                      </button>
                      <button className={ghostBtn} onClick={recordCash} disabled={busy !== null}>
                        {busy === "cash" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
                        {t("myShop.pos.recordCash", {
                          defaultValue: `Record ${centsToDisplay(totalCents)} cash sale`,
                        })}
                      </button>
                      <button className={ghostBtn} onClick={() => setCart({})} disabled={busy !== null}>
                        {t("myShop.pos.clear", { defaultValue: "Clear" })}
                      </button>
                    </div>
                  </>
                )}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs text-white/35">
                <Link2 className="w-3.5 h-3.5" />
                {t("myShop.pos.linkHint", {
                  defaultValue: "No app needed for the customer — the link opens a secure payment page in their browser.",
                })}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
