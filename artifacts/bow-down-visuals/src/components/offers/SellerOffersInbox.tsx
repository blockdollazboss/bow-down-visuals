import { useCallback, useEffect, useState } from "react";
import { Loader2, Tag } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  actOnOffer,
  currentOfferPriceCents,
  fetchReceivedOffers,
  isOpenOffer,
  offerActionAllowed,
  offerMoney,
  offerStatusLabel,
  parseOfferDollars,
  validateCounterAmount,
  type ProductOffer,
  type ProductOfferItemKind,
} from "@/lib/product-offers";

/* ─── Make-an-offer — seller inbox (Wave 4 #43) ────────────────────────
   Docked in the seller surfaces that already manage these products
   (Store Dashboard for storefront products, My Shop for shop
   products). Accepting pins the agreed price the buyer's existing
   checkout will charge; declining settles the offer; a counter sends
   the turn back to the buyer. Settled offers stay listed, honestly
   labelled — the seller's negotiation history, not a sales ledger
   (sales stay on the orders rails). */
export default function SellerOffersInbox({
  itemKind,
  className = "",
}: {
  itemKind: ProductOfferItemKind;
  className?: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [offers, setOffers] = useState<ProductOffer[] | null>(null);
  const [counterDrafts, setCounterDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) { setOffers([]); return; }
    try {
      const all = await fetchReceivedOffers(getAccessToken);
      setOffers(all.filter((o) => o.item_kind === itemKind));
    } catch {
      setOffers([]);
    }
  }, [user, getAccessToken, itemKind]);

  useEffect(() => { void reload(); }, [reload]);

  if (!offers || offers.length === 0) return null;

  const open = offers.filter(isOpenOffer);
  const settled = offers.filter((o) => !isOpenOffer(o));

  const act = async (offer: ProductOffer, action: "accept" | "decline" | "counter") => {
    setBusyId(offer.id);
    setError(null);
    try {
      let amountCents: number | undefined;
      if (action === "counter") {
        const cents = parseOfferDollars(counterDrafts[offer.id] ?? "");
        const valid = validateCounterAmount(cents, offer.offer_amount_cents, offer.list_price_cents);
        if (!valid.ok) { setError(valid.reason); setBusyId(null); return; }
        amountCents = valid.amountCents;
      }
      await actOnOffer(getAccessToken, offer.id, action, amountCents);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusyId(null);
    }
  };

  const inputCls = "w-24 rounded-lg border border-amber-500/30 bg-black/40 px-3 py-1.5 text-sm font-bold text-amber-100 outline-none placeholder:font-normal placeholder:text-amber-100/30 focus:border-amber-400/60";
  const goldBtn = "inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-[#e8c86a] to-[#c9a84c] px-3.5 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-50";
  const ghostBtn = "inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 px-3.5 py-1.5 text-xs font-semibold text-amber-200/80 transition hover:bg-amber-500/10 disabled:opacity-50";

  const row = (offer: ProductOffer) => (
    <div key={offer.id} className="rounded-xl border border-amber-500/15 bg-black/30 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-amber-100">{offer.title || "Product"}</span>
        <span className="text-xs text-amber-100/50">{offerStatusLabel(offer.status, "seller")}</span>
      </div>
      <p className="mt-1 text-sm text-amber-100/70">
        List {offerMoney(offer.list_price_cents)} · buyer offered{" "}
        <span className="font-bold text-amber-200">{offerMoney(offer.offer_amount_cents)}</span>
        {offer.status === "countered" && (
          <> · your counter: <span className="font-bold text-amber-200">{offerMoney(currentOfferPriceCents(offer))}</span></>
        )}
        {offer.status === "accepted" && (
          <> · agreed: <span className="font-bold text-amber-200">{offerMoney(currentOfferPriceCents(offer))}</span> — the buyer checks out at this price</>
        )}
      </p>
      {offer.message && <p className="mt-1 text-xs italic text-amber-100/50">“{offer.message}”</p>}
      {offerActionAllowed(offer.status, "seller", "accept") && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={goldBtn} disabled={busyId === offer.id} onClick={() => void act(offer, "accept")}>
            {busyId === offer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Accept {offerMoney(offer.offer_amount_cents)}
          </button>
          <span className="text-sm font-bold text-amber-200">$</span>
          <input
            className={inputCls}
            inputMode="decimal"
            aria-label={`Counter-offer for ${offer.title || "product"}, in dollars`}
            placeholder={(offer.list_price_cents / 100).toFixed(2)}
            value={counterDrafts[offer.id] ?? ""}
            onChange={(e) => setCounterDrafts((d) => ({ ...d, [offer.id]: e.target.value }))}
          />
          <button type="button" className={ghostBtn} disabled={busyId === offer.id} onClick={() => void act(offer, "counter")}>
            Counter
          </button>
          <button type="button" className={ghostBtn} disabled={busyId === offer.id} onClick={() => void act(offer, "decline")}>
            Decline
          </button>
        </div>
      )}
    </div>
  );

  return (
    <section className={`rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-400/[0.06] to-transparent p-5 ${className}`}>
      <h2 className="flex items-center gap-2 text-base font-black text-amber-100">
        <Tag className="h-4 w-4 text-amber-400" /> Offers on your products
        {open.length > 0 && (
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-200">{open.length} open</span>
        )}
      </h2>
      <p className="mt-1 text-xs text-amber-100/50">
        Accept and the buyer checks out at that price through the regular checkout — your net is the agreed price minus the usual flat 5% fee. Nothing is charged until they buy.
      </p>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-4 space-y-3">
        {open.map(row)}
        {settled.slice(0, 5).map(row)}
      </div>
    </section>
  );
}
