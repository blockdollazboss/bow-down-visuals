import { plainErrorText } from "../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Tag } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  actOnOffer,
  createOffer,
  currentOfferPriceCents,
  fetchOfferForItem,
  offerMoney,
  offerStatusLabel,
  parseOfferDollars,
  validateCounterAmount,
  validateOfferAmount,
  type ProductOffer,
  type ProductOfferItemKind,
} from "@/lib/product-offers";

/* ─── Make-an-offer — buyer panel (Wave 4 #43) ─────────────────────────
   Docked on the product surfaces (storefront product page + shop
   product modal), never a page of its own. The buyer proposes a price
   below list; the seller accepts / declines / counters in their store
   dashboard (SellerOffersInbox). An accepted offer's "Buy at …"
   button hands the offer id to the page's EXISTING checkout — the
   server charges the agreed price from the offer row, so this panel
   never names a price to checkout. Real money via checkout (test
   mode); this is not Visual Bucs. */
export default function ProductOfferPanel({
  itemKind,
  itemId,
  listPriceCents,
  soldOut = false,
  onCheckoutOffer,
  className = "",
}: {
  itemKind: ProductOfferItemKind;
  itemId: string;
  listPriceCents: number;
  soldOut?: boolean;
  /** The page's existing checkout, handed the accepted offer's id. */
  onCheckoutOffer: (offer: ProductOffer) => Promise<void>;
  className?: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [, navigate] = useLocation();
  const [offer, setOffer] = useState<ProductOffer | null | undefined>(undefined);
  const [amount, setAmount] = useState("");
  const [counter, setCounter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) { setOffer(null); return; }
    try {
      setOffer(await fetchOfferForItem(getAccessToken, itemKind, itemId));
    } catch {
      setOffer(null);
    }
  }, [user, getAccessToken, itemKind, itemId]);

  useEffect(() => { void reload(); }, [reload]);

  /* Nothing to negotiate: a free / 1¢ product, or a sold-out one (the
     server refuses offers on unavailable products too). */
  if (soldOut || listPriceCents <= 1 || offer === undefined) return null;

  const run = async (fn: () => Promise<ProductOffer | void>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) setOffer(next);
      else await reload();
    } catch (e) {
      setError(plainErrorText(e, "That didn't go through — try again."));
    } finally {
      setBusy(false);
    }
  };

  const submitOffer = () => {
    const cents = parseOfferDollars(amount);
    const valid = validateOfferAmount(cents, listPriceCents);
    if (!valid.ok) { setError(valid.reason); return; }
    void run(async () => createOffer(getAccessToken, { itemKind, itemId, amountCents: valid.amountCents }));
  };

  const submitCounter = () => {
    if (!offer) return;
    const cents = parseOfferDollars(counter);
    const valid = validateCounterAmount(cents, offer.offer_amount_cents, offer.counter_amount_cents ?? listPriceCents);
    if (!valid.ok) { setError(valid.reason); return; }
    void run(async () => actOnOffer(getAccessToken, offer.id, "counter", valid.amountCents));
  };

  const inputCls = "w-28 rounded-lg border border-amber-500/30 bg-black/40 px-3 py-2 text-sm font-bold text-amber-100 outline-none placeholder:font-normal placeholder:text-amber-100/30 focus:border-amber-400/60";
  const goldBtn = "inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#e8c86a] to-[#c9a84c] px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50";
  const ghostBtn = "inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 px-4 py-2 text-sm font-semibold text-amber-200/80 transition hover:bg-amber-500/10 disabled:opacity-50";

  return (
    <div className={`rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4 ${className}`}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-400/80">
        <Tag className="h-3.5 w-3.5" /> Make an offer
      </div>

      {!user ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-100/70">Name your price below {offerMoney(listPriceCents)} — the seller can accept, decline, or counter.</p>
          <button type="button" className={goldBtn} onClick={() => navigate("/login")}>Sign in to offer</button>
        </div>
      ) : !offer ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-amber-200">$</span>
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder={(listPriceCents / 100).toFixed(2)}
              aria-label="Your offer, in dollars"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <button type="button" className={goldBtn} disabled={busy} onClick={submitOffer}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Make offer
            </button>
          </div>
          <p className="mt-2 text-xs text-amber-100/50">
            Below the {offerMoney(listPriceCents)} list price. If the seller accepts, that&apos;s the price you pay at checkout — the platform fee still comes out of the seller&apos;s cut, never on top.
          </p>
        </div>
      ) : offer.status === "pending" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-100/80">
            Your offer: <span className="font-bold text-amber-200">{offerMoney(offer.offer_amount_cents)}</span>
            <span className="text-amber-100/50"> · {offerStatusLabel(offer.status, "buyer")}</span>
          </p>
          <button type="button" className={ghostBtn} disabled={busy} onClick={() => void run(async () => actOnOffer(getAccessToken, offer.id, "withdraw"))}>
            Withdraw offer
          </button>
        </div>
      ) : offer.status === "countered" ? (
        <div className="mt-3">
          <p className="text-sm text-amber-100/80">
            The seller countered at <span className="font-bold text-amber-200">{offerMoney(currentOfferPriceCents(offer))}</span>
            <span className="text-amber-100/50"> (you offered {offerMoney(offer.offer_amount_cents)}, list is {offerMoney(offer.list_price_cents)})</span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={goldBtn} disabled={busy} onClick={() => void run(async () => actOnOffer(getAccessToken, offer.id, "accept"))}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Accept {offerMoney(currentOfferPriceCents(offer))}
            </button>
            <span className="text-lg font-bold text-amber-200">$</span>
            <input
              className={inputCls}
              inputMode="decimal"
              placeholder={(currentOfferPriceCents(offer) / 100).toFixed(2)}
              aria-label="Your counter-offer, in dollars"
              value={counter}
              onChange={(e) => setCounter(e.target.value)}
            />
            <button type="button" className={ghostBtn} disabled={busy} onClick={submitCounter}>Counter</button>
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => void run(async () => actOnOffer(getAccessToken, offer.id, "decline"))}>
              Decline
            </button>
          </div>
        </div>
      ) : offer.status === "accepted" ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-100/80">
            Deal — <span className="font-bold text-amber-200">{offerMoney(currentOfferPriceCents(offer))}</span>
            <span className="text-amber-100/50"> is your price. Check out before the offer expires and it&apos;s yours at that price.</span>
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className={ghostBtn} disabled={busy} onClick={() => void run(async () => actOnOffer(getAccessToken, offer.id, "withdraw"))}>
              Withdraw
            </button>
            <button
              type="button"
              className={goldBtn}
              disabled={busy}
              onClick={() => { setBusy(true); setError(null); onCheckoutOffer(offer).catch((e) => { setError(plainErrorText(e, "Checkout failed.")); }).finally(() => setBusy(false)); }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Buy at {offerMoney(currentOfferPriceCents(offer))}
            </button>
          </div>
        </div>
      ) : null}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
