import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2, RotateCcw, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeCard } from "@/components/world/native/NativeCard";
import { centsToDisplay } from "@/lib/shops";
import {
  parseGiftCardBalance,
  parseGiftCardsMine,
  type GiftCardBalanceView,
  type GiftCardView,
} from "@/lib/world/gift-cards";

/* ─── GiftCardsDesk — gift-card truth at the Marketplace square ───
   Gift cards are stored value for ONE creator's store, and until
   this desk they had no in-World form at all: the balance rail
   (GET /api/gift-cards/balance — public, the code is the
   capability) and the mine rail (GET /api/gift-cards/mine — cards
   I bought + cards sent to my account email) existed for the
   website, and the palace never asked either. This desk is the
   read half of the gift-card parity: check any code's balance
   where you stand, and see your own cards with the balances the
   rail reports — never a local guess, and never a code (the code
   exists in plaintext only at issuance and in the recipient's
   email; the rails present last-4s, and so does this desk).
   Buying lives where the cards are sold (the Creator Room store's
   gift form); spending lives at the checkouts, where the code box
   now rides beside the receipt email like the shop page's.
   When the gift-card tables aren't live yet the rails answer 503
   GIFT_CARDS_UNAVAILABLE — the desk shows that honest line instead
   of a broken card, exactly as the payout desk shows its
   not-configured state. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function CardRow({ card, isLight }: { card: GiftCardView; isLight: boolean }) {
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
        {card.storeName ?? "A creator's store"}
        {card.codeLast4 && <span className={`ml-2 text-xs font-semibold ${muted}`}>•••• {card.codeLast4}</span>}
      </span>
      <span className="text-sm font-black text-[#d4af37]">{centsToDisplay(card.availableCents)}</span>
      <span className={`text-[11px] ${muted}`}>
        of {centsToDisplay(card.initialCents)} · {card.status}
      </span>
    </div>
  );
}

export function GiftCardsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [balance, setBalance] = useState<GiftCardBalanceView | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [mine, setMine] = useState<{ bought: GiftCardView[]; received: GiftCardView[] } | null>(null);
  const [mineFailed, setMineFailed] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    if (isGuest) return;
    try {
      const res = await fetch("/api/gift-cards/mine", { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 503) {
        setUnavailable(apiErrorMessage(data, "Gift cards aren't live yet — they'll open with the store's next update."));
        return;
      }
      if (!res.ok) throw new Error(apiErrorMessage(data, "Couldn't load your gift cards."));
      const parsed = parseGiftCardsMine(data);
      if (!parsed) throw new Error("Couldn't load your gift cards.");
      setMine(parsed);
      setMineFailed(false);
    } catch {
      setMineFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const check = async () => {
    const trimmed = code.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setCheckError(null);
    setBalance(null);
    try {
      const res = await fetch(`/api/gift-cards/balance?code=${encodeURIComponent(trimmed)}`);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorMessage(data, "Could not check that card."));
      const parsed = parseGiftCardBalance(data);
      if (!parsed) throw new Error("Could not check that card.");
      setBalance(parsed);
    } catch (e) {
      setCheckError(plainErrorText(e, "Could not check that card."));
    } finally {
      setChecking(false);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/50 bg-white/70 text-[#2a1e07] placeholder:text-[#6B5B36]/60 focus:border-[#7A5A12]"
      : "border-white/15 bg-black/50 text-white placeholder:text-white/30 focus:border-[#d4af37]/60"
  }`;

  return (
    <NativeCard isLight={isLight} title="Gift cards">
      <div data-testid="world-gift-cards-desk" className="space-y-3">
        <p className={`text-xs ${muted}`}>
          Stored value for one creator&rsquo;s store — real money on the card, not Visual Bucs.
          Check a code here; buy one at the creator&rsquo;s own stand, and spend it right at their checkout.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            data-testid="world-gift-card-code-input"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void check();
            }}
            placeholder="Gift card code — BDV-XXXX-XXXX-XXXX-XXXX"
            aria-label="Gift card code"
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
            Check balance
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
                on the card{balance.codeLast4 ? ` •••• ${balance.codeLast4}` : ""}
              </span>
              <span className={`text-xs ${muted}`}>({balance.status})</span>
            </p>
            <p className={`mt-0.5 text-xs ${muted}`}>
              {balance.storeName
                ? <>Spendable in {balance.storeName}&rsquo;s store — at their stand here, or on their shop page. Whatever you don&rsquo;t spend stays on the card.</>
                : <>Whatever you don&rsquo;t spend stays on the card.</>}
            </p>
          </div>
        )}

        {isGuest ? (
          <p className={`text-xs ${muted}`}>
            The cards in your name ride your account — sign in on the website (the footer below) and
            come back; cards bought for your account email will be listed here.
          </p>
        ) : unavailable ? (
          <p className={`text-xs ${muted}`}>{unavailable}</p>
        ) : mineFailed ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-red-400">Couldn&rsquo;t load your gift cards — your cards are unchanged.</p>
            <button
              type="button"
              onClick={() => {
                setMineFailed(false);
                void loadMine();
              }}
              className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 bdv-touch-target"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        ) : mine === null ? (
          <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Loading your gift cards…
          </p>
        ) : mine.bought.length === 0 && mine.received.length === 0 ? (
          <p className={`text-xs ${muted}`}>
            No gift cards in your name yet — buy one at a creator&rsquo;s stand and it shows here;
            one sent to your account email shows here too.
          </p>
        ) : (
          <div className="space-y-2">
            {mine.received.length > 0 && (
              <>
                <p className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>Sent to you</p>
                {mine.received.map((c) => (
                  <CardRow key={c.id} card={c} isLight={isLight} />
                ))}
              </>
            )}
            {mine.bought.length > 0 && (
              <>
                <p className={`text-[11px] font-black uppercase tracking-widest ${muted}`}>You bought</p>
                {mine.bought.map((c) => (
                  <CardRow key={c.id} card={c} isLight={isLight} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </NativeCard>
  );
}
