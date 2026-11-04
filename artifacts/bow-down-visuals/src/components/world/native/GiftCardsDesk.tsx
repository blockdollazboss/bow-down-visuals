import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Gift, Loader2, RotateCcw, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "@/components/world/native/NativeCard";
import { centsToDisplay } from "@/lib/shops";
import {
  giftCardRefundable,
  parseGiftCardBalance,
  parseGiftCardRefund,
  parseGiftCardsMine,
  parseGiftCardsSold,
  type GiftCardBalanceView,
  type GiftCardView,
  type GiftCardsSoldView,
} from "@/lib/world/gift-cards";

/* ─── GiftCardsDesk — gift-card truth at the Marketplace square ───
   Gift cards are stored value for ONE creator's store. The desk is
   the whole in-World mirror of the website's gift-card surfaces —
   the rails are the site's own, and every figure on it is a rail's
   answer, never a local computation:
   - check any code's balance (GET /api/gift-cards/balance — public,
     the code is the capability);
   - your own cards (GET /api/gift-cards/mine — bought + sent to
     your account email), last-4s only: the code exists in plaintext
     only at issuance and in the recipient's email;
   - cards sold against YOUR store (GET /api/gift-cards/sold): the
     seller's liability view from the store dashboard — issued total,
     what is still out there (held for the holders, NOT revenue: it
     becomes a sale, with the standard fee, only when spent), and
     the rail's own note saying so;
   - refund the unspent balance of a card you bought
     (POST /api/gift-cards/:id/refund) — the store dashboard's rail:
     only the unspent, unreserved balance comes back, exactly once;
     an in-flight checkout hold answers CARD_IN_USE and a fully
     spent card NOTHING_TO_REFUND, in the rail's own words.
   Buying lives where the cards are sold (the Creator Room store's
   gift form); spending lives at the checkouts, where the code box
   rides beside the receipt email like the shop page's.
   The refund is a money move, so it takes the money desks'
   two-tap discipline (PayoutDesk): the first tap arms the exact
   refundable amount, the second sends. A card whose whole balance
   is held by a checkout in progress skips the arm — the tap goes
   straight to the rail and its CARD_IN_USE words answer.
   When the gift-card tables aren't live yet the rails answer 503
   GIFT_CARDS_UNAVAILABLE — the desk shows that honest line instead
   of a broken card, exactly as the payout desk shows its
   not-configured state. A seller with no creator profile gets the
   rail's own NO_PROFILE line, the same words the dashboard hears.
   Copy discipline (the PlansDesk precedent): this desk's own new
   labels live in the worldGiftCardsDesk catalog namespace; money
   truth — the liability note, every refund answer, amounts — rides
   the rail's words and figures verbatim, never a local sentence. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function CardRow({
  card,
  isLight,
  action,
}: {
  card: GiftCardView;
  isLight: boolean;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div
      data-testid="world-gift-card-mine-row"
      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
      }`}
    >
      <Gift className="h-4 w-4 shrink-0 text-[#d4af37]" />
      <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
        {card.storeName ?? t("worldRemainder.gcdCreatorStore")}
        {card.codeLast4 && <span className={`ml-2 text-xs font-semibold ${muted}`}>•••• {card.codeLast4}</span>}
      </span>
      <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(card.availableCents)}</span>
      <span className={`text-[11px] ${muted}`}>
        {t("worldRemainder.gcdOfInitial", { amount: centsToDisplay(card.initialCents) })} · {card.status}
      </span>
      {action}
    </div>
  );
}

function SoldCardRow({ card, isLight }: { card: GiftCardView; isLight: boolean }) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div
      data-testid="world-gift-card-sold-row"
      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
      }`}
    >
      <Gift className="h-4 w-4 shrink-0 text-[#d4af37]" />
      <span className={`min-w-0 flex-1 truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
        {card.recipientEmail || card.storeName || t("worldRemainder.gcdAFan")}
        {card.codeLast4 && <span className={`ml-2 text-xs font-semibold ${muted}`}>•••• {card.codeLast4}</span>}
      </span>
      <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(card.availableCents)}</span>
      <span className={`text-[11px] ${muted}`}>
        {t("worldRemainder.gcdOfInitial", { amount: centsToDisplay(card.initialCents) })} · {card.status}
      </span>
    </div>
  );
}

export function GiftCardsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [balance, setBalance] = useState<GiftCardBalanceView | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [mine, setMine] = useState<{ bought: GiftCardView[]; received: GiftCardView[] } | null>(null);
  const [mineFailed, setMineFailed] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const [sold, setSold] = useState<GiftCardsSoldView | null>(null);
  const [soldFailed, setSoldFailed] = useState(false);
  const [soldUnavailable, setSoldUnavailable] = useState<string | null>(null);
  const [soldNoProfile, setSoldNoProfile] = useState<string | null>(null);

  const [armedRefundId, setArmedRefundId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundNote, setRefundNote] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/gift-cards/mine", { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 503) {
        setUnavailable(apiErrorMessage(data, t("worldRemainder.gcdNotLive")));
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldRemainder.gcdLoadMineFailed")));
      const parsed = parseGiftCardsMine(data);
      if (!parsed) throw new Error(t("worldRemainder.gcdLoadMineFailed"));
      setMine(parsed);
      setMineFailed(false);
    } catch {
      setMineFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const loadSold = useCallback(async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/gift-cards/sold", { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 503) {
        setSoldUnavailable(apiErrorMessage(data, t("worldRemainder.gcdNotLive")));
        return;
      }
      if (res.status === 404) {
        /* No creator profile: the rail's own words name the state —
           it is a fact about the walker, not a load failure. */
        setSoldNoProfile(apiErrorMessage(data, t("worldRemainder.gcdNoProfile")));
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldRemainder.gcdLoadSoldFailed")));
      const parsed = parseGiftCardsSold(data);
      if (!parsed) throw new Error(t("worldRemainder.gcdLoadSoldFailed"));
      setSold(parsed);
      setSoldFailed(false);
    } catch {
      setSoldFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  useEffect(() => {
    void loadSold();
  }, [loadSold]);

  const check = async () => {
    const trimmed = code.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setCheckError(null);
    setBalance(null);
    try {
      const res = await fetch(`/api/gift-cards/balance?code=${encodeURIComponent(trimmed)}`);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldRemainder.gcdCheckFailed")));
      const parsed = parseGiftCardBalance(data);
      if (!parsed) throw new Error(t("worldRemainder.gcdCheckFailed"));
      setBalance(parsed);
    } catch (e) {
      setCheckError(plainErrorText(e, t("worldRemainder.gcdCheckFailed")));
    } finally {
      setChecking(false);
    }
  };

  /* The two-tap refund: first tap arms (the label names the exact
     refundable figure — balance minus any hold, the rail's own
     available number), second tap sends. A fully-held card skips
     the arm so the rail's CARD_IN_USE words answer at once instead
     of an arm promising $0. Success and failure are separate
     states, each carrying the rail's own words; after a success
     both lists reload from the rails — the closed card and the
     new liability are the server's truth, not a local edit. */
  const tapRefund = async (card: GiftCardView) => {
    if (refundingId) return;
    setRefundNote(null);
    setRefundError(null);
    if (armedRefundId !== card.id && card.availableCents > 0) {
      setArmedRefundId(card.id);
      return;
    }
    setArmedRefundId(null);
    setRefundingId(card.id);
    try {
      const res = await fetch(`/api/gift-cards/${card.id}/refund`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, t("worldGiftCardsDesk.refundFailed")));
      const parsed = parseGiftCardRefund(data);
      if (!parsed) throw new Error(t("worldGiftCardsDesk.refundFailed"));
      setRefundNote(
        parsed.note ||
          t("worldGiftCardsDesk.refundDoneFallback", {
            amount: parsed.refunded || centsToDisplay(parsed.refundedCents),
          }),
      );
      await Promise.all([loadMine(), loadSold()]);
    } catch (e) {
      setRefundError(plainErrorText(e, t("worldGiftCardsDesk.refundFailed")));
    } finally {
      setRefundingId(null);
    }
  };

  const refundAction = (card: GiftCardView): ReactNode => {
    if (!giftCardRefundable(card)) return null;
    const armed = armedRefundId === card.id;
    const busy = refundingId === card.id;
    return (
      <button
        type="button"
        data-testid="world-gift-card-refund-button"
        onClick={() => void tapRefund(card)}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold transition hover:scale-105 disabled:opacity-50 bdv-touch-target ${
          armed
            ? "bg-[#d4af37] text-black"
            : isLight
              ? "border border-[#7A5A12]/50 text-[#7A5A12]"
              : "border border-[#d4af37]/50 text-[#d4af37]"
        }`}
      >
        {busy ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" /> {t("worldGiftCardsDesk.refunding")}
          </>
        ) : armed ? (
          t("worldGiftCardsDesk.refundArm", { amount: centsToDisplay(card.availableCents) })
        ) : (
          t("worldGiftCardsDesk.refundUnspent")
        )}
      </button>
    );
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
      : "border-white/15 bg-black/50 text-white placeholder:text-white/30 focus:border-[#d4af37]/60"
  }`;

  return (
    <NativeCard isLight={isLight} title={t("worldRemainder.gcdTitle")}>
      <div data-testid="world-gift-cards-desk" className="space-y-3">
        <p className={`text-xs ${muted}`}>
          {t("worldRemainder.gcdIntro")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            data-testid="world-gift-card-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void check();
            }}
            placeholder={t("worldRemainder.gcdCodePlaceholder")}
            aria-label={t("worldRemainder.gcdCodeAria")}
            className={`${inputCls} min-w-0 flex-1`}
          />
          <button
            type="button"
            data-testid="world-gift-card-check-button"
            onClick={() => void check()}
            disabled={checking || !code.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-2 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
          >
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {t("worldRemainder.gcdCheckBalance")}
          </button>
        </div>
        {checkError && <p className="text-xs font-semibold text-red-400">{checkError}</p>}
        {balance && (
          <div
            data-testid="world-gift-card-balance"
            className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
          >
            <p className={`flex flex-wrap items-baseline gap-x-2 text-sm ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              <span className="text-lg font-black text-[#d4af37]">{balance.balance || centsToDisplay(balance.balanceCents)}</span>
              <span className="font-bold">
                {t("worldRemainder.gcdOnTheCard")}{balance.codeLast4 ? ` •••• ${balance.codeLast4}` : ""}
              </span>
              <span className={`text-xs ${muted}`}>({balance.status})</span>
            </p>
            <p className={`mt-0.5 text-xs ${muted}`}>
              {balance.storeName
                ? <>{t("worldRemainder.gcdSpendableIn", { store: balance.storeName })}</>
                : <>{t("worldRemainder.gcdSpendStays")}</>}
            </p>
          </div>
        )}

        {refundNote && (
          <p data-testid="world-gift-card-refund-note" className="text-xs font-semibold text-emerald-400">
            {refundNote}
          </p>
        )}
        {refundError && (
          <p data-testid="world-gift-card-refund-error" className="text-xs font-semibold text-red-400">
            {refundError}
          </p>
        )}

        {isGuest ? (
          <p className={`text-xs ${muted}`}>
            {t("worldRemainder.gcdGuestLine")}
          </p>
        ) : unavailable ? (
          <p className={`text-xs ${muted}`}>{unavailable}</p>
        ) : mineFailed ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-red-400">{t("worldRemainder.gcdMineFailedLine")}</p>
            <button
              type="button"
              onClick={() => {
                setMineFailed(false);
                void loadMine();
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
            >
              <RotateCcw className="h-3.5 w-3.5" /> {t("worldGiftCardsDesk.tryAgain")}
            </button>
          </div>
        ) : mine === null ? (
          <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldRemainder.gcdMineLoading")}
          </p>
        ) : mine.bought.length === 0 && mine.received.length === 0 ? (
          <p className={`text-xs ${muted}`}>
            {t("worldRemainder.gcdMineEmpty")}
          </p>
        ) : (
          <div className="space-y-2">
            {mine.received.length > 0 && (
              <>
                <p className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>{t("worldRemainder.gcdSentToYou")}</p>
                {mine.received.map((c) => (
                  <CardRow key={c.id} card={c} isLight={isLight} />
                ))}
              </>
            )}
            {mine.bought.length > 0 && (
              <>
                <p className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>{t("worldRemainder.gcdYouBought")}</p>
                {mine.bought.map((c) => (
                  <CardRow key={c.id} card={c} isLight={isLight} action={refundAction(c)} />
                ))}
              </>
            )}
          </div>
        )}

        {!isGuest && (
          <div
            data-testid="world-gift-cards-sold"
            className={`space-y-2 border-t pt-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}
          >
            <p className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>
              {t("worldGiftCardsDesk.soldTitle")}
            </p>
            {soldUnavailable ? (
              <p className={`text-xs ${muted}`}>{soldUnavailable}</p>
            ) : soldNoProfile ? (
              <p className={`text-xs ${muted}`}>{soldNoProfile}</p>
            ) : soldFailed ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-red-400">{t("worldGiftCardsDesk.soldLoadFailed")}</p>
                <button
                  type="button"
                  data-testid="world-gift-card-sold-retry"
                  onClick={() => {
                    setSoldFailed(false);
                    void loadSold();
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {t("worldGiftCardsDesk.tryAgain")}
                </button>
              </div>
            ) : sold === null ? (
              <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldGiftCardsDesk.soldLoading")}
              </p>
            ) : sold.liability.cardCount === 0 && sold.cards.length === 0 ? (
              <p className={`text-xs ${muted}`}>{t("worldGiftCardsDesk.soldEmpty")}</p>
            ) : (
              <>
                <div
                  data-testid="world-gift-card-sold-totals"
                  className={`space-y-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                  }`}
                >
                  <p className={`flex flex-wrap items-baseline gap-x-2 text-sm ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    <span className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>
                      {t("worldGiftCardsDesk.soldAllTime")}
                    </span>
                    <span className="text-lg font-black text-[#d4af37]">
                      {sold.liability.issued || centsToDisplay(sold.liability.issuedCents)}
                    </span>
                    <span className={`text-xs ${muted}`}>
                      {t("worldGiftCardsDesk.soldCount", { count: sold.liability.cardCount })}
                    </span>
                  </p>
                  <p className={`flex flex-wrap items-baseline gap-x-2 text-sm ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    <span className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>
                      {t("worldGiftCardsDesk.stillOutThere")}
                    </span>
                    <span className="text-lg font-black text-[#d4af37]">
                      {sold.liability.outstanding || centsToDisplay(sold.liability.outstandingCents)}
                    </span>
                  </p>
                  <p className={`text-xs ${muted}`}>{t("worldGiftCardsDesk.heldLine")}</p>
                  {sold.liability.note && (
                    <p className={`text-xs ${muted}`}>
                      <span className="font-bold">{t("worldGiftCardsDesk.howYouGetPaid")}: </span>
                      {sold.liability.note}
                    </p>
                  )}
                </div>
                {sold.cards.length > 0 && (
                  <>
                    <p className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>
                      {t("worldGiftCardsDesk.soldAgainst")}
                    </p>
                    {sold.cards.map((c) => (
                      <SoldCardRow key={c.id} card={c} isLight={isLight} />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </NativeCard>
  );
}
